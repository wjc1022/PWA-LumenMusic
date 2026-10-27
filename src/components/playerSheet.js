import { getPlayerButtons } from '../services/playerPreferences.js';
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
  const videoHost = $("#videoHost");
  videoHost.appendChild(audioEl);
  const fullscreenBtn = $("#sheetFullscreenBtn");
  const landscapePhone = window.matchMedia('(orientation: landscape) and (max-height: 600px)');
  let automaticFill = false;
  let fullscreenRevision = 0;
  function setPageFill(enabled) {
    modal.classList.toggle("page-fill", enabled);
    fullscreenBtn.textContent = t(enabled ? "player.exitFill" : "player.fullscreen");
    fullscreenBtn.setAttribute("aria-pressed", String(enabled || !!document.fullscreenElement));
  }
  function fitLandscape() {
    if (!modal.classList.contains('open') || getCurrentSong()?.mediaType !== 'video') {
      if (automaticFill) { automaticFill=false; setPageFill(false); }
      return;
    }
    if (landscapePhone.matches && !document.fullscreenElement) {
      if (!modal.classList.contains("page-fill")) { automaticFill = true; setPageFill(true); }
    } else if (automaticFill) { automaticFill = false; setPageFill(false); }
  }
  landscapePhone.addEventListener('change', fitLandscape);
  fullscreenBtn.addEventListener("click", async () => {
    const request = ++fullscreenRevision;
    automaticFill = false;
    if (document.fullscreenElement) { await document.exitFullscreen(); return; }
    if (modal.classList.contains("page-fill")) { setPageFill(false); return; }
    // Fill immediately, even if the platform exposes an API that rejects or stalls.
    setPageFill(true);
    try { if (!modal.requestFullscreen) throw Error(); await modal.requestFullscreen(); }
    catch { if (request === fullscreenRevision && modal.classList.contains("open")) setPageFill(true); }
  });
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
  let dragPointerId;
  const landscape = matchMedia('(orientation: landscape)');
  const controls = $('.player-sheet-controls'), secondary = $('.player-sheet-secondary-row');
  const subtitlesBtn = el('button',{class:'sheet-pill-btn',id:'sheetSubtitlesBtn','data-i18n':'buttonLabels.subtitles'},t('buttonLabels.subtitles'));
  secondary.append(subtitlesBtn);
  const moreBtn = el('button',{class:'sheet-pill-btn',id:'sheetMoreBtn','data-i18n':'player.more','aria-expanded':'false','aria-controls':'sheetMorePanel'},t('player.more'));
  const morePanel = el('div',{class:'sheet-more-panel',id:'sheetMorePanel',hidden:true});
  controls.append(moreBtn);secondary.after(morePanel);
  const buttons={shuffle:shuffleBtn,repeat:repeatBtn,favorite:favBtn,queue:queueBtn,variant:variantBtn,subtitles:subtitlesBtn,fullscreen:fullscreenBtn};
  let subtitles=true, hideTimer, keyboardFocus=false;
  function isLandscapeVideo() { return modal.classList.contains('open') && getCurrentSong()?.mediaType==='video' && landscape.matches; }
  function reveal() {
    clearTimeout(hideTimer);modal.classList.remove('controls-hidden');
    for(const node of [controls,secondary,progressTrack,morePanel]) node.inert=false;
    if(!isLandscapeVideo() || audioEl.paused || isDragging || !queuePanel.hidden || !morePanel.hidden || keyboardFocus) return;
    hideTimer=setTimeout(()=>{
      modal.classList.add('controls-hidden');
      for(const node of [controls,secondary,progressTrack,morePanel]) node.inert=true;
    },3000);
  }
  function dismissMenus() { morePanel.hidden=true;moreBtn.setAttribute('aria-expanded','false');queuePanel.hidden=true; }
  function layoutButtons() {
    const video=getCurrentSong()?.mediaType==='video',prefs=getPlayerButtons(),wide=isLandscapeVideo();
    modal.classList.toggle('landscape-video',wide);modal.classList.toggle('subtitles-off',!subtitles);
    $('#shuffleBtn').hidden=!prefs.shuffle;
    $('#miniFavBtn').hidden=!prefs.favorite;
    subtitlesBtn.setAttribute('aria-pressed',String(subtitles));
    const narrow=wide && videoHost.getBoundingClientRect().width<760;
    for(const [key,button] of Object.entries(buttons)) {
      button.hidden=!prefs[key] || (key==='variant' && video) || (['subtitles','fullscreen'].includes(key) && !video) || (key==='subtitles' && !landscape.matches);
      const low=!['shuffle','repeat'].includes(key);
      const overflow=low || videoHost.getBoundingClientRect().width<360;
      const parent=wide ? (narrow && overflow ? morePanel : controls) : (low ? secondary : controls);
      if(button.parentElement!==parent) parent.append(button);
    }
    moreBtn.hidden=!wide || !narrow || ![...morePanel.children].some(b=>!b.hidden);
    if(moreBtn.hidden) {morePanel.hidden=true;moreBtn.setAttribute('aria-expanded','false');}
    if(queueBtn.hidden) queuePanel.hidden=true;
    if(document.activeElement?.hidden) closeBtn.focus();
    reveal();
  }
  subtitlesBtn.addEventListener('click',()=>{subtitles=!subtitles;layoutButtons();});
  moreBtn.addEventListener('click',()=>{morePanel.hidden=!morePanel.hidden;moreBtn.setAttribute('aria-expanded',String(!morePanel.hidden));reveal();});
  window.addEventListener('playerbuttonschange',layoutButtons);
  landscape.addEventListener('change',()=>{dismissMenus();layoutButtons();});
  new ResizeObserver(layoutButtons).observe(videoHost);
  modal.addEventListener('pointerdown',e=>{
    keyboardFocus=false;
    if(!e.target.closest('#sheetMorePanel,#sheetMoreBtn,.sheet-panel,#sheetQueueBtn')) dismissMenus();
    reveal();
  },true);
  modal.addEventListener('pointermove',e=>{if(e.pointerType==='mouse')reveal();});
  modal.addEventListener('keydown',()=>{keyboardFocus=true;reveal();});
  const focusSelector='.player-sheet-controls,.player-sheet-secondary-row,.sheet-more-panel,#sheetProgressTrack,.sheet-panel';
  document.addEventListener('keydown',e=>{if(e.key==='Tab') { keyboardFocus=true; if(isLandscapeVideo()) reveal(); }},true);
  modal.addEventListener('focusin',e=>{if(e.target.closest(focusSelector)) reveal();});
  modal.addEventListener('focusout',()=>queueMicrotask(()=>{keyboardFocus=keyboardFocus && !!document.activeElement?.closest(focusSelector);reveal();}));
  for(const event of ['play','pause','ended']) audioEl.addEventListener(event,reveal);
  document.addEventListener('fullscreenchange',()=>{setPageFill(modal.classList.contains('page-fill'));reveal();});


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
    fitLandscape();
    layoutButtons();
  }

  function close() {
    endDrag({pointerId:dragPointerId});
    dismissMenus();keyboardFocus=false;clearTimeout(hideTimer);
    modal.classList.remove('controls-hidden');
    fullscreenRevision++;
    automaticFill = false;
    if (document.fullscreenElement === modal) void document.exitFullscreen();
    modal.classList.remove("page-fill");
    fullscreenBtn.textContent = t("player.fullscreen");
    lyrics.close();
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    queuePanel.hidden = true;
    layoutButtons();
    $("#miniExpand").focus();
  }

  function renderSong(song) {
    if (!song) return;
    const video = song.mediaType === "video";
    modal.classList.toggle("has-video", video);
    videoHost.hidden = !video;
    fullscreenBtn.hidden = !video;
    titleEl.textContent = song.title;
    artistEl.textContent = song.artist;
    favBtn.classList.toggle("active", !!song.favorite);
    favBtn.setAttribute("aria-pressed", String(!!song.favorite));
    favBtn.textContent = song.favorite ? "♥" : "♡";
    favBtn.setAttribute("aria-label", song.favorite ? t("player.unfavorite") : t("player.favorite"));
    renderVariantUI();
    layoutButtons();
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
    variantBtn.hidden = song?.mediaType === "video" || !getPlayerButtons().variant;
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
    if (e.key === 'Escape' && modal.classList.contains('open')) {
      if (!morePanel.hidden || !queuePanel.hidden) { dismissMenus(); (moreBtn.hidden ? queueBtn : moreBtn).focus(); reveal(); }
      else close();
    }
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
    endDrag({pointerId:dragPointerId});
    dismissMenus();keyboardFocus=false;
    renderSong(song);
    fitLandscape();reveal();
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
    dragPointerId = e.pointerId;
    reveal();
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
    reveal();
    progressTrack.classList.remove("dragging");
    try { progressTrack.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    dragPointerId = undefined;
  }
  progressTrack.addEventListener("pointerup", endDrag);
  progressTrack.addEventListener("pointercancel", endDrag);
  progressTrack.addEventListener("lostpointercapture", endDrag);

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
    reveal();
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
