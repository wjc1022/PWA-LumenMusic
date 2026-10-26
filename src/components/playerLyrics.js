import { $, $$, el, clearNode } from '../utils/dom.js';
import { Lyrics } from '../database/db.js';
import { t, getLang } from '../services/i18nService.js';
import { audioEl, on } from '../services/audioEngine.js';
import { parseLrc, findActiveLine, findActiveWord } from '../lyrics/lrc.mjs';

export function initPlayerLyrics() {
  const modal = $('#playerSheetModal');
  const body = $('#lyricsBody');

  let activeSong = null;
  let lyricsLang = getLang() === 'fa' ? 'fa' : 'en';
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

  function sync() {
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
        body.scrollTo({ top: Math.max(0, body.scrollTop + node.getBoundingClientRect().top - body.getBoundingClientRect().top - (body.clientHeight - node.offsetHeight) / 2), behavior: reducedMotion() || audioEl.seeking ? 'auto' : 'smooth' });
      }
      lastIndex = index;
      lastWord = -2;
    }
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
    const lang = lyricsLang;
    try {
      const record = await Lyrics.get(songId);
      if (request !== revision || !isOpen()) return;
      const raw = record?.[lang] || '';
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

  $$('.lyrics-lang-toggle .seg').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.lang === lyricsLang);
    tab.setAttribute('aria-pressed', String(tab.dataset.lang === lyricsLang));
    tab.addEventListener('click', () => {
      $$('.lyrics-lang-toggle .seg').forEach(item => {
        item.classList.toggle('active', item === tab);
        item.setAttribute('aria-pressed', String(item === tab));
      });
      lyricsLang = tab.dataset.lang;
  
      renderView();
    });
  });
  on('playstate', startLoop);
  document.addEventListener('visibilitychange', startLoop);
  on('timeupdate', sync);
  on('trackchange', song => { if (isOpen()) open(song); });
  ['seeking', 'seeked', 'loadedmetadata', 'ended', 'pause'].forEach(event => audioEl.addEventListener(event, startLoop));
  return { open, close };
}
