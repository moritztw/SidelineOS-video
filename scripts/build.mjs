import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

/** Verbindliche ImportMap-Externals aus SidelineOS-Core (index.html / pluginRuntime.ts). */
const CORE_IMPORTMAP_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'lucide-react',
  '@sidelineos/plugin-sdk',
];

async function baueClientCss() {
  const stylesPfad = path.join(ROOT_DIR, 'src/styles.css');
  const cssQuelle = await fs.readFile(stylesPfad, 'utf8');
  const scanner = new Scanner({
    sources: [
      { base: path.join(ROOT_DIR, 'src'), pattern: '**/*.{ts,tsx}', negated: false },
    ],
  });
  const kandidaten = scanner.scan();
  const compiler = await compile(cssQuelle, {
    base: ROOT_DIR,
    onDependency() {},
  });
  let ausgabe = compiler.build(kandidaten);
  ausgabe = ausgabe
    .replaceAll(':root, :host {', '.sideline-video-root {')
    .replaceAll(
      '*, ::before, ::after, ::backdrop {',
      '.sideline-video-root *, .sideline-video-root ::before, .sideline-video-root ::after, .sideline-video-root ::backdrop {'
    );
  await fs.writeFile(path.join(DIST_DIR, 'client.css'), ausgabe, 'utf8');
  return Buffer.byteLength(ausgabe, 'utf8');
}

async function runBuild() {
  await fs.rm(DIST_DIR, { recursive: true, force: true });
  await fs.mkdir(DIST_DIR, { recursive: true });

  await build({
    entryPoints: [path.join(ROOT_DIR, 'src/client.tsx')],
    outfile: path.join(DIST_DIR, 'client.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    jsx: 'automatic',
    sourcemap: false,
    minify: false,
    external: CORE_IMPORTMAP_EXTERNALS,
  });

  await build({
    entryPoints: [path.join(ROOT_DIR, 'src/server.ts')],
    outfile: path.join(DIST_DIR, 'server.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node22'],
    sourcemap: false,
    minify: false,
    external: ['@sidelineos/plugin-sdk'],
    loader: {
      '.sql': 'text',
    },
  });

  const cssBytes = await baueClientCss();
  const clientStat = await fs.stat(path.join(DIST_DIR, 'client.js'));
  const serverStat = await fs.stat(path.join(DIST_DIR, 'server.js'));

  console.log(
    `Build abgeschlossen: dist/client.js (${clientStat.size} Bytes), dist/client.css (${cssBytes} Bytes), dist/server.js (${serverStat.size} Bytes)`
  );
}

runBuild().catch((err) => {
  console.error('Plugin-Build fehlgeschlagen:', err);
  process.exitCode = 1;
});
