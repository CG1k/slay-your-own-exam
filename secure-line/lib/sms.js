/**
 * Outbound delivery.
 *
 * Several providers are supported because availability, price, and how the
 * message *looks* on her phone differ between them. Configure whichever you
 * can get; the console lists the ones that are ready and lets you pick per
 * send. With none configured, everything falls back to manual mode, where the
 * console hands you the link to send however you like.
 *
 * On iMessage: there is no legitimate way to send iMessage from a service.
 * Apple provides no API for it, and anything advertising it is driving an
 * actual Mac signed into an Apple ID. Every provider here sends SMS, so it
 * arrives as a green bubble on an iPhone. What you *can* control is that it
 * reads as automated — see the alphanumeric sender note on Vonage.
 */

export const NOTICE_PRESETS = [
  {
    id: 'diagnostic',
    label: 'Diagnostic report — portal sign-in',
    body:
      'Good afternoon {{name}}, your recent diagnostic report includes findings ' +
      'that require attention. Please sign in to your patient portal to review ' +
      'your results and schedule an appointment or contact your provider within ' +
      'the next 72 hours. {{link}}',
  },
  {
    id: 'code',
    label: 'Verification style',
    body: 'Your verification link is ready. Tap to continue: {{link}} Do not share this link.',
  },
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

/**
 * Fills the placeholders a message body may use. Anything that isn't a known
 * placeholder is left as-is, so a typo shows up in the preview rather than
 * silently disappearing from the text that goes out.
 */
export function renderNotice(body, { link = '', name = '', clinic = '' } = {}) {
  return String(body)
    .replaceAll('{{link}}', link)
    .replaceAll('{{name}}', name)
    .replaceAll('{{clinic}}', clinic);
}

/* ------------------------------- providers ------------------------------- */

const PROVIDERS = {
  twilio: {
    label: 'Twilio (SMS)',
    note: 'Sends from your Twilio number.',
    ready: () =>
      Boolean(
        process.env.TWILIO_ACCOUNT_SID &&
          process.env.TWILIO_AUTH_TOKEN &&
          process.env.TWILIO_FROM_NUMBER,
      ),
    async send(to, body) {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM_NUMBER, Body: body }),
        },
      );
      const data = await res.json().catch(() => ({}));
      return res.ok
        ? { ok: true, detail: data.sid || 'sent' }
        : { ok: false, detail: data.message || `Rejected (HTTP ${res.status}).` };
    },
  },

  telnyx: {
    label: 'Telnyx (SMS)',
    note: 'Sends from your Telnyx number.',
    ready: () => Boolean(process.env.TELNYX_API_KEY && process.env.TELNYX_FROM_NUMBER),
    async send(to, body) {
      const res = await fetch('https://api.telnyx.com/v2/messages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to,
          from: process.env.TELNYX_FROM_NUMBER,
          text: body,
          ...(process.env.TELNYX_MESSAGING_PROFILE_ID
            ? { messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok
        ? { ok: true, detail: data?.data?.id || 'sent' }
        : { ok: false, detail: data?.errors?.[0]?.detail || `Rejected (HTTP ${res.status}).` };
    },
  },

  vonage: {
    label: 'Vonage (SMS, named sender)',
    note:
      'Supports an alphanumeric sender such as VERIFY or ALERTS instead of a ' +
      'phone number, which is what makes it read as an automated notice. Not ' +
      'permitted for US numbers; works in much of the rest of the world.',
    ready: () =>
      Boolean(
        process.env.VONAGE_API_KEY && process.env.VONAGE_API_SECRET && process.env.VONAGE_FROM,
      ),
    async send(to, body) {
      const res = await fetch('https://rest.nexmo.com/sms/json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: process.env.VONAGE_API_KEY,
          api_secret: process.env.VONAGE_API_SECRET,
          from: process.env.VONAGE_FROM,
          to: to.replace(/^\+/, ''),
          text: body,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const first = data?.messages?.[0];
      return first && first.status === '0'
        ? { ok: true, detail: first['message-id'] || 'sent' }
        : { ok: false, detail: first?.['error-text'] || `Rejected (HTTP ${res.status}).` };
    },
  },
};

/** What the console shows in the "send it with" dropdown. */
export function listChannels() {
  const channels = Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    label: p.label,
    note: p.note,
    ready: p.ready(),
  }));
  channels.push({
    id: 'manual',
    label: 'Copy it and send it myself',
    note: 'Nothing is sent. The console gives you the finished text to paste.',
    ready: true,
  });
  return channels;
}

export function anyChannelReady() {
  return Object.values(PROVIDERS).some((p) => p.ready());
}

export async function sendVia(channel, to, body) {
  const provider = PROVIDERS[channel];
  if (!provider) return { ok: false, detail: 'Unknown sending method.' };
  if (!provider.ready()) {
    return { ok: false, detail: `${provider.label} is not configured on this server.` };
  }
  try {
    return await provider.send(to, body);
  } catch (err) {
    return { ok: false, detail: `Could not reach ${provider.label}: ${err.message}` };
  }
}
