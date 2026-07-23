# Changelog

All notable changes to this project are documented here.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/).
This project predates formal release tagging, so early entries group work by
feature area rather than by a tagged release.

## [Unreleased]

### Added
- **Auto-detect the `SendBy` sender ID** when you don't know it. The `SendBy`
  ID is a PreCom-internal identifier that isn't your user ID and can't be
  looked up via the API, which previously meant non-technical users couldn't
  send messages without manually capturing it from the web portal. Now, when
  no `SendBy` is set, `message` (CLI), the interactive menu's "Send message",
  and the web app all offer to brute-force it: they try IDs 0-255 in turn with
  a live `Trying sender ID N/255…` counter and stop at the first that works —
  only the correct ID actually sends the message, so exactly one message is
  sent, on the winning ID. The discovered value is then cached (config /
  session / localStorage) so it's never asked again. Backed by the new
  `PreComClient.findSendByAndSend()` (`src/api.js`), duplicated as
  `findSendByAndSend`/`sendResolvingSendBy` in `web/app.js`.

### Fixed
- **The whole availability model was decoded live (2026-07-22) and everything
  now matches it.** Findings: `GetUserSchedulerAppointments` returns your
  *availability* (on-call) timeline (its swagger summary claims the
  opposite); `NotAvailalbeScheduled` is inverted from its name (true = an
  availability block is active = you ARE available); the write endpoints are
  *range* operations — `Add...` marks a range NOT available (punches a hole),
  `Delete...` clears such markings (availability returns); and `SetAvailable`
  does nothing for schedule-driven unavailability. Fixed accordingly:
  `isNotAvailable` (CLI + web), `available` now uses the new
  `PreComClient.makeAvailable()` composite that actually works, the web app's
  Home gained working "Mark me available" / "Mark not available (1-8h / rest
  of today)" actions, `schedule-add`/`schedule-remove` and the menu flows are
  relabeled to their real not-available direction (with `24` accepted as an
  end hour via `toEndTimeSpan`), and the menu's remove flow takes an explicit
  range instead of picking blocks (Delete is a range-clear, not an
  exact-match delete — the old whole-hour-only refusal is obsolete).

### Fixed (web app)
- Groups: member status dots were all red — `NotAvailalbeScheduled` is not
  populated for the user objects inside `GetAllFunctions`, so availability is
  now derived from each member's per-hour `SchedulerDays` map (plus the
  manual `NotAvailable` toggle).
- Alarms: the "I'm coming / Not coming" buttons now only appear within 2
  minutes of the alarm's timestamp — responding to an old alarm isn't
  meaningful.

### Added
- Web app: an "Install as app" card in Settings — Install button where the
  browser supports prompting, platform-appropriate instructions otherwise.
- Web app: install support — iOS gets the Apple meta tags for a proper
  full-screen Home Screen app plus a one-time "tap Share → Add to Home
  Screen" hint (iOS has no native install prompt); Chromium browsers get a
  real Install button via `beforeinstallprompt`.
- Web app: group members are clickable — a detail modal shows their status,
  roles, manual-toggle info, and today's hour-by-hour availability strip,
  plus a box to send them a direct message.
- Web app: a Groups tab — collapsible cards per group, each showing every
  role (`GetAllFunctions`) with an available/needed staffing badge and all
  members sorted available-first with a live status dot.
- The web app now defaults to the project's shared relay (`DEFAULT_PROXY`),
  so users just open the site and log in — no per-user Cloudflare Worker
  needed. Self-hosters can still override the proxy URL via the login
  screen's "Advanced" section or Settings.
- Web app (PWA) in `web/` — a browser/mobile version of the tool (status +
  availability, alarms with per-alarm response, message inbox/sending, capcode
  management), installable to the home screen on iOS/Android. Published to
  GitHub Pages via `.github/workflows/pages.yml`.
- `worker/worker.js` — stateless Cloudflare Worker CORS proxy the web app
  needs (PreCom's API sends no CORS headers): hardcoded upstream, exact
  endpoint/method allowlist, origin allowlist, no storage or logging.
- Test suite using the built-in `node:test` runner (no dependencies): covers the
  pure functions that carry real logic — `parseReceivers`, `toTimeSpan`,
  `parseWeekdays`, `buildSoundPayload`, `isNotAvailable`, `groupChangeSummary`,
  `occupancyLabel`, and `parseArgs`. Run with `npm test`.
- `parseArgs` now supports the `--flag=value` form in addition to `--flag value`.
- `.editorconfig` capturing the existing 2-space / LF / trailing-newline style.

### Changed
- Extracted the per-command auth/client boilerplate in `src/cli.js` into a single
  `authed()` helper, so a new command can't accidentally skip the session check.
- `PreComClient.request` gained an `{ auth: false }` option; `resetPassword` now
  reuses it instead of hand-rolling its own fetch/parse — so unauthenticated
  endpoints get the same error-detail surfacing (`ExceptionMessage`/`ModelState`)
  as every other call.
- The 10-field `UpdateUserSound` payload is now built by one shared
  `buildSoundPayload` helper instead of being duplicated between the one-shot
  `sound` command and the interactive menu.

### Fixed
- `parseArgs` no longer misreads a value after a known boolean flag: `--priority`,
  `--json`, etc. are always switches, so `--priority false` can't be silently read
  as truthy, and a boolean flag before a positional no longer swallows it.

## Group changes, on-call & shift-work viewing

### Added
- Full CRUD for group changes (temporarily joining another group): `group-change`,
  `group-changes`, `group-change-days`/`-period`/`-recurring` (add or update via
  `--group-user-id`), and three delete variants. Interactive "Group changes" submenu.
- Read-only Piket on-call schedule (`piket-schedule`) and shift-work viewing
  (`shifts`). Write endpoints intentionally omitted — see `CLAUDE.md`.

## Availability, capcodes, sounds & more

### Added
- Availability: `available`, `schedule`/`schedule-add`/`schedule-remove`,
  `schedule-recurring`, `outside-region`, `sound`.
- Capcodes: `capcodes`, `capcode-toggle`.
- Groups: `understaffed-days`, `functions`.
- Account/system: `reset-password`, `info`.
- Interactive menu restructured into submenus as the command count grew.

### Fixed
- Status under-reported unavailability: `NotAvailable` alone misses a scheduled
  block. `isNotAvailable` now ORs it with `NotAvailalbeScheduled` (PreCom's own
  typo), with a fallback to a corrected spelling.

## Messaging

### Added
- Send and view messages, alarm history, alarm response, receivers, templates.

### Fixed
- `SendMessage` 500: root-caused to an undocumented `SendBy` sender ID (not the
  user's ID, and not derivable via the API). Now prompted for once and cached.

## Initial release

### Added
- Zero-dependency Node CLI for the PreCom Mobile API: `login`/`logout`, `status`,
  `groups`, `group-status`. Interactive menu and one-shot scripting modes with
  separate session storage strategies.
