function printTable(rows, columns) {
  if (rows.length === 0) {
    console.log('(none)');
    return;
  }
  const widths = columns.map((col) =>
    Math.max(col.label.length, ...rows.map((row) => String(row[col.key] ?? '').length))
  );
  const line = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join('  ');
  console.log(line(columns.map((c) => c.label)));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  for (const row of rows) {
    console.log(line(columns.map((c) => row[c.key] ?? '')));
  }
}

function printKeyValues(pairs) {
  const width = Math.max(...pairs.map(([key]) => key.length));
  for (const [key, value] of pairs) {
    console.log(`${key.padEnd(width)} : ${value}`);
  }
}

module.exports = { printTable, printKeyValues };
