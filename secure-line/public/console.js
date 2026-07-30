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

/* Keep the security question in step with the provider name, but stop the
   moment the operator writes their own wording. */
const questionFor = (provider) => `What is ${provider || 'Dr. Gordon'}'s first name?`;
let questionEdited = false;

$('securityQuestion').addEventListener('input', () => {
  questionEdited = true;
});

$('providerName').addEventListener('input', () => {
  if (!questionEdited) $('securityQuestion').value = questionFor($('providerName').value.trim());
});

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
  // Picking a preset only seeds the box; the text stays yours to rewrite.
  select.addEventListener('change', () => {
    const opt = select.selectedOptions[0];
    if (opt) $('notice-body').value = opt.dataset.body;
  });
  if (presets.length) $('notice-body').value = presets[0].body;
}

function fillChannels(channels) {
  const select = $('channel');
  if (select.options.length) return;

  for (const c of channels) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.ready ? c.label : `${c.label} — not configured`;
    opt.disabled = !c.ready;
    opt.dataset.note = c.note || '';
    select.append(opt);
  }

  const showNote = () => {
    const opt = select.selectedOptions[0];
    $('channel-note').textContent = opt ? opt.dataset.note : '';
  };
  select.addEventListener('change', showNote);

  // Land on something that actually works.
  const firstReady = channels.find((c) => c.ready && c.id !== 'manual') || { id: 'manual' };
  select.value = firstReady.id;
  showNote();
}

async function refreshState() {
  const res = await fetch('/api/owner/state');
  if (res.status === 401) {
    location.reload();
    return;
  }
  const data = await res.json();
  fillPresets(data.presets || []);
  fillChannels(data.channels || []);

  $('notify-note').textContent = data.smsConfigured
    ? ''
    : 'No sending service is configured yet, so "Send it" will just hand you the text to send yourself.';

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
    ['Her link', data.thread.link],
    ['Page title', data.thread.pageTitle],
    ['Greeted as', data.thread.displayName],
    ['Clinic name', data.thread.clinicName],
    [
      'Sign-in',
      data.thread.answerRequired
        ? `asks: ${data.thread.securityQuestion}`
        : 'link signs her in, no question',
    ],
    [
      'Messages deleted after',
      data.thread.purgeAfterMinutes ? `${data.thread.purgeAfterMinutes} min` : 'never',
    ],
    ['Link expires', new Date(data.thread.expiresAt).toLocaleString()],
    ['Status', data.thread.expired ? 'EXPIRED — build a new link' : 'active'],
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
  $('pageTitle').value = data.thread.pageTitle || '';
  $('displayName').value = data.thread.displayName || '';
  $('clinicName').value = data.thread.clinicName || '';
  $('providerName').value = data.thread.providerName || '';
  $('securityQuestion').value = data.thread.securityQuestion || '';
  // A stored question that isn't the generated one was written by hand; leave it be.
  questionEdited =
    Boolean(data.thread.securityQuestion) &&
    data.thread.securityQuestion !== questionFor(data.thread.providerName);
  $('purgeAfterMinutes').value = data.thread.purgeAfterMinutes ?? 0;
}

/* --------------------------------- setup --------------------------------- */

$('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('setup-error');
  err.hidden = true;

  if (currentLink) {
    const ok = confirm(
      'This builds a NEW link and immediately breaks the old one. ' +
        'If she already has the old link, she will lose access. Continue?',
    );
    if (!ok) return;
  }

  const res = await fetch('/api/owner/thread', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pageTitle: $('pageTitle').value,
      displayName: $('displayName').value,
      clinicName: $('clinicName').value,
      providerName: $('providerName').value,
      securityQuestion: $('securityQuestion').value,
      answer: $('answer').value,
      purgeAfterMinutes: $('purgeAfterMinutes').value,
      expiresDays: $('expiresDays').value,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    err.textContent = data.error || 'Could not build the portal.';
    err.hidden = false;
    return;
  }
  await refreshState();
});

/* -------------------------------- notify --------------------------------- */

$('copy-link').addEventListener('click', async () => {
  if (!currentLink) {
    $('notify-note').textContent = 'Set up the portal first.';
    return;
  }
  try {
    await navigator.clipboard.writeText(currentLink);
    $('notify-note').textContent = 'Link copied.';
  } catch {
    $('notify-note').textContent = currentLink;
  }
});

async function notify(send) {
  const err = $('notify-error');
  err.hidden = true;

  const res = await fetch('/api/owner/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: $('to').value,
      body: $('notice-body').value,
      channel: $('channel').value,
      send,
    }),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    err.textContent = data.error || 'Could not send.';
    err.hidden = false;
    if (data.preview) {
      $('preview-box').textContent = data.preview;
      $('preview-box').hidden = false;
    }
    return;
  }

  $('preview-box').textContent = data.preview;
  $('preview-box').hidden = false;
  $('notify-note').textContent = data.sent
    ? 'Sent. This is exactly what landed on her phone:'
    : 'Not sent — copy this and send it yourself:';
}

$('send-sms').addEventListener('click', () => notify(true));
$('preview-btn').addEventListener('click', () => notify(false));

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
  if (!confirm('Delete the portal, the link, and every message? She loses access immediately.')) {
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
