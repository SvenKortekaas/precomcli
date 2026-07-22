const { test } = require('node:test');
const assert = require('node:assert/strict');
const { occupancyLabel, receiverTypeLabel, isNotAvailable, groupChangeSummary } = require('../src/render');

test('occupancyLabel: positive / negative / zero', () => {
  assert.equal(occupancyLabel(3), 'OK (+3)');
  assert.equal(occupancyLabel(-2), 'SHORT (-2)');
  assert.equal(occupancyLabel(0), 'EXACT (0)');
});

test('receiverTypeLabel: known and unknown types', () => {
  assert.equal(receiverTypeLabel(1), 'User');
  assert.equal(receiverTypeLabel(2), 'Group');
  assert.equal(receiverTypeLabel(9), 'Type 9');
});

// This is the exact regression that shipped to production once: NotAvailable
// alone under-reports unavailability when only the scheduled-block flag is set.
// NotAvailalbeScheduled semantics were decoded via a live A/B test on
// 2026-07-22 (see CLAUDE.md): the flag is INVERTED from its name - true means
// a scheduled availability (on-call) block is active, i.e. the user IS
// available. Both "live-confirmed" cases below are that experiment's data.

test('isNotAvailable: manual toggle wins even during an availability block', () => {
  assert.equal(isNotAvailable({ NotAvailable: true, NotAvailalbeScheduled: true }), true);
});

test('isNotAvailable: live-confirmed AVAILABLE (inside an on-call block)', () => {
  assert.equal(isNotAvailable({ NotAvailable: false, NotAvailalbeScheduled: true }), false);
});

test('isNotAvailable: live-confirmed NOT available (no on-call block active)', () => {
  assert.equal(isNotAvailable({ NotAvailable: false, NotAvailalbeScheduled: false }), true);
});

test('isNotAvailable: missing scheduled flag falls back to the manual toggle', () => {
  assert.equal(isNotAvailable({}), false);
  assert.equal(isNotAvailable({ NotAvailable: true }), true);
});

test('isNotAvailable: falls back to a correctly-spelled scheduled field', () => {
  // If PreCom ever fixes the "Availalbe" typo, the corrected spelling still works.
  assert.equal(isNotAvailable({ NotAvailable: false, NotAvailableScheduled: true }), false);
  assert.equal(isNotAvailable({ NotAvailable: false, NotAvailableScheduled: false }), true);
});

test('groupChangeSummary: days variant', () => {
  const gc = { Dates: ['2026-08-10T00:00:00', '2026-08-11T00:00:00'] };
  assert.equal(groupChangeSummary(gc), 'Days: 2026-08-10, 2026-08-11');
});

test('groupChangeSummary: period variant', () => {
  const gc = { From: '2026-09-01T09:00:00', To: '2026-09-30T17:00:00' };
  assert.equal(groupChangeSummary(gc), 'Period: 2026-09-01 09:00 - 2026-09-30 17:00');
});

test('groupChangeSummary: recurring variant', () => {
  const gc = { Weekdays: 5, StartTime: '2026-09-01T09:00:00', StopTime: '2026-09-01T17:00:00' };
  assert.equal(
    groupChangeSummary(gc),
    'Recurring (weekdays bitmask 5): 2026-09-01 09:00 - 2026-09-01 17:00'
  );
});

test('groupChangeSummary: nothing set', () => {
  assert.equal(groupChangeSummary({}), '(no schedule set)');
});
