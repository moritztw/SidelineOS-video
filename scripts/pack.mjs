import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const RELEASE_DIR = path.join(ROOT_DIR, 'build-release');
const BUNDLE_NAME = 'sideline-plugin-v1.tar.gz';

/**
 * Erzeugt ein USTAR-konformes .tar.gz-Archiv ohne externe Abhängigkeiten,
 * exakt kompatibel zu `entpackeTarGzSicher` in SidelineOS-Core.
 */
export function erzeugeTarGzBuffer(dateien) {
  const bloecke = [];

  for (const [pfad, inhaltRoh] of Object.entries(dateien)) {
    const content = typeof inhaltRoh === 'string' ? Buffer.from(inhaltRoh, 'utf8') : inhaltRoh;
    const header = Buffer.alloc(512, 0);

    const nameBytes = Buffer.from(pfad, 'utf8');
    if (nameBytes.length > 100) {
      throw new Error(`TAR-Pfad überschreitet 100 Bytes: ${pfad}`);
    }
    nameBytes.copy(header, 0);

    Buffer.from('0000644\0', 'ascii').copy(header, 100);
    Buffer.from('0000000\0', 'ascii').copy(header, 108);
    Buffer.from('0000000\0', 'ascii').copy(header, 116);
    Buffer.from(content.length.toString(8).padStart(11, '0') + '\0', 'ascii').copy(header, 124);
    Buffer.from('00000000000\0', 'ascii').copy(header, 136);
    Buffer.from('        ', 'ascii').copy(header, 148);
    header[156] = '0'.charCodeAt(0);
    Buffer.from('ustar\0', 'ascii').copy(header, 257);
    Buffer.from('00', 'ascii').copy(header, 263);

    let checksum = 0;
    for (let i = 0; i < 512; i += 1) {
      checksum += header[i];
    }
    Buffer.from(checksum.toString(8).padStart(6, '0') + '\0 ', 'ascii').copy(header, 148);

    bloecke.push(header);
    if (content.length > 0) {
      bloecke.push(content);
      const rest = content.length % 512;
      if (rest !== 0) {
        bloecke.push(Buffer.alloc(512 - rest, 0));
      }
    }
  }

  bloecke.push(Buffer.alloc(1024, 0));
  return zlib.gzipSync(Buffer.concat(bloecke));
}

async function sammleDateien(dir, relPrefix, ziel) {
  const eintraege = await fs.readdir(dir, { withFileTypes: true });
  eintraege.sort((a, b) => a.name.localeCompare(b.name));
  for (const eintrag of eintraege) {
    const vollPfad = path.join(dir, eintrag.name);
    const relPfad = `${relPrefix}/${eintrag.name}`;
    if (eintrag.isDirectory()) {
      await sammleDateien(vollPfad, relPfad, ziel);
    } else if (eintrag.isFile()) {
      ziel[relPfad] = await fs.readFile(vollPfad);
    }
  }
}

async function packPlugin() {
  const manifestPath = path.join(ROOT_DIR, 'plugin.manifest.json');
  const distDir = path.join(ROOT_DIR, 'dist');
  const clientJsPath = path.join(distDir, 'client.js');
  const serverJsPath = path.join(distDir, 'server.js');

  await fs.access(manifestPath);
  await fs.access(clientJsPath);
  await fs.access(serverJsPath);

  const dateien = {
    'plugin.manifest.json': await fs.readFile(manifestPath),
  };

  await sammleDateien(distDir, 'dist', dateien);

  const migrationsDir = path.join(ROOT_DIR, 'migrations');
  try {
    const stat = await fs.stat(migrationsDir);
    if (stat.isDirectory()) {
      await sammleDateien(migrationsDir, 'migrations', dateien);
    }
  } catch {
    // Optional
  }

  const tarGzBuffer = erzeugeTarGzBuffer(dateien);
  const sha256 = crypto.createHash('sha256').update(tarGzBuffer).digest('hex');

  await fs.rm(RELEASE_DIR, { recursive: true, force: true });
  await fs.mkdir(RELEASE_DIR, { recursive: true });
  await fs.writeFile(path.join(RELEASE_DIR, BUNDLE_NAME), tarGzBuffer);
  await fs.writeFile(
    path.join(RELEASE_DIR, `${BUNDLE_NAME}.sha256`),
    `${sha256}  ${BUNDLE_NAME}\n`,
    'utf8'
  );
  await fs.copyFile(manifestPath, path.join(RELEASE_DIR, 'plugin.manifest.json'));

  console.log(`Release-Paket erstellt: build-release/${BUNDLE_NAME} (sha256: ${sha256})`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  packPlugin().catch((err) => {
    console.error('Plugin-Packaging fehlgeschlagen:', err);
    process.exitCode = 1;
  });
}
