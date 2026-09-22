import { app } from './app.js';
import { env, isProduction } from './config/env.js';
import { logger } from './utils/logger.js';
import { disconnectPrisma } from './config/prisma.js';

// No host argument: Node listens on every interface, which is what a host such
// as Render requires (0.0.0.0), and PORT comes from the environment it provides.
const server = app.listen(env.PORT, () => {
  logger.info(`Server listening on port ${env.PORT} (${env.NODE_ENV})`);
  if (!isProduction) {
    logger.info(`API base URL: http://localhost:${env.PORT}/api/v1`);
  }
  if (isProduction && env.CORS_ORIGIN === '*') {
    logger.warn(
      'CORS_ORIGIN is "*": any website may call this API. Set it to the frontend URLs, comma-separated.',
    );
  }
});

// Finish in-flight requests, then close the database connection.
async function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  server.close(async () => {
    await disconnectPrisma();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
