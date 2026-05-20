// popup/popup.js
// Main controller for the flashcard popup.

import { loadCards, saveCards, getConfig, setConfig, getUserState, setUserState } from '../lib/config.js';
import { reviewCard, QUALITY, getDueCards, calculateStats } from '../lib/sm2.js';
import { getCurrentUser, listUsers, loginNewUser, setCurrentUser, logoutUser, isClientIdConfigured } from '../lib/auth.js';
import { sendAppMessage, openSettings } from '../lib/app-service.js';

// State
let allCards = [];
let queue = [];
let currentCard = null;
let sessionStats = { reviewed: 0, correct: 0 };
let isFlipped = false;

// === DOM refs ===
const $ = (id) => document.getElementById(id);
const els = {
  stage: $('cardStage'),
  card: $('flashcard'),
  frontWord: $('frontWord'),
  frontIpa: $('frontIpa'),
  frontPos: $('frontPos'),
  difficultyDots: $('difficultyDots'),
  backMeaning: $('backMeaning'),
  backMnemonic: $('backMnemonic'),
  reviewControls: $('reviewControls'),
  progressFill: $('progressFill'),
  progressLabel: $('progressLabel'),
  streakCount: $('streakCount'),
  stateLoading: $('stateLoading'),
  stateEmpty: $('stateEmpty'),
  stateDone: $('stateDone'),
  doneReviewed: $('doneReviewed'),
  doneAccuracy: $('doneAccuracy'),
  toast: $('toast')
};

// === Init ===
init();

async function init() {
  // BIND GLOBAL HANDLERS NGAY — đảm bảo nút Settings, Stats luôn hoạt động
  bindGlobalHandlers();
  bindLoginHandlers();

  showLoading('Đang khởi tạo...');

  // STEP 1: Check OAuth client_id configured
  if (!isClientIdConfigured()) {
    showLoginState('⚠️ OAuth chưa cấu hình. Vào Settings để xem hướng dẫn.', true);
    return;
  }

  // STEP 2: Check authentication
  let currentUser = null;
  try {
    currentUser = await getCurrentUser();
  } catch (e) {
    console.error('Get current user failed:', e);
  }

  if (!currentUser) {
    showLoginState();
    return;
  }

  // STEP 3: Update avatar UI
  updateAvatarUI(currentUser);

  // STEP 4: Load cards for this user
  try {
    allCards = await loadCards();
  } catch (e) {
    console.error('Load cards failed:', e);
    allCards = [];
  }

  if (allCards.length === 0) {
    showState('empty');
    bindEmptyState();
    return;
  }

  // STEP 5: Restore today's session stats (nếu popup đã bị đóng giữa chừng)
  try {
    await restoreSessionStats();
  } catch (e) {
    console.error('Restore session stats failed:', e);
  }

  queue = getDueCards(allCards);
  bindCardHandlers();

  if (queue.length === 0) {
    showDoneState();
  } else {
    hideAllStates();
    nextCard();
  }

  try {
    await updateStreak();
  } catch (e) {
    console.error('Streak update failed:', e);
  }
}

function showLoginState(hintMessage = '', isError = false) {
  // Hide all other states + card area
  ['loading', 'empty', 'done'].forEach(s => {
    const el = $('state' + s.charAt(0).toUpperCase() + s.slice(1));
    if (el) el.classList.add('hidden');
  });
  els.stage.classList.add('hidden');
  els.reviewControls.classList.add('hidden');
  $('stateLogin').classList.remove('hidden');

  const hint = $('loginHint');
  if (hintMessage) {
    hint.textContent = hintMessage;
    hint.classList.toggle('error', isError);
  } else {
    hint.textContent = '';
    hint.classList.remove('error');
  }
}

function updateAvatarUI(user) {
  const btn = $('btnAccount');
  if (!user) {
    btn.classList.remove('logged-in', 'has-image');
    $('avatarImg').src = '';
    $('avatarFallback').textContent = 'L';
    $('brandName').textContent = 'LexiFlash';
    $('brandTagline').textContent = 'Daily English mastery';
    return;
  }
  btn.classList.add('logged-in');
  if (user.picture) {
    $('avatarImg').src = user.picture;
    btn.classList.add('has-image');
  } else {
    btn.classList.remove('has-image');
    $('avatarFallback').textContent = (user.name || user.email || 'U')[0].toUpperCase();
  }
  $('brandName').textContent = user.name || user.email || 'User';
  $('brandTagline').textContent = user.email || 'LexiFlash';
}

function bindLoginHandlers() {
  $('btnLoginGoogle').addEventListener('click', async () => {
    const btn = $('btnLoginGoogle');
    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Đang đăng nhập...</span>';

    const result = await sendAppMessage({ type: 'LOGIN_NEW_USER' });
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg><span>Đăng nhập với Google</span>';

    if (result?.success) {
      // Đăng nhập thành công → reload để load data của user mới
      // Trước đó: check Drive xem có data cần restore không
      await handlePostLogin();
    } else {
      const hint = $('loginHint');
      hint.textContent = '❌ ' + (result?.error || 'Đăng nhập thất bại');
      hint.classList.add('error');
    }
  });
}

/**
 * Sau khi đăng nhập thành công, kiểm tra:
 * - Có data trên Drive không? → có thể cần restore
 * - Có conflict giữa local (legacy) và Drive không?
 */
async function handlePostLogin() {
  showLoading('Đang kiểm tra dữ liệu trên Drive...');

  // Try restoring from Drive
  const restoreResult = await sendAppMessage({ type: 'CHECK_AND_RESTORE' });

  if (restoreResult?.conflict) {
    // Show conflict dialog
    showConflictDialog(restoreResult.localCount, restoreResult.driveCount);
    return;
  }

  // No conflict → reload UI
  setTimeout(() => location.reload(), 500);
}

function showConflictDialog(localCount, driveCount) {
  $('localStats').textContent = `${localCount} flashcard trên máy này`;
  $('driveStats').textContent = `${driveCount} flashcard trên Drive`;
  $('dialogConflict').classList.remove('hidden');

  $('btnUseLocal').onclick = async () => {
    $('dialogConflict').classList.add('hidden');
    showLoading('Đang dùng dữ liệu máy này...');
    await sendAppMessage({ type: 'RESOLVE_CONFLICT', strategy: 'local' });
    setTimeout(() => location.reload(), 400);
  };
  $('btnUseDrive').onclick = async () => {
    $('dialogConflict').classList.add('hidden');
    showLoading('Đang tải từ Drive...');
    await sendAppMessage({ type: 'RESOLVE_CONFLICT', strategy: 'drive' });
    setTimeout(() => location.reload(), 400);
  };
  $('btnMergeData').onclick = async () => {
    $('dialogConflict').classList.add('hidden');
    showLoading('Đang gộp dữ liệu...');
    await sendAppMessage({ type: 'RESOLVE_CONFLICT', strategy: 'merge' });
    setTimeout(() => location.reload(), 400);
  };
}

// === UI state helpers ===
function showLoading(msg = 'Đang tải...') {
  showState('loading');
  $('loadingText').textContent = msg;
}

function showState(name) {
  ['loading', 'empty', 'done', 'login'].forEach(s => {
    const el = $('state' + s.charAt(0).toUpperCase() + s.slice(1));
    if (el) el.classList.toggle('hidden', s !== name);
  });
  els.stage.classList.toggle('hidden', name !== null);
  els.reviewControls.classList.add('hidden');
}

function hideAllStates() {
  els.stateLoading.classList.add('hidden');
  els.stateEmpty.classList.add('hidden');
  els.stateDone.classList.add('hidden');
  $('stateLogin').classList.add('hidden');
  els.stage.classList.remove('hidden');
}

function showDoneState() {
  showState('done');
  els.doneReviewed.textContent = sessionStats.reviewed;
  const acc = sessionStats.reviewed > 0
    ? Math.round((sessionStats.correct / sessionStats.reviewed) * 100)
    : 0;
  els.doneAccuracy.textContent = acc + '%';
}

function toast(msg, ms = 2200) {
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  els.toast.classList.add('show');
  setTimeout(() => {
    els.toast.classList.remove('show');
    setTimeout(() => els.toast.classList.add('hidden'), 300);
  }, ms);
}

// === Card rendering ===
function nextCard() {
  if (queue.length === 0) {
    showDoneState();
    return;
  }
  currentCard = queue.shift();
  isFlipped = false;
  renderCard(currentCard);
  updateProgress();
}

function renderCard(card) {
  els.card.classList.remove('flipped', 'swap-out');
  els.card.classList.add('swap-in');
  setTimeout(() => els.card.classList.remove('swap-in'), 400);

  els.frontWord.textContent = card.word;
  els.frontIpa.textContent = card.ipa || '';
  els.frontPos.textContent = (card.forms?.[0]?.pos) || 'word';

  // Difficulty dots (0-10 scaled to 5 dots)
  const dotCount = 5;
  const filled = Math.ceil((card.difficulty || 1) / 2);
  els.difficultyDots.innerHTML = Array.from({ length: dotCount }, (_, i) =>
    `<span class="dot ${i < filled ? 'active' : ''}"></span>`
  ).join('');

  els.backMeaning.textContent = card.primaryMeaning;
  if (card.mnemonic) {
    els.backMnemonic.textContent = card.mnemonic;
    els.backMnemonic.classList.remove('hidden');
  } else {
    els.backMnemonic.classList.add('hidden');
  }

  // Update interval previews on grade buttons
  updateGradePreviews(card);

  els.reviewControls.classList.add('hidden');
}

function updateGradePreviews(card) {
  const previews = {
    0: '<1m',
    3: prettyInterval(intervalAfter(card, 3)),
    4: prettyInterval(intervalAfter(card, 4)),
    5: prettyInterval(intervalAfter(card, 5))
  };
  document.querySelectorAll('[data-interval-for]').forEach(el => {
    const q = parseInt(el.dataset.intervalFor);
    el.textContent = previews[q] || '';
  });
}

function intervalAfter(card, q) {
  const sim = reviewCard(card.srs || {}, q);
  return sim.interval;
}

function prettyInterval(days) {
  if (days < 1) return '<1d';
  if (days === 1) return '1d';
  if (days < 30) return days + 'd';
  if (days < 365) return Math.round(days / 30) + 'mo';
  return Math.round(days / 365) + 'y';
}

function updateProgress() {
  const reviewed = sessionStats.reviewed;
  const total = reviewed + queue.length + (currentCard ? 1 : 0);
  els.progressLabel.textContent = `Hôm nay · ${reviewed}/${total}`;
  const pct = total > 0 ? (reviewed / total) * 100 : 0;
  els.progressFill.style.width = pct + '%';
}

// === Handlers ===
async function bindEmptyState() {
  // Check API key trước để hiển thị message phù hợp
  const config = await getConfig();
  const hasKey = config.geminiApiKey && config.geminiApiKey !== 'YOUR_GEMINI_API_KEY_HERE';

  if (!hasKey) {
    $('emptyMessage').innerHTML = '⚠️ Chưa có Gemini API key.<br>Mở <strong>Cài đặt</strong> để cấu hình trước khi học.';
    $('btnGenerate').style.display = 'none';
  }

  $('btnOpenSettings').addEventListener('click', () => openSettings());

  $('btnGenerate').addEventListener('click', async () => {
    if (!hasKey) {
      toast('⚠️ Cần API key trước. Mở Settings.');
      setTimeout(() => openSettings(), 1200);
      return;
    }
    showLoading('Đang sinh 10 từ đầu tiên... (có thể mất 15-30s)');
    const res = await sendAppMessage({ type: 'FORCE_GENERATE' });
    if (res?.success) {
      toast('✨ Đã tạo bộ từ đầu tiên!');
      setTimeout(() => location.reload(), 800);
    } else {
      toast('Lỗi: ' + (res?.error || 'không xác định'), 6000);
      showState('empty');
    }
  });
}

function bindCardHandlers() {
  // Flip on card click (but not on action buttons)
  els.card.addEventListener('click', (e) => {
    if (e.target.closest('.action-chip')) return;
    flipCard();
  });

  // Grade buttons
  document.querySelectorAll('.grade-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const grade = parseInt(btn.dataset.grade);
      handleGrade(grade);
    });
  });

  // Action chips
  $('btnSpeak').addEventListener('click', (e) => { e.stopPropagation(); speakWord(); });
  $('btnForms').addEventListener('click', (e) => { e.stopPropagation(); openFormsDialog(); });
  $('btnExamples').addEventListener('click', (e) => { e.stopPropagation(); openExamplesDialog(); });

  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyboard);
}

function bindGlobalHandlers() {
  $('btnAccount').addEventListener('click', openAccountDialog);
  $('btnStats').addEventListener('click', openStatsDialog);
  $('btnSettings').addEventListener('click', () => openSettings());
  $('btnLibrary').addEventListener('click', openLibraryDialog);
  $('btnChallenge').addEventListener('click', openChallengeDialog);
  $('btnGenMoreHeader').addEventListener('click', openGenMoreDialog);

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      $(btn.dataset.close).classList.add('hidden');
    });
  });

  // Close dialog on backdrop click
  document.querySelectorAll('.dialog-backdrop').forEach(bd => {
    bd.addEventListener('click', (e) => {
      if (e.target === bd) bd.classList.add('hidden');
    });
  });

  $('btnReviewAgain')?.addEventListener('click', () => {
    // Học lại các card có ease factor thấp (khó)
    const hardCards = allCards
      .filter(c => (c.srs?.easeFactor || 2.5) < 2.0)
      .sort((a, b) => (a.srs?.easeFactor || 2.5) - (b.srs?.easeFactor || 2.5))
      .slice(0, 10);
    if (hardCards.length === 0) {
      toast('Không có từ nào quá khó. Quay lại sau nhé!');
      return;
    }
    queue = hardCards;
    // KHÔNG reset sessionStats — giữ tổng tất cả ôn trong ngày
    hideAllStates();
    nextCard();
  });

  $('btnSyncNow')?.addEventListener('click', async () => {
    toast('🔄 Đang đồng bộ Google Drive...');
    const res = await sendAppMessage({ type: 'SYNC_NOW' });
    if (res?.success) {
      toast(res.skipped ? `✓ ${res.reason || 'Không cần đồng bộ'}` : '✓ Đồng bộ thành công');
    } else {
      toast('✗ ' + (res?.error || 'Đồng bộ thất bại'), 6000);
    }
  });

  $('btnOpenGenMore')?.addEventListener('click', () => {
    $('dialogStats').classList.add('hidden');
    openGenMoreDialog();
  });

  bindGenMoreDialog();
  bindLibraryDialog();
}

function flipCard() {
  isFlipped = !isFlipped;
  els.card.classList.toggle('flipped', isFlipped);
  els.reviewControls.classList.toggle('hidden', !isFlipped);
}

function speakWord() {
  if (!currentCard) return;
  const utter = new SpeechSynthesisUtterance(currentCard.word);
  utter.lang = 'en-US';
  utter.rate = 0.85;
  speechSynthesis.cancel();
  speechSynthesis.speak(utter);
}

async function handleGrade(grade) {
  if (!currentCard) return;

  const newSrs = reviewCard(currentCard.srs || {}, grade);
  currentCard.srs = newSrs;

  // Update in main list
  const idx = allCards.findIndex(c => c.id === currentCard.id);
  if (idx >= 0) allCards[idx] = currentCard;

  // If failed, push back to queue (learn again)
  if (grade < 3) {
    queue.push(currentCard);
  } else {
    sessionStats.correct++;
  }
  sessionStats.reviewed++;

  await saveCards(allCards);
  await maybeBumpStreak();
  await persistSessionStats();

  // Trigger sync in background (fire and forget — ignore connection errors)
  sendAppMessage({ type: 'SYNC_NOW', force: false }).catch(() => {});

  // Animate swap
  els.card.classList.add('swap-out');
  setTimeout(nextCard, 280);
}

/**
 * Persist sessionStats vào userState với date hôm nay.
 * Cho phép resume khi user đóng popup giữa chừng.
 */
async function persistSessionStats() {
  const today = new Date().toISOString().slice(0, 10);
  await setUserState({
    todayStats: {
      date: today,
      reviewed: sessionStats.reviewed,
      correct: sessionStats.correct
    }
  });
}

/**
 * Restore sessionStats từ userState nếu date khớp với hôm nay.
 */
async function restoreSessionStats() {
  const state = await getUserState();
  const today = new Date().toISOString().slice(0, 10);
  if (state.todayStats && state.todayStats.date === today) {
    sessionStats = {
      reviewed: state.todayStats.reviewed || 0,
      correct: state.todayStats.correct || 0
    };
  } else {
    // Date khác hoặc chưa có → reset
    sessionStats = { reviewed: 0, correct: 0 };
  }
}

function handleKeyboard(e) {
  if (document.querySelector('.dialog-backdrop:not(.hidden)')) return;

  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (!isFlipped) flipCard();
  } else if (isFlipped) {
    if (e.key === '1') handleGrade(0);
    else if (e.key === '2') handleGrade(3);
    else if (e.key === '3') handleGrade(4);
    else if (e.key === '4') handleGrade(5);
  }
  if (e.key === 's' && e.ctrlKey) {
    e.preventDefault();
    speakWord();
  }
}

// === Dialogs ===
function openFormsDialog() {
  if (!currentCard) return;
  $('formsDialogWord').textContent = currentCard.word;
  const list = $('formsList');
  list.innerHTML = '';

  const forms = currentCard.forms || [];
  if (forms.length === 0) {
    list.innerHTML = '<p style="color: var(--paper-muted); text-align: center; padding: 20px;">Không có thông tin về các dạng từ.</p>';
  } else {
    forms.forEach(f => {
      const div = document.createElement('div');
      div.className = 'form-item';
      div.innerHTML = `
        <div class="form-header">
          <span class="form-pos">${escapeHtml(f.pos)}</span>
          <span class="form-word">${escapeHtml(f.form)}</span>
          ${f.ipa ? `<span class="form-ipa">${escapeHtml(f.ipa)}</span>` : ''}
        </div>
        <p class="form-meaning">${escapeHtml(f.meaning)}</p>
      `;
      list.appendChild(div);
    });
  }
  $('dialogForms').classList.remove('hidden');
}

function openExamplesDialog() {
  if (!currentCard) return;
  $('examplesDialogWord').textContent = currentCard.word;
  const list = $('examplesList');
  list.innerHTML = '';

  const examples = currentCard.examples || [];
  if (examples.length === 0) {
    list.innerHTML = '<p style="color: var(--paper-muted); text-align: center; padding: 20px;">Không có ví dụ.</p>';
  } else {
    examples.forEach(ex => {
      const div = document.createElement('div');
      div.className = 'example-item';
      const highlighted = highlightHtml(ex.sentence, ex.highlight);
      div.innerHTML = `
        <span class="example-position">${escapeHtml(ex.position || '')}</span>
        <p class="example-sentence">${highlighted}</p>
        <p class="example-translation">${escapeHtml(ex.translation || '')}</p>
      `;
      list.appendChild(div);

      // Click sentence to speak
      div.querySelector('.example-sentence').style.cursor = 'pointer';
      div.querySelector('.example-sentence').addEventListener('click', () => {
        const utter = new SpeechSynthesisUtterance(ex.sentence);
        utter.lang = 'en-US';
        utter.rate = 0.85;
        speechSynthesis.cancel();
        speechSynthesis.speak(utter);
      });
    });
  }
  $('dialogExamples').classList.remove('hidden');
}

function openStatsDialog() {
  const stats = calculateStats(allCards);
  $('statTotal').textContent = stats.total;
  $('statMastered').textContent = stats.mastered;
  $('statDue').textContent = stats.due;
  $('statRetention').textContent = stats.retentionRate + '%';
  $('dialogStats').classList.remove('hidden');
}

// === Streak ===
async function updateStreak() {
  const config = await getConfig();
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const userState = await getUserState();
  let streak = userState.streakData || { count: 0, lastDate: null };

  if (streak.lastDate === today) {
    // already counted today
  } else if (streak.lastDate === yesterday) {
    // continuing yesterday's streak; will increment when user reviews today
  } else if (streak.lastDate !== null) {
    streak = { count: 0, lastDate: null };
  }

  els.streakCount.textContent = streak.count;
}

// === Helpers ===
// ============================================================
// Library
// ============================================================

let libraryFilter = 'all';
let librarySearch = '';

function bindLibraryDialog() {
  $('librarySearch').addEventListener('input', (e) => {
    librarySearch = e.target.value.toLowerCase().trim();
    renderLibraryList();
  });

  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      libraryFilter = chip.dataset.filter;
      renderLibraryList();
    });
  });
}

function openLibraryDialog() {
  $('libraryCount').textContent = allCards.length;
  librarySearch = '';
  $('librarySearch').value = '';
  renderLibraryList();
  $('dialogLibrary').classList.remove('hidden');
}

function getCardStatus(card) {
  const srs = card.srs || {};
  const now = Date.now();
  if (!srs.lastReviewedAt) return 'new';
  if ((srs.dueDate ?? 0) <= now) return 'due';
  if ((srs.repetitions ?? 0) >= 3) return 'mastered';
  return 'learning';
}

function prettyDueTime(dueDate) {
  if (!dueDate) return 'mới';
  const diff = dueDate - Date.now();
  if (diff <= 0) return 'đến hạn';
  const days = Math.round(diff / 86400000);
  if (days < 1) return `${Math.round(diff / 3600000)}h`;
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}

function renderLibraryList() {
  const list = $('libraryList');

  let filtered = allCards.slice();

  // Filter
  if (libraryFilter !== 'all') {
    filtered = filtered.filter(c => getCardStatus(c) === libraryFilter);
  }

  // Search
  if (librarySearch) {
    filtered = filtered.filter(c =>
      c.word.toLowerCase().includes(librarySearch) ||
      (c.primaryMeaning || '').toLowerCase().includes(librarySearch)
    );
  }

  // Sort: due first, then most recent
  filtered.sort((a, b) => {
    const sa = getCardStatus(a), sb = getCardStatus(b);
    const order = { due: 0, learning: 1, new: 2, mastered: 3 };
    if (order[sa] !== order[sb]) return order[sa] - order[sb];
    return (b.srs?.createdAt || 0) - (a.srs?.createdAt || 0);
  });

  if (filtered.length === 0) {
    list.innerHTML = `<div class="library-empty">Không có từ nào phù hợp.</div>`;
    return;
  }

  list.innerHTML = filtered.map(c => {
    const status = getCardStatus(c);
    const statusLabel = {
      new: 'MỚI',
      due: 'ĐẾN HẠN',
      learning: 'ĐANG HỌC',
      mastered: 'ĐÃ THUỘC'
    }[status];
    const due = status === 'mastered' || status === 'learning' ? prettyDueTime(c.srs?.dueDate) : '';
    return `
      <div class="library-item" data-card-id="${c.id}">
        <div class="library-item-main">
          <div class="library-item-word">
            <span class="library-word">${escapeHtml(c.word)}</span>
            <span class="library-ipa">${escapeHtml(c.ipa || '')}</span>
          </div>
          <div class="library-meaning">${escapeHtml(c.primaryMeaning || '')}</div>
        </div>
        <div class="library-item-status">
          <span class="status-pill-tiny status-${status}">${statusLabel}</span>
          ${due ? `<span class="library-due-time">${due}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Click → open detail
  list.querySelectorAll('.library-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.cardId;
      const card = allCards.find(c => c.id === id);
      if (card) openWordDetail(card);
    });
  });
}

function openWordDetail(card) {
  $('detailTitle').textContent = card.word;
  const body = $('detailBody');

  const srs = card.srs || {};
  const status = getCardStatus(card);
  const statusLabel = { new: 'Mới', due: 'Đến hạn', learning: 'Đang học', mastered: 'Đã thuộc' }[status];

  body.innerHTML = `
    <div class="detail-header">
      <div class="detail-word">${escapeHtml(card.word)}</div>
      <div class="detail-ipa-row">
        <span class="detail-ipa">${escapeHtml(card.ipa || '')}</span>
        <button class="btn-speak-inline" data-speak="${escapeHtml(card.word)}" title="Phát âm">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
        </button>
      </div>
      <div class="detail-meaning">${escapeHtml(card.primaryMeaning || '')}</div>
    </div>

    <div class="detail-srs-stats">
      <div class="detail-srs-stat">
        <strong>${srs.repetitions ?? 0}</strong>
        <span>Số lần ôn</span>
      </div>
      <div class="detail-srs-stat">
        <strong>${srs.interval ?? 0}d</strong>
        <span>Khoảng cách</span>
      </div>
      <div class="detail-srs-stat">
        <strong>${statusLabel}</strong>
        <span>Trạng thái</span>
      </div>
    </div>

    ${card.mnemonic ? `
      <div class="detail-section">
        <div class="detail-section-title">Mẹo ghi nhớ</div>
        <div class="mnemonic" style="margin: 0;">${escapeHtml(card.mnemonic)}</div>
      </div>
    ` : ''}

    ${card.forms && card.forms.length > 0 ? `
      <div class="detail-section">
        <div class="detail-section-title">Các dạng từ</div>
        ${card.forms.map(f => `
          <div class="form-item">
            <div class="form-header">
              <span class="form-pos">${escapeHtml(f.pos)}</span>
              <span class="form-word">${escapeHtml(f.form)}</span>
              ${f.ipa ? `<span class="form-ipa">${escapeHtml(f.ipa)}</span>` : ''}
            </div>
            <p class="form-meaning">${escapeHtml(f.meaning)}</p>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${card.examples && card.examples.length > 0 ? `
      <div class="detail-section">
        <div class="detail-section-title">Ví dụ</div>
        ${card.examples.map(ex => {
          const hl = highlightHtml(ex.sentence, ex.highlight);
          return `
            <div class="example-item">
              <span class="example-position">${escapeHtml(ex.position || '')}</span>
              <p class="example-sentence" data-speak="${escapeHtml(ex.sentence)}">${hl}</p>
              <p class="example-translation">${escapeHtml(ex.translation || '')}</p>
            </div>
          `;
        }).join('')}
      </div>
    ` : ''}
  `;

  // Bind speak buttons
  body.querySelectorAll('[data-speak]').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      const text = el.dataset.speak;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.85;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    });
  });

  $('dialogLibrary').classList.add('hidden');
  $('dialogWordDetail').classList.remove('hidden');
}

// ============================================================
// Generate More
// ============================================================

function bindGenMoreDialog() {
  // count chips
  document.querySelectorAll('[data-group="count"] .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-group="count"] .chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
    });
  });

  // difficulty range
  const range = $('genDifficulty');
  const updateLabel = () => {
    const v = parseInt(range.value);
    const levels = {1:'A1 cơ bản', 2:'A2', 3:'B1 thấp', 4:'B1', 5:'B1+', 6:'B2', 7:'B2+', 8:'C1', 9:'C1+', 10:'C2'};
    $('diffLabel').textContent = `${levels[v]} (${v})`;
  };
  range.addEventListener('input', updateLabel);
  updateLabel();

  $('btnDoGenMore').addEventListener('click', async () => {
    const count = parseInt(document.querySelector('[data-group="count"] .chip.selected').dataset.val);
    const difficulty = parseInt(range.value);
    const theme = $('genTheme').value.trim();

    $('dialogGenMore').classList.add('hidden');
    showLoading(`Đang sinh ${count} từ ở độ khó ${difficulty}/10... (có thể mất 30-60s)`);

    const res = await sendAppMessage({
      type: 'GENERATE_MORE',
      count,
      difficulty,
      theme: theme || undefined
    });

    if (res?.success) {
      toast(`✨ Đã sinh thêm ${res.added} từ mới!`);
      setTimeout(() => location.reload(), 1000);
    } else {
      toast('Lỗi: ' + (res?.error || 'không xác định'), 6000);
      // Restore UI
      if (allCards.length === 0) {
        showState('empty');
      } else {
        hideAllStates();
        if (currentCard) renderCard(currentCard);
      }
    }
  });
}

async function openGenMoreDialog() {
  // Set difficulty default to current
  const config = await getConfig();
  $('genDifficulty').value = Math.round(config.currentDifficulty);
  $('genDifficulty').dispatchEvent(new Event('input'));
  $('dialogGenMore').classList.remove('hidden');
}

// ============================================================
// Sentence Challenge
// ============================================================

let challengeState = {
  level: 1,        // số từ yêu cầu trong câu
  streak: 0,       // số câu đúng liên tiếp
  totalDone: 0,
  currentWords: [] // các card đang yêu cầu
};

function pickChallengeWords(level) {
  // Ưu tiên các từ đã review ít nhất 1 lần (active recall hiệu quả nhất với từ đã gặp)
  const reviewed = allCards.filter(c => c.srs?.lastReviewedAt);
  const pool = reviewed.length >= level ? reviewed : allCards;
  if (pool.length === 0) return [];

  // Lấy N từ ngẫu nhiên
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, level);
}

function openChallengeDialog() {
  if (allCards.length === 0) {
    toast('Cần có ít nhất 1 từ để bắt đầu thử thách.');
    return;
  }
  // Reset state
  challengeState = { level: 1, streak: 0, totalDone: 0, currentWords: [] };
  renderChallengeIntro();
  $('dialogChallenge').classList.remove('hidden');
}

function renderChallengeIntro() {
  $('challengeBody').innerHTML = `
    <div class="challenge-intro">
      <div class="challenge-icon">✍️</div>
      <h4>Thử thách đặt câu</h4>
      <p>
        AI sẽ chọn ngẫu nhiên các từ bạn đã học, bạn viết MỘT câu tiếng Anh chứa hết các từ đó.
        Mỗi câu đúng, độ khó (số từ phải dùng) sẽ tăng lên.
        Đây là cách <strong>active recall</strong> giúp nhớ sâu nhất.
      </p>
      <button class="btn-primary" id="btnStartChallenge">
        <span>Bắt đầu (Level 1)</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
      </button>
    </div>
  `;
  $('btnStartChallenge').addEventListener('click', nextChallenge);
}

function nextChallenge() {
  const words = pickChallengeWords(challengeState.level);
  if (words.length === 0) {
    $('challengeBody').innerHTML = `<div class="challenge-intro"><p>Không đủ từ để chơi. Hãy học thêm trước!</p></div>`;
    return;
  }
  challengeState.currentWords = words;

  $('challengeBody').innerHTML = `
    <div class="challenge-level-indicator">
      <span>Level <strong>${challengeState.level}</strong></span>
      <span>Streak: <strong>${challengeState.streak}</strong></span>
      <span>Đã làm: <strong>${challengeState.totalDone}</strong></span>
    </div>

    <div class="challenge-task">
      <div class="challenge-task-title">📝 Hãy đặt một câu chứa các từ sau</div>
      <div class="challenge-words">
        ${words.map(w => `<span class="challenge-word-chip" data-speak="${escapeHtml(w.word)}">${escapeHtml(w.word)}</span>`).join('')}
      </div>
    </div>

    <textarea class="challenge-textarea" id="challengeInput" placeholder="Type your sentence here..." autocomplete="off" spellcheck="true"></textarea>

    <div class="challenge-actions">
      <button class="btn-primary btn-full" id="btnSubmitSentence">
        <span>Chấm điểm</span>
      </button>
      <button class="btn-secondary btn-sm" id="btnSkipChallenge">Bỏ qua</button>
    </div>

    <div id="evalResult"></div>
  `;

  // Speak word on chip click
  document.querySelectorAll('.challenge-word-chip[data-speak]').forEach(chip => {
    chip.style.cursor = 'pointer';
    chip.addEventListener('click', () => {
      const u = new SpeechSynthesisUtterance(chip.dataset.speak);
      u.lang = 'en-US';
      u.rate = 0.85;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    });
  });

  $('challengeInput').focus();
  $('btnSubmitSentence').addEventListener('click', submitChallenge);
  $('btnSkipChallenge').addEventListener('click', () => {
    challengeState.streak = 0;
    nextChallenge();
  });

  // Ctrl/Cmd+Enter to submit
  $('challengeInput').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      submitChallenge();
    }
  });
}

async function submitChallenge() {
  const sentence = $('challengeInput').value.trim();
  if (!sentence) {
    toast('Hãy nhập câu trước khi chấm.');
    return;
  }

  const btn = $('btnSubmitSentence');
  btn.disabled = true;
  btn.innerHTML = '<span>⏳ Đang chấm...</span>';

  const requiredWords = challengeState.currentWords.map(w => w.word);
  const res = await sendAppMessage({
    type: 'EVALUATE_SENTENCE',
    sentence,
    requiredWords
  });

  btn.disabled = false;
  btn.innerHTML = '<span>Chấm điểm</span>';

  if (!res?.success) {
    toast('Lỗi: ' + (res?.error || 'không chấm được'), 5000);
    return;
  }

  const r = res.result;
  challengeState.totalDone++;

  if (r.correct) {
    challengeState.streak++;
    // Level up sau 2 câu đúng liên tiếp, tối đa 5
    if (challengeState.streak >= 2 && challengeState.level < 5) {
      challengeState.level++;
      challengeState.streak = 0;
    }
  } else {
    challengeState.streak = 0;
  }

  renderEvalResult(r);
}

function renderEvalResult(r) {
  const scoreClass = r.score >= 80 ? 'score-high' : r.score >= 60 ? 'score-mid' : 'score-low';
  const statusClass = r.correct ? 'ok' : 'fail';
  const statusText = r.correct ? '✓ Đạt' : '✗ Chưa đạt';

  const usedTags = (r.usedWords || []).map(w =>
    `<span class="eval-word-tag used">✓ ${escapeHtml(w)}</span>`
  ).join('');
  const missingTags = (r.missingWords || []).map(w =>
    `<span class="eval-word-tag missing">✗ ${escapeHtml(w)}</span>`
  ).join('');

  $('evalResult').innerHTML = `
    <div class="eval-result">
      <div class="eval-header">
        <span class="eval-score ${scoreClass}">${r.score}<small style="font-size:14px; opacity:0.6;">/100</small></span>
        <span class="eval-status ${statusClass}">${statusText}</span>
      </div>
      <div class="eval-body">
        <div class="eval-section">
          <div class="eval-section-label">Từ đã dùng / còn thiếu</div>
          <div class="eval-word-tags">${usedTags}${missingTags}</div>
        </div>

        <div class="eval-section">
          <div class="eval-section-label">Ngữ pháp</div>
          <div class="eval-section-text">${escapeHtml(r.grammarFeedback || '')}</div>
        </div>

        <div class="eval-section">
          <div class="eval-section-label">Độ tự nhiên</div>
          <div class="eval-section-text">${escapeHtml(r.naturalFeedback || '')}</div>
        </div>

        ${r.correctedSentence ? `
          <div class="eval-section">
            <div class="eval-section-label">Câu đã sửa</div>
            <div class="eval-corrected">${escapeHtml(r.correctedSentence)}</div>
          </div>
        ` : ''}

        ${r.betterAlternative ? `
          <div class="eval-section">
            <div class="eval-section-label">Cách diễn đạt hay hơn</div>
            <div class="eval-better">${escapeHtml(r.betterAlternative)}</div>
          </div>
        ` : ''}

        <div style="display:flex; gap:8px; margin-top:14px;">
          <button class="btn-primary btn-sm" id="btnNextChallenge" style="flex:1;">Câu tiếp theo</button>
        </div>
      </div>
    </div>
  `;
  $('btnNextChallenge').addEventListener('click', nextChallenge);
}


// ============================================================
// Account / User picker
// ============================================================

async function openAccountDialog() {
  const current = await getCurrentUser();
  const all = await listUsers();

  // Render current user box
  const currentBox = $('accountCurrent');
  if (current) {
    const img = current.picture ? `<img src="${escapeHtml(current.picture)}" alt="">` : '';
    const initial = (current.name || current.email || 'U')[0].toUpperCase();
    currentBox.innerHTML = `
      <div class="account-avatar">${img || escapeHtml(initial)}</div>
      <div class="account-info">
        <div class="account-info-name">${escapeHtml(current.name || 'Unknown')}</div>
        <div class="account-info-email">${escapeHtml(current.email || '')}</div>
      </div>
      <span class="account-current-badge">Đang dùng</span>
    `;
  } else {
    currentBox.innerHTML = `<div class="account-empty">Chưa đăng nhập</div>`;
  }

  // Render other users
  const others = all.filter(u => !current || u.userId !== current.userId);
  const list = $('accountList');
  if (others.length === 0) {
    list.innerHTML = `<div class="account-empty">Chưa có tài khoản khác</div>`;
  } else {
    list.innerHTML = others.map(u => {
      const initial = (u.name || u.email || 'U')[0].toUpperCase();
      const img = u.picture ? `<img src="${escapeHtml(u.picture)}" alt="">` : escapeHtml(initial);
      return `
        <div class="account-item" data-user-id="${escapeHtml(u.userId)}">
          <div class="account-avatar" style="width:32px;height:32px;font-size:14px;">${img}</div>
          <div class="account-item-info">
            <div class="account-item-name">${escapeHtml(u.name || u.email)}</div>
            <div class="account-item-email">${escapeHtml(u.email || '')}</div>
          </div>
          <div class="account-item-actions">
            <button class="account-action-btn" data-action="switch" data-user-id="${escapeHtml(u.userId)}" title="Chuyển sang tài khoản này">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
            </button>
            <button class="account-action-btn danger" data-action="logout" data-user-id="${escapeHtml(u.userId)}" title="Xoá tài khoản này">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.account-action-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const userId = btn.dataset.userId;
        const action = btn.dataset.action;
        if (action === 'switch') {
          await handleSwitchUser(userId);
        } else if (action === 'logout') {
          await handleLogoutUser(userId);
        }
      });
    });
  }

  $('btnAddAccount').onclick = async () => {
    $('dialogAccount').classList.add('hidden');
    showLoading('Đang mở dialog đăng nhập Google...');
    const result = await sendAppMessage({ type: 'LOGIN_NEW_USER' });
    if (result?.success) {
      await handlePostLogin();
    } else {
      toast('❌ ' + (result?.error || 'Đăng nhập thất bại'), 5000);
      setTimeout(() => location.reload(), 1500);
    }
  };

  $('dialogAccount').classList.remove('hidden');
}

async function handleSwitchUser(userId) {
  if (!confirm('Chuyển sang tài khoản này? Dữ liệu sẽ được tải lại từ Drive của tài khoản mới.')) return;
  $('dialogAccount').classList.add('hidden');
  showLoading('Đang chuyển tài khoản...');
  const result = await sendAppMessage({ type: 'SWITCH_USER', userId });
  if (result?.success) {
    setTimeout(() => location.reload(), 400);
  } else {
    toast('Lỗi: ' + (result?.error || 'không xác định'), 5000);
  }
}

async function handleLogoutUser(userId) {
  if (!confirm('Đăng xuất và xoá tài khoản này khỏi extension? Dữ liệu trên Drive KHÔNG bị xoá.')) return;
  const result = await sendAppMessage({ type: 'LOGOUT_USER', userId });
  if (result?.success) {
    toast('Đã đăng xuất');
    openAccountDialog(); // refresh
  } else {
    toast('Lỗi: ' + (result?.error || 'không xác định'));
  }
}


function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightHtml(text, highlight) {
  const source = String(text ?? '');
  const needle = String(highlight ?? '').trim();
  if (!needle) return escapeHtml(source);

  const re = new RegExp(escapeRegex(needle), 'gi');
  let out = '';
  let lastIndex = 0;
  let match;

  while ((match = re.exec(source)) !== null) {
    out += escapeHtml(source.slice(lastIndex, match.index));
    out += `<mark>${escapeHtml(match[0])}</mark>`;
    lastIndex = match.index + match[0].length;
    if (match[0].length === 0) break;
  }

  out += escapeHtml(source.slice(lastIndex));
  return out;
}

// === Streak bump on first review of the day ===
let streakUpdatedThisSession = false;
async function maybeBumpStreak() {
  if (streakUpdatedThisSession) return;
  streakUpdatedThisSession = true;
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const userState = await getUserState();
  let s = userState.streakData || { count: 0, lastDate: null };
  if (s.lastDate === today) return;
  s.count = (s.lastDate === yesterday) ? s.count + 1 : 1;
  s.lastDate = today;
  await setUserState({ streakData: s });
  els.streakCount.textContent = s.count;
}
