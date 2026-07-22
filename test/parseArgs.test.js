const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../src/cli');

test('parseArgs: positionals collect into _', () => {
  assert.deepEqual(parseArgs(['3226', '2026-08-01']), { _: ['3226', '2026-08-01'] });
});

test('parseArgs: --flag value', () => {
  assert.deepEqual(parseArgs(['--from', '2026-08-01']), { _: [], from: '2026-08-01' });
});

test('parseArgs: --flag=value form', () => {
  assert.deepEqual(parseArgs(['--from=2026-08-01']), { _: [], from: '2026-08-01' });
  assert.deepEqual(parseArgs(['--control-id=b']), { _: [], 'control-id': 'b' });
});

test('parseArgs: boolean flags are true, never swallow the next token', () => {
  // --json is a declared boolean; the trailing positional must NOT be consumed.
  assert.deepEqual(parseArgs(['groups', '--json']), { _: ['groups'], json: true });
  assert.deepEqual(parseArgs(['--all', '3226']), { _: ['3226'], all: true });
});

test('parseArgs: --priority false does not silently enable priority', () => {
  // priority is a declared boolean flag, so "false" stays a positional rather
  // than becoming the string "false" (which is truthy) as its value.
  const args = parseArgs(['--priority', 'false']);
  assert.equal(args.priority, true);
  assert.deepEqual(args._, ['false']);
});

test('parseArgs: value flag directly before a boolean flag', () => {
  const args = parseArgs(['--to', '1:22548', '--priority']);
  assert.equal(args.to, '1:22548');
  assert.equal(args.priority, true);
});

test('parseArgs: negative numeric values are captured, not treated as flags', () => {
  const args = parseArgs(['--msg-in-id', '16252165', '--previous-or-next', '-5']);
  assert.equal(args['msg-in-id'], '16252165');
  assert.equal(args['previous-or-next'], '-5');
});

test('parseArgs: mixed positionals and flags', () => {
  const args = parseArgs(['3226', '--from', '2026-08-01', '--json']);
  assert.deepEqual(args._, ['3226']);
  assert.equal(args.from, '2026-08-01');
  assert.equal(args.json, true);
});
