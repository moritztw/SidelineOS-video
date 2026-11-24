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

  // Darf bei 1920ms (Frame 48) NICHT vorzeitig auf Frame 50 (2000ms) stoppen
  assert.equal(frameMod.hatExaktenFrameTreffer(1920, 50), false);
  assert.equal(frameMod.findeNaechstenAutoStopFrame(1920, [50]), null);

  // Exakter Treffer bei 2000ms (Frame 50)
  assert.equal(frameMod.hatExaktenFrameTreffer(2000, 50), true);
  assert.equal(frameMod.findeNaechstenAutoStopFrame(2000, [50]), 50);

  // Playback-Tick-Überschreitung erkennt Frame 50 sauber zwischen 1960ms und 2010ms
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

  // Legacy markIn/markOut Belegung wird sauber auf Ein-Punkt-Schnitt migriert
  const migriert = frameMod.bereinigeHotkeyBelegung({
    markIn: 'KeyC',
    markOut: 'KeyO',
  });
  assert.equal(migriert.markCut, 'KeyC');
  assert.equal('markOut' in migriert, false);

  // Restclip-Berechnung begrenzt Positionen auf [cutStartMs .. totalDauerMs]
  const rest = frameMod.berechneRestclipZeit(5000, 12000, 60000);
  assert.equal(rest.startMs, 12000);
  assert.equal(rest.geclamptAbsMs, 12000);
  assert.equal(rest.relativMs, 0);
  assert.equal(rest.dauerMs, 48000);

  const mitte = frameMod.berechneRestclipZeit(20000, 12000, 60000);
  assert.equal(mitte.relativMs, 8000);
});

test('Tagging-Engine: Bidirektionale Gain/Loss-Berechnung inkl. FLAG-Ausnahme & Admin-Wörterbuchschutz', async () => {
  const tagMod = await ladeTsModul('src/services/taggingEngine.ts');

  // Eigene 25 -> Eigene 34 = +9 Yards
  assert.equal(tagMod.berechneGainLoss(-25, -34, 'COMPLETE'), 9);
  // Eigene 45 -> Gegnerische 45 = +10 Yards
  assert.equal(tagMod.berechneGainLoss(-45, 45, 'COMPLETE'), 10);
  // FLAG-Ausnahme: darf keine reale Gain/Loss-Statistik berechnen
  assert.equal(tagMod.berechneGainLoss(-25, -40, 'FLAG'), undefined);
  assert.equal(tagMod.berechneNeueFeldposition(-25, 15, 'FLAG'), undefined);

  const schema = tagMod.erstelleStandardTeamSchema('team-1');
  const gelernt = tagMod.ergaenzeTeamWoerterbuch(schema, 'off_form', 'Bunch Quads');
  assert.ok(gelernt.dictionary.off_form.includes('Bunch Quads'));

  const coachVersuch = tagMod.entferneWoerterbuchEintrag(
    gelernt,
    'off_form',
    'Bunch Quads',
    'COACH'
  );
  assert.equal(coachVersuch.ok, false);

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
    },
    angles: ['SIDELINE', 'ENDZONE'],
    plays: [
      {
        play_number: 1,
        sources: {
          SIDELINE: { file: 'sl_001.mp4', source_mode: 'CLIP_FILE', start_ms: 0, end_ms: 8400 },
          ENDZONE: { file: 'ez_001.mp4', start_ms: 0, end_ms: 8100 }, // optionales offset_ms weggelassen
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

test('Backend handleRequest & handlePublicRequest erzwingen RBAC, 404/410 und Cleanup-Queue', async () => {
  const { backendPlugin } = await import(path.join(ROOT_DIR, 'dist/server.js'));

  const queuedCleanup = [];
  const fakeDb = {
    schemaName: 'plugin_video_analysis',
    async query(sql, params = []) {
      if (sql.includes('FROM mod_video_team_reel_access') && sql.includes('WHERE team_id = $1')) {
        return {
          rows: [
            {
              id: 'acc-1',
              reel_id: 'reel-1',
              team_id: 'team-1',
              season: '2026',
              title: 'Secret Coaches Tape',
              category: 'GAME',
              event_date: '2026-11-14',
              visibility: 'COACHES_ONLY',
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
      if (sql.includes('FROM mod_video_plays')) {
        return { rows: [{ play_count: 0, angle_code: 'SIDELINE' }], rowCount: 1 };
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
                expires_at: '2020-01-01T00:00:00.000Z',
                revoked_at: null,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('UPDATE mod_video_media_reels')) {
        return { rows: [{ ref_count: 0 }], rowCount: 1 };
      }
      if (sql.includes('SELECT DISTINCT s3_key FROM mod_video_play_angles')) {
        return { rows: [{ s3_key: 'teams/team-1/plugins/video-analysis/clip.mp4' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const playerCtx = {
    pluginId: 'video-analysis',
    manifest: backendPlugin.manifest,
    db: fakeDb,
    user: { uuid: 'p1', volleName: 'Spieler', vollerName: 'Spieler', benutzername: 'p1', email: 'p1@x.de', istSysadmin: false, erstelltAm: '', customProfilWerte: {} },
    locale: 'de',
    team: { id: 'team-1', name: 'Eagles', kurzname: 'EAG', aktiveSaison: '2026', saisons: ['2026'], aktivierteModule: ['video-analysis'], customProfilFelder: [] },
    teamRolle: 'PLAYER',
    hasPermission: () => true,
  };

  // PLAYER sieht COACHES_ONLY-Reels nicht
  const listRes = await backendPlugin.handleRequest(
    { method: 'GET', path: '/reels', params: {}, query: {}, body: null },
    playerCtx
  );
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.reels.length, 0);

  // PLAYER darf keine Reels erstellen
  const postRes = await backendPlugin.handleRequest(
    { method: 'POST', path: '/reels', params: {}, query: {}, body: { title: 'Test' } },
    playerCtx
  );
  assert.equal(postRes.status, 403);

  // Abgelaufener öffentlicher Share-Link liefert 410
  const pubRes = await backendPlugin.handlePublicRequest(
    { method: 'GET', path: '/share/expired-token', query: {}, body: null },
    fakeDb
  );
  assert.equal(pubRes.status, 410);

  // Coach löscht Reel -> ref_count 0 -> Cleanup-Queue wird befüllt
  const coachCtx = {
    ...playerCtx,
    teamRolle: 'COACH',
    s3: { prefix: 'teams/team-1/plugins/video-analysis/' },
    cleanupQueue: {
      async enqueueOrphanedObjects(paths, reason) {
        queuedCleanup.push({ paths, reason });
        return { queued: paths.length };
      },
    },
  };

  const fakeDeleteDb = {
    ...fakeDb,
    async query(sql, params) {
      if (sql.includes('SELECT * FROM mod_video_team_reel_access')) {
        return {
          rows: [
            {
              id: 'acc-1',
              reel_id: 'reel-1',
              team_id: 'team-1',
              season: '2026',
              title: 'Game',
              category: 'GAME',
              event_date: '2026-11-14',
              visibility: 'COACHES_ONLY',
              shared_from_team_id: null,
              shared_from_team_name: null,
              allowed_fields_json: null,
              created_by: 'u1',
              created_at: '2026-11-14',
              updated_at: '2026-11-14',
            },
          ],
          rowCount: 1,
        };
      }
      return fakeDb.query(sql, params);
    },
  };

  const delRes = await backendPlugin.handleRequest(
    { method: 'DELETE', path: '/reels/reel-1', params: {}, query: {}, body: null },
    { ...coachCtx, db: fakeDeleteDb }
  );
  assert.equal(delRes.status, 200);
  assert.equal(queuedCleanup.length, 1);
  assert.deepEqual(queuedCleanup[0].paths, ['clip.mp4']);
});
