import express from 'express';
import path from 'node:path';
import {
  getSessionStatus,
  listSessions,
  sendDocument,
  sendImage,
  sendText,
  startSession,
  stopSession,
} from './sessionManager.js';

const MIME_MAP = {
  '.pdf':  'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls':  'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc':  'application/msword',
  '.csv':  'text/csv',
  '.txt':  'text/plain',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const SERVICE_SECRET = process.env.SERVICE_SECRET || '';
const startedAt = Date.now();

/** Status is polled every few seconds; don't redial a dead session on every poll. */
const AUTO_RESUME_COOLDOWN_MS = 15_000;
/** @type {Map<string, number>} connectorId -> last auto-resume timestamp */
const lastAutoResume = new Map();

function mayAutoResume(connectorId) {
  const last = lastAutoResume.get(connectorId) ?? 0;
  if (Date.now() - last < AUTO_RESUME_COOLDOWN_MS) return false;
  lastAutoResume.set(connectorId, Date.now());
  return true;
}

function requireSecret(req, res, next) {
  const secret = req.header('X-Service-Secret');
  if (!secret || secret !== SERVICE_SECRET) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }
  next();
}

export function createApiRouter() {
  const router = express.Router();
  router.use(express.json({ limit: '2mb' }));
  router.use(requireSecret);

  router.get('/health', (_req, res) => {
    const active = listSessions().filter((s) => s.connected).length;
    res.json({
      ok: true,
      connected: active > 0,
      active_sessions: active,
      total_sessions: listSessions().length,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
    });
  });

  router.post('/sessions/:connectorId/start', async (req, res) => {
    const connectorId = req.params.connectorId;
    // An explicit connect means "give me a scannable QR" — force past any stale
    // session or half-written auth state that would otherwise suppress one.
    const force = req.body?.force === true || req.query?.force === 'true';
    try {
      await startSession(connectorId, { force });
      lastAutoResume.set(connectorId, Date.now());
      res.json({ ok: true, connectorId, ...getSessionStatus(connectorId) });
    } catch (err) {
      console.error('[loomrun-whatsapp] start session', err);
      res.status(500).json({ ok: false, error: err.message || 'Start failed' });
    }
  });

  router.get('/sessions/:connectorId/status', async (req, res) => {
    const connectorId = req.params.connectorId;
    let status = getSessionStatus(connectorId);
    // Only revive a session that is actually dead — one already dialling or showing
    // a QR must be left alone, or polling would tear down the QR it just produced.
    if (status.state === 'disconnected' && mayAutoResume(connectorId)) {
      try {
        await startSession(connectorId);
        status = getSessionStatus(connectorId);
      } catch (err) {
        console.warn(`[loomrun-whatsapp] auto-resume ${connectorId}:`, err?.message ?? err);
      }
    }
    res.json({ ok: true, ...status });
  });

  router.delete('/sessions/:connectorId', async (req, res) => {
    await stopSession(req.params.connectorId);
    res.json({ ok: true });
  });

  router.post('/send', async (req, res) => {
    const connectorId = req.body?.org_id;
    const toPhone = req.body?.to_phone;
    const message = req.body?.message;
    if (!connectorId || !toPhone || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ ok: false, error: 'org_id, to_phone and message required' });
      return;
    }
    const result = await sendText(connectorId, toPhone, message);
    res.status(result.ok ? 200 : 503).json(result);
  });

  router.post('/send-document', async (req, res) => {
    const connectorId = req.body?.org_id;
    const toPhone = req.body?.to_phone;
    const filePath = req.body?.file_path;
    const fileName = req.body?.file_name;
    const mimetype = req.body?.mimetype;
    if (!connectorId || !toPhone || typeof filePath !== 'string' || !filePath.trim()) {
      res.status(400).json({ ok: false, error: 'org_id, to_phone and file_path required' });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const resolvedMime = mimetype || MIME_MAP[ext] || 'application/octet-stream';
    const resolvedName = fileName || path.basename(filePath);
    const result = await sendDocument(connectorId, toPhone, filePath, resolvedName, resolvedMime);
    res.status(result.ok ? 200 : 503).json(result);
  });

  router.post('/send-image', async (req, res) => {
    const connectorId = req.body?.org_id;
    const toPhone = req.body?.to_phone;
    const filePath = req.body?.file_path;
    const caption = typeof req.body?.caption === 'string' ? req.body.caption : '';
    const mimetype = req.body?.mimetype;
    if (!connectorId || !toPhone || typeof filePath !== 'string' || !filePath.trim()) {
      res.status(400).json({ ok: false, error: 'org_id, to_phone and file_path required' });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const resolvedMime = mimetype || MIME_MAP[ext] || 'image/jpeg';
    const result = await sendImage(connectorId, toPhone, filePath, resolvedMime, caption);
    res.status(result.ok ? 200 : 503).json(result);
  });

  return router;
}
