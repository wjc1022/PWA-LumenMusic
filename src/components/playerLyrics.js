import { $, el, clearNode } from '../utils/dom.js';
import { Lyrics } from '../database/db.js';
import { t } from '../services/i18nService.js';
import { audioEl, on } from '../services/audioEngine.js';
import { parseLrc, findActiveLine, findActiveWord } from '../lyrics/lrc.mjs';

export function initPlayerLyrics() {
  const modal = $('#playerSheetModal');
  const body = $('#lyricsBody');

  let activeSong = null;
  let lines = [];
  let nodes = [];

  let revision = 0;
  let frame = null;
  let lastIndex = -2;
  let lastWord = -2;
  const isOpen = () => modal.classList.contains('open');
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function stopLoop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function center(index, instant = false) {
    const node = nodes[index];
    if (!node) return;
    // Layout coordinates exclude transforms and smooth-scroll intermediate
    // rectangles. The body is the offset parent, including for wrapped lines.
    const top = Math.max(0, node.offsetTop + node.offsetHeight / 2 - body.clientHeight / 2);
    body.scrollTo({ top, behavior: instant || reducedMotion() || audioEl.seeking ? 'instant' : 'smooth' });
  }

  function sync(recenter = false) {
    if (!isOpen()) return;
    const index = findActiveLine(lines, audioEl.currentTime);
    if (index !== lastIndex) {
      // Presentation only: preview the next timed, nonblank lyric. Interlude
      // markers still retain their original timing and current-line behavior.
      const nextIndex = lines.findIndex((line, i) => i > index && line.time !== null && line.text.trim());
      nodes.forEach((node, i) => {
        node.classList.toggle('current', i === index);
        node.classList.toggle('next', i === nextIndex);
        node.classList.toggle('past', lines[i].time !== null && i < index);
        node.removeAttribute('aria-current');
        node.querySelectorAll('.lyric-word').forEach(word => word.classList.remove('sung', 'active'));
      });
      if (index >= 0 && nodes[index]) {
        const node = nodes[index];
        node.setAttribute('aria-current', 'true');
        center(index, recenter);
      }
      lastIndex = index;
      lastWord = -2;
    } else if (recenter) center(index, true);
    if (index < 0 || !lines[index]?.words) return;
    const wordIndex = findActiveWord(lines[index].words, audioEl.currentTime);
    if (wordIndex === lastWord) return;
    nodes[index].querySelectorAll('.lyric-word').forEach((word, i) => {
      word.classList.toggle('sung', i <= wordIndex);
      word.classList.toggle('active', i === wordIndex);
    });
    lastWord = wordIndex;
  }

  function startLoop() {
    stopLoop();
    sync();
    if (!isOpen() || document.hidden || audioEl.paused || audioEl.ended) return;
    const tick = () => {
      frame = null;
      sync();
      if (isOpen() && !document.hidden && !audioEl.paused && !audioEl.ended) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }

  function open(song) {
    if (!song) return;
    activeSong = song;

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    renderView();

  }

  function close() {
    revision++;
    stopLoop();
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  async function renderView() {
    const request = ++revision;
    stopLoop();
    lines = []; nodes = []; lastIndex = -2; lastWord = -2;
    clearNode(body);
    body.scrollTop = 0;
    if (!activeSong) return;
    const songId = activeSong.id;

    try {
      const record = await Lyrics.get(songId);
      if (request !== revision || !isOpen()) return;
      const raw = typeof record?.text === 'string' ? record.text : '';
      lines = parseLrc(raw).lines;
      if (!lines.length) body.appendChild(el('p', { class: 'empty-state' }, t('lyrics.noLyrics')));
      nodes = lines.map(line => {
        const node = el('div', { class: `lyric-line${line.time === null ? ' untimed' : ''}`, dir: 'auto' });
        if (line.words?.length) {
          line.words.forEach(word => node.appendChild(el('span', { class: 'lyric-word' }, word.text)));
        } else node.textContent = line.text || '\u00a0';
        body.appendChild(node);
        return node;
      });
      startLoop();
    } catch (error) {
      if (request !== revision) return;
      console.error('Lyrics load failed', error);
      body.appendChild(el('p', { role: 'alert' }, t('lyrics.loadError')));
    }
  }

  on('playstate', startLoop);
  document.addEventListener('visibilitychange', startLoop);
  on('timeupdate', () => sync());
  on('trackchange', song => { if (isOpen()) open(song); });
  ['seeking', 'seeked', 'loadedmetadata', 'ended', 'pause'].forEach(event => audioEl.addEventListener(event, () => { sync(true); startLoop(); }));
  // Observe both viewport and line sizes: font loading, font size changes,
  // zoom and wrapping can move the active line while playback is paused.
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => sync(true));
    observer.observe(body);
    const mutations = new MutationObserver(() => {
      observer.disconnect(); observer.observe(body);
      nodes.forEach(node => observer.observe(node));
    });
    mutations.observe(body, { childList: true });
  }
  window.addEventListener?.('resize', () => sync(true));
  return { open, close };
}
