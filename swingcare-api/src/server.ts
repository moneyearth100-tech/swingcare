import express from 'express';
import type { Queue } from 'bullmq';

import { config } from './config.js';
import { mountCoachingRoutes } from './coachingRoutes.js';
import {
  enqueueAnalyzeSession,
  type AnalyzeJobData,
} from './queue.js';
import { fetchSession, listPendingOrStuckSessions } from './supabaseAdmin.js';

export function createServer(queue: Queue<AnalyzeJobData>) {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      redis: config.redisUrl,
      vision: config.visionExtractUrl,
      pendingPollMs: config.pendingPollMs,
    });
  });

  mountCoachingRoutes(app);

  /**
   * POST /sessions/:id/analyze — enqueue BullMQ job (master spec).
   * Idempotent via jobId analyze-{sessionId}.
   */
  app.post('/sessions/:id/analyze', async (req, res) => {
    const sessionId = req.params.id;
    try {
      const session = await fetchSession(sessionId);
      if (!session) {
        res.status(404).json({ ok: false, error: 'session_not_found' });
        return;
      }
      if (session.status === 'done') {
        res.json({ ok: true, skipped: true, reason: 'already_done' });
        return;
      }
      if (!session.video_url) {
        res.status(400).json({ ok: false, error: 'no_video_url' });
        return;
      }

      const jobId = await enqueueAnalyzeSession(queue, {
        sessionId,
        pendingSince: session.created_at,
      });
      res.json({ ok: true, jobId, sessionId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // BullMQ duplicate jobId throws — treat as already queued
      if (message.includes('Job is already') || message.includes('duplicate')) {
        res.json({ ok: true, skipped: true, reason: 'already_queued' });
        return;
      }
      console.error('[api] enqueue', message);
      res.status(500).json({ ok: false, error: message });
    }
  });

  return app;
}

/** Backup: enqueue orphan pending sessions (client enqueue missed). */
export function startPendingPoller(queue: Queue<AnalyzeJobData>): void {
  if (config.pendingPollMs <= 0) {
    return;
  }
  const tick = async () => {
    try {
      const rows = await listPendingOrStuckSessions(30);
      for (const row of rows) {
        try {
          await enqueueAnalyzeSession(queue, {
            sessionId: row.id,
            pendingSince: row.created_at,
          });
          console.log(`[poller] enqueued pending session=${row.id}`);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (
            message.includes('Job is already') ||
            message.includes('duplicate')
          ) {
            continue;
          }
          console.warn(`[poller] enqueue fail ${row.id}: ${message}`);
        }
      }
    } catch (error) {
      console.warn('[poller]', error);
    }
  };
  void tick();
  setInterval(() => void tick(), config.pendingPollMs);
}
