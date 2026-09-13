import { describe, it, expect } from "vitest";
import { crc32, createZip, createZipBlob, sanitizeEntryName, MAX_ZIP_ENTRIES } from "../src/zip.js";

function readU16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}
function readU32(bytes, offset) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

describe("crc32", () => {
  it("matches the standard check vector", () => {
    // IEEE CRC-32 of "123456789"
    const bytes = new TextEncoder().encode("123456789");
    expect(crc32(bytes)).toBe(0xcbf43926);
  });

  it("is 0 for empty input", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("handles >64KB inputs without overflow", () => {
    const bytes = new Uint8Array(100_000).fill(7);
    expect(typeof crc32(bytes)).toBe("number");
    expect(crc32(bytes)).toBeGreaterThan(0);
  });
});

describe("sanitizeEntryName", () => {
  it("strips path traversal and absolute paths", () => {
    expect(sanitizeEntryName("../../etc/passwd")).toBe("etc/passwd");
    expect(sanitizeEntryName("/abs/path/file.png")).toBe("abs/path/file.png");
    expect(sanitizeEntryName("a\\b\\c.png")).toBe("a/b/c.png");
    expect(sanitizeEntryName("a/./b/../c.png")).toBe("a/b/c.png");
  });

  it("falls back for empty names", () => {
    expect(sanitizeEntryName("")).toBe("file");
    expect(sanitizeEntryName("../../../")).toBe("file");
  });
});

describe("createZip", () => {
  it("produces a valid STORE archive for a single file", () => {
    const data = new TextEncoder().encode("hello PNGCut");
    const zip = createZip([{ name: "a.txt", data }]);
    const name = new TextEncoder().encode("a.txt");

    // local header + name + data, central record + name, EOCD
    expect(zip.length).toBe(22 + 30 + name.length + data.length + 46 + name.length);
    expect(readU32(zip, 0)).toBe(0x04034b50);
    expect(readU16(zip, 8)).toBe(0); // STORE
    expect(readU32(zip, 14)).toBe(crc32(data));
    expect(readU32(zip, 18)).toBe(data.length);
    expect(readU32(zip, 22)).toBe(data.length);
    expect(readU16(zip, 26)).toBe(name.length);
    expect([...zip.slice(30, 30 + name.length)]).toEqual([...name]);
    expect([...zip.slice(30 + name.length, 30 + name.length + data.length)]).toEqual([...data]);

    // central directory record
    const cdOffset = 30 + name.length + data.length;
    expect(readU32(zip, cdOffset)).toBe(0x02014b50);
    expect(readU32(zip, cdOffset + 16)).toBe(crc32(data));
    expect(readU32(zip, cdOffset + 42)).toBe(0); // local header offset

    // EOCD
    const eocd = zip.length - 22;
    expect(readU32(zip, eocd)).toBe(0x06054b50);
    expect(readU16(zip, eocd + 8)).toBe(1);
    expect(readU16(zip, eocd + 10)).toBe(1);
    expect(readU32(zip, eocd + 12)).toBe(46 + name.length); // central directory size
    expect(readU32(zip, eocd + 16)).toBe(cdOffset);
  });

  it("packs multiple entries in order with correct offsets", () => {
    const a = new TextEncoder().encode("aaa");
    const b = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    const zip = createZip([
      { name: "a.txt", data: a },
      { name: "folder/b.bin", data: b },
    ]);

    // second local header lands after first entry (30 + 5 + 3)
    const second = 30 + 5 + 3;
    expect(readU32(zip, second)).toBe(0x04034b50);
    expect(readU16(zip, second + 26)).toBe("folder/b.bin".length);
    expect([...zip.slice(second + 30, second + 30 + 12)]).toEqual([
      ...new TextEncoder().encode("folder/b.bin"),
    ]);

    const eocd = zip.length - 22;
    expect(readU16(zip, eocd + 8)).toBe(2);
  });

  it("sanitizes hostile entry names", () => {
    const data = new Uint8Array([1]);
    const zip = createZip([{ name: "../../evil.png", data }]);
    const nameLen = readU16(zip, 26);
    const name = new TextDecoder().decode(zip.slice(30, 30 + nameLen));
    expect(name).toBe("evil.png");
  });

  it("preserves UTF-8 names and flags them", () => {
    const data = new Uint8Array([1]);
    const zip = createZip([{ name: "emo-🧪.png", data }]);
    expect(readU16(zip, 6) & 0x0800).toBe(0x0800); // UTF-8 flag
    const nameLen = readU16(zip, 26);
    expect(nameLen).toBeGreaterThan(9); // emoji = extra bytes
  });

  it("rejects empty input and non-byte payloads", () => {
    expect(() => createZip([])).toThrow(RangeError);
    // @ts-expect-error — deliberately wrong payload type
    expect(() => createZip([{ name: "a", data: "nope" }])).toThrow(RangeError);
  });

  it("enforces the entry ceiling", () => {
    const one = { name: "a", data: new Uint8Array(1) };
    expect(() => createZip(new Array(MAX_ZIP_ENTRIES + 1).fill(one))).toThrow(RangeError);
  });
});

describe("createZipBlob", () => {
  it("returns an application/zip Blob", () => {
    const blob = createZipBlob([{ name: "x.png", data: new Uint8Array([9, 8, 7]) }]);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/zip");
  });
});
