/* Recipient surface: cover page in front, real conversation behind it. */

const ESCAPE_TO = 'https://www.google.com';
const IDLE_LOCK_MS = 3 * 60_000;

const THEMES = {
  weather: {
    title: 'Local Forecast',
    label: 'Search location',
    placeholder: 'Enter a city or ZIP',
    button: 'Go',
    error: 'No matching location.',
    savedWord: 'Saved',
  },
  recipes: {
    title: 'Weeknight Recipes',
    label: 'Search recipes',
    placeholder: 'Ingredient or dish',
    button: 'Search',
    error: 'No recipes matched.',
    savedWord: 'Last viewed',
  },
  shopping: {
    title: 'Shopping List',
    label: 'Find an item',
    placeholder: 'Item name',
    button: 'Find',
    error: 'No items matched.',
    savedWord: 'List',
  },
};

const $ = (id) => document.getElementById(id);

/* The token lives in memory only. Pull it out of the URL, then scrub the URL so
   it is not sitting in the address bar or in browser history. */
let token = '';
const match = location.pathname.match(/^\/c\/([A-Za-z0-9_-]+)/);
if (match) {
  token = match[1];
  history.replaceState(null, '', '/');
}

let theme = THEMES.weather;
let stream = null;
let idleTimer = null;

/* --------------------------------- exits --------------------------------- */

function leaveNow() {
  try {
    if (stream) stream.close();
  } catch {
    /* ignore */
  }
  // Best effort: drop the session, then replace this page so Back does not
  // come back to it.
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

$('exit-cover').addEventListener('click', leaveNow);
$('exit-chat').addEventListener('click', leaveNow);

/* --------------------------------- cover --------------------------------- */

function applyTheme(name) {
  theme = THEMES[name] || THEMES.weather;
  document.title = theme.title;
  $('cover-title').textContent = theme.title;
  $('unlock-label').textContent = theme.label;
  $('unlock-input').placeholder = theme.placeholder;
  $('unlock-btn').textContent = theme.button;
  $('cover-error').textContent = theme.error;

  for (const key of Object.keys(THEMES)) {
    const section = $(`theme-${key}`);
    if (section) section.hidden = key !== name;
  }
  const savedRow = document.querySelector('.saved-row');
  if (savedRow) savedRow.firstChild.textContent = `${theme.savedWord}: `;
}

async function loadCover() {
  applyTheme('weather');
  if (!token) return;
  try {
    const res = await fetch(`/api/guest/cover?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    applyTheme(data.coverTheme || 'weather');
    if (data.valid && data.recognitionHint) {
      $('recognition').textContent = data.recognitionHint;
    }
  } catch {
    /* Leave the cover looking ordinary if anything fails. */
  }
}

$('unlock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('unlock-input');
  const passphrase = input.value.trim();
  if (!passphrase) return;

  $('cover-error').hidden = true;
  try {
    const res = await fetch('/api/guest/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, passphrase }),
    });
    if (!res.ok) {
      input.value = '';
      $('cover-error').hidden = false;
      return;
    }
    input.value = '';
    openChat();
  } catch {
    $('cover-error').hidden = false;
  }
});

/* --------------------------------- chat ---------------------------------- */

function openChat() {
  $('cover').hidden = true;
  $('chat').hidden = false;
  $('send-input').focus();
  connectStream();
  resetIdle();
}

function lockBack() {
  try {
    if (stream) stream.close();
  } catch {
    /* ignore */
  }
  stream = null;
  fetch('/api/guest/lock', { method: 'POST' }).catch(() => {});
  $('log').replaceChildren();
  $('send-input').value = '';
  $('chat').hidden = true;
  $('cover').hidden = false;
}

$('lock').addEventListener('click', lockBack);

$('wipe').addEventListener('click', async () => {
  await fetch('/api/guest/wipe', { method: 'POST' }).catch(() => {});
  $('log').replaceChildren();
});

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
}

function connectStream() {
  stream = new EventSource('/api/guest/stream');

  stream.addEventListener('hello', (e) => {
    $('log').replaceChildren();
    for (const msg of JSON.parse(e.data).messages) renderMessage(msg);
  });
  stream.addEventListener('message', (e) => renderMessage(JSON.parse(e.data)));
  stream.addEventListener('wiped', () => $('log').replaceChildren());
  stream.addEventListener('reset', () => lockBack());
  stream.addEventListener('error', () => {
    /* EventSource retries on its own; nothing to show the user. */
  });
}

$('send-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('send-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  resetIdle();

  const res = await fetch('/api/guest/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).catch(() => null);

  if (res && res.status === 401) lockBack();
});

const sendInput = $('send-input');
sendInput.addEventListener('input', () => {
  sendInput.style.height = 'auto';
  sendInput.style.height = `${Math.min(sendInput.scrollHeight, 140)}px`;
  resetIdle();
});
sendInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('send-form').requestSubmit();
  }
});

/* An unattended open tab is the most likely way this gets seen. */
function resetIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(lockBack, IDLE_LOCK_MS);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) resetIdle();
});

/* If a valid session cookie is still alive, skip straight to the conversation. */
async function resume() {
  try {
    const res = await fetch('/api/guest/session');
    if (res.ok) openChat();
  } catch {
    /* stay on the cover */
  }
}

await loadCover();
if (!token) await resume();
