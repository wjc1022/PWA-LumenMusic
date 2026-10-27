/**
 * components/playerSheet.js
 * ---------------------------------------------------------------
 * The bottom sheet opened by tapping the mini player. This is the
 * central playback controller: synchronized lyrics, full transport controls,
 * shuffle/repeat, favorite, seek with time labels,
 * vocal/instrumental switching, and queue.
 * ---------------------------------------------------------------
 */

import { $, el, clearNode } from "../utils/dom.js";
import { localizeTime } from "../utils/format.js";
import { t, getLang } from "../services/i18nService.js";
import { createSongRow } from "./songRow.js";
import { initPlayerLyrics } from "./playerLyrics.js";
import {
  audioEl, on, togglePlay, playNext, playPrev, toggleFavorite, seekTo,
  setShuffle, isShuffleOn, getCurrentSong, getRepeatMode, cycleRepeatMode,
  switchVariant, getCurrentVariant, getVariantStatus,
  hasInstrumental, getQueue, playSong,
} from "../services/audioEngine.js";



export function initPlayerSheet() {
  const lyrics = initPlayerLyrics();
  const modal = $("#playerSheetModal");
  const backdrop = $("#playerSheetBackdrop");
  const closeBtn = $("#playerSheetClose");
  const titleEl = $("#sheetTitle");
  const artistEl = $("#sheetArtist");

  const progressTrack = $("#sheetProgressTrack");
  const progressFill = $("#sheetProgressFill");
  const currentTimeEl = $("#sheetCurrentTime");
  const remainingTimeEl = $("#sheetRemainingTime");

  const shuffleBtn = $("#sheetShuffleBtn");
  const prevBtn = $("#sheetPrevBtn");
  const playBtn = $("#sheetPlayBtn");
  const playIcon = $("#sheetPlayIcon");
  const nextBtn = $("#sheetNextBtn");
  const repeatBtn = $("#sheetRepeatBtn");
  const repeatOneBadge = $("#repeatOneBadge");

  const favBtn = $("#sheetFavBtn");
  const variantBtn = $("#sheetVariantBtn");
  const queueBtn = $("#sheetQueueBtn");
  const queuePanel = $("#sheetQueuePanel");
  const errorToast = el("div", { class: "toast toast-error", role: "alert" });
  document.body.appendChild(errorToast);
  let errorTimer;
  on("playbackerror", key => {
    clearTimeout(errorTimer);
    errorToast.textContent = t(key);
    errorToast.classList.add("visible");
    errorTimer = setTimeout(() => errorToast.classList.remove("visible"), 6000);
  });

  let isDragging = false;

  function open() {
    if (!getCurrentSong()) return;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    renderSong(getCurrentSong());
    renderRepeatUI();
    renderShuffleUI();
    renderVariantUI();
    lyrics.open(getCurrentSong());
    updateProgressUI(audioEl.currentTime, audioEl.duration);
    closeBtn.focus();
  }

  function close() {
    lyrics.close();
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    queuePanel.hidden = true;
  }

  function renderSong(song) {
    if (!song) return;
    titleEl.textContent = song.title;
    artistEl.textContent = song.artist;
    favBtn.classList.toggle("active", !!song.favorite);
    favBtn.setAttribute("aria-pressed", String(!!song.favorite));
    favBtn.textContent = song.favorite ? "♥" : "♡";
    favBtn.setAttribute("aria-label", song.favorite ? t("player.unfavorite") : t("player.favorite"));
    renderVariantUI();
  }

  function updateProgressUI(currentTime, duration) {
    const lang = getLang();
    progressFill.style.width = `${duration ? (currentTime / duration) * 100 : 0}%`;
    progressTrack.setAttribute("aria-valuenow", String(duration ? Math.round(currentTime / duration * 100) : 0));
    currentTimeEl.textContent = localizeTime(currentTime, lang);
    remainingTimeEl.textContent = duration ? `-${localizeTime(duration - currentTime, lang)}` : "-0:00";
  }

  function renderShuffleUI() {
    const active = isShuffleOn();
    shuffleBtn.classList.toggle("active", active);
    shuffleBtn.setAttribute("aria-pressed", String(active));
  }

  function renderRepeatUI() {
    const mode = getRepeatMode();
    repeatBtn.classList.toggle("active", mode !== "off");
    repeatBtn.setAttribute("aria-pressed", String(mode !== "off"));
    repeatBtn.setAttribute("aria-label", mode === "one" ? t("player.repeatOne") : mode === "all" ? t("player.repeatAll") : t("player.repeatOff"));
    repeatOneBadge.hidden = mode !== "one";
  }

  function renderVariantUI() {
    const song = getCurrentSong();
    const available = hasInstrumental(song);
    const variant = getCurrentVariant();
    const { pending } = getVariantStatus();
    variantBtn.textContent = variant === "instrumental" ? t("player.instrumental") : t("player.vocals");
    if (pending) variantBtn.textContent = t("player.variantSwitching");
    variantBtn.setAttribute("aria-busy", String(pending));
    variantBtn.classList.toggle("disabled-hint", !available);
    variantBtn.disabled = !available;
    if (!available) variantBtn.textContent = t("player.noInstrumental");
    variantBtn.setAttribute("aria-label", variantBtn.textContent);
  }

  // ---- open/close ----
  $("#miniExpand").addEventListener("click", open);
  $("#miniExpand").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("open")) close();
  });

  // ---- transport ----
  playBtn.addEventListener("click", togglePlay);
  prevBtn.addEventListener("click", playPrev);
  nextBtn.addEventListener("click", playNext);
  shuffleBtn.addEventListener("click", () => { setShuffle(!isShuffleOn()); renderShuffleUI(); });
  repeatBtn.addEventListener("click", async () => { await cycleRepeatMode(); renderRepeatUI(); });
  favBtn.addEventListener("click", () => { const s = getCurrentSong(); if (s) toggleFavorite(s); });

  on("trackchange", (song) => {
    clearTimeout(errorTimer);
    errorToast.classList.remove("visible");
    renderSong(song);
    updateProgressUI(audioEl.currentTime, audioEl.duration || song?.duration || 0);
    if (!queuePanel.hidden) renderQueuePanel();
  });
  on("playstate", (isPlaying) => {
    playIcon.innerHTML = isPlaying
      ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/>'
      : '<path d="M8 5v14l11-7z" fill="currentColor"/>';
    playBtn.setAttribute("aria-label", isPlaying ? t("player.pause") : t("player.play"));
  });
  on("timeupdate", (currentTime, duration) => { if (!isDragging) updateProgressUI(currentTime, duration); });
  on("favorite", (song) => { if (getCurrentSong()?.id === song.id) renderSong(song); });
  on("variantchange", renderVariantUI);

  progressTrack.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !audioEl.duration) return;
    event.preventDefault();
    const time = event.key === "Home" ? 0 : event.key === "End" ? audioEl.duration : audioEl.currentTime + (event.key === "ArrowRight" ? 5 : -5);
    seekTo(Math.max(0, Math.min(1, time / audioEl.duration)));
    updateProgressUI(audioEl.currentTime, audioEl.duration);
  });
  // ---- seek (pointer drag, same pattern as the mini player) ----
  function ratioFromEvent(e) {
    const rect = progressTrack.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  }
  progressTrack.addEventListener("pointerdown", (e) => {
    isDragging = true;
    progressTrack.classList.add("dragging");
    progressTrack.setPointerCapture(e.pointerId);
    const ratio = ratioFromEvent(e);
    if (Number.isFinite(audioEl.duration)) updateProgressUI(ratio * audioEl.duration, audioEl.duration);
    seekTo(ratio);
  });
  progressTrack.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    const ratio = ratioFromEvent(e);
    if (Number.isFinite(audioEl.duration)) updateProgressUI(ratio * audioEl.duration, audioEl.duration);
    seekTo(ratio);
  });
  function endDrag(e) {
    if (!isDragging) return;
    isDragging = false;
    progressTrack.classList.remove("dragging");
    try { progressTrack.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  }
  progressTrack.addEventListener("pointerup", endDrag);
  progressTrack.addEventListener("pointercancel", endDrag);

  variantBtn.addEventListener("click", async () => {
    if (!hasInstrumental()) return;
    await switchVariant(getVariantStatus().target === "vocals" ? "instrumental" : "vocals");
    renderVariantUI();
  });
  on("songselected", open);
  // ---- queue ----
  queueBtn.addEventListener("click", () => {
    queuePanel.hidden = !queuePanel.hidden;
    if (!queuePanel.hidden) renderQueuePanel();
  });
  function renderQueuePanel() {
    clearNode(queuePanel);
    const queue = getQueue();
    if (!queue.length) {
      queuePanel.appendChild(el("p", { class: "sheet-hint" }, t("player.emptyQueue")));
      return;
    }
    const current = getCurrentSong();
    const list = el("div", { class: "sheet-queue-list" });
    queue.forEach((song) => {
      list.appendChild(createSongRow(song, {
        isPlaying: !!current && current.id === song.id,
        onPlay: (s) => playSong(s, queue),
      }));
    });
    queuePanel.appendChild(list);
  }

  return { open, close };
}
