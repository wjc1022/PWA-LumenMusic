# PrivateKara

English | [简体中文](./README.zh-CN.md)

**Bring Your Own Media Karaoke PWA**

PrivateKara is a mobile-first Progressive Web App for singing your own songs in physical karaoke venues when the venue's catalog does not have what you want. Prepare your audio, music videos (MVs), instrumental tracks, and synchronized lyrics beforehand, then manage and play them from your phone. The primary intended setup is an iPhone mirrored to the venue's screen, with audio routed through the available venue equipment.

This is currently a personal project, with possible future public availability. PrivateKara does not provide, search for, download, or generate music, videos, instrumental tracks, or lyrics. You supply the media and are responsible for the rights to use it.

## Current functionality

The following capabilities are implemented and confirmed against the source code. This describes implementation, not certification on real devices; see the validation limits below.

- **Local media library:** import audio and video files using the file picker or desktop drag and drop; read audio metadata and embedded covers where available. Media, lyrics, playlists, favorites, and settings are stored locally in IndexedDB, without an account or application backend.
- **Playback and organization:** search and sort the library, manage playlists and their order, use favorites, queue, previous/next, seeking, shuffle, and repeat off/all/one. A mini player and expanded player share playback; selecting a song opens the expanded player, and collapsing it keeps foreground playback running.
- **Lyrics:** import or replace one raw LRC/plain-text lyric file per song from Library resource controls. Same-name `.lrc` files selected alongside media can be paired automatically. Timed lines scroll and highlight; Enhanced LRC `<mm:ss.xxx>` segments already support active-word and sung-word highlighting. Plain text displays without synchronization. Lyrics can contain any language or mixed languages; there is no lyric editor or translation service.
- **Audio instrumental switching:** attach a separately prepared instrumental file to an audio entry in Library, then switch between original and instrumental playback. The engine attempts to retain position and play/pause state; switching is not guaranteed to be seamless. Video/MV instrumental switching is not implemented.
- **Video presentation:** inline playback, landscape lyric sidebar, subtitle toggle, responsive controls, and controls that hide while playing. Portrait video hides the lyric region. Fullscreen requests and orientation locking have a page-fill/rotation fallback; page fill does not remove browser chrome.
- **Foreground playback:** requests Screen Wake Lock when supported. Backgrounding the page pauses playback; returning leaves it paused until you press Play.
- **Backup and offline support:** JSON library backup/restore and selective Lumen Music Package (`.lmp`) import/export, including media, instrumentals, lyrics, and library records. A service worker caches the app shell for offline use after a successful initial load; imported media remains in local browser storage.
- **Preferences and diagnostics:** English, Simplified Chinese, and Persian UI; dark/light/system themes; player-button visibility settings; sleep timer; update checks; and local resource diagnostics in Settings.

Recent items and play counts exist locally, but they are basic selection records rather than a meaningful record of completed karaoke performances.

## Setup

The app uses plain HTML, CSS, and JavaScript ES modules. There are no npm dependencies or build steps.

From this repository directory, with Python 3 installed:

```sh
python -m http.server 8080
```

Open `http://localhost:8080`. Use a static HTTPS host for phone access and PWA testing; a phone's `localhost` refers to the phone itself. Opening `index.html` through `file://` is not supported. Service workers and other secure-context APIs require HTTPS or a trusted localhost origin.

On iPhone, open the HTTPS site in Safari and use **Share → Add to Home Screen** to try the installed PWA. The application labels and PWA install name use **PrivateKara**.

## Basic use at a venue

1. Prepare playable media and matching lyrics before your visit. If files are in a cloud-backed Files location, make them locally available before selecting them; this is file import, not integrated cloud-drive streaming.
2. Use **Import songs** on Home or Library. To associate lyrics automatically, select the media and a matching same-name `.lrc` file together. Alternatively, open the song's resource controls in Library to add/replace lyrics or attach an instrumental to an audio entry.
3. Select a song or play from a playlist, then use the expanded player for lyrics and playback controls. Use the mini player while browsing.
4. Start iPhone screen mirroring through the system controls and use the venue's available display/audio connection. Mirroring is an intended workflow, not an app-managed second-screen connection; test the actual setup before relying on it.
5. Export a JSON backup or `.lmp` package from Settings and retain your original files outside the browser.

## Known limitations and validation status

- **iOS Safari and installed-PWA reliability remains unproven.** Project notes record desktop automated checks, but real-iPhone acceptance is incomplete. File selection (including LRC/TXT and cloud-backed files), storage after restart, actual audible output, sustained playback, wake lock, touch interaction, fullscreen/orientation, and venue mirroring still need device validation. Do not treat desktop checks as device compatibility claims.
- Media becoming unreadable after restarting the iPhone PWA, playback stalls, and position issues with actual original/instrumental file pairs remain unresolved device concerns. Settings diagnostics can inspect stored resources and media loading; successful metadata loading does not prove successful playback.
- Import acceptance does not guarantee that a browser can decode a file's codecs. Native iPhone video fullscreen does not include custom HTML lyric sidebars; fullscreen/orientation APIs and wake lock may be unavailable or rejected.
- This is a foreground player. Background and lock-screen playback are not supported as a reliable workflow, and wake lock cannot override system refusal or manual locking.
- Browser storage is not a durable backup: quotas, site-data clearing, eviction, or device/browser failures can make local resources unavailable. There is no cloud sync or automatic recovery from the original files.
- **Upgrade compatibility:** the current `lumen-db` version 2 upgrade clears the previous application database and requires reimport. Current JSON backups use `formatVersion: 3`; `.lmp` packages use `packageFormatVersion: 3`. Older backup/package versions are rejected. Original files and downloaded backups are separate from the application database.

## Future development

These are planned directions, not additional implemented capabilities:

- Refine the existing Enhanced LRC word-level highlighting and validate timing, readability, seeking, and original/instrumental transitions on real devices. Basic word-tag parsing and highlighting already exist.
- Add instrumental switching for video/MV playback while preserving video, audio, and lyric synchronization.
- Add import and streaming from personal cloud drives, with explicit access and offline behavior.
- Define meaningful playback history/counting for karaoke use and add cloud persistence of personal records. Existing local recents/counts and manual backups do not provide this.

## Heritage and license

**PrivateKara** is developed and maintained by **Junchao Wen**. It is derived from the upstream project **PWA-LumenMusic**, created by **Behnood Shafiei**: [Behnooddev/PWA-LumenMusic](https://github.com/Behnooddev/PWA-LumenMusic). It retains the upstream framework-free player foundation and Lumen Music Package (`.lmp`) format name. Internal identifiers such as `lumen-db` remain unchanged.

The source code is licensed under the **MIT License**; see [LICENSE](./LICENSE), which retains **Copyright (c) 2026 Lumen contributors** and the original MIT terms, and adds **Copyright (c) 2026 Junchao Wen** for original contributions to PrivateKara. The new notice supplements and does not replace the upstream copyright. That license does not grant rights to imported music, video, lyrics, or cover art.

The existing [usage guide](./HOW_TO_USE.md) and [package specification](./LMP_SPECIFICATION.md) provide legacy reference material; some instructions and format details predate the current implementation and version-3 formats described above.
