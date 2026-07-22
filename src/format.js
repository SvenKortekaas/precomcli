// Some upstream free-text fields (e.g. capcode descriptions) have been
// observed containing embedded newlines, which breaks single-line-per-row
// table alignment - collapse all whitespace runs to a single space.
function cell(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function printTable(rows, columns) {
  if (rows.length === 0) {
    console.log('(none)');
    return;
  }
  const widths = columns.map((col) => Math.max(col.label.length, ...rows.map((row) => cell(row[col.key]).length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(line(columns.map((c) => c.label)));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  for (const row of rows) {
    console.log(line(columns.map((c) => cell(row[c.key]))));
  }
}

function printKeyValues(pairs) {
  const width = Math.max(...pairs.map(([key]) => key.length));
  for (const [key, value] of pairs) {
    console.log(`${key.padEnd(width)} : ${value}`);
  }
}

module.exports = { printTable, printKeyValues };
