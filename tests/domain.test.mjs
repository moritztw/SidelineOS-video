import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

async function ladeTsModul(relPfad) {
  const res = await build({
    entryPoints: [path.join(ROOT_DIR, relPfad)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: ['node22'],
    external: ['@sidelineos/plugin-sdk'],
  });
  const code = res.outputFiles[0].text;
  const b64 = Buffer.from(code, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${b64}`);
}

test('25-fps Frame-Quantisierung und exakter Auto-Stop ohne Vorab-Aufblitzen', async () => {
  const frameMod = await ladeTsModul('src/services/frameAndHotkeys.ts');

  assert.equal(frameMod.FRAME_MS, 40);
  assert.equal(frameMod.msZuFrameIndex(2000), 50);
  assert.equal(frameMod.frameIndexZuMs(50), 2000);
  assert.equal(frameMod.formatiereFrameTimecode(2080), '00:02.02');

  assert.equal(frameMod.hatExaktenFrameTreffer(1920, 50), false);
  assert.equal(frameMod.findeNaechstenAutoStopFrame(1920, [50]), null);
  assert.equal(frameMod.hatExaktenFrameTreffer(2000, 50), true);
  assert.equal(frameMod.findeNaechstenAutoStopFrame(2000, [50]), 50);
  assert.equal(frameMod.findeUeberfahrenenAutoStopFrame(1960, 2010, [50]), 50);
  assert.equal(frameMod.findeUeberfahrenenAutoStopFrame(1880, 1920, [50]), null);
});

test('Hotkey-Konfliktprüfung lehnt doppelte Tastenbelegung ab', async () => {
  const frameMod = await ladeTsModul('src/services/frameAndHotkeys.ts');
  const konflikt = frameMod.aktualisiereBenutzerHotkey(
    frameMod.STANDARD_HOTKEYS,
    'addNote',
    'Space'
  );
  assert.equal(konflikt.ok, false);
  assert.equal(konflikt.konfliktAktion, 'playPause');

  const erfolg = frameMod.aktualisiereBenutzerHotkey(
    frameMod.STANDARD_HOTKEYS,
    'addNote',
    'KeyM'
  );
  assert.equal(erfolg.ok, true);
  assert.equal(erfolg.belegung.addNote, 'KeyM');

  const migriert = frameMod.bereinigeHotkeyBelegung({
    markIn: 'KeyC',
    markOut: 'KeyO',
  });
  assert.equal(migriert.markCut, 'KeyC');
  assert.equal('markOut' in migriert, false);

  const rest = frameMod.berechneRestclipZeit(5000, 12000, 60000);
  assert.equal(rest.startMs, 12000);
  assert.equal(rest.geclamptAbsMs, 12000);
  assert.equal(rest.relativMs, 0);
  assert.equal(rest.dauerMs, 48000);
});

test('Tagging-Engine: Bidirektionale Gain/Loss-Berechnung inkl. FLAG-Ausnahme & Admin-Wörterbuchschutz', async () => {
  const tagMod = await ladeTsModul('src/services/taggingEngine.ts');

  assert.equal(tagMod.berechneGainLoss(-25, -34, 'COMPLETE'), 9);
  assert.equal(tagMod.berechneGainLoss(-45, 45, 'COMPLETE'), 10);
  assert.equal(tagMod.berechneGainLoss(-25, -40, 'FLAG'), undefined);
  assert.equal(tagMod.berechneNeueFeldposition(-25, 15, 'FLAG'), undefined);

  const schema = tagMod.erstelleStandardTeamSchema('team-1');
  const gelernt = tagMod.ergaenzeTeamWoerterbuch(schema, 'off_form', 'Bunch Quads');
  assert.ok(gelernt.dictionary.off_form.includes('Bunch Quads'));

  const staffVersuch = tagMod.entferneWoerterbuchEintrag(
    gelernt,
    'off_form',
    'Bunch Quads',
    'STAFF'
  );
  assert.equal(staffVersuch.ok, false);

  const adminVersuch = tagMod.entferneWoerterbuchEintrag(
    gelernt,
    'off_form',
    'Bunch Quads',
    'TEAM_ADMIN'
  );
  assert.equal(adminVersuch.ok, true);
  assert.equal(adminVersuch.schema.dictionary.off_form.includes('Bunch Quads'), false);
});

test('sideline-bundle.json v1.0 Validierung & gefilterter CSV-Export', async () => {
  const bundleMod = await ladeTsModul('src/services/bundleSchema.ts');

  const gueltig = bundleMod.validiereSidelineBundle({
    schema_version: '1.0',
    reel: {
      title: 'vs. Berlin Rebels',
      category: 'GAME',
      event_date: '2026-11-14',
      visibility: 'GROUP:Offense',
    },
    angles: ['SIDELINE', 'ENDZONE'],
    plays: [
      {
        play_number: 1,
        sources: {
          SIDELINE: { file: 'sl_001.mp4', source_mode: 'CLIP_FILE', start_ms: 0, end_ms: 8400 },
          ENDZONE: { file: 'ez_001.mp4', start_ms: 0, end_ms: 8100 },
        },
        breakdown: { odk: 'O', down: 3, gn_ls: 7 },
      },
    ],
  });
  assert.equal(gueltig.ok, true);

  const ungueltig = bundleMod.validiereSidelineBundle({ schema_version: '2.0' });
  assert.equal(ungueltig.ok, false);

  const csv = bundleMod.konvertierePlaysZuCsv(
    [
      {
        id: 'p1',
        reelId: 'r1',
        playNumber: 1,
        sortOrder: 1,
        breakdown: { odk: 'O', down: 3, off_play: 'Geheim' },
        sources: {},
      },
    ],
    ['odk', 'down']
  );
  assert.equal(csv.includes('Geheim'), false);
  assert.match(csv, /^play_number,odk,down\n1,O,3$/);
});

test('Smart-Playlist Filterregeln (UND/ODER) & Sync-Lückenanalyse', async () => {
  const plMod = await ladeTsModul('src/services/smartPlaylistEngine.ts');
  const plays = [
    {
      id: 'p1',
      reelId: 'r1',
      playNumber: 1,
      sortOrder: 1,
      breakdown: { down: 3, distance: 8, result: 'COMPLETE' },
      sources: {
        SIDELINE: { id: 's1', angleCode: 'SIDELINE', sourceMode: 'CLIP_FILE', s3Key: 'a', fileName: 'a.mp4', fileSizeBytes: 1, startMs: 0, endMs: 5000, offsetMs: null },
      },
    },
    {
      id: 'p2',
      reelId: 'r1',
      playNumber: 2,
      sortOrder: 2,
      breakdown: { down: 1, distance: 10, result: 'INCOMPLETE' },
      sources: {
        SIDELINE: { id: 's2', angleCode: 'SIDELINE', sourceMode: 'CLIP_FILE', s3Key: 'b', fileName: 'b.mp4', fileSizeBytes: 1, startMs: 0, endMs: 5000, offsetMs: null },
        ENDZONE: { id: 'e2', angleCode: 'ENDZONE', sourceMode: 'CLIP_FILE', s3Key: 'c', fileName: 'c.mp4', fileSizeBytes: 1, startMs: 0, endMs: 5000, offsetMs: 250 },
      },
    },
  ];

  const treffer = plMod.filterePlaysNachRegeln(
    plays,
    [
      { id: '1', fieldKey: 'down', operator: 'equals', value: '3' },
      { id: '2', fieldKey: 'distance', operator: 'gte', value: '5' },
    ],
    'ALL'
  );
  assert.equal(treffer.length, 1);
  assert.equal(treffer[0].id, 'p1');

  const sync = plMod.analysierePlaySyncStatus(plays, ['SIDELINE', 'ENDZONE']);
  assert.deepEqual(sync[0].fehlendeWinkel, ['ENDZONE']);
  assert.equal(sync[1].hatOffset, true);
});

test('SDK v2.0 Backend: RBAC, ReadOnly (409), Quota (413), Zero-Copy Storage-Delete & Club-Admin (#10)', async () => {
  const { backendPlugin } = await import(path.join(ROOT_DIR, 'dist/server.js'));

  const deletedStorageObjects = [];
  const updatedBreakdowns = [];

  const fakeDb = {
    schemaName: 'plugin_video_analysis',
    async query(sql, params = []) {
      if (sql.includes('FROM mod_video_media_reels') && sql.includes('WHERE id = $1')) {
        return {
          rows: [
            {
              id: 'reel-1',
              ref_count: 1,
              owner_club_id: 'club-1',
              owner_team_id: 'team-1',
              owner_team_name: 'Eagles',
              share_scope: 'TEAM_ONLY',
              club_wide_access_mode: 'READ_ONLY',
              total_size_bytes: 2048,
              created_by: 'u1',
              created_at: '2026-11-14T00:00:00Z',
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM mod_video_team_reel_access') && sql.includes('WHERE reel_id = $1 AND team_id = $2')) {
        return {
          rows: [
            {
              id: 'acc-1',
              reel_id: 'reel-1',
              team_id: 'team-1',
              club_id: 'club-1',
              season: '2026',
              title: 'Secret Staff Tape',
              category: 'GAME',
              event_date: '2026-11-14',
              visibility: 'STAFF_ONLY',
              access_mode: 'OWNER',
              shared_from_team_id: null,
              shared_from_team_name: null,
              allowed_fields_json: null,
              created_by: 'u1',
              created_at: '2026-11-14T00:00:00Z',
              updated_at: '2026-11-14T00:00:00Z',
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM mod_video_team_reel_access a') && sql.includes('JOIN mod_video_media_reels m')) {
        return {
          rows: [
            {
              id: 'acc-1',
              reel_id: 'reel-1',
              team_id: 'team-1',
              club_id: 'club-1',
              season: '2026',
              title: 'Secret Staff Tape',
              category: 'GAME',
              event_date: '2026-11-14',
              visibility: 'STAFF_ONLY',
              access_mode: 'OWNER',
              shared_from_team_id: null,
              shared_from_team_name: null,
              allowed_fields_json: null,
              created_by: 'u1',
              created_at: '2026-11-14T00:00:00Z',
              updated_at: '2026-11-14T00:00:00Z',
              owner_club_id: 'club-1',
              owner_team_id: 'team-1',
              owner_team_name: 'Eagles',
              share_scope: 'TEAM_ONLY',
              club_wide_access_mode: 'READ_ONLY',
              ref_count: 1,
              total_size_bytes: 2048,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM mod_video_plays')) {
        return { rows: [{ play_count: 1, angle_code: 'SIDELINE' }], rowCount: 1 };
      }
      if (sql.includes('UPDATE mod_video_plays')) {
        updatedBreakdowns.push({ sql, params });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('FROM mod_video_share_links')) {
        if (params[0] && String(params[0]).length > 0) {
          return {
            rows: [
              {
                id: 'shl-expired',
                team_id: 'team-1',
                access_id: 'acc-1',
                reel_id: 'reel-1',
                allowed_fields_json: ['odk'],
                include_metadata: true,
                expires_at: '2020-01-01T00:00:00.000Z',
                revoked_at: null,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('UPDATE mod_video_media_reels') && sql.includes('RETURNING ref_count')) {
        return { rows: [{ ref_count: 0 }], rowCount: 1 };
      }
      if (sql.includes('SELECT DISTINCT s3_key, file_size_bytes FROM mod_video_play_angles')) {
        return {
          rows: [{ s3_key: 'clubs/club-1/teams/team-1/video/clip.mp4', file_size_bytes: 2048 }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const baseClub = {
    id: 'club-1',
    name: 'Eagles e.V.',
    slug: 'eagles',
    speicher: {
      belegtBytes: 1000,
      kontingentBytes: 10_000,
      freiBytes: 9000,
      auslastungProzent: 10,
      speicherlimitErreicht: false,
    },
  };

  const memberCtx = {
    pluginId: 'video-analysis',
    manifest: backendPlugin.manifest,
    db: fakeDb,
    user: { uuid: 'm1', vollerName: 'Spieler', benutzername: 'm1', email: 'm1@x.de', istSysadmin: false },
    locale: 'de',
    club: baseClub,
    team: { id: 'team-1', clubId: 'club-1', name: 'Eagles', slug: 'eagles', status: 'ACTIVE', archiviert: false },
    clubRolle: 'CLUB_MEMBER',
    effektiveTeamRolle: 'MEMBER',
    userGroups: ['Offense'],
    isReadOnly: false,
    hasPermission: () => true,
  };

  // 1. MEMBER sieht STAFF_ONLY-Reels nicht
  const listRes = await backendPlugin.handleRequest(
    { method: 'GET', path: '/reels', params: {}, query: {}, body: null },
    memberCtx
  );
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.reels.length, 0);

  // 2. MEMBER darf keine Reels erstellen -> 403
  const postRes = await backendPlugin.handleRequest(
    { method: 'POST', path: '/reels', params: {}, query: {}, body: { title: 'Test' } },
    memberCtx
  );
  assert.equal(postRes.status, 403);

  // 3. CLUB_MEMBER darf nicht auf /club/reels zugreifen -> 403 (#10)
  const clubForbiddenRes = await backendPlugin.handleRequest(
    { method: 'GET', path: '/club/reels', params: {}, query: {}, body: null },
    memberCtx
  );
  assert.equal(clubForbiddenRes.status, 403);

  // 4. Archiviertes Team (isReadOnly = true) blockiert Schreibzugriffe mit HTTP 409
  const archivedStaffCtx = {
    ...memberCtx,
    effektiveTeamRolle: 'STAFF',
    isReadOnly: true,
    team: { ...memberCtx.team, status: 'ARCHIVED', archiviert: true },
  };
  const readOnlyRes = await backendPlugin.handleRequest(
    { method: 'POST', path: '/reels', params: {}, query: {}, body: { title: 'Gesperrt' } },
    archivedStaffCtx
  );
  assert.equal(readOnlyRes.status, 409);

  // 5. Storage-Quota-Überschreitung liefert HTTP 413
  const quotaCtx = {
    ...memberCtx,
    effektiveTeamRolle: 'STAFF',
    storage: {
      prefix: 'clubs/club-1/teams/team-1/video/',
      async getSignedUploadUrl() {
        const err = new Error('Storage quota exceeded');
        err.status = 413;
        throw err;
      },
      async getSignedDownloadUrl() {
        return { url: 'https://example.invalid/dl', key: 'k', expiresIn: 900 };
      },
      async deleteObject(objectPath, sizeBytes) {
        deletedStorageObjects.push({ objectPath, sizeBytes });
      },
    },
  };
  const quotaRes = await backendPlugin.handleRequest(
    {
      method: 'POST',
      path: '/storage/presign-upload',
      params: {},
      query: {},
      body: { objectPath: 'huge.mp4', contentType: 'video/mp4', fileSizeBytes: 999999999 },
    },
    quotaCtx
  );
  assert.equal(quotaRes.status, 413);

  // 6. Bulk Hudl CSV Breakdown Import (#9) aktualisiert Plays
  const importRes = await backendPlugin.handleRequest(
    {
      method: 'POST',
      path: '/reels/reel-1/breakdown-import',
      params: {},
      query: {},
      body: {
        playPatches: [{ playId: 'p1', playNumber: 1, breakdown: { odk: 'O', off_form: 'Trips' } }],
        newCustomFields: [],
      },
    },
    quotaCtx
  );
  assert.equal(importRes.status, 200);
  assert.equal(importRes.body.updatedPlays, 1);
  assert.equal(updatedBreakdowns.length, 1);

  // 7. Abgelaufener öffentlicher Share-Link liefert 410
  const pubRes = await backendPlugin.handlePublicRequest(
    { method: 'GET', path: '/share/expired-token', query: {}, body: null },
    fakeDb
  );
  assert.equal(pubRes.status, 410);

  // 8. Staff löscht Reel -> ref_count 0 -> ctx.storage.deleteObject wird aufgerufen
  const delRes = await backendPlugin.handleRequest(
    { method: 'DELETE', path: '/reels/reel-1', params: {}, query: {}, body: null },
    quotaCtx
  );
  assert.equal(delRes.status, 200);
  assert.equal(deletedStorageObjects.length, 1);
  assert.equal(deletedStorageObjects[0].objectPath, 'clip.mp4');
  assert.equal(deletedStorageObjects[0].sizeBytes, 2048);
});
