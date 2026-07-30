# secure-line

A patient-portal-shaped website for reaching one person whose phone is watched
by someone else.

She gets a dull text with a link. The link signs her in. What she lands on looks
like an ordinary patient portal — a clinic name, a page title you choose, a
"Welcome, <name>", and three options:

- **Speak with your provider** — the real conversation, with you
- **View your results** — a dead end that says her identity has to be confirmed
  with her provider first, and hands her a button back to the conversation
- **Schedule an appointment** — a real request form; whatever she submits
  arrives in your console as a message

She can come back to the same link any time.

## The clinic is fictional

The clinic name, the provider name, and the page title are all yours to set, and
they should all be made up. Do not put a real clinic's name, logo, or address on
it. A made-up name works exactly as well for the purpose and keeps this a page
that impersonates nobody.

## How she knows it's you

You pick the page title, and you put your word in it — "Patient Portal —
Bluebird". It's the browser tab and the heading on every screen. Agree on it
with her ahead of time if you can.

## Setup

```sh
cp .env.example .env      # then fill it in
npm start
```

No dependencies to install. Node 18 or newer.

| Variable | What it's for |
| --- | --- |
| `OWNER_PASSCODE` | What you type to get into the console. Make it long. |
| `SESSION_SECRET` | Signs session cookies. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `PUBLIC_URL` | Where the site lives, so links come out right |
| `TWILIO_*` | Optional, for sending the text automatically |

Deploy it anywhere that runs Node — Render, Railway, Fly. It's one process and
one JSON file on disk.

## Sending the link

Your console is at `/`. Set the portal up, then either send the text from the
console or copy the link and send it another way.

If you configure Twilio, the text goes out **from the app's own number**, not
your phone. Your number never appears on her device.

Keep the notification text boring. No name, no greeting, nothing about the
situation — all of that belongs behind the link, not in a preview that lights up
her lock screen.

## What's built in

- The link signs her in; no password for her to remember or write down
- An optional access code, if you'd rather the link alone not be enough
- The token is stripped from the address bar and browser history on load
- Quick exit — the Sign out button, or <kbd>Esc</kbd> three times — replaces the
  page so Back doesn't return to it
- Either of you can clear the conversation instantly
- Optional auto-delete of messages after N minutes, and a link expiry date
- Building a new link kills the old one and signs out anyone using it
- No caching, no search indexing, no referrer, strict CSP
- Wrong links and wrong codes are indistinguishable from outside, and attempts
  are rate limited

## What it can't do

If the phone itself is compromised — stalkerware, a keylogger, screen
recording, or someone who picks it up and scrolls — nothing served from a
website can prevent that. This hides the message from someone reading her
notifications and her text history. It does not defeat software installed on
her device.

If that's a live possibility, a device she doesn't own is worth more than any
site: a library computer, a friend's phone, a school machine.

In the US: National Domestic Violence Hotline, 1-800-799-7233, or text START to
88788. From a device that isn't being watched, when you can.
