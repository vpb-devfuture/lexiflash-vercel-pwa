const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.5-flash';
const MAX_BODY_BYTES = 256 * 1024;

const FLASHCARD_SCHEMA = {
  type: 'OBJECT',
  properties: {
    word: { type: 'STRING', description: 'Tu tieng Anh chinh' },
    ipa: { type: 'STRING', description: 'Phien am IPA, vi du /abandon/' },
    primaryMeaning: { type: 'STRING', description: 'Nghia tieng Viet pho bien nhat' },
    difficulty: { type: 'INTEGER', description: 'Do kho 1-10' },
    forms: {
      type: 'ARRAY',
      description: 'Cac dang tu loai khac nhau cua tu nay',
      items: {
        type: 'OBJECT',
        properties: {
          pos: { type: 'STRING', description: 'Tu loai: n, v, adj, adv, prep...' },
          form: { type: 'STRING', description: 'Dang tu tuong ung' },
          meaning: { type: 'STRING', description: 'Nghia tieng Viet cho dang nay' },
          ipa: { type: 'STRING', description: 'IPA cua dang tu nay' }
        },
        required: ['pos', 'form', 'meaning']
      }
    },
    examples: {
      type: 'ARRAY',
      description: 'It nhat 3 vi du voi vi tri khac nhau trong cau',
      items: {
        type: 'OBJECT',
        properties: {
          sentence: { type: 'STRING', description: 'Cau vi du tieng Anh' },
          translation: { type: 'STRING', description: 'Ban dich tieng Viet' },
          position: { type: 'STRING', description: 'Vi tri tu: dau cau, giua cau, cuoi cau' },
          highlight: { type: 'STRING', description: 'Chuoi con xuat hien chinh xac trong sentence' }
        },
        required: ['sentence', 'translation', 'position', 'highlight']
      }
    },
    mnemonic: { type: 'STRING', description: 'Meo ghi nho ngan gon bang tieng Viet' }
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

const SENTENCE_EVAL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    score: { type: 'INTEGER', description: 'Diem tong 0-100' },
    correct: { type: 'BOOLEAN', description: 'Cau dung ngu phap va dung tu phu hop khong' },
    usedWords: {
      type: 'ARRAY',
      description: 'Cac tu bat buoc ma nguoi dung da su dung',
      items: { type: 'STRING' }
    },
    missingWords: {
      type: 'ARRAY',
      description: 'Cac tu bat buoc nhung khong co trong cau',
      items: { type: 'STRING' }
    },
    grammarFeedback: { type: 'STRING', description: 'Nhan xet ngu phap ngan gon bang tieng Viet' },
    naturalFeedback: { type: 'STRING', description: 'Nhan xet ve do tu nhien bang tieng Viet' },
    correctedSentence: { type: 'STRING', description: 'Phien ban chinh sua neu cau sai' },
    betterAlternative: { type: 'STRING', description: 'Cach dien dat hay hon neu can' }
  },
  required: ['score', 'correct', 'usedWords', 'missingWords', 'grammarFeedback', 'naturalFeedback']
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function firstHeader(value) {
  if (Array.isArray(value)) return value[0] || '';
  return String(value || '').split(',')[0].trim();
}

function parseAllowedOrigins() {
  return String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

function isOriginAllowed(req) {
  const origin = firstHeader(req.headers.origin);
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const host = firstHeader(req.headers['x-forwarded-host'] || req.headers.host);
    if (host && originUrl.host === host) return true;

    if (originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1') {
      return true;
    }

    return parseAllowedOrigins().includes(originUrl.origin);
  } catch {
    return false;
  }
}

function setCorsHeaders(req, res) {
  const origin = firstHeader(req.headers.origin);
  if (origin && isOriginAllowed(req)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
  }
}

function sendJson(req, res, status, payload) {
  setCorsHeaders(req, res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    return req.body ? JSON.parse(req.body) : {};
  }

  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
      throw new HttpError(413, 'Payload quá lớn.');
    }
  }

  return raw ? JSON.parse(raw) : {};
}

function normalizeText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function normalizeList(value, maxItems, maxItemLength) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => normalizeText(item, maxItemLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 10;
  return Math.min(30, Math.max(1, Math.round(count)));
}

function normalizeDifficulty(value) {
  const difficulty = Number(value);
  if (!Number.isFinite(difficulty)) return 1;
  return Math.min(10, Math.max(1, Math.round(difficulty)));
}

function normalizeModel(model) {
  const value = normalizeText(model, 80) || DEFAULT_MODEL;
  if (!/^gemini-[a-z0-9_.-]+$/i.test(value)) {
    throw new HttpError(400, 'Model Gemini không hợp lệ.');
  }
  return value;
}

function buildDailyWordsPrompt({ count, difficulty, exclude, theme }) {
  const excludeStr = exclude.length > 0
    ? `Không được trùng với các từ sau: ${exclude.slice(-50).join(', ')}.`
    : '';

  const themeStr = theme
    ? `Chủ đề: ${theme}.`
    : 'Chủ đề: đa dạng, hữu ích cho giao tiếp và công việc văn phòng.';

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
  }[difficulty] || 'trung cấp';

  return `Bạn là chuyên gia dạy tiếng Anh cho người Việt. Hãy sinh ${count} từ vựng tiếng Anh ở trình độ ${difficultyDesc}.

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
}

function buildEvaluatePrompt({ sentence, requiredWords }) {
  return `Bạn là giáo viên tiếng Anh nghiêm khắc nhưng công bằng, chấm bài cho học viên người Việt.

Học viên được yêu cầu đặt MỘT câu tiếng Anh có chứa các từ sau: ${requiredWords.join(', ')}.
Học viên đặt: "${sentence}"

Hãy chấm theo các tiêu chí:
1. CÓ DÙNG TỪ KHÔNG? Liệt kê từ nào đã được dùng (chấp nhận mọi dạng từ: V -> V-ing, V-ed, N số nhiều, etc.) vào usedWords. Từ nào còn thiếu vào missingWords.
2. NGỮ PHÁP có đúng không? Comment ngắn gọn về cấu trúc, thì, agreement... bằng tiếng Việt.
3. ĐỘ TỰ NHIÊN: câu có nghe như người bản xứ nói không? Có collocation đúng không? Có dùng đúng nghĩa/ngữ cảnh của từ không?
4. CHẤM ĐIỂM 0-100:
   - 0-30: thiếu từ chính/sai nghiêm trọng
   - 31-60: dùng đủ từ nhưng nhiều lỗi ngữ pháp hoặc không tự nhiên
   - 61-80: đúng ngữ pháp, dùng từ tốt, có thể cải thiện
   - 81-100: câu tự nhiên, đúng collocation, gần như hoàn hảo
5. correct = true nếu score >= 70.
6. Nếu câu có lỗi, đưa ra correctedSentence (phiên bản đã sửa, vẫn dùng các từ yêu cầu).
7. Nếu câu OK nhưng có cách diễn đạt hay hơn, gợi ý ở betterAlternative.

QUAN TRỌNG: chấm dựa trên CHẤT LƯỢNG NGÔN NGỮ, không dựa trên độ phức tạp. Câu đơn giản đúng > câu phức tạp sai.`;
}

function parseGeminiError(status, rawText, model) {
  let message = `Gemini API error ${status}`;
  try {
    const data = JSON.parse(rawText);
    message = data?.error?.message || message;
  } catch {}

  if (status === 400 && message.includes('API key not valid')) {
    return 'GEMINI_API_KEY trên Vercel không hợp lệ. Hãy tạo key mới trong Google AI Studio.';
  }
  if (status === 403) {
    return 'Gemini API bị từ chối (403). Kiểm tra key, quota, billing hoặc Gemini API đã được enable chưa.';
  }
  if (status === 404) {
    return `Model "${model}" không tồn tại hoặc không khả dụng. Thử chọn model khác.`;
  }
  if (status === 429) {
    return 'Gemini API vượt quota. Đợi một lát rồi thử lại hoặc nâng cấp quota.';
  }
  return message;
}

function buildThinkingConfig(model) {
  const value = String(model || '').toLowerCase();

  if (value.startsWith('gemini-3')) {
    return { thinkingLevel: 'low' };
  }

  if (value.startsWith('gemini-2.5-flash')) {
    return { thinkingBudget: 0 };
  }

  if (value.startsWith('gemini-2.5-pro')) {
    return { thinkingBudget: 128 };
  }

  return null;
}

function extractGeminiText(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  return candidates
    .flatMap(candidate => Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [])
    .filter(part => !part?.thought && typeof part?.text === 'string')
    .map(part => part.text)
    .join('\n')
    .trim();
}

function getUsageValue(usage, camelKey, snakeKey) {
  return usage?.[camelKey] ?? usage?.[snakeKey];
}

function explainEmptyGeminiResponse(data) {
  const promptBlockReason = data?.promptFeedback?.blockReason;
  if (promptBlockReason) {
    return `Gemini chặn prompt (${promptBlockReason}). Hãy chỉnh nội dung yêu cầu và thử lại.`;
  }

  const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : null;
  const finishReason = candidate?.finishReason;
  if (finishReason === 'MAX_TOKENS') {
    return 'Gemini hết giới hạn output token trước khi trả nội dung. Hãy thử lại hoặc chọn model nhanh hơn.';
  }
  if (finishReason && finishReason !== 'STOP') {
    return `Gemini không trả nội dung (finishReason: ${finishReason}). Hãy thử lại hoặc chọn model khác.`;
  }

  const usage = data?.usageMetadata || data?.usage_metadata || {};
  const thoughtsTokenCount = getUsageValue(usage, 'thoughtsTokenCount', 'thoughts_token_count');
  if (Number(thoughtsTokenCount) > 0) {
    return `Gemini đã dùng ${thoughtsTokenCount} thinking token nhưng không trả nội dung. Hãy thử lại hoặc chọn model nhanh hơn.`;
  }

  return 'Gemini trả về dữ liệu rỗng.';
}

async function callGemini({ prompt, schema, model, maxOutputTokens = 8192 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new HttpError(500, 'Server chưa cấu hình GEMINI_API_KEY trong Vercel Environment Variables.');
  }

  const generationConfig = {
    temperature: 0.8,
    topP: 0.95,
    maxOutputTokens
  };

  const thinkingConfig = buildThinkingConfig(model);
  if (thinkingConfig) {
    generationConfig.thinkingConfig = thinkingConfig;
  }

  if (schema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = schema;
  }

  const upstream = await fetch(`${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig
    })
  });

  if (!upstream.ok) {
    const rawText = await upstream.text();
    throw new HttpError(upstream.status, parseGeminiError(upstream.status, rawText, model));
  }

  const data = await upstream.json();
  const text = extractGeminiText(data);
  if (!text) {
    throw new HttpError(502, explainEmptyGeminiResponse(data));
  }

  if (!schema) return text;

  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(502, 'Gemini trả về JSON không hợp lệ. Hãy thử lại.');
  }
}

async function handler(req, res) {
  try {
    if (!isOriginAllowed(req)) {
      return sendJson(req, res, 403, { ok: false, error: 'Origin không được phép gọi Gemini proxy.' });
    }

    if (req.method === 'OPTIONS') {
      setCorsHeaders(req, res);
      res.statusCode = 204;
      return res.end();
    }

    if (req.method !== 'POST') {
      return sendJson(req, res, 405, { ok: false, error: 'Method not allowed.' });
    }

    const body = await readJsonBody(req);
    const action = normalizeText(body.action, 40);
    const model = normalizeModel(body.model);

    if (action === 'test') {
      await callGemini({ prompt: 'Say "ok".', model, maxOutputTokens: 256 });
      return sendJson(req, res, 200, { ok: true, result: { ok: true } });
    }

    if (action === 'generateDailyWords') {
      const count = normalizeCount(body.count);
      const difficulty = normalizeDifficulty(body.difficulty);
      const exclude = normalizeList(body.exclude, 50, 80);
      const theme = normalizeText(body.theme, 160);
      const prompt = buildDailyWordsPrompt({ count, difficulty, exclude, theme });
      const result = await callGemini({ prompt, schema: BATCH_SCHEMA, model });
      return sendJson(req, res, 200, { ok: true, result });
    }

    if (action === 'evaluateSentence') {
      const sentence = normalizeText(body.sentence, 2000);
      const requiredWords = normalizeList(body.requiredWords, 10, 80);
      if (!sentence || requiredWords.length === 0) {
        throw new HttpError(400, 'Thiếu câu hoặc danh sách từ bắt buộc.');
      }
      const prompt = buildEvaluatePrompt({ sentence, requiredWords });
      const result = await callGemini({ prompt, schema: SENTENCE_EVAL_SCHEMA, model, maxOutputTokens: 4096 });
      return sendJson(req, res, 200, { ok: true, result });
    }

    return sendJson(req, res, 400, { ok: false, error: 'Action không hợp lệ.' });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof SyntaxError ? 'JSON request không hợp lệ.' : (err.message || 'Server error.');
    return sendJson(req, res, status, { ok: false, error: message });
  }
}

module.exports = handler;
module.exports.default = handler;
