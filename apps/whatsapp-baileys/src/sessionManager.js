import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_ROOT = path.join(__dirname, '..', 'auth_info');

const BAILEYS_LOG_LEVEL = process.env.BAILEYS_LOG_LEVEL ?? 'silent';
const logger = pino({ level: BAILEYS_LOG_LEVEL });

/**
 * @typedef {Object} SessionEntry
 * @property {string} connectorId
 * @property {import('@whiskeysockets/baileys').WASocket|null} sock
 * @property {boolean} connected
 * @property {string|null} qr        QR rendered as a PNG data URL, or null
 * @property {string|null} ownerJid  full account JID once linked
 * @property {number} reconnectAttempts
 * @property {string|null} lastError  last connect failure, surfaced to the API
 * @property {Promise<SessionEntry>|null} starting  in-flight connect, dedupes concurrent starts
 */

/** @type {Map<string, SessionEntry>} */
const sessions = new Map();

function authDir(connectorId) {
  const safe = connectorId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(AUTH_ROOT, safe);
}

/** Give up dialling after this many consecutive failures and let the next start rebuild. */
const MAX_RECONNECT_ATTEMPTS = 10;

/** Re-check the WhatsApp Web version at most this often. */
const VERSION_TTL_MS = 60 * 60 * 1000;

/** @type {{version: number[]|null, fetchedAt: number}} */
const waVersion = { version: null, fetchedAt: 0 };

/**
 * Resolve the WhatsApp Web protocol version to hand Baileys.
 *
 * The version bundled with the library goes stale, and WhatsApp then rejects the
 * handshake with 405 "Connection Failure" *before* issuing a QR — so the connector
 * would sit there with no QR forever. Fetching the current version avoids that.
 * Falls back to the bundled default if the lookup fails, so a network blip during
 * startup can't take the sidecar down.
 */
async function resolveWaVersion() {
  const fresh = Date.now() - waVersion.fetchedAt < VERSION_TTL_MS;
  if (waVersion.version && fresh) return waVersion.version;
  try {
    const { version } = await fetchLatestBaileysVersion();
    waVersion.version = version;
    waVersion.fetchedAt = Date.now();
    console.log(`[loomrun-whatsapp] WhatsApp Web version ${version.join('.')}`);
  } catch (err) {
    console.warn(
      '[loomrun-whatsapp] version lookup failed, using bundled default:',
      err?.message ?? err,
    );
  }
  return waVersion.version ?? undefined;
}

function backoffMs(attempt) {
  return Math.min(30_000, 1000 * 2 ** attempt);
}

/** True while the underlying websocket is usable — a dead sock object is still truthy. */
function isSocketAlive(entry) {
  const ws = entry?.sock?.ws;
  return !!ws && (ws.isOpen || ws.isConnecting);
}

/** A session is worth reusing only if it is linked, dialling, or already showing a QR. */
function isSessionUsable(entry) {
  if (!entry) return false;
  return entry.connected || isSocketAlive(entry) || !!entry.qr;
}

/** Close a session's socket without touching its auth state on disk. */
function teardown(entry) {
  if (!entry?.sock) return;
  try {
    entry.sock.ev.removeAllListeners('connection.update');
    entry.sock.ev.removeAllListeners('creds.update');
  } catch {
    // ignore
  }
  try {
    entry.sock.end(undefined);
  } catch {
    // ignore
  }
  entry.sock = null;
}

/** Auth dirs are only worth resuming once a pairing has actually written creds. */
function hasSavedCreds(dir) {
  try {
    return fs.statSync(path.join(dir, 'creds.json')).size > 0;
  } catch {
    return false;
  }
}

/** Strip device suffix and domain → bare phone for display: "919...:12@s.whatsapp.net" -> "919...". */
function phoneFromJid(jid) {
  if (!jid) return null;
  const local = jid.split('@')[0].split(':')[0];
  return /^\d+$/.test(local) ? local : null;
}

/** Strip non-digits; prepend India country code when a bare 10-digit number is given. */
export function normalizePhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) digits = `91${digits}`;
  return digits;
}

export function getSession(connectorId) {
  return sessions.get(connectorId) ?? null;
}

export function listSessions() {
  return [...sessions.values()].map((s) => ({
    connectorId: s.connectorId,
    connected: s.connected,
    ownerJid: s.ownerJid,
  }));
}

export function isSessionConnected(connectorId) {
  return sessions.get(connectorId)?.connected === true;
}

/** Reconnect Baileys for every connector that still has saved auth on disk. */
export async function resumeSavedSessions() {
  if (!fs.existsSync(AUTH_ROOT)) return;
  const dirs = fs.readdirSync(AUTH_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const dirent of dirs) {
    const connectorId = dirent.name;
    const dir = authDir(connectorId);
    // A dir with no creds is a connect attempt that was never scanned. Resuming it
    // would register a phantom session that then blocks fresh QRs for that org.
    if (!hasSavedCreds(dir)) {
      console.log(`[loomrun-whatsapp] discarding unpaired auth dir ${connectorId}`);
      fs.rmSync(dir, { recursive: true, force: true });
      continue;
    }
    try {
      await startSession(connectorId);
      console.log(`[loomrun-whatsapp] resuming saved session ${connectorId}…`);
    } catch (err) {
      console.warn(
        `[loomrun-whatsapp] resume failed ${connectorId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/**
 * Start (or resume) a connector's Baileys session.
 *
 * Status polling calls this every few seconds, so it must be cheap and idempotent
 * for a healthy session — but it must also rebuild one whose socket has died, or
 * the connector is stuck with no QR forever.
 *
 * @param {string} connectorId
 * @param {{force?: boolean}} [options] force wipes saved auth to force a fresh QR
 */
export async function startSession(connectorId, options = {}) {
  const { force = false } = options;
  const existing = sessions.get(connectorId);

  if (existing) {
    // A live session is never torn down by a plain start — only an explicit force.
    if (!force && isSessionUsable(existing)) return existing;
    if (force && existing.connected) return existing;
    // Another start is already dialling; join it instead of racing a second socket.
    if (!force && existing.starting) return existing.starting;
    teardown(existing);
    sessions.delete(connectorId);
  }

  const dir = authDir(connectorId);
  if (force) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });

  const entry = {
    connectorId,
    sock: null,
    connected: false,
    qr: null,
    ownerJid: null,
    reconnectAttempts: 0,
    lastError: null,
    starting: null,
  };
  sessions.set(connectorId, entry);

  const { state, saveCreds } = await useMultiFileAuthState(dir);

  /** Retry a failed dial. Without this a single throw would end the loop for good. */
  const scheduleReconnect = () => {
    entry.reconnectAttempts += 1;
    if (entry.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[loomrun-whatsapp] giving up on ${connectorId} after ${MAX_RECONNECT_ATTEMPTS} attempts`,
      );
      // Drop the dead socket so the next start/status rebuilds from scratch.
      teardown(entry);
      return;
    }
    const delay = backoffMs(entry.reconnectAttempts - 1);
    setTimeout(() => {
      connect().catch((err) => {
        entry.lastError = err?.message ?? String(err);
        console.warn(`[loomrun-whatsapp] reconnect failed ${connectorId}:`, entry.lastError);
        scheduleReconnect();
      });
    }, delay);
  };

  const connect = async () => {
    teardown(entry);

    entry.sock = makeWASocket({
      version: await resolveWaVersion(),
      browser: Browsers.ubuntu('Chrome'),
      auth: state,
      logger,
      printQRInTerminal: false,
    });

    entry.sock.ev.on('creds.update', saveCreds);

    entry.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          entry.qr = await QRCode.toDataURL(qr);
          entry.lastError = null;
          // QRs only arrive while the handshake is healthy, so stop counting failures.
          entry.reconnectAttempts = 0;
        } catch (err) {
          console.warn(`[loomrun-whatsapp] QR render failed ${connectorId}:`, err?.message ?? err);
        }
        console.log(`[loomrun-whatsapp] QR ready for ${connectorId}`);
        if (process.env.NODE_ENV !== 'production') {
          qrcodeTerminal.generate(qr, { small: true });
        }
      }

      if (connection === 'open') {
        entry.connected = true;
        entry.qr = null;
        entry.lastError = null;
        entry.reconnectAttempts = 0;
        entry.ownerJid = entry.sock?.user?.id ?? null;
        console.log(
          `[loomrun-whatsapp] connected ${connectorId} owner=${entry.ownerJid} phone=${phoneFromJid(entry.ownerJid) ?? 'n/a'}`,
        );
      }

      if (connection === 'close') {
        entry.connected = false;
        // A stale QR outlives the socket it belongs to and can never be scanned.
        entry.qr = null;
        const statusCode =
          lastDisconnect?.error?.output?.statusCode ?? DisconnectReason.unknown;
        entry.lastError = lastDisconnect?.error?.message ?? `closed (${statusCode})`;

        if (statusCode === DisconnectReason.loggedOut) {
          console.error(`[loomrun-whatsapp] logged out ${connectorId} — wiping auth`);
          teardown(entry);
          fs.rmSync(dir, { recursive: true, force: true });
          sessions.delete(connectorId);
          return;
        }

        scheduleReconnect();
      }
    });
  };

  entry.starting = connect()
    .then(() => entry)
    .catch((err) => {
      entry.lastError = err?.message ?? String(err);
      console.warn(`[loomrun-whatsapp] connect failed ${connectorId}:`, entry.lastError);
      scheduleReconnect();
      return entry;
    })
    .finally(() => {
      entry.starting = null;
    });

  return entry.starting;
}

export async function stopSession(connectorId) {
  const entry = sessions.get(connectorId);
  if (entry?.sock) {
    try {
      await entry.sock.logout();
    } catch {
      try {
        entry.sock.end(undefined);
      } catch {
        // ignore
      }
    }
  }
  sessions.delete(connectorId);
  const dir = authDir(connectorId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function getSessionStatus(connectorId) {
  const entry = sessions.get(connectorId);
  if (!entry) {
    return { connected: false, qr: null, phone_number: null, owner_jid: null, state: 'disconnected', error: null };
  }
  let state = 'disconnected';
  if (entry.connected) state = 'connected';
  else if (entry.qr) state = 'awaiting_scan';
  else if (isSocketAlive(entry) || entry.starting) state = 'connecting';
  return {
    connected: entry.connected,
    qr: entry.qr,
    phone_number: phoneFromJid(entry.ownerJid),
    owner_jid: entry.ownerJid,
    state,
    error: entry.lastError,
  };
}

/** Resolve a lead's phone to a WhatsApp JID, verifying the number is registered. */
async function resolveRecipientJid(sock, toPhone) {
  const digits = normalizePhone(toPhone);
  if (digits.length < 10) {
    return { error: `Invalid phone number: ${toPhone}` };
  }
  const candidate = `${digits}@s.whatsapp.net`;
  try {
    const results = await sock.onWhatsApp(candidate);
    const hit = Array.isArray(results) ? results.find((r) => r?.exists) : null;
    if (hit?.jid) return { jid: hit.jid };
    return { error: `${digits} is not on WhatsApp` };
  } catch {
    // If the existence check itself fails, fall back to the constructed JID.
    return { jid: candidate };
  }
}

/** Wait for a live linked session — sends often land during a reconnect flap. */
async function ensureConnected(connectorId, timeoutMs = 12_000) {
  let entry = sessions.get(connectorId);
  if (entry?.connected && entry.sock && isSocketAlive(entry)) return entry;

  try {
    await startSession(connectorId);
  } catch (err) {
    console.warn(`[loomrun-whatsapp] ensureConnected start ${connectorId}:`, err?.message ?? err);
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    entry = sessions.get(connectorId);
    if (entry?.connected && entry.sock && isSocketAlive(entry)) return entry;
    await new Promise((r) => setTimeout(r, 400));
  }
  return sessions.get(connectorId) ?? null;
}

function markSendFailure(entry, error) {
  if (!entry) return;
  entry.lastError = error;
  const lower = String(error || '').toLowerCase();
  if (lower.includes('connection closed') || lower.includes('conflict') || lower.includes('timed out')) {
    entry.connected = false;
  }
}

export async function sendText(connectorId, toPhone, text) {
  let entry = await ensureConnected(connectorId);
  if (!entry?.connected || !entry.sock) {
    const hint = entry?.lastError ? ` (${entry.lastError})` : '';
    return { ok: false, error: `WhatsApp not connected${hint}` };
  }
  const resolved = await resolveRecipientJid(entry.sock, toPhone);
  if (resolved.error) return { ok: false, error: resolved.error };
  try {
    const sent = await entry.sock.sendMessage(resolved.jid, { text });
    console.log(`[loomrun-whatsapp] sent text connector=${connectorId} to=${resolved.jid}`);
    return { ok: true, timestamp: new Date().toISOString(), jid: resolved.jid, message_id: sent?.key?.id ?? null };
  } catch (err) {
    const error = err?.message || 'Send failed';
    console.warn(`[loomrun-whatsapp] send text failed connector=${connectorId} to=${resolved.jid}:`, error);
    markSendFailure(entry, error);

    // One retry after a reconnect — Connection Closed usually means the sock just died.
    entry = await ensureConnected(connectorId);
    if (!entry?.connected || !entry.sock) {
      return { ok: false, error };
    }
    try {
      const sent = await entry.sock.sendMessage(resolved.jid, { text });
      console.log(`[loomrun-whatsapp] sent text (retry) connector=${connectorId} to=${resolved.jid}`);
      return { ok: true, timestamp: new Date().toISOString(), jid: resolved.jid, message_id: sent?.key?.id ?? null };
    } catch (retryErr) {
      const retryError = retryErr?.message || error;
      markSendFailure(entry, retryError);
      console.warn(`[loomrun-whatsapp] send text retry failed connector=${connectorId}:`, retryError);
      return { ok: false, error: retryError };
    }
  }
}

export async function sendDocument(connectorId, toPhone, filePath, fileName, mimetype) {
  let entry = await ensureConnected(connectorId);
  if (!entry?.connected || !entry.sock) {
    const hint = entry?.lastError ? ` (${entry.lastError})` : '';
    return { ok: false, error: `WhatsApp not connected${hint}` };
  }
  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err) {
    return { ok: false, error: `Cannot read file: ${err.message}` };
  }
  const resolved = await resolveRecipientJid(entry.sock, toPhone);
  if (resolved.error) return { ok: false, error: resolved.error };
  try {
    const sent = await entry.sock.sendMessage(resolved.jid, {
      document: buffer,
      mimetype,
      fileName,
    });
    console.log(`[loomrun-whatsapp] sent document connector=${connectorId} to=${resolved.jid} file=${fileName}`);
    return { ok: true, timestamp: new Date().toISOString(), jid: resolved.jid, message_id: sent?.key?.id ?? null };
  } catch (err) {
    const error = err?.message || 'Send failed';
    console.warn(`[loomrun-whatsapp] send document failed connector=${connectorId} to=${resolved.jid}:`, error);
    markSendFailure(entry, error);

    entry = await ensureConnected(connectorId);
    if (!entry?.connected || !entry.sock) {
      return { ok: false, error };
    }
    try {
      const sent = await entry.sock.sendMessage(resolved.jid, {
        document: buffer,
        mimetype,
        fileName,
      });
      console.log(`[loomrun-whatsapp] sent document (retry) connector=${connectorId} to=${resolved.jid} file=${fileName}`);
      return { ok: true, timestamp: new Date().toISOString(), jid: resolved.jid, message_id: sent?.key?.id ?? null };
    } catch (retryErr) {
      const retryError = retryErr?.message || error;
      markSendFailure(entry, retryError);
      console.warn(`[loomrun-whatsapp] send document retry failed connector=${connectorId}:`, retryError);
      return { ok: false, error: retryError };
    }
  }
}

export async function sendImage(connectorId, toPhone, filePath, mimetype = 'image/jpeg', caption = '') {
  let entry = await ensureConnected(connectorId);
  if (!entry?.connected || !entry.sock) {
    const hint = entry?.lastError ? ` (${entry.lastError})` : '';
    return { ok: false, error: `WhatsApp not connected${hint}` };
  }
  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err) {
    return { ok: false, error: `Cannot read file: ${err.message}` };
  }
  const resolved = await resolveRecipientJid(entry.sock, toPhone);
  if (resolved.error) return { ok: false, error: resolved.error };
  const payload = {
    image: buffer,
    mimetype,
  };
  if (caption && String(caption).trim()) {
    payload.caption = String(caption).trim();
  }
  try {
    const sent = await entry.sock.sendMessage(resolved.jid, payload);
    console.log(`[loomrun-whatsapp] sent image connector=${connectorId} to=${resolved.jid}`);
    return { ok: true, timestamp: new Date().toISOString(), jid: resolved.jid, message_id: sent?.key?.id ?? null };
  } catch (err) {
    const error = err?.message || 'Send failed';
    console.warn(`[loomrun-whatsapp] send image failed connector=${connectorId} to=${resolved.jid}:`, error);
    markSendFailure(entry, error);

    entry = await ensureConnected(connectorId);
    if (!entry?.connected || !entry.sock) {
      return { ok: false, error };
    }
    try {
      const sent = await entry.sock.sendMessage(resolved.jid, payload);
      console.log(`[loomrun-whatsapp] sent image (retry) connector=${connectorId} to=${resolved.jid}`);
      return { ok: true, timestamp: new Date().toISOString(), jid: resolved.jid, message_id: sent?.key?.id ?? null };
    } catch (retryErr) {
      const retryError = retryErr?.message || error;
      markSendFailure(entry, retryError);
      console.warn(`[loomrun-whatsapp] send image retry failed connector=${connectorId}:`, retryError);
      return { ok: false, error: retryError };
    }
  }
}
