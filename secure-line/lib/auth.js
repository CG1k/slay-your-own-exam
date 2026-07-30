import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

const SESSION_SECRET =
  process.env.SESSION_SECRET || randomBytes(32).toString('hex');

if (!process.env.SESSION_SECRET) {
  console.warn(
    '[secure-line] SESSION_SECRET is not set. Using a random one, so everyone ' +
      'is signed out on every restart. Set it in .env for a real deployment.',
  );
}

/* ------------------------------ passphrases ------------------------------ */

export function hashSecret(secret) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(secret), salt, 64).toString('hex');
  return { salt, hash };
}

export function verifySecret(secret, salt, hash) {
  if (!salt || !hash) return false;
  const candidate = scryptSync(String(secret), salt, 64);
  const known = Buffer.from(hash, 'hex');
  if (candidate.length !== known.length) return false;
  return timingSafeEqual(candidate, known);
}

/** Constant-time compare for the owner passcode, which lives in env. */
export function matchesOwnerPasscode(input) {
  const expected = process.env.OWNER_PASSCODE || '';
  if (!expected) return false;
  const a = Buffer.from(String(input));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/* -------------------------------- sessions ------------------------------- */

const sessions = new Map(); // id -> { role, expiresAt }

function sign(value) {
  return createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

export function createSession(role, ttlMs) {
  const id = randomBytes(24).toString('base64url');
  sessions.set(id, { role, expiresAt: Date.now() + ttlMs, ttlMs });
  return `${id}.${sign(id)}`;
}

export function readSession(cookieValue, role) {
  if (!cookieValue) return null;
  const [id, mac] = String(cookieValue).split('.');
  if (!id || !mac) return null;

  const expected = sign(id);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const session = sessions.get(id);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(id);
    return null;
  }
  if (session.role !== role) return null;

  // Sliding expiry: an open tab stays usable, an abandoned one dies on its own.
  session.expiresAt = Date.now() + session.ttlMs;
  return session;
}

export function destroySession(cookieValue) {
  if (!cookieValue) return;
  const [id] = String(cookieValue).split('.');
  if (id) sessions.delete(id);
}

/** Invalidate every guest session, e.g. after a wipe or a new link. */
export function destroyAllSessions(role) {
  for (const [id, s] of sessions) {
    if (!role || s.role === role) sessions.delete(id);
  }
}

/* ------------------------------ rate limiting ---------------------------- */

const attempts = new Map(); // key -> { count, resetAt }

export function tooManyAttempts(key, max = 8, windowMs = 15 * 60_000) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now > rec.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  rec.count += 1;
  return rec.count > max;
}

export function clearAttempts(key) {
  attempts.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (now > s.expiresAt) sessions.delete(id);
  for (const [k, r] of attempts) if (now > r.resetAt) attempts.delete(k);
}, 60_000).unref();
