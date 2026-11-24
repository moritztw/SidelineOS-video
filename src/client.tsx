import { useEffect } from 'react';
import type {
  PluginLaufzeitKontext,
  SidelinePlugin,
} from '@sidelineos/plugin-sdk';
import { createPluginTranslator } from '@sidelineos/plugin-sdk';
import { Upload } from 'lucide-react';
import manifest from '../plugin.manifest.json';
import { DashboardView } from './components/DashboardView';
import { FilmRoomView } from './components/FilmRoomView';
import { PublicShareView } from './components/PublicShareView';
import { SmartPlaylistView } from './components/SmartPlaylistView';
import { SyncAndCutView } from './components/SyncAndCutView';
import { UploadPanel } from './components/UploadPanel';
import {
  VideoSysadminSettingsPanel,
  VideoTeamSettingsPanel,
  VideoUserSettingsPanel,
} from './components/VideoSettingsPanels';
import {
  VideoAnalysisProvider,
  useVideoAnalysis,
} from './context/VideoAnalysisContext';
import { VIDEO_WOERTERBUCH } from './i18n/woerterbuch';

function VideoImportPrimaerAktion({
  ctx,
  className,
}: {
  ctx: PluginLaufzeitKontext;
  className: string;
}) {
  const t = createPluginTranslator(VIDEO_WOERTERBUCH, ctx.locale);
  const { setUploadModalOffen } = useVideoAnalysis();
  if (ctx.aktiveTeamAnsicht === 'PLAYER') return null;

  return (
    <button
      type="button"
      onClick={() => setUploadModalOffen(true)}
      className={className}
    >
      <span className="sideline-video-root">
        <span className="inline-flex items-center">
          <Upload className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />
          {t('importAction')}
        </span>
      </span>
    </button>
  );
}

function VideoMainShell({ ctx }: { ctx: PluginLaufzeitKontext }) {
  const { ladeBasisDaten } = useVideoAnalysis();

  useEffect(() => {
    ladeBasisDaten(ctx.team.id, ctx.gewaehlteSaison, ctx.benutzer.uuid);
  }, [ctx.team.id, ctx.gewaehlteSaison, ctx.benutzer.uuid, ladeBasisDaten]);

  return (
    <div className="sideline-video-root">
      {ctx.aktuellerTab === 'film-room' ? (
        <FilmRoomView ctx={ctx} />
      ) : ctx.aktuellerTab === 'sync-cut' && ctx.aktiveTeamAnsicht !== 'PLAYER' ? (
        <SyncAndCutView ctx={ctx} />
      ) : ctx.aktuellerTab === 'playlists' ? (
        <SmartPlaylistView ctx={ctx} />
      ) : (
        <DashboardView ctx={ctx} />
      )}
      <UploadPanel ctx={ctx} />
    </div>
  );
}

const plugin: SidelinePlugin = {
  manifest: manifest as SidelinePlugin['manifest'],
  Provider: VideoAnalysisProvider,
  defaultTab: 'library',
  getTabs: ({ teamRolle, locale }) => {
    const t = createPluginTranslator(VIDEO_WOERTERBUCH, locale);
    const tabs = [
      { id: 'library', label: t('tabLibrary') },
      { id: 'film-room', label: t('tabFilmRoom') },
    ];
    if (teamRolle === 'COACH' || teamRolle === 'TEAM_ADMIN') {
      tabs.push({ id: 'sync-cut', label: t('tabSyncCut') });
    }
    tabs.push({ id: 'playlists', label: t('tabPlaylists') });
    return tabs;
  },
  PrimaerAktion: VideoImportPrimaerAktion,
  renderMainView: (ctx) => <VideoMainShell ctx={ctx} />,
  renderPublicShareView: ({ token, locale, onSchliessen }) => (
    <div className="sideline-video-root">
      <PublicShareView token={token} locale={locale} onSchliessen={onSchliessen} />
    </div>
  ),
  settingsPanels: {
    user: VideoUserSettingsPanel,
    team: VideoTeamSettingsPanel,
    sysadmin: VideoSysadminSettingsPanel,
  },
};

export default plugin;
