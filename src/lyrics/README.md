# Lyrics system

Each song has one original lyrics text, stored locally in IndexedDB as
`{ songId, text }`. `Lyrics.save(songId, text)` replaces that song's lyrics.
Any language and bilingual lines are supported. UI language affects labels
only; there are no lyrics language slots or fallbacks.

Use **Manage song resources** in Library to add or replace a lyrics file,
including for songs that are not playing. Cancelled or failed reads preserve
the previous resource. The player has no editor or resource import actions.

For automatic association, select an audio file and its same-name `.lrc`
together in **Import songs**, or drop both. Matching normalizes Unicode and
case and respects relative folders. Unselected neighboring files cannot be read.

The unified player displays lyrics directly. Plain text is static; LRC
supports line and word timing, repeated timestamps, offsets and blank
interlude markers. Synchronization uses only `audio.currentTime`.

See `example.json` for the stored record shape. `.lmp` v2 uses
`{ id, text }` in `lyrics/<id>.json`; JSON v2 backups use `{ songId, text }`.
Original tags, BOM, line endings and whitespace are preserved. Legacy
language records are not converted or migrated; the library is not cleared.

Parser checks: `node --test tests/lrc.test.mjs`. Full commands: `AGENTS.md`.
