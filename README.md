# LexiFlash — Vercel Web/PWA Version

Đây là bản đã convert từ Chrome Extension Manifest V3 sang web app tĩnh có thể deploy lên Vercel.

## Những phần đã convert

- Chrome popup UI → `/index.html`
- Options page → `/settings.html`
- `chrome.storage.local/sync` → `localStorage` compatibility layer trong `lib/browser-storage.js`
- `chrome.runtime.sendMessage` + background service worker → `lib/app-service.js`
- `chrome.identity.getAuthToken` → Google Identity Services OAuth token flow trong `lib/auth.js`
- Extension manifest → `manifest.webmanifest` cho PWA
- Vercel build config → `vercel.json` + `scripts/build.js`

## Những điểm khác so với Chrome Extension

- Web app không có background alarm chạy ngầm khi đóng tab, nên chức năng tự sinh từ lúc 7:00 sáng của extension không còn chạy ngầm như trước.
- Google Drive login phải dùng OAuth Client type **Web application**, không dùng OAuth Client type **Chrome Extension**.
- Dữ liệu local được lưu theo origin/domain của app. Nếu đổi domain, local storage cục bộ sẽ khác; Google Drive sync vẫn giúp restore dữ liệu.
- Gemini API key và Google OAuth Web Client ID được nhập tại trang Settings, không hardcode trong source.

## Chạy local

```bash
npm install
npm run dev
```

Mở:

```text
http://localhost:3000
```

Settings:

```text
http://localhost:3000/settings.html
```

## Deploy lên Vercel

Có thể import repo này vào Vercel. Project đã có sẵn:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist"
}
```

Build command sẽ copy static files vào `dist/`.

## Cấu hình Google OAuth cho bản web

Trong Google Cloud Console:

1. Enable **Google Drive API**.
2. Tạo OAuth Client ID với application type **Web application**.
3. Thêm Authorized JavaScript origins:
   - `http://localhost:3000`
   - `https://<your-vercel-domain>`
4. Copy Client ID vào `/settings.html` → **Google OAuth Web Client ID**.

## Cấu hình Gemini

Vào `/settings.html`, nhập Gemini API key và chọn model. Bản web này không giữ API key hardcoded trong source.

## Cấu trúc chính

```text
lexiflash-vercel/
├── index.html
├── settings.html
├── manifest.webmanifest
├── vercel.json
├── package.json
├── scripts/
│   ├── build.js
│   └── dev-server.js
├── lib/
│   ├── app-service.js
│   ├── auth.js
│   ├── browser-storage.js
│   ├── config.js
│   ├── drive.js
│   ├── gemini.js
│   └── sm2.js
├── popup/
│   ├── popup.css
│   ├── popup.html
│   └── popup.js
├── options/
│   ├── options.css
│   ├── options.html
│   └── options.js
└── icons/
```
