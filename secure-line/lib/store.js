import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const DATA_FILE = resolve(process.env.DATA_FILE || './data/line.json');

const MAX_MESSAGES = 400;

let state = { thread: null };

function load() {
  try {
    state = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
    if (!state || typeof state !== 'object') state = { thread: null };
  } catch {
    state = { thread: null };
  }
}

function save() {
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  renameSync(tmp, DATA_FILE);
}

load();

export function getThread() {
  return state.thread;
}

/**
 * Replace the active thread. Creating a new one invalidates every old link,
 * which is the intended way to "start over" if a link is ever compromised.
 */
export function createThread(fields) {
  state.thread = {
    token: randomBytes(24).toString('base64url'),
    createdAt: Date.now(),
    messages: [],
    ...fields,
  };
  save();
  return state.thread;
}

export function updateThread(patch) {
  if (!state.thread) return null;
  Object.assign(state.thread, patch);
  save();
  return state.thread;
}

export function addMessage(from, text) {
  if (!state.thread) return null;
  const msg = {
    id: randomBytes(9).toString('base64url'),
    from,
    text,
    at: Date.now(),
  };
  state.thread.messages.push(msg);
  if (state.thread.messages.length > MAX_MESSAGES) {
    state.thread.messages.splice(0, state.thread.messages.length - MAX_MESSAGES);
  }
  save();
  return msg;
}

export function listMessages() {
  return state.thread ? state.thread.messages : [];
}

/** Delete every message but keep the line open. */
export function wipeMessages() {
  if (!state.thread) return;
  state.thread.messages = [];
  save();
}

/** Delete everything, including the link itself. */
export function destroyThread() {
  state.thread = null;
  save();
}

export function threadExpired(thread = state.thread) {
  return !thread || (thread.expiresAt && Date.now() > thread.expiresAt);
}

/**
 * Drop messages older than the thread's retention window. Messages that no
 * longer exist on the server cannot be recovered from it later.
 */
export function purgeOldMessages() {
  const t = state.thread;
  if (!t) return;
  if (threadExpired(t)) {
    destroyThread();
    return;
  }
  const minutes = Number(t.purgeAfterMinutes);
  if (!minutes || minutes <= 0) return;
  const cutoff = Date.now() - minutes * 60_000;
  const before = t.messages.length;
  t.messages = t.messages.filter((m) => m.at >= cutoff);
  if (t.messages.length !== before) save();
}
