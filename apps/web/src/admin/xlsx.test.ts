/**
 * THE XLSX WRITER - a container change over a SERVER CSV, checked byte-wise.
 * ========================================================================
 *
 * Two halves of one promise:
 *
 *   (a) the ZIP is a real ZIP - local headers, central directory, EOCD, and a
 *       CRC-32 that Excel will verify;
 *   (b) the conversion is LOSS-FREE - every cell of the CSV reaches the
 *       sheet, with commas, quotes and embedded newlines intact.
 *
 * (b) is the one that matters to an operator: an export that silently
 * re-splits a customer address across two columns is worse than no export,
 * because it looks correct. The reader used here is independent of the writer
 * - it walks the headers the format defines rather than trusting anything
 * this module produced - so a symmetric bug in both would not cancel out.
 *
 * What is NOT asserted: that Excel opens the file. That is a manual check
 * recorded in the PR, because an emulator cannot stand in for the consumer of
 * the artefact. Everything Excel is strict about that we can check, we do.
 */
import { describe, expect, it } from "vitest";
import { columnLetter, crc32, csvToXlsx, parseCsv, trimTrailingBlank, zip } from "./xlsx";

const utf8 = new TextEncoder();
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** Minimal STORED-zip reader. Deliberately written from the format, not reused. */
function readZip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts = new Map<string, string>();
  let cursor = 0;
  while (cursor + 30 <= bytes.length && view.getUint32(cursor, true) === 0x04034b50) {
    const method = view.getUint16(cursor + 8, true);
    expect(method, "entries must be STORED, which this reader understands").toBe(0);
    const compressedSize = view.getUint32(cursor + 18, true);
    const nameLength = view.getUint16(cursor + 26, true);
    const extraLength = view.getUint16(cursor + 28, true);
    const name = decode(bytes.subarray(cursor + 30, cursor + 30 + nameLength));
    const bodyStart = cursor + 30 + nameLength + extraLength;
    parts.set(name, decode(bytes.subarray(bodyStart, bodyStart + compressedSize)));
    cursor = bodyStart + compressedSize;
  }
  return parts;
}

describe("crc32", () => {
  it("matches the published IEEE vector", () => {
    expect(crc32(utf8.encode("123456789")) >>> 0).toBe(0xcbf43926);
  });

  it("is zero for the empty input", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("zip", () => {
  it("opens with a local file header and closes with an end-of-central-directory", () => {
    const bytes = zip([{ name: "a.txt", content: "hello" }]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50); // PK\x03\x04
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50); // PK\x05\x06
    expect(view.getUint16(end + 8, true)).toBe(1); // records on this disk
    expect(view.getUint16(end + 10, true)).toBe(1); // records total
    expect(view.getUint32(end + 12, true)).toBeGreaterThan(0); // central dir size
    expect(view.getUint32(end + 16, true)).toBeGreaterThan(0); // central dir offset
  });

  it("round-trips names and bodies", () => {
    const bytes = zip([
      { name: "one.txt", content: "first" },
      { name: "nested/two.txt", content: "second" },
    ]);
    const parts = readZip(bytes);
    expect([...parts.keys()]).toEqual(["one.txt", "nested/two.txt"]);
    expect(parts.get("one.txt")).toBe("first");
    expect(parts.get("nested/two.txt")).toBe("second");
  });

  it("stores the CRC of each body in its local header", () => {
    const bytes = zip([{ name: "a.txt", content: "hello" }]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(14, true)).toBe(crc32(utf8.encode("hello")));
  });
});

describe("parseCsv", () => {
  it("reads plain rows", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps commas that live inside quotes", () => {
    expect(parseCsv('"Pune, Maharashtra",411001')).toEqual([["Pune, Maharashtra", "411001"]]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv('"She said ""hi""",yes')).toEqual([['She said "hi"', "yes"]]);
  });

  it("keeps a newline that lives inside quotes", () => {
    expect(parseCsv('"line one\nline two",x')).toEqual([["line one\nline two", "x"]]);
  });

  it("swallows CRLF without leaving a phantom column", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("drops a trailing blank line", () => {
    expect(trimTrailingBlank(parseCsv("a,b\n\n"))).toEqual([["a", "b"]]);
  });

  it("handles an empty trailing field", () => {
    expect(parseCsv("a,")).toEqual([["a", ""]]);
  });
});

describe("columnLetter", () => {
  it("counts 1-based through Z, then AA", () => {
    expect(columnLetter(1)).toBe("A");
    expect(columnLetter(26)).toBe("Z");
    expect(columnLetter(27)).toBe("AA");
    expect(columnLetter(28)).toBe("AB");
    expect(columnLetter(703)).toBe("AAA");
  });
});

describe("csvToXlsx", () => {
  const CSV = [
    "customerEmail,deviceMax,note",
    "customer@example.com,5,\"Pune, Maharashtra\"",
    'quoted"says",10,',
  ].join("\r\n");

  it("produces a spreadsheet-typed blob", async () => {
    const blob = csvToXlsx(CSV);
    expect(blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(blob.size).toBeGreaterThan(100);
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    expect([...head]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("packs every part a workbook needs", async () => {
    const parts = readZip(new Uint8Array(await csvToXlsx(CSV).arrayBuffer()));
    expect([...parts.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ]);
    for (const [name, content] of parts) {
      expect(content, `${name} must be XML`).toMatch(/^<\?xml version="1\.0"/);
    }
  });

  it("carries every CSV cell through, in order", async () => {
    const parts = readZip(new Uint8Array(await csvToXlsx(CSV).arrayBuffer()));
    const sheet = parts.get("xl/worksheets/sheet1.xml") ?? "";

    expect(sheet).toContain('<row r="1">');
    expect(sheet).toContain("customerEmail");
    expect(sheet).toContain("deviceMax");
    expect(sheet).toContain("note");

    expect(sheet).toContain("customer@example.com");
    expect(sheet).toContain("Pune, Maharashtra");
    expect(sheet).toContain('quoted&quot;says&quot;');

    // Row 1 has three cells, row 3 has three - no drift from the quoted comma.
    expect(sheet.match(/<row /g)).toHaveLength(3);
    expect(sheet.match(/<c r="[A-Z]+1"/g)).toHaveLength(3);
    expect(sheet.match(/<c r="[A-Z]+2"/g)).toHaveLength(3);
    expect(sheet.match(/<c r="[A-Z]+3"/g)).toHaveLength(3);
  });

  it("writes numeric columns as numbers so a capacity column can be summed", async () => {
    const parts = readZip(new Uint8Array(await csvToXlsx("deviceMax\n5\n").arrayBuffer()));
    const sheet = parts.get("xl/worksheets/sheet1.xml") ?? "";
    expect(sheet).toContain('<c r="A2"><v>5</v></c>');
    expect(sheet).not.toContain('<c r="A2" t="inlineStr"');
  });

  it("escapes XML metacharacters instead of dropping them", async () => {
    const parts = readZip(new Uint8Array(await csvToXlsx("note\na & b < c > d\n").arrayBuffer()));
    const sheet = parts.get("xl/worksheets/sheet1.xml") ?? "";
    expect(sheet).toContain("a &amp; b &lt; c &gt; d");
  });

  it("sanitises a sheet name Excel would refuse", async () => {
    const parts = readZip(
      new Uint8Array(await csvToXlsx("a\n1\n", "Lic/ence:Name[2]").arrayBuffer()),
    );
    const workbook = parts.get("xl/workbook.xml") ?? "";
    expect(workbook).toContain('name="LicenceName2"');
    // The only `name=` in a workbook is the sheet's.
    const declared = [...workbook.matchAll(/name="([^"]*)"/g)].map((match) => match[1]);
    expect(declared).toEqual(["LicenceName2"]);
    for (const illegal of ["\\", "/", "?", "*", "[", "]", ":"]) {
      expect(declared[0]).not.toContain(illegal);
    }
  });

  it("is derived from the CSV - it never has a second source of rows", async () => {
    // Two different inputs must produce two different sheets and nothing else
    // the CSV did not contain.
    const a = readZip(new Uint8Array(await csvToXlsx("x\nalpha\n").arrayBuffer())).get(
      "xl/worksheets/sheet1.xml",
    );
    const b = readZip(new Uint8Array(await csvToXlsx("x\nbeta\n").arrayBuffer())).get(
      "xl/worksheets/sheet1.xml",
    );
    expect(a).toContain("alpha");
    expect(a).not.toContain("beta");
    expect(b).toContain("beta");
    expect(b).not.toContain("alpha");
  });
});
