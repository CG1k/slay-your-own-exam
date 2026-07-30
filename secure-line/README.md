# secure-line

A patient-portal-shaped website for reaching one person whose phone is watched
by someone else.

She gets a dull text with a link. Tapping it asks her one security question —
by default *"What is Dr. Gordon's first name?"*, answer `Chase`. Anyone else
who opens the link sees the same question and can't get past it.

Past it, she lands on what looks like an ordinary patient portal — a clinic
name, a page title you choose, a "Welcome, <name>", and three options:

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

Two ways, and the second is the stronger one.

The page title is yours, and you put your word in it — "Patient Portal —
Bluebird". It's the browser tab and the heading on every screen.

The security question does double duty. *"What is Dr. Gordon's first name?"* has
an answer only she would think to give, because the answer is you. Someone going
through her phone reads it as an ordinary identity check and has no way to guess
it.

The wording follows whatever you set the provider name to, so renaming the
doctor renames the question. Type your own wording and it stops following.

Answers ignore capitals and surrounding spaces, so `Chase`, `chase`, `CHASE`,
and `  Chase  ` all work. Both the question and the answer are yours to change
in the console. Leaving the answer blank turns the question off entirely and
lets the link sign her in on its own.

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
| `TWILIO_*`, `TELNYX_*`, `VONAGE_*` | Optional, one per sending service |

Deploy it anywhere that runs Node — Render, Railway, Fly. It's one process and
one JSON file on disk.

## Sending the link

Your console is at `/`. Set the portal up, then write whatever text you want and
pick how to send it.

The message body is a free text box. Presets are there to start from, not to
limit you — rewrite them however you like. `{{link}}` is replaced with her link.
**Preview** shows you the finished text before anything goes out.

The **Send it with** menu lists every service configured on the server, plus
"copy it and send it myself", which always works. Whichever you use, the text
goes out **from that service's number, not your phone**. Your number never
appears on her device.

Keep the text boring. No name, no greeting, nothing about the situation — all of
that belongs behind the link, not in a preview that lights up her lock screen.

### About iMessage

There isn't one, and no service can honestly offer it. Apple publishes no API
for sending iMessage; anything advertising "iMessage sending" is a rented Mac
signed into an Apple ID, which is against Apple's terms and unreliable. Every
option here is SMS, so on an iPhone it arrives as a green bubble.

What you *can* control is that it reads as automated rather than personal. The
"Verification style" preset is written for that. Vonage also supports an
alphanumeric sender — the text shows up from `VERIFY` instead of a phone number,
which is exactly the look you're after. That's blocked for US numbers by
carrier rules, but works in much of the world.

## What's built in

- One security question instead of a password, so there is nothing for her to
  remember or write down that isn't already obvious to her and opaque to him
- Case-insensitive answers, rate limited, and indistinguishable from a bad link
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
