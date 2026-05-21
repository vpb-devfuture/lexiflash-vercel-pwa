// lib/gemini.js
// Browser client for the server-side Gemini proxy.

import { getConfig } from './config.js';

const GEMINI_API_ENDPOINT = '/api/gemini';
const DEFAULT_MODEL = 'gemini-2.5-flash';

async function readJsonResponse(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text };
  }
}

async function callGeminiServer(action, payload = {}, modelOverride = '') {
  const config = await getConfig();
  const model = modelOverride || config.geminiModel || DEFAULT_MODEL;

  const res = await fetch(GEMINI_API_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      model,
      ...payload
    })
  });

  const data = await readJsonResponse(res);
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `Gemini backend error ${res.status}`);
    err.status = res.status;
    throw err;
  }

  return data.result;
}

/**
 * Sinh batch flashcard cho một ngày học.
 * @param {Object} opts
 * @param {number} opts.count - số từ cần sinh
 * @param {number} opts.difficulty - độ khó (1-10)
 * @param {string[]} opts.exclude - danh sách từ đã có (tránh trùng)
 * @param {string} opts.theme - chủ đề (optional)
 */
export async function generateDailyWords({ count = 10, difficulty = 1, exclude = [], theme = '' } = {}) {
  const result = await callGeminiServer('generateDailyWords', {
    count,
    difficulty,
    exclude,
    theme
  });
  return Array.isArray(result?.cards) ? result.cards : [];
}

/**
 * Chấm điểm câu người dùng đặt với các từ yêu cầu.
 */
export async function evaluateSentence({ sentence, requiredWords }) {
  return await callGeminiServer('evaluateSentence', { sentence, requiredWords });
}

/**
 * Kiểm tra server-side Gemini config trên Vercel/local env.
 * Tham số apiKey được giữ lại để không phá import/call cũ, nhưng không dùng ở client nữa.
 * @returns {Object} { ok: boolean, status?: number, error?: string }
 */
export async function testApiKey(_apiKey = '', model = DEFAULT_MODEL) {
  try {
    await callGeminiServer('test', {}, model);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      status: e.status,
      error: e.message || 'Không kiểm tra được Gemini backend.'
    };
  }
}
