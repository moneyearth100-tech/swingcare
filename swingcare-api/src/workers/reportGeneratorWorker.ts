import { Worker } from 'bullmq';

import {
  analyzeUploadSession,
  markSessionAnalysisError,
} from '../analyzeSession.js';
import {
  ANALYZE_QUEUE_NAME,
  getRedisConnection,
  type AnalyzeJobData,
} from '../queue.js';

export function startReportGeneratorWorker(): Worker<AnalyzeJobData> {
  const worker = new Worker<AnalyzeJobData>(
    ANALYZE_QUEUE_NAME,
    async (job) => {
      console.log(
        `[worker] job=${job.id} attempt=${job.attemptsMade + 1}/${job.opts.attempts ?? 1} session=${job.data.sessionId}`,
      );
      await analyzeUploadSession(job.data);
    },
    {
      connection: getRedisConnection(),
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    const attempts = job?.opts.attempts ?? 1;
    const made = job?.attemptsMade ?? 0;
    const sessionId = job?.data.sessionId;
    console.error(
      `[worker] failed job=${job?.id} session=${sessionId} attempt=${made}/${attempts}: ${err.message}`,
    );
    if (sessionId && made >= attempts) {
      void markSessionAnalysisError(sessionId, err.message).catch((e) => {
        console.error('[worker] mark error status failed', e);
      });
    }
  });

  worker.on('completed', (job) => {
    console.log(`[worker] completed job=${job.id} session=${job.data.sessionId}`);
  });

  return worker;
}
