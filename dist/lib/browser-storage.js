// lib/browser-storage.js
// Browser compatibility layer for the original Chrome extension code.
// It emulates the small subset of chrome.storage/runtime used by LexiFlash
// so the app can run as a normal web app on Vercel.

const PREFIX = {
  local: 'lexiflash.local.',
  sync: 'lexiflash.sync.'
};

const DEFAULT_MANIFEST = {
  name: 'LexiFlash Web',
  version: '1.0.0-web',
  oauth2: {
    client_id: ''
  },
  config: {
    GEMINI_API_KEY: '',
    GEMINI_MODEL: 'gemini-2.5-flash',
    DRIVE_FOLDER_NAME: 'flashcard-db',
    WORDS_PER_DAY: 10,
    DIFFICULTY_INCREMENT_PER_DAY: 1
  }
};

function storageKey(area, key) {
  return `${PREFIX[area]}${key}`;
}

function read(area, key) {
  const raw = localStorage.getItem(storageKey(area, key));
  if (raw == null) return undefined;
  try { return JSON.parse(raw); } catch { return raw; }
}

function write(area, key, value) {
  if (value === undefined) localStorage.removeItem(storageKey(area, key));
  else localStorage.setItem(storageKey(area, key), JSON.stringify(value));
}

function listArea(area) {
  const out = {};
  const prefix = PREFIX[area];
  for (let i = 0; i < localStorage.length; i++) {
    const fullKey = localStorage.key(i);
    if (!fullKey || !fullKey.startsWith(prefix)) continue;
    const key = fullKey.slice(prefix.length);
    out[key] = read(area, key);
  }
  return out;
}

function createStorageArea(area) {
  return {
    async get(keys = null) {
      if (keys == null) return listArea(area);

      if (typeof keys === 'string') {
        return { [keys]: read(area, keys) };
      }

      if (Array.isArray(keys)) {
        const out = {};
        for (const key of keys) out[key] = read(area, key);
        return out;
      }

      if (typeof keys === 'object') {
        const out = {};
        for (const [key, defaultValue] of Object.entries(keys)) {
          const value = read(area, key);
          out[key] = value === undefined ? defaultValue : value;
        }
        return out;
      }

      return {};
    },

    async set(items) {
      for (const [key, value] of Object.entries(items || {})) write(area, key, value);
    },

    async remove(keys) {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const key of arr) localStorage.removeItem(storageKey(area, key));
    },

    async clear() {
      const prefix = PREFIX[area];
      const toDelete = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) toDelete.push(key);
      }
      toDelete.forEach(key => localStorage.removeItem(key));
    }
  };
}

function getManifest() {
  return window.LEXIFLASH_MANIFEST || DEFAULT_MANIFEST;
}

function getURL(path) {
  return new URL(path, window.location.origin + '/').toString();
}

function openOptionsPage() {
  window.location.href = '/settings.html';
}

if (!window.chrome) window.chrome = {};

window.chrome.storage = window.chrome.storage || {
  local: createStorageArea('local'),
  sync: createStorageArea('sync')
};

window.chrome.runtime = window.chrome.runtime || {
  id: window.location.origin,
  getManifest,
  getURL,
  openOptionsPage,
  async sendMessage(msg) {
    const mod = await import('./app-service.js');
    return mod.sendAppMessage(msg);
  }
};

// Exported for web-native modules that do not want to touch window.chrome directly.
export const storage = window.chrome.storage;
export const runtime = window.chrome.runtime;
export function getSyncStorageKey(key) { return storageKey('sync', key); }
