/* Your side of the line. */

const $ = (id) => document.getElementById(id);

let stream = null;
let currentLink = '';

/* --------------------------------- login --------------------------------- */

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('login-error');
  err.hidden = true;

  const res = await fetch('/api/owner/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: $('passcode').value }),
  }).catch(() => null);

  $('passcode').value = '';

  if (!res || !res.ok) {
    const data = res ? await res.json().catch(() => ({})) : {};
    err.textContent = data.error || 'Could not sign in.';
    err.hidden = false;
    return;
  }
  enterApp();
});

$('logout').addEventListener('click', async () => {
  await fetch('/api/owner/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

async function enterApp() {
  $('login-view').hidden = true;
  $('app-view').hidden = false;
  await refreshState();
  connectStream();
}

/* --------------------------------- state --------------------------------- */

function fillPresets(presets) {
  const select = $('preset');
  if (select.options.length) return;
  for (const p of presets) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    opt.dataset.body = p.body;
    select.append(opt);
  }
  select.addEventListener('change', () => {
    const opt = select.selectedOptions[0];
    if (opt) $('notice-body').value = opt.dataset.body;
  });
  if (presets.length) $('notice-body').value = presets[0].body;
}

async function refreshState() {
  const res = await fetch('/api/owner/state');
  if (res.status === 401) {
    location.reload();
    return;
  }
  const data = await res.json();
  fillPresets(data.presets || []);

  $('notify-note').textContent = data.smsConfigured
    ? 'Texting is configured.'
    : 'No SMS provider configured — use "Copy link instead" and send it however you like.';

  const status = $('status');
  if (!data.thread) {
    status.hidden = true;
    currentLink = '';
    return;
  }

  currentLink = data.thread.link;
  status.hidden = false;
  status.replaceChildren();

  const rows = [
    ['Link', data.thread.link],
    ['Recognition word', data.thread.recognitionHint],
    ['Cover', data.thread.coverTheme],
    [
      'Messages deleted after',
      data.thread.purgeAfterMinutes ? `${data.thread.purgeAfterMinutes} min` : 'never',
    ],
    ['Link expires', new Date(data.thread.expiresAt).toLocaleString()],
    ['Status', data.thread.expired ? 'EXPIRED — create a new line' : 'active'],
  ];

  for (const [k, v] of rows) {
    const row = document.createElement('div');
    row.className = 'status-row';
    const key = document.createElement('span');
    key.className = 'status-key';
    key.textContent = k;
    const val = document.createElement('span');
    val.className = 'status-val';
    val.textContent = v;
    row.append(key, val);
    status.append(row);
  }

  // Pre-fill the form so edits start from what is live.
  $('recognitionHint').value = data.thread.recognitionHint || '';
  $('coverTheme').value = data.thread.coverTheme || 'weather';
  $('purgeAfterMinutes').value = data.thread.purgeAfterMinutes ?? 60;
  $('label').value = data.thread.label || '';
}

/* --------------------------------- setup --------------------------------- */

$('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('setup-error');
  err.hidden = true;

  if (currentLink) {
    const ok = confirm(
      'This creates a NEW link and immediately breaks the old one. ' +
        'If she has the old link, she will lose access. Continue?',
    );
    if (!ok) return;
  }

  const res = await fetch('/api/owner/thread', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recognitionHint: $('recognitionHint').value,
      passphrase: $('passphrase').value,
      coverTheme: $('coverTheme').value,
      purgeAfterMinutes: $('purgeAfterMinutes').value,
      expiresDays: $('expiresDays').value,
      label: $('label').value,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    err.textContent = data.error || 'Could not create the line.';
    err.hidden = false;
    return;
  }
  $('passphrase').value = '';
  await refreshState();
});

/* -------------------------------- notify --------------------------------- */

$('copy-link').addEventListener('click', async () => {
  if (!currentLink) {
    $('notify-note').textContent = 'Create the line first.';
    return;
  }
  try {
    await navigator.clipboard.writeText(currentLink);
    $('notify-note').textContent = 'Link copied.';
  } catch {
    $('notify-note').textContent = currentLink;
  }
});

$('send-sms').addEventListener('click', async () => {
  const err = $('notify-error');
  err.hidden = true;

  const res = await fetch('/api/owner/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: $('to').value, body: $('notice-body').value, send: true }),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    err.textContent = data.error || 'Could not send.';
    err.hidden = false;
    return;
  }
  if (data.sent) {
    $('notify-note').textContent = `Sent: ${data.preview}`;
  } else if (data.manual) {
    $('notify-note').textContent =
      'No SMS provider configured. Send this yourself: ' + data.preview;
  }
});

/* --------------------------------- chat ---------------------------------- */

function renderMessage(msg) {
  const row = document.createElement('div');
  row.className = `bubble ${msg.from === 'owner' ? 'mine' : 'theirs'}`;

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
  stream = new EventSource('/api/owner/stream');
  stream.addEventListener('hello', (e) => {
    $('log').replaceChildren();
    for (const msg of JSON.parse(e.data).messages) renderMessage(msg);
  });
  stream.addEventListener('message', (e) => renderMessage(JSON.parse(e.data)));
  stream.addEventListener('wiped', () => $('log').replaceChildren());
  stream.addEventListener('reset', () => {
    $('log').replaceChildren();
    refreshState();
  });
}

$('send-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('send-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';

  const res = await fetch('/api/owner/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).catch(() => null);

  if (res && res.status === 401) location.reload();
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
  await fetch('/api/owner/wipe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ everything: false }),
  });
  $('log').replaceChildren();
});

$('destroy').addEventListener('click', async () => {
  if (!confirm('Delete the line, the link, and every message? She loses access immediately.')) {
    return;
  }
  await fetch('/api/owner/wipe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ everything: true }),
  });
  $('log').replaceChildren();
  await refreshState();
});

/* Resume an existing console session on reload. */
const probe = await fetch('/api/owner/state').catch(() => null);
if (probe && probe.ok) enterApp();
