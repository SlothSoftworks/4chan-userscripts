# 4chan Captcha Helper Userscripts

Three standalone Tampermonkey userscripts that fix the most annoying part of
posting on 4chan: its captcha (`TCaptcha`) normally makes you drag a slider
through candidate images one at a time, memorizing each, to find the one
that matches a reference image. These scripts read the *entire* challenge
the moment it loads and show every candidate image for the current task at
once, so you can just look and click.

These three files are fully standalone and install-anywhere — nothing else
in this repo needs to be present for them to work.

## Requirements

- A userscript manager — [Tampermonkey](https://www.tampermonkey.net/) is
  what these were built and tested against; other managers (Violentmonkey,
  etc.) should work too since nothing here uses Tampermonkey-specific
  `GM_*` APIs (`@grant none` on all three).
- Works on `boards.4chan.org` and `boards.4channel.org`.

## Installation

Install Tampermonkey (or another userscript manager) for your browser first,
then click whichever script(s) you want below — Tampermonkey detects the
`.user.js` link and pops up its own install prompt automatically, no
copy-pasting required:

| Script                                        | Install                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **4chan Captcha Assistant**                  | [Install](https://raw.githubusercontent.com/lltrash94/4chan-userscripts/master/4chan-captcha-assistant.user.js)                                              |
| **4chan Fully Integrated Captcha Assistant** | [Install](https://raw.githubusercontent.com/lltrash94/4chan-userscripts/master/4chan-fully-integrated-captcha-assistant.user.js)                             |
| **Captcha Helper 4chanx Injector**           | [Install](https://raw.githubusercontent.com/lltrash94/4chan-userscripts/master/4chan-captcha-helper-4chanx-injector.user.js)                                 |

They're independent and safe to enable at the same time (each patches
`window.TCaptcha` separately, with its own internal guard, so they don't
conflict with each other or with real 4chan X if it's also installed).

Installing this way also wires up auto-update: each script points its
`@updateURL`/`@downloadURL` at this repo, so Tampermonkey periodically checks
for and applies newer versions on its own (see [CHANGELOG.md](CHANGELOG.md)
for what's changed).

**Manual install** (if your userscript manager doesn't auto-detect
`.user.js` links): open the Tampermonkey dashboard → **Create a new script**,
delete the placeholder content, paste in the full contents of the `.user.js`
file, and save (Ctrl+S). Note this won't auto-update — you'd need to repeat
this whenever the script changes.

## Which one should I install?

| Script                                             | Install this if...                                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **4chan Captcha Assistant**                  | You just want the captcha helper and nothing else to change about how you browse or post.                                                    |
| **4chan Fully Integrated Captcha Assistant** | You don't use 4chan X and want the leanest possible custom reply experience, with the captcha helper built in.                               |
| **Captcha Helper 4chanx Injector**           | You already use real 4chan X and want to keep every one of its features — this just adds the captcha helper into 4chan X's own reply popup. |

You can also just try the first one — it's the smallest, safest change, and
works regardless of what else you have installed.

---

## 1. 4chan Captcha Assistant

**File:** `4chan-captcha-assistant.user.js`

The minimal option. Doesn't touch 4chan's reply form — native or 4chan X's
— at all. A small floating panel appears in the bottom-right corner of the
page whenever a captcha challenge is active:

- Shows the reference prompt and **every candidate image for the current
  task at once**, instead of one at a time.
- Click an image to select it, then hit **Send** — this drives the real
  captcha widget directly (moves its slider, submits the answer, advances
  to the next task), exactly as if you'd dragged the slider and clicked
  Next yourself.
- Live countdown timer showing when the captcha will expire (~2 minutes,
  read from the real challenge data).
- Draggable (drag the header) and resizable (drag the corner) — position is
  remembered across page reloads.
- A ✕ button to dismiss it if you decide not to post.

Nothing about how you actually compose or submit your post changes — this
purely rides alongside whatever reply flow you're already using.

## 2. 4chan Fully Integrated Captcha Assistant

**File:** `4chan-fully-integrated-captcha-assistant.user.js`

Replaces 4chan's native reply form entirely with one custom floating panel
that handles the whole flow: composing, attaching a file, solving the
captcha (using the same helper as above, embedded directly in the panel
instead of floating separately), and submitting — built by talking to
4chan's real posting endpoint directly, not by driving the native form.

Extra features on top of the captcha helper:

- **Click a post number to quote it** — opens the panel with `>>postID`
  pre-filled, and if you had text selected elsewhere on the page when you
  clicked, that gets quoted too (each line prefixed with `>`).
- Draggable/resizable panel, position remembered, same as the minimal
  script.
- On successful post: the panel closes and the page scrolls to your new
  post (falls back to scrolling to the bottom of the page if 4chan's own
  thread updater hasn't picked up the new post yet — 4chan can be slow).
- Deletion password: uses your `4chan_pass` cookie if you're logged in,
  otherwise generates and remembers a random one so you can still delete
  your own posts later.

**Current scope/limitations:**

- Reply-to-thread only — doesn't support starting new threads yet (the
  native "Start a Thread" flow is left completely untouched on board
  index/catalog pages).
- No persisted name/email history, no multi-post queue, no drag-and-drop or
  paste-to-attach for files (use the "Attach file" button).

## 3. Captcha Helper 4chanx Injector

**File:** `4chan-captcha-helper-4chanx-injector.user.js`

**Requires real [4chan X](https://www.4chan-x.net/) already installed and
enabled.** This script doesn't replace or hide anything 4chan X does —
posting, identity, file attachment, all of 4chan X's own features work
exactly as normal. It only watches for 4chan X's own Quick Reply captcha
area and injects the same captcha-helper grid directly into it.

- Same preload-all-images / click-to-select / Send / countdown-timer
  behavior as the other two scripts, just living inside 4chan X's own
  popup instead of a separate floating panel.
- 4chan X's own raw captcha slider UI is hidden by default (so the grid
  reads as the primary captcha UI) — a checkbox lets you bring the
  original back if you want it.
- Since the real "Get Captcha" button gets hidden along with the rest of
  4chan X's captcha UI, this adds its own button that triggers the same
  underlying action (and respects the same loading/cooldown state 4chan X
  already enforces — it won't let you spam requests).

## How the captcha helper actually works

4chan's captcha (`TCaptcha`) is 4chan's own proprietary widget — not
reCAPTCHA or hCaptcha. When a challenge loads, `window.TCaptcha` receives
the *entire* set of candidate images for every task in the challenge up
front; the native widget just doesn't show them to you until you manually
drag the slider to each position. All three scripts hook a few of
`TCaptcha`'s own methods (never reimplementing or bypassing the captcha
itself) to read that data the moment it arrives and render it as a single
grid, and to drive the real slider/submit logic when you click Send —
functionally identical to solving it by hand, just without the one-at-a-
time guessing.

## Known limitations / things to know before using these

- **Not affiliated with 4chan or the 4chan X project.** Unofficial,
  community-made tools.
- **Automation note:** the Send button sets the real captcha slider's value
  directly rather than simulating a dragging gesture. The human still makes
  every actual solving decision (which image is correct) — nothing here
  guesses answers for you — but the low-level input pattern differs from a
  literal mouse drag. No evidence this matters, but worth knowing.
- Built against 4chan's current `TCaptcha` implementation. If 4chan changes
  their captcha system, these will need updating — check back here for
  updates if something stops working.
- The Fully Integrated script's real-post-submission logic was built by
  reading 4chan's actual request format directly (not guessed).
