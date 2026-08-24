import 'dotenv/config';
import express from 'express';
import { createApiRouter } from './api.js';
import { resumeSavedSessions } from './sessionManager.js';

const REQUIRED = ['PORT', 'SERVICE_SECRET'];

function validateEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    console.error('[loomrun-whatsapp] Missing required env:', missing.join(', '));
    process.exit(1);
  }
}

let httpServer = null;

async function main() {
  validateEnv();

  const port = Number(process.env.PORT) || 8090;

  console.log('────────────────────────────────────────');
  console.log('  Loomrun WhatsApp Service (Baileys)');
  console.log(`  HTTP port: ${port}`);
  console.log('────────────────────────────────────────');

  const app = express();
  app.use(createApiRouter());

  httpServer = app.listen(port, '127.0.0.1', () => {
    console.log(`[loomrun-whatsapp] HTTP listening on 127.0.0.1:${port}`);
    void resumeSavedSessions();
  });

  const shutdown = async (signal) => {
    console.log(`[loomrun-whatsapp] ${signal} — shutting down`);
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[loomrun-whatsapp] Fatal:', err);
  process.exit(1);
});
