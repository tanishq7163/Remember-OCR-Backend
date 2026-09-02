import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { config } from './config';
import { ocrRouter } from './api/ocr.routes';
import { ensureDir } from './utils/temp';
import { logger } from './utils/logger';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec, swaggerUiOptions } from './api/swagger';

async function main(): Promise<void> {
  // Ensure storage directories exist on startup
  await ensureDir(config.storage.uploadDir);
  await ensureDir(config.storage.tempDir);

  const app = express();
  app.set('trust proxy', 1); // required on Render — reads X-Forwarded-Proto as the real protocol
  app.use(cors());
  app.use(express.json());

  // Health check — no auth required
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'remember-ocr' });
  });

  // Dev-only: generate a JWT for local testing without needing a full auth service
  app.get('/api/dev-token', (_req, res) => {
    if (config.isProduction) { 
      const token = jwt.sign( {userId: 'prod-user'}, config.auth.jwtSecret, {expiresIn: '7d'});
      res.json({token, userId: 'prod-user', expiresIn: '7d'});
    }
    const token = jwt.sign({ userId: 'dev-user' }, config.auth.jwtSecret, { expiresIn: '7d' });
    res.json({ token, userId: 'dev-user', expiresIn: '7d' });
  });

  // Swagger UI — inject the current host at request time so it works on any deployment
  


  app.use('/api-docs', swaggerUi.serve);
  app.get('/api-docs', (req, res, next) => {
    const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0].trim() ?? req.protocol;
    const host = req.get('host') ?? 'localhost:3001';
    const spec = { ...swaggerSpec, servers: [{ url: `${proto}://${host}` }] };
    swaggerUi.setup(spec, swaggerUiOptions)(req, res, next);
  });

  app.use('/api/memories', ocrRouter);

  // Catch-all 404
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  // Global error handler
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error.';
    logger.error('Unhandled error', { message });
    res.status(500).json({ error: message });
  });

  app.listen(config.port, () => {
    logger.info(`REMEMBER OCR service started`, {
      port: config.port,
      env: config.nodeEnv,
      provider: config.ocr.provider,
    });
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
