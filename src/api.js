const DEFAULT_BASE_URL = 'https://pre-com.nl/Mobile';

class PreComError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'PreComError';
    this.status = status;
    this.body = body;
  }
}

class PreComClient {
  constructor({ baseUrl = DEFAULT_BASE_URL, token } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
  }

  // OAuth2 Resource Owner Password Credentials grant against POST {baseUrl}/Token
  async login(username, password) {
    const res = await fetch(`${this.baseUrl}/Token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'password', username, password }).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = data.error_description || data.error || `Login failed (HTTP ${res.status})`;
      throw new PreComError(message, res.status, data);
    }
    this.token = data.access_token;
    return data; // { access_token, token_type, expires_in, userName, .issued, .expires }
  }

  // auth: set false for the handful of endpoints that work without a bearer
  // token (e.g. ResetPassword - recovering a lost password), so this one
  // method handles every request's query-building, parsing, and error-detail
  // surfacing rather than duplicating it per unauthenticated endpoint.
  async request(method, path, { query, body, auth = true } = {}) {
    if (auth && !this.token) {
      throw new PreComError('Not authenticated. Run "precomcli login" first.', 401);
    }
    let url = `${this.baseUrl}${path}`;
    if (query) {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) qs.set(key, value);
      }
      const qsStr = qs.toString();
      if (qsStr) url += `?${qsStr}`;
    }
    const res = await fetch(url, {
      method,
      headers: {
        ...(auth ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      let message = (data && data.Message) || `Request failed (HTTP ${res.status})`;
      // ASP.NET Web API's generic "An error has occurred." for an unhandled
      // server exception carries the real detail in separate fields (only
      // present when the server has detailed errors enabled) - surface it
      // instead of discarding it, and it's the only lead we get otherwise.
      if (data && typeof data === 'object') {
        if (data.ExceptionMessage && data.ExceptionMessage !== message) {
          message += ` — ${data.ExceptionMessage}`;
        }
        if (data.ModelState) {
          message += ` — ${JSON.stringify(data.ModelState)}`;
        }
      }
      throw new PreComError(message, res.status, data);
    }
    return data;
  }

  getUserInfo() {
    return this.request('GET', '/api/User/GetUserInfo');
  }

  getAllUserGroups() {
    return this.request('GET', '/api/Group/GetAllUserGroups');
  }

  getAllGroups() {
    return this.request('GET', '/api/Group/GetAllGroups');
  }

  // Returns { "<isoDate>": level, ... }; positive = enough, negative = short, 0 = exact.
  getOccupancyLevels(groupID, from, to) {
    return this.request('GET', '/api/Group/GetOccupancyLevels', { query: { groupID, from, to } });
  }

  logoutRemote() {
    return this.request('POST', '/api/Account/Logout');
  }

  // Returns [{ Type, ID, Label }, ...] covering users, groups, and message groups.
  getReceivers() {
    return this.request('GET', '/api/Msg/GetReceivers');
  }

  // Returns [{ ID, Label, Text }, ...] canned messages (empty if not authorized).
  getTemplates() {
    return this.request('GET', '/api/Msg/GetTemplates');
  }

  // preComMsg: { Message, Receivers: [{Type, ID, Label?}], Priority?, Response?, ValidFrom?, SendBy?, CalculateGroupID? }
  sendMessage(preComMsg) {
    return this.request('POST', '/api/Msg/SendMessage', { body: preComMsg });
  }

  // Returns [{ MsgOutID, ControlID, MsgInID, Timestamp, ValidTo, Text, MsgIn }, ...].
  // controlID: omit for all, 'b' = P2000 alarm, 'f' = GPRS, 'g' = understaffing notifications.
  getMessages(controlID) {
    return this.request('GET', '/api/User/GetMessages', { query: { controlID } });
  }

  // Returns [{ MsgInID, Timestamp, Text, Group }, ...] alarm log entries.
  // previousOrNext: 0 = most recent (msgInID ignored), negative = earlier than msgInID, positive = later.
  getAlarmMessages(msgInID, previousOrNext) {
    return this.request('GET', '/api/User/GetAlarmMessages', { query: { msgInID, previousOrNext } });
  }

  setAvailabilityForAlarmMessage(msgInID, available) {
    return this.request('POST', '/api/User/SetAvailabilityForAlarmMessage', { query: { msgInID, available } });
  }

  setAvailable() {
    return this.request('POST', '/api/User/SetAvailable');
  }

  // Returns [{ Start, Duration }, ...] scheduled unavailability blocks.
  getUserSchedulerAppointments(from, to) {
    return this.request('GET', '/api/User/GetUserSchedulerAppointments', { query: { from, to } });
  }

  // date: ISO date; from/to: whole-hour TimeSpan strings, e.g. "08:00:00" (see toTimeSpan below).
  addUserSchedulerAppointment(date, from, to) {
    return this.request('POST', '/api/User/AddUserSchedulerAppointment', { query: { date, from, to } });
  }

  deleteUserSchedulerAppointment(date, from, to) {
    return this.request('DELETE', '/api/User/DeleteUserSchedulerAppointment', { query: { date, from, to } });
  }

  // Returns [{ CapcodeId, Enable, Description }, ...].
  getUserCapcodes() {
    return this.request('GET', '/api/User/GetUserCapcodes');
  }

  updateUserCapcode(capcode, enable) {
    return this.request('POST', '/api/User/UpdateUserCapcode', { query: { capcode, enable } });
  }

  // Returns [<isoDate>, ...] days (from today) this group doesn't have enough people available.
  getAllDaysNoOccupancy(groupID) {
    return this.request('GET', '/api/Group/GetAllDaysNoOccupancy', { query: { groupID } });
  }

  // Returns a Group with ServiceFuntions: [{ ServiceFunctionID, Label, NumberNeeded, Users: [...] }].
  getAllFunctions(groupID, date) {
    return this.request('GET', '/api/Group/GetAllFunctions', { query: { groupID, date } });
  }

  // from/to: whole-hour TimeSpan strings (see toTimeSpan). weekDays: bit array, see parseWeekdays.
  // weekly: only 1 (every week) and 2 (alternating, starting this week) are documented by PreCom;
  // other values reportedly exist ("etc." in the swagger description) but are unconfirmed.
  updateUserSchedulerPeriod(startDate, endDate, from, to, available, weekDays, weekly, cleanDayFirst) {
    return this.request('POST', '/api/User/UpdateUserSchedulerPeriod', {
      query: { startDate, endDate, from, to, available, weekDays, weekly, cleanDayFirst },
    });
  }

  // region: 'ENTER' or 'EXIT'. hours: how long to mark unavailable for (required even for 'ENTER'
  // by the schema, though the practical meaning of that combination is untested).
  setOutsideRegion(hours, region) {
    return this.request('POST', '/api/User/SetOutsideRegion', { query: { hours }, body: { Location: { Geofence: region } } });
  }

  // sound: a full { SoundAlarm, SoundInfo, SoundUnderstaffing, SoundOccupancy, SoundProposal,
  // CriticalAlertsAlarm, CriticalAlertsInfo, CriticalAlertsUnderstaffing, CriticalAlertsOccupancy,
  // CriticalAlertsProposal } object - the server replaces the whole thing, so callers should merge
  // with the current GetUserInfo values for fields they don't mean to change.
  updateUserSound(sound) {
    return this.request('POST', '/api/User/UpdateUserSound', { body: sound });
  }

  // Does NOT require authentication (recovering a lost password) - see request()'s `auth` option.
  resetPassword(email) {
    return this.request('POST', '/api/Account/ResetPassword', { query: { email }, auth: false });
  }

  // Versioned-only endpoint - no unversioned route exists for this one, unlike the rest of the API.
  getInformation() {
    return this.request('GET', '/api/v2/Information/GetInformation');
  }

  // Returns the current/first active group change (temporary reassignment to a different group).
  getGroupChange() {
    return this.request('GET', '/api/User/GetGroupChange');
  }

  getAllGroupChanges() {
    return this.request('GET', '/api/User/GetAllGroupChanges');
  }

  // dates: array of ISO date strings. Creates/updates the implicit "first" group change - use
  // updateGroupChangeForDays with an explicit groupUserID to target a specific one instead.
  addGroupChangeForDays(groupId, dates) {
    return this.request('POST', '/api/User/AddGroupChangeForDays', { query: { groupId }, body: dates });
  }

  updateGroupChangeForDays(groupUserID, groupId, dates) {
    return this.request('POST', '/api/User/UpdateGroupChangeForDays', {
      query: { groupUserID, groupId },
      body: dates,
    });
  }

  addGroupChangeForPeriod(groupId, from, to) {
    return this.request('POST', '/api/User/AddGroupChangeForPeriod', { query: { groupId, from, to } });
  }

  updateGroupChangeForPeriod(groupUserID, groupId, from, to) {
    return this.request('POST', '/api/User/UpdateGroupChangeForPeriod', {
      query: { groupUserID, groupId, from, to },
    });
  }

  // weekdays: bit array, see parseWeekdays. startTime/stopTime: full date-time strings (unlike the
  // scheduler-appointment endpoints, these are NOT whole-hour TimeSpan strings).
  addGroupChangePeriodically(groupId, weekdays, startTime, stopTime) {
    return this.request('POST', '/api/User/AddGroupChangePeriodically', {
      query: { groupId, weekdays, startTime, stopTime },
    });
  }

  updateGroupChangePeriodically(groupUserID, groupId, weekdays, startTime, stopTime) {
    return this.request('POST', '/api/User/UpdateGroupChangePeriodically', {
      query: { groupUserID, groupId, weekdays, startTime, stopTime },
    });
  }

  // type: the group change's own Type field (which Add* variant created it) - not otherwise
  // explained by the API; get it from getGroupChange()/getAllGroupChanges() first.
  deleteOneTypeGroupChange(groupId, type) {
    return this.request('DELETE', '/api/User/DeleteOneTypeGroupChange', { query: { groupId, type } });
  }

  deleteGroupChange() {
    return this.request('DELETE', '/api/User/DeleteGroupChange');
  }

  deleteOneGroupChange(groupUserId) {
    return this.request('DELETE', '/api/User/DeleteOneGroupChange', { query: { groupUserId } });
  }

  // Versioned-only endpoint. Returns [{ ScheduleAppointmentID, UserID, GroupID, ServiceFunctionID,
  // Startdate, Enddate }, ...] on-call slots. Read-only - AddScheduleItem/TakeScheduleItem/etc. are
  // not implemented: their assignment semantics (open-shift claiming vs. direct assignment) are
  // still unconfirmed, since this account has no existing slots to observe. Live-test before adding.
  getPiketSchedule(userId, groupId, from, to) {
    return this.request('GET', '/api/v2/Piket/GetSchedule', { query: { userId, groupId, from, to } });
  }

  // Returns a single ShiftWork object: { ShiftWorkID, AmountOfDays, ShiftType, StartDate,
  // ShiftWorkDays }, zeroed out if nothing is configured. Read-only - UpdateShiftAppointments/
  // ImplementShiftAppointments are not implemented: ShiftWorkDay's raw integer fields (ShiftType,
  // Day, MomentNbr, TimeFrom, TimeTo) have no documented meaning and this account has none
  // configured to decode them against.
  getShiftAppointments() {
    return this.request('GET', '/api/User/GetShiftAppointments');
  }
}

// Valid UpdateUserSound values, per swagger's parameter description (the only place these are listed).
const VALID_SOUNDS = [
  'silent', 'vibrate', 'chirp', 'chirp2x', 'chirp4x',
  'beep_short', 'beep_short2x', 'beep_short3x',
  'pager', 'pager2x', 'pager3x', 'pager6x',
  'siren', 'siren2x', 'siren3x', 'siren6x',
];

// The five sound categories and their GetUserInfo/UpdateUserSound field names,
// keyed by the short name used in CLI flags and menu prompts.
const SOUND_CATEGORIES = {
  alarm: { sound: 'SoundAlarm', critical: 'CriticalAlertsAlarm' },
  info: { sound: 'SoundInfo', critical: 'CriticalAlertsInfo' },
  understaffing: { sound: 'SoundUnderstaffing', critical: 'CriticalAlertsUnderstaffing' },
  occupancy: { sound: 'SoundOccupancy', critical: 'CriticalAlertsOccupancy' },
  proposal: { sound: 'SoundProposal', critical: 'CriticalAlertsProposal' },
};

// UpdateUserSound replaces the whole sound object, so build the full 10-field
// payload from the current GetUserInfo values, overriding only what changed.
// changes: { <category>: <soundName> } and/or { critical<Category>: true }.
function buildSoundPayload(current, changes = {}) {
  const payload = {};
  for (const { sound, critical } of Object.values(SOUND_CATEGORIES)) {
    payload[sound] = current[sound];
    payload[critical] = current[critical];
  }
  for (const [category, { sound, critical }] of Object.entries(SOUND_CATEGORIES)) {
    if (changes[category]) payload[sound] = changes[category];
    if (changes[`critical-${category}`]) payload[critical] = true;
  }
  return payload;
}

const WEEKDAY_BITS = { mon: 1, tue: 2, wed: 4, thu: 8, fri: 16, sat: 32, sun: 64 };

// Parses "mon,wed,fri" into the bit-array integer UpdateUserSchedulerPeriod expects.
function parseWeekdays(spec) {
  return spec.split(',').reduce((bits, name) => {
    const bit = WEEKDAY_BITS[name.trim().toLowerCase()];
    if (!bit) {
      throw new PreComError(`Invalid weekday "${name}". Use mon,tue,wed,thu,fri,sat,sun.`, 0);
    }
    return bits | bit;
  }, 0);
}

// Formats a whole-hour integer (0-23) as the "hh:mm:ss" TimeSpan string the
// scheduler-appointment endpoints expect (swagger: "only whole hours").
function toTimeSpan(hour) {
  const h = Number(hour);
  if (!Number.isInteger(h) || h < 0 || h > 23) {
    throw new PreComError(`Invalid hour "${hour}". Expected a whole number from 0 to 23.`, 0);
  }
  return `${String(h).padStart(2, '0')}:00:00`;
}

// Parses "type:id[:label]" pairs (comma-separated) into Receiver objects, as
// used by both the `message --to` flag and the interactive send-message flow.
function parseReceivers(spec) {
  return spec.split(',').map((part) => {
    const [type, id, ...labelParts] = part.split(':');
    if (type === undefined || id === undefined || type === '' || id === '') {
      throw new PreComError(`Invalid receiver "${part}". Expected "<type>:<id>[:<label>]".`, 0);
    }
    if (!Number.isInteger(Number(type)) || !Number.isInteger(Number(id))) {
      throw new PreComError(`Invalid receiver "${part}". Type and ID must be integers.`, 0);
    }
    const receiver = { Type: Number(type), ID: Number(id) };
    if (labelParts.length) receiver.Label = labelParts.join(':');
    return receiver;
  });
}

module.exports = {
  PreComClient,
  PreComError,
  DEFAULT_BASE_URL,
  parseReceivers,
  toTimeSpan,
  parseWeekdays,
  buildSoundPayload,
  VALID_SOUNDS,
  SOUND_CATEGORIES,
};
