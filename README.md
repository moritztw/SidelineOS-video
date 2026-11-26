# SidelineOS-video (`video-analysis`)

Eigenständiges Videoanalyse-, Film-Room-, Tagging- und Austausch-Plugin für **[SidelineOS-Core (`dev`)](https://github.com/moritztw/SidelineOS-core/tree/dev)**, aufgebaut auf dem `SidelineOS-templateplugin` und dem `@sidelineos/plugin-sdk` (`v1.0`).

## Funktionsumfang

- **Videobibliothek & Dual-Import:** Saison- und Kategorie-Filterung (`GAME`, `PRACTICE`, `SCOUTING`, `SELF_SCOUT`), strikte `PLAYER`-Sichtbarkeit (`COACHES_ONLY` ausgeblendet), Upload von Einzelclips (mit optionalem Offset), Einzeldateien (`TIME_SLICE`) und `sideline-bundle.json` (`v1.0`) per S3-Presigned/Multipart-Upload.
- **Film Room & 25-fps-Telestration:** Multi-Angle-Wechsel ohne Positionsverlust, Vollbildmodus mit eingeblendeter Zeichenleiste, nachträglich editierbare Vektorzeichnungen (`select`, Freihand, Pfeil, Kreis/Zone, Spotlight, Text) mit exakter Bindung an Winkel und `frameIndex` (`FRAME_MS = 40`), 4-Ecken-Notiz-Overlay und konfigurierbare Hotkeys.
- **Hudl-Breakdown & Lernendes Wörterbuch:** 21 Standard-Breakdown-Felder plus Custom-Felder, bidirektionale Gain/Loss-Berechnung mit gezielter Ausnahme bei `RESULT === 'FLAG'` und admin-geschütztem Team-Wörterbuch.
- **Sync & Fast-Cut + Smart Playlists:** Dual-Viewport Multi-Angle-Sync-Editor (Snap-Sync & Lückenanzeige), Fast-Cut-Editor (`I / O / J-K-L`) sowie typsichere Smart-Playlist-Filter mit direktem Start im Film Room.
- **Team-Sharing & `/share/<token>`:** Granulare Spaltenfreigabe ohne Coach-Notizen/Zeichnungen, öffentliche ablaufende Download-Links (JSON/CSV) und isolierte PostgreSQL-Tabellen (`mod_video_*`).

## Lokale Entwicklung & Prüfung

```bash
npm install --legacy-peer-deps
npm run lint         # TypeScript-Prüfung (tsc --noEmit)
npm test             # Build + Contract- & Domänen-Tests (node:test)
npm run pack:plugin  # Erzeugt build-release/sideline-plugin-v1.tar.gz + .sha256
```

Für eine lokale UI-Vorschau ohne laufenden Core:

```bash
npm run dev          # Lokaler Dev-Preview auf Port 3000 (mit SDK-Shim & sl-*-Tokens)
```

## Installation in SidelineOS-Core (`dev`)

1. **Dev-Modus (`DEV_ALLOW_GIT_INSTALL=true`):** Im Sysadmin-Plugin-Store unter *Dev: Git Clone & Build* `https://github.com/moritztw/SidelineOS-video` angeben.
2. **Offline-Upload:** `npm run pack:plugin` ausführen und `build-release/sideline-plugin-v1.tar.gz` (samt `.sha256`) im Plugin-Store hochladen.
3. **GitHub Release:** Tag pushen (`git tag v0.2.0 && git push origin v0.2.0`) — die GitHub Action veröffentlicht `sideline-plugin-v1.tar.gz`, `.sha256` und `plugin.manifest.json`.

## Lizenz

GNU Affero General Public License v3.0 (AGPLv3) — siehe `LICENSE`.
