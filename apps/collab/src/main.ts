import { loadCollabConfig } from './config';
import { createLogger } from './logger';
import { createCollabServer } from './server';

async function main(): Promise<void> {
  const config = loadCollabConfig();
  const logger = createLogger(
    config.INSTANCE_NAME,
    config.NODE_ENV === 'production' ? 'info' : 'debug',
  );
  const collab = createCollabServer(config, { logger });
  await collab.listen();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });
    try {
      await collab.destroy();
      process.exit(0);
    } catch (err) {
      logger.error('error during shutdown', { error: (err as Error).message });
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
