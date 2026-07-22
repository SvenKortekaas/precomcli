const os = require('os');
const path = require('path');
const { createStore } = require('./store');

// Permanent, cross-invocation login cache used by the one-shot subcommands
// (login/status/groups/group-status/logout). The interactive menu does NOT
// use this - see tempSession.js for its ephemeral, auto-cleaned storage.
const CONFIG_FILE = path.join(os.homedir(), '.precomcli', 'config.json');

module.exports = { ...createStore(CONFIG_FILE), CONFIG_FILE };
