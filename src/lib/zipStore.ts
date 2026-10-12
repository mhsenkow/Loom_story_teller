export { downloadBlob } from "./download";

// =================================================================
// Minimal ZIP (store / no compression) for social export packs
// =================================================================
// Builds a valid ZIP so we avoid adding a compression dependency.
// Fine for PNGs and small text/JSON sidecar files.
// =================================================================

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC32_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  b[2] = (n >>> 16) & 0xff;
  b[3] = (n >>> 24) & 0xff;
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** DOS date/time for ZIP local/central headers (local wall clock). */
export function zipDosDateTime(d = new Date()): { dosTime: number; dosDate: number } {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { dosTime, dosDate };
}

/** ZIP general-purpose bit 11 — UTF-8 file names. */
export const ZIP_UTF8_FLAG = 0x0800;

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Build an uncompressed ZIP archive from named file entries. */
export function buildZip(entries: ZipEntry[], now = new Date()): Uint8Array {
  const { dosTime, dosDate } = zipDosDateTime(now);
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name.replace(/\\/g, "/"));
    const data = entry.data;
    const crc = crc32(data);
    const localHeader = concat([
      u32(0x04034b50),
      u16(20),
      u16(ZIP_UTF8_FLAG),
      u16(0),
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    ]);
    localParts.push(localHeader, data);

    const central = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(ZIP_UTF8_FLAG),
      u16(0),
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]);
    centralParts.push(central);
    offset += localHeader.length + data.length;
  }

  const centralDir = concat(centralParts);
  const local = concat(localParts);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDir.length),
    u32(local.length),
    u16(0),
  ]);
  return concat([local, centralDir, end]);
}
