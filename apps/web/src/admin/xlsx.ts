/**
 * CLIENT-SIDE XLSX - a wrapper over a SERVER CSV. This is the whole design.
 * ========================================================================
 *
 * Section 53, "Security of XLS export": *generate reports server-side, log
 * report generation*. Every export in this console therefore starts at the
 * same place:
 *
 *     GET /admin/reports/licences?from=...&to=...&format=csv
 *
 * That request writes an `EXPORT_GENERATED` audit row BEFORE it writes any
 * bytes, so a file that leaves the building has a trail behind it. Only once
 * the CSV has arrived does this module get involved, and it only converts -
 * it never selects, filters, sorts or subsets. The XLSX and the CSV are
 * therefore the same report in two containers, and if they ever disagreed the
 * defect would be in the CSV, which is the audited artefact.
 *
 * Why not build the workbook from `response.rows` instead? Because the JSON
 * projection is NOT audited - see the comment on that route: it is an ordinary
 * read. Reaching for the rows would produce an unlogged export: visually
 * identical, compliance-wise invisible. So the CSV is fetched even for the
 * `.xlsx` button, and the CSV bytes are simply re-wrapped here.
 *
 * WHY A ZIP WRITER AT ALL
 * -----------------------
 * `.xlsx` is a ZIP of XML parts. The alternatives are an external dependency
 * or an `.xls` SpreadsheetML file that Excel opens behind a security prompt.
 * Both lose to ~120 lines of well-specified format: nothing to keep patched,
 * no format Excel distrusts, and `xlsx.test.ts` can assert the ZIP's own
 * signatures byte for byte.
 *
 * Entries are STORED (method 0), not deflated. Deflating needs a compressor;
 * a licence register is a few tens of kilobytes, so compression buys nothing
 * an operator would notice and costs a decompressor in the browser.
 */

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Standard CRC-32 (IEEE), the checksum the ZIP format mandates. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    c = (CRC_TABLE[(c ^ data[i]) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();

export interface ZipEntry {
  name: string;
  content: string;
}

/**
 * Minimal ZIP writer: STORED entries, no encryption, no ZIP64.
 *
 * Deliberately rejects more than 65535 entries - beyond that the format needs
 * ZIP64, and emitting a header with a wrapped count would yield a file that
 * opens on some machines and not others. A licence report has one sheet, so
 * this is never reached; it is here so that "never" is a check, not a hope.
 */
export function zip(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > 0xffff) {
    throw new Error(`zip: ${entries.length} entries exceeds the non-ZIP64 limit`);
  }

  const localParts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    (Math.floor(now.getSeconds() / 2) & 0x1f);
  const dosDate =
    (((now.getFullYear() - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const body = encoder.encode(entry.content);
    const crc = crc32(body);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header signature
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // method: stored
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, body.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // extra length
    local.set(name, 30);

    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true); // central directory signature
    dv.setUint16(4, 20, true); // version made by
    dv.setUint16(6, 20, true); // version needed
    dv.setUint16(8, 0, true); // flags
    dv.setUint16(10, 0, true); // method
    dv.setUint16(12, dosTime, true);
    dv.setUint16(14, dosDate, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, body.length, true);
    dv.setUint32(24, body.length, true);
    dv.setUint16(28, name.length, true);
    dv.setUint32(42, offset, true); // local header offset
    dir.set(name, 46);

    localParts.push(local, body);
    central.push(dir);
    offset += local.length + body.length;
  }

  const centralSize = central.reduce((total, item) => total + item.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // end of central directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of [...localParts, ...central, end]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

/* ------------------------------------------------------------------- CSV */

/**
 * RFC 4180 reader.
 *
 * Written rather than `split(",")` because a licence register contains commas:
 * customer names, addresses and the `payment_noted` free text all put them
 * there, and a naive split produces a column count that drifts partway down
 * the sheet. Quoted fields, doubled quotes inside them and embedded newlines
 * are all handled - those are exactly what a hand-typed address produces.
 */
export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (quoted) {
      if (char === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      // A quote opens a quoted field only at the START of one. Mid-field
      // quotes are literal data - `quoted"says"` is a customer's typing, and
      // treating its first `"` as an opener would swallow the rest of the
      // field into a different column.
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      // Consumed; a CRLF pair is handled by the `\n` branch that follows.
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Drop a trailing blank line, which CRLF files always produce. */
export function trimTrailingBlank(rows: string[][]): string[][] {
  const last = rows[rows.length - 1];
  if (last && last.length === 1 && last[0] === "") return rows.slice(0, -1);
  return rows;
}

/* ------------------------------------------------------------------ cells */

/** `1` -> `A`, `27` -> `AA`. 1-based, as Excel writes it. */
export function columnLetter(index: number): string {
  let n = index;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function escapeXml(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "&") out += "&amp;";
    else if (char === "<") out += "&lt;";
    else if (char === ">") out += "&gt;";
    else if (char === '"') out += "&quot;";
    else if (char === "'") out += "&apos;";
    // Control characters are legal in CSV but forbidden in XML 1.0. Stripping
    // them would silently hide data, so they are emitted as character refs.
    else if (code < 0x20 && char !== "\n" && char !== "\t" && char !== "\r") {
      out += `&#x${code.toString(16)};`;
    } else out += char;
  }
  return out;
}

const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * A cell as XML.
 *
 * Values that parse as a plain number become real numbers so Excel can sum a
 * `deviceMax` column; everything else is inline text. Timestamps are left as
 * text deliberately: Excel's serial-date conversion is timezone-dependent, and
 * a register exported in one zone and opened in another must not silently
 * shift every date by a day.
 */
function cellXml(value: string, ref: string): string {
  const trimmed = value.trim();
  if (trimmed !== "" && NUMBER_RE.test(trimmed)) {
    return `<c r="${ref}"><v>${trimmed}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function sheetXml(rows: readonly string[][]): string {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, colIndex) => cellXml(value, `${columnLetter(colIndex + 1)}${rowIndex + 1}`))
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${body}</sheetData>` +
    `</worksheet>`
  );
}

/* ------------------------------------------------------------------ xlsx */

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`;

const WORKBOOK_TEMPLATE =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
  `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<sheets><sheet name="__NAME__" sheetId="1" r:id="rId1"/></sheets>` +
  `</workbook>`;

const WORKBOOK_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
  `<borders count="1"><border/></borders>` +
  `<cellStyleXfs count="1"><xf/></cellStyleXfs>` +
  `<cellXfs count="1"><xf xfId="0"/></cellXfs>` +
  `</styleSheet>`;

/**
 * Convert a server-produced CSV into an `.xlsx` Blob.
 *
 * @param csv Exactly what `GET .../reports/licences?format=csv` returned.
 * @param sheetName Sanitised against Excel's illegal-character set and capped
 *   at 31 characters, because the name is interpolated into XML and Excel
 *   refuses a workbook whose sheet name it cannot parse.
 */
export function csvToXlsx(csv: string, sheetName = "Licences"): Blob {
  const safeName = sheetName.replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "Licences";
  const rows = trimTrailingBlank(parseCsv(csv));

  const bytes = zip([
    { name: "[Content_Types].xml", content: CONTENT_TYPES },
    { name: "_rels/.rels", content: ROOT_RELS },
    { name: "xl/workbook.xml", content: WORKBOOK_TEMPLATE.replace("__NAME__", escapeXml(safeName)) },
    { name: "xl/_rels/workbook.xml.rels", content: WORKBOOK_RELS },
    { name: "xl/styles.xml", content: STYLES },
    { name: "xl/worksheets/sheet1.xml", content: sheetXml(rows) },
  ]);

  return new Blob([bytes as unknown as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Save a Blob under a filename. Shared by the CSV and XLSX buttons. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
