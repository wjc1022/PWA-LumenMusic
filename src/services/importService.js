/**
 * services/importService.js
 * ---------------------------------------------------------------
 * Turns a FileList of user-selected audio files into song records:
 * reads ID3 metadata, generates a placeholder cover when needed,
 * and writes everything into IndexedDB via database/db.js.
 * ---------------------------------------------------------------
 */

import { Songs, Lyrics } from "../database/db.js";
import { extractMetadata, blobToDataUrl } from "./metadataService.js";
import { generatePlaceholderCover } from "./coverService.js";
import { generateId } from "../utils/id.js";

const ACCEPTED_TYPE_PREFIX = "audio";

export function isAudioFile(file) {
  return !/\.lrc$/i.test(file.name) && (file.type.startsWith(ACCEPTED_TYPE_PREFIX) || /\.(mp3|m4a|wav|ogg|flac|aac|aif|aiff|caf)$/i.test(file.name));
}

// Include the relative folder when supplied, so duplicate names in separate
// directories cannot accidentally acquire each other's lyrics.
function pairingKey(file) {
  return (file.webkitRelativePath || file.name).replace(/\\/g, "/")
    .replace(/\.[^/.]+$/, "").normalize("NFC").toLowerCase();
}

/**
 * Imports a list of File objects. Calls onProgress(current, total) as it
 * goes so the UI can show a spinner/counter. Returns the imported songs.
 */
export async function getExistingFingerprints() {
  const all = await Songs.all();
  return new Set(all.map((s) => s.sourceFingerprint).filter(Boolean));
}

/**
 * Attaches an instrumental version to an existing song. This is the
 * manual-import path for the vocal/instrumental switcher — the same
 * `song.instrumentalBlob` field this populates is exactly what a
 * future AI stem-separation feature would populate too, so the
 * player's switching logic (audioEngine.switchVariant) never needs
 * to change regardless of how the instrumental was obtained.
 */
export async function attachInstrumental(song, file) {
  if (!isAudioFile(file)) throw new Error("Invalid audio file");
  song = await Songs.get(song.id);
  if (!song) throw new Error("Song no longer exists");
  const updated = {
    ...song,
    instrumentalBlob: file,
    instrumentalMimeType: file.type || "audio/mpeg",
  };
  await Songs.update(updated);
  return updated;
}

async function withTimeout(promise, ms, fallback) {
  let timer;
  try { return await Promise.race([
    promise,
    new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
  ]); } finally { clearTimeout(timer); }
}

export async function importFiles(fileList, onProgress, options = {}) {
  const selected = Array.from(fileList);
  const files = selected.filter(isAudioFile);
  const lyricsFiles = new Map();
  for (const file of selected.filter(file => /\.lrc$/i.test(file.name))) {
    const key = pairingKey(file);
    lyricsFiles.set(key, [...(lyricsFiles.get(key) || []), file]);
  }
  const imported = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i + 1, files.length, file.name);

    try {
      // extractMetadata has its own internal timeout for duration
      // reading, but this outer timeout is a second safety net: no
      // single problematic file (of any kind) should ever be able to
      // freeze the rest of a multi-file import.
      const meta = await withTimeout(
        extractMetadata(file),
        10000,
        { title: file.name.replace(/\.[^/.]+$/, ""), artist: "Unknown Artist", album: "", genre: "", cover: null, duration: 0 }
      );
      const cover = meta.cover
        ? await blobToDataUrl(meta.cover)
        : generatePlaceholderCover(meta.title || file.name);

      const song = {
        id: generateId("song"),
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        genre: meta.genre || "",
        duration: meta.duration,
        cover,
        audioBlob: file,
        mimeType: file.type || "audio/mpeg",
        favorite: false,
        playCount: 0,
        dateAdded: Date.now(),
        // name+size fingerprint — not a content hash, but enough to
        // avoid re-importing the same file twice from Phone Music
        // without reading every byte of every candidate file.
        sourceFingerprint: `${file.name}:${file.size}`,
      };

      await Songs.add(song);
      imported.push(song);
      const matches = lyricsFiles.get(pairingKey(file)) || [];
      if (matches.length > 1) {
        options.onLyricsWarning?.(file.name);
      } else if (matches.length === 1) {
        try {
          const text = await withTimeout(matches[0].text(), 10000, null);
          if (text === null) throw new Error("LRC read timed out");
          const lang = options.lyricsLanguage === "fa" ? "fa" : "en";
          await Lyrics.save(song.id, { en: "", fa: "", [lang]: text });
          options.onLyricsImported?.(song);
        } catch (error) {
          // A failed sidecar must not discard an otherwise playable song.
          console.warn(`Could not import lyrics for "${file.name}"`, error);
          options.onLyricsWarning?.(file.name);
        }
      }
    } catch (err) {
      // One unreadable file (e.g. a DRM-protected or corrupt track)
      // shouldn't abort the rest of the batch — skip it and continue.
      console.warn(`Skipped "${file.name}" — couldn't be imported:`, err);
    }
  }

  return imported;
}
