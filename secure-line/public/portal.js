/* Her side: a patient portal whose "Speak with your provider" is the real
   conversation. The link signs her in; she can come back to it any time. */

const ESCAPE_TO = 'https://www.google.com';

const $ = (id) => document.getElementById(id);

/* The token is the credential. Read it, then scrub it out of the address bar
   and out of browser history. */
let token = '';
const match = location.pathname.match(/^\/c\/([A-Za-z0-9_-]+)/);
if (match) {
  token = match[1];
  history.replaceState(null, '', '/');
}

let stream = null;
let currentView = 'home';

/* --------------------------------- exit ---------------------------------- */

function leaveNow() {
  try {
    stream?.close();
  } catch {
    /* ignore */
  }
  navigator.sendBeacon?.('/api/guest/lock');
  history.replaceState(null, '', '/');
  location.replace(ESCAPE_TO);
}

let escapeCount = 0;
let escapeTimer = null;
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  escapeCount += 1;
  clearTimeout(escapeTimer);
  escapeTimer = setTimeout(() => {
    escapeCount = 0;
  }, 1200);
  if (escapeCount >= 3) leaveNow();
});

$('signout').addEventListener('click', leaveNow);

/* -------------------------------- routing -------------------------------- */

const VIEWS = ['home', 'messages', 'results', 'appointment'];

function go(name) {
  if (!VIEWS.includes(name)) name = 'home';
  currentView = name;
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;

  if (name === 'messages') {
    $('tile-badge').hidden = true;
    $('send-input').focus();
    $('log').scrollTop = $('log').scrollHeight;
  }
}

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-go]');
  if (target) go(target.dataset.go);
});

/* -------------------------------- sign in -------------------------------- */

$('answer-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('signin-error').hidden = true;

  const res = await fetch('/api/guest/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, answer: $('answer').value }),
  }).catch(() => null);

  $('answer').value = '';
  if (!res || !res.ok) {
    $('signin-error').hidden = false;
    return;
  }
  await start();
});

async function showSignIn() {
  $('view-signin').hidden = false;
  $('portal').hidden = true;

  // Ask the server how the question is worded for this link.
  try {
    const res = await fetch(`/api/guest/question?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (data.question) $('question-label').textContent = data.question;

  } catch {
    /* keep the default wording */
  }
  $('answer').focus();
}

/* --------------------------------- chat ---------------------------------- */

function renderMessage(msg) {
  const row = document.createElement('div');
  row.className = `bubble ${msg.from === 'guest' ? 'mine' : 'theirs'}`;

  const body = document.createElement('div');
  body.className = 'bubble-text';
  body.textContent = msg.text;

  const time = document.createElement('time');
  time.className = 'bubble-time';
  time.textContent = new Date(msg.at).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  row.append(body, time);
  const log = $('log');
  log.append(row);
  log.scrollTop = log.scrollHeight;

  if (msg.from === 'owner' && currentView !== 'messages') $('tile-badge').hidden = false;
}

function connectStream() {
  stream = new EventSource('/api/guest/stream');

  stream.addEventListener('hello', (e) => {
    $('log').replaceChildren();
    for (const msg of JSON.parse(e.data).messages) renderMessage(msg);
  });
  stream.addEventListener('message', (e) => renderMessage(JSON.parse(e.data)));
  stream.addEventListener('wiped', () => $('log').replaceChildren());
  stream.addEventListener('reset', () => {
    try {
      stream?.close();
    } catch {
      /* ignore */
    }
    showSignIn();
  });
  stream.addEventListener('error', () => {
    /* EventSource reconnects by itself. */
  });
}

$('send-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('send-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';

  const res = await fetch('/api/guest/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).catch(() => null);

  if (res && res.status === 401) showSignIn();
});

const sendInput = $('send-input');
sendInput.addEventListener('input', () => {
  sendInput.style.height = 'auto';
  sendInput.style.height = `${Math.min(sendInput.scrollHeight, 140)}px`;
});
sendInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('send-form').requestSubmit();
  }
});

$('wipe').addEventListener('click', async () => {
  await fetch('/api/guest/wipe', { method: 'POST' }).catch(() => {});
  $('log').replaceChildren();
});

/* ----------------------------- appointments ------------------------------ */

$('appt-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const when = $('appt-when').value.trim();
  const reason = $('appt-reason').value.trim();

  await fetch('/api/guest/appointment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ when, reason }),
  }).catch(() => {});

  $('appt-form').hidden = true;
  $('appt-done').hidden = false;
});

/* -------------------------------- notice --------------------------------- */

function showNotice(title, body) {
  if (!body || !body.trim()) return;

  $('notice-title').textContent = title || 'Important';

  const holder = $('notice-body');
  holder.replaceChildren();
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    const p = document.createElement('p');
    p.textContent = line.trim();
    holder.append(p);
  }

  $('notice-overlay').hidden = false;
  $('notice-ok').focus();
}

$('notice-ok').addEventListener('click', () => {
  $('notice-overlay').hidden = true;
});

/* -------------------------------- startup -------------------------------- */

async function start() {
  const res = await fetch('/api/guest/portal').catch(() => null);
  if (!res || !res.ok) {
    await showSignIn();
    return;
  }

  const cfg = await res.json();
  document.title = cfg.pageTitle || 'Patient Portal';
  $('page-title').textContent = cfg.pageTitle || 'Patient Portal';
  $('clinic-name').textContent = cfg.clinicName || '';
  $('signin-clinic').textContent = cfg.clinicName || 'Patient Portal';
  $('welcome-name').textContent = cfg.displayName || '';
  $('messages-sub').textContent = `You are connected with ${cfg.providerName || 'Dr. Gordon'}.`;

  $('view-signin').hidden = true;
  $('portal').hidden = false;
  go('home');
  showNotice(cfg.noticeTitle, cfg.noticeBody);
  connectStream();
}

await start();
