const tempSession = require('./tempSession');
const { PreComClient, PreComError, DEFAULT_BASE_URL } = require('./api');
const { ask, askHidden, closePrompt } = require('./prompt');
const render = require('./render');

function clientFromSession(data) {
  return new PreComClient({ baseUrl: data.baseUrl || DEFAULT_BASE_URL, token: data.token });
}

function requireAuth(data) {
  if (!data.token) {
    throw new PreComError('Not logged in. Choose "Log in" first.', 401);
  }
  if (data.expiresAt && Date.now() > data.expiresAt) {
    throw new PreComError('Session expired. Log in again.', 401);
  }
}

async function actionLogin() {
  const existing = tempSession.load();
  const baseUrl = existing.baseUrl || process.env.PRECOM_BASE_URL || DEFAULT_BASE_URL;
  const username = process.env.PRECOM_USERNAME || (await ask('Username: '));
  const password = process.env.PRECOM_PASSWORD || (await askHidden('Password: '));

  const client = new PreComClient({ baseUrl });
  const result = await client.login(username, password);

  tempSession.save({
    baseUrl,
    token: result.access_token,
    userName: result.userName,
    expiresAt: Date.now() + (result.expires_in ?? 0) * 1000,
  });

  console.log(`Logged in as ${result.userName}.`);
}

async function actionLogout() {
  const data = tempSession.load();
  if (data.token) {
    try {
      await clientFromSession(data).logoutRemote();
    } catch {
      // best effort; still clear the local session
    }
  }
  tempSession.clear();
  console.log('Logged out.');
}

async function actionStatus() {
  const data = tempSession.load();
  requireAuth(data);
  const info = await clientFromSession(data).getUserInfo();
  render.renderStatus(info);
}

async function actionMyGroups() {
  const data = tempSession.load();
  requireAuth(data);
  const groups = await clientFromSession(data).getAllUserGroups();
  render.renderGroups(groups);
}

async function actionAllGroups() {
  const data = tempSession.load();
  requireAuth(data);
  const groups = await clientFromSession(data).getAllGroups();
  render.renderGroups(groups);
}

async function actionReceivers() {
  const data = tempSession.load();
  requireAuth(data);
  const receivers = await clientFromSession(data).getReceivers();
  render.renderReceivers(receivers);
}

async function actionGroupOccupancy() {
  const data = tempSession.load();
  requireAuth(data);

  const groupId = await ask('Group ID: ');
  const today = new Date().toISOString().slice(0, 10);
  const inWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const from = (await ask(`From date [${today}]: `)) || today;
  const to = (await ask(`To date [${inWeek}]: `)) || inWeek;

  const levels = await clientFromSession(data).getOccupancyLevels(groupId, from, to);
  render.renderOccupancy(levels);
}

function sessionLine() {
  const data = tempSession.load();
  if (data.token && (!data.expiresAt || Date.now() < data.expiresAt)) {
    return `logged in as ${data.userName}`;
  }
  return 'not logged in';
}

const MENU_ITEMS = [
  { key: '1', label: 'Log in', action: actionLogin },
  { key: '2', label: 'My status', action: actionStatus },
  { key: '3', label: 'My groups', action: actionMyGroups },
  { key: '4', label: 'All groups', action: actionAllGroups },
  { key: '5', label: 'Group occupancy', action: actionGroupOccupancy },
  { key: '6', label: 'Users & groups (receivers)', action: actionReceivers },
  { key: '7', label: 'Log out', action: actionLogout },
];

function printMenu() {
  console.log('');
  console.log('=== PreCom CLI ===');
  console.log(`Session: ${sessionLine()}`);
  console.log('');
  for (const item of MENU_ITEMS) {
    console.log(`  ${item.key}) ${item.label}`);
  }
  console.log('  0) Exit');
  console.log('');
}

async function runMenu() {
  tempSession.sweepStaleSessions();
  tempSession.registerCleanupHandlers();

  console.log('precomcli - interactive session');
  console.log('All session data lives only in a temp folder for this window');
  console.log('and is deleted automatically when you exit or close the window.');

  for (;;) {
    printMenu();
    const choice = (await ask('Choose an option: ')).trim().toLowerCase();

    if (choice === '0' || choice === 'exit' || choice === 'q') {
      break;
    }

    const item = MENU_ITEMS.find((entry) => entry.key === choice);
    if (!item) {
      console.log('Unknown option.');
      continue;
    }

    try {
      await item.action();
    } catch (err) {
      console.error(`Error: ${err.message}`);
    }
  }

  closePrompt();
  tempSession.cleanup();
  console.log('Session data cleared. Goodbye.');
}

module.exports = { runMenu };
