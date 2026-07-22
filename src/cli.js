const config = require('./config');
const { PreComClient, PreComError, DEFAULT_BASE_URL } = require('./api');
const { ask, askHidden, closePrompt } = require('./prompt');
const render = require('./render');
const { runMenu } = require('./menu');

const HELP = `precomcli - CLI for the PreCom Mobile API (pre-com.nl)

Usage:
  precomcli                                interactive menu (default)
  precomcli menu                           same as above

  precomcli login [--username <user>] [--password <pass>] [--base-url <url>]
  precomcli logout
  precomcli status [--json]
  precomcli groups [--all] [--json]
  precomcli group-status <groupId> [--from <date>] [--to <date>] [--json]
  precomcli receivers [--json]
  precomcli help

The interactive menu keeps its login only in a temp folder for the
duration of that session and deletes it automatically on exit, Ctrl+C,
or when the PowerShell window is closed.

The one-shot commands above are for scripting: they cache a login token
persistently in ~/.precomcli/config.json (run "precomcli logout" to clear
it). Non-interactive login also accepts PRECOM_USERNAME, PRECOM_PASSWORD
and PRECOM_BASE_URL as env vars. The plaintext password is never stored
in either mode.`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function clientFromConfig(overrideBaseUrl) {
  const cfg = config.load();
  const baseUrl = overrideBaseUrl || cfg.baseUrl || DEFAULT_BASE_URL;
  return new PreComClient({ baseUrl, token: cfg.token });
}

function requireAuth(cfg) {
  if (!cfg.token) {
    throw new PreComError('Not logged in. Run "precomcli login" first.', 401);
  }
  if (cfg.expiresAt && Date.now() > cfg.expiresAt) {
    throw new PreComError('Session expired. Run "precomcli login" again.', 401);
  }
}

async function cmdLogin(args) {
  const baseUrl = args['base-url'] || process.env.PRECOM_BASE_URL || DEFAULT_BASE_URL;
  const username = args.username || process.env.PRECOM_USERNAME || (await ask('Username: '));
  const password = args.password || process.env.PRECOM_PASSWORD || (await askHidden('Password: '));

  const client = new PreComClient({ baseUrl });
  const result = await client.login(username, password);

  config.save({
    baseUrl,
    token: result.access_token,
    userName: result.userName,
    expiresAt: Date.now() + (result.expires_in ?? 0) * 1000,
  });

  console.log(`Logged in as ${result.userName}. Token cached in ${config.CONFIG_FILE}`);
}

async function cmdLogout() {
  const cfg = config.load();
  if (cfg.token) {
    const client = new PreComClient({ baseUrl: cfg.baseUrl, token: cfg.token });
    try {
      await client.logoutRemote();
    } catch {
      // best effort; still clear local session
    }
  }
  config.clear();
  console.log('Logged out.');
}

async function cmdStatus(args) {
  const cfg = config.load();
  requireAuth(cfg);
  const info = await clientFromConfig().getUserInfo();
  render.renderStatus(info, { json: Boolean(args.json) });
}

async function cmdGroups(args) {
  const cfg = config.load();
  requireAuth(cfg);
  const client = clientFromConfig();
  const groups = args.all ? await client.getAllGroups() : await client.getAllUserGroups();
  render.renderGroups(groups, { json: Boolean(args.json) });
}

async function cmdReceivers(args) {
  const cfg = config.load();
  requireAuth(cfg);
  const receivers = await clientFromConfig().getReceivers();
  render.renderReceivers(receivers, { json: Boolean(args.json) });
}

async function cmdGroupStatus(args) {
  const groupId = args._[0];
  if (!groupId) {
    throw new Error('Usage: precomcli group-status <groupId> [--from <date>] [--to <date>]');
  }
  const cfg = config.load();
  requireAuth(cfg);
  const client = clientFromConfig();

  const today = new Date();
  const inWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const from = args.from || today.toISOString().slice(0, 10);
  const to = args.to || inWeek.toISOString().slice(0, 10);

  const levels = await client.getOccupancyLevels(groupId, from, to);
  render.renderOccupancy(levels, { json: Boolean(args.json) });
}

async function main() {
  const [, , command, ...rest] = process.argv;
  const args = parseArgs(rest);

  try {
    switch (command) {
      case undefined:
      case 'menu':
        await runMenu();
        break;
      case 'login':
        await cmdLogin(args);
        break;
      case 'logout':
        await cmdLogout(args);
        break;
      case 'status':
        await cmdStatus(args);
        break;
      case 'groups':
        await cmdGroups(args);
        break;
      case 'group-status':
        await cmdGroupStatus(args);
        break;
      case 'receivers':
        await cmdReceivers(args);
        break;
      case 'help':
      case '--help':
      case '-h':
        console.log(HELP);
        break;
      default:
        console.error(`Unknown command: ${command}\n`);
        console.log(HELP);
        process.exitCode = 1;
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    closePrompt();
  }
}

module.exports = { main };
