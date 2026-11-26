/**
 * Leichtgewichtiger, abhängigkeitsfreier PKZIP-Builder (STORE-Modus) für den Browser-Export
 * von Videoclips (bereits komprimiertes H.264/HEVC) und optionalen JSON/CSV-Metadaten (#8).
 */

export interface ZipDateiEintrag {
  name: string;
  data: Uint8Array | string;
}

const CRC_TABELLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function berechneCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABELLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function bereinigeZipPfad(name: string): string {
  return name
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\.\.\//g, '')
    .trim() || 'file.bin';
}

export function erzeugeZipBytes(dateien: readonly ZipDateiEintrag[]): Uint8Array {
  const encoder = new TextEncoder();
  const lokaleTeile: Uint8Array[] = [];
  const zentralTeile: Uint8Array[] = [];
  let offset = 0;

  const jetzt = new Date();
  const dosZeit =
    ((jetzt.getHours() & 0x1f) << 11) |
    ((jetzt.getMinutes() & 0x3f) << 5) |
    ((Math.floor(jetzt.getSeconds() / 2)) & 0x1f);
  const dosDatum =
    (((Math.max(1980, jetzt.getFullYear()) - 1980) & 0x7f) << 9) |
    (((jetzt.getMonth() + 1) & 0x0f) << 5) |
    (jetzt.getDate() & 0x1f);

  for (const eintrag of dateien) {
    const pfadBytes = encoder.encode(bereinigeZipPfad(eintrag.name));
    const datenBytes =
      typeof eintrag.data === 'string' ? encoder.encode(eintrag.data) : eintrag.data;
    const crc = berechneCrc32(datenBytes);
    const groesse = datenBytes.length;

    // Local File Header (30 Bytes + Dateiname)
    const localHeader = new Uint8Array(30 + pfadBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // Local header signature
    lv.setUint16(4, 20, true); // Version needed (2.0)
    lv.setUint16(6, 0x0800, true); // UTF-8 flag
    lv.setUint16(8, 0, true); // STORE (uncompressed)
    lv.setUint16(10, dosZeit, true);
    lv.setUint16(12, dosDatum, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, groesse, true);
    lv.setUint32(22, groesse, true);
    lv.setUint16(26, pfadBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(pfadBytes, 30);

    lokaleTeile.push(localHeader, datenBytes);

    // Central Directory Header (46 Bytes + Dateiname)
    const centralHeader = new Uint8Array(46 + pfadBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // Central dir signature
    cv.setUint16(4, 20, true); // Version made by
    cv.setUint16(6, 20, true); // Version needed
    cv.setUint16(8, 0x0800, true); // UTF-8 flag
    cv.setUint16(10, 0, true); // STORE
    cv.setUint16(12, dosZeit, true);
    cv.setUint16(14, dosDatum, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, groesse, true);
    cv.setUint32(24, groesse, true);
    cv.setUint16(28, pfadBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(pfadBytes, 46);

    zentralTeile.push(centralHeader);
    offset += localHeader.length + datenBytes.length;
  }

  const centralSize = zentralTeile.reduce((sum, arr) => sum + arr.length, 0);

  // End of Central Directory Record (22 Bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, dateien.length, true);
  ev.setUint16(10, dateien.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const gesamtLaenge = offset + centralSize + eocd.length;
  const ergebnis = new Uint8Array(gesamtLaenge);
  let pos = 0;
  for (const teil of lokaleTeile) {
    ergebnis.set(teil, pos);
    pos += teil.length;
  }
  for (const teil of zentralTeile) {
    ergebnis.set(teil, pos);
    pos += teil.length;
  }
  ergebnis.set(eocd, pos);
  return ergebnis;
}

export function erzeugeZipBlob(dateien: readonly ZipDateiEintrag[]): Blob {
  const bytes = erzeugeZipBytes(dateien);
  const kopie = new Uint8Array(bytes.byteLength);
  kopie.set(bytes);
  return new Blob([kopie.buffer], { type: 'application/zip' });
}
