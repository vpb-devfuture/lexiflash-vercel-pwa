// lib/gemini.js
// Gemini API client - sinh nội dung flashcard tự động

import { getConfig } from './config.js';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Schema JSON cho 1 flashcard sinh bởi Gemini.
 * Sử dụng structured output (responseSchema) để đảm bảo dữ liệu nhất quán.
 */
const FLASHCARD_SCHEMA = {
  type: 'OBJECT',
  properties: {
    word: { type: 'STRING', description: 'Từ tiếng Anh chính' },
    ipa: { type: 'STRING', description: 'Phiên âm IPA, ví dụ /əˈbændən/' },
    primaryMeaning: { type: 'STRING', description: 'Nghĩa tiếng Việt phổ biến nhất' },
    difficulty: { type: 'INTEGER', description: 'Độ khó 1-10 (1=cơ bản, 10=học thuật)' },
    forms: {
      type: 'ARRAY',
      description: 'Các dạng từ loại khác nhau của từ này',
      items: {
        type: 'OBJECT',
        properties: {
          pos: { type: 'STRING', description: 'Từ loại: n, v, adj, adv, prep...' },
          form: { type: 'STRING', description: 'Dạng từ tương ứng (vd: noun form, verb form)' },
          meaning: { type: 'STRING', description: 'Nghĩa tiếng Việt cho dạng này' },
          ipa: { type: 'STRING', description: 'IPA của dạng từ này' }
        },
        required: ['pos', 'form', 'meaning']
      }
    },
    examples: {
      type: 'ARRAY',
      description: 'Ít nhất 3 ví dụ với vị trí khác nhau trong câu',
      items: {
        type: 'OBJECT',
        properties: {
          sentence: { type: 'STRING', description: 'Câu ví dụ tiếng Anh' },
          translation: { type: 'STRING', description: 'Bản dịch tiếng Việt' },
          position: { type: 'STRING', description: 'Vị trí từ: "đầu câu", "giữa câu", "cuối câu"' },
          highlight: { type: 'STRING', description: 'Phần cần highlight (chính xác chứa trong sentence)' }
        },
        required: ['sentence', 'translation', 'position', 'highlight']
      }
    },
    mnemonic: { type: 'STRING', description: 'Mẹo ghi nhớ ngắn gọn bằng tiếng Việt' }
  },
  required: ['word', 'ipa', 'primaryMeaning', 'difficulty', 'forms', 'examples']
};

const BATCH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    cards: {
      type: 'ARRAY',
      items: FLASHCARD_SCHEMA
    }
  },
  required: ['cards']
};

/**
 * Gọi Gemini API với structured output.
 */
async function callGemini(prompt, schema, apiKey, model) {
  const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.8,
      topP: 0.95,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema: schema
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini trả về dữ liệu rỗng');

  return JSON.parse(text);
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
  const config = await getConfig();
  if (!config.geminiApiKey || config.geminiApiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    throw new Error('Chưa cấu hình Gemini API key. Vào trang Options để thiết lập.');
  }

  const excludeStr = exclude.length > 0
    ? `Không được trùng với các từ sau: ${exclude.slice(-50).join(', ')}.`
    : '';

  const themeStr = theme ? `Chủ đề: ${theme}.` : 'Chủ đề: đa dạng, hữu ích cho giao tiếp và công việc văn phòng.';

  const difficultyDesc = {
    1: 'cơ bản A1 (gia đình, màu sắc, số đếm, hoạt động hàng ngày)',
    2: 'A2 (sở thích, du lịch, mua sắm)',
    3: 'B1 thấp (cảm xúc, miêu tả người, công việc đơn giản)',
    4: 'B1 (giao tiếp công sở, ý kiến cá nhân)',
    5: 'B1+ (thảo luận chủ đề xã hội, công nghệ)',
    6: 'B2 (học thuật cơ bản, nghề nghiệp chuyên môn)',
    7: 'B2+ (báo chí, kinh doanh)',
    8: 'C1 (học thuật, phân tích, lập luận)',
    9: 'C1+ (chuyên ngành kỹ thuật, tài chính)',
    10: 'C2 (văn học, học thuật cao cấp, từ hiếm)'
  }[Math.min(10, Math.max(1, difficulty))] || 'trung cấp';

  const prompt = `Bạn là chuyên gia dạy tiếng Anh cho người Việt. Hãy sinh ${count} từ vựng tiếng Anh ở trình độ ${difficultyDesc}.

Yêu cầu nghiêm ngặt cho MỖI từ:
1. Từ phải hữu ích, thường gặp ở trình độ này, KHÔNG sinh từ quá hiếm hoặc archaic.
2. IPA phải chính xác theo British/American chuẩn (dùng /.../ bao quanh).
3. Liệt kê TẤT CẢ các từ loại có thật của từ đó (noun, verb, adjective, adverb...). Nếu từ chỉ có 1 từ loại thì chỉ liệt kê 1. KHÔNG bịa thêm từ loại không tồn tại.
4. Với mỗi từ loại, ghi rõ DẠNG TỪ thực tế (ví dụ với "decide": v=decide, n=decision, adj=decisive, adv=decisively).
5. Ít nhất 3 ví dụ, MỖI VÍ DỤ phải thể hiện vị trí khác nhau của từ trong câu (đầu/giữa/cuối). Phần "highlight" PHẢI là chuỗi con xuất hiện chính xác trong "sentence".
6. Mnemonic ngắn gọn, sáng tạo, dễ nhớ bằng tiếng Việt.
7. Difficulty là số nguyên 1-10 phản ánh độ khó thực tế của từ.

${themeStr}
${excludeStr}

Trả về JSON đúng schema, không kèm văn bản khác.`;

  const result = await callGemini(prompt, BATCH_SCHEMA, config.geminiApiKey, config.geminiModel);
  return result.cards || [];
}

// === Sentence Challenge ===

const SENTENCE_EVAL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    score: { type: 'INTEGER', description: 'Điểm tổng 0-100' },
    correct: { type: 'BOOLEAN', description: 'Câu có đúng ngữ pháp và sử dụng từ phù hợp không' },
    usedWords: {
      type: 'ARRAY',
      description: 'Các từ được yêu cầu mà người dùng thực sự đã dùng trong câu (kể cả các dạng word forms)',
      items: { type: 'STRING' }
    },
    missingWords: {
      type: 'ARRAY',
      description: 'Các từ được yêu cầu nhưng không có trong câu',
      items: { type: 'STRING' }
    },
    grammarFeedback: { type: 'STRING', description: 'Nhận xét ngữ pháp ngắn gọn bằng tiếng Việt' },
    naturalFeedback: { type: 'STRING', description: 'Nhận xét về độ tự nhiên/đúng ngữ cảnh, bằng tiếng Việt' },
    correctedSentence: { type: 'STRING', description: 'Phiên bản chỉnh sửa nếu câu sai, để trống nếu câu đúng' },
    betterAlternative: { type: 'STRING', description: 'Một cách diễn đạt hay hơn (optional), để trống nếu không cần' }
  },
  required: ['score', 'correct', 'usedWords', 'missingWords', 'grammarFeedback', 'naturalFeedback']
};

/**
 * Chấm điểm câu người dùng đặt với các từ yêu cầu.
 */
export async function evaluateSentence({ sentence, requiredWords }) {
  const config = await getConfig();
  if (!config.geminiApiKey || config.geminiApiKey === 'YOUR_GEMINI_API_KEY_HERE') {
    throw new Error('Chưa cấu hình Gemini API key.');
  }

  const prompt = `Bạn là giáo viên tiếng Anh nghiêm khắc nhưng công bằng, chấm bài cho học viên người Việt.

Học viên được yêu cầu đặt MỘT câu tiếng Anh có chứa các từ sau: ${requiredWords.join(', ')}.
Học viên đặt: "${sentence}"

Hãy chấm theo các tiêu chí:
1. CÓ DÙNG TỪ KHÔNG? Liệt kê từ nào đã được dùng (chấp nhận mọi dạng từ: V→V-ing, V-ed, N số nhiều, etc.) vào usedWords. Từ nào còn thiếu vào missingWords.
2. NGỮ PHÁP có đúng không? Comment ngắn gọn về cấu trúc, thì, agreement... bằng tiếng Việt.
3. DỘ TỰ NHIÊN: câu có nghe như người bản xứ nói không? Có collocation đúng không? Có dùng đúng nghĩa/ngữ cảnh của từ không?
4. CHẤM ĐIỂM 0-100: 
   - 0-30: thiếu từ chính/sai nghiêm trọng
   - 31-60: dùng đủ từ nhưng nhiều lỗi ngữ pháp hoặc không tự nhiên
   - 61-80: đúng ngữ pháp, dùng từ tốt, có thể cải thiện
   - 81-100: câu tự nhiên, đúng collocation, gần như hoàn hảo
5. correct = true nếu score >= 70.
6. Nếu câu có lỗi, đưa ra correctedSentence (phiên bản đã sửa, vẫn dùng các từ yêu cầu).
7. Nếu câu OK nhưng có cách diễn đạt hay hơn, gợi ý ở betterAlternative.

QUAN TRỌNG: chấm dựa trên CHẤT LƯỢNG NGÔN NGỮ, không dựa trên độ phức tạp. Câu đơn giản đúng > câu phức tạp sai.`;

  return await callGemini(prompt, SENTENCE_EVAL_SCHEMA, config.geminiApiKey, config.geminiModel);
}

/**
 * Kiểm tra API key có hợp lệ không.
 * @returns {Object} { ok: boolean, status?: number, error?: string }
 */
export async function testApiKey(apiKey, model = 'gemini-2.5-flash') {
  try {
    if (!apiKey || apiKey.trim() === '' || apiKey === 'YOUR_GEMINI_API_KEY_HERE') {
      return { ok: false, error: 'API key trống hoặc chưa được thay placeholder.' };
    }

    const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Say "ok".' }] }],
        generationConfig: { maxOutputTokens: 10 }
      })
    });

    if (res.ok) {
      return { ok: true };
    }

    const errText = await res.text();
    let errMsg = `HTTP ${res.status}`;
    try {
      const errJson = JSON.parse(errText);
      errMsg = errJson?.error?.message || errMsg;
    } catch {}

    // Giải thích lỗi thường gặp
    if (res.status === 400) {
      if (errMsg.includes('API key not valid')) {
        return { ok: false, status: 400, error: 'API key không hợp lệ. Kiểm tra lại key tại aistudio.google.com.' };
      }
      return { ok: false, status: 400, error: `Lỗi 400: ${errMsg}` };
    }
    if (res.status === 403) {
      return { ok: false, status: 403, error: 'API key bị từ chối (403). Có thể chưa enable Gemini API hoặc bị hạn chế quốc gia.' };
    }
    if (res.status === 404) {
      return { ok: false, status: 404, error: `Model "${model}" không tồn tại hoặc đã bị deprecated. Thử model khác.` };
    }
    if (res.status === 429) {
      return { ok: false, status: 429, error: 'Vượt quota. Đợi một lát rồi thử lại, hoặc nâng cấp tier.' };
    }
    return { ok: false, status: res.status, error: errMsg };
  } catch (e) {
    return { ok: false, error: 'Lỗi mạng: ' + e.message };
  }
}
