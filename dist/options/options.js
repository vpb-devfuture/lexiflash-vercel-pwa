// options/options.js
import { getConfig, setConfig } from '../lib/config.js';
import { testApiKey } from '../lib/gemini.js';
import { checkDriveConnection } from '../lib/drive.js';
import { logoutUser, getCurrentUser, listUsers } from '../lib/auth.js';
import { sendAppMessage } from '../lib/app-service.js';

const $ = id => document.getElementById(id);
let credentialSources = {};

async function init() {
  // Hiển thị extension ID
  $('extId').textContent = window.location.origin;

  // BIND HANDLERS NGAY TỪ ĐẦU — không await trước, để UI luôn responsive
  // kể cả khi check Drive/load config gặp lỗi.
  bindHandlers();
  bindAutoSave();

  // Load config hiện tại (an toàn nếu fail)
  try {
    const cfg = await getConfig();
    $('apiKey').value = cfg.geminiApiKey || '';
    $('model').value = cfg.geminiModel;
    $('googleOAuthClientId').value = cfg.googleOAuthClientId || '';
    $('folderName').value = cfg.driveFolderName;
    $('wordsPerDay').value = cfg.wordsPerDay;
    $('currentDifficulty').value = cfg.currentDifficulty;
    $('diffIncrement').value = cfg.difficultyIncrementPerDay;
    $('autoSync').checked = cfg.autoSync;
    $('notifications').checked = cfg.notificationsEnabled;
    credentialSources = cfg.credentialsSource || {};
    applyCredentialSourceUI();
    updateGeminiStatus(cfg.geminiApiKey ? (credentialSources.geminiApiKey === 'manifest' ? 'manifest' : 'configured') : 'empty');
  } catch (e) {
    console.error('Load config failed:', e);
    updateGeminiStatus('empty');
  }

  // Check Drive connection (an toàn nếu fail)
  try {
    const driveOk = await checkDriveConnection();
    updateDriveStatus(driveOk ? 'connected' : 'disconnected');
  } catch (e) {
    console.error('Drive check failed:', e);
    updateDriveStatus('disconnected');
  }
}

function updateGeminiStatus(state) {
  const el = $('geminiStatus');
  el.classList.remove('ok', 'err');
  if (state === 'ok') { el.textContent = '✓ Hoạt động'; el.classList.add('ok'); }
  else if (state === 'err') { el.textContent = '✗ Lỗi key'; el.classList.add('err'); }
  else if (state === 'manifest') el.textContent = 'Từ manifest.json';
  else if (state === 'configured') el.textContent = 'Đã cấu hình';
  else el.textContent = 'Chưa cấu hình';
}

function applyCredentialSourceUI() {
  const geminiFromManifest = credentialSources.geminiApiKey === 'manifest';
  const driveFromManifest = credentialSources.googleOAuthClientId === 'manifest';

  $('apiKey').disabled = geminiFromManifest;
  $('googleOAuthClientId').disabled = driveFromManifest;
  $('btnTestApi').textContent = geminiFromManifest ? 'Kiểm tra API key từ manifest' : 'Kiểm tra API key';
}

function updateDriveStatus(state) {
  const el = $('driveStatus');
  el.classList.remove('ok', 'err');
  if (state === 'connected') { el.textContent = '✓ Đã kết nối'; el.classList.add('ok'); }
  else el.textContent = 'Chưa kết nối';
}

function bindHandlers() {
  $('togglePw').addEventListener('click', () => {
    const inp = $('apiKey');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  $('btnTestApi').addEventListener('click', async () => {
    const key = $('apiKey').value.trim();
    const model = $('model').value;
    if (!key) return toast('Nhập API key trước.');
    toast('🔄 Đang kiểm tra...', 8000);
    const result = await testApiKey(key, model);
    if (result.ok) {
      const patch = { geminiModel: model };
      if (credentialSources.geminiApiKey !== 'manifest') patch.geminiApiKey = key;
      await setConfig(patch);
      updateGeminiStatus('ok');
      toast('✓ API key hợp lệ, đã lưu', 3000);
    } else {
      updateGeminiStatus('err');
      toast('✗ ' + (result.error || 'Không hợp lệ'), 6000);
      console.error('[LexiFlash] Test API failed:', result);
    }
  });

  $('btnConnectDrive').addEventListener('click', async () => {
    toast('🔄 Đang kết nối Google Drive...', 30000);
    const res = await sendAppMessage({ type: 'ENSURE_DRIVE_AUTH' });
    if (res?.success && res.user) {
      updateDriveStatus('connected');
      toast(`✓ Đã đăng nhập: ${res.user.email}`, 4000);
    } else {
      updateDriveStatus('disconnected');
      const errMsg = res?.error || 'Lỗi không xác định';
      toast('✗ ' + errMsg, 7000);
      console.error('[LexiFlash] Login failed:', res);
    }
  });

  $('btnRestoreDrive').addEventListener('click', async () => {
    if (!confirm('Khôi phục dữ liệu từ Drive sẽ ghi đè dữ liệu hiện tại. Tiếp tục?')) return;
    toast('🔄 Đang khôi phục...');
    const res = await sendAppMessage({ type: 'RESTORE_FROM_DRIVE' });
    if (res?.success) toast(`✓ Đã khôi phục ${res.count} flashcard`);
    else toast('✗ ' + (res?.message || 'Lỗi không xác định'));
  });

  $('btnDisconnect').addEventListener('click', async () => {
    const current = await getCurrentUser();
    if (!current) {
      toast('Chưa đăng nhập', 3000);
      return;
    }
    if (!confirm(`Đăng xuất khỏi ${current.email}? Dữ liệu trên Drive vẫn được giữ.`)) return;
    await logoutUser(current.userId);
    updateDriveStatus('disconnected');
    toast('Đã đăng xuất');
  });

  $('btnGenNow').addEventListener('click', async () => {
    toast('🎲 Đang sinh từ mới... (15-30s)', 30000);
    const res = await sendAppMessage({ type: 'FORCE_GENERATE' });
    if (res?.success) {
      toast(`✨ Đã sinh thêm ${res.added} từ mới!`, 4000);
    } else {
      toast('✗ ' + (res?.error || 'Lỗi không xác định'), 6000);
      console.error('[LexiFlash] FORCE_GENERATE failed:', res);
    }
  });

  $('btnSyncNow').addEventListener('click', async () => {
    toast('☁️ Đang đồng bộ...');
    const res = await sendAppMessage({ type: 'SYNC_NOW' });
    if (res?.success) {
      toast(res.skipped ? `✓ ${res.reason || 'Không cần đồng bộ'}` : '✓ Đồng bộ thành công');
    } else {
      toast('✗ ' + (res?.error || 'Lỗi đồng bộ'), 7000);
    }
  });

  $('btnClearData').addEventListener('click', async () => {
    const current = await getCurrentUser();
    const who = current ? ` của ${current.email}` : '';
    if (!confirm(`⚠️ XOÁ TOÀN BỘ flashcard cục bộ${who}? Dữ liệu trên Drive vẫn còn (có thể restore lại).`)) return;
    const { clearCardsForCurrentUser } = await import('../lib/config.js');
    await clearCardsForCurrentUser();
    toast('🗑 Đã xoá dữ liệu cục bộ');
  });
}

function bindAutoSave() {
  // Auto-save các field khi blur
  const autoSaveFields = {
    apiKey: 'geminiApiKey',
    model: 'geminiModel',
    googleOAuthClientId: 'googleOAuthClientId',
    folderName: 'driveFolderName',
    wordsPerDay: 'wordsPerDay',
    currentDifficulty: 'currentDifficulty',
    diffIncrement: 'difficultyIncrementPerDay',
    autoSync: 'autoSync',
    notifications: 'notificationsEnabled'
  };

  Object.entries(autoSaveFields).forEach(([id, key]) => {
    const el = $(id);
    if (!el) return;
    const event = el.type === 'checkbox' ? 'change' : 'blur';
    el.addEventListener(event, async () => {
      if (el.disabled) return;
      let val;
      if (el.type === 'checkbox') val = el.checked;
      else if (el.type === 'number') val = parseFloat(el.value);
      else val = el.value.trim();
      await setConfig({ [key]: val });
      toast('Đã lưu', 1200);
    });
  });
}

function toast(msg, ms = 2000) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  t.classList.add('show');
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.classList.add('hidden'), 300);
  }, ms);
}

init();
