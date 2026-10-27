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
  function picker(label, kind) {
    const input = el('input', { type: 'file', hidden: true });
    if (kind === 'audio') input.accept = 'audio/*,.mp3,.m4a,.wav,.aac,.flac,.ogg,.aif,.aiff,.caf';
    const button = el('button', { class: 'btn ghost' }, label);
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
  panel.append(picker(t('library.replaceLyrics'), 'lyrics'));
  if (song.mediaType !== 'video') panel.append(picker(t('library.replaceInstrumental'), 'audio'));
  panel.append(status);
  return panel;
}
