# Changelog

All notable changes to this project are documented here.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/).
This project predates formal release tagging, so early entries group work by
feature area rather than by a tagged release.

## [Unreleased]

### Fixed
- **Availability was reported inverted** for accounts with an on-call roster.
  A live A/B test against the official app (2026-07-22) proved that scheduler
  appointments are *availability* (on-call) blocks — not unavailability, as
  PreCom's own `GetUserSchedulerAppointments` swagger summary wrongly claims —
  and that `NotAvailalbeScheduled` is inverted from its name (true = a
  scheduled availability block is active, i.e. the user IS available).
  `isNotAvailable` (CLI + web app), the `schedule`/`schedule-add`/
  `schedule-remove` help/output text, and the menu's Availability submenu
  labels/prompts all now reflect the real semantics.

### Added
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
