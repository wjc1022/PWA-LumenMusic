import { $, $$, el, clearNode } from '../utils/dom.js';
import { Lyrics } from '../database/db.js';
import { t, getLang } from '../services/i18nService.js';
import { audioEl, on, togglePlay, playNext, playPrev } from '../services/audioEngine.js';
import { parseLrc, findActiveLine, findActiveWord } from '../lyrics/lrc.mjs';

export function initLyricsModal() {
  const modal = $('#lyricsModal');
  const body = $('#lyricsBody');
  const closeBtn = $('#lyricsClose');
  let activeSong = null;
  let lyricsLang = getLang() === 'fa' ? 'fa' : 'en';
  let lines = [];
  let nodes = [];
  let editing = false;
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
    if (!isOpen() || editing) return;
    const index = findActiveLine(lines, audioEl.currentTime);
    if (index !== lastIndex) {
      nodes.forEach((node, i) => {
        node.classList.toggle('current', i === index);
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
    if (!isOpen() || editing || audioEl.paused || audioEl.ended) return;
    const tick = () => {
      frame = null;
      sync();
      if (isOpen() && !editing && !audioEl.paused && !audioEl.ended) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }

  function open(song) {
    if (!song) return;
    activeSong = song;
    editing = false;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    $('#lyricsTitle').textContent = song.title;
    $('#lyricsArtist').textContent = song.artist || '';
    const cover = song.cover || 'assets/icons/icon-192.png';
    $('#lyricsCover').src = cover;
    $('#lyricsArtBg').style.backgroundImage = `url(${JSON.stringify(cover)})`;
    renderView();
    closeBtn.focus();
  }

  function close() {
    revision++;
    stopLoop();
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  async function saveText(songId, lang, text) {
    const record = await Lyrics.get(songId) || { en: '', fa: '' };
    record[lang] = text;
    await Lyrics.save(songId, record);
  }

  function importButton() {
    const input = el('input', { type: 'file', accept: '.lrc,text/plain', hidden: true });
    const button = el('button', { class: 'btn ghost' }, t('lyrics.importLrc'));
    button.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file || !activeSong) return;
      const songId = activeSong.id;
      const lang = lyricsLang;
      button.disabled = true;
      try {
        const text = await file.text();
        await saveText(songId, lang, text);
        if (activeSong?.id === songId && lyricsLang === lang && isOpen()) {
          editing = false;
          await renderView();
        }
      } catch (error) {
        console.error('LRC import failed', error);
        window.alert(t('lyrics.importError'));
      } finally {
        button.disabled = false;
        input.value = '';
      }
    });
    return el('div', { class: 'lyrics-import' }, [button, input]);
  }

  async function renderView() {
    const request = ++revision;
    stopLoop();
    lines = []; nodes = []; lastIndex = -2; lastWord = -2;
    clearNode(body);
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
        const node = el('div', { class: 'lyric-line', dir: 'auto' });
        if (line.words?.length) {
          line.words.forEach(word => node.appendChild(el('span', { class: 'lyric-word' }, word.text)));
        } else node.textContent = line.text || '\u00a0';
        body.appendChild(node);
        return node;
      });
      const edit = el('button', { class: 'btn ghost lyrics-edit-link' }, t(raw ? 'lyrics.editLyrics' : 'lyrics.addLyrics'));
      edit.addEventListener('click', () => renderEditor(raw));
      body.append(importButton(), edit);
      startLoop();
    } catch (error) {
      if (request !== revision) return;
      console.error('Lyrics load failed', error);
      body.appendChild(el('p', { role: 'alert' }, t('lyrics.loadError')));
    }
  }

  function renderEditor(raw) {
    revision++;
    editing = true;
    stopLoop();
    clearNode(body);
    const songId = activeSong.id;
    const lang = lyricsLang;
    const textarea = el('textarea', { class: 'lyrics-textarea', dir: 'auto', placeholder: t('lyrics.placeholder'), 'aria-label': t('lyrics.title') });
    textarea.value = raw;
    const save = el('button', { class: 'btn primary' }, t('lyrics.save'));
    const cancel = el('button', { class: 'btn ghost' }, t('lyrics.cancel'));
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        await saveText(songId, lang, textarea.value);
        if (activeSong?.id === songId && lyricsLang === lang && isOpen()) { editing = false; renderView(); }
      } catch (error) {
        console.error('Lyrics save failed', error);
        window.alert(t('lyrics.importError'));
      } finally { save.disabled = false; }
    });
    cancel.addEventListener('click', () => { editing = false; renderView(); });
    body.append(textarea, el('div', { class: 'lyrics-editor-actions' }, [save, cancel]));
    textarea.focus();
  }

  $$('.lyrics-lang-toggle .seg').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.lang === lyricsLang);
    tab.addEventListener('click', () => {
      $$('.lyrics-lang-toggle .seg').forEach(item => item.classList.toggle('active', item === tab));
      lyricsLang = tab.dataset.lang;
      editing = false;
      renderView();
    });
  });
  closeBtn.addEventListener('click', close);
  $('#lyricsBackdrop').addEventListener('click', close);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && isOpen()) close(); });
  $('#lyricsPlayBtn').addEventListener('click', togglePlay);
  $('#lyricsPrevBtn').addEventListener('click', playPrev);
  $('#lyricsNextBtn').addEventListener('click', playNext);
  function updatePlayState() {
    $('#lyricsPlayIcon').innerHTML = audioEl.paused
      ? '<path d="M8 5v14l11-7z" fill="currentColor"/>'
      : '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/>';
    $('#lyricsPlayBtn').setAttribute('aria-label', t(audioEl.paused ? 'player.play' : 'player.pause'));
    startLoop();
  }
  on('playstate', updatePlayState);
  on('timeupdate', sync);
  on('trackchange', song => { if (isOpen()) open(song); });
  ['seeking', 'seeked', 'loadedmetadata', 'ended'].forEach(event => audioEl.addEventListener(event, sync));
  updatePlayState();
  return { open, close };
}
