# precomcli

Command-line client for the [PreCom](https://pre-com.nl) Mobile API.

## Requirements

- Node.js >= 18 (uses the built-in `fetch`)

## Interactive menu (default)

Running the tool with no arguments — or double-clicking / running
`precomcli.ps1` in a PowerShell window — launches an interactive menu:

```
> .\precomcli.ps1
=== PreCom CLI ===
Session: not logged in

  1) Log in
  2) My status
  3) My groups
  4) All groups
  5) Group occupancy
  6) Log out
  0) Exit
```

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

## API reference

A cached copy of the upstream Swagger 2.0 spec (`GET /Mobile/swagger/docs/v2`)
is kept at `docs/swagger-v2.json` for reference when adding more commands
(messages, availability, piket schedules, shift work, etc.).

Key facts about the API, derived from that spec:

- Base URL: `https://pre-com.nl/Mobile`
- Auth: OAuth2 Resource Owner Password Credentials grant —
  `POST {baseUrl}/Token` with form body `grant_type=password&username=&password=`,
  returns `access_token` (bearer, valid ~14 days).
- Authenticated requests send `Authorization: Bearer <token>`.
- Most endpoints exist in both an unversioned form (`/api/User/...`) and a
  versioned form (`/api/v{version}/User/...`); this CLI uses the unversioned
  routes.
