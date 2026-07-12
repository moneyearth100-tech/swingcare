/**
 * Enqueue server analysis for an uploaded swing session (BullMQ via swingcare-api).
 * Fire-and-forget — poller also picks orphan `pending` rows if this fails.
 */

const DEFAULT_ANALYZE_BASE = '';

function analyzeBaseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_ANALYZE_API_URL ?? DEFAULT_ANALYZE_BASE;
  return raw.replace(/\/$/, '');
}

export async function enqueueSessionAnalyze(
  sessionId: string,
): Promise<{ ok: boolean; skipped?: boolean; message?: string }> {
  const base = analyzeBaseUrl();
  if (!base) {
    console.warn(
      '[enqueueSessionAnalyze] EXPO_PUBLIC_ANALYZE_API_URL unset — rely on API poller',
    );
    return { ok: false, message: 'ANALYZE_API_URL unset' };
  }

  try {
    const response = await fetch(`${base}/sessions/${sessionId}/analyze`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    const json = (await response.json().catch(() => null)) as {
      ok?: boolean;
      skipped?: boolean;
      error?: string;
    } | null;
    if (!response.ok || !json?.ok) {
      const message = json?.error ?? `HTTP ${response.status}`;
      console.warn('[enqueueSessionAnalyze]', message);
      return { ok: false, message };
    }
    return { ok: true, skipped: json.skipped };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[enqueueSessionAnalyze] network', message);
    return { ok: false, message };
  }
}
