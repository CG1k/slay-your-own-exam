/**
 * SMS delivery.
 *
 * The text that lands on the monitored phone is deliberately dull and names no
 * organization. It is a notification, not a message: everything that matters
 * lives behind the link. Do not put a name, a greeting, or anything about the
 * situation in here, and do not dress it up as a real business.
 */

export const NOTICE_PRESETS = [
  {
    id: 'portal',
    label: 'Portal message waiting',
    body: 'You have a new message in your patient portal: {{link}}',
  },
  {
    id: 'reminder',
    label: 'Appointment reminder',
    body: 'Reminder: please review your upcoming visit details: {{link}}',
  },
  {
    id: 'results',
    label: 'Results ready',
    body: 'Your recent results are ready to view: {{link}}',
  },
  {
    id: 'generic',
    label: 'Generic reminder',
    body: 'Reminder: your saved item is ready. {{link}}',
  },
  { id: 'bare', label: 'Link only', body: '{{link}}' },
];

export function renderNotice(body, link) {
  return String(body).replaceAll('{{link}}', link);
}

export function smsConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER,
  );
}

/**
 * Send via Twilio's REST API. Returns { ok, detail }.
 * When Twilio is not configured the caller falls back to manual mode and just
 * shows you the link to send yourself.
 */
export async function sendSms(to, body) {
  if (!smsConfigured()) {
    return { ok: false, detail: 'SMS is not configured; use manual mode.' };
  }
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');

  const form = new URLSearchParams({
    To: to,
    From: process.env.TWILIO_FROM_NUMBER,
    Body: body,
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, detail: data.message || `Carrier rejected the message (HTTP ${res.status}).` };
    }
    return { ok: true, detail: data.sid || 'sent' };
  } catch (err) {
    return { ok: false, detail: `Could not reach the SMS provider: ${err.message}` };
  }
}
