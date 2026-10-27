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
let stalledSource = false;
let progressTime = 0, progressAt = Date.now();
function resetProgressWatch() {
  progressTime = audioEl.currentTime;
  progressAt = Date.now();
}

// Shared transport intent and lifecycle policy, independent of player UI.
let wantsPlayback = false, loadingSelection = false, internalPause = false;
let lifecycleRevision = 0, pageAway = false;
let wakeSentinel = null, wakePending = null, wakeRevision = 0;
let retrySystemRelease = false;
let wakeStatus = 'idle', wakeError = '', wakeWarned = false;
const foreground = () => !pageAway && !globalThis.document?.hidden;
function wakeNotice() {
  if (!wakeWarned) { wakeWarned = true; emit('playbacknotice', 'player.wakeUnavailable'); }
}
function releaseWake() {
  ++wakeRevision;
  retrySystemRelease = false;
  const held = wakeSentinel; wakeSentinel = null; wakeStatus = 'idle';
  if (held) Promise.resolve(held.release()).catch(() => {});
}
function requestWake() {
  if (!wantsPlayback || !foreground() || wakeSentinel || wakePending) return;
  if (!globalThis.navigator?.wakeLock?.request) { wakeStatus = 'unsupported'; wakeNotice(); return; }
  const revision = wakeRevision;
  wakeStatus = 'requesting';
  wakePending = Promise.resolve().then(() => {
    if (revision !== wakeRevision || !wantsPlayback || !foreground()) return null;
    return navigator.wakeLock.request('screen');
  }).then(lock => {
    if (!lock) return;
    if (revision !== wakeRevision || !wantsPlayback || !foreground())
      return Promise.resolve(lock.release()).catch(() => {});
    wakeSentinel = lock; wakeStatus = 'held'; wakeError = '';
    lock.addEventListener('release', () => {
      if (wakeSentinel !== lock) return;
      wakeSentinel = null; wakeStatus = 'released';
      if (foreground() && wantsPlayback) {
        if (wakePending) retrySystemRelease = true;
        else requestWake();
      }
    });
    if (lock.released) { wakeSentinel = null; wakeStatus = 'released'; wakeNotice(); }
  }).catch(error => {
    if (revision !== wakeRevision || !wantsPlayback || !foreground()) return;
    wakeStatus = 'failed'; wakeError = String(error?.name || 'Error').slice(0, 80); wakeNotice();
  }).finally(() => {
    wakePending = null;
    const retry = retrySystemRelease || revision !== wakeRevision;
    retrySystemRelease = false;
    if (retry && wantsPlayback && foreground()) requestWake();
  });
}
export function getPlaybackDiagnostics() {
  return { output: 'media-element', foreground: foreground(), wantsPlayback,
    media: { paused: audioEl.paused, ended: !!audioEl.ended, currentTime: audioEl.currentTime,
      muted: audioEl.muted, volume: audioEl.volume, readyState: audioEl.readyState },
    wakeLock: { supported: !!globalThis.navigator?.wakeLock?.request, status: wakeStatus,
      held: !!wakeSentinel, pending: !!wakePending, error: wakeError } };
}
export function pausePlayback() {
  wantsPlayback = false; loadingSelection = false; ++lifecycleRevision;
  if (pendingRestore) pendingRestore.wantsPlaying = false;
  releaseWake(); audioEl.pause(); emit('playstate', false);
}
function backgroundPlayback() { pageAway = true; pausePlayback(); }
globalThis.document?.addEventListener('visibilitychange', () => {
  if (document.hidden) backgroundPlayback(); else pageAway = false;
});
globalThis.addEventListener?.('pagehide', backgroundPlayback);
globalThis.addEventListener?.('pageshow', () => { pageAway = !!globalThis.document?.hidden; });
async function playMedia() {
  if (!foreground()) return;
  wantsPlayback = true;
  const revision = lifecycleRevision;
  const source = sourceRevision;
  requestWake();
  try {
    await audioEl.play();
    if (!foreground() || !wantsPlayback) audioEl.pause();
  } catch (error) {
    if (revision !== lifecycleRevision || source !== sourceRevision) return;
    wantsPlayback = false; releaseWake(); throw error;
  }
}

// Bounded best-effort diagnostics; never store source URLs or media contents.
const FAILURE_KEY = 'lumen.lastMediaFailure';
const safe = value => String(value ?? '').replace(/blob:[^\s]+|file:[^\s]+|[A-Za-z]:[\\/][^\s]+|\/(?:private|var|Users|home|Volumes|storage)\/[^\s]+/g, '[redacted]').slice(0, 600);
let lastFailure = null;
export function getLastMediaFailure() {
 if(lastFailure) return lastFailure;
 try {const raw=localStorage.getItem(FAILURE_KEY);if(raw?.length<6000) lastFailure=JSON.parse(raw);} catch {}
 return lastFailure;
}
export function clearMediaFailure() {lastFailure=null;try{localStorage.removeItem(FAILURE_KEY);}catch{}}
function recordFailure(stage,error,source=activeSource) {
 try {
 const blob=source?.blob;
 lastFailure={time:new Date().toISOString(),songId:safe(source?.songId),variant:source?.variant,stage,
 exception:{name:safe(error?.name),message:safe(error?.message)},
 mediaError:{code:audioEl.error?.code??null,message:safe(audioEl.error?.message)},
 readyState:audioEl.readyState??null,networkState:audioEl.networkState??null,
 currentTime:audioEl.currentTime,duration:Number.isFinite(audioEl.duration)?audioEl.duration:null,
 paused:audioEl.paused,seeking:!!audioEl.seeking,
 buffered:Array.from({length:Math.min(audioEl.buffered?.length||0,8)},(_,i)=>[audioEl.buffered.start(i),audioEl.buffered.end(i)]),
 blob:{exists:!!blob,size:typeof blob?.size==='number'?blob.size:null,mime:safe(blob?.type)}};
 try{localStorage.setItem(FAILURE_KEY,JSON.stringify(lastFailure));}catch{}
 }catch{}
}

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
    const replaced = currentSong.instrumentalMediaId !== updatedSong.instrumentalMediaId || ('instrumentalBlob' in updatedSong && currentSong.instrumentalBlob !== updatedSong.instrumentalBlob);
    currentSong = {...currentSong,...updatedSong};
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
  stalledSource = false;
  resetProgressWatch();
  internalPause = true;
  audioEl.pause();
  internalPause = false;
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
  if (!foreground()) return;
  const lifecycle = lifecycleRevision;
  const request = ++selectionRevision;
  loadingSelection = true; wantsPlayback = true; requestWake();
  if (Songs.withMedia) {
    try { song = await Songs.withMedia(song.id); }
    catch {
      if (request === selectionRevision) { pausePlayback(); emit('playbackerror', 'player.mediaFailed'); }
      return;
    }
    if (request !== selectionRevision) return;
    // A newer foreground play intent must not be interrupted by this old read.
    if (lifecycle !== lifecycleRevision && wantsPlayback) return;
    if (!song) { pausePlayback(); return; }
  }
  pendingRestore = null;
  if (newQueue) setQueue(newQueue);
  const idxInQueue = queue.findIndex((s) => s.id === song.id);
  position = shuffleEnabled ? (shuffleOrder?.indexOf(idxInQueue) ?? 0) : idxInQueue;
  currentSong = song;
  currentVariant = "vocals";

  activeSource = sourceFor(song, currentVariant);
  try { loadSongIntoElement(activeSource); } catch (error) {
    recordFailure("select-source", error);
    audioEl.removeAttribute("src");
    emit("trackchange", currentSong);
    pausePlayback();
    emit("playbackerror", "player.mediaFailed");
    return;
  }
  emit("trackchange", currentSong);
  emit("variantchange", currentVariant);
  if (selected) emit("songselected", currentSong);
  try {
    if (lifecycle === lifecycleRevision && foreground() && wantsPlayback) await playMedia();
  } catch (error) {
    recordFailure("select-play", error, sourceFor(song, "vocals"));
    if (request === selectionRevision) emit("playbackerror", "player.mediaFailed");
  }

  if (request !== selectionRevision) return;
  loadingSelection = false;
  const updated = await Songs.incrementPlayCount(song.id);
  if (updated && request === selectionRevision && currentSong?.id === song.id) currentSong = {...currentSong,...updated};
  if (request === selectionRevision) await Recents.record(song.id);
}

export function togglePlay() {
  if (!foreground()) return;
  if (loadingSelection) { pausePlayback(); return; }
  if (pendingRestore) {
    // load() pauses the element internally; transport controls reflect the
    // user's intent instead of mistaking that internal pause for a user action.
    pendingRestore.wantsPlaying = !pendingRestore.wantsPlaying;
    wantsPlayback = pendingRestore.wantsPlaying;
    if (!pendingRestore.wantsPlaying) pausePlayback();
    else requestWake();
    if (pendingRestore.wantsPlaying && pendingRestore.phase === "ready") playMedia().catch(error => recordFailure("resume-play", error));
    emit("playstate", pendingRestore.wantsPlaying);
    return;
  }
  if (!currentSong) {
    if (queue.length) playSong(queue[0], queue);
    return;
  }
  if (audioEl.paused && stalledSource) {
    // Only an explicit user resume retries a stalled source. Reuse the bounded
    // restore path so seeking, cancellation and track changes remain safe.
    void switchVariant(currentVariant, true);
  }
  else if (audioEl.paused) playMedia().catch(error => {
    recordFailure("resume-play", error);
    emit("playbackerror", "player.mediaFailed");
  });
  else pausePlayback();
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
function waitForSource(source) {
  return new Promise(resolve => {
    const cleanup = () => {
      audioEl.removeEventListener("loadedmetadata", loaded);
      audioEl.removeEventListener("error", failed);
      clearTimeout(timer);
      if (cancelSourceWait === cancelled) cancelSourceWait = null;
    };
    const finish = reason => { cleanup(); resolve(reason); };
    const loaded = () => finish(null);
    const failed = error => { recordFailure("variant-metadata", error, source); finish("load-error"); };
    const cancelled = () => finish("superseded");
    const timer = setTimeout(() => { recordFailure("metadata-timeout", null, source); finish("timeout"); }, 15000);
    cancelSourceWait = cancelled;
    audioEl.addEventListener("loadedmetadata", loaded);
    audioEl.addEventListener("error", failed);
    try { audioEl.load(); } catch (error) { failed(error); }
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
    const failed = error => { recordFailure("variant-play", error, operation.diagnosticSource); finish("play-error"); };
    const cancelled = () => finish("superseded");
    const paused = () => { if (!operation.wantsPlaying) finish(null); };
    const timer = setTimeout(() => { recordFailure("play-timeout", null, operation.diagnosticSource); finish("timeout"); }, 15000);
    cancelSourceWait = cancelled;
    audioEl.addEventListener("error", failed);
    audioEl.addEventListener("pause", paused);
    try { Promise.resolve(playMedia()).then(() => finish(null), failed); }
    catch (error) { failed(error); }
  });
}

export function getVariantStatus() {
  return { pending: !!pendingRestore, target: pendingRestore?.targetVariant || currentVariant };
}

export async function switchVariant(variant, reload = false) {
  if (!currentSong) return { ok: false, reason: "no-song" };
  if (currentSong.mediaType === "video" && !(reload && variant === "vocals")) return { ok: false, reason: "unavailable" };
  if (variant === "instrumental" && !currentSong.instrumentalBlob) return { ok: false, reason: "unavailable" };
  const target = sourceFor(currentSong, variant);
  if (!pendingRestore && activeSource && variant === currentVariant && !reload
      && activeSource.blob === target.blob && activeSource.src === target.src) return { ok: true };

  const previous = pendingRestore;
  const operation = {
    songId: currentSong.id, targetVariant: variant, phase: "loading",
    baseline: previous?.baseline || { source: activeSource, variant: currentVariant, time: audioEl.currentTime },
    wantsPlaying: foreground() && (previous ? previous.wantsPlaying : (reload && stalledSource) || !audioEl.paused),
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
      operation.diagnosticSource = source;
      return await waitForSource(source);
    } catch (error) { recordFailure("variant-source", error, source); request = sourceRevision; return "load-error"; }
  }
  async function restoreTransport() {
    try {
      const time = operation.seekRatio === null ? operation.time : operation.seekRatio * audioEl.duration;
      audioEl.currentTime = Number.isFinite(audioEl.duration) ? Math.min(time, audioEl.duration) : time;
      operation.phase = "ready";
      if (!foreground()) operation.wantsPlaying = false;
      if (operation.wantsPlaying) {
        const failure = await waitForPlayback(operation);
        if (failure && ownsSource() && operation.wantsPlaying) return false;
      }
      if (!ownsSource()) return false;
      if (!operation.wantsPlaying) audioEl.pause();
      return true;
    } catch (error) { recordFailure("restore-transport", error, operation.diagnosticSource); return false; }
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
  pausePlayback();
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
  return song?.mediaType !== "video" && !!(song?.instrumentalMediaId || song?.instrumentalBlob);
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
  if (currentSong && currentSong.id === song.id) currentSong = {...currentSong,...updated};
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

audioEl.onerror = () => recordFailure("media-event", null, pendingRestore?.diagnosticSource || activeSource);

audioEl.addEventListener("loadedmetadata", () => {
  if (pendingSeek !== null) seekTo(pendingSeek);
});

// A resolved play() and readyState=4 do not prove that decoding is advancing.
// Observe the media clock independently of timeupdate/error events. Paused,
// hidden and source-restoration time must not count towards a stall.
setInterval(() => {
  if (!currentSong || !activeSource || pendingRestore || audioEl.paused || audioEl.ended
      || (typeof document !== "undefined" && document.hidden)) {
    resetProgressWatch();
    return;
  }
  if (audioEl.currentTime !== progressTime) { resetProgressWatch(); return; }
  if (Date.now() - progressAt < 15000) return;
  recordFailure("playback-stalled", { name: "PlaybackStalled", message: "Media clock did not advance for 15 seconds" });
  stalledSource = true;
  pausePlayback();
  emit("playbackerror", "player.mediaFailed");
}, 1000);
for (const event of ["play", "pause", "seeking", "seeked", "loadedmetadata"])
  audioEl.addEventListener(event, resetProgressWatch);

audioEl.addEventListener("ratechange", () => { if (audioEl.playbackRate !== 1) audioEl.playbackRate = 1; });
audioEl.addEventListener("play", () => {
  if (!foreground() || !wantsPlayback) { audioEl.pause(); return; }
  emit("playstate", pendingRestore?.wantsPlaying ?? true);
});
audioEl.addEventListener("pause", () => {
  if (!internalPause && pendingRestore?.phase === 'ready' && pendingRestore.wantsPlaying && audioEl.paused) {
    pausePlayback();
    return;
  }
  if (!internalPause && !pendingRestore && !loadingSelection && audioEl.paused && !audioEl.ended) {
    wantsPlayback = false; releaseWake();
  }
  emit("playstate", pendingRestore?.wantsPlaying ?? false);
});
audioEl.addEventListener("ended", () => {
  if (!foreground() || !wantsPlayback) { pausePlayback(); return; }
  if (repeatMode === "one") {
    audioEl.currentTime = 0;
    playMedia().catch(error => recordFailure("resume-play", error));
    return;
  }
  if (repeatMode === "off" && position >= queue.length - 1) {
    pausePlayback();
    // last song in the queue and not repeating — stop instead of
    // silently wrapping back to the first song.
    return;
  }
  playNext();
});
audioEl.addEventListener("timeupdate", () => emit("timeupdate", audioEl.currentTime, audioEl.duration));

globalThis.addEventListener?.('lumen-data-reset', () => {
  pausePlayback();
  selectionRevision++;
  cancelSourceWait?.();
  pendingRestore = null;
  pendingSeek = null;
  activeSource = null;
  queue = [];
  position = 0;
  currentSong = null;
  lastFailure = null;
  audioEl.pause();
  audioEl.removeAttribute('src');
  audioEl.load();
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = null;
  emit('queuechange', queue);
  emit('trackchange', null);
});
