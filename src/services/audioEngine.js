/**
 * services/audioEngine.js
 * ---------------------------------------------------------------
 * Owns the single <audio> element and all playback state: current
 * queue, current song, shuffle order, repeat mode,
 * and play-count / recently-played bookkeeping. UI modules subscribe
 * via `on(event, cb)` instead of touching <audio> directly.
 *
 * Events emitted:
 *   trackchange  -> (song)
 *   playstate    -> (isPlaying)
 *   timeupdate   -> (currentTime, duration)
 *   favorite     -> (song)
 *   queuechange  -> (queue)
 *   repeatchange -> (mode)
 *   variantchange -> (variant)
 *   playbackerror -> (translation key)
 * ---------------------------------------------------------------
 */

import { Songs, Recents, Settings } from "../database/db.js";

const bus = new EventTarget();
export function on(event, cb) {
  const handler = (e) => cb(...(e.detail || []));
  bus.addEventListener(event, handler);
  return () => bus.removeEventListener(event, handler);
}
function emit(event, ...args) {
  bus.dispatchEvent(new CustomEvent(event, { detail: args }));
}

export const audioEl = typeof document === "undefined" ? new Audio() : document.createElement("video");
audioEl.playsInline = true;
audioEl.className = "player-video";
audioEl.preload = "metadata";
audioEl.defaultPlaybackRate = 1;
audioEl.playbackRate = 1;

let queue = [];
let shuffleOrder = null; // array of indices when shuffle is on
let shuffleEnabled = false;
let position = -1; // index into shuffleOrder (if shuffling) or queue
let currentSong = null;
let currentObjectUrl = null;
let sourceRevision = 0;
let cancelSourceWait = null;
let pendingRestore = null;
let pendingSeek = null;
let activeSource = null;
let selectionRevision = 0;
let currentVariant = "vocals"; // "vocals" | "instrumental"

export const REPEAT_MODES = ["off", "all", "one"];
let repeatMode = "off";

const REPEAT_SETTINGS_KEY = "repeatMode";

/** Old speed settings may remain in backups, but no longer affect playback. */
export async function restorePlaybackPreferences() {
  audioEl.defaultPlaybackRate = 1;
  audioEl.playbackRate = 1;
  const savedRepeat = await Settings.get(REPEAT_SETTINGS_KEY, "off");
  if (REPEAT_MODES.includes(savedRepeat)) repeatMode = savedRepeat;

}

export function getRepeatMode() {
  return repeatMode;
}

export async function cycleRepeatMode() {
  const idx = REPEAT_MODES.indexOf(repeatMode);
  repeatMode = REPEAT_MODES[(idx + 1) % REPEAT_MODES.length];
  await Settings.set(REPEAT_SETTINGS_KEY, repeatMode);
  emit("repeatchange", repeatMode);
  return repeatMode;
}

function effectiveIndexToQueueIndex(idx) {
  return shuffleEnabled && shuffleOrder ? shuffleOrder[idx] : idx;
}

function buildShuffleOrder() {
  const idxs = queue.map((_, i) => i);
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }
  shuffleOrder = idxs;
}

export function setShuffle(enabled) {
  shuffleEnabled = enabled;
  if (enabled) {
    buildShuffleOrder();
    // keep the currently playing song as the "first" shuffled position
    if (currentSong) {
      const queueIdx = queue.findIndex((s) => s.id === currentSong.id);
      const posInShuffle = shuffleOrder.indexOf(queueIdx);
      if (posInShuffle > -1) {
        [shuffleOrder[0], shuffleOrder[posInShuffle]] = [shuffleOrder[posInShuffle], shuffleOrder[0]];
        position = 0;
      }
    }
  }
}

export function isShuffleOn() {
  return shuffleEnabled;
}

export function getCurrentSong() {
  return currentSong;
}

/**
 * Lets external code (e.g. after attaching an instrumental version)
 * refresh the engine's view of the current song without a full
 * playSong() call. Emits trackchange so subscribed UI re-renders.
 */
export function refreshCurrentSong(updatedSong) {
  queue = queue.map(song => song.id === updatedSong?.id ? updatedSong : song);
  if (currentSong && updatedSong && currentSong.id === updatedSong.id) {
    const replaced = currentSong.instrumentalBlob !== updatedSong.instrumentalBlob;
    currentSong = updatedSong;
    if (replaced && currentVariant === "instrumental") void switchVariant("instrumental", true);
    emit("trackchange", currentSong);
  }
}

export function getCurrentVariant() {
  return currentVariant;
}

export function getQueue() {
  return queue;
}

export function getQueuePosition() {
  return position;
}

export function setQueue(newQueue) {
  queue = newQueue;
  if (shuffleEnabled) buildShuffleOrder();
  emit("queuechange", queue);
}

function sourceFor(song, variant) {
  return {
    songId: song.id, variant,
    blob: variant === "instrumental" ? song.instrumentalBlob : song.audioBlob,
    src: variant === "vocals" ? song.audioSrc : null,
  };
}

function loadSongIntoElement(source) {
  audioEl.pause();
  pendingSeek = null;
  sourceRevision++;
  cancelSourceWait?.();
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  if (source.blob) {
    currentObjectUrl = URL.createObjectURL(source.blob);
    audioEl.src = currentObjectUrl;
  } else if (source.src) audioEl.src = source.src;
  else throw new Error("No audio source");
  audioEl.defaultPlaybackRate = 1;
  audioEl.playbackRate = 1;
}

export function selectSong(song, newQueue) {
  return playSong(song, newQueue, true);
}

export async function playSong(song, newQueue, selected = false) {
  const request = ++selectionRevision;
  pendingRestore = null;
  if (newQueue) setQueue(newQueue);
  const idxInQueue = queue.findIndex((s) => s.id === song.id);
  position = shuffleEnabled ? (shuffleOrder?.indexOf(idxInQueue) ?? 0) : idxInQueue;
  currentSong = song;
  currentVariant = "vocals";

  activeSource = sourceFor(song, currentVariant);
  try { loadSongIntoElement(activeSource); } catch {
    audioEl.removeAttribute("src");
    emit("trackchange", currentSong);
    emit("playbackerror", "player.mediaFailed");
    return;
  }
  emit("trackchange", currentSong);
  emit("variantchange", currentVariant);
  if (selected) emit("songselected", currentSong);
  try {
    await audioEl.play();
  } catch {
    if (request === selectionRevision) emit("playbackerror", "player.mediaFailed");
  }

  if (request !== selectionRevision) return;
  const updated = await Songs.incrementPlayCount(song.id);
  if (updated && request === selectionRevision && currentSong?.id === song.id) currentSong = updated;
  if (request === selectionRevision) await Recents.record(song.id);
}

export function togglePlay() {
  if (pendingRestore) {
    // load() pauses the element internally; transport controls reflect the
    // user's intent instead of mistaking that internal pause for a user action.
    pendingRestore.wantsPlaying = !pendingRestore.wantsPlaying;
    if (!pendingRestore.wantsPlaying) audioEl.pause();
    else if (pendingRestore.phase === "ready") audioEl.play().catch(() => {});
    emit("playstate", pendingRestore.wantsPlaying);
    return;
  }
  if (!currentSong) {
    if (queue.length) playSong(queue[0], queue);
    return;
  }
  if (audioEl.paused) audioEl.play().catch(() => {});
  else audioEl.pause();
}

function playSongDirect(song) {
  return playSong(song);
}

/**
 * Switches between the original recording and an instrumental version,
 * if one is attached to the current song (`song.instrumentalBlob`).
 * Preserves playback position and play/pause state across the switch.
 *
 * This is the extension point for future AI stem separation: a future
 * service would only need to populate `song.instrumentalBlob` (e.g. on
 * demand, or ahead of time) — this switching logic doesn't change.
 */
// Each attempt owns one bounded metadata wait. Cancellation is distinct from
// failure, so a superseded attempt never restores over a later user action.
function waitForSource() {
  return new Promise(resolve => {
    const cleanup = () => {
      audioEl.removeEventListener("loadedmetadata", loaded);
      audioEl.removeEventListener("error", failed);
      clearTimeout(timer);
      if (cancelSourceWait === cancelled) cancelSourceWait = null;
    };
    const finish = reason => { cleanup(); resolve(reason); };
    const loaded = () => finish(null);
    const failed = () => finish("load-error");
    const cancelled = () => finish("superseded");
    const timer = setTimeout(() => finish("timeout"), 15000);
    cancelSourceWait = cancelled;
    audioEl.addEventListener("loadedmetadata", loaded);
    audioEl.addEventListener("error", failed);
    try { audioEl.load(); } catch { failed(); }
  });
}

function waitForPlayback(operation) {
  return new Promise(resolve => {
    const cleanup = () => {
      clearTimeout(timer);
      audioEl.removeEventListener("error", failed);
      audioEl.removeEventListener("pause", paused);
      if (cancelSourceWait === cancelled) cancelSourceWait = null;
    };
    const finish = reason => { cleanup(); resolve(reason); };
    const failed = () => finish("play-error");
    const cancelled = () => finish("superseded");
    const paused = () => { if (!operation.wantsPlaying) finish(null); };
    const timer = setTimeout(() => finish("timeout"), 15000);
    cancelSourceWait = cancelled;
    audioEl.addEventListener("error", failed);
    audioEl.addEventListener("pause", paused);
    try { Promise.resolve(audioEl.play()).then(() => finish(null), failed); }
    catch { failed(); }
  });
}

export function getVariantStatus() {
  return { pending: !!pendingRestore, target: pendingRestore?.targetVariant || currentVariant };
}

export async function switchVariant(variant, reload = false) {
  if (!currentSong) return { ok: false, reason: "no-song" };
  if (currentSong.mediaType === "video") return { ok: false, reason: "unavailable" };
  if (variant === "instrumental" && !currentSong.instrumentalBlob) return { ok: false, reason: "unavailable" };
  const target = sourceFor(currentSong, variant);
  if (!pendingRestore && activeSource && variant === currentVariant && !reload
      && activeSource.blob === target.blob && activeSource.src === target.src) return { ok: true };

  const previous = pendingRestore;
  const operation = {
    songId: currentSong.id, targetVariant: variant, phase: "loading",
    baseline: previous?.baseline || { source: activeSource, variant: currentVariant, time: audioEl.currentTime },
    wantsPlaying: previous ? previous.wantsPlaying : !audioEl.paused,
    time: previous ? previous.time : audioEl.currentTime,
    duration: previous?.duration || audioEl.duration,
    seekRatio: previous?.seekRatio ?? pendingSeek,
  };
  pendingRestore = operation;
  let request;
  const ownsSource = () => pendingRestore === operation && currentSong?.id === operation.songId && sourceRevision === request;
  async function load(source) {
    operation.phase = "loading";
    try {
      loadSongIntoElement(source);
      request = sourceRevision;
      return await waitForSource();
    } catch { request = sourceRevision; return "load-error"; }
  }
  async function restoreTransport() {
    try {
      const time = operation.seekRatio === null ? operation.time : operation.seekRatio * audioEl.duration;
      audioEl.currentTime = Number.isFinite(audioEl.duration) ? Math.min(time, audioEl.duration) : time;
      operation.phase = "ready";
      if (operation.wantsPlaying) {
        const failure = await waitForPlayback(operation);
        if (failure && ownsSource() && operation.wantsPlaying) return false;
      }
      if (!ownsSource()) return false;
      if (!operation.wantsPlaying) audioEl.pause();
      return true;
    } catch { return false; }
  }
  function complete(source, version) {
    activeSource = source;
    currentVariant = version;
    pendingRestore = null;
    emit("variantchange", currentVariant);
    emit("playstate", !audioEl.paused);
  }

  emit("variantchange", currentVariant);
  const failure = await load(target);
  if (!ownsSource()) return { ok: false, reason: "superseded" };
  if (!failure && await restoreTransport()) {
    if (!ownsSource()) return { ok: false, reason: "superseded" };
    complete(target, variant);
    return { ok: true };
  }
  if (!ownsSource()) return { ok: false, reason: "superseded" };

  // Restore the actual prior Blob/source, including an old instrumental Blob
  // replaced in the library. Do not look it up from the now-updated song.
  const baseline = operation.baseline;
  const rollbackFailure = baseline.source ? await load(baseline.source) : "no-source";
  if (!ownsSource()) return { ok: false, reason: "superseded" };
  if (!rollbackFailure && await restoreTransport()) {
    if (!ownsSource()) return { ok: false, reason: "superseded" };
    complete(baseline.source, baseline.variant);
    emit("playbackerror", "player.variantFailed");
    return { ok: false, reason: failure || "play-error", restored: true };
  }
  if (!ownsSource()) return { ok: false, reason: "superseded" };

  // One rollback attempt only. A broken original must not trigger a loop.
  pendingRestore = null;
  activeSource = null;
  currentVariant = baseline.variant;
  audioEl.pause();
  audioEl.removeAttribute("src");
  try { audioEl.load(); } catch { /* report the terminal failure below */ }
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = null;
  emit("variantchange", currentVariant);
  emit("playstate", false);
  emit("playbackerror", "player.variantRestoreFailed");
  return { ok: false, reason: "restore-failed", restored: false };
}

export function hasInstrumental(song = currentSong) {
  return song?.mediaType !== "video" && !!song?.instrumentalBlob;
}

export function playNext() {
  if (!queue.length) return;
  let nextPos = position + 1;
  if (nextPos >= queue.length) nextPos = 0;
  position = nextPos;
  const queueIdx = effectiveIndexToQueueIndex(position);
  const song = queue[queueIdx];
  if (song) playSongDirect(song);
}

export function playPrev() {
  if (!queue.length) return;
  let prevPos = position - 1;
  if (prevPos < 0) prevPos = queue.length - 1;
  position = prevPos;
  const queueIdx = effectiveIndexToQueueIndex(position);
  const song = queue[queueIdx];
  if (song) playSongDirect(song);
}

export async function toggleFavorite(song) {
  const updated = await Songs.setFavorite(song.id, !song.favorite);
  if (currentSong && currentSong.id === song.id) currentSong = updated;
  emit("favorite", updated);
  return updated;
}

export function seekTo(ratio) {
  if (!Number.isFinite(ratio)) return;
  ratio = Math.max(0, Math.min(1, ratio));
  const duration = Number.isFinite(audioEl.duration) && audioEl.duration > 0
    ? audioEl.duration : pendingRestore?.duration;
  if (pendingRestore) {
    pendingRestore.seekRatio = duration > 0 ? null : ratio;
    if (duration > 0) pendingRestore.time = ratio * duration;
    if (pendingRestore.phase === "loading") return;
  }
  // Keep the ratio until metadata exists; assigning currentTime before that
  // can throw or be discarded by the browser. New sources clear this intent.
  pendingSeek = ratio;
  if (Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
    try { audioEl.currentTime = ratio * audioEl.duration; pendingSeek = null; }
    catch { /* retry once metadata is available */ }
  }
}

audioEl.addEventListener("loadedmetadata", () => {
  if (pendingSeek !== null) seekTo(pendingSeek);
});

audioEl.addEventListener("ratechange", () => { if (audioEl.playbackRate !== 1) audioEl.playbackRate = 1; });
audioEl.addEventListener("play", () => emit("playstate", pendingRestore?.wantsPlaying ?? true));
audioEl.addEventListener("pause", () => emit("playstate", pendingRestore?.wantsPlaying ?? false));
audioEl.addEventListener("ended", () => {
  if (repeatMode === "one") {
    audioEl.currentTime = 0;
    audioEl.play().catch(() => {});
    return;
  }
  if (repeatMode === "off" && position >= queue.length - 1) {
    // last song in the queue and not repeating — stop instead of
    // silently wrapping back to the first song.
    return;
  }
  playNext();
});
audioEl.addEventListener("timeupdate", () => emit("timeupdate", audioEl.currentTime, audioEl.duration));
