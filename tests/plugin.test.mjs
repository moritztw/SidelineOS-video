import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

const RESERVIERTE_PLUGIN_IDS = new Set([
  'hub',
  'settings',
  'settings-hub',
  'team-settings',
  'sysadmin',
  'invite',
  'share',
  'auth',
  'login',
  'api',
  'plugins',
]);

const GUELTIGE_PERMISSIONS = new Set([
  'team:read',
  'team:roster-read',
  's3:team-rw',
  's3:cleanup-queue',
  'db:plugin-tables',
  'share:public-links',
  'notifications:send',
  'notifications:channel',
]);

const GUELTIGE_ICONS = new Set([
  'film',
  'book-open',
  'clipboard-check',
  'layers',
  'puzzle',
]);

test('plugin.manifest.json erfüllt alle Validierungsregeln von SidelineOS-Core (dev)', async () => {
  const raw = await fs.readFile(path.join(ROOT_DIR, 'plugin.manifest.json'), 'utf8');
  const manifest = JSON.parse(raw);

  assert.equal(manifest.id, 'video-analysis');
  assert.match(manifest.id, /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/);
  assert.equal(RESERVIERTE_PLUGIN_IDS.has(manifest.id), false);
  assert.ok(manifest.name.trim().length > 0);
  assert.match(manifest.version, /^\d+\.\d+\.\d+/);
  assert.equal(manifest.sdkVersion, '1.0');
  assert.match(manifest.minCoreVersion, /^\d+\.\d+\.\d+/);
  assert.equal(manifest.dbPrefix, 'mod_video_');
  assert.match(manifest.dbPrefix, /^mod_[a-z0-9_]+_$/);
  assert.equal(manifest.s3Prefix, 'plugins/video-analysis/');
  assert.ok(GUELTIGE_ICONS.has(manifest.icon));
  assert.ok(manifest.status === 'AKTIV' || manifest.status === 'VORSCHAU');
  assert.equal(typeof manifest.standardAktiviert, 'boolean');
  assert.ok(Array.isArray(manifest.permissions));
  for (const perm of manifest.permissions) {
    assert.ok(GUELTIGE_PERMISSIONS.has(perm), `Unbekannte Permission: ${perm}`);
  }
  assert.equal(typeof manifest.settingsAnker, 'object');
  assert.match(manifest.repositoryUrl, /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/);
});

test('dist/client.js, dist/client.css und dist/server.js erfüllen die Core-Verträge', async () => {
  const clientCode = await fs.readFile(path.join(ROOT_DIR, 'dist/client.js'), 'utf8');
  const clientCss = await fs.readFile(path.join(ROOT_DIR, 'dist/client.css'), 'utf8');
  const sdkDts = await fs.readFile(path.join(ROOT_DIR, 'src/sdk.d.ts'), 'utf8');
  const serverMod = await import(path.join(ROOT_DIR, 'dist/server.js'));

  assert.match(clientCode, /from\s+["']@sidelineos\/plugin-sdk["']/);
  assert.match(clientCode, /from\s+["']react\/jsx-runtime["']/);
  assert.doesNotMatch(clientCode, /dangerouslySetInnerHTML/);
  assert.match(clientCode, /export\s*\{[\s\S]*default[\s\S]*\}/);
  assert.match(clientCode, /bg-sl-surface/);
  assert.match(clientCode, /text-sl-heading/);
  assert.match(clientCode, /bg-sl-accent/);
  assert.match(clientCode, /text-sl-accent-contrast/);

  // Core Issue #13: SDK-Typen (Themes, Headless-Provider, sl-*-Tokens) vorhanden
  assert.match(sdkDts, /hideHubTile\?: boolean/);
  assert.match(sdkDts, /themes\?: PluginThemePreset\[\]/);
  assert.match(sdkDts, /preferredTheme\?: string/);
  assert.match(sdkDts, /export interface PluginProviderKontext/);
  assert.match(sdkDts, /export interface PluginProviderProps/);
  assert.match(sdkDts, /export const SIDELINE_CSS_TOKENS/);

  assert.ok(clientCss.length > 100);
  assert.match(clientCss, /\.sideline-video-root\s*\{[\s\S]*?\.grid-cols-1\s*\{/);
  assert.match(clientCss, /var\(--sl-bg-surface\)/);
  assert.match(clientCss, /var\(--sl-text-primary\)/);
  assert.match(clientCss, /var\(--sl-accent\)/);
  assert.doesNotMatch(clientCss, /:root\b/);
  assert.doesNotMatch(clientCss, /@layer\s+utilities/);
  assert.doesNotMatch(clientCss, /^\.(grid-cols-1|hidden|block|sticky|flex|grid)\s*\{/m);

  const backend = serverMod.backendPlugin ?? serverMod.default;
  assert.equal(backend.manifest.id, 'video-analysis');
  assert.equal(typeof backend.handleRequest, 'function');
  assert.equal(typeof backend.handlePublicRequest, 'function');
  assert.equal(typeof backend.listExportableItems, 'function');
  assert.equal(typeof backend.exportScope, 'function');
  assert.equal(typeof backend.importScope, 'function');
  assert.ok(Array.isArray(backend.migrations) && backend.migrations.length >= 1);
});

test('Release-Packaging erzeugt valides USTAR .tar.gz inkl. dist/ und migrations/', async () => {
  const { erzeugeTarGzBuffer } = await import(path.join(ROOT_DIR, 'scripts/pack.mjs'));

  const manifestBuf = await fs.readFile(path.join(ROOT_DIR, 'plugin.manifest.json'));
  const clientBuf = await fs.readFile(path.join(ROOT_DIR, 'dist/client.js'));
  const cssBuf = await fs.readFile(path.join(ROOT_DIR, 'dist/client.css'));
  const serverBuf = await fs.readFile(path.join(ROOT_DIR, 'dist/server.js'));
  const migBuf = await fs.readFile(path.join(ROOT_DIR, 'migrations/001_video_schema.sql'));

  const gz = erzeugeTarGzBuffer({
    'plugin.manifest.json': manifestBuf,
    'dist/client.css': cssBuf,
    'dist/client.js': clientBuf,
    'dist/server.js': serverBuf,
    'migrations/001_video_schema.sql': migBuf,
  });

  const sha = crypto.createHash('sha256').update(gz).digest('hex');
  assert.match(sha, /^[a-f0-9]{64}$/);

  const tar = zlib.gunzipSync(gz);
  const eintraege = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((b) => b === 0)) break;

    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const size = Number.parseInt(
      header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim(),
      8
    );
    const typeflag = String.fromCharCode(header[156]);
    assert.equal(typeflag, '0');
    assert.equal(name.includes('..'), false);
    assert.equal(name.startsWith('/'), false);
    eintraege.push(name);
    offset += Math.ceil(size / 512) * 512;
  }

  assert.deepEqual(eintraege, [
    'plugin.manifest.json',
    'dist/client.css',
    'dist/client.js',
    'dist/server.js',
    'migrations/001_video_schema.sql',
  ]);
});

test('Release-Workflow installiert mit --legacy-peer-deps (verhindert E404 auf unveröffentlichtes @sidelineos/plugin-sdk)', async () => {
  const workflow = await fs.readFile(
    path.join(ROOT_DIR, '.github/workflows/release.yml'),
    'utf8'
  );
  assert.match(workflow, /npm ci --include=dev --legacy-peer-deps/);
  assert.match(workflow, /npm install --include=dev --legacy-peer-deps/);
});
