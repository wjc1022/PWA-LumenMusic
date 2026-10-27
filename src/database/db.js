/**
 * database/db.js
 * ---------------------------------------------------------------
 * Thin promise-based wrapper around IndexedDB. This is the ONLY
 * module that talks to IndexedDB directly — every other module
 * goes through the functions exported here.
 *
 * Object stores:
 *   songs      keyPath: "id"      -> { id, title, artist, album, duration,
 *                                       cover (dataURL), audioBlob (Blob),
 *                                       mimeType, favorite, playCount,
 *                                       dateAdded }
 *   playlists  keyPath: "id"      -> { id, name, songIds: [], dateCreated }
 *   recents    keyPath: "id"      -> { id (=songId), playedAt }
 *   lyrics     keyPath: "songId"  -> { songId, text: string }
 *   settings   keyPath: "key"     -> { key, value }
 * ---------------------------------------------------------------
 */

import { traceRecord, operationId } from '../services/mediaTimeline.js';
const DB_NAME = "lumen-db";
const DB_VERSION = 1;
const STORES = ["songs", "playlists", "recents", "lyrics", "settings"];

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("songs")) {
        const store = db.createObjectStore("songs", { keyPath: "id" });
        store.createIndex("dateAdded", "dateAdded");
        store.createIndex("favorite", "favorite");
      }
      if (!db.objectStoreNames.contains("playlists")) {
        db.createObjectStore("playlists", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("recents")) {
        const store = db.createObjectStore("recents", { keyPath: "id" });
        store.createIndex("playedAt", "playedAt");
      }
      if (!db.objectStoreNames.contains("lyrics")) {
        db.createObjectStore("lyrics", { keyPath: "songId" });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode = "readonly") {
  return openDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ----------------------------- generic ----------------------------- */

async function getAll(storeName) {
  const store = await tx(storeName);
  return wrap(store.getAll());
}

async function get(storeName, key) {
  const store = await tx(storeName);
  return wrap(store.get(key));
}

async function put(storeName, value, operation = 'write') {
  const op = operationId();
  const id = value?.id;
  if (storeName === 'songs') traceRecord(operation+'-before', value, {op});
  try {
    const store = await tx(storeName, "readwrite");
    const result = await new Promise((resolve, reject) => {
      const transaction = store.transaction;
      let key;
      transaction.oncomplete = () => resolve(key);
      transaction.onabort = () => reject(transaction.error || new DOMException('Transaction aborted', 'AbortError'));
      transaction.onerror = () => reject(transaction.error || new Error('Transaction failed'));
      const request = store.put(value);
      request.onsuccess = () => { key = request.result; };
      request.onerror = () => reject(request.error);
    });
    if (storeName === 'songs') {
      // Independent fresh read; diagnostic failures never turn a committed write into failure.
      void get('songs', id).then(record=>traceRecord(operation+'-committed-read',record,{id,op}))
        .catch(error=>traceRecord('write-read-error',null,{id,op,error}));
    }
    return result;
  } catch(error) {
    if(storeName==='songs') traceRecord('write-failed',value,{op,error});
    throw error;
  }
}

async function del(storeName, key) {
  const store = await tx(storeName, "readwrite");
  return wrap(store.delete(key));
}

async function clear(storeName) {
  const store = await tx(storeName, "readwrite");
  return wrap(store.clear());
}

/* ----------------------------- songs ----------------------------- */

export const Songs = {
  all: () => getAll("songs"),
  get: async (id, operation = 'record-read') => {
    try { const record=await get('songs',id); traceRecord(operation,record,{id}); return record; }
    catch(error) {traceRecord(operation,null,{id,error});throw error;}
  },
  add: (song) => put("songs", song, 'import-save'),
  update: (song) => put("songs", song, 'resource-update'),
  remove: async (id) => {
    await del("songs", id);
    await del("lyrics", id);
    await del("recents", id);
  },
  setFavorite: async (id, favorite) => {
    const song = await get("songs", id);
    if (!song) return;
    song.favorite = favorite;
    await put("songs", song, 'favorite');
    return song;
  },
  incrementPlayCount: async (id) => {
    const song = await get("songs", id);
    if (!song) return;
    song.playCount = (song.playCount || 0) + 1;
    await put("songs", song, 'play-count');
    return song;
  },
  clearAll: () => clear("songs"),
};

/* ----------------------------- playlists ----------------------------- */

export const Playlists = {
  all: () => getAll("playlists"),
  get: (id) => get("playlists", id),
  add: (playlist) => put("playlists", playlist),
  update: (playlist) => put("playlists", playlist),
  remove: (id) => del("playlists", id),
  clearAll: () => clear("playlists"),
};

/* ----------------------------- recents ----------------------------- */

const MAX_RECENTS = 50;

export const Recents = {
  all: async () => {
    const rows = await getAll("recents");
    return rows.sort((a, b) => b.playedAt - a.playedAt);
  },
  record: async (songId) => {
    await put("recents", { id: songId, playedAt: Date.now() });
    const all = await Recents.all();
    if (all.length > MAX_RECENTS) {
      const excess = all.slice(MAX_RECENTS);
      for (const row of excess) await del("recents", row.id);
    }
  },
  clearAll: () => clear("recents"),
};

/* ----------------------------- lyrics ----------------------------- */

export const Lyrics = {
  get: (songId) => get("lyrics", songId),
  save: (songId, text) => {
    if (typeof text !== "string") throw new TypeError("Lyrics must be raw text");
    return put("lyrics", { songId, text });
  },
  remove: (songId) => del("lyrics", songId),
};

/* ----------------------------- settings ----------------------------- */

export const Settings = {
  get: async (key, fallback = null) => {
    const row = await get("settings", key);
    return row ? row.value : fallback;
  },
  set: (key, value) => put("settings", { key, value }),
  all: async () => {
    const rows = await getAll("settings");
    const map = {};
    rows.forEach((r) => (map[r.key] = r.value));
    return map;
  },
};

/* ----------------------------- bulk export / import ----------------------------- */

export async function exportAllRaw() {
  const [songs, playlists, recents, settingsRows] = await Promise.all([
    getAll("songs"),
    getAll("playlists"),
    getAll("recents"),
    getAll("settings"),
  ]);
  const lyrics = (await getAll("lyrics")).filter(row => typeof row.text === "string")
    .map(({ songId, text }) => ({ songId, text }));
  return { songs, playlists, recents, lyrics, settings: settingsRows };
}

export async function importAllRaw({ songs = [], playlists = [], recents = [], lyrics = [], settings = [] }) {
  for (const s of songs) await put("songs", s, 'backup-restore');
  for (const p of playlists) await put("playlists", p);
  for (const r of recents) await put("recents", r);
  for (const l of lyrics) {
    if (typeof l?.songId === "string" && typeof l.text === "string") await Lyrics.save(l.songId, l.text);
  }
  for (const st of settings) await put("settings", st);
}

export async function wipeDatabase() {
  for (const store of STORES) await clear(store);
}
