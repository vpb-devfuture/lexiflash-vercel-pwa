// lib/sm2.js
// SM-2 Spaced Repetition Algorithm (SuperMemo 2)
// Reference: https://www.supermemo.com/en/blog/application-of-a-computer-to-improve-the-results-obtained-in-working-with-the-supermemo-method
//
// Quality grades:
//   0 - "Total blackout" — Hoàn toàn không nhớ
//   1 - Incorrect, but on second thought remembered
//   2 - Incorrect, but easy to recall when shown
//   3 - Correct, but with difficulty
//   4 - Correct, after some hesitation
//   5 - Perfect recall

export const QUALITY = {
  AGAIN: 0,   // <2 → reset repetitions
  HARD: 3,    // correct with difficulty
  GOOD: 4,    // correct with hesitation
  EASY: 5     // perfect
};

/**
 * Tính toán review state tiếp theo cho một flashcard dựa trên grade người dùng.
 * @param {Object} card - { repetitions, interval, easeFactor, dueDate }
 * @param {number} quality - 0..5
 * @returns {Object} cập nhật { repetitions, interval, easeFactor, dueDate, lastReviewedAt }
 */
export function reviewCard(card, quality) {
  let { repetitions = 0, interval = 0, easeFactor = 2.5 } = card;

  if (quality < 3) {
    // Trả lời sai → reset repetitions, lặp lại sau 1 ngày
    repetitions = 0;
    interval = 1;
  } else {
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions += 1;
  }

  // Cập nhật ease factor theo công thức SM-2
  easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (easeFactor < 1.3) easeFactor = 1.3;

  const now = Date.now();
  const dueDate = now + interval * 24 * 60 * 60 * 1000;

  return {
    repetitions,
    interval,
    easeFactor: Math.round(easeFactor * 100) / 100,
    dueDate,
    lastReviewedAt: now
  };
}

/**
 * Khởi tạo state SRS cho một card mới.
 */
export function initCard() {
  const now = Date.now();
  return {
    repetitions: 0,
    interval: 0,
    easeFactor: 2.5,
    dueDate: now, // sẵn sàng học ngay
    lastReviewedAt: null,
    createdAt: now
  };
}

/**
 * Lọc ra các card cần học hôm nay (dueDate <= now).
 * Ưu tiên card overdue lâu nhất.
 */
export function getDueCards(cards, now = Date.now()) {
  return cards
    .filter(c => (c.srs?.dueDate ?? 0) <= now)
    .sort((a, b) => (a.srs?.dueDate ?? 0) - (b.srs?.dueDate ?? 0));
}

/**
 * Thống kê retention: % card đã ôn ít nhất 1 lần và quality >= 3.
 */
export function calculateStats(cards) {
  const total = cards.length;
  const reviewed = cards.filter(c => c.srs?.lastReviewedAt).length;
  const mastered = cards.filter(c => (c.srs?.repetitions ?? 0) >= 3).length;
  const due = getDueCards(cards).length;
  const newCards = cards.filter(c => !c.srs?.lastReviewedAt).length;

  return {
    total,
    reviewed,
    mastered,
    due,
    newCards,
    retentionRate: reviewed > 0 ? Math.round((mastered / reviewed) * 100) : 0
  };
}
