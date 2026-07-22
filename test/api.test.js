const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  PreComError,
  parseReceivers,
  toTimeSpan,
  parseWeekdays,
  buildSoundPayload,
  VALID_SOUNDS,
  SOUND_CATEGORIES,
} = require('../src/api');

test('parseReceivers: single type:id pair', () => {
  assert.deepEqual(parseReceivers('1:22548'), [{ Type: 1, ID: 22548 }]);
});

test('parseReceivers: multiple comma-separated pairs', () => {
  assert.deepEqual(parseReceivers('1:22548,2:9'), [
    { Type: 1, ID: 22548 },
    { Type: 2, ID: 9 },
  ]);
});

test('parseReceivers: optional label, incl. a label containing a colon', () => {
  assert.deepEqual(parseReceivers('1:22548:John Doe'), [{ Type: 1, ID: 22548, Label: 'John Doe' }]);
  assert.deepEqual(parseReceivers('1:22548:a:b'), [{ Type: 1, ID: 22548, Label: 'a:b' }]);
});

test('parseReceivers: rejects malformed input', () => {
  assert.throws(() => parseReceivers('bad'), PreComError);
  assert.throws(() => parseReceivers('1:'), PreComError);
  assert.throws(() => parseReceivers(':5'), PreComError);
  assert.throws(() => parseReceivers('x:5'), PreComError);
  assert.throws(() => parseReceivers('1:y'), PreComError);
});

test('toTimeSpan: whole hours 0-23', () => {
  assert.equal(toTimeSpan(0), '00:00:00');
  assert.equal(toTimeSpan(8), '08:00:00');
  assert.equal(toTimeSpan(23), '23:00:00');
  assert.equal(toTimeSpan('8'), '08:00:00'); // string input, as parseArgs produces
});

test('toTimeSpan: rejects out-of-range and non-integers', () => {
  assert.throws(() => toTimeSpan(24), PreComError);
  assert.throws(() => toTimeSpan(-1), PreComError);
  assert.throws(() => toTimeSpan(8.5), PreComError);
  assert.throws(() => toTimeSpan('abc'), PreComError);
});

test('parseWeekdays: single and multiple days OR into a bitmask', () => {
  assert.equal(parseWeekdays('mon'), 1);
  assert.equal(parseWeekdays('sun'), 64);
  assert.equal(parseWeekdays('mon,wed,fri'), 1 | 4 | 16);
  assert.equal(parseWeekdays('MON,Tue'), 1 | 2); // case-insensitive, trims
  assert.equal(parseWeekdays('mon, tue , wed'), 1 | 2 | 4);
});

test('parseWeekdays: rejects unknown day names', () => {
  assert.throws(() => parseWeekdays('funday'), PreComError);
  assert.throws(() => parseWeekdays('mon,xyz'), PreComError);
});

test('buildSoundPayload: preserves all fields when no changes given', () => {
  const current = {
    SoundAlarm: 'siren', SoundInfo: 'vibrate', SoundUnderstaffing: 'silent',
    SoundOccupancy: 'pager', SoundProposal: 'chirp',
    CriticalAlertsAlarm: true, CriticalAlertsInfo: false, CriticalAlertsUnderstaffing: false,
    CriticalAlertsOccupancy: false, CriticalAlertsProposal: false,
  };
  const out = buildSoundPayload(current, {});
  assert.equal(Object.keys(out).length, 10);
  assert.deepEqual(out, current);
});

test('buildSoundPayload: overrides only the changed category, keeps the rest', () => {
  const current = {
    SoundAlarm: 'siren', SoundInfo: 'vibrate', SoundUnderstaffing: 'silent',
    SoundOccupancy: 'pager', SoundProposal: 'chirp',
    CriticalAlertsAlarm: false, CriticalAlertsInfo: false, CriticalAlertsUnderstaffing: false,
    CriticalAlertsOccupancy: false, CriticalAlertsProposal: false,
  };
  const out = buildSoundPayload(current, { alarm: 'pager6x', 'critical-info': true });
  assert.equal(out.SoundAlarm, 'pager6x');
  assert.equal(out.SoundInfo, 'vibrate'); // untouched
  assert.equal(out.CriticalAlertsInfo, true);
  assert.equal(out.CriticalAlertsAlarm, false); // untouched
});

test('buildSoundPayload: ignores irrelevant keys (e.g. parseArgs noise)', () => {
  const current = {
    SoundAlarm: 'siren', SoundInfo: 'vibrate', SoundUnderstaffing: 'silent',
    SoundOccupancy: 'pager', SoundProposal: 'chirp',
    CriticalAlertsAlarm: false, CriticalAlertsInfo: false, CriticalAlertsUnderstaffing: false,
    CriticalAlertsOccupancy: false, CriticalAlertsProposal: false,
  };
  const out = buildSoundPayload(current, { _: [], json: true, occupancy: 'silent' });
  assert.equal(out.SoundOccupancy, 'silent');
  assert.equal(Object.keys(out).length, 10);
});

test('SOUND_CATEGORIES stays in sync with the 5 sound fields', () => {
  assert.deepEqual(Object.keys(SOUND_CATEGORIES), [
    'alarm', 'info', 'understaffing', 'occupancy', 'proposal',
  ]);
});

test('VALID_SOUNDS contains the documented values', () => {
  assert.ok(VALID_SOUNDS.includes('silent'));
  assert.ok(VALID_SOUNDS.includes('siren6x'));
  assert.equal(VALID_SOUNDS.length, 16);
});
