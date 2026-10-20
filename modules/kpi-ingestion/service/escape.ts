// Output that a spreadsheet opens (the import templates, CSV and XLSX) is escaped against formula injection: indicator and service
// names are administrators' text, and a cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return is a formula to Excel
// and LibreOffice. Such a cell gets a leading `'`. The reader takes it off again from a header, so the template
// re-uploads unchanged. Pure.

/** The characters that make a spreadsheet read a cell as a formula (OWASP's list). */
const DANGEROUS = new Set(['=', '+', '-', '@', '\t', '\r']);

/** The cell as it is written to a spreadsheet: a formula-looking text is prefixed with `'`. */
export function escapeCell(text: string): string {
  return text !== '' && DANGEROUS.has(text[0]!) ? `'${text}` : text;
}

/** What `escapeCell` did, undone: `'=x` is `=x` again. A text that begins with `'` and then anything else is left alone. */
export function unescapeCell(text: string): string {
  return text.length > 1 && text[0] === "'" && DANGEROUS.has(text[1]!) ? text.slice(1) : text;
}
