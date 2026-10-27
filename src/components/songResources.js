import { el } from '../utils/dom.js';
import { Songs, Lyrics } from '../database/db.js';
import { t } from '../services/i18nService.js';
import { attachInstrumental } from '../services/importService.js';
import { readLyricFile } from '../services/lyricFile.js';
import { refreshCurrentSong } from '../services/audioEngine.js';

export function createSongResources(song, onUpdated) {
  const panel = el('details', { class: 'song-resources' });
  panel.appendChild(el('summary', {}, t('library.manageResources') + ' / ' + song.title));
  const status = el('p', { role: 'status' });
  const buttons = new Map();
  function updateButton(kind, exists) {
    const button = buttons.get(kind);
    button.textContent = t('library.' + (exists ? 'replace' : 'add') + (kind === 'lyrics' ? 'Lyrics' : 'Instrumental'));
    button.classList.toggle('resource-replace', exists);
  }
  function picker(kind) {
    const input = el('input', { type: 'file', hidden: true });
    if (kind === 'audio') input.accept = 'audio/*,.mp3,.m4a,.wav,.aac,.flac,.ogg,.aif,.aiff,.caf';
    const button = el('button', { class: 'btn ghost', disabled: true });
    buttons.set(kind, button);
    button.addEventListener('click', () => {
      input.value = '';
      input.click();
    });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const controls = panel.querySelectorAll('button');
      controls.forEach(control => { control.disabled = true; });
      status.textContent = '';
      try {
        if (kind === 'lyrics') {
          const text = await readLyricFile(file);
          if (!await Songs.get(song.id)) throw new Error('Song no longer exists');
          await Lyrics.save(song.id, text);
          updateButton(kind, true);
          refreshCurrentSong(await Songs.get(song.id));
        } else {
          const updated = await attachInstrumental(song, file);
          updateButton(kind, !!updated.instrumentalBlob);
          refreshCurrentSong(updated);
          onUpdated(updated);
        }
        status.textContent = t('library.resourceSaved');
      } catch (error) {
        console.error('Resource import failed', error);
        status.textContent = t('library.resourceError');
      } finally { controls.forEach(control => { control.disabled = false; }); input.value = ''; }
    });
    return el('div', { class: 'resource-picker' }, [button, input]);
  }
  panel.append(picker('lyrics'));
  if (song.mediaType !== 'video') panel.append(picker('audio'));
  panel.append(status);
  Promise.all([Lyrics.get(song.id), Songs.get(song.id)]).then(([lyrics, stored]) => {
    updateButton('lyrics', typeof lyrics?.text === 'string');
    if (buttons.has('audio')) updateButton('audio', !!stored?.instrumentalBlob);
    buttons.forEach(button => { button.disabled = !stored; });
  }).catch(error => {
    console.error('Resource state read failed', error);
    status.textContent = t('library.resourceError');
  });
  return panel;
}
