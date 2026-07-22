# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A zero-dependency Node.js CLI client for the PreCom Mobile API (`https://pre-com.nl/Mobile`), a pager/alarm/scheduling system. Entry point: `bin/precomcli.js` → `src/cli.js`.

## Commands

```
node bin/precomcli.js <command>          # run directly
npm install -g . && precomcli <command>  # or install globally
```

No build step, no test suite, no lint config currently exist. Requires Node >= 18 (relies on the built-in global `fetch`).

There are two independent UX modes sharing the same `PreComClient`/render code, with two independent storage strategies — do not conflate them when adding features:

- **Interactive menu** (`src/menu.js`, launched via `precomcli` with no args, `precomcli menu`, or `precomcli.ps1`) — a loop that never writes to the user's home directory. Its session (bearer token etc.) lives only in `src/tempSession.js`'s per-process temp dir and is deleted on exit/Ctrl+C/Ctrl+Break/window-close.
- **One-shot subcommands** (`login`/`status`/`groups`/`group-status`/`logout` in `src/cli.js`) — for scripting. These persist the token across separate invocations via `src/config.js` (`~/.precomcli/config.json`).

If you add a new API-backed action, implement it once as a `PreComClient` method in `src/api.js` and a renderer in `src/render.js`, then wire it into *both* `src/menu.js` (as a `MENU_ITEMS` entry) and `src/cli.js` (as a `cmdXxx` + `case`) if it makes sense in both places — don't duplicate formatting logic between them.

## Architecture

- `src/cli.js` — argv parsing (hand-rolled, no yargs/commander) and one-shot command dispatch (`login`/`logout`/`status`/`groups`/`group-status`/`help`), plus routing `menu`/no-args into `src/menu.js`.
- `src/menu.js` — the interactive menu loop (`runMenu`). Owns its own action handlers (`actionXxx`) and reads/writes session state exclusively through `tempSession`, never `config`.
- `src/api.js` — `PreComClient`: thin wrapper around `fetch` for the PreCom REST API. Add new endpoint methods here, not in `cli.js`/`menu.js`.
- `src/render.js` — output formatting shared by both modes (`renderStatus`, `renderGroups`, `renderOccupancy`); each takes an `{ json }` option. Add new renderers here rather than inlining `console.log`/`JSON.stringify` calls in `cli.js` or `menu.js`.
- `src/store.js` — generic JSON-file-backed key/value store (`createStore(filePath)` → `{load,save,clear}`). Backs both `config.js` and `tempSession.js`.
- `src/config.js` — the **persistent** store at `~/.precomcli/config.json`, used only by the one-shot subcommands.
- `src/tempSession.js` — the **ephemeral** per-process store under `%TEMP%\precomcli-sessions\<pid>-<timestamp>\session.json`, used only by the menu. Also owns `registerCleanupHandlers()` (hooks `exit`/`SIGINT`/`SIGBREAK`/`SIGHUP`/`SIGTERM`/`uncaughtException` to synchronously delete its dir) and `sweepStaleSessions()` (called at menu startup; deletes leftover session dirs whose owning PID is no longer alive — the fallback for when a hard kill skipped the normal cleanup handlers).
- `src/prompt.js` — a **single shared** `readline.Interface` (`ask`/`closePrompt`) reused across all prompts in a run, plus a raw-mode masked-password reader (`askHidden`) that pauses/resumes that shared interface while it's active. Do not revert to creating a new `readline.Interface` per prompt — that silently drops any stdin input already buffered ahead of the current line.
- `src/format.js` — low-level plain-text table/key-value printers (no chalk/table dependency), consumed by `render.js`.
- `precomcli.ps1` — thin launcher (`node bin\precomcli.js @args`) so the tool can be run directly in a PowerShell window (double-click / `.\precomcli.ps1`) without typing the `node bin/precomcli.js` path.
- `docs/swagger-v2.json` — cached copy of the upstream Swagger 2.0 spec (`GET /Mobile/swagger/docs/v2`). Consult this before adding new commands rather than re-fetching it; it documents ~90 endpoints (Account, Available, Capcode, Group, GroupChange, Information, Message, Piket, PreComMessage, Registration, SchedulerAppointment, Shiftwork, User) but only a handful (login, `GetUserInfo`, group listing/occupancy) are wired up so far.

## API notes (not obvious from the spec itself)

- Auth is OAuth2 Resource Owner Password Credentials: `POST {baseUrl}/Token` (form-encoded `grant_type=password&username=&password=`) — **not** documented as a path in the swagger spec itself (only referenced obliquely via `securityDefinitions.oauth2.authorizationUrl`, which points at a stale `localhost` dev URL). Authenticated calls then use `Authorization: Bearer <access_token>`.
- Every endpoint exists in both an unversioned form (`/api/User/...`) and a versioned form (`/api/v{version}/User/...`, currently `v2`). This CLI intentionally uses the unversioned routes for simplicity.
- Error bodies are JSON like `{"Message": "..."}` on failure but can also come back with an empty body (e.g. 403 with `Content-Length: 0`) — `PreComClient.request` and the error handling in `cli.js` account for both.
- `GetOccupancyLevels` returns an object keyed by ISO date string → integer level (positive = fully staffed, negative = short-staffed, 0 = exact), not an array.
