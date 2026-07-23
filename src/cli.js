const config = require('./config');
const {
  PreComClient,
  PreComError,
  DEFAULT_BASE_URL,
  parseReceivers,
  toTimeSpan,
  toEndTimeSpan,
  parseWeekdays,
  buildSoundPayload,
  VALID_SOUNDS,
  SOUND_CATEGORIES,
} = require('./api');
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
  precomcli templates [--json]
  precomcli message --to <type:id[,type:id...]> (--text <message> | --template <id>)
                     [--priority] [--response] [--valid-from <iso-date-time>] [--send-by <id>] [--json]
  precomcli messages [--control-id b|f|g] [--json]
  precomcli alarms [--msg-in-id <id>] [--previous-or-next <n>] [--json]
  precomcli respond-alarm <msgInID> <yes|no>
  precomcli available
  precomcli schedule [--from <date>] [--to <date>] [--json]
  precomcli schedule-add <date> <fromHour> <toHour>
  precomcli schedule-remove <date> <fromHour> <toHour>
  precomcli capcodes [--json]
  precomcli capcode-toggle <capcodeId> (--enable|--disable)
  precomcli understaffed-days <groupId> [--json]
  precomcli functions <groupId> [--date <date>] [--json]
  precomcli schedule-recurring <startDate> <endDate> <fromHour> <toHour>
                                --weekdays <mon,tue,...> (--available|--unavailable)
                                [--weekly <n>] [--clean-day-first]
  precomcli outside-region <hours> (--enter|--exit)
  precomcli sound [--alarm <name>] [--info <name>] [--understaffing <name>]
                   [--occupancy <name>] [--proposal <name>]
                   [--critical-alarm] [--critical-info] [--critical-understaffing]
                   [--critical-occupancy] [--critical-proposal]
  precomcli reset-password <email>
  precomcli info [--json]
  precomcli group-change [--json]
  precomcli group-changes [--json]
  precomcli group-change-days <groupId> <date1,date2,...> [--group-user-id <id>]
  precomcli group-change-period <groupId> <from> <to> [--group-user-id <id>]
  precomcli group-change-recurring <groupId> <startTime> <stopTime>
                                    --weekdays <mon,tue,...> [--group-user-id <id>]
  precomcli group-change-delete-type <groupId> <type>
  precomcli group-change-delete
  precomcli group-change-delete-one <groupUserId>
  precomcli piket-schedule <groupId> [--from <date>] [--to <date>] [--json]
  precomcli shifts [--json]
  precomcli help

The interactive menu keeps its login only in a temp folder for the
duration of that session and deletes it automatically on exit, Ctrl+C,
or when the PowerShell window is closed.

The one-shot commands above are for scripting: they cache a login token
persistently in ~/.precomcli/config.json (run "precomcli logout" to clear
it). Non-interactive login also accepts PRECOM_USERNAME, PRECOM_PASSWORD
and PRECOM_BASE_URL as env vars. The plaintext password is never stored
in either mode.

"message" also needs a SendBy ID - a PreCom-internal sender identifier
that is NOT your user ID and can't be looked up via this API; see the
README for how to find yours. Pass it once with --send-by <id> or
PRECOM_SEND_BY, and it's cached in ~/.precomcli/config.json after that.
If you don't know it, run "message" without --send-by and press Enter at
the prompt: it auto-detects the ID by trying 1-255 (only the correct one
sends), showing a live counter, then caches the value it found.

"alarms" defaults to your most recent alarm; pass --msg-in-id with a
negative/positive --previous-or-next to page backward/forward from it.
"schedule-add"/"schedule-remove" take whole hours only (e.g. "8", not
"8:30"; use 24 as <toHour> for midnight). The blocks "schedule" lists
are your AVAILABILITY (on-call) hours, but the write commands work on
NOT-available markings: "schedule-add" marks you NOT available for that
range (punches a hole in your availability), "schedule-remove" clears
such markings so your availability there returns. Note: any write also
rounds that day's existing blocks to whole hours server-side.

"schedule-recurring" only guarantees --weekly 1 (every week) and 2
(alternating, starting this week) - PreCom's own docs say other values
exist but don't say what they are.
"outside-region" needs --enter or --exit; "hours" is required either way
per the API, though what it means for --enter is untested.
"sound" only changes the fields you pass; unspecified ones keep their
current value. Valid names: ${VALID_SOUNDS.join(', ')}.

"group-change-days/-period/-recurring" ADD a new group change by default;
pass --group-user-id (from "group-changes") to UPDATE that one instead.
"piket-schedule" and "shifts" are read-only - PreCom's own docs don't
describe the write endpoints for either well enough to implement safely
yet (see CLAUDE.md).`;

// Flags that never take a value - they're always a bare boolean switch. Listed
// so `--priority false` can't be misread as "priority = 'false'" (which is
// truthy), and so a boolean flag directly before a positional doesn't swallow
// it as its value.
const BOOLEAN_FLAGS = new Set([
  'all', 'json', 'priority', 'response', 'enable', 'disable', 'available', 'unavailable',
  'clean-day-first', 'enter', 'exit',
  'critical-alarm', 'critical-info', 'critical-understaffing', 'critical-occupancy', 'critical-proposal',
]);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      // Support --flag=value in addition to --flag value.
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        args[arg.slice(2, eq)] = arg.slice(eq + 1);
        continue;
      }
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!BOOLEAN_FLAGS.has(key) && next !== undefined && !next.startsWith('--')) {
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

// Loads config, enforces a valid session, and returns both the config and a
// ready client. Every authenticated command starts here - routing auth through
// one place means a new command can't accidentally skip the session check.
function authed() {
  const cfg = config.load();
  requireAuth(cfg);
  return { cfg, client: clientFromConfig() };
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
  const info = await authed().client.getUserInfo();
  render.renderStatus(info, { json: Boolean(args.json) });
}

async function cmdGroups(args) {
  const { client } = authed();
  const groups = args.all ? await client.getAllGroups() : await client.getAllUserGroups();
  render.renderGroups(groups, { json: Boolean(args.json) });
}

async function cmdReceivers(args) {
  const receivers = await authed().client.getReceivers();
  render.renderReceivers(receivers, { json: Boolean(args.json) });
}

async function cmdTemplates(args) {
  const templates = await authed().client.getTemplates();
  render.renderTemplates(templates, { json: Boolean(args.json) });
}

async function cmdMessage(args) {
  const { cfg, client } = authed();

  if (!args.to) {
    throw new Error(
      'Usage: precomcli message --to <type:id[,type:id...]> (--text <message> | --template <id>) ' +
        '[--priority] [--response] [--valid-from <iso-date-time>] [--send-by <id>]'
    );
  }
  const receivers = parseReceivers(args.to);

  let message = args.text;
  if (!message && args.template) {
    const templates = await client.getTemplates();
    const template = templates.find((t) => String(t.ID) === String(args.template));
    if (!template) throw new Error(`No template with ID ${args.template}.`);
    message = template.Text;
  }
  if (!message) {
    throw new Error('Provide --text <message> or --template <id>.');
  }

  const preComMsg = {
    Message: message,
    Receivers: receivers,
    Priority: Boolean(args.priority),
    Response: Boolean(args.response),
    ValidFrom: args['valid-from'] || new Date().toISOString(),
  };

  let sendBy = args['send-by'] ?? process.env.PRECOM_SEND_BY ?? cfg.sendBy;
  let autoDetect = false;
  if (sendBy === undefined || sendBy === null || sendBy === '') {
    const answer = await ask(
      'SendBy ID (your PreCom sender ID - NOT your user ID). ' +
        "If you don't know it, press Enter to auto-detect it (tries 1-255, sends once found): "
    );
    if (answer.trim() === '') autoDetect = true;
    else sendBy = answer;
  }

  let result;
  if (autoDetect) {
    // Brute-force the sender ID for a user who doesn't know theirs. Only the
    // correct SendBy succeeds, so this both finds it and sends the message.
    const found = await client.findSendByAndSend(preComMsg, {
      onProgress: (current, max) => process.stdout.write(`\rTrying sender ID ${current}/${max}...`),
    });
    process.stdout.write('\n');
    sendBy = found.sendBy;
    result = found.result;
    config.save({ ...cfg, sendBy });
    console.log(`Found your sender ID: ${sendBy} (saved for next time).`);
  } else {
    sendBy = Number(sendBy);
    if (!Number.isInteger(sendBy)) {
      throw new Error('SendBy must be an integer. Pass --send-by <id>, set PRECOM_SEND_BY, or see README.');
    }
    if (sendBy !== cfg.sendBy) {
      config.save({ ...cfg, sendBy });
    }
    result = await client.sendMessage({ ...preComMsg, SendBy: sendBy });
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Message sent to ${receivers.length} receiver(s).`);
  }
}

async function cmdMessages(args) {
  const messages = await authed().client.getMessages(args['control-id']);
  render.renderMessages(messages, { json: Boolean(args.json) });
}

async function cmdAlarms(args) {
  const msgInID = Number(args['msg-in-id'] ?? 0);
  const previousOrNext = Number(args['previous-or-next'] ?? 0);
  const alarms = await authed().client.getAlarmMessages(msgInID, previousOrNext);
  render.renderAlarmMessages(alarms, { json: Boolean(args.json) });
}

async function cmdRespondAlarm(args) {
  const msgInID = args._[0];
  const answer = (args._[1] || '').toLowerCase();
  if (!msgInID || (answer !== 'yes' && answer !== 'no')) {
    throw new Error('Usage: precomcli respond-alarm <msgInID> <yes|no>');
  }
  await authed().client.setAvailabilityForAlarmMessage(Number(msgInID), answer === 'yes');
  console.log(`Responded "${answer}" to alarm ${msgInID}.`);
}

async function cmdAvailable() {
  const actions = await authed().client.makeAvailable();
  if (actions.length === 0) {
    console.log('You were already available — nothing to change.');
  } else {
    console.log(`Done (${actions.join('; ')}). You are now marked as available.`);
  }
}

async function cmdSchedule(args) {
  const { client } = authed();

  const today = new Date();
  const inWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const from = args.from || today.toISOString().slice(0, 10);
  const to = args.to || inWeek.toISOString().slice(0, 10);

  const appointments = await client.getUserSchedulerAppointments(from, to);
  render.renderSchedulerAppointments(appointments, { json: Boolean(args.json) });
}

async function cmdScheduleAdd(args) {
  const [date, from, to] = args._;
  if (!date || from === undefined || to === undefined) {
    throw new Error('Usage: precomcli schedule-add <date> <fromHour> <toHour>');
  }
  await authed().client.addUserSchedulerAppointment(date, toTimeSpan(from), toEndTimeSpan(to));
  console.log(`Marked NOT available on ${date}, ${from}:00-${to}:00.`);
}

async function cmdScheduleRemove(args) {
  const [date, from, to] = args._;
  if (!date || from === undefined || to === undefined) {
    throw new Error('Usage: precomcli schedule-remove <date> <fromHour> <toHour>');
  }
  await authed().client.deleteUserSchedulerAppointment(date, toTimeSpan(from), toEndTimeSpan(to));
  console.log(`Cleared not-available markings on ${date}, ${from}:00-${to}:00 — your availability there is restored.`);
}

async function cmdCapcodes(args) {
  const capcodes = await authed().client.getUserCapcodes();
  render.renderCapcodes(capcodes, { json: Boolean(args.json) });
}

async function cmdCapcodeToggle(args) {
  const capcodeId = args._[0];
  if (!capcodeId || (!args.enable && !args.disable)) {
    throw new Error('Usage: precomcli capcode-toggle <capcodeId> (--enable|--disable)');
  }
  await authed().client.updateUserCapcode(Number(capcodeId), Boolean(args.enable));
  console.log(`Capcode ${capcodeId} ${args.enable ? 'enabled' : 'disabled'}.`);
}

async function cmdUnderstaffedDays(args) {
  const groupId = args._[0];
  if (!groupId) {
    throw new Error('Usage: precomcli understaffed-days <groupId>');
  }
  const dates = await authed().client.getAllDaysNoOccupancy(groupId);
  render.renderDaysNoOccupancy(dates, { json: Boolean(args.json) });
}

async function cmdFunctions(args) {
  const groupId = args._[0];
  if (!groupId) {
    throw new Error('Usage: precomcli functions <groupId> [--date <date>]');
  }
  const date = args.date || new Date().toISOString().slice(0, 10);
  const group = await authed().client.getAllFunctions(groupId, date);
  render.renderFunctions(group, { json: Boolean(args.json) });
}

async function cmdScheduleRecurring(args) {
  const [startDate, endDate, fromHour, toHour] = args._;
  if (
    !startDate ||
    !endDate ||
    fromHour === undefined ||
    toHour === undefined ||
    !args.weekdays ||
    (!args.available && !args.unavailable)
  ) {
    throw new Error(
      'Usage: precomcli schedule-recurring <startDate> <endDate> <fromHour> <toHour> ' +
        '--weekdays <mon,tue,...> (--available|--unavailable) [--weekly <n>] [--clean-day-first]'
    );
  }
  const { client } = authed();
  const weekDays = parseWeekdays(args.weekdays);
  await client.updateUserSchedulerPeriod(
    startDate,
    endDate,
    toTimeSpan(fromHour),
    toTimeSpan(toHour),
    Boolean(args.available),
    weekDays,
    Number(args.weekly ?? 1),
    Boolean(args['clean-day-first'])
  );
  console.log('Recurring schedule updated.');
}

async function cmdOutsideRegion(args) {
  const hours = args._[0];
  if (!hours || (!args.enter && !args.exit)) {
    throw new Error('Usage: precomcli outside-region <hours> (--enter|--exit)');
  }
  await authed().client.setOutsideRegion(Number(hours), args.enter ? 'ENTER' : 'EXIT');
  console.log(`Outside-region status set: ${args.enter ? 'entered' : 'exited'} region for ${hours} hour(s).`);
}

async function cmdSound(args) {
  const { client } = authed();

  for (const category of Object.keys(SOUND_CATEGORIES)) {
    if (args[category] && !VALID_SOUNDS.includes(args[category])) {
      throw new Error(`Invalid sound "${args[category]}" for --${category}. Valid: ${VALID_SOUNDS.join(', ')}`);
    }
  }

  const current = await client.getUserInfo();
  await client.updateUserSound(buildSoundPayload(current, args));
  console.log('Sound settings updated.');
}

async function cmdResetPassword(args) {
  const email = args._[0];
  if (!email) {
    throw new Error('Usage: precomcli reset-password <email>');
  }
  const baseUrl = args['base-url'] || process.env.PRECOM_BASE_URL || config.load().baseUrl || DEFAULT_BASE_URL;
  const client = new PreComClient({ baseUrl });
  await client.resetPassword(email);
  console.log(`Password reset requested for ${email}. Check your email.`);
}

async function cmdInfo(args) {
  const info = await authed().client.getInformation();
  render.renderInformation(info, { json: Boolean(args.json) });
}

async function cmdGroupChange(args) {
  const gc = await authed().client.getGroupChange();
  render.renderGroupChange(gc, { json: Boolean(args.json) });
}

async function cmdGroupChanges(args) {
  const changes = await authed().client.getAllGroupChanges();
  render.renderGroupChanges(changes, { json: Boolean(args.json) });
}

async function cmdGroupChangeDays(args) {
  const [groupId, datesArg] = args._;
  if (!groupId || !datesArg) {
    throw new Error('Usage: precomcli group-change-days <groupId> <date1,date2,...> [--group-user-id <id>]');
  }
  const dates = datesArg.split(',').map((d) => d.trim());
  const { client } = authed();
  if (args['group-user-id']) {
    await client.updateGroupChangeForDays(Number(args['group-user-id']), groupId, dates);
  } else {
    await client.addGroupChangeForDays(groupId, dates);
  }
  console.log('Group change (days) saved.');
}

async function cmdGroupChangePeriod(args) {
  const [groupId, from, to] = args._;
  if (!groupId || !from || !to) {
    throw new Error('Usage: precomcli group-change-period <groupId> <from> <to> [--group-user-id <id>]');
  }
  const { client } = authed();
  if (args['group-user-id']) {
    await client.updateGroupChangeForPeriod(Number(args['group-user-id']), groupId, from, to);
  } else {
    await client.addGroupChangeForPeriod(groupId, from, to);
  }
  console.log('Group change (period) saved.');
}

async function cmdGroupChangeRecurring(args) {
  const [groupId, startTime, stopTime] = args._;
  if (!groupId || !startTime || !stopTime || !args.weekdays) {
    throw new Error(
      'Usage: precomcli group-change-recurring <groupId> <startTime> <stopTime> ' +
        '--weekdays <mon,tue,...> [--group-user-id <id>]'
    );
  }
  const { client } = authed();
  const weekdays = parseWeekdays(args.weekdays);
  if (args['group-user-id']) {
    await client.updateGroupChangePeriodically(Number(args['group-user-id']), groupId, weekdays, startTime, stopTime);
  } else {
    await client.addGroupChangePeriodically(groupId, weekdays, startTime, stopTime);
  }
  console.log('Group change (recurring) saved.');
}

async function cmdGroupChangeDeleteType(args) {
  const [groupId, type] = args._;
  if (!groupId || type === undefined) {
    throw new Error('Usage: precomcli group-change-delete-type <groupId> <type>');
  }
  await authed().client.deleteOneTypeGroupChange(Number(groupId), Number(type));
  console.log('Group change deleted.');
}

async function cmdGroupChangeDelete() {
  await authed().client.deleteGroupChange();
  console.log('Group change deleted.');
}

async function cmdGroupChangeDeleteOne(args) {
  const groupUserId = args._[0];
  if (!groupUserId) {
    throw new Error('Usage: precomcli group-change-delete-one <groupUserId>');
  }
  await authed().client.deleteOneGroupChange(Number(groupUserId));
  console.log('Group change deleted.');
}

async function cmdPiketSchedule(args) {
  const groupId = args._[0];
  if (!groupId) {
    throw new Error('Usage: precomcli piket-schedule <groupId> [--from <date>] [--to <date>]');
  }
  const { client } = authed();
  const info = await client.getUserInfo();
  const today = new Date();
  const in30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const from = args.from || today.toISOString().slice(0, 10);
  const to = args.to || in30.toISOString().slice(0, 10);
  const items = await client.getPiketSchedule(info.UserID, groupId, from, to);
  render.renderPiketSchedule(items, { json: Boolean(args.json) });
}

async function cmdShifts(args) {
  const shiftWork = await authed().client.getShiftAppointments();
  render.renderShiftAppointments(shiftWork, { json: Boolean(args.json) });
}

async function cmdGroupStatus(args) {
  const groupId = args._[0];
  if (!groupId) {
    throw new Error('Usage: precomcli group-status <groupId> [--from <date>] [--to <date>]');
  }
  const { client } = authed();

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
      case 'templates':
        await cmdTemplates(args);
        break;
      case 'message':
        await cmdMessage(args);
        break;
      case 'messages':
        await cmdMessages(args);
        break;
      case 'alarms':
        await cmdAlarms(args);
        break;
      case 'respond-alarm':
        await cmdRespondAlarm(args);
        break;
      case 'available':
        await cmdAvailable(args);
        break;
      case 'schedule':
        await cmdSchedule(args);
        break;
      case 'schedule-add':
        await cmdScheduleAdd(args);
        break;
      case 'schedule-remove':
        await cmdScheduleRemove(args);
        break;
      case 'capcodes':
        await cmdCapcodes(args);
        break;
      case 'capcode-toggle':
        await cmdCapcodeToggle(args);
        break;
      case 'understaffed-days':
        await cmdUnderstaffedDays(args);
        break;
      case 'functions':
        await cmdFunctions(args);
        break;
      case 'schedule-recurring':
        await cmdScheduleRecurring(args);
        break;
      case 'outside-region':
        await cmdOutsideRegion(args);
        break;
      case 'sound':
        await cmdSound(args);
        break;
      case 'reset-password':
        await cmdResetPassword(args);
        break;
      case 'info':
        await cmdInfo(args);
        break;
      case 'group-change':
        await cmdGroupChange(args);
        break;
      case 'group-changes':
        await cmdGroupChanges(args);
        break;
      case 'group-change-days':
        await cmdGroupChangeDays(args);
        break;
      case 'group-change-period':
        await cmdGroupChangePeriod(args);
        break;
      case 'group-change-recurring':
        await cmdGroupChangeRecurring(args);
        break;
      case 'group-change-delete-type':
        await cmdGroupChangeDeleteType(args);
        break;
      case 'group-change-delete':
        await cmdGroupChangeDelete(args);
        break;
      case 'group-change-delete-one':
        await cmdGroupChangeDeleteOne(args);
        break;
      case 'piket-schedule':
        await cmdPiketSchedule(args);
        break;
      case 'shifts':
        await cmdShifts(args);
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
    const status = err instanceof PreComError && err.status ? ` (HTTP ${err.status})` : '';
    console.error(`Error: ${err.message}${status}`);
    process.exitCode = 1;
  } finally {
    closePrompt();
  }
}

module.exports = { main, parseArgs };
