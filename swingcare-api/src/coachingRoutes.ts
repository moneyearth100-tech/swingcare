/**
 * 코칭 마켓 API — 클립 추출(draft) · 코치 지정 · pending 전송.
 */

import type { Express, Request, Response } from 'express';

import {
  extractAndUploadClip,
  resolveClipWindow,
  sanitizeDiagnosisSummary,
  type PhaseMarkerLike,
} from './coachingClip.js';
import { notifyCoachPendingEmail } from './coachingNotify.js';
import { getAdminClient } from './supabaseAdmin.js';

async function userFromBearer(req: Request): Promise<{ id: string } | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  const jwt = header.slice('Bearer '.length).trim();
  if (!jwt) {
    return null;
  }
  const { data, error } = await getAdminClient().auth.getUser(jwt);
  if (error || !data.user) {
    return null;
  }
  return { id: data.user.id };
}

function patternFromDrill(drillId: string | null): string | null {
  if (!drillId) {
    return null;
  }
  if (drillId.includes('towel') || drillId.includes('hip')) {
    return 'over_the_top';
  }
  if (drillId.includes('step') || drillId.includes('weight')) {
    return 'impact_weight_shift';
  }
  if (drillId.includes('wall') || drillId.includes('posture')) {
    return 'early_extension';
  }
  if (drillId.includes('tempo') || drillId.includes('smooth')) {
    return 'overall_good';
  }
  return null;
}

export function mountCoachingRoutes(app: Express): void {
  /**
   * POST /coaching/extract
   * body: { sessionId }
   * → draft coaching_request + ffmpeg clip (upload video only)
   */
  app.post('/coaching/extract', async (req: Request, res: Response) => {
    try {
      const user = await userFromBearer(req);
      if (!user) {
        res.status(401).json({ ok: false, error: 'unauthorized' });
        return;
      }
      const sessionId =
        typeof req.body?.sessionId === 'string' ? req.body.sessionId : null;
      if (!sessionId) {
        res.status(400).json({ ok: false, error: 'sessionId_required' });
        return;
      }

      const supabase = getAdminClient();
      const { data: session, error: sessionError } = await supabase
        .from('swing_sessions')
        .select(
          'id, user_id, video_url, capture_mode, duration_ms, phases, phases_verified, status',
        )
        .eq('id', sessionId)
        .maybeSingle();

      if (sessionError || !session) {
        res.status(404).json({ ok: false, error: 'session_not_found' });
        return;
      }
      if (session.user_id !== user.id) {
        res.status(403).json({ ok: false, error: 'forbidden' });
        return;
      }
      if (!session.video_url) {
        res.status(400).json({
          ok: false,
          error: 'no_video',
          message: '코칭용 스윙 영상이 필요해요. 영상을 첨부한 뒤 다시 시도해 주세요.',
        });
        return;
      }

      const { data: report } = await supabase
        .from('swing_reports')
        .select(
          'id, issue_phase, diagnosis_text, recommended_drill_id, overall_score',
        )
        .eq('session_id', sessionId)
        .maybeSingle();

      if (!report) {
        res.status(400).json({ ok: false, error: 'report_not_ready' });
        return;
      }

      const verified = Array.isArray(session.phases_verified)
        ? (session.phases_verified as PhaseMarkerLike[])
        : [];
      const auto = Array.isArray(session.phases)
        ? (session.phases as PhaseMarkerLike[])
        : [];
      const phases = verified.length > 0 ? verified : auto;
      const window = resolveClipWindow({
        phases,
        issuePhase: report.issue_phase,
        durationMs: Number(session.duration_ms) || 0,
      });

      const { data: requestRow, error: insertError } = await supabase
        .from('coaching_requests')
        .insert({
          user_id: user.id,
          coach_id: null,
          session_id: sessionId,
          report_id: report.id,
          clip_start_ms: window.startMs,
          clip_end_ms: window.endMs,
          issue_phase: report.issue_phase,
          diagnosis_pattern_id: patternFromDrill(report.recommended_drill_id),
          diagnosis_summary: sanitizeDiagnosisSummary(report.diagnosis_text),
          status: 'draft',
          price_krw: null,
        })
        .select('id')
        .single();

      if (insertError || !requestRow) {
        res.status(500).json({
          ok: false,
          error: insertError?.message ?? 'insert_failed',
        });
        return;
      }

      const uploaded = await extractAndUploadClip({
        userId: user.id,
        requestId: requestRow.id,
        videoUrl: session.video_url,
        startMs: window.startMs,
        endMs: window.endMs,
      });

      const { error: updError } = await supabase
        .from('coaching_requests')
        .update({
          clip_url: uploaded.clipUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', requestRow.id);

      if (updError) {
        res.status(500).json({ ok: false, error: updError.message });
        return;
      }

      res.json({
        ok: true,
        requestId: requestRow.id,
        clipUrl: uploaded.clipUrl,
        clipStartMs: window.startMs,
        clipEndMs: window.endMs,
        status: 'draft',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[coaching/extract]', message);
      res.status(500).json({ ok: false, error: message });
    }
  });

  /**
   * POST /coaching/requests/:id/assign
   * body: { coachId } — price snapshot, still draft
   */
  app.post(
    '/coaching/requests/:id/assign',
    async (req: Request, res: Response) => {
      try {
        const user = await userFromBearer(req);
        if (!user) {
          res.status(401).json({ ok: false, error: 'unauthorized' });
          return;
        }
        const requestId = req.params.id;
        const coachId =
          typeof req.body?.coachId === 'string' ? req.body.coachId : null;
        if (!coachId) {
          res.status(400).json({ ok: false, error: 'coachId_required' });
          return;
        }

        const supabase = getAdminClient();
        const { data: request, error: reqErr } = await supabase
          .from('coaching_requests')
          .select('id, user_id, status')
          .eq('id', requestId)
          .maybeSingle();
        if (reqErr || !request) {
          res.status(404).json({ ok: false, error: 'not_found' });
          return;
        }
        if (request.user_id !== user.id) {
          res.status(403).json({ ok: false, error: 'forbidden' });
          return;
        }
        if (request.status !== 'draft') {
          res.status(400).json({ ok: false, error: 'not_draft' });
          return;
        }

        const { data: coach, error: coachErr } = await supabase
          .from('coaches')
          .select('id, price_krw, is_active')
          .eq('id', coachId)
          .maybeSingle();
        if (coachErr || !coach || !coach.is_active) {
          res.status(404).json({ ok: false, error: 'coach_not_found' });
          return;
        }

        const { error: updErr } = await supabase
          .from('coaching_requests')
          .update({
            coach_id: coach.id,
            price_krw: coach.price_krw,
            updated_at: new Date().toISOString(),
          })
          .eq('id', requestId);

        if (updErr) {
          res.status(500).json({ ok: false, error: updErr.message });
          return;
        }
        res.json({
          ok: true,
          requestId,
          coachId: coach.id,
          priceKrw: coach.price_krw,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ ok: false, error: message });
      }
    },
  );

  /**
   * POST /coaching/requests/:id/send
   * draft → pending (requires coach + price + clip). Triggers email notify.
   */
  app.post(
    '/coaching/requests/:id/send',
    async (req: Request, res: Response) => {
      try {
        const user = await userFromBearer(req);
        if (!user) {
          res.status(401).json({ ok: false, error: 'unauthorized' });
          return;
        }
        const requestId = req.params.id;
        const supabase = getAdminClient();
        const { data: request, error: reqErr } = await supabase
          .from('coaching_requests')
          .select(
            'id, user_id, status, coach_id, price_krw, clip_url, issue_phase, diagnosis_summary',
          )
          .eq('id', requestId)
          .maybeSingle();
        if (reqErr || !request) {
          res.status(404).json({ ok: false, error: 'not_found' });
          return;
        }
        if (request.user_id !== user.id) {
          res.status(403).json({ ok: false, error: 'forbidden' });
          return;
        }
        if (request.status !== 'draft') {
          res.status(400).json({ ok: false, error: 'not_draft' });
          return;
        }
        if (!request.coach_id || request.price_krw == null || !request.clip_url) {
          res.status(400).json({
            ok: false,
            error: 'incomplete',
            message: '코치 선택과 클립이 필요합니다',
          });
          return;
        }

        const { error: updErr } = await supabase
          .from('coaching_requests')
          .update({
            status: 'pending',
            updated_at: new Date().toISOString(),
          })
          .eq('id', requestId);

        if (updErr) {
          res.status(500).json({ ok: false, error: updErr.message });
          return;
        }

        void notifyCoachPendingEmail(requestId).catch((e) =>
          console.warn('[coaching/send] notify', e),
        );

        res.json({ ok: true, requestId, status: 'pending' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ ok: false, error: message });
      }
    },
  );
}
