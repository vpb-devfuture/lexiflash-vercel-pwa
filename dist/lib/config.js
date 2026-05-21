// lib/config.js
// Quản lý cấu hình & storage cục bộ.
import './browser-storage.js';

const DEFAULTS = {
  geminiApiKey: '',
  googleOAuthClientId: '',
  geminiModel: 'gemini-2.5-flash',
  driveFolderName: 'flashcard-db',
  wordsPerDay: 10,
  difficultyIncrementPerDay: 1,
  currentDifficulty: 1,
  lastGenerationDate: null,
  autoSync: true,
  notificationsEnabled: true,
  theme: 'dark'
};

// Danh sách model đã deprecated, tự động migrate
const DEPRECATED_MODELS = new Set([
  'gemini-2.0-flash-exp',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-1.0-pro',
  'gemini-pro'
]);
const FALLBACK_MODEL = 'gemini-2.5-flash';

function configuredSecret(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('YOUR_')) return '';
  return trimmed;
}

/**
 * Đọc config: global (sync storage) + per-user state (local storage).
 * - Global: model, wordsPerDay, autoSync, notifications (dùng chung tất cả user)
 * - Per-user: currentDifficulty, lastGenerationDate, streakData (mỗi user riêng)
 */
export async function getConfig() {
  // Lấy từ manifest
  const manifest = chrome.runtime.getManifest();
  const manifestConfig = manifest.config || {};
  const manifestGoogleOAuthClientId = configuredSecret(
    manifest.oauth2?.client_id || manifestConfig.GOOGLE_OAUTH_CLIENT_ID
  );

  // Global config từ sync storage
  const stored = await chrome.storage.sync.get(null);
  const storedGoogleOAuthClientId = configuredSecret(stored.googleOAuthClientId);
  if (stored.geminiApiKey) {
    await chrome.storage.sync.remove('geminiApiKey');
  }

  // Auto-migrate deprecated models
  let model = stored.geminiModel || manifestConfig.GEMINI_MODEL || DEFAULTS.geminiModel;
  if (DEPRECATED_MODELS.has(model)) {
    console.warn(`[LexiFlash] Model ${model} deprecated, auto-migrating to ${FALLBACK_MODEL}`);
    model = FALLBACK_MODEL;
    await chrome.storage.sync.set({ geminiModel: FALLBACK_MODEL });
  }

  // Per-user state từ local storage
  const userState = await getUserState();

  return {
    ...DEFAULTS,
    // Global
    geminiApiKey: '',
    googleOAuthClientId: manifestGoogleOAuthClientId || storedGoogleOAuthClientId || DEFAULTS.googleOAuthClientId,
    geminiModel: model,
    driveFolderName: stored.driveFolderName || manifestConfig.DRIVE_FOLDER_NAME || DEFAULTS.driveFolderName,
    wordsPerDay: stored.wordsPerDay ?? manifestConfig.WORDS_PER_DAY ?? DEFAULTS.wordsPerDay,
    difficultyIncrementPerDay: stored.difficultyIncrementPerDay ?? manifestConfig.DIFFICULTY_INCREMENT_PER_DAY ?? DEFAULTS.difficultyIncrementPerDay,
    autoSync: stored.autoSync ?? DEFAULTS.autoSync,
    notificationsEnabled: stored.notificationsEnabled ?? DEFAULTS.notificationsEnabled,
    theme: stored.theme || DEFAULTS.theme,
    credentialsSource: {
      geminiApiKey: 'server',
      googleOAuthClientId: manifestGoogleOAuthClientId ? 'manifest' : (storedGoogleOAuthClientId ? 'storage' : 'empty')
    },
    // Per-user
    currentDifficulty: userState.currentDifficulty ?? DEFAULTS.currentDifficulty,
    lastGenerationDate: userState.lastGenerationDate || null
  };
}

export async function setConfig(patch) {
  // Phân biệt key per-user vs global
  const perUserKeys = ['currentDifficulty', 'lastGenerationDate'];
  const perUser = {};
  const global = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'geminiApiKey') continue;
    if (perUserKeys.includes(k)) perUser[k] = v;
    else global[k] = v;
  }
  if (Object.keys(global).length > 0) {
    await chrome.storage.sync.set(global);
  }
  if (Object.keys(perUser).length > 0) {
    await setUserState(perUser);
  }
}

// =================
// Per-user state
// =================

const USER_STATE_PREFIX = 'user_state_v1_';

async function getUserStateKey() {
  const user = await getCurrentUser();
  return USER_STATE_PREFIX + (user?.userId || 'anonymous');
}

export async function getUserState() {
  const key = await getUserStateKey();
  const result = await chrome.storage.local.get(key);
  return result[key] || {};
}

export async function setUserState(patch) {
  const key = await getUserStateKey();
  const current = await getUserState();
  await chrome.storage.local.set({ [key]: { ...current, ...patch } });
}

/**
 * Storage cho flashcards (local, không sync vì có thể lớn).
 * Namespaced theo userId để hỗ trợ multi-user.
 */
import { getCurrentUser } from './auth.js';

const CARDS_KEY_PREFIX = 'flashcards_v2_';

async function getCardsKey() {
  const user = await getCurrentUser();
  // Fallback "anonymous" cho legacy data (trước khi multi-user)
  return CARDS_KEY_PREFIX + (user?.userId || 'anonymous');
}

export async function loadCards() {
  const key = await getCardsKey();
  const result = await chrome.storage.local.get(key);
  const cards = result[key];
  return Array.isArray(cards) ? cards : [];
}

export async function saveCards(cards) {
  const key = await getCardsKey();
  await chrome.storage.local.set({ [key]: cards });
}

export async function addCards(newCards) {
  const existing = await loadCards();
  const existingWords = new Set(existing.map(c => c.word.toLowerCase()));
  const filtered = newCards.filter(c => !existingWords.has(c.word.toLowerCase()));
  const merged = [...existing, ...filtered];
  await saveCards(merged);
  return filtered.length;
}

export async function updateCard(cardId, patch) {
  const cards = await loadCards();
  const idx = cards.findIndex(c => c.id === cardId);
  if (idx === -1) return null;
  cards[idx] = { ...cards[idx], ...patch };
  await saveCards(cards);
  return cards[idx];
}

/**
 * Xoá toàn bộ flashcards của user hiện tại.
 */
export async function clearCardsForCurrentUser() {
  const key = await getCardsKey();
  await chrome.storage.local.remove(key);
}

/**
 * Migrate legacy data từ key cũ (flashcards_v1) sang current user.
 * Gọi 1 lần sau khi user login đầu tiên.
 */
export async function migrateLegacyCardsToCurrentUser() {
  const legacy = await chrome.storage.local.get('flashcards_v1');
  if (!legacy.flashcards_v1 || !Array.isArray(legacy.flashcards_v1) || legacy.flashcards_v1.length === 0) {
    return 0;
  }
  const current = await loadCards();
  if (current.length > 0) {
    // Đã có data cho user hiện tại, không ghi đè
    return 0;
  }
  await saveCards(legacy.flashcards_v1);
  await chrome.storage.local.remove('flashcards_v1');
  return legacy.flashcards_v1.length;
}
