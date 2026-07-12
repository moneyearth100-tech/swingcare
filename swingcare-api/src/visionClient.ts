import { config } from './config.js';

export type VisionLandmark = {
  x: number;
  y: number;
  z: number;
  visibility: number;
};

export type VisionLandmarkFrame = {
  timestampMs: number;
  landmarks: VisionLandmark[];
};

export type VisionSuccess = {
  ok: true;
  fps: number;
  frameCount: number;
  durationMs: number;
  frames: VisionLandmarkFrame[];
};

export type VisionFailure = {
  ok: false;
  error: { code: string; message: string };
};

export async function callVisionExtract(
  video: Buffer,
  fileName: string,
  contentType: string,
): Promise<VisionSuccess> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(video)], { type: contentType });
  form.append('file', blob, fileName);
  form.append('fps', String(config.visionFps));

  let response: Response;
  try {
    response = await fetch(config.visionExtractUrl, {
      method: 'POST',
      body: form,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`VISION_NETWORK: ${message}`);
  }

  const json = (await response.json()) as VisionSuccess | VisionFailure;
  if (!json || typeof json !== 'object') {
    throw new Error(`VISION_BAD_RESPONSE: HTTP ${response.status}`);
  }
  if (!('ok' in json) || json.ok !== true) {
    const fail = json as VisionFailure;
    const code = fail.error?.code ?? 'UNKNOWN';
    const message = fail.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`VISION_${code}: ${message}`);
  }
  return json;
}
