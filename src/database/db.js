import { traceRecord } from '../services/mediaTimeline.js';
import { generateId } from '../utils/id.js';
// v2: songs stores metadata and resource IDs; media stores separate resources; songState stores daily state.
const DB_NAME = "lumen-db";
const DB_VERSION = 2;
const STORES = ["media", "songState", "songs", "playlists", "recents", "lyrics", "settings"];

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;
    req.onblocked = () => {
      blocked = true;
      reject(new Error('Database upgrade blocked. Close other Lumen tabs and reload.'));
    };
    req.onupgradeneeded = () => {
      if (blocked) { req.transaction.abort(); return; }
      const db = req.result;
      for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name);
      for (const name of STORES) db.createObjectStore(name, {
        keyPath: name === 'songState' || name === 'lyrics' ? 'songId' : name === 'settings' ? 'key' : 'id',
      });
      // Persist until local preferences and runtime state have also been reset.
      req.transaction.objectStore('settings').put({key: 'structureResetPending', value: true});
    };
    req.onerror = () => reject(req.error || new Error('Database initialization failed'));
    req.onsuccess = async () => {
      const db = req.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => {
        db.close();
        dbPromise = Promise.reject(new Error('Database changed. Reload Lumen.'));
        dbPromise.catch(() => {});
        globalThis.dispatchEvent?.(new Event('lumen-data-reset'));
        globalThis.dispatchEvent?.(new Event('lumen-database-invalidated'));
      };
      try {
        await finishStructureReset(db);
        resolve(db);
      } catch (error) { db.close(); reject(error); }
    };
  });
  return dbPromise;
}

function finishStructureReset(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('settings', 'readwrite');
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error || new DOMException('Initialization aborted', 'AbortError'));
    transaction.onerror = () => reject(transaction.error || new Error('Initialization failed'));
    const store = transaction.objectStore('settings');
    const request = store.get('structureResetPending');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      if (!request.result) return;
      try { resetLocal(); store.delete('structureResetPending'); }
      catch (error) { transaction.abort(); reject(error); }
    };
  });
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

async function put(name,value){return atomic([name],(s,r,out)=>r(s(name).put(value),out));}

// Enqueue dependent requests in IDB callbacks; never await external work inside a transaction.
async function atomic(names, action, mode = 'readwrite') {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(names, mode);
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error('Transaction failed'));
    transaction.onabort = () => reject(transaction.error || new DOMException('Transaction aborted', 'AbortError'));
    const request = (req, callback) => {
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        try { callback?.(req.result); }
        catch (error) { transaction.abort(); reject(error); }
      };
    };
    try { action(name => transaction.objectStore(name), request, value => { result = value; }); }
    catch (error) { transaction.abort(); reject(error); }
  });
}
const del=(name,key)=>atomic([name],(s,r)=>r(s(name).delete(key)));
const clear=name=>atomic([name],(s,r)=>r(s(name).clear()));
// Broadcast only runtime invalidation; another tab must not echo or rewrite storage.
const resetChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('lumen-data-reset') : null;
if (resetChannel) resetChannel.onmessage = () => globalThis.dispatchEvent?.(new Event('lumen-data-reset'));
function resetLocal() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('lumen.') || key.startsWith('lumen-')) localStorage.removeItem(key);
  }
  globalThis.dispatchEvent?.(new Event('lumen-data-reset'));
  resetChannel?.postMessage('reset');
}
const fields=['audioBlob','instrumentalBlob','cover'],refs=['audioMediaId','instrumentalMediaId','coverMediaId'];
// All binary preparation happens before starting a write transaction.
function split(song) {
  const data = {...song}, media = [];
  fields.forEach((field, i) => {
    if (data[field] != null) {
      const id = generateId('media');
      data[refs[i]] = id;
      media.push({id, kind: field, value: data[field]});
    } else delete data[refs[i]];
    delete data[field];
  });
  const state = {songId: song.id, favorite: !!song.favorite, playCount: song.playCount || 0};
  delete data.favorite;
  delete data.playCount;
  delete data.songId;
  return {data, media, state};
}
function changeState(id, change) {
  return atomic(['songs', 'songState'], (store, request, output) => {
    request(store('songs').get(id), song => {
      if (!song) return;
      request(store('songState').get(id), old => {
        const state = old || {songId: id, favorite: false, playCount: 0};
        change(state);
        request(store('songState').put(state));
        output({...song, ...state});
      });
    });
  });
}

export const Songs = {
  all: () => atomic(['songs', 'songState'], (store, request, output) => {
    request(store('songs').getAll(), songs => {
      request(store('songState').getAll(), states => {
        const map = new Map(states.map(state => [state.songId, state]));
        output(songs.map(song => ({...song, ...map.get(song.id)})));
      });
    });
  }, 'readonly'),

  get: id => atomic(['songs', 'songState'], (store, request, output) => {
    request(store('songs').get(id), song => {
      if (song) request(store('songState').get(id), state => output({...song, ...state}));
    });
  }, 'readonly'),

  withMedia: id => atomic(['songs', 'songState', 'media'], (store, request, output) => {
    request(store('songs').get(id), song => {
      if (!song) return;
      request(store('songState').get(id), state => Object.assign(song, state));
      refs.forEach((ref, i) => {
        if (!song[ref]) return;
        request(store('media').get(song[ref]), resource => {
          if (!resource) throw new Error('Missing media resource');
          song[fields[i]] = resource.value;
        });
      });
      output(song);
    });
  }, 'readonly').then(song => {
    traceRecord('resource-read', song, {id});
    return song;
  }),

  add: async (song, text) => {
    const {data, media, state} = split(song);
    return atomic(['songs', 'media', 'songState', 'lyrics'], (store, request) => {
      request(store('songs').add(data));
      media.forEach(resource => request(store('media').add(resource)));
      request(store('songState').add(state));
      if (text !== undefined) request(store('lyrics').put({songId: song.id, text}));
    });
  },

  // Callers supply only changed metadata fields, never a hydrated song snapshot.
  update: patch => {
    if (fields.some(field => field in patch)) throw new TypeError('Use replaceResource');
    return atomic(['songs'], (store, request, output) => {
      request(store('songs').get(patch.id), song => {
        if (!song) throw new Error('Song missing');
        const data = {...patch};
        delete data.favorite;
        delete data.playCount;
        delete data.songId;
        refs.forEach(ref => delete data[ref]);
        const updated = {...song, ...data};
        request(store('songs').put(updated));
        output(updated);
      });
    });
  },

  replaceResource: async (id, kind, value, extra = {}) => {
    const index = fields.indexOf(kind);
    if (index < 0) throw new TypeError('Unknown resource');
    const resource = {id: generateId('media'), kind, value};
    return atomic(['songs', 'media', 'songState'], (store, request, output) => {
      request(store('songs').get(id), song => {
        if (!song) throw new Error('Song missing');
        if (kind === 'instrumentalBlob' && song.mediaType === 'video') throw new Error('Video has no instrumental');
        const old = song[refs[index]];
        song[refs[index]] = resource.id;
        if (kind === 'instrumentalBlob') song.instrumentalMimeType = extra.instrumentalMimeType;
        request(store('media').add(resource));
        request(store('songs').put(song));
        if (old) request(store('media').delete(old));
        request(store('songState').get(id), state => output({...song, ...state, [kind]: value}));
      });
    });
  },

  remove: id => atomic(['songs', 'media', 'songState', 'lyrics', 'recents', 'playlists'], (store, request) => {
    request(store('songs').get(id), song => {
      if (song) refs.forEach(ref => { if (song[ref]) request(store('media').delete(song[ref])); });
      for (const name of ['songs', 'songState', 'lyrics', 'recents']) request(store(name).delete(id));
      request(store('playlists').getAll(), rows => rows.forEach(row => {
        row.songIds = row.songIds.filter(songId => songId !== id);
        request(store('playlists').put(row));
      }));
    });
  }),

  setFavorite: (id, favorite) => changeState(id, state => { state.favorite = favorite; }),
  incrementPlayCount: id => changeState(id, state => { state.playCount = (state.playCount || 0) + 1; }),
  clearAll: () => atomic(['songs', 'media', 'songState', 'lyrics', 'recents', 'playlists'], (store, request) => {
    for (const name of ['songs', 'media', 'songState', 'lyrics', 'recents', 'playlists']) request(store(name).clear());
  }),
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
    return atomic(['songs','lyrics'],(store,request)=>request(store('songs').get(songId),song=>{if(!song)throw new Error('Song missing');request(store('lyrics').put({songId,text}));}));
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


// One readonly transaction gives exports a consistent relationship/resource snapshot.
export function exportAllRaw() {
  return atomic(STORES, (store, request, output) => {
    const rows = {};
    for (const name of STORES) request(store(name).getAll(), values => {
      rows[name] = values;
      if (Object.keys(rows).length !== STORES.length) return;
      const media = new Map(rows.media.map(resource => [resource.id, resource.value]));
      const states = new Map(rows.songState.map(state => [state.songId, state]));
      const songs = rows.songs.map(song => {
        const record = {...song, ...states.get(song.id)};
        refs.forEach((ref, i) => {
          if (!song[ref]) return;
          if (!media.has(song[ref])) throw new Error('Missing media resource');
          record[fields[i]] = media.get(song[ref]);
        });
        return record;
      });
      output({songs, playlists: rows.playlists, recents: rows.recents, lyrics: rows.lyrics, settings: rows.settings});
    });
  }, 'readonly');
}
// Complete backup restore is a single transaction, including all relationships.
export async function importAllRaw({songs = [], playlists = [], recents = [], lyrics = [], settings = []}) {
  const prepared = songs.map(split);
  await atomic(STORES, (store, request) => {
    prepared.forEach(({data, media, state}) => request(store('songs').get(data.id), old => {
      if (old) refs.forEach(ref => { if (old[ref]) request(store('media').delete(old[ref])); });
      request(store('songs').put(data));
      media.forEach(resource => request(store('media').put(resource)));
      request(store('songState').put(state));
    }));
    for (const [name, rows] of Object.entries({playlists, recents, lyrics, settings})) {
      rows.forEach(row => request(store(name).put(row)));
    }
  });
}

export async function wipeDatabase() {
  await atomic(STORES, (store, request) => STORES.forEach(name => request(store(name).clear())));
  resetLocal();
}
