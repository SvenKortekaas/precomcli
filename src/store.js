const fs = require('fs');
const path = require('path');

// A tiny JSON-file-backed key/value store. Used both for the permanent
// per-user config (~/.precomcli/config.json) and for ephemeral per-session
// temp files (see tempSession.js) - same read/write/clear shape either way.
function createStore(filePath) {
  return {
    filePath,
    load() {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch {
        return {};
      }
    },
    save(data) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
    },
    clear() {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // nothing to clear
      }
    },
  };
}

module.exports = { createStore };
