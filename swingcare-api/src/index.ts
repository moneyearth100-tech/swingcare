import { assertWorkerEnv, config } from './config.js';
import { createAnalyzeQueue } from './queue.js';
import { createServer, startPendingPoller } from './server.js';
import { startReportGeneratorWorker } from './workers/reportGeneratorWorker.js';

async function main() {
  assertWorkerEnv();
  const queue = createAnalyzeQueue();
  const worker = startReportGeneratorWorker();
  const app = createServer(queue);

  startPendingPoller(queue);

  app.listen(config.port, () => {
    console.log(
      `[swingcare-api] listening :${config.port} vision=${config.visionExtractUrl}`,
    );
  });

  const shutdown = async () => {
    console.log('[swingcare-api] shutting down…');
    await worker.close();
    await queue.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  console.error('[swingcare-api] fatal', error);
  process.exit(1);
});
