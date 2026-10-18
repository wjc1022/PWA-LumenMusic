# KTV development plan

## Agreed scope

1. Local audio with improved synchronized LRC lyrics.
2. Original/instrumental track switching, preserving playback position and lyrics synchronization.
3. Google Drive resource loading; other providers can follow.

Lumen remains the application. Karaoke Stage provides reference algorithms and behavior, not a second application to maintain.

## Phase 1

Implement independent LRC parsing and time lookup, integrate into the existing lyrics view, preserve stored lyrics and manual editing, and support local LRC association. Support fractions, repeated timestamps, offsets, timed blank lines and enhanced word timing.

Confirmed: full scrolling lyrics view and single-song LRC import first. After initial browser acceptance with the user's audio/LRC pair, same-name pairing during song import was added to reduce manual steps.

## Validation

Parser tests cover timestamp boundaries, seeking backwards, metadata/offset ordering, repeated lines and words, blank interludes, plain text and malformed input. Browser checks cover playback/pause/seek, song changes while lyrics are open, refresh persistence, English/Persian switching, and offline module availability.

No microphone scoring, vocal separation, CDG integration or cloud authorization is included in phase 1.

## Current implementation status

Implemented parser, scrolling line/word highlighting, single-song LRC import,
raw-text local persistence, track-change refresh, paused seeking and lossless
raw LRC preservation in .lmp packages. App-shell cache includes the parser.

17 automated parser, modal integration, same-name import and real ZIP roundtrip tests pass:

```
node --experimental-vm-modules --test tests/lrc.test.mjs tests/lmp-lyrics.test.mjs tests/lyrics-modal.test.mjs tests/import-lyrics.test.mjs
```

Browser automation had no available browser connection. Visual layout,
real audio timing, browser persistence and installed-PWA offline acceptance
remain to be verified with the user's media; automated modal tests use DOM
and database stubs and do not establish those browser behaviors.

The user reported the initial scrolling/synchronization experience met the
minimum requirement. Same-name import is implemented and unit-tested but
still needs browser acceptance. Select audio and LRC together using the
song picker or drag/drop. A browser cannot read an unselected sibling file.
Pairing ignores extension/case, normalizes Unicode, and respects relative
folder paths when supplied. Duplicate LRC matches are skipped with a warning;
failed lyrics reads leave the audio imported. Phone Music directory scanning
still imports audio only; directory sidecar discovery is not yet implemented.
