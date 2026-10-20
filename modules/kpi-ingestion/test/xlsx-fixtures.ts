// Workbooks built by hand for the XLSX tests: a normal one from the writer, and the hostile ones the guard exists for. Nothing here
// is read from disk; every file is made in memory.
import { strToU8, zipSync } from 'fflate';
import writeExcelFile from 'write-excel-file/node';

type Cell =
  string | number | boolean | Date | null | { value: unknown; type?: unknown; format?: string };

/** A workbook with one sheet, written by `write-excel-file`. */
export async function workbook(rows: Cell[][], sheet = 'Sheet1'): Promise<Buffer> {
  return writeExcelFile(rows as never, { sheet }).toBuffer();
}

/** A workbook with a formula cell: the file holds the formula and a cached value. */
export function withFormula(): Uint8Array {
  return rawWorkbook(
    `<row r="1"><c r="A1" t="inlineStr"><is><t>Period</t></is></c><c r="B1" t="inlineStr"><is><t>Downloads</t></is></c></row>` +
      `<row r="2"><c r="A2" t="inlineStr"><is><t>2026-01</t></is></c><c r="B2"><f>1+1</f><v>7</v></c></row>`,
  );
}

/** A workbook whose sheet XML is given (the rest is the minimum a reader needs). */
export function rawWorkbook(sheetRows: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    ),
  });
}

/** A zip bomb: small on disk, `inflatedBytes` of zeros inside. */
export function bomb(inflatedBytes = 60 * 1024 * 1024): Uint8Array {
  return zipSync({ 'xl/worksheets/sheet1.xml': new Uint8Array(inflatedBytes) }, { level: 9 });
}

/** The offsets of the size fields of the one entry of a zip made by `zipSync` (local header at 0, central directory after the data). */
function patchSizes(zip: Uint8Array, uncompressed: number): Uint8Array {
  const copy = new Uint8Array(zip);
  const view = new DataView(copy.buffer);
  // local header: signature 0x04034b50, uncompressed size at +22
  view.setUint32(22, uncompressed, true);
  // central directory: find 0x02014b50, uncompressed size at +24
  for (let i = copy.length - 22; i >= 0; i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      view.setUint32(view.getUint32(i + 16, true) + 24, uncompressed, true);
      return copy;
    }
  throw new Error('no end record');
}

/** A bomb whose headers lie: the central directory and the local header both say 1 000 bytes. */
export function lyingBomb(inflatedBytes = 60 * 1024 * 1024): Uint8Array {
  return patchSizes(bomb(inflatedBytes), 1000);
}

/** The same zip with the "encrypted" flag set on its entries (general-purpose bit 0). */
export function encryptedEntry(zip: Uint8Array): Uint8Array {
  const copy = new Uint8Array(zip);
  const view = new DataView(copy.buffer);
  view.setUint16(6, view.getUint16(6, true) | 1, true); // local header flags
  for (let i = copy.length - 22; i >= 0; i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      const at = view.getUint32(i + 16, true);
      view.setUint16(at + 8, view.getUint16(at + 8, true) | 1, true);
      return copy;
    }
  throw new Error('no end record');
}

/** A password-protected workbook as Office saves it: an OLE2 compound file, not a zip. */
export function oleFile(): Uint8Array {
  const bytes = new Uint8Array(2048);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return bytes;
}

/** A zip with `count` empty entries. */
export function manyEntries(count: number): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (let i = 0; i < count; i++) files[`f${i}.xml`] = new Uint8Array(0);
  return zipSync(files);
}
