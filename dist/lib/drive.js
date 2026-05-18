// lib/drive.js
// Đồng bộ flashcard với Google Drive — multi-user aware.
// Mỗi user có 1 file riêng trong folder "flashcard-db" với tên dạng "flashcards-{userId}.json".

import { getConfig } from './config.js';
import { getAccessToken, getCurrentUser } from './auth.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

function getDbFilename(userId) {
  return `flashcards-${userId}.json`;
}

async function driveFetch(url, options = {}, retry = true) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`
    }
  });

  if (res.status === 401 && retry) {
    return driveFetch(url, options, false);
  }
  return res;
}

async function findOrCreateFolder(folderName) {
  const q = encodeURIComponent(`name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const searchRes = await driveFetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name)`);
  if (!searchRes.ok) throw new Error(`Drive search failed: ${searchRes.status}`);

  const data = await searchRes.json();
  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }

  const createRes = await driveFetch(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder'
    })
  });
  if (!createRes.ok) throw new Error(`Drive folder create failed: ${createRes.status}`);
  const created = await createRes.json();
  return created.id;
}

async function findDbFile(folderId, userId) {
  const filename = getDbFilename(userId);
  const q = encodeURIComponent(`name='${filename}' and '${folderId}' in parents and trashed=false`);
  const res = await driveFetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name,modifiedTime)`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.files && data.files.length > 0 ? data.files[0] : null;
}

/**
 * Đọc data flashcard của user hiện tại từ Drive.
 * Trả về { version, cards, meta, _driveModifiedTime } hoặc null.
 */
export async function loadFromDrive() {
  const user = await getCurrentUser();
  if (!user) throw new Error('Chưa đăng nhập');

  const config = await getConfig();
  const folderId = await findOrCreateFolder(config.driveFolderName);
  const file = await findDbFile(folderId, user.userId);
  if (!file) return null;

  const res = await driveFetch(`${DRIVE_API}/files/${file.id}?alt=media`);
  if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    return {
      ...parsed,
      _driveModifiedTime: file.modifiedTime,
      _driveFileId: file.id
    };
  } catch {
    return null;
  }
}

/**
 * Ghi data flashcard của user hiện tại lên Drive.
 */
export async function saveToDrive(payload) {
  const user = await getCurrentUser();
  if (!user) throw new Error('Chưa đăng nhập');

  const config = await getConfig();
  const folderId = await findOrCreateFolder(config.driveFolderName);
  const existing = await findDbFile(folderId, user.userId);

  const enriched = {
    ...payload,
    _meta: {
      userId: user.userId,
      email: user.email,
      savedAt: Date.now(),
      ...(payload._meta || {})
    }
  };

  const metadata = {
    name: getDbFilename(user.userId),
    mimeType: 'application/json'
  };
  if (!existing) {
    metadata.parents = [folderId];
  }

  const boundary = '-------flashcard_boundary_' + Date.now();
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;

  const body =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\r\n\r\n' +
    JSON.stringify(enriched) +
    closeDelim;

  const url = existing
    ? `${DRIVE_UPLOAD}/files/${existing.id}?uploadType=multipart`
    : `${DRIVE_UPLOAD}/files?uploadType=multipart`;
  const method = existing ? 'PATCH' : 'POST';

  const res = await driveFetch(url, {
    method,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive upload failed: ${res.status} ${err}`);
  }
  return await res.json();
}

/**
 * Kiểm tra connection (có user, token còn hạn).
 */
export async function checkDriveConnection() {
  try {
    const user = await getCurrentUser();
    if (!user) return false;
    await getAccessToken();
    return true;
  } catch {
    return false;
  }
}
