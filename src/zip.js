/**
 * Minimal ZIP archive writer — STORE method, no compression, zero dependencies.
 *
 * Why hand-rolled: bulk results are PNG/WebP/JPEG blobs that are *already*
 * deflate-compressed, so recompressing gains ~0–2% while adding a dependency
 * and CPU cost. STORE keeps files byte-identical, the writer ~150 lines, and
 * the output opens in every OS/browser unzipper.
 *
 * Output is deterministic: fixed DOS timestamp, stable entry order.
 * (Pure code — unit tested in test/zip.test.js.)
 */

/** Standard IEEE CRC-32 (polynomial 0xEDB88320), table built lazily once. */
let crcTable = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

/**
 * CRC-32 of a byte array.
 * @param {Uint8Array} bytes
 * @returns {number} unsigned 32-bit CRC
 */
export function crc32(bytes) {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIG_LOCAL = 0x04034b50; // PK\x03\x04
const SIG_CENTRAL = 0x02014b50; // PK\x01\x02
const SIG_EOCD = 0x06054b50; // PK\x05\x06

// Fixed DOS timestamp: 2024-01-01 00:00 (bit-packed year/month/day)
const DOS_TIME = 0;
const DOS_DATE = (44 << 9) | (1 << 5) | 1;

const UTF8_FLAG = 0x0800;
const VERSION_NEEDED = 20;

/** ZIP archives cap entries at 65535 — enforced for safety. */
export const MAX_ZIP_ENTRIES = 65535;

/**
 * Strip path traversal segments and leading slashes from an entry name so the
 * archive can never escape its extraction folder ("zip slip").
 * @param {string} name
 * @returns {string} safe entry name (empty → "file")
 */
export function sanitizeEntryName(name) {
  let safe = String(name == null ? "" : name)
    .replace(/\\/g, "/")
    .split("/")
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .join("/");
  if (!safe) safe = "file";
  return safe;
}

function utf8Encode(str) {
  return new TextEncoder().encode(str);
}

/**
 * Build a ZIP archive from files (STORE method).
 * @param {{name: string, data: Uint8Array}[]} files entry list (names may
 *        include folders, e.g. "images/photo.png"); traversal segments are
 *        sanitized and UTF-8 names flagged.
 * @returns {Uint8Array} complete archive bytes
 * @throws {RangeError} on 0 entries, too many entries, or non-byte payloads
 */
export function createZip(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new RangeError("createZip needs at least one file");
  }
  if (files.length > MAX_ZIP_ENTRIES) {
    throw new RangeError(`createZip supports up to ${MAX_ZIP_ENTRIES} entries`);
  }

  // Measure once so the archive is allocated exactly (no per-entry realloc).
  let total = 22; // EOCD
  const prepared = files.map((f) => {
    if (!(f.data instanceof Uint8Array)) throw new RangeError("entry.data must be a Uint8Array");
    const nameBytes = utf8Encode(sanitizeEntryName(f.name));
    total += 30 + nameBytes.length + f.data.length; // local header + name + data
    total += 46 + nameBytes.length; // central directory record
    return { nameBytes, data: f.data };
  });

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  let offset = 0;
  const entries = [];

  for (const f of prepared) {
    const crc = crc32(f.data);
    entries.push({ nameBytes: f.nameBytes, crc, size: f.data.length, offset });
    view.setUint32(offset, SIG_LOCAL, true);
    view.setUint16(offset + 4, VERSION_NEEDED, true);
    view.setUint16(offset + 6, UTF8_FLAG, true); // general purpose bit 11: UTF-8
    view.setUint16(offset + 8, 0, true); // method: STORE
    view.setUint16(offset + 10, DOS_TIME, true);
    view.setUint16(offset + 12, DOS_DATE, true);
    view.setUint32(offset + 14, crc, true);
    view.setUint32(offset + 18, f.data.length, true); // compressed size
    view.setUint32(offset + 22, f.data.length, true); // uncompressed size
    view.setUint16(offset + 26, f.nameBytes.length, true);
    view.setUint16(offset + 28, 0, true); // extra length
    offset += 30;
    out.set(f.nameBytes, offset);
    offset += f.nameBytes.length;
    out.set(f.data, offset);
    offset += f.data.length;
  }

  const centralStart = offset;
  for (const e of entries) {
    view.setUint32(offset, SIG_CENTRAL, true);
    view.setUint16(offset + 4, VERSION_NEEDED, true); // version made by
    view.setUint16(offset + 6, VERSION_NEEDED, true); // version needed
    view.setUint16(offset + 8, UTF8_FLAG, true);
    view.setUint16(offset + 10, 0, true); // method STORE
    view.setUint16(offset + 12, DOS_TIME, true);
    view.setUint16(offset + 14, DOS_DATE, true);
    view.setUint32(offset + 16, e.crc, true);
    view.setUint32(offset + 20, e.size, true);
    view.setUint32(offset + 24, e.size, true);
    view.setUint16(offset + 28, e.nameBytes.length, true);
    view.setUint16(offset + 30, 0, true); // extra
    view.setUint16(offset + 32, 0, true); // comment
    view.setUint16(offset + 34, 0, true); // disk number start
    view.setUint16(offset + 36, 0, true); // internal attrs
    view.setUint32(offset + 38, 0, true); // external attrs
    view.setUint32(offset + 42, e.offset, true);
    offset += 46;
    out.set(e.nameBytes, offset);
    offset += e.nameBytes.length;
  }
  const centralSize = offset - centralStart;

  view.setUint32(offset, SIG_EOCD, true);
  view.setUint16(offset + 4, 0, true); // disk number
  view.setUint16(offset + 6, 0, true); // central directory disk
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, centralSize, true);
  view.setUint32(offset + 16, centralStart, true);
  view.setUint16(offset + 20, 0, true); // comment length
  offset += 22;

  if (offset !== total) throw new Error(`createZip size mismatch (${offset} != ${total})`);
  return out;
}

/**
 * Convenience: build a ZIP and return a Blob ready for download.
 * @param {{name: string, data: Uint8Array}[]} files
 * @returns {Blob} application/zip
 */
export function createZipBlob(files) {
  return new Blob([createZip(files)], { type: "application/zip" });
}
