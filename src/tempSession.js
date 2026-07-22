const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('./store');

// Ephemeral, per-process session storage for the interactive menu.
// Lives entirely under the OS temp dir and is deleted as soon as this
// process exits, however it exits: normal exit, Ctrl+C, Ctrl+Break, or the
// PowerShell window being closed. Nothing the menu does is ever written to
// the user's home directory.
const ROOT = path.join(os.tmpdir(), 'precomcli-sessions');
const SESSION_DIR = path.join(ROOT, `${process.pid}-${Date.now()}`);
const SESSION_FILE = path.join(SESSION_DIR, 'session.json');

const store = createStore(SESSION_FILE);

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  try {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
  } catch {
    // best effort - e.g. a file briefly locked on Windows
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but we can't signal it - treat as alive.
    return err.code === 'EPERM';
  }
}

// Removes leftover session dirs from previous runs that never got to clean
// up after themselves (e.g. killed via Task Manager instead of closing the
// window normally). Safe to run alongside other concurrently open windows:
// it only deletes dirs whose owning PID is no longer running.
function sweepStaleSessions() {
  let entries;
  try {
    entries = fs.readdirSync(ROOT);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(ROOT, entry);
    if (full === SESSION_DIR) continue;
    const pid = Number.parseInt(entry.split('-')[0], 10);
    if (Number.isInteger(pid) && isProcessAlive(pid)) continue;
    try {
      fs.rmSync(full, { recursive: true, force: true });
    } catch {
      // ignore - e.g. a race with another sweep
    }
  }
}

// Covers: normal exit, Ctrl+C (SIGINT), Ctrl+Break (SIGBREAK, Windows-only),
// and the console window being closed (Windows translates that to SIGHUP
// for the process, via libuv/Node's console control handler).
function registerCleanupHandlers() {
  process.on('exit', cleanup);

  const exitOnSignal = (code) => () => {
    cleanup();
    process.exit(code);
  };
  process.on('SIGINT', exitOnSignal(130));
  process.on('SIGBREAK', exitOnSignal(130));
  process.on('SIGHUP', exitOnSignal(129));
  process.on('SIGTERM', exitOnSignal(143));

  process.on('uncaughtException', (err) => {
    console.error(`\nFatal error: ${err.message}`);
    cleanup();
    process.exit(1);
  });
}

module.exports = {
  ...store,
  SESSION_DIR,
  SESSION_FILE,
  cleanup,
  sweepStaleSessions,
  registerCleanupHandlers,
};
