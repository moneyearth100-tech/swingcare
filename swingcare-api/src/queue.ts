import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { config } from './config.js';

export const ANALYZE_QUEUE_NAME = 'swing-analyze';

export type AnalyzeJobData = {
  sessionId: string;
  /** When the session became pending (ISO), for latency logs */
  pendingSince?: string | null;
};

let connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: null,
    });
  }
  return connection;
}

export function createAnalyzeQueue(): Queue<AnalyzeJobData> {
  return new Queue<AnalyzeJobData>(ANALYZE_QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: config.jobAttempts,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });
}

export async function enqueueAnalyzeSession(
  queue: Queue<AnalyzeJobData>,
  data: AnalyzeJobData,
): Promise<string> {
  const jobId = `analyze-${data.sessionId}`;
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (
      state === 'active' ||
      state === 'waiting' ||
      state === 'delayed' ||
      state === 'prioritized' ||
      state === 'waiting-children'
    ) {
      return existing.id ?? jobId;
    }
    // completed/failed/unknown — allow re-run for pending retries
    await existing.remove();
  }

  const job = await queue.add('analyze', data, { jobId });
  return job.id ?? jobId;
}
