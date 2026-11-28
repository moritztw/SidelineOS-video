import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { build as esbuild } from 'esbuild';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

async function ladeTsModul(relPfad) {
  const res = await esbuild({
    entryPoints: [path.join(ROOT_DIR, relPfad)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: ['node22'],
    external: ['@sidelineos/plugin-sdk'],
  });
  const code = res.outputFiles[0].text;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
  return import(dataUrl);
}

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

const GUELTIGE_V2_PERMISSIONS = new Set([
  'db:plugin-schema',
  'storage:team-rw',
  'storage:club-rw',
  'share:public-links',
  'notifications:send',
  'notifications:channel',
  'ui:account-panel',
  'ui:club-panel',
  'ui:system-panel',
  'club:read',
  'team:read',
]);

const GUELTIGE_ICONS = new Set([
  'film',
  'book-open',
  'clipboard-check',
  'layers',
  'puzzle',
]);

test('plugin.json erfüllt alle Validierungsregeln von SidelineOS-Core SDK v2.0', async () => {
  const raw = await fs.readFile(path.join(ROOT_DIR, 'plugin.json'), 'utf8');
  const manifest = JSON.parse(raw);

  assert.equal(manifest.id, 'video-analysis');
  assert.match(manifest.id, /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/);
  assert.equal(RESERVIERTE_PLUGIN_IDS.has(manifest.id), false);
  assert.ok(manifest.name.trim().length > 0);
  assert.match(manifest.version, /^2\.\d+\.\d+/);
  assert.equal(manifest.sdkVersion, '2.0');
  assert.match(manifest.minCoreVersion, /^\d+\.\d+\.\d+/);
  assert.equal(manifest.storagePrefix, 'video');
  assert.ok(GUELTIGE_ICONS.has(manifest.icon));
  assert.ok(Array.isArray(manifest.permissions));
  for (const perm of manifest.permissions) {
    assert.ok(GUELTIGE_V2_PERMISSIONS.has(perm), `Unbekannte SDK-v2-Permission: ${perm}`);
  }
  assert.equal(manifest.navigation.surface, 'app');
  assert.deepEqual(manifest.navigation.scopes, ['team', 'club']);
  assert.ok(Array.isArray(manifest.navigation.sidebarGroups) && manifest.navigation.sidebarGroups.length >= 3);
  assert.ok(Array.isArray(manifest.navigation.settingsPanels) && manifest.navigation.settingsPanels.length === 3);
  assert.match(manifest.repositoryUrl, /^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/);
});

test('dist/client.js, dist/client.css und dist/server.js erfüllen die SDK-v2.0-Verträge', async () => {
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

  // SDK v2.0 Typ-Verträge in src/sdk.d.ts
  assert.match(sdkDts, /export interface PluginManifest/);
  assert.match(sdkDts, /export interface PluginStorageScope/);
  assert.match(sdkDts, /export interface ClubSpeicherStatus/);
  assert.match(sdkDts, /export interface PluginLaufzeitKontext/);
  assert.match(sdkDts, /export interface SidelinePlugin/);
  assert.match(sdkDts, /export interface SidelineBackendPlugin/);

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
  assert.equal(backend.manifest.sdkVersion, '2.0');
  assert.equal(typeof backend.handleRequest, 'function');
  assert.equal(typeof backend.handlePublicRequest, 'function');
  assert.ok(Array.isArray(backend.migrations) && backend.migrations.length >= 3);
});

test('Release-Packaging erzeugt valides USTAR .tar.gz mit plugin.json, dist/ und allen 3 migrations/', async () => {
  const { erzeugeTarGzBuffer } = await import(path.join(ROOT_DIR, 'scripts/pack.mjs'));

  const manifestBuf = await fs.readFile(path.join(ROOT_DIR, 'plugin.json'));
  const clientBuf = await fs.readFile(path.join(ROOT_DIR, 'dist/client.js'));
  const cssBuf = await fs.readFile(path.join(ROOT_DIR, 'dist/client.css'));
  const serverBuf = await fs.readFile(path.join(ROOT_DIR, 'dist/server.js'));
  const mig1Buf = await fs.readFile(path.join(ROOT_DIR, 'migrations/001_video_schema.sql'));
  const mig2Buf = await fs.readFile(
    path.join(ROOT_DIR, 'migrations/002_video_annotations_and_sharing.sql')
  );
  const mig3Buf = await fs.readFile(
    path.join(ROOT_DIR, 'migrations/003_sdk_v2_club_sharing_and_seasons.sql')
  );

  const gz = erzeugeTarGzBuffer({
    'plugin.json': manifestBuf,
    'dist/client.css': cssBuf,
    'dist/client.js': clientBuf,
    'dist/server.js': serverBuf,
    'migrations/001_video_schema.sql': mig1Buf,
    'migrations/002_video_annotations_and_sharing.sql': mig2Buf,
    'migrations/003_sdk_v2_club_sharing_and_seasons.sql': mig3Buf,
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
    'plugin.json',
    'dist/client.css',
    'dist/client.js',
    'dist/server.js',
    'migrations/001_video_schema.sql',
    'migrations/002_video_annotations_and_sharing.sql',
    'migrations/003_sdk_v2_club_sharing_and_seasons.sql',
  ]);
});

test('Hotkeys (#3): Scoped Konfliktprüfung, Modifier-Kombinationen & Clip-Start-Logik', async () => {
  const mod = await ladeTsModul('src/services/frameAndHotkeys.ts');

  assert.equal(mod.normalisiereTaste('ctrl+shift+arrowleft'), 'Ctrl+Shift+ArrowLeft');
  assert.equal(mod.formatiereHotkeyAnzeige('Ctrl+Shift+KeyB'), 'Strg + Shift + B');
  assert.equal(
    mod.matchesHotkeyEvent({ code: 'KeyB', ctrlKey: true, shiftKey: true }, 'Ctrl+Shift+KeyB'),
    true
  );
  assert.equal(
    mod.matchesHotkeyEvent({ code: 'KeyB', ctrlKey: false, shiftKey: false }, 'Ctrl+Shift+KeyB'),
    false
  );
  assert.equal(mod.kombinationAusKeyboardEvent({ code: 'ShiftLeft', shiftKey: true }), null);

  assert.equal(mod.habenHotkeyKonfliktScope('toggleDraw', 'markCut'), false);
  assert.equal(mod.habenHotkeyKonfliktScope('playPause', 'markCut'), true);
  assert.equal(mod.habenHotkeyKonfliktScope('toggleDraw', 'toggleBreakdownOverlay'), true);

  const okShared = mod.aktualisiereBenutzerHotkey(mod.STANDARD_HOTKEYS, 'markCut', 'KeyD');
  assert.equal(okShared.ok, true);
  assert.equal(okShared.belegung.markCut, 'KeyD');

  const konfliktGlobal = mod.aktualisiereBenutzerHotkey(mod.STANDARD_HOTKEYS, 'markCut', 'Space');
  assert.equal(konfliktGlobal.ok, false);
  assert.equal(konfliktGlobal.konfliktAktion, 'playPause');

  assert.deepEqual(mod.berechnePrevPlayOderClipStart(400, 2), { aktion: 'clipStart', zielMs: 0 });
  assert.deepEqual(mod.berechnePrevPlayOderClipStart(0, 2), { aktion: 'prevPlay', zielIndex: 1 });
  assert.deepEqual(mod.berechnePrevPlayOderClipStart(0, 0), { aktion: 'clipStart', zielMs: 0 });
});

test('SDK v2.0 Anmerkungs-Sichtbarkeit (STAFF/MEMBER + dynamische userGroups) & Marker-Aggregation', async () => {
  const mod = await ladeTsModul('src/services/annotationVisibility.ts');

  // Legacy-Normalisierung
  assert.equal(mod.normalisiereSichtbarkeit('COACHES_ONLY'), 'STAFF_ONLY');
  assert.equal(mod.normalisiereSichtbarkeit('ALL_PLAYERS'), 'ALL_MEMBERS');
  assert.equal(mod.normalisiereSichtbarkeit('UNIT_OFFENSE'), 'GROUP:Offense');

  // Rollen & dynamische Gruppen
  assert.equal(mod.istAnmerkungFuerBenutzerSichtbar('STAFF_ONLY', 'STAFF', [], true), true);
  assert.equal(mod.istAnmerkungFuerBenutzerSichtbar('STAFF_ONLY', 'TEAM_ADMIN', [], true), true);
  assert.equal(mod.istAnmerkungFuerBenutzerSichtbar('STAFF_ONLY', 'MEMBER', ['Offense'], true), false);
  assert.equal(mod.istAnmerkungFuerBenutzerSichtbar('GROUP:Offense', 'MEMBER', ['Offense'], true), true);
  assert.equal(mod.istAnmerkungFuerBenutzerSichtbar('GROUP:Angriff', 'MEMBER', ['Angriff'], true), true);
  assert.equal(mod.istAnmerkungFuerBenutzerSichtbar('GROUP:Defense', 'MEMBER', ['Offense'], true), false);
  assert.equal(mod.istAnmerkungFuerBenutzerSichtbar('ALL_MEMBERS', 'MEMBER', [], true), true);
  // Deaktiviertes Gruppen-Sharing: Mitglieder sehen alle Nicht-Staff-Anmerkungen
  assert.equal(mod.istAnmerkungFuerBenutzerSichtbar('GROUP:Defense', 'MEMBER', ['Offense'], false), true);
  assert.equal(mod.istAnmerkungFuerBenutzerSichtbar('STAFF_ONLY', 'MEMBER', ['Offense'], false), false);

  const elements = [
    { id: '1', type: 'arrow', color: '#EF4444', strokeWidth: 0.0028, visibility: 'STAFF_ONLY', authorName: 'HC', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
    { id: '2', type: 'block_line', color: '#38BDF8', strokeWidth: 0.0028, visibility: 'GROUP:Offense', authorName: 'OC', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
    { id: '3', type: 'dashed_line', color: '#22C55E', strokeWidth: 0.0028, visibility: 'GROUP:Defense', authorName: 'DC', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
  ];
  const fuerOffense = mod.filtereTelestrationElementeFuerBenutzer(elements, 'MEMBER', ['Offense'], true);
  assert.deepEqual(fuerOffense.map((e) => e.id), ['2']);

  const marker = mod.sammleFrameAnmerkungsMarker(
    [
      {
        id: 't1',
        reelId: 'r1',
        playId: 'p1',
        angleCode: 'SIDELINE',
        frameIndex: 25,
        elements: [elements[1]],
        authorName: 'OC',
        updatedAt: '2026-11-26T00:00:00Z',
      },
    ],
    [
      {
        id: 'n1',
        reelId: 'r1',
        playId: 'p1',
        angleCode: 'SIDELINE',
        frameIndex: 50,
        text: 'Achtung Blitz',
        status: 'PUBLISHED',
        cornerPosition: 'top-right',
        visibility: 'GROUP:Offense',
        color: '#38BDF8',
        authorUuid: 'u1',
        authorName: 'HC',
        createdAt: '2026-11-26T00:00:00Z',
        updatedAt: '2026-11-26T00:00:00Z',
      },
    ],
    'p1',
    'SIDELINE'
  );
  assert.equal(marker.length, 2);
  assert.deepEqual(marker[0].authors, ['OC']);
  assert.equal(marker[0].hasDrawing, true);
  assert.equal(marker[1].hasNote, true);
});

test('Hudl CSV-Importer (#9): RFC-4180 Parsing, Spalten-Mapping, Custom Fields & Merge/Overwrite', async () => {
  const csvMod = await ladeTsModul('src/services/hudlCsvImporter.ts');
  const tagMod = await ladeTsModul('src/services/taggingEngine.ts');

  const csvText = '\uFEFFPLAY #;ODK;DN;DIST;YARD LN;GN/LS;OFF FORM;RESULT;CUSTOM BLITZ\r\n'
    + '1;O;1;10;-25;8;"Trips Right, Gun";Complete;Cover 3\r\n'
    + '2;D;2;2;-33;-4;I-Form;Incomplete;Zero Blitz\r\n';

  const tabelle = csvMod.parseCsvTabelle(csvText);
  assert.equal(tabelle.delimiter, ';');
  assert.equal(tabelle.headers[0], 'PLAY #');
  assert.equal(tabelle.rows.length, 2);
  assert.equal(tabelle.rows[0][6], 'Trips Right, Gun');

  const schema = tagMod.erstelleStandardTeamSchema('team-1');
  const zielPlays = [
    { id: 'p1', playNumber: 1, breakdown: { off_form: 'Existing Form', down: 1 } },
    { id: 'p2', playNumber: 2, breakdown: {} },
  ];

  const vorschau = csvMod.erstelleHudlCsvVorschau(csvText, schema, zielPlays);
  const playNrSpalte = vorschau.columns.find((s) => s.csvHeader === 'PLAY #');
  const formSpalte = vorschau.columns.find((s) => s.csvHeader === 'OFF FORM');
  const customSpalte = vorschau.columns.find((s) => s.csvHeader === 'CUSTOM BLITZ');

  assert.equal(playNrSpalte.action, 'map_existing');
  assert.equal(playNrSpalte.targetFieldKey, 'play_number');
  assert.equal(formSpalte.action, 'map_existing');
  assert.equal(formSpalte.targetFieldKey, 'off_form');
  assert.equal(customSpalte.action, 'create_custom');

  // merge_empty erhält vorhandenes off_form bei Play 1, ergänzt aber neue Felder
  const mergeErg = csvMod.wendeHudlCsvMappingAn(vorschau, schema, zielPlays, 'merge_empty');
  assert.equal(mergeErg.matchedCount, 2);
  assert.equal(mergeErg.newCustomFields.length, 1);
  assert.equal(mergeErg.newCustomFields[0].key, 'hudl_custom_blitz');
  assert.equal(mergeErg.playPatches[0].breakdown.off_form, 'Existing Form');
  assert.equal(mergeErg.playPatches[0].breakdown.gn_ls, 8);
  assert.equal(mergeErg.playPatches[0].breakdown.hudl_custom_blitz, 'Cover 3');

  // overwrite überschreibt auch vorhandenes off_form
  const overwriteErg = csvMod.wendeHudlCsvMappingAn(vorschau, schema, zielPlays, 'overwrite');
  assert.equal(overwriteErg.playPatches[0].breakdown.off_form, 'Trips Right, Gun');
  assert.equal(overwriteErg.playPatches[1].breakdown.gn_ls, -4);
});

test('ZIP-Archiv-Generator (#8) erzeugt valides PKZIP-Archiv ohne externe Abhängigkeiten', async () => {
  const { erzeugeZipBytes } = await ladeTsModul('src/services/zipBuilder.ts');
  const bytes = erzeugeZipBytes([
    { name: 'metadata/reel.json', data: '{"ok":true}' },
    { name: 'clips/play-001.mp4', data: new Uint8Array([0, 1, 2, 3, 4, 5]) },
  ]);

  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.equal(bytes[2], 0x03);
  assert.equal(bytes[3], 0x04);

  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.includes('metadata/reel.json'));
  assert.ok(text.includes('clips/play-001.mp4'));
  assert.ok(text.includes('PK\x01\x02'));
  assert.ok(text.includes('PK\x05\x06'));
});

test('handlePublicRequest (#8) unterstützt includeMetadata & publicCtx S3-Signing', async () => {
  const serverMod = await import(path.join(ROOT_DIR, 'dist/server.js'));
  const backend = serverMod.backendPlugin ?? serverMod.default;

  const mockDb = {
    async query(sql) {
      if (sql.includes('FROM mod_video_share_links')) {
        return {
          rows: [
            {
              id: 'shl-1',
              team_id: 'team-1',
              access_id: 'acc-1',
              reel_id: 'reel-1',
              allowed_fields_json: null,
              include_metadata: false,
              expires_at: new Date(Date.now() + 86400_000).toISOString(),
              revoked_at: null,
            },
          ],
        };
      }
      if (sql.includes('FROM mod_video_team_reel_access')) {
        return {
          rows: [
            {
              reel_id: 'reel-1',
              title: 'Game vs Berlin',
              category: 'GAME',
              event_date: '2026-11-14',
              season: '2026',
            },
          ],
        };
      }
      if (sql.includes('FROM mod_video_plays')) {
        return {
          rows: [
            {
              id: 'play-1',
              play_number: 1,
              sort_order: 1,
              breakdown_json: JSON.stringify({ odk: 'O', down: 1, off_form: 'Trips' }),
            },
          ],
        };
      }
      if (sql.includes('FROM mod_video_play_angles')) {
        return {
          rows: [
            {
              id: 'ang-1',
              play_id: 'play-1',
              angle_code: 'SIDELINE',
              source_mode: 'CLIP_FILE',
              s3_key: 'clubs/c1/teams/team-1/video/clip1.mp4',
              file_name: 'clip1.mp4',
              file_size_bytes: 12345,
              start_ms: 0,
              end_ms: 10000,
              offset_ms: null,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  const resOhneCtx = await backend.handlePublicRequest(
    { method: 'GET', path: '/share/test-token', query: {}, body: undefined, headers: {} },
    mockDb
  );
  assert.equal(resOhneCtx.status, 200);
  assert.equal(resOhneCtx.body.includeMetadata, false);
  assert.equal(resOhneCtx.body.s3DownloadVerfuegbar, false);
  assert.deepEqual(resOhneCtx.body.plays[0].breakdown, {});

  const resMitCtx = await backend.handlePublicRequest(
    { method: 'GET', path: '/share/test-token', query: {}, body: undefined, headers: {} },
    mockDb,
    {
      async getSignedDownloadUrlForTeam({ objectPath }) {
        return { url: `https://signed.example/${encodeURIComponent(objectPath)}` };
      },
    }
  );
  assert.equal(resMitCtx.status, 200);
  assert.equal(resMitCtx.body.s3DownloadVerfuegbar, true);
  assert.match(
    resMitCtx.body.plays[0].sources.SIDELINE.streamUrl,
    /^https:\/\/signed\.example\//
  );
});

test('Release-Workflow nutzt SDK-v2.0-Artefakte und --legacy-peer-deps', async () => {
  const workflow = await fs.readFile(
    path.join(ROOT_DIR, '.github/workflows/release.yml'),
    'utf8'
  );
  assert.match(workflow, /npm ci --include=dev --legacy-peer-deps/);
  assert.match(workflow, /npm install --include=dev --legacy-peer-deps/);
  assert.match(workflow, /build-release\/video-analysis\.tar\.gz/);
  assert.match(workflow, /build-release\/plugin\.json/);
});
