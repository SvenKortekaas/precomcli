const { printTable, printKeyValues } = require('./format');

function occupancyLabel(level) {
  if (level > 0) return `OK (+${level})`;
  if (level < 0) return `SHORT (${level})`;
  return 'EXACT (0)';
}

// "Not available" is really two flags OR'd together: the immediate manual
// toggle (NotAvailable) and a scheduled block (NotAvailalbeScheduled - sic,
// that typo is in PreCom's own API). Checking NotAvailable alone misses
// anyone who scheduled a block instead of toggling immediate unavailability.
function isNotAvailable(info) {
  const scheduled = info.NotAvailalbeScheduled ?? info.NotAvailableScheduled;
  return Boolean(info.NotAvailable) || Boolean(scheduled);
}

function renderStatus(info, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  printKeyValues([
    ['Name', info.FullName?.trim()],
    ['User ID', info.UserID],
    ['Not available', isNotAvailable(info) ? 'yes' : 'no'],
    ['Understaffed group(s)', info.NoOccupancy ? 'yes' : 'no'],
    ['Home screen', info.Homescreen],
  ]);
}

function renderGroups(groups, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(groups, null, 2));
    return;
  }
  printTable(groups, [
    { key: 'GroupID', label: 'ID' },
    { key: 'Code', label: 'Code' },
    { key: 'Label', label: 'Label' },
  ]);
}

function renderOccupancy(levels, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(levels, null, 2));
    return;
  }
  const rows = Object.entries(levels).map(([date, level]) => ({
    date: date.slice(0, 10),
    status: occupancyLabel(level),
  }));
  printTable(rows, [
    { key: 'date', label: 'Date' },
    { key: 'status', label: 'Occupancy' },
  ]);
}

const RECEIVER_TYPE_LABELS = { 1: 'User', 2: 'Group' };

function receiverTypeLabel(type) {
  return RECEIVER_TYPE_LABELS[type] || `Type ${type}`;
}

function renderReceivers(receivers, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(receivers, null, 2));
    return;
  }
  const rows = receivers.map((r) => ({ Type: receiverTypeLabel(r.Type), ID: r.ID, Label: r.Label }));
  printTable(rows, [
    { key: 'Type', label: 'Type' },
    { key: 'ID', label: 'ID' },
    { key: 'Label', label: 'Label' },
  ]);
}

function renderTemplates(templates, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(templates, null, 2));
    return;
  }
  printTable(templates, [
    { key: 'ID', label: 'ID' },
    { key: 'Label', label: 'Label' },
    { key: 'Text', label: 'Text' },
  ]);
}

// Numbered pickers for the interactive menu: the user types a plain list
// number (e.g. "1" or "1,3") instead of needing to know a receiver's/
// template's underlying Type/ID.
function renderReceiverPicker(receivers) {
  receivers.forEach((r, i) => {
    console.log(`  ${i + 1}) ${receiverTypeLabel(r.Type)} - ${r.Label} (ID ${r.ID})`);
  });
}

function renderTemplatePicker(templates) {
  templates.forEach((t, i) => {
    console.log(`  ${i + 1}) ${t.Label} - ${t.Text}`);
  });
}

function shortTimestamp(ts) {
  return ts ? ts.replace('T', ' ').slice(0, 16) : '';
}

const CONTROL_ID_LABELS = { b: 'Alarm (P2000)', f: 'GPRS', g: 'Understaffing' };

function renderMessages(messages, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(messages, null, 2));
    return;
  }
  const rows = messages.map((m) => ({
    Timestamp: shortTimestamp(m.Timestamp),
    Type: CONTROL_ID_LABELS[m.ControlID] || m.ControlID || '',
    Text: m.Text,
  }));
  printTable(rows, [
    { key: 'Timestamp', label: 'Timestamp' },
    { key: 'Type', label: 'Type' },
    { key: 'Text', label: 'Text' },
  ]);
}

function renderAlarmMessages(alarms, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(alarms, null, 2));
    return;
  }
  const rows = alarms.map((a) => ({
    MsgInID: a.MsgInID,
    Timestamp: shortTimestamp(a.Timestamp),
    Group: a.Group?.Label || '',
    Text: a.Text,
  }));
  printTable(rows, [
    { key: 'MsgInID', label: 'ID' },
    { key: 'Timestamp', label: 'Timestamp' },
    { key: 'Group', label: 'Group' },
    { key: 'Text', label: 'Text' },
  ]);
}

function renderSchedulerAppointments(appointments, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(appointments, null, 2));
    return;
  }
  const rows = appointments.map((a) => ({ Start: shortTimestamp(a.Start), Duration: a.Duration }));
  printTable(rows, [
    { key: 'Start', label: 'Start' },
    { key: 'Duration', label: 'Duration' },
  ]);
}

function renderCapcodes(capcodes, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(capcodes, null, 2));
    return;
  }
  const rows = capcodes.map((c) => ({
    CapcodeId: c.CapcodeId,
    Enabled: c.Enable ? 'yes' : 'no',
    Description: c.Description,
  }));
  printTable(rows, [
    { key: 'CapcodeId', label: 'Capcode' },
    { key: 'Enabled', label: 'Enabled' },
    { key: 'Description', label: 'Description' },
  ]);
}

function renderSchedulerAppointmentPicker(appointments) {
  appointments.forEach((a, i) => {
    console.log(`  ${i + 1}) ${shortTimestamp(a.Start)} for ${a.Duration}`);
  });
}

function renderCapcodePicker(capcodes) {
  capcodes.forEach((c, i) => {
    console.log(`  ${i + 1}) ${c.CapcodeId} - ${c.Description} (currently ${c.Enable ? 'enabled' : 'disabled'})`);
  });
}

function renderDaysNoOccupancy(dates, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(dates, null, 2));
    return;
  }
  const rows = dates.map((d) => ({ Date: d.slice(0, 10) }));
  printTable(rows, [{ key: 'Date', label: 'Understaffed day' }]);
}

function renderFunctions(group, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(group, null, 2));
    return;
  }
  const rows = (group.ServiceFuntions || []).map((f) => ({
    ID: f.ServiceFunctionID,
    Label: f.Label,
    Needed: f.NumberNeeded,
    Users: (f.Users || []).map((u) => u.FullName?.trim()).join(', '),
  }));
  printTable(rows, [
    { key: 'ID', label: 'ID' },
    { key: 'Label', label: 'Function' },
    { key: 'Needed', label: 'Needed' },
    { key: 'Users', label: 'Assigned users' },
  ]);
}

function renderInformation(info, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  const rows = info.map((i) => ({ NodeID: i.NodeID, Name: i.Name, Info: i.Info }));
  printTable(rows, [
    { key: 'NodeID', label: 'Node' },
    { key: 'Name', label: 'Name' },
    { key: 'Info', label: 'Info' },
  ]);
}

// GroupChange records populate different fields depending on which Add* variant created them
// (Dates for the "days" variant, From/To for "period", Weekdays/StartTime/StopTime for
// "periodically") - show whichever is actually set rather than assuming one shape.
function groupChangeSummary(gc) {
  if (gc.Dates && gc.Dates.length > 0) {
    return `Days: ${gc.Dates.map((d) => d.slice(0, 10)).join(', ')}`;
  }
  if (gc.From || gc.To) {
    return `Period: ${shortTimestamp(gc.From)} - ${shortTimestamp(gc.To)}`;
  }
  if (gc.Weekdays) {
    return `Recurring (weekdays bitmask ${gc.Weekdays}): ${shortTimestamp(gc.StartTime)} - ${shortTimestamp(gc.StopTime)}`;
  }
  return '(no schedule set)';
}

function renderGroupChange(gc, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(gc, null, 2));
    return;
  }
  if (!gc || !gc.GroupID) {
    console.log('(no active group change)');
    return;
  }
  printKeyValues([
    ['Group change ID', gc.GroupUserID],
    ['Group', gc.Label || gc.GroupID],
    ['Type', gc.Type],
    ['Schedule', groupChangeSummary(gc)],
  ]);
}

function renderGroupChanges(changes, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(changes, null, 2));
    return;
  }
  const rows = changes.map((gc) => ({
    ID: gc.GroupUserID,
    Group: gc.Label || gc.GroupID,
    Type: gc.Type,
    Schedule: groupChangeSummary(gc),
  }));
  printTable(rows, [
    { key: 'ID', label: 'ID' },
    { key: 'Group', label: 'Group' },
    { key: 'Type', label: 'Type' },
    { key: 'Schedule', label: 'Schedule' },
  ]);
}

function renderGroupChangePicker(changes) {
  changes.forEach((gc, i) => {
    console.log(`  ${i + 1}) [ID ${gc.GroupUserID}] ${gc.Label || gc.GroupID} - ${groupChangeSummary(gc)}`);
  });
}

function renderPiketSchedule(items, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(items, null, 2));
    return;
  }
  const rows = items.map((i) => ({
    ID: i.ScheduleAppointmentID,
    UserID: i.UserID,
    ServiceFunctionID: i.ServiceFunctionID,
    Start: shortTimestamp(i.Startdate),
    End: shortTimestamp(i.Enddate),
  }));
  printTable(rows, [
    { key: 'ID', label: 'ID' },
    { key: 'UserID', label: 'User' },
    { key: 'ServiceFunctionID', label: 'Function' },
    { key: 'Start', label: 'Start' },
    { key: 'End', label: 'End' },
  ]);
}

function renderShiftAppointments(shiftWork, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(shiftWork, null, 2));
    return;
  }
  if (!shiftWork || !shiftWork.ShiftWorkID) {
    console.log('(no shift work configured)');
    return;
  }
  printKeyValues([
    ['Shift work ID', shiftWork.ShiftWorkID],
    ['Amount of days', shiftWork.AmountOfDays],
    ['Shift type', shiftWork.ShiftType],
    ['Start date', shortTimestamp(shiftWork.StartDate)],
    ['Days configured', (shiftWork.ShiftWorkDays || []).length],
  ]);
}

module.exports = {
  renderStatus,
  renderGroups,
  renderOccupancy,
  renderReceivers,
  renderTemplates,
  renderReceiverPicker,
  renderTemplatePicker,
  renderMessages,
  renderAlarmMessages,
  renderSchedulerAppointments,
  renderSchedulerAppointmentPicker,
  renderCapcodes,
  renderCapcodePicker,
  renderDaysNoOccupancy,
  renderFunctions,
  renderInformation,
  renderGroupChange,
  renderGroupChanges,
  renderGroupChangePicker,
  renderPiketSchedule,
  renderShiftAppointments,
  receiverTypeLabel,
  occupancyLabel,
};
