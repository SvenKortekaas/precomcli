const tempSession = require('./tempSession');
const {
  PreComClient,
  PreComError,
  DEFAULT_BASE_URL,
  toTimeSpan,
  toEndTimeSpan,
  parseWeekdays,
  buildSoundPayload,
  VALID_SOUNDS,
  SOUND_CATEGORIES,
} = require('./api');
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

async function confirm(promptText) {
  return (await ask(promptText)).trim().toLowerCase() === 'y';
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

async function actionTemplates() {
  const data = tempSession.load();
  requireAuth(data);
  const templates = await clientFromSession(data).getTemplates();
  render.renderTemplates(templates);
}

// Parses "1" or "1,3" against a 1-based displayed list. Returns the selected
// items, or null (after printing why) if the input is empty or out of range.
function pickByNumber(list, input, itemNoun) {
  const picks = input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (picks.length === 0) {
    console.log('Cancelled: nothing selected.');
    return null;
  }
  const selected = [];
  for (const pick of picks) {
    const n = Number(pick);
    if (!Number.isInteger(n) || n < 1 || n > list.length) {
      console.log(`Cancelled: "${pick}" isn't one of the numbered ${itemNoun} above.`);
      return null;
    }
    selected.push(list[n - 1]);
  }
  return selected;
}

async function actionSendMessage() {
  const data = tempSession.load();
  requireAuth(data);
  const client = clientFromSession(data);

  const receivers = await client.getReceivers();
  if (receivers.length === 0) {
    console.log('No receivers available for this account.');
    return;
  }
  console.log('');
  console.log('Who do you want to message?');
  render.renderReceiverPicker(receivers);
  const receiverPick = await ask('Enter number(s), comma-separated (e.g. 1 or 1,3): ');
  const selected = pickByNumber(receivers, receiverPick, 'receivers');
  if (!selected) return;

  let message;
  const templates = await client.getTemplates();
  if (templates.length > 0) {
    console.log('');
    console.log('Use a template, or write your own message:');
    render.renderTemplatePicker(templates);
    const templatePick = await ask('Enter a template number, or press Enter to write your own: ');
    if (templatePick) {
      const picked = pickByNumber(templates, templatePick, 'templates');
      if (!picked) return;
      message = picked[0].Text;
    }
  }
  if (!message) {
    message = await ask('Message text: ');
  }
  if (!message) {
    console.log('Cancelled: no message text given.');
    return;
  }

  const priority = await confirm('Priority message? (y/N): ');
  const response = await confirm('Response required? (y/N): ');

  let sendBy = data.sendBy;
  let autoDetect = false;
  if (!sendBy) {
    const answer = await ask(
      'SendBy ID (your PreCom sender ID - NOT your user ID). ' +
        "If you don't know it, press Enter to auto-detect it (tries 1-255, sends once found): "
    );
    if (answer.trim() === '') {
      autoDetect = true;
    } else {
      sendBy = Number(answer);
      if (!Number.isInteger(sendBy)) {
        console.log('Cancelled: SendBy must be an integer.');
        return;
      }
      tempSession.save({ ...data, sendBy });
    }
  }

  console.log('');
  console.log('About to send:');
  console.log(`  To:       ${selected.map((r) => `${render.receiverTypeLabel(r.Type)} ${r.Label}`).join(', ')}`);
  console.log(`  Message:  ${message}`);
  console.log(`  Priority: ${priority ? 'yes' : 'no'}`);
  console.log(`  Response: ${response ? 'yes' : 'no'}`);
  if (autoDetect) {
    console.log("  SendBy:   auto-detect (will try 1-255 until it's found)");
  }
  if (!(await confirm('Send this message? (y/N): '))) {
    console.log('Cancelled.');
    return;
  }

  const preComMsg = {
    Message: message,
    Receivers: selected,
    Priority: priority,
    Response: response,
    ValidFrom: new Date().toISOString(),
  };

  if (autoDetect) {
    // Brute-force the sender ID for a user who doesn't know theirs. Only the
    // correct SendBy succeeds, so this both finds it and sends the message.
    const found = await client.findSendByAndSend(preComMsg, {
      onProgress: (current, max) => process.stdout.write(`\rTrying sender ID ${current}/${max}...`),
    });
    process.stdout.write('\n');
    tempSession.save({ ...tempSession.load(), sendBy: found.sendBy });
    console.log(`Found your sender ID: ${found.sendBy} (saved for this session).`);
  } else {
    await client.sendMessage({ ...preComMsg, SendBy: sendBy });
  }
  console.log(`Message sent to ${selected.length} receiver(s).`);
}

async function actionMessageInbox() {
  const data = tempSession.load();
  requireAuth(data);
  const messages = await clientFromSession(data).getMessages();
  render.renderMessages(messages);
}

async function actionAlarmHistory() {
  const data = tempSession.load();
  requireAuth(data);
  const alarms = await clientFromSession(data).getAlarmMessages(0, 0);
  render.renderAlarmMessages(alarms);
}

async function actionRespondToAlarm() {
  const data = tempSession.load();
  requireAuth(data);
  const client = clientFromSession(data);

  const alarms = await client.getAlarmMessages(0, 0);
  if (alarms.length === 0) {
    console.log('No alarm history available.');
    return;
  }
  console.log('');
  console.log('Recent alarms:');
  render.renderAlarmMessages(alarms);
  const pick = await ask('Alarm ID to respond to (from the ID column above): ');
  const msgInID = Number(pick);
  const alarm = alarms.find((a) => a.MsgInID === msgInID);
  if (!alarm) {
    console.log(`Cancelled: "${pick}" is not one of the alarm IDs above.`);
    return;
  }

  const answer = (await ask('Respond "yes" (coming) or "no" (not coming): ')).trim().toLowerCase();
  if (answer !== 'yes' && answer !== 'no') {
    console.log('Cancelled: please answer "yes" or "no".');
    return;
  }

  console.log('');
  console.log(`About to respond "${answer}" to: ${alarm.Text}`);
  if (!(await confirm('Confirm? (y/N): '))) {
    console.log('Cancelled.');
    return;
  }
  await client.setAvailabilityForAlarmMessage(msgInID, answer === 'yes');
  console.log(`Responded "${answer}".`);
}

async function actionSetAvailable() {
  const data = tempSession.load();
  requireAuth(data);
  if (!(await confirm('Mark yourself as available now? (y/N): '))) {
    console.log('Cancelled.');
    return;
  }
  const actions = await clientFromSession(data).makeAvailable();
  if (actions.length === 0) {
    console.log('You were already available — nothing to change.');
  } else {
    console.log(`Done (${actions.join('; ')}). You are now marked as available.`);
  }
}

async function actionViewSchedule() {
  const data = tempSession.load();
  requireAuth(data);
  const today = new Date().toISOString().slice(0, 10);
  const inWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const from = (await ask(`From date [${today}]: `)) || today;
  const to = (await ask(`To date [${inWeek}]: `)) || inWeek;
  const appointments = await clientFromSession(data).getUserSchedulerAppointments(from, to);
  render.renderSchedulerAppointments(appointments);
}

async function actionAddScheduleBlock() {
  const data = tempSession.load();
  requireAuth(data);
  const client = clientFromSession(data);

  const date = await ask('Date to be NOT available (YYYY-MM-DD): ');
  const fromHour = await ask('From hour (0-23): ');
  const toHour = await ask('To hour (1-24, 24 = midnight): ');
  if (!date || fromHour === '' || toHour === '') {
    console.log('Cancelled.');
    return;
  }
  let fromTs;
  let toTs;
  try {
    fromTs = toTimeSpan(fromHour);
    toTs = toEndTimeSpan(toHour);
  } catch (err) {
    console.log(`Cancelled: ${err.message}`);
    return;
  }

  console.log('');
  console.log(`About to mark yourself NOT AVAILABLE on ${date} from ${fromHour}:00 to ${toHour}:00.`);
  if (!(await confirm('Confirm? (y/N): '))) {
    console.log('Cancelled.');
    return;
  }
  await client.addUserSchedulerAppointment(date, fromTs, toTs);
  console.log('Done — you are NOT available during that range.');
}

async function actionRemoveScheduleBlock() {
  const data = tempSession.load();
  requireAuth(data);
  const client = clientFromSession(data);

  console.log('This clears NOT-available markings in a time range, so your scheduled');
  console.log('availability (on-call) there returns. Current blocks for context:');
  const today = new Date().toISOString().slice(0, 10);
  const inWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  render.renderSchedulerAppointments(await client.getUserSchedulerAppointments(today, inWeek));

  const date = await ask('Date (YYYY-MM-DD): ');
  const fromHour = await ask('From hour (0-23): ');
  const toHour = await ask('To hour (1-24, 24 = midnight): ');
  if (!date || fromHour === '' || toHour === '') {
    console.log('Cancelled.');
    return;
  }
  let fromTs;
  let toTs;
  try {
    fromTs = toTimeSpan(fromHour);
    toTs = toEndTimeSpan(toHour);
  } catch (err) {
    console.log(`Cancelled: ${err.message}`);
    return;
  }

  console.log('');
  console.log(`About to clear not-available markings on ${date} from ${fromHour}:00 to ${toHour}:00 (you become available there).`);
  if (!(await confirm('Confirm? (y/N): '))) {
    console.log('Cancelled.');
    return;
  }
  await client.deleteUserSchedulerAppointment(date, fromTs, toTs);
  console.log('Done — your availability in that range is restored.');
}

async function actionAddRecurringSchedule() {
  const data = tempSession.load();
  requireAuth(data);
  const client = clientFromSession(data);

  const startDate = await ask('Start date (YYYY-MM-DD): ');
  const endDate = await ask('End date (YYYY-MM-DD): ');
  const fromHour = await ask('From hour (0-23): ');
  const toHour = await ask('To hour (0-23): ');
  const weekdaysInput = await ask('Weekdays (comma-separated, e.g. mon,tue,wed): ');
  const availableAnswer = (
    await ask('During this window, mark yourself available (a) or unavailable (u)? (a/u): ')
  )
    .trim()
    .toLowerCase();

  if (
    !startDate ||
    !endDate ||
    fromHour === '' ||
    toHour === '' ||
    !weekdaysInput ||
    (availableAnswer !== 'a' && availableAnswer !== 'u')
  ) {
    console.log('Cancelled.');
    return;
  }

  let weekDays;
  let fromTs;
  let toTs;
  try {
    weekDays = parseWeekdays(weekdaysInput);
    fromTs = toTimeSpan(fromHour);
    toTs = toTimeSpan(toHour);
  } catch (err) {
    console.log(`Cancelled: ${err.message}`);
    return;
  }
  const available = availableAnswer === 'a';

  console.log('');
  console.log(
    `About to set every ${weekdaysInput}, ${startDate} to ${endDate}, ${fromHour}:00-${toHour}:00, ` +
      `as ${available ? 'AVAILABLE' : 'UNAVAILABLE'}. (Repeats every week - use the one-shot ` +
      '"schedule-recurring" command with --weekly if you need alternating weeks.)'
  );
  if (!(await confirm('Confirm? (y/N): '))) {
    console.log('Cancelled.');
    return;
  }
  await client.updateUserSchedulerPeriod(startDate, endDate, fromTs, toTs, available, weekDays, 1, false);
  console.log('Recurring schedule updated.');
}

async function actionSetOutsideRegion() {
  const data = tempSession.load();
  requireAuth(data);
  const client = clientFromSession(data);

  const hours = await ask('Hours: ');
  const answer = (await ask('Entering (e) or exiting (x) the region? (e/x): ')).trim().toLowerCase();
  if (!hours || (answer !== 'e' && answer !== 'x')) {
    console.log('Cancelled.');
    return;
  }
  const region = answer === 'e' ? 'ENTER' : 'EXIT';

  console.log('');
  console.log(`About to set outside-region status: ${region} for ${hours} hour(s).`);
  if (!(await confirm('Confirm? (y/N): '))) {
    console.log('Cancelled.');
    return;
  }
  await client.setOutsideRegion(Number(hours), region);
  console.log('Outside-region status updated.');
}

async function actionUpdateSound() {
  const data = tempSession.load();
  requireAuth(data);
  const client = clientFromSession(data);
  const info = await client.getUserInfo();

  console.log('');
  console.log('Current sound settings:');
  console.log(`  Alarm:         ${info.SoundAlarm}`);
  console.log(`  Info:          ${info.SoundInfo}`);
  console.log(`  Understaffing: ${info.SoundUnderstaffing}`);
  console.log(`  Occupancy:     ${info.SoundOccupancy}`);
  console.log(`  Proposal:      ${info.SoundProposal}`);
  console.log('');
  console.log(`Valid sounds: ${VALID_SOUNDS.join(', ')}`);

  const categories = Object.keys(SOUND_CATEGORIES);
  const category = (await ask(`Which to change? (${categories.join('/')}): `)).trim().toLowerCase();
  const fieldNames = SOUND_CATEGORIES[category];
  if (!fieldNames) {
    console.log('Cancelled: unknown category.');
    return;
  }
  const newSound = await ask(`New sound for ${category} [${info[fieldNames.sound]}]: `);
  if (!newSound) {
    console.log('Cancelled.');
    return;
  }
  if (!VALID_SOUNDS.includes(newSound)) {
    console.log(`Cancelled: "${newSound}" is not a valid sound. Valid: ${VALID_SOUNDS.join(', ')}`);
    return;
  }

  if (!(await confirm(`Set ${category} sound to "${newSound}"? (y/N): `))) {
    console.log('Cancelled.');
    return;
  }
  await client.updateUserSound(buildSoundPayload(info, { [category]: newSound }));
  console.log('Sound settings updated.');
}

async function actionViewShiftWork() {
  const data = tempSession.load();
  requireAuth(data);
  const shiftWork = await clientFromSession(data).getShiftAppointments();
  render.renderShiftAppointments(shiftWork);
}

async function actionViewCapcodes() {
  const data = tempSession.load();
  requireAuth(data);
  const capcodes = await clientFromSession(data).getUserCapcodes();
  render.renderCapcodes(capcodes);
}

async function actionToggleCapcode() {
  const data = tempSession.load();
  requireAuth(data);
  const client = clientFromSession(data);

  const capcodes = await client.getUserCapcodes();
  if (capcodes.length === 0) {
    console.log('No capcodes on this account.');
    return;
  }
  console.log('');
  render.renderCapcodePicker(capcodes);
  const pick = await ask('Enter the number of the capcode to toggle: ');
  const selected = pickByNumber(capcodes, pick, 'capcodes');
  if (!selected) return;
  const capcode = selected[0];
  const newState = !capcode.Enable;

  console.log('');
  console.log(`About to ${newState ? 'ENABLE' : 'DISABLE'} capcode ${capcode.CapcodeId} (${capcode.Description}).`);
  if (!newState) {
    console.log('Warning: disabling a capcode may stop you receiving pages on it.');
  }
  if (!(await confirm('Confirm? (y/N): '))) {
    console.log('Cancelled.');
    return;
  }
  await client.updateUserCapcode(capcode.CapcodeId, newState);
  console.log(`Capcode ${capcode.CapcodeId} ${newState ? 'enabled' : 'disabled'}.`);
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

async function actionUnderstaffedDays() {
  const data = tempSession.load();
  requireAuth(data);
  const groupId = await ask('Group ID: ');
  const dates = await clientFromSession(data).getAllDaysNoOccupancy(groupId);
  render.renderDaysNoOccupancy(dates);
}

async function actionGroupFunctions() {
  const data = tempSession.load();
  requireAuth(data);
  const groupId = await ask('Group ID: ');
  const today = new Date().toISOString().slice(0, 10);
  const date = (await ask(`Date [${today}]: `)) || today;
  const group = await clientFromSession(data).getAllFunctions(groupId, date);
  render.renderFunctions(group);
}

async function actionOnCallSchedule() {
  const data = tempSession.load();
  requireAuth(data);
  const client = clientFromSession(data);
  const info = await client.getUserInfo();
  const groupId = await ask('Group ID: ');
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const from = (await ask(`From date [${today}]: `)) || today;
  const to = (await ask(`To date [${in30}]: `)) || in30;
  const items = await client.getPiketSchedule(info.UserID, groupId, from, to);
  render.renderPiketSchedule(items);
}

async function actionResetPassword() {
  const existing = tempSession.load();
  const baseUrl = existing.baseUrl || process.env.PRECOM_BASE_URL || DEFAULT_BASE_URL;
  const email = await ask('Email address: ');
  if (!email) {
    console.log('Cancelled.');
    return;
  }
  const client = new PreComClient({ baseUrl });
  await client.resetPassword(email);
  console.log(`Password reset requested for ${email}. Check your email.`);
}

async function actionInfo() {
  const data = tempSession.load();
  requireAuth(data);
  const info = await clientFromSession(data).getInformation();
  render.renderInformation(info);
}

async function actionViewGroupChanges() {
  const data = tempSession.load();
  requireAuth(data);
  const changes = await clientFromSession(data).getAllGroupChanges();
  render.renderGroupChanges(changes);
}

async function actionAddGroupChange() {
  const data = tempSession.load();
  requireAuth(data);
  const client = clientFromSession(data);

  const groupId = await ask('Group ID to temporarily join: ');
  if (!groupId) {
    console.log('Cancelled.');
    return;
  }
  const type = (
    await ask('Schedule type - specific days (d), a period (p), or recurring (r)? (d/p/r): ')
  )
    .trim()
    .toLowerCase();

  if (type === 'd') {
    const datesInput = await ask('Dates, comma-separated (YYYY-MM-DD,YYYY-MM-DD,...): ');
    if (!datesInput) {
      console.log('Cancelled.');
      return;
    }
    const dates = datesInput.split(',').map((d) => d.trim());
    console.log('');
    console.log(`About to temporarily join group ${groupId} on: ${dates.join(', ')}.`);
    if (!(await confirm('Confirm? (y/N): '))) {
      console.log('Cancelled.');
      return;
    }
    await client.addGroupChangeForDays(groupId, dates);
  } else if (type === 'p') {
    const from = await ask('From (YYYY-MM-DD or full date-time): ');
    const to = await ask('To (YYYY-MM-DD or full date-time): ');
    if (!from || !to) {
      console.log('Cancelled.');
      return;
    }
    console.log('');
    console.log(`About to temporarily join group ${groupId} from ${from} to ${to}.`);
    if (!(await confirm('Confirm? (y/N): '))) {
      console.log('Cancelled.');
      return;
    }
    await client.addGroupChangeForPeriod(groupId, from, to);
  } else if (type === 'r') {
    const weekdaysInput = await ask('Weekdays (comma-separated, e.g. mon,tue,wed): ');
    const startTime = await ask('Start time (full date-time, e.g. 2026-09-01T09:00:00): ');
    const stopTime = await ask('Stop time (full date-time, e.g. 2026-09-01T17:00:00): ');
    if (!weekdaysInput || !startTime || !stopTime) {
      console.log('Cancelled.');
      return;
    }
    let weekdays;
    try {
      weekdays = parseWeekdays(weekdaysInput);
    } catch (err) {
      console.log(`Cancelled: ${err.message}`);
      return;
    }
    console.log('');
    console.log(`About to temporarily join group ${groupId} every ${weekdaysInput}, ${startTime} - ${stopTime}.`);
    if (!(await confirm('Confirm? (y/N): '))) {
      console.log('Cancelled.');
      return;
    }
    await client.addGroupChangePeriodically(groupId, weekdays, startTime, stopTime);
  } else {
    console.log('Cancelled: unknown option.');
    return;
  }
  console.log('Group change added.');
}

async function actionRemoveGroupChange() {
  const data = tempSession.load();
  requireAuth(data);
  const client = clientFromSession(data);

  const changes = await client.getAllGroupChanges();
  if (changes.length === 0) {
    console.log('No group changes to remove.');
    return;
  }
  console.log('');
  render.renderGroupChangePicker(changes);
  const pick = await ask('Enter the number of the group change to remove: ');
  const selected = pickByNumber(changes, pick, 'group changes');
  if (!selected) return;
  const gc = selected[0];

  console.log('');
  console.log(`About to remove group change ID ${gc.GroupUserID} (${gc.Label || gc.GroupID}).`);
  if (!(await confirm('Confirm? (y/N): '))) {
    console.log('Cancelled.');
    return;
  }
  await client.deleteOneGroupChange(gc.GroupUserID);
  console.log('Group change removed.');
}

function sessionLine() {
  const data = tempSession.load();
  if (data.token && (!data.expiresAt || Date.now() < data.expiresAt)) {
    return `logged in as ${data.userName}`;
  }
  return 'not logged in';
}

const MESSAGES_ITEMS = [
  { key: '1', label: 'Send message', action: actionSendMessage },
  { key: '2', label: 'Message inbox', action: actionMessageInbox },
  { key: '3', label: 'Alarm history', action: actionAlarmHistory },
  { key: '4', label: 'Respond to an alarm', action: actionRespondToAlarm },
  { key: '5', label: 'Users & groups (receivers)', action: actionReceivers },
  { key: '6', label: 'Message templates', action: actionTemplates },
];

const AVAILABILITY_ITEMS = [
  { key: '1', label: 'My status', action: actionStatus },
  { key: '2', label: 'Mark myself available', action: actionSetAvailable },
  { key: '3', label: 'View scheduled availability (on-call)', action: actionViewSchedule },
  { key: '4', label: 'Mark not available (block hours)', action: actionAddScheduleBlock },
  { key: '5', label: 'Clear not-available markings', action: actionRemoveScheduleBlock },
  { key: '6', label: 'Add recurring schedule', action: actionAddRecurringSchedule },
  { key: '7', label: 'Set outside-region status', action: actionSetOutsideRegion },
  { key: '8', label: 'Update alert sounds', action: actionUpdateSound },
  { key: '9', label: 'View shift work', action: actionViewShiftWork },
];

const GROUPS_ITEMS = [
  { key: '1', label: 'My groups', action: actionMyGroups },
  { key: '2', label: 'All groups', action: actionAllGroups },
  { key: '3', label: 'Group occupancy', action: actionGroupOccupancy },
  { key: '4', label: 'Understaffed days', action: actionUnderstaffedDays },
  { key: '5', label: 'Group functions', action: actionGroupFunctions },
  { key: '6', label: 'On-call schedule', action: actionOnCallSchedule },
];

const CAPCODES_ITEMS = [
  { key: '1', label: 'View capcodes', action: actionViewCapcodes },
  { key: '2', label: 'Enable/disable a capcode', action: actionToggleCapcode },
];

const GROUP_CHANGES_ITEMS = [
  { key: '1', label: 'View my group changes', action: actionViewGroupChanges },
  { key: '2', label: 'Add a group change', action: actionAddGroupChange },
  { key: '3', label: 'Remove a group change', action: actionRemoveGroupChange },
];

const MENU_ITEMS = [
  { key: '1', label: 'Log in', action: actionLogin },
  { key: '2', label: 'Messages', action: () => runSubmenu('Messages', MESSAGES_ITEMS) },
  { key: '3', label: 'Availability', action: () => runSubmenu('Availability', AVAILABILITY_ITEMS) },
  { key: '4', label: 'Groups', action: () => runSubmenu('Groups', GROUPS_ITEMS) },
  { key: '5', label: 'Capcodes', action: () => runSubmenu('Capcodes', CAPCODES_ITEMS) },
  { key: '6', label: 'Group changes', action: () => runSubmenu('Group changes', GROUP_CHANGES_ITEMS) },
  { key: '7', label: 'Node info', action: actionInfo },
  { key: '8', label: 'Reset password', action: actionResetPassword },
  { key: '9', label: 'Log out', action: actionLogout },
];

// Prints `items` with a trailing "0) <backLabel>" line, prompts for a choice,
// and runs the matching action. Returns false when the user chose to go
// back/exit (so the caller's loop can stop), true otherwise.
async function promptAndDispatch(items, backLabel) {
  for (const item of items) {
    console.log(`  ${item.key}) ${item.label}`);
  }
  console.log(`  0) ${backLabel}`);
  console.log('');
  const choice = (await ask('Choose an option: ')).trim().toLowerCase();
  if (choice === '0' || choice === 'exit' || choice === 'back' || choice === 'q') {
    return false;
  }
  const item = items.find((entry) => entry.key === choice);
  if (!item) {
    console.log('Unknown option.');
    return true;
  }
  try {
    await item.action();
  } catch (err) {
    const status = err instanceof PreComError && err.status ? ` (HTTP ${err.status})` : '';
    console.error(`Error: ${err.message}${status}`);
  }
  return true;
}

async function runSubmenu(title, items) {
  for (;;) {
    console.log('');
    console.log(`=== ${title} ===`);
    console.log(`Session: ${sessionLine()}`);
    console.log('');
    if (!(await promptAndDispatch(items, 'Back'))) return;
  }
}

async function runMenu() {
  tempSession.sweepStaleSessions();
  tempSession.registerCleanupHandlers();

  console.log('precomcli - interactive session');
  console.log('All session data lives only in a temp folder for this window');
  console.log('and is deleted automatically when you exit or close the window.');

  for (;;) {
    console.log('');
    console.log('=== PreCom CLI ===');
    console.log(`Session: ${sessionLine()}`);
    console.log('');
    if (!(await promptAndDispatch(MENU_ITEMS, 'Exit'))) break;
  }

  closePrompt();
  tempSession.cleanup();
  console.log('Session data cleared. Goodbye.');
}

module.exports = { runMenu };
