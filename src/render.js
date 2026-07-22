const { printTable, printKeyValues } = require('./format');

function occupancyLabel(level) {
  if (level > 0) return `OK (+${level})`;
  if (level < 0) return `SHORT (${level})`;
  return 'EXACT (0)';
}

function renderStatus(info, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  printKeyValues([
    ['Name', info.FullName?.trim()],
    ['User ID', info.UserID],
    ['Not available', info.NotAvailable ? 'yes' : 'no'],
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

module.exports = { renderStatus, renderGroups, renderOccupancy, renderReceivers, occupancyLabel };
