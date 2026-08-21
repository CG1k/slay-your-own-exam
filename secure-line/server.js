import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, normalize, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getThread,
  createThread,
  addMessage,
  listMessages,
  wipeMessages,
  destroyThread,
  threadExpired,
  purgeOldMessages,
} from './lib/store.js';
import {
  hashSecret,
  verifySecret,
  matchesOwnerPasscode,
  createSession,
  readSession,
  destroySession,
  destroyAllSessions,
  tooManyAttempts,
  clearAttempts,
} from './lib/auth.js';
import {
  sendVia,
  listChannels,
  anyChannelReady,
  NOTICE_PRESETS,
  renderNotice,
} from './lib/sms.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = resolve(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);

const OWNER_TTL = 8 * 60 * 60_000; // 8 hours
const GUEST_TTL = 12 * 60 * 60_000; // 12 hours, refreshed on use

/* ------------------------------- utilities ------------------------------- */

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isSecureRequest(req) {
  return (
    req.headers['x-forwarded-proto'] === 'https' ||
    Boolean(req.socket.encrypted) ||
    process.env.FORCE_SECURE_COOKIES === '1'
  );
}

function setCookie(req, res, name, value, maxAgeSeconds) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isSecureRequest(req)) bits.push('Secure');
  const existing = res.getHeader('Set-Cookie');
  const list = existing ? [].concat(existing) : [];
  list.push(bits.join('; '));
  res.setHeader('Set-Cookie', list);
}

function clearCookie(req, res, name) {
  setCookie(req, res, name, '', 0);
}

function baseHeaders(res) {
  // Nothing here should ever be cached, indexed, framed, or leaked in a referer.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'self'; form-action 'self'; " +
      "frame-ancestors 'none'; base-uri 'none'",
  );
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req, limit = 64 * 1024) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolvePromise({});
      try {
        resolvePromise(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

async function serveStatic(res, relPath) {
  const safe = normalize(relPath).replace(/^(\.\.[/\\])+/, '');
  const full = join(PUBLIC_DIR, safe);
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const buf = await readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[extname(full)] || 'application/octet-stream',
      'Content-Length': buf.length,
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

function publicUrl(req) {
  const configured = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  if (configured) return configured;
  const proto = isSecureRequest(req) ? 'https' : 'http';
  return `${proto}://${req.headers.host}`;
}

function clientKey(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

function tokenIsValid(token) {
  const t = getThread();
  return Boolean(t && !threadExpired(t) && token && token === t.token);
}

/** Answers are matched case-insensitively and ignoring surrounding spaces, so
    CHASE, chase, and " Chase " all get her in. */
const normalizeAnswer = (value) => String(value ?? '').trim().toLowerCase();

const DEFAULT_PROVIDER = 'Dr. Gordon';

/** Wording follows the provider's name, so the question reads naturally
    whatever the operator calls them. */
const questionFor = (provider) => `What is ${provider || DEFAULT_PROVIDER}'s first name?`;

const DEFAULT_QUESTION = questionFor(DEFAULT_PROVIDER);

// Shown once she is through the sign-in. Reads as a provider's note; the words
// are the operator's own.
const DEFAULT_NOTICE_TITLE = 'Important';
const DEFAULT_NOTICE_BODY = [
  'Your safety, your comfort and health is my number one priority.',
  'We will get there together at the pace you need.',
].join('\n');

/* ----------------------------- live updates ------------------------------ */

const streams = new Set();

function broadcast(event, payload) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of streams) {
    try {
      client.res.write(frame);
    } catch {
      streams.delete(client);
    }
  }
}

function openStream(req, res) {
  baseHeaders(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    Connection: 'keep-alive',
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ messages: listMessages() })}\n\n`);

  const client = { res };
  streams.add(client);

  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* handled on close */
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(ping);
    streams.delete(client);
  });
}

/* ------------------------------- handlers -------------------------------- */

const requireOwner = (req) => readSession(parseCookies(req).sl_owner, 'owner');
const requireGuest = (req) => readSession(parseCookies(req).sl_guest, 'guest');

async function handleApi(req, res, url) {
  const path = url.pathname;
  const method = req.method;

  /* ------------------------------- owner -------------------------------- */

  if (path === '/api/owner/login' && method === 'POST') {
    const body = await readBody(req);
    const key = `owner:${clientKey(req)}`;
    if (tooManyAttempts(key, 10)) {
      return sendJson(res, 429, { error: 'Too many attempts. Wait 15 minutes.' });
    }
    if (!matchesOwnerPasscode(body.passcode || '')) {
      return sendJson(res, 401, { error: 'Wrong passcode.' });
    }
    clearAttempts(key);
    setCookie(req, res, 'sl_owner', createSession('owner', OWNER_TTL), OWNER_TTL / 1000);
    return sendJson(res, 200, { ok: true });
  }

  if (path === '/api/owner/logout' && method === 'POST') {
    destroySession(parseCookies(req).sl_owner);
    clearCookie(req, res, 'sl_owner');
    return sendJson(res, 200, { ok: true });
  }

  if (path.startsWith('/api/owner/') && !requireOwner(req)) {
    return sendJson(res, 401, { error: 'Not signed in.' });
  }

  if (path === '/api/owner/state' && method === 'GET') {
    const t = getThread();
    return sendJson(res, 200, {
      smsConfigured: anyChannelReady(),
      channels: listChannels(),
      presets: NOTICE_PRESETS,
      thread: t
        ? {
            clinicName: t.clinicName,
            pageTitle: t.pageTitle,
            displayName: t.displayName,
            providerName: t.providerName,
            securityQuestion: t.securityQuestion,
            answerRequired: Boolean(t.answerHash),
            noticeTitle: t.noticeTitle,
            noticeBody: t.noticeBody,
            purgeAfterMinutes: t.purgeAfterMinutes,
            expiresAt: t.expiresAt,
            expired: threadExpired(t),
            link: `${publicUrl(req)}/c/${t.token}`,
            messageCount: t.messages.length,
          }
        : null,
    });
  }

  if (path === '/api/owner/thread' && method === 'POST') {
    const body = await readBody(req);

    const pageTitle = String(body.pageTitle || '').trim();
    const displayName = String(body.displayName || '').trim();
    if (!pageTitle) return sendJson(res, 400, { error: 'Give the page a title.' });
    if (!displayName) return sendJson(res, 400, { error: 'Set the name she is greeted by.' });

    const answer = normalizeAnswer(body.answer);
    const answerFields = answer ? hashSecret(answer) : { salt: null, hash: null };
    const provider = String(body.providerName || DEFAULT_PROVIDER).slice(0, 60);

    const days = Math.min(Math.max(Number(body.expiresDays) || 30, 1), 365);
    const purge = Math.min(Math.max(Number(body.purgeAfterMinutes) || 0, 0), 60 * 24 * 30);

    createThread({
      clinicName: String(body.clinicName || 'Chase Your Health').slice(0, 80),
      pageTitle: pageTitle.slice(0, 90),
      displayName: displayName.slice(0, 60),
      providerName: provider,
      securityQuestion: String(body.securityQuestion || questionFor(provider)).slice(0, 120),
      noticeTitle: String(body.noticeTitle ?? DEFAULT_NOTICE_TITLE).slice(0, 80),
      noticeBody: String(body.noticeBody ?? DEFAULT_NOTICE_BODY).slice(0, 1200),
      purgeAfterMinutes: purge,
      expiresAt: Date.now() + days * 86_400_000,
      answerSalt: answerFields.salt,
      answerHash: answerFields.hash,
    });

    // A new link kills the old one and every session opened with it.
    destroyAllSessions('guest');
    broadcast('reset', {});

    return sendJson(res, 200, { ok: true });
  }

  if (path === '/api/owner/notify' && method === 'POST') {
    const body = await readBody(req);
    const t = getThread();
    if (!t) return sendJson(res, 400, { error: 'Create the portal first.' });

    const link = `${publicUrl(req)}/c/${t.token}`;
    const text = renderNotice(String(body.body || '{{link}}'), {
      link,
      name: t.displayName,
      clinic: t.clinicName,
    });
    const to = String(body.to || '').trim();
    const channel = String(body.channel || 'manual');

    // Preview, or an explicit choice to send it yourself: nothing goes out.
    if (!body.send || channel === 'manual') {
      return sendJson(res, 200, { ok: true, preview: text, link, sent: false, manual: true });
    }
    if (!/^\+[1-9]\d{6,15}$/.test(to)) {
      return sendJson(res, 400, { error: 'Enter the number in +15551234567 format.' });
    }

    const result = await sendVia(channel, to, text);
    if (!result.ok) return sendJson(res, 502, { error: result.detail, preview: text, link });
    return sendJson(res, 200, { ok: true, preview: text, link, sent: true });
  }

  if (path === '/api/owner/message' && method === 'POST') {
    const body = await readBody(req);
    const text = String(body.text || '').trim();
    if (!text) return sendJson(res, 400, { error: 'Empty message.' });
    if (!getThread()) return sendJson(res, 400, { error: 'No active portal.' });
    broadcast('message', addMessage('owner', text.slice(0, 4000)));
    return sendJson(res, 200, { ok: true });
  }

  if (path === '/api/owner/wipe' && method === 'POST') {
    const body = await readBody(req);
    if (body.everything) {
      destroyThread();
      destroyAllSessions('guest');
      broadcast('reset', {});
    } else {
      wipeMessages();
      broadcast('wiped', {});
    }
    return sendJson(res, 200, { ok: true });
  }

  if (path === '/api/owner/stream' && method === 'GET') return openStream(req, res);

  /* ------------------------------- guest -------------------------------- */

  // The question shown on the sign-in card. A wrong token gets the default
  // wording rather than an error, so a snooper learns nothing from it.
  if (path === '/api/guest/question' && method === 'GET') {
    const t = getThread();
    const token = url.searchParams.get('token') || '';
    return sendJson(res, 200, {
      question: tokenIsValid(token) ? t.securityQuestion || DEFAULT_QUESTION : DEFAULT_QUESTION,
    });
  }

  if (path === '/api/guest/unlock' && method === 'POST') {
    const body = await readBody(req);
    const t = getThread();
    const key = `guest:${clientKey(req)}`;

    if (tooManyAttempts(key, 12)) {
      return sendJson(res, 429, { error: 'Too many tries. Try again later.' });
    }
    if (!tokenIsValid(body.token)) return sendJson(res, 401, { error: 'Sign-in failed.' });

    // No answer configured means the link alone is the credential.
    const passes =
      !t.answerHash || verifySecret(normalizeAnswer(body.answer), t.answerSalt, t.answerHash);
    if (!passes) return sendJson(res, 401, { error: 'Sign-in failed.' });

    clearAttempts(key);
    setCookie(req, res, 'sl_guest', createSession('guest', GUEST_TTL), GUEST_TTL / 1000);
    return sendJson(res, 200, { ok: true });
  }

  if (path === '/api/guest/lock' && method === 'POST') {
    destroySession(parseCookies(req).sl_guest);
    clearCookie(req, res, 'sl_guest');
    return sendJson(res, 200, { ok: true });
  }

  if (path.startsWith('/api/guest/') && !requireGuest(req)) {
    return sendJson(res, 401, { error: 'locked' });
  }

  if (path === '/api/guest/portal' && method === 'GET') {
    const t = getThread();
    if (!t) return sendJson(res, 401, { error: 'locked' });
    return sendJson(res, 200, {
      clinicName: t.clinicName,
      pageTitle: t.pageTitle,
      displayName: t.displayName,
      providerName: t.providerName,
      noticeTitle: t.noticeTitle,
      noticeBody: t.noticeBody,
    });
  }

  if (path === '/api/guest/message' && method === 'POST') {
    const body = await readBody(req);
    const text = String(body.text || '').trim();
    if (!text) return sendJson(res, 400, { error: 'Empty message.' });
    if (!getThread()) return sendJson(res, 400, { error: 'No active portal.' });
    broadcast('message', addMessage('guest', text.slice(0, 4000)));
    return sendJson(res, 200, { ok: true });
  }

  // The appointment form is part of the portal's cover, but a real request
  // still reaches you — it is another way for her to get a word out.
  if (path === '/api/guest/appointment' && method === 'POST') {
    const body = await readBody(req);
    if (!getThread()) return sendJson(res, 400, { error: 'No active portal.' });
    const when = String(body.when || '').slice(0, 60).trim();
    const reason = String(body.reason || '').slice(0, 500).trim();
    const text = `[Appointment request] ${when || 'no date given'}${reason ? ` — ${reason}` : ''}`;
    broadcast('message', addMessage('guest', text));
    return sendJson(res, 200, { ok: true });
  }

  if (path === '/api/guest/wipe' && method === 'POST') {
    wipeMessages();
    broadcast('wiped', {});
    return sendJson(res, 200, { ok: true });
  }

  if (path === '/api/guest/stream' && method === 'GET') return openStream(req, res);

  return sendJson(res, 404, { error: 'Not found' });
}

/* -------------------------------- server --------------------------------- */

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  baseHeaders(res);

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    // Clicking the link opens the sign-in card, which asks the security
    // question. If no answer is configured the link alone signs her in. Either
    // way the page then rewrites its own address so the token is not left in
    // the address bar or in browser history.
    if (url.pathname.startsWith('/c/')) {
      const token = url.pathname.slice(3).split('/')[0];
      const t = getThread();
      if (tokenIsValid(token) && !t.answerHash) {
        setCookie(req, res, 'sl_guest', createSession('guest', GUEST_TTL), GUEST_TTL / 1000);
      }
      return serveStatic(res, 'portal.html');
    }

    if (url.pathname === '/' || url.pathname === '/console') {
      return serveStatic(res, 'console.html');
    }

    if (url.pathname === '/health') return sendJson(res, 200, { ok: true });

    return serveStatic(res, url.pathname.slice(1));
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error' });
    else res.end();
    console.error('[secure-line]', err.message);
  }
});

setInterval(purgeOldMessages, 60_000).unref();

server.listen(PORT, () => {
  console.log(`[secure-line] listening on http://localhost:${PORT}`);
  if (!process.env.OWNER_PASSCODE) {
    console.warn('[secure-line] OWNER_PASSCODE is not set. The console will refuse every login.');
  }
});
