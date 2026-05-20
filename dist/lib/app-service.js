// lib/app-service.js
// Replaces the Chrome extension background service worker message handlers
// with browser-callable functions for a Vercel/static web deployment.

import './browser-storage.js';
import { generateDailyWords, evaluateSentence } from './gemini.js';
import { initCard } from './sm2.js';
import {
  getConfig,
  setConfig,
  loadCards,
  addCards,
  saveCards,
  clearCardsForCurrentUser,
  migrateLegacyCardsToCurrentUser
} from './config.js';
import { saveToDrive, loadFromDrive, checkDriveConnection } from './drive.js';
import { loginNewUser, ensureDriveAuth, switchUser, logoutUser, getCurrentUser, listUsers } from './auth.js';

export function openSettings() {
  window.location.href = '/settings.html';
}

async function generateBatch({ count, difficulty, theme = '', skipDailyCheck = false } = {}) {
  const config = await getConfig();
  const today = new Date().toISOString().slice(0, 10);

  if (!skipDailyCheck && config.lastGenerationDate === today) {
    return { skipped: true, reason: 'Đã sinh từ hôm nay rồi.' };
  }

  if (!config.geminiApiKey || config.geminiApiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    throw new Error('Thiếu Gemini API key. Cấu hình trong Settings.');
  }

  const existingCards = await loadCards();
  const exclude = existingCards.map(c => c.word);

  const useDifficulty = difficulty ?? config.currentDifficulty;
  const useCount = count ?? config.wordsPerDay;

  const newWords = await generateDailyWords({
    count: useCount,
    difficulty: useDifficulty,
    theme,
    exclude
  });

  const cards = newWords.map(w => ({
    id: crypto.randomUUID(),
    ...w,
    srs: initCard()
  }));

  const added = await addCards(cards);

  if (!skipDailyCheck) {
    const nextDifficulty = Math.min(10, config.currentDifficulty + config.difficultyIncrementPerDay / 3);
    await setConfig({
      lastGenerationDate: today,
      currentDifficulty: Math.round(nextDifficulty * 10) / 10
    });
  }

  return { skipped: false, added, difficulty: useDifficulty };
}

async function trySyncToDrive({ force = false } = {}) {
  const config = await getConfig();
  if (!force && !config.autoSync) return { success: true, skipped: true, reason: 'autoSync disabled' };

  const connected = await checkDriveConnection();
  if (!connected) return { success: true, skipped: true, reason: 'Drive chưa kết nối' };

  const cards = await loadCards();
  await saveToDrive({
    version: 1,
    updatedAt: Date.now(),
    cards,
    meta: {
      currentDifficulty: config.currentDifficulty,
      lastGenerationDate: config.lastGenerationDate
    }
  });
  return { success: true, count: cards.length };
}

async function restoreFromDrive() {
  try {
    const data = await loadFromDrive();
    if (!data || !data.cards) return { success: false, message: 'Không có dữ liệu trên Drive.' };

    await saveCards(data.cards);
    if (data.meta) {
      await setConfig({
        currentDifficulty: data.meta.currentDifficulty,
        lastGenerationDate: data.meta.lastGenerationDate
      });
    }
    return { success: true, count: data.cards.length };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function cleanSwitchToDrive() {
  try {
    await clearCardsForCurrentUser();

    let driveData = null;
    try {
      driveData = await loadFromDrive();
    } catch (e) {
      console.warn('[LexiFlash] Load from Drive after switch failed:', e.message);
      return { success: true, restored: 0 };
    }

    if (!driveData?.cards) return { success: true, restored: 0 };

    await saveCards(driveData.cards);
    if (driveData.meta) {
      await setConfig({
        currentDifficulty: driveData.meta.currentDifficulty,
        lastGenerationDate: driveData.meta.lastGenerationDate
      });
    }
    return { success: true, restored: driveData.cards.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function checkAndRestoreAfterLogin() {
  try {
    const migrated = await migrateLegacyCardsToCurrentUser();
    if (migrated > 0) console.log(`[LexiFlash] Migrated ${migrated} legacy cards to current user`);

    const localCards = await loadCards();
    let driveData = null;
    try {
      driveData = await loadFromDrive();
    } catch (e) {
      console.warn('[LexiFlash] Load from Drive failed:', e.message);
    }

    const localCount = localCards.length;
    const driveCount = driveData?.cards?.length || 0;

    if (localCount === 0 && driveCount === 0) return { success: true, conflict: false };

    if (localCount === 0 && driveCount > 0) {
      await saveCards(driveData.cards);
      if (driveData.meta) {
        await setConfig({
          currentDifficulty: driveData.meta.currentDifficulty,
          lastGenerationDate: driveData.meta.lastGenerationDate
        });
      }
      return { success: true, conflict: false, restored: driveCount };
    }

    if (localCount > 0 && driveCount === 0) {
      await trySyncToDrive({ force: true });
      return { success: true, conflict: false };
    }

    const localWords = new Set(localCards.map(c => c.word.toLowerCase()));
    const driveWords = new Set(driveData.cards.map(c => c.word.toLowerCase()));
    let same = localWords.size === driveWords.size;
    if (same) {
      for (const w of localWords) {
        if (!driveWords.has(w)) { same = false; break; }
      }
    }

    if (same) return { success: true, conflict: false };
    return { success: true, conflict: true, localCount, driveCount };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function resolveConflict(strategy) {
  try {
    if (strategy === 'local') {
      await trySyncToDrive({ force: true });
      return { success: true };
    }

    if (strategy === 'drive') {
      const driveData = await loadFromDrive();
      if (driveData?.cards) {
        await saveCards(driveData.cards);
        if (driveData.meta) {
          await setConfig({
            currentDifficulty: driveData.meta.currentDifficulty,
            lastGenerationDate: driveData.meta.lastGenerationDate
          });
        }
      }
      return { success: true };
    }

    if (strategy === 'merge') {
      const localCards = await loadCards();
      const driveData = await loadFromDrive();
      const driveCards = driveData?.cards || [];
      const byWord = new Map();

      for (const c of [...driveCards, ...localCards]) {
        const key = c.word.toLowerCase();
        const existing = byWord.get(key);
        if (!existing) { byWord.set(key, c); continue; }
        const newReps = c.srs?.repetitions ?? 0;
        const oldReps = existing.srs?.repetitions ?? 0;
        if (newReps > oldReps) byWord.set(key, c);
      }

      const merged = Array.from(byWord.values());
      await saveCards(merged);
      await trySyncToDrive({ force: true });
      return { success: true, count: merged.length };
    }

    return { success: false, error: 'Strategy không hợp lệ' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function sendAppMessage(msg = {}) {
  try {
    switch (msg.type) {
      case 'GENERATE_NOW': {
        await generateBatch({});
        await trySyncToDrive().catch(() => {});
        return { success: true };
      }
      case 'SYNC_NOW': {
        return await trySyncToDrive({ force: msg.force !== false });
      }
      case 'CONNECT_DRIVE':
      case 'ENSURE_DRIVE_AUTH': {
        try {
          const user = await ensureDriveAuth();
          return { success: true, user };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }
      case 'LOGIN_NEW_USER': {
        try {
          const user = await loginNewUser();
          return { success: true, user };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }
      case 'RESTORE_FROM_DRIVE':
        return await restoreFromDrive();
      case 'CHECK_DRIVE': {
        const connected = await checkDriveConnection();
        return { connected };
      }
      case 'FORCE_GENERATE': {
        try {
          const result = await generateBatch({ skipDailyCheck: true });
          trySyncToDrive().catch(() => {});
          return { success: true, added: result.added };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }
      case 'GENERATE_MORE': {
        try {
          const result = await generateBatch({
            count: msg.count || 10,
            difficulty: msg.difficulty,
            theme: msg.theme || '',
            skipDailyCheck: true
          });
          trySyncToDrive().catch(() => {});
          return { success: true, added: result.added };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }
      case 'EVALUATE_SENTENCE': {
        try {
          const result = await evaluateSentence({
            sentence: msg.sentence,
            requiredWords: msg.requiredWords
          });
          return { success: true, result };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }
      case 'SWITCH_USER': {
        try {
          await switchUser(msg.userId);
          const restore = await cleanSwitchToDrive();
          return { success: true, restore };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }
      case 'LOGOUT_USER': {
        try {
          await logoutUser(msg.userId);
          return { success: true };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }
      case 'GET_CURRENT_USER': {
        const user = await getCurrentUser();
        return { success: true, user };
      }
      case 'LIST_USERS': {
        const users = await listUsers();
        return { success: true, users };
      }
      case 'CHECK_AND_RESTORE':
        return await checkAndRestoreAfterLogin();
      case 'RESOLVE_CONFLICT':
        return await resolveConflict(msg.strategy);
      default:
        return { success: false, error: `Unknown message type: ${msg.type}` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}
