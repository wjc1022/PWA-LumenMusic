# LRC design

## Parser contract

`src/lyrics/lrc.mjs` exports:

- `parseLrc(text)`: `{ lines, metadata, offsetMs }`.
- Each line: `{ time: number | null, text: string, words?: [{ time, text }] }`. Times are seconds, words preserve spaces.
- `findActiveLine(lines, seconds)`: last timed line at or before the playback time, or -1.
- `findActiveWord(words, seconds)`: last word at or before the playback time, or -1.

Support BOM/CRLF, arbitrary minute digits, valid seconds, 1–3 fractional digits, repeated line timestamps, metadata and enhanced word tags. Positive LRC offset shifts timestamps earlier, applied after parsing regardless of tag position. Repeated enhanced lines shift their word times by the repeat delta. Preserve timed blank lines for interludes and plain untimed text for compatibility. Timed entries sort stably, with untimed entries after them in mixed documents.

## Storage and integration

Retain raw lyrics text in the existing `lyrics` store, keyed by songId, with en/fa slots. Parse at display time. This avoids a database migration and preserves original timing and tags. Language slots are existing storage choices, not a restriction on the script used in imported lyrics.

Use audioEl.currentTime on open, playback, pause and seek. A requestAnimationFrame loop may improve word timing while the view is open and audio is playing; it must stop when closed, editing or paused. Never derive timing from frame count. Refresh lyrics on trackchange and protect asynchronous loads against stale song/language results.

The .lmp lyrics JSON now contains optional `rawLrc: { en, fa }` alongside its existing `languages` line arrays. New imports prefer rawLrc to retain word tags, offsets, whitespace and fractions exactly. Older consumers still read the line arrays (line timing only). Legacy line-array imports retain milliseconds. JSON backups already retain raw lyrics.
