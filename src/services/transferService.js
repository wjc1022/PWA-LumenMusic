/**
 * services/transferService.js
 * ---------------------------------------------------------------
 * Exports the entire IndexedDB library (songs incl. audio + cover,
 * playlists, recents, lyrics, settings) as a single downloadable
 * JSON file, and restores it back in on any device. This is the
 * user's way of moving or backing up a library that otherwise only
 * exists in this browser's IndexedDB.
 * ---------------------------------------------------------------
 */

import { exportAllRaw, importAllRaw } from "../database/db.js";

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

export async function exportLibrary() {
  const raw = await exportAllRaw();

  const songs = await Promise.all(
    raw.songs.map(async (song) => ({
      ...song,
      audioBlob: song.audioBlob ? await blobToDataUrl(song.audioBlob) : null,
      instrumentalBlob: song.instrumentalBlob ? await blobToDataUrl(song.instrumentalBlob) : null,
    }))
  );

  const payload = {
    formatVersion: 3,
    exportedAt: new Date().toISOString(),
    songs,
    playlists: raw.playlists,
    recents: raw.recents,
    lyrics: raw.lyrics.filter(row => typeof row.text === "string").map(({ songId, text }) => ({ songId, text })),
    settings: raw.settings,
  };

  const json = JSON.stringify(payload);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `lumen-library-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  return { songCount: songs.length };
}

export async function importLibrary(file) {
  const text = await file.text();
  const payload = JSON.parse(text);
  if(payload.formatVersion !== 3) throw new Error('Unsupported backup version. Version 3 required.');

  for(const name of ['songs','playlists','recents','lyrics','settings']) if(!Array.isArray(payload[name])) throw new Error('Invalid backup: '+name);
  const ids=new Set(payload.songs.map(s=>s.id));
  if(ids.size!==payload.songs.length || payload.songs.some(s=>typeof s.id!=='string'||typeof s.audioBlob!=='string'||!s.audioBlob.startsWith('data:')||(s.instrumentalBlob!=null&&(typeof s.instrumentalBlob!=='string'||!s.instrumentalBlob.startsWith('data:')))))throw new Error('Invalid backup media');
  if(payload.lyrics.some(l=>!ids.has(l.songId)||typeof l.text!=='string')||payload.playlists.some(p=>!Array.isArray(p.songIds)||p.songIds.some(id=>!ids.has(id))))throw new Error('Invalid backup relationships');
  const songs = await Promise.all(
    payload.songs.map(async (song) => ({
      ...song,
      audioBlob: await dataUrlToBlob(song.audioBlob),
      instrumentalBlob: typeof song.instrumentalBlob === "string" ? await dataUrlToBlob(song.instrumentalBlob) : null,
    }))
  );

  await importAllRaw({
    songs,
    playlists: payload.playlists,
    recents: payload.recents,
    lyrics: payload.lyrics
      .map(({ songId, text }) => ({ songId, text })),
    settings: payload.settings,
  });

  return { songCount: songs.length, playlistCount: (payload.playlists || []).length };
}
