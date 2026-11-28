import { useEffect, useMemo, useState } from 'react';
import type { PluginLaufzeitKontext } from '@sidelineos/plugin-sdk';
import {
  Building2,
  Check,
  Copy,
  Link2,
  Lock,
  Save,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useVideoAnalysis } from '../context/VideoAnalysisContext';
import { erstelleVideoTranslator } from '../i18n/woerterbuch';
import { erstelleStandardTeamSchema } from '../services/taggingEngine';
import type {
  ClubTeamInfo,
  PublicShareLinkInfo,
  ReelAccessMode,
  ReelShareScope,
  VideoReelEintrag,
} from '../types/video';

type ShareAccessMode = Exclude<ReelAccessMode, 'OWNER'>;

interface TeamShareAuswahl {
  teamId: string;
  teamName: string;
  accessMode: ShareAccessMode;
}

export function TeamShareModal({
  ctx,
  reel,
  clubScopeMode = false,
  onSchliessen,
  onAktualisiert,
}: {
  ctx: PluginLaufzeitKontext;
  reel: VideoReelEintrag;
  clubScopeMode?: boolean;
  onSchliessen: () => void;
  onAktualisiert?: () => Promise<void>;
}) {
  const t = erstelleVideoTranslator(ctx.locale);
  const { api, teamSchema, clubTeams: kontextClubTeams } = useVideoAnalysis();
  const schema = teamSchema ?? erstelleStandardTeamSchema(ctx.team?.id ?? reel.teamId);
  const alleFelder = schema.fields.filter((f) => f.aktiv);

  const [shareScope, setShareScope] = useState<ReelShareScope>(reel.shareScope ?? 'TEAM_ONLY');
  const [clubWideAccessMode, setClubWideAccessMode] = useState<ShareAccessMode>(
    reel.clubWideAccessMode ?? 'READ_ONLY'
  );
  const [verfuegbareTeams, setVerfuegbareTeams] = useState<ClubTeamInfo[]>(kontextClubTeams);
  const [teamShares, setTeamShares] = useState<TeamShareAuswahl[]>(() =>
    (reel.sharedTeams ?? []).map((s) => ({
      teamId: s.teamId,
      teamName: s.teamName,
      accessMode: s.accessMode === 'OWN_BREAKDOWN' ? 'OWN_BREAKDOWN' : 'READ_ONLY',
    }))
  );
  const [manuelleTeamId, setManuelleTeamId] = useState('');
  const [manuelleAccessMode, setManuelleAccessMode] = useState<ShareAccessMode>('READ_ONLY');

  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [ausgewaehlteFelder, setAusgewaehlteFelder] = useState<string[]>(
    alleFelder.map((f) => f.key)
  );
  const [linkLabel, setLinkLabel] = useState('Scouting-Austausch');
  const [laufzeitTage, setLaufzeitTage] = useState(7);
  const [links, setLinks] = useState<PublicShareLinkInfo[]>([]);
  const [neuerToken, setNeuerToken] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState(false);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  const ownerTeamId = reel.sharedFromTeamId ?? reel.teamId;

  useEffect(() => {
    api
      .holeClubTeams()
      .then((res) => setVerfuegbareTeams(res.teams))
      .catch(() => undefined);
    if (!clubScopeMode && ctx.team) {
      api
        .holeShareLinks(reel.id)
        .then((res) => setLinks(res.links))
        .catch(() => undefined);
    }
  }, [api, reel.id, clubScopeMode, ctx.team]);

  const andereClubTeams = useMemo(
    () =>
      verfuegbareTeams.filter((tm) => tm.teamId !== ownerTeamId && tm.teamStatus !== 'ARCHIVED'),
    [verfuegbareTeams, ownerTeamId]
  );

  const toggleFeld = (key: string) => {
    setAusgewaehlteFelder((alt) =>
      alt.includes(key) ? alt.filter((k) => k !== key) : [...alt, key]
    );
  };

  const toggleClubTeam = (team: ClubTeamInfo) => {
    setTeamShares((alt) => {
      const existiert = alt.some((s) => s.teamId === team.teamId);
      if (existiert) {
        return alt.filter((s) => s.teamId !== team.teamId);
      }
      return [
        ...alt,
        { teamId: team.teamId, teamName: team.teamName, accessMode: 'READ_ONLY' },
      ];
    });
  };

  const setzeTeamAccessMode = (teamId: string, accessMode: ShareAccessMode) => {
    setTeamShares((alt) =>
      alt.map((s) => (s.teamId === teamId ? { ...s, accessMode } : s))
    );
  };

  const handleManuellesTeamHinzufuegen = () => {
    const id = manuelleTeamId.trim();
    if (!id || id === ownerTeamId) return;
    if (teamShares.some((s) => s.teamId === id)) {
      setManuelleTeamId('');
      return;
    }
    setTeamShares((alt) => [
      ...alt,
      { teamId: id, teamName: id, accessMode: manuelleAccessMode },
    ]);
    setManuelleTeamId('');
  };

  const handleFreigabeSpeichern = async () => {
    setFehler(null);
    setHinweis(null);
    setSpeichert(true);
    try {
      const payload = {
        shareScope,
        clubWideAccessMode,
        sharedTeams:
          shareScope === 'SELECTED_TEAMS'
            ? teamShares.map((s) => ({
                teamId: s.teamId,
                teamName: s.teamName,
                accessMode: s.accessMode,
                allowedFields: includeMetadata ? ausgewaehlteFelder : [],
              }))
            : [],
      };
      if (clubScopeMode) {
        await api.aktualisiereClubReelFreigabe(reel.id, payload);
      } else {
        await api.aktualisiereReelFreigabe(reel.id, payload);
      }
      setHinweis('Freigabe-Einstellungen gespeichert (Zero-Copy ohne Video-Duplikate).');
      if (onAktualisiert) {
        await onAktualisiert();
      }
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Freigabe konnte nicht gespeichert werden.');
    } finally {
      setSpeichert(false);
    }
  };

  const handleLinkErstellen = async () => {
    setFehler(null);
    try {
      const res = await api.erstelleShareLink(reel.id, {
        label: linkLabel,
        includeMetadata,
        allowedFields: includeMetadata ? ausgewaehlteFelder : [],
        expiresInDays: laufzeitTage,
      });
      setLinks((alt) => [res.link, ...alt]);
      if (res.link.token) {
        setNeuerToken(res.link.token);
      }
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Link konnte nicht erstellt werden.');
    }
  };

  const istClubOderTeamAdmin =
    ctx.clubRolle === 'CLUB_ADMIN' || ctx.effektiveTeamRolle === 'TEAM_ADMIN';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={t('shareModalTitle')}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-sl-border bg-sl-surface p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-sl-border pb-4">
          <div>
            <h2 className="text-lg font-semibold text-sl-heading">{t('shareModalTitle')}</h2>
            <p className="text-xs text-sl-muted">
              {reel.title}
              {reel.sharedFromTeamName ? ` · Eigentümer: ${reel.sharedFromTeamName}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onSchliessen}
            className="rounded-md p-1.5 text-sl-muted hover:bg-sl-elevated hover:text-sl-heading"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Granulare Vereins- & Team-Freigabelogik (#10) */}
        <div className="space-y-3 rounded-lg border border-sl-border bg-sl-canvas p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-sl-heading">
            <Building2 className="h-4 w-4 text-sl-accent" aria-hidden="true" />
            Vereins- &amp; Team-Freigabe (Zero-Copy)
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(
              [
                {
                  id: 'PRIVATE_ADMIN',
                  label: t('scopePrivateAdmin'),
                  desc: 'Nur Uploader, Team-Admins & Club-Admins',
                  icon: Lock,
                },
                {
                  id: 'TEAM_ONLY',
                  label: t('scopeTeamOnly'),
                  desc: 'Freigegeben innerhalb des eigenen Teams',
                  icon: Users,
                },
                {
                  id: 'CLUB_WIDE',
                  label: t('scopeClubWide'),
                  desc: 'Automatisch für alle Teams im Verein sichtbar',
                  icon: Building2,
                },
                {
                  id: 'SELECTED_TEAMS',
                  label: t('scopeSelectedTeams'),
                  desc: 'Gezielte Freigabe an ausgewählte Teams',
                  icon: Users,
                },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              const aktiv = shareScope === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={!istClubOderTeamAdmin && opt.id === 'CLUB_WIDE'}
                  onClick={() => setShareScope(opt.id)}
                  className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-45 ${
                    aktiv
                      ? 'border-sl-accent bg-sl-accent/10 text-sl-heading'
                      : 'border-sl-border bg-sl-surface text-sl-primary hover:border-sl-border-strong'
                  }`}
                >
                  <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sl-accent" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold">{opt.label}</div>
                    <div className="text-[11px] text-sl-muted">{opt.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {shareScope === 'CLUB_WIDE' && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sl-border pt-3 text-xs">
              <span className="text-sl-muted">Empfänger-Rechte für andere Vereinsteams:</span>
              <select
                value={clubWideAccessMode}
                onChange={(e) => setClubWideAccessMode(e.target.value as ShareAccessMode)}
                className="rounded-md border border-sl-border bg-sl-surface px-2.5 py-1.5 text-xs text-sl-heading focus:border-sl-accent focus:outline-none"
              >
                <option value="READ_ONLY">{t('accessModeReadOnly')} (Video &amp; Breakdown ansehen)</option>
                <option value="OWN_BREAKDOWN">
                  {t('accessModeOwnBreakdown')} (Eigene Tags/Notizen auf selbem Video)
                </option>
              </select>
            </div>
          )}

          {shareScope === 'SELECTED_TEAMS' && (
            <div className="space-y-3 border-t border-sl-border pt-3">
              {andereClubTeams.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-sl-muted">
                    Teams in {ctx.club?.name ?? 'Verein'}
                  </div>
                  {andereClubTeams.map((tm) => {
                    const eintrag = teamShares.find((s) => s.teamId === tm.teamId);
                    const ausgewaehlt = Boolean(eintrag);
                    return (
                      <div
                        key={tm.teamId}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-sl-border bg-sl-surface px-3 py-2 text-xs"
                      >
                        <label className="inline-flex items-center gap-2 text-sl-heading">
                          <input
                            type="checkbox"
                            checked={ausgewaehlt}
                            onChange={() => toggleClubTeam(tm)}
                            className="accent-sl-accent"
                          />
                          <span>{tm.teamName}</span>
                        </label>
                        {ausgewaehlt && eintrag && (
                          <select
                            aria-label={`Zugriffsrecht für ${tm.teamName}`}
                            value={eintrag.accessMode}
                            onChange={(e) =>
                              setzeTeamAccessMode(tm.teamId, e.target.value as ShareAccessMode)
                            }
                            className="rounded border border-sl-border bg-sl-canvas px-2 py-1 text-xs text-sl-heading"
                          >
                            <option value="READ_ONLY">{t('accessModeReadOnly')}</option>
                            <option value="OWN_BREAKDOWN">{t('accessModeOwnBreakdown')}</option>
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Zusätzliches externes / manuelles Team per ID */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={manuelleTeamId}
                  onChange={(e) => setManuelleTeamId(e.target.value)}
                  placeholder="Weitere Team-ID hinzufügen..."
                  className="flex-1 min-w-[160px] rounded-md border border-sl-border bg-sl-surface px-3 py-1.5 text-xs text-sl-heading focus:border-sl-accent focus:outline-none"
                />
                <select
                  value={manuelleAccessMode}
                  onChange={(e) => setManuelleAccessMode(e.target.value as ShareAccessMode)}
                  className="rounded-md border border-sl-border bg-sl-surface px-2.5 py-1.5 text-xs text-sl-heading"
                >
                  <option value="READ_ONLY">{t('accessModeReadOnly')}</option>
                  <option value="OWN_BREAKDOWN">{t('accessModeOwnBreakdown')}</option>
                </select>
                <button
                  type="button"
                  onClick={handleManuellesTeamHinzufuegen}
                  className="rounded-md bg-sl-elevated px-3 py-1.5 text-xs font-medium text-sl-heading hover:bg-sl-border-strong whitespace-nowrap"
                >
                  Hinzufügen
                </button>
              </div>

              {teamShares.filter((s) => !andereClubTeams.some((tm) => tm.teamId === s.teamId))
                .length > 0 && (
                <div className="space-y-1">
                  {teamShares
                    .filter((s) => !andereClubTeams.some((tm) => tm.teamId === s.teamId))
                    .map((s) => (
                      <div
                        key={s.teamId}
                        className="flex items-center justify-between gap-2 rounded border border-sl-border bg-sl-surface px-3 py-1.5 text-xs"
                      >
                        <span className="font-mono text-sl-primary">{s.teamName}</span>
                        <div className="flex items-center gap-2">
                          <select
                            value={s.accessMode}
                            onChange={(e) =>
                              setzeTeamAccessMode(s.teamId, e.target.value as ShareAccessMode)
                            }
                            className="rounded border border-sl-border bg-sl-canvas px-2 py-0.5 text-xs text-sl-heading"
                          >
                            <option value="READ_ONLY">{t('accessModeReadOnly')}</option>
                            <option value="OWN_BREAKDOWN">{t('accessModeOwnBreakdown')}</option>
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              setTeamShares((alt) => alt.filter((x) => x.teamId !== s.teamId))
                            }
                            className="text-sl-muted hover:text-sl-danger-text"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end border-t border-sl-border pt-3">
            <button
              type="button"
              disabled={speichert || ctx.isReadOnly}
              onClick={handleFreigabeSpeichern}
              className="inline-flex items-center gap-1.5 rounded-md bg-sl-accent px-3.5 py-1.5 text-xs font-semibold text-sl-accent-contrast hover:bg-sl-accent-hover disabled:opacity-45"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
              {speichert ? 'Speichere...' : 'Freigabe speichern'}
            </button>
          </div>
        </div>

        {/* Option: Metadaten mit freigeben (#8 / #10) */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <label className="inline-flex items-center gap-2 font-semibold text-sl-heading">
              <input
                type="checkbox"
                checked={includeMetadata}
                onChange={(e) => setIncludeMetadata(e.target.checked)}
                className="accent-sl-accent"
              />
              Breakdown-Metadaten mit freigeben (Coach-Notizen &amp; Zeichnungen bleiben immer privat)
            </label>
            {includeMetadata && (
              <button
                type="button"
                onClick={() =>
                  setAusgewaehlteFelder(
                    ausgewaehlteFelder.length === alleFelder.length
                      ? []
                      : alleFelder.map((f) => f.key)
                  )
                }
                className="text-sl-accent hover:underline"
              >
                Alle umschalten
              </button>
            )}
          </div>

          {includeMetadata && (
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-sl-border bg-sl-canvas p-3 sm:grid-cols-4">
              {alleFelder.map((feld) => (
                <label
                  key={feld.key}
                  className="inline-flex items-center gap-1.5 text-xs text-sl-primary"
                >
                  <input
                    type="checkbox"
                    checked={ausgewaehlteFelder.includes(feld.key)}
                    onChange={() => toggleFeld(feld.key)}
                    className="accent-sl-accent"
                  />
                  <span className="truncate">{feld.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Öffentlicher /share/<token>-Link (nur im Team-Kontext) */}
        {!clubScopeMode && ctx.team && (
          <div className="space-y-3 rounded-lg border border-sl-border bg-sl-canvas p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-sl-heading">
              <Link2 className="h-4 w-4 text-sl-accent" aria-hidden="true" />
              Öffentlicher Download-Link (/share/&lt;token&gt;)
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={linkLabel}
                onChange={(e) => setLinkLabel(e.target.value)}
                className="flex-1 min-w-[160px] rounded-md border border-sl-border bg-sl-surface px-3 py-1.5 text-xs text-sl-heading"
              />
              <select
                value={laufzeitTage}
                onChange={(e) => setLaufzeitTage(Number(e.target.value))}
                className="rounded-md border border-sl-border bg-sl-surface px-2.5 py-1.5 text-xs text-sl-heading"
              >
                <option value={1}>1 Tag</option>
                <option value={7}>7 Tage</option>
                <option value={30}>30 Tage</option>
              </select>
              <button
                type="button"
                disabled={ctx.isReadOnly}
                onClick={handleLinkErstellen}
                className="rounded-md bg-sl-accent px-3 py-1.5 text-xs font-semibold text-sl-accent-contrast hover:bg-sl-accent-hover disabled:opacity-45 whitespace-nowrap"
              >
                Link erzeugen
              </button>
            </div>

            {neuerToken && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-sl-accent/50 bg-sl-surface px-3 py-2 text-xs">
                <code className="truncate font-mono text-sl-accent">/share/{neuerToken}</code>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      navigator.clipboard?.writeText(`${window.location.origin}/share/${neuerToken}`)
                    }
                    className="inline-flex items-center gap-1 rounded bg-sl-elevated px-2 py-1 text-sl-heading"
                  >
                    <Copy className="h-3 w-3" aria-hidden="true" /> Kopieren
                  </button>
                </div>
              </div>
            )}

            {links.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {links.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-center justify-between gap-2 text-xs text-sl-muted"
                  >
                    <span>
                      {l.label} ·{' '}
                      {l.includeMetadata === false
                        ? 'Nur Video'
                        : `${l.allowedFields.length} Felder`}{' '}
                      · läuft ab {l.expiresAt.slice(0, 10)} {l.revokedAt ? '(widerrufen)' : ''}
                    </span>
                    {!l.revokedAt && !ctx.isReadOnly && (
                      <button
                        type="button"
                        onClick={async () => {
                          await api.widerrufeShareLink(l.id);
                          setLinks((alt) =>
                            alt.map((x) =>
                              x.id === l.id ? { ...x, revokedAt: new Date().toISOString() } : x
                            )
                          );
                        }}
                        className="inline-flex items-center gap-1 text-sl-danger-text hover:underline whitespace-nowrap"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" /> Widerrufen
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {fehler && (
          <div className="rounded-lg border border-sl-danger/40 bg-sl-danger/10 px-3 py-2 text-xs text-sl-danger-text">
            {fehler}
          </div>
        )}
        {hinweis && (
          <p className="inline-flex items-center gap-1.5 text-xs text-sl-accent">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            {hinweis}
          </p>
        )}
      </div>
    </div>
  );
}
