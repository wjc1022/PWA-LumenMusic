import { el } from '../utils/dom.js';
import { Songs, Lyrics } from '../database/db.js';
import { t, getLang } from '../services/i18nService.js';
import { attachInstrumental } from '../services/importService.js';
import { readLyricFile } from '../services/lyricFile.js';
import { refreshCurrentSong } from '../services/audioEngine.js';

export function createSongResources(song, onUpdated) {
  const panel = el('details', { class: 'song-resources' });
  panel.appendChild(el('summary', {}, t('library.manageResources') + ' / ' + song.title));
  const language = el('select', { 'aria-label': t('library.lyricsSlot') });
  for (const slot of ['en', 'fa']) language.appendChild(el('option', { value: slot }, slot.toUpperCase()));
  language.value = getLang() === 'fa' ? 'fa' : 'en';
  const status = el('p', { role: 'status' });
  function picker(label, kind) {
    const input = el('input', { type: 'file', hidden: true });
    if (kind === 'audio') input.accept = 'audio/*,.mp3,.m4a,.wav,.aac,.flac,.ogg,.aif,.aiff,.caf';
    const button = el('button', { class: 'btn ghost' }, label);
    let targetSlot;
    button.addEventListener('click', () => {
      targetSlot = language.value;
      input.value = '';
      input.click();
    });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const slot = targetSlot;
      const controls = panel.querySelectorAll('button, select');
      controls.forEach(control => { control.disabled = true; });
      status.textContent = '';
      try {
        if (kind === 'lyrics') {
          const text = await readLyricFile(file);
          if (!await Songs.get(song.id)) throw new Error('Song no longer exists');
          const record = await Lyrics.get(song.id) || { en: '', fa: '' };
          await Lyrics.save(song.id, { ...record, [slot]: text });
          refreshCurrentSong(await Songs.get(song.id));
        } else {
          const updated = await attachInstrumental(song, file);
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
  panel.append(language, picker(t('library.replaceLyrics'), 'lyrics'), picker(t('library.replaceInstrumental'), 'audio'), status);
  return panel;
}
