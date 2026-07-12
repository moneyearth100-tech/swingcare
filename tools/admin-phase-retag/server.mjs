/**
 * 관리자 재태깅 로컬 서버.
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 필요.
 */

import { createClient } from '@supabase/supabase-js';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.ADMIN_RETAG_PORT || 8787);
const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;
const adminToken = process.env.ADMIN_RETAG_TOKEN || '';

if (!url || !key) {
  console.error(
    'Missing SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY',
  );
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PHASES = [
  'address',
  'toe_up',
  'mid_backswing',
  'top',
  'mid_downswing',
  'impact',
  'mid_follow_through',
  'finish',
];

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(body));
}

function authorize(req) {
  if (!adminToken) {
    return true;
  }
  const h = req.headers.authorization || '';
  return h === `Bearer ${adminToken}`;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) {
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function normalizePhases(input, frames) {
  const byPhase = new Map();
  for (const p of input || []) {
    if (p?.phase) {
      byPhase.set(p.phase, p);
    }
  }
  return PHASES.map((phase) => {
    const prev = byPhase.get(phase) || {};
    const timestampMs = Number(prev.timestampMs) || 0;
    let frameIndex = Number(prev.frameIndex);
    if (!Number.isFinite(frameIndex) && Array.isArray(frames) && frames.length) {
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < frames.length; i += 1) {
        const dist = Math.abs((frames[i].timestampMs ?? 0) - timestampMs);
        if (dist < bestDist) {
          best = i;
          bestDist = dist;
        }
      }
      frameIndex = best;
    }
    if (!Number.isFinite(frameIndex)) {
      frameIndex = 0;
    }
    return {
      phase,
      timestampMs,
      frameIndex,
      source: 'manual',
    };
  });
}

const server = createServer(async (req, res) => {
  const method = req.method || 'GET';
  const reqUrl = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html') {
    const html = readFileSync(join(__dirname, 'public', 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (reqUrl.pathname.startsWith('/api/') && !authorize(req)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  try {
    if (method === 'GET' && reqUrl.pathname === '/api/sessions') {
      const limit = Math.min(
        100,
        Number(reqUrl.searchParams.get('limit') || 40),
      );
      const { data, error } = await supabase
        .from('swing_sessions')
        .select(
          'id, created_at, duration_ms, status, capture_mode, phases, phases_verified, phases_verified_at, phases_verified_by, video_url',
        )
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) {
        sendJson(res, 500, { error: error.message });
        return;
      }
      sendJson(res, 200, { sessions: data ?? [] });
      return;
    }

    const sessionMatch = reqUrl.pathname.match(
      /^\/api\/sessions\/([^/]+)\/?$/,
    );
    if (method === 'GET' && sessionMatch) {
      const id = decodeURIComponent(sessionMatch[1]);
      const { data, error } = await supabase
        .from('swing_sessions')
        .select(
          'id, created_at, duration_ms, status, capture_mode, frames, phases, phases_verified, phases_verified_at, phases_verified_by, video_url, fps',
        )
        .eq('id', id)
        .maybeSingle();
      if (error) {
        sendJson(res, 500, { error: error.message });
        return;
      }
      if (!data) {
        sendJson(res, 404, { error: 'not found' });
        return;
      }
      sendJson(res, 200, { session: data });
      return;
    }

    const verifyMatch = reqUrl.pathname.match(
      /^\/api\/sessions\/([^/]+)\/verify$/,
    );
    if (method === 'POST' && verifyMatch) {
      const id = decodeURIComponent(verifyMatch[1]);
      const body = await readBody(req);
      const { data: existing, error: loadErr } = await supabase
        .from('swing_sessions')
        .select('id, frames, phases')
        .eq('id', id)
        .maybeSingle();
      if (loadErr || !existing) {
        sendJson(res, 404, { error: loadErr?.message || 'not found' });
        return;
      }
      const phasesVerified = normalizePhases(
        body.phases,
        existing.frames,
      );
      const now = new Date().toISOString();
      const { error: updErr } = await supabase
        .from('swing_sessions')
        .update({
          phases_verified: phasesVerified,
          phases_verified_at: now,
          phases_verified_by: String(body.verifiedBy || 'admin'),
        })
        .eq('id', id);
      if (updErr) {
        sendJson(res, 500, { error: updErr.message });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        phases_verified: phasesVerified,
        phases_verified_at: now,
      });
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    sendJson(res, 500, {
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[admin-phase-retag] http://127.0.0.1:${PORT}`);
});
