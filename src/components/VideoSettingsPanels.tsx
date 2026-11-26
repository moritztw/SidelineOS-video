import { useEffect, useState } from 'react';
import type { PluginSettingsKontext } from '@sidelineos/plugin-sdk';
import { createPluginTranslator } from '@sidelineos/plugin-sdk';
import { HardDrive, Keyboard, Tag } from 'lucide-react';
import { VIDEO_WOERTERBUCH } from '../i18n/woerterbuch';
import { videoApi } from '../services/apiClient';
import {
  HOTKEY_AKTION_LABELS,
  STANDARD_HOTKEYS,
  aktualisiereBenutzerHotkey,
  bereinigeHotkeyBelegung,
  formatiereHotkeyAnzeige,
} from '../services/frameAndHotkeys';
import { erstelleStandardTeamSchema } from '../services/taggingEngine';
import type {
  BenutzerVideoPraeferenzen,
  EckPosition,
  HotkeyAktion,
  TeamTaggingSchema,
} from '../types/video';
import { TaggingSchemaSettings } from './TaggingSchemaSettings';

export function VideoUserSettingsPanel({ ctx }: { ctx: PluginSettingsKontext }) {
  const t = createPluginTranslator(VIDEO_WOERTERBUCH, ctx.locale);
  const [prefs, setPrefs] = useState<BenutzerVideoPraeferenzen>({
    userUuid: ctx.benutzer.uuid,
    hotkeys: STANDARD_HOTKEYS,
    defaultCorner: 'top-right',
    defaultPlaybackRate: 1,
    autoStopEnabled: true,
    updatedAt: new Date().toISOString(),
  });
  const [aufnahmeAktion, setAufnahmeAktion] = useState<HotkeyAktion | null>(null);
  const [konfliktHinweis, setKonfliktHinweis] = useState<string | null>(null);

  useEffect(() => {
    videoApi
      .holePraeferenzen(ctx.team.id)
      .then((res) =>
        setPrefs({
          ...res.prefs,
          hotkeys: bereinigeHotkeyBelegung(res.prefs.hotkeys),
        })
      )
      .catch(() => undefined);
  }, [ctx.team.id]);

  const speicherePrefs = async (next: BenutzerVideoPraeferenzen) => {
    setPrefs(next);
    await videoApi.speicherePraeferenzen(ctx.team.id, next).catch(() => undefined);
  };

  return (
    <section id="modul-video-hotkeys" className="sideline-video-root">
      <div className="rounded-xl border border-sl-border bg-sl-surface p-6 space-y-5">
      <div className="flex items-center gap-2.5">
        <Keyboard className="h-4 w-4 text-sl-accent" aria-hidden="true" />
        <h2 className="text-base font-semibold text-sl-heading">{t('settingsUserTitle')}</h2>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs">
          <span className="text-sl-muted">Standard-Kommentar-Ecke</span>
          <select
            value={prefs.defaultCorner}
            onChange={(e) =>
              speicherePrefs({ ...prefs, defaultCorner: e.target.value as EckPosition })
            }
            className="w-full rounded-md border border-sl-border bg-sl-canvas px-3 py-2 text-xs text-sl-heading"
          >
            <option value="top-left">Oben links</option>
            <option value="top-right">Oben rechts</option>
            <option value="bottom-left">Unten links</option>
            <option value="bottom-right">Unten rechts</option>
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="text-sl-muted">Standard-Tempo</span>
          <select
            value={prefs.defaultPlaybackRate}
            onChange={(e) =>
              speicherePrefs({ ...prefs, defaultPlaybackRate: Number(e.target.value) })
            }
            className="w-full rounded-md border border-sl-border bg-sl-canvas px-3 py-2 text-xs text-sl-heading"
          >
            <option value={0.5}>0.5x</option>
            <option value={1}>1.0x</option>
            <option value={1.5}>1.5x</option>
          </select>
        </label>

        <label className="flex items-center gap-2 pt-5 text-xs text-sl-primary">
          <input
            type="checkbox"
            checked={prefs.autoStopEnabled}
            onChange={(e) =>
              speicherePrefs({ ...prefs, autoStopEnabled: e.target.checked })
            }
            className="accent-sl-accent"
          />
          Auto-Stop an Notiz-/Zeichnungs-Frames aktiv
        </label>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold text-sl-heading">Persönliche Hotkeys</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(Object.keys(STANDARD_HOTKEYS) as HotkeyAktion[]).map((aktion) => (
            <div
              key={aktion}
              className="flex items-center justify-between rounded-lg border border-sl-border bg-sl-canvas px-3 py-2 text-xs"
            >
              <span className="text-sl-primary">
                {HOTKEY_AKTION_LABELS[aktion][ctx.locale === 'en' ? 'en' : 'de']}
              </span>
              <button
                type="button"
                onClick={() => {
                  setKonfliktHinweis(null);
                  setAufnahmeAktion(aktion);
                }}
                onKeyDown={(e) => {
                  if (aufnahmeAktion !== aktion) return;
                  e.preventDefault();
                  const ergebnis = aktualisiereBenutzerHotkey(
                    prefs.hotkeys,
                    aktion,
                    e.code || e.key
                  );
                  if (!ergebnis.ok && ergebnis.konfliktAktion) {
                    setKonfliktHinweis(
                      `Taste bereits belegt durch "${HOTKEY_AKTION_LABELS[ergebnis.konfliktAktion].de}".`
                    );
                  } else {
                    setAufnahmeAktion(null);
                    speicherePrefs({ ...prefs, hotkeys: ergebnis.belegung });
                  }
                }}
                className={`rounded px-2.5 py-1 font-mono text-xs ${
                  aufnahmeAktion === aktion
                    ? 'bg-sl-accent font-semibold text-sl-accent-contrast'
                    : 'bg-sl-surface text-sl-primary'
                }`}
              >
                {aufnahmeAktion === aktion
                  ? 'Taste drücken...'
                  : formatiereHotkeyAnzeige(prefs.hotkeys[aktion])}
              </button>
            </div>
          ))}
        </div>
        {konfliktHinweis && <p className="text-xs text-sl-danger-text">{konfliktHinweis}</p>}
      </div>
      </div>
    </section>
  );
}

export function VideoTeamSettingsPanel({ ctx }: { ctx: PluginSettingsKontext }) {
  const t = createPluginTranslator(VIDEO_WOERTERBUCH, ctx.locale);
  const [schema, setSchema] = useState<TeamTaggingSchema>(() =>
    erstelleStandardTeamSchema(ctx.team.id)
  );

  useEffect(() => {
    videoApi
      .holeSchema(ctx.team.id)
      .then((res) => setSchema(res.schema))
      .catch(() => undefined);
  }, [ctx.team.id]);

  return (
    <section id="modul-video-tagging-schema" className="sideline-video-root">
      <div className="rounded-xl border border-sl-border bg-sl-surface p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <Tag className="h-4 w-4 text-sl-accent" aria-hidden="true" />
          <h2 className="text-base font-semibold text-sl-heading">{t('settingsTeamTitle')}</h2>
        </div>
        <TaggingSchemaSettings
          schema={schema}
          teamRolle={ctx.aktiveTeamAnsicht}
          onSave={async (next) => {
            setSchema(next);
            await videoApi.speichereSchema(ctx.team.id, next).catch(() => undefined);
          }}
        />
      </div>
    </section>
  );
}

export function VideoSysadminSettingsPanel({ ctx }: { ctx: PluginSettingsKontext }) {
  const t = createPluginTranslator(VIDEO_WOERTERBUCH, ctx.locale);
  return (
    <section id="modul-video-s3-cleanup" className="sideline-video-root">
      <div className="rounded-xl border border-sl-border bg-sl-surface p-6 space-y-3">
        <div className="flex items-center gap-2.5">
          <HardDrive className="h-4 w-4 text-sl-accent" aria-hidden="true" />
          <h2 className="text-base font-semibold text-sl-heading">{t('settingsSysadminTitle')}</h2>
        </div>
        <p className="text-xs text-sl-muted">
          DSGVO-konforme S3-Isolation ohne Einsicht in Team-Videos oder Coach-Notizen.
        </p>
        <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
          <div className="rounded-lg border border-sl-border bg-sl-canvas px-3 py-2.5">
            <dt className="text-sl-muted">Anonymisierter S3-Präfix</dt>
            <dd className="mt-0.5 font-mono text-sl-heading">
              teams/&lt;teamId&gt;/plugins/video-analysis/
            </dd>
          </div>
          <div className="rounded-lg border border-sl-border bg-sl-canvas px-3 py-2.5">
            <dt className="text-sl-muted">Cleanup-Schonfrist (Retention)</dt>
            <dd className="mt-0.5 font-mono text-sl-heading video-tabular">
              {ctx.s3Konfig.cleanupRetentionDays ?? 14} Tage
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
