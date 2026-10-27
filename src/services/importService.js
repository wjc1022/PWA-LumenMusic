/**
 * services/importService.js
 * ---------------------------------------------------------------
 * Turns a FileList of user-selected audio files into song records:
 * reads ID3 metadata, generates a placeholder cover when needed,
 * and writes everything into IndexedDB via database/db.js.
 * ---------------------------------------------------------------
 */

import { Songs } from "../database/db.js";
import { extractMetadata, blobToDataUrl } from "./metadataService.js";
import { generatePlaceholderCover } from "./coverService.js";
import { generateId } from "../utils/id.js";

const ACCEPTED_TYPE_PREFIX = "audio";

export function isAudioFile(file) {
  return !isVideoFile(file) && !/\.lrc$/i.test(file.name) && (file.type.startsWith(ACCEPTED_TYPE_PREFIX) || /\.(mp3|m4a|wav|ogg|flac|aac|aif|aiff|caf)$/i.test(file.name));
}

export function isVideoFile(file) { return file.type?.startsWith("video/") || /\.(mp4|m4v|mov|webm|ogv|mkv|avi)$/i.test(file.name); }
export function isMediaFile(file) { return isVideoFile(file) || isAudioFile(file); }
// Safari may preload metadata without decoding a frame. Import must not
// require autoplay; actual codec support is also checked when playback starts.
export function readVideo(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      const duration = video.duration;
      clearTimeout(timer);
      video.onloadedmetadata = video.onloadeddata = video.onerror = null;
      video.removeAttribute("src");
      try { video.load(); } finally { URL.revokeObjectURL(url); }
      if (error) reject(error);
      else resolve({ title: file.name.replace(/\.[^/.]+$/, ""), artist: "", album: "", duration, cover: null });
    };
    const failure = code => Object.assign(new Error(code), { importCode: code });
    const timer = setTimeout(() => finish(failure("videoTimeout")), 15000);
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => finish();
    video.onloadeddata = () => finish();
    video.onerror = () => finish(failure(video.error?.code === 4 ? "videoUnsupported" : "videoReadFailed"));
    video.src = url;
  });
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
  return Songs.replaceResource(song.id, 'instrumentalBlob', file, {instrumentalMimeType:file.type || 'audio/mpeg'});
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
  const files = selected.filter(isMediaFile);
  const lyricsFiles = new Map();
  for (const file of selected.filter(file => /\.lrc$/i.test(file.name))) {
    const key = pairingKey(file);
    lyricsFiles.set(key, [...(lyricsFiles.get(key) || []), file]);
  }
  const imported = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i + 1, files.length, file.name);

    let stage = "read";
    try {
      // extractMetadata has its own internal timeout for duration
      // reading, but this outer timeout is a second safety net: no
      // single problematic file (of any kind) should ever be able to
      // freeze the rest of a multi-file import.
      const meta = isVideoFile(file) ? await readVideo(file) : await withTimeout(
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
        mediaType: isVideoFile(file) ? "video" : "audio",
        audioBlob: file,
        mimeType: file.type || (isVideoFile(file) ? ({webm:"video/webm",mov:"video/quicktime",ogv:"video/ogg"})[file.name.split(".").pop().toLowerCase()] || "video/mp4" : "audio/mpeg"),
        favorite: false,
        playCount: 0,
        dateAdded: Date.now(),
        // name+size fingerprint — not a content hash, but enough to
        // avoid re-importing the same file twice from Phone Music
        // without reading every byte of every candidate file.
        sourceFingerprint: `${file.name}:${file.size}`,
      };

      stage = "storage";
      let lyricText;
      const matches = lyricsFiles.get(pairingKey(file)) || [];
      if (matches.length > 1) {
        options.onLyricsWarning?.(file.name);
      } else if (matches.length === 1) {
        try {
          const text = await withTimeout(matches[0].text(), 10000, null);
          if (text === null) throw new Error("LRC read timed out");
          lyricText = text;
        } catch (error) {
          // A failed sidecar must not discard an otherwise playable song.
          console.warn(`Could not import lyrics for "${file.name}"`, error);
          options.onLyricsWarning?.(file.name);
        }
      }
      await Songs.add(song, lyricText);
      imported.push(song);
      if(lyricText !== undefined) options.onLyricsImported?.(song);
    } catch (err) {
      const code = err.importCode || (stage === "storage"
        ? (err.name === "QuotaExceededError" ? "storageFull" : "storageFailed") : "fileReadFailed");
      options.onError?.({ fileName: file.name, code, errorName: err.name });
      // One unreadable file (e.g. a DRM-protected or corrupt track)
      // shouldn't abort the rest of the batch — skip it and continue.
      console.warn(`Skipped "${file.name}" — couldn't be imported:`, err);
    }
  }

  return imported;
}
