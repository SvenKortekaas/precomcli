# precomcli

Command-line client for the [PreCom](https://pre-com.nl) Mobile API.

## Requirements

- Node.js >= 18 (uses the built-in `fetch`)

No runtime dependencies. Tests run with `npm test` (Node's built-in
`node:test` runner — no dev dependencies either). See `CHANGELOG.md` for the
version history.

## Interactive menu (default)

Running the tool with no arguments — or double-clicking / running
`precomcli.ps1` in a PowerShell window — launches an interactive menu:

```
> .\precomcli.ps1
=== PreCom CLI ===
Session: not logged in

  1) Log in
  2) Messages
  3) Availability
  4) Groups
  5) Capcodes
  6) Pager
  7) Group changes
  8) Node info
  9) Reset password
  10) Log out
  0) Exit
```

`Messages`, `Availability`, `Groups`, `Capcodes`, `Pager`, and `Group changes`
open a submenu (`0` goes back to this top-level menu instead of exiting):

```
=== Messages ===             === Availability ===
  1) Send message              1) My status
  2) Message inbox             2) Mark myself available
  3) Alarm history             3) View scheduled availability (on-call)
  4) Respond to an alarm       4) Mark not available (block hours)
  5) Receivers                 5) Clear not-available markings
  6) Message templates         6) Add recurring schedule
  0) Back                      7) Set outside-region status
                                8) Update alert sounds
=== Groups ===                 9) View shift work
  1) My groups                 0) Back
  2) All groups
  3) Group occupancy         === Capcodes ===
  4) Understaffed days         1) View capcodes
  5) Group functions           2) Enable/disable a capcode
  6) On-call schedule          0) Back
  7) Service functions
     (roles + occupancy)     === Pager ===
  0) Back                      1) Find my pager (status)
                                2) Beep my pager
                                3) Provider status
                                0) Back
                              === Group changes ===
                                1) View my group changes
                                2) Add a group change
                                3) Remove a group change
                                0) Back
```

"Send message" walks you through picking a receiver and template by plain
list number (e.g. `1` or `1,3`) — no need to know any underlying IDs — then
shows a summary and asks for a final y/N confirmation before it actually
sends, since this reaches real pagers/alerts. The same "show a summary, ask
y/N" pattern applies to every other state-changing item in these submenus
(responding to an alarm, marking yourself available, adding/removing an
availability block, toggling a capcode) — nothing sends/changes anything
on the live system without an explicit confirmation.

This session's login is **never written to your home directory**. It's held
only in a per-window temp folder (under `%TEMP%\precomcli-sessions\`), and
that folder is deleted automatically when you:

- choose "Exit" from the menu,
- press Ctrl+C or Ctrl+Break,
- or close the PowerShell window itself.

As a safety net, if a session ever gets killed hard enough to skip that
cleanup (e.g. ending the process from Task Manager), the next time you start
`precomcli` it sweeps and deletes any leftover temp folders from processes
that are no longer running.

## One-shot commands (for scripting)

```
node bin/precomcli.js login [--username <user>] [--password <pass>] [--base-url <url>]
node bin/precomcli.js logout
node bin/precomcli.js status [--json]
node bin/precomcli.js groups [--all] [--json]
node bin/precomcli.js group-status <groupId> [--from <date>] [--to <date>] [--json]
node bin/precomcli.js receivers [--json]
node bin/precomcli.js templates [--json]
node bin/precomcli.js message --to <type:id[,type:id...]> (--text <message> | --template <id>)
                               [--priority] [--response] [--valid-from <iso-date-time>]
                               [--send-by <id>] [--json]
node bin/precomcli.js messages [--control-id b|f|g] [--json]
node bin/precomcli.js alarms [--msg-in-id <id>] [--previous-or-next <n>] [--json]
node bin/precomcli.js respond-alarm <msgInID> <yes|no>
node bin/precomcli.js available
node bin/precomcli.js schedule [--from <date>] [--to <date>] [--json]
node bin/precomcli.js schedule-add <date> <fromHour> <toHour>
node bin/precomcli.js schedule-remove <date> <fromHour> <toHour>
node bin/precomcli.js capcodes [--json]
node bin/precomcli.js capcode-toggle <capcodeId> (--enable|--disable)
node bin/precomcli.js understaffed-days <groupId> [--json]
node bin/precomcli.js functions <groupId> [--date <date>] [--json]
node bin/precomcli.js schedule-recurring <startDate> <endDate> <fromHour> <toHour>
                                          --weekdays <mon,tue,...> (--available|--unavailable)
                                          [--weekly <n>] [--clean-day-first]
node bin/precomcli.js outside-region <hours> (--enter|--exit)
node bin/precomcli.js sound [--alarm <name>] [--info <name>] [--understaffing <name>]
                             [--occupancy <name>] [--proposal <name>]
                             [--critical-alarm] [--critical-info] [--critical-understaffing]
                             [--critical-occupancy] [--critical-proposal]
node bin/precomcli.js reset-password <email>
node bin/precomcli.js info [--json]
node bin/precomcli.js group-change [--json]
node bin/precomcli.js group-changes [--json]
node bin/precomcli.js group-change-days <groupId> <date1,date2,...> [--group-user-id <id>]
node bin/precomcli.js group-change-period <groupId> <from> <to> [--group-user-id <id>]
node bin/precomcli.js group-change-recurring <groupId> <startTime> <stopTime>
                                              --weekdays <mon,tue,...> [--group-user-id <id>]
node bin/precomcli.js group-change-delete-type <groupId> <type>
node bin/precomcli.js group-change-delete
node bin/precomcli.js group-change-delete-one <groupUserId>
node bin/precomcli.js piket-schedule <groupId> [--from <date>] [--to <date>] [--json]
node bin/precomcli.js shifts [--json]
node bin/precomcli.js pager [--json]
node bin/precomcli.js beep-pager [--text <message>]
node bin/precomcli.js providers [--json]
node bin/precomcli.js service-functions <groupId> [--json]
```

Or install it as a global command:

```
npm install -g .
precomcli login
```

Unlike the menu, these commands are meant for scripting: `login` caches its
token **persistently** in `~/.precomcli/config.json` so you can run separate
commands one after another without logging in each time. Run `precomcli
logout` to clear it. The plaintext password itself is never stored, in
either mode.

- `status` — pulls the current user's status (`GetUserInfo`): availability,
  understaffing flags, home screen, etc.
- `groups` — lists the groups the current user belongs to today
  (`GetAllUserGroups`); pass `--all` to list every group in the organisation
  (`GetAllGroups`).
- `group-status <groupId>` — pulls per-day occupancy levels for a group
  (`GetOccupancyLevels`), defaulting to the next 7 days. Positive = enough
  people available, negative = short, 0 = exact.
- `receivers` — lists the users, groups, and message groups you're allowed to
  send messages to (`GetReceivers`), with the `Type`/`ID` values `message`'s
  `--to` flag expects.
- `templates` — lists canned message templates (`GetTemplates`), if your
  account has that permission.
- `message` — sends a message (`SendMessage`). `--to` takes one or more
  `<type>:<id>` pairs from `receivers` (comma-separated for multiple
  recipients, e.g. `--to 1:22548,2:9`); the message body comes from `--text`
  or, to reuse a canned message, `--template <id>` from `templates`.
  `--valid-from` defaults to right now if omitted. This command is for
  scripting and sends immediately with no confirmation prompt — use the
  interactive menu's "Send message" if you want a point-and-click picker
  with a confirmation step first.

  **You also need a `SendBy` ID.** This is a PreCom-internal sender
  identifier — **it is not your user ID**, and there's no API call that
  returns it.

  **Don't know yours? Let it auto-detect.** Run `message` without
  `--send-by` (or, in the interactive menu, pick "Send message") and press
  Enter at the SendBy prompt. It tries every ID from 1 to 255 in turn,
  showing a live `Trying sender ID N/255…` counter, and stops the moment
  one works — because only your real ID actually sends the message, every
  other value is rejected. The winning ID is then cached so it never asks
  again. (This sends your message exactly once, on the ID that works.)

  If you'd rather find it manually:

  1. Log into the web portal at https://portal.pre-com.nl/PreCom/Account/Login
     (separate login from the mobile app, same PreCom account).
  2. Open your browser's DevTools (F12) → **Network** tab → tick
     **"Preserve log"**.
  3. Send yourself a test message from the portal's messaging screen.
  4. Find the request to `PreComMsgLog/Submit` in the Network tab and look at
     its form data for `sentBy=<a number>`. That number is your `SendBy` ID.

  Pass it once with `--send-by <id>` or set `PRECOM_SEND_BY` in your
  environment, and `message` caches it in `~/.precomcli/config.json` so you
  never have to pass it again. In the interactive menu, "Send message" asks
  for it the first time and remembers it for the rest of that session.
- `messages` — lists messages sent to you (`GetMessages`); pass `--control-id
  b` for P2000 alarms only, `f` for GPRS messages only, or `g` for
  understaffing notifications only (default: everything).
- `alarms` — lists alarm log entries (`GetAlarmMessages`). With no flags,
  shows your single most recent alarm; `--msg-in-id <id>` together with a
  negative/positive `--previous-or-next` pages backward/forward from that
  alarm instead.
- `respond-alarm <msgInID> <yes|no>` — responds to an alarm
  (`SetAvailabilityForAlarmMessage`) with whether you're coming. Get the
  `msgInID` from `alarms`.
- `available` — makes you available right now: clears the manual "not
  available" toggle (`SetAvailable`) and, when your schedule has you marked
  not-available, also clears those markings for the rest of today
  (`DeleteUserSchedulerAppointment`). `SetAvailable` alone does nothing for
  schedule-driven unavailability — confirmed live.
- `schedule` — lists your scheduled availability (on-call) blocks
  (`GetUserSchedulerAppointments`), defaulting to the next 7 days. You are
  *available* while one of these blocks is active, and `status` reports
  "Not available: yes" when none is (and the manual toggle isn't set) —
  PreCom's own swagger mislabels these blocks as unavailability, but live
  testing confirmed the opposite.
- `schedule-add <date> <fromHour> <toHour>` — marks you NOT available for
  that range (`AddUserSchedulerAppointment` — despite its name, it punches a
  hole in your availability timeline; confirmed live), e.g.
  `schedule-add 2026-08-01 9 17`. Whole hours only; use 24 as `<toHour>` for
  midnight. Note: any write rounds that day's existing blocks to whole hours.
- `schedule-remove <date> <fromHour> <toHour>` — clears not-available
  markings in that range (`DeleteUserSchedulerAppointment`), so your
  scheduled availability there returns. It's a range operation, not an
  exact-match delete — any range works.
- `capcodes` — lists your capcodes (physical/virtual pagers) and whether
  each is enabled (`GetUserCapcodes`).
- `capcode-toggle <capcodeId> (--enable|--disable)` — enables or disables one
  of your capcodes (`UpdateUserCapcode`). **Disabling one may stop you
  receiving pages on it** — get the ID from `capcodes` first.
- `understaffed-days <groupId>` — short list of upcoming days a group doesn't
  have enough people available (`GetAllDaysNoOccupancy`). A quicker version
  of scanning `group-status`'s full table for the negative entries.
- `functions <groupId>` — lists a group's roles/functions (e.g. "Chauffeur",
  "Bevelvoerder") with how many people are needed and who's currently
  assigned to each (`GetAllFunctions`), for the given date (default: today).
- `schedule-recurring <startDate> <endDate> <fromHour> <toHour> --weekdays ... (--available|--unavailable)`
  — sets a recurring weekly availability window (`UpdateUserSchedulerPeriod`),
  e.g. `schedule-recurring 2026-09-01 2026-12-01 9 17 --weekdays mon,tue,wed,thu,fri --unavailable`
  for "unavailable 9-5 on weekdays, Sept through Dec". `--weekly` only has 2
  confirmed values (`1` = every week, the default; `2` = alternating weeks
  starting this week) — PreCom's own docs say more exist but don't say what.
- `outside-region <hours> (--enter|--exit)` — records that you've left or
  re-entered your service region (`SetOutsideRegion`) for `hours` hours;
  being outside marks you unavailable. Despite the name this does **not**
  need real GPS coordinates — that's a separate, unimplemented endpoint.
- `sound [--alarm <name>] [--info <name>] ...` — sets your alert sound
  preferences (`UpdateUserSound`). Only changes the flags you pass; anything
  you don't specify keeps its current value. Valid names: `silent`,
  `vibrate`, `chirp`, `chirp2x`, `chirp4x`, `beep_short`, `beep_short2x`,
  `beep_short3x`, `pager`, `pager2x`, `pager3x`, `pager6x`, `siren`,
  `siren2x`, `siren3x`, `siren6x`. The `--critical-*` flags turn on iOS
  critical alerts (bypass silent mode) for that category.
- `reset-password <email>` — triggers a password-reset email
  (`ResetPassword`). Unlike every other command, this one works even when
  you're **not** logged in — that's the point.
- `info` — node/organisation info (`GetInformation`).
- `group-change` / `group-changes` — view your current/first group change, or
  all of them (`GetGroupChange`/`GetAllGroupChanges`). A group change is a
  temporary reassignment to a different group than usual.
- `group-change-days <groupId> <dates>` — join `groupId` on specific dates
  (comma-separated `YYYY-MM-DD`), e.g.
  `group-change-days 3459 2026-08-10,2026-08-11`.
- `group-change-period <groupId> <from> <to>` — join `groupId` for a
  continuous period.
- `group-change-recurring <groupId> <startTime> <stopTime> --weekdays ...` —
  join `groupId` every week on the given weekdays, between `startTime` and
  `stopTime` (full date-times, not just hours).
- All three `group-change-*` commands above **add** a new group change by
  default. Pass `--group-user-id <id>` (the ID shown by `group-changes`) to
  **update** that specific one instead of creating another.
- `group-change-delete-type <groupId> <type>` / `group-change-delete` /
  `group-change-delete-one <groupUserId>` — three ways to remove a group
  change: by its `Type` field, the current/first one, or a specific one by
  ID. The interactive menu's "Remove a group change" always uses the by-ID
  form (safest, least ambiguous) — prefer `group-change-delete-one` unless
  you specifically need one of the other two.
- `piket-schedule <groupId>` — views your on-call schedule for a group
  (`GetSchedule`), defaulting to the next 30 days. **Read-only** — adding,
  updating, or claiming on-call slots isn't implemented yet; see `CLAUDE.md`
  for why.
- `shifts` — views your shift-work record (`GetShiftAppointments`).
  **Read-only** for the same reason as `piket-schedule`.
- `pager` — **find my pager**: your physical device's status (online/offline,
  battery, signal, serial, last-seen timestamps). Uses PreCom's newer
  `app.pre-com.nl` API (`GetPagerInfo`).
- `beep-pager [--text <message>]` — pages your **own** device so it beeps, to
  locate it (`SendMessageToMyself`; default text "Find my pager").
- `providers` — network-provider health (`GetProviderInformation`, `% online`).
- `service-functions <groupId>` — a group's roles with assigned users and
  occupancy day-totals (`GetAllServiceFunctions`).

  These four live on PreCom's separate `app.pre-com.nl` service (its own login
  realm — a Mobile-API token doesn't work there and vice-versa). `login` signs
  into it automatically with the **same** username/password; if your account
  isn't provisioned there, these four report that they're unavailable rather
  than failing cryptically.

## Web app (PWA)

For people without a Windows PC (or without Node), `web/` contains a
zero-dependency web version of the tool covering the core features: status +
availability (mark yourself available / not available), a collapsible group
overview showing every role (function) with everyone's live status and an
available/needed staffing badge (tap a member for their details — status,
roles, today's hour-by-hour availability — and to send them a direct
message), alarm history with per-alarm response,
message inbox + sending, capcode management, and a **Pager** tab (find-my-pager
device status, a "beep my pager" button, and network-provider health). It installs to the home screen on iOS and Android
("Add to Home Screen" / "Install app") and then looks and behaves like an app
— no app store, no Mac, no Xcode.

### Why a proxy is needed

Browsers block direct calls to `https://pre-com.nl` because PreCom's API sends
no CORS headers (verified live — there is no client-side workaround). The fix
is `worker/worker.js`: a ~150-line Cloudflare Worker (free tier) that relays
requests to PreCom and adds the CORS headers. It is deliberately built so that
running it is boring:

- **Stateless and credential-blind** — no storage, no KV, no logging. Your
  bearer token lives in your browser's localStorage and only passes *through*
  the Worker inside each request.
- **Not an open proxy** — the two upstreams (the Mobile API, plus
  `app.pre-com.nl` for the pager features, reached via an `/app` path prefix)
  are hardcoded and only an exact allowlist of known PreCom endpoints (with
  their exact HTTP methods) is forwarded. Client-supplied URLs are impossible.
- **Browser-only** — requests are rejected unless they come from an allowed
  `Origin` (edit `ALLOWED_ORIGINS` in `worker.js` to your own Pages origin).
- **Junk dies at the edge** — `/api` requests without a `Bearer` header are
  rejected before PreCom is ever contacted.

Operational notes: stay on the Workers **free** plan (hard daily request cap,
so abuse can cause at worst a day of outage, never a bill), enable 2FA on the
Cloudflare account (whoever controls the account could modify the Worker), and
optionally add a Cloudflare rate-limiting rule in front of it.

### Using it

Open <https://svenkortekaas.github.io/precomcli/> and log in with your normal
PreCom credentials — that's it. The app talks to PreCom through the project's
shared relay by default (`DEFAULT_PROXY` in `web/app.js`), and because the
relay is stateless, one deployment serves every user: your token only ever
passes *through* it inside your own requests. To send messages you also need
your sender ID (`SendBy`) — but if you don't know it, just leave it blank and
send: the app offers to auto-detect it (trying 1-255 with an on-page live
counter and a clear pass/fail result, only the correct one sends) and saves it. You can also set it under Settings — see
"One-shot commands" → `message` for how to find it manually (it is *not* your
user ID and the API cannot look it up).

On a phone, use "Add to Home Screen" (iOS Safari — tap Share ⬆︎; iOS never
shows an install prompt of its own, so the app shows a one-time hint) /
"Install app" (Android Chrome, where the app offers an Install button) to
get it as a full-screen app icon.

### Self-hosting (optional)

If you'd rather not route your traffic through the shared relay — or you fork
this repo — deploy your own copy:

1. **Worker**: Cloudflare dashboard → Workers & Pages → Create → import this
   repo (root directory `worker`, deploy command `npx wrangler deploy`) or
   paste `worker/worker.js`. Set `ALLOWED_ORIGINS` to your own Pages origin.
2. **Web app**: enable GitHub Pages on your fork (Settings → Pages → Source:
   "GitHub Actions"); `.github/workflows/pages.yml` publishes `web/` on every
   push that touches it. Point `DEFAULT_PROXY` in `web/app.js` at your Worker
   — or leave the code untouched and enter your Worker URL under "Advanced"
   on the login screen (also in Settings).

Notes: tokens are kept in localStorage under your `github.io` origin — other
GitHub Pages sites published from the *same GitHub account* share that origin,
so don't publish untrusted HTML to other repos' Pages on the same account. The
app is a starting point and covers a subset of the CLI's features; the CLI
remains the full-featured interface.

## API reference

A cached copy of the upstream Swagger 2.0 spec (`GET /Mobile/swagger/docs/v2`)
is kept at `docs/swagger-v2.json` for reference when adding more commands
(Piket's write endpoints, shift-work writes — see `CLAUDE.md` for why those
two are blocked, and for the reasoning behind everything already wired up).

Key facts about the API, derived from that spec:

- Base URL: `https://pre-com.nl/Mobile`
- Auth: OAuth2 Resource Owner Password Credentials grant —
  `POST {baseUrl}/Token` with form body `grant_type=password&username=&password=`,
  returns `access_token` (bearer, valid ~14 days).
- Authenticated requests send `Authorization: Bearer <token>`.
- Most endpoints exist in both an unversioned form (`/api/User/...`) and a
  versioned form (`/api/v{version}/User/...`); this CLI uses the unversioned
  routes.
