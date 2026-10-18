# Lyrics system

Lumen ships with **no bundled lyrics** — the lyrics system is entirely
user-driven and copyright-safe by construction. There is nothing to
configure here at build time; lyrics are added per-song, at runtime,
through the app itself, and stored in the `lyrics` object store in
IndexedDB (see `src/database/db.js`).

## How it works

1. Play any song, open the full player from the mini player, and choose
   **Lyrics**.
2. If nothing's been added yet, tap **Add lyrics** and paste in text you
   have the rights to use — your own writing, something in the public
   domain, or lyrics from a source that permits it.
3. Lumen stores separate English and Persian (فارسی) versions per song,
   switchable with the EN / FA tabs.

## Optional sync tags

Plain lines display as static text. To sync a line to a timestamp so it
highlights during playback, prefix it with `[m:ss]`:

```
[0:00] First line, highlights at the very start
[0:12] Second line, highlights at 12 seconds
This line has no tag, so it just displays without highlighting
```

## LRC files and synchronization

For automatic association, choose an audio file and its same-name `.lrc`
file together in **Import songs**, or drop both into the app. Multiple
pairs can be imported together. Matching ignores case and normalizes
Unicode filenames. The browser needs both files selected; it cannot read
unselected neighboring files. Automatic lyrics use the current interface
language's storage slot (EN or FA); the text itself may be in any language.
Manual per-song import below remains available for existing songs.

Open Lyrics from the full player, then choose **Import LRC file**. The file
is associated with the current song and selected EN/FA storage slot; text
in any language is supported. Import replaces that slot's previous lyrics.
Manual editing remains available. Lyrics are saved locally across reloads.

Supported timing includes `[00:12.500]`, repeated line timestamps,
`[offset:+200]` (positive means earlier), and enhanced word timing such as
`[00:12.500]<00:12.500>Hello <00:13.000>world`.
Timed empty lines mark instrumental breaks. Files without word timestamps
highlight by line only. A file without any timestamps remains static text.

Synchronization uses the audio playback position, including paused seeking
and track changes. This phase retains the scrolling lyrics view.

The parser tests run with `node --test tests/lrc.test.mjs`.

## Stored record

Each song's lyrics are stored as:

```json
{
  "songId": "song_...",
  "en": "[0:00] Hello\n[0:04] World",
  "fa": "[0:00] سلام\n[0:04] دنیا"
}
```

`example.json` in this folder shows the shape for reference — it is a
template, not real lyrics for any real song.
