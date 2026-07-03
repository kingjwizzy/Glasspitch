// Minimal, dependency-free CSV serialisation (RFC 4180-ish: quote a field
// only when it contains a comma, quote or newline; escape quotes by doubling).
// Small enough not to warrant a dependency for the one export route that needs
// it (the premium ledger CSV).

function csvField(value: string | number | boolean | null): string {
  const s = value === null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(
  columns: string[],
  rows: Array<Array<string | number | boolean | null>>,
): string {
  const lines = [columns.map(csvField).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvField).join(','));
  }
  // Trailing newline is conventional for CSV files.
  return lines.join('\r\n') + '\r\n';
}
