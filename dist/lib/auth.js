// lib/auth.js
// Web version of the original Chrome Identity auth module.
// Uses Google Identity Services OAuth token flow, suitable for Vercel/static hosting.

import './browser-storage.js';
import { getSyncStorageKey } from './browser-storage.js';

const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';

const STORAGE_USERS = 'lexiflash_users_v1';
const STORAGE_CURRENT_USER = 'lexiflash_current_user_v1';
const TOKEN_REFRESH_MARGIN_MS = 60_000;

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file'
].join(' ');

let gisPromise = null;

function loadGoogleIdentityServices() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;

  gisPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Không tải được Google Identity Services')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = GIS_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Không tải được Google Identity Services'));
    document.head.appendChild(script);
  });

  return gisPromise;
}

function readStoredSync(key) {
  const raw = localStorage.getItem(getSyncStorageKey(key));
  if (raw == null) return undefined;
  try { return JSON.parse(raw); } catch { return raw; }
}

function getOAuthClientId() {
  const stored = readStoredSync('googleOAuthClientId');
  const manifestClientId = chrome.runtime.getManifest()?.oauth2?.client_id;
  return stored || manifestClientId || '';
}

export function isClientIdConfigured() {
  const id = getOAuthClientId();
  return Boolean(id && id.includes('.apps.googleusercontent.com') && !id.includes('YOUR_GOOGLE_OAUTH_CLIENT_ID'));
}

async function requestAccessToken({ prompt = 'select_account consent' } = {}) {
  const clientId = getOAuthClientId();
  if (!clientId) throw new Error('Chưa cấu hình Google OAuth Web Client ID trong Settings.');

  await loadGoogleIdentityServices();

  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES,
      prompt,
      callback: (response) => {
        if (response?.error) {
          reject(new Error(response.error_description || response.error || 'Google OAuth thất bại'));
          return;
        }
        if (!response?.access_token) {
          reject(new Error('Không nhận được access token từ Google.'));
          return;
        }
        resolve({
          token: response.access_token,
          expiresAt: Date.now() + Math.max(30, Number(response.expires_in || 3600) - 60) * 1000,
          scope: response.scope || GOOGLE_SCOPES
        });
      },
      error_callback: (err) => {
        reject(new Error(err?.message || err?.type || 'Google OAuth bị huỷ hoặc thất bại'));
      }
    });

    tokenClient.requestAccessToken({ prompt });
  });
}

async function fetchUserInfo(accessToken) {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error(`Không lấy được thông tin user (${res.status})`);
  return await res.json();
}

function createAuthError(message, code, cause) {
  const err = new Error(message);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

async function loadUsers() {
  const data = await chrome.storage.local.get(STORAGE_USERS);
  return data[STORAGE_USERS] || {};
}

async function saveUsers(users) {
  await chrome.storage.local.set({ [STORAGE_USERS]: users });
}

export async function listUsers() {
  const users = await loadUsers();
  return Object.values(users).map(u => ({
    userId: u.userId,
    email: u.email,
    name: u.name,
    picture: u.picture,
    addedAt: u.addedAt,
    lastUsedAt: u.lastUsedAt
  })).sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
}

export async function loginNewUser() {
  if (!isClientIdConfigured()) {
    throw new Error('OAuth Web Client ID chưa cấu hình. Mở Settings → Google Drive Sync để nhập Client ID.');
  }

  const tokenInfo = await requestAccessToken({ prompt: 'select_account consent' });
  const userInfo = await fetchUserInfo(tokenInfo.token);
  if (!userInfo.sub) throw new Error('User info thiếu sub (user id)');

  const users = await loadUsers();
  const existing = users[userInfo.sub];

  const userRecord = {
    userId: userInfo.sub,
    email: userInfo.email || '',
    name: userInfo.name || userInfo.email || 'Unknown',
    picture: userInfo.picture || '',
    accessToken: tokenInfo.token,
    tokenExpiresAt: tokenInfo.expiresAt,
    addedAt: existing?.addedAt || Date.now(),
    lastUsedAt: Date.now()
  };

  users[userRecord.userId] = userRecord;
  await saveUsers(users);
  await setCurrentUser(userRecord.userId);

  return {
    userId: userRecord.userId,
    email: userRecord.email,
    name: userRecord.name,
    picture: userRecord.picture
  };
}

export async function ensureDriveAuth() {
  const current = await getCurrentUser();
  if (!current) return await loginNewUser();

  const users = await loadUsers();
  const existing = users[current.userId];
  if (!existing) return await loginNewUser();

  let tokenInfo;
  try {
    tokenInfo = await requestAccessToken({ prompt: '' });
  } catch {
    tokenInfo = await requestAccessToken({ prompt: 'select_account consent' });
  }
  const userInfo = await fetchUserInfo(tokenInfo.token);
  if (userInfo.sub !== current.userId) {
    throw new Error(`Google đang trả về account khác. Vui lòng đăng xuất Google hoặc chọn lại ${current.email}.`);
  }

  users[current.userId] = {
    ...existing,
    email: userInfo.email || existing.email || '',
    name: userInfo.name || existing.name || userInfo.email || 'Unknown',
    picture: userInfo.picture || existing.picture || '',
    accessToken: tokenInfo.token,
    tokenExpiresAt: tokenInfo.expiresAt,
    lastUsedAt: Date.now()
  };
  await saveUsers(users);
  await setCurrentUser(current.userId);

  return {
    userId: users[current.userId].userId,
    email: users[current.userId].email,
    name: users[current.userId].name,
    picture: users[current.userId].picture
  };
}

export async function getCurrentUser() {
  const data = await chrome.storage.local.get(STORAGE_CURRENT_USER);
  const userId = data[STORAGE_CURRENT_USER];
  if (!userId) return null;

  const users = await loadUsers();
  const u = users[userId];
  if (!u) return null;

  return {
    userId: u.userId,
    email: u.email,
    name: u.name,
    picture: u.picture
  };
}

export async function setCurrentUser(userId) {
  const users = await loadUsers();
  if (!users[userId]) throw new Error('User chưa đăng nhập');
  users[userId].lastUsedAt = Date.now();
  await saveUsers(users);
  await chrome.storage.local.set({ [STORAGE_CURRENT_USER]: userId });
}

export async function switchUser(targetUserId) {
  const users = await loadUsers();
  if (!users[targetUserId]) throw new Error('User chưa đăng nhập trong LexiFlash');

  const tokenInfo = await requestAccessToken({ prompt: 'select_account consent' });
  const userInfo = await fetchUserInfo(tokenInfo.token);

  if (userInfo.sub !== targetUserId) {
    throw new Error(`Bạn đã chọn nhầm account. Vui lòng chọn ${users[targetUserId].email}.`);
  }

  users[targetUserId].accessToken = tokenInfo.token;
  users[targetUserId].tokenExpiresAt = tokenInfo.expiresAt;
  users[targetUserId].lastUsedAt = Date.now();
  await saveUsers(users);
  await chrome.storage.local.set({ [STORAGE_CURRENT_USER]: targetUserId });
}

export async function logoutUser(userId) {
  const users = await loadUsers();
  const u = users[userId];
  if (!u) return;

  try {
    if (u.accessToken && window.google?.accounts?.oauth2?.revoke) {
      window.google.accounts.oauth2.revoke(u.accessToken, () => {});
    }
  } catch (e) {
    console.warn('Revoke failed:', e);
  }

  delete users[userId];
  await saveUsers(users);

  const cur = await chrome.storage.local.get(STORAGE_CURRENT_USER);
  if (cur[STORAGE_CURRENT_USER] === userId) {
    await chrome.storage.local.remove(STORAGE_CURRENT_USER);
  }
}

export async function getAccessToken({ forceRefresh = false } = {}) {
  const data = await chrome.storage.local.get([STORAGE_USERS, STORAGE_CURRENT_USER]);
  const userId = data[STORAGE_CURRENT_USER];
  if (!userId) throw new Error('Chưa đăng nhập Google Drive');

  const users = data[STORAGE_USERS] || {};
  const user = users[userId];
  if (!user) throw new Error('User không tồn tại trong storage');

  // Reuse token if it is still valid.
  if (!forceRefresh && user.accessToken && user.tokenExpiresAt && user.tokenExpiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
    return user.accessToken;
  }

  let tokenInfo;
  let userInfo;
  try {
    tokenInfo = await requestAccessToken({ prompt: '' });
    userInfo = await fetchUserInfo(tokenInfo.token);
  } catch (err) {
    throw createAuthError(
      'Phiên Google Drive cần được cấp quyền lại. Tài khoản LexiFlash vẫn được giữ; bấm "Kết nối Google Drive" khi cần đồng bộ.',
      'TOKEN_REFRESH_FAILED',
      err
    );
  }

  if (userInfo.sub !== userId) {
    throw createAuthError(
      'Token trả về không khớp với user hiện tại. Tài khoản LexiFlash vẫn được giữ; hãy kết nối lại đúng Google account.',
      'TOKEN_USER_MISMATCH'
    );
  }

  user.accessToken = tokenInfo.token;
  user.tokenExpiresAt = tokenInfo.expiresAt;
  users[userId] = user;
  await saveUsers(users);
  return tokenInfo.token;
}

export async function isAuthenticated() {
  try {
    const user = await getCurrentUser();
    return Boolean(user);
  } catch {
    return false;
  }
}
