/**
 * ffmpeg 클립 trim — issue_phase 타임코드 ±4초.
 */

import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getAdminClient, parseVideoUrl } from './supabaseAdmin.js';

const HALF_WINDOW_MS = 4000;

function resolveFfmpegBin(): string {
  const fromEnv = (process.env.FFMPEG_PATH ?? '').trim();
  const candidates = [
    fromEnv,
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    'ffmpeg',
  ].filter(Boolean);

  for (const bin of candidates) {
    if (bin === 'ffmpeg') {
      return bin;
    }
    try {
      accessSync(bin, constants.X_OK);
      return bin;
    } catch {
      // try next
    }
  }
  return 'ffmpeg';
}

export type PhaseMarkerLike = {
  phase: string;
  timestampMs: number;
  frameIndex?: number;
};

export function resolveClipWindow(input: {
  phases: PhaseMarkerLike[];
  issuePhase: string | null;
  durationMs: number;
}): { startMs: number; endMs: number; centerMs: number } {
  const durationMs = Math.max(0, input.durationMs || 0);
  let centerMs = 0;
  if (input.issuePhase) {
    const hit = input.phases.find((p) => p.phase === input.issuePhase);
    if (hit && Number.isFinite(hit.timestampMs)) {
      centerMs = hit.timestampMs;
    }
  }
  if (!centerMs && input.phases.length > 0) {
    const impact = input.phases.find((p) => p.phase === 'impact');
    centerMs = impact?.timestampMs ?? input.phases[0].timestampMs ?? 0;
  }
  const startMs = Math.max(0, centerMs - HALF_WINDOW_MS);
  let endMs = centerMs + HALF_WINDOW_MS;
  if (durationMs > 0) {
    endMs = Math.min(durationMs, endMs);
  }
  if (endMs <= startMs) {
    endMs = startMs + 1000;
  }
  return { startMs, endMs, centerMs };
}

function runFfmpeg(args: string[]): Promise<void> {
  const bin = resolveFfmpegBin();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.on('error', (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('ENOENT')) {
        reject(
          new Error(
            `ffmpeg not found (${bin}). brew install ffmpeg 후 API를 재시작하세요.`,
          ),
        );
        return;
      }
      reject(e);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exit ${code}: ${err.slice(-800)}`));
    });
  });
}

export async function extractAndUploadClip(input: {
  userId: string;
  requestId: string;
  videoUrl: string;
  startMs: number;
  endMs: number;
}): Promise<{
  clipUrl: string;
  storagePath: string;
  usedOriginalVideo: boolean;
}> {
  const { bucket, path } = parseVideoUrl(input.videoUrl);
  const { data, error } = await getAdminClient().storage
    .from(bucket)
    .download(path);
  if (error || !data) {
    throw new Error(error?.message ?? 'source video download failed');
  }

  const dir = await mkdtemp(join(tmpdir(), 'swingcare-clip-'));
  const srcPath = join(dir, 'source.bin');
  const outPath = join(dir, 'clip.mp4');
  try {
    const sourceBuffer = Buffer.from(await data.arrayBuffer());
    await writeFile(srcPath, sourceBuffer);
    const startSec = (input.startMs / 1000).toFixed(3);
    const durationSec = Math.max(
      0.5,
      (input.endMs - input.startMs) / 1000,
    ).toFixed(3);
    let clipBuffer: Buffer;
    let extension = '.mp4';
    let contentType = 'video/mp4';
    let usedOriginalVideo = false;
    try {
      await runFfmpeg([
        '-y',
        '-ss',
        startSec,
        '-i',
        srcPath,
        '-t',
        durationSec,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        outPath,
      ]);
      clipBuffer = await readFile(outPath);
    } catch (error) {
      usedOriginalVideo = true;
      clipBuffer = sourceBuffer;
      extension = input.videoUrl.toLowerCase().endsWith('.mov') ? '.mov' : '.mp4';
      contentType =
        extension === '.mov' ? 'video/quicktime' : data.type || 'video/mp4';
      console.warn(
        '[coaching clip] trim failed; using original video',
        error instanceof Error ? error.message : String(error),
      );
    }

    const storagePath = `${input.userId}/${input.requestId}${extension}`;
    const { error: upErr } = await getAdminClient().storage
      .from('swing-coaching')
      .upload(storagePath, clipBuffer, {
        contentType,
        upsert: true,
      });
    if (upErr) {
      throw new Error(upErr.message);
    }
    const clipUrl = `swing-coaching/${storagePath}`;
    return { clipUrl, storagePath, usedOriginalVideo };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function sanitizeDiagnosisSummary(text: string | null | undefined): string {
  if (!text) {
    return '스윙 컨디셔닝 인사이트를 함께 확인해 주세요.';
  }
  const banned = [/부상/g, /위험/g, /진단/g];
  // 구조화 본문이면 요약 단락만 (홈·코치 메일용)
  const factMark = text.indexOf('[근거]');
  let out = (factMark >= 0 ? text.slice(0, factMark) : text).trim();
  for (const re of banned) {
    out = out.replace(re, '참고');
  }
  return out.slice(0, 500);
}
