# LexiFlash

LexiFlash là ứng dụng web/PWA học từ vựng tiếng Anh bằng flashcard, được chuyển đổi từ Chrome Extension Manifest V3 sang static web app để chạy local hoặc deploy lên Vercel. Ứng dụng dùng Gemini để sinh nội dung học, thuật toán SM-2 để lên lịch ôn tập và Google Drive để đồng bộ dữ liệu theo từng tài khoản.

## Tính năng chính

- Sinh flashcard tiếng Anh tự động bằng Gemini, gồm nghĩa tiếng Việt, IPA, word forms, ví dụ, bản dịch và mnemonic.
- Ôn tập theo thuật toán spaced repetition SM-2.
- Theo dõi tiến độ học trong ngày, streak, độ chính xác và thống kê thư viện từ.
- Thử thách đặt câu: AI chấm câu người học theo từ bắt buộc, ngữ pháp và độ tự nhiên.
- Đăng nhập nhiều Google account và chuyển tài khoản trong app.
- Đồng bộ flashcard lên Google Drive, mỗi user có một file dữ liệu riêng.
- Khôi phục dữ liệu từ Drive, xử lý conflict giữa dữ liệu local và dữ liệu cloud.
- Chạy như PWA với `manifest.webmanifest`.
- Deploy tĩnh lên Vercel, không cần backend riêng.

## Tech stack

- HTML, CSS, JavaScript ES Modules.
- Không dùng framework frontend.
- Không có runtime dependency trong `package.json`.
- Google Gemini API cho sinh flashcard và chấm câu.
- Google Identity Services OAuth token flow.
- Google Drive API với scope `drive.file`.
- Local storage compatibility layer thay cho `chrome.storage`.

## Yêu cầu

- Node.js 18+.
- NPM.
- Gemini API key.
- Google Cloud project đã bật Google Drive API.
- OAuth Client ID loại **Web application** nếu dùng Google Drive sync.

## Chạy local

Cài dependency:

```bash
npm install
```

Chạy dev server:

```bash
npm run dev
```

Mặc định app chạy tại:

```text
http://localhost:3000
```

Trang cài đặt:

```text
http://localhost:3000/settings.html
```

Đổi port khi cần:

```bash
PORT=5173 npm run dev
```

Với PowerShell:

```powershell
$env:PORT=5173
npm run dev
```

## Build

```bash
npm run build
```

Build script sẽ xoá và tạo lại thư mục `dist/`, sau đó copy các static asset cần deploy:

- `index.html`
- `settings.html`
- `manifest.webmanifest`
- `lib/`
- `popup/`
- `options/`
- `icons/`

## Deploy lên Vercel

Repo đã có sẵn `vercel.json`:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "cleanUrls": true
}
```

Cách deploy:

1. Import repository vào Vercel.
2. Giữ build command là `npm run build`.
3. Giữ output directory là `dist`.
4. Deploy.
5. Thêm domain Vercel vào Authorized JavaScript origins của OAuth Client ID.

Vercel rewrite có sẵn:

```text
/settings -> /settings.html
```

## Cấu hình Gemini

1. Mở `http://localhost:3000/settings.html`.
2. Nhập Gemini API key.
3. Chọn model.
4. Bấm kiểm tra API key.

Giá trị mặc định trong code:

```text
geminiModel: gemini-2.5-flash
wordsPerDay: 10
currentDifficulty: 1
difficultyIncrementPerDay: 1
```

Không hardcode API key vào source. API key được lưu trong storage của trình duyệt theo origin hiện tại.

## Cấu hình Google Drive Sync

Trong Google Cloud Console:

1. Tạo hoặc chọn một Google Cloud project.
2. Bật **Google Drive API**.
3. Cấu hình OAuth consent screen.
4. Tạo OAuth Client ID với application type **Web application**.
5. Thêm Authorized JavaScript origins:

```text
http://localhost:3000
https://<your-vercel-domain>
```

6. Copy Client ID vào `Settings -> Google OAuth Web Client ID`.
7. Bấm kết nối Google Drive trong app.

Scope app sử dụng:

```text
openid email profile https://www.googleapis.com/auth/drive.file
```

## Cơ chế lưu trữ dữ liệu

LexiFlash tách dữ liệu thành hai nhóm:

- Global config: Gemini API key, Gemini model, Google OAuth Client ID, số từ mỗi ngày, auto sync.
- Per-user state: độ khó hiện tại, ngày sinh từ gần nhất, streak và flashcards của user.

Flashcard được lưu local theo user:

```text
flashcards_v2_<userId>
```

Khi chưa đăng nhập, app dùng namespace:

```text
flashcards_v2_anonymous
```

Khi đồng bộ Drive, mỗi user có một file riêng trong folder cấu hình mặc định `flashcard-db`:

```text
flashcards-<userId>.json
```

Lưu ý: dữ liệu local gắn với origin/domain. Nếu đổi domain deploy, local storage sẽ khác; hãy dùng Google Drive sync để khôi phục dữ liệu.

## Cấu trúc thư mục

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
    ├── icon.svg
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

## Scripts

| Command | Mô tả |
| --- | --- |
| `npm run dev` | Chạy static dev server tại port `3000` hoặc `PORT` tuỳ chỉnh. |
| `npm run start` | Alias của `npm run dev`. |
| `npm run build` | Copy static app vào `dist/` để deploy. |

## Khác biệt so với Chrome Extension

- Web app không có background service worker chạy ngầm khi tab đã đóng.
- Tác vụ tự động theo alarm của extension không còn chạy khi app không được mở.
- OAuth phải dùng client type **Web application**, không dùng client type **Chrome Extension**.
- Dữ liệu local phụ thuộc origin của website.
- Cấu hình Gemini API key và Google OAuth Client ID được nhập trong Settings, không hardcode trong manifest/source.

## Troubleshooting

### Không đăng nhập được Google Drive

- Kiểm tra OAuth Client ID có đuôi `.apps.googleusercontent.com`.
- Đảm bảo đã dùng OAuth Client type **Web application**.
- Thêm đúng origin vào Authorized JavaScript origins.
- Nếu chạy local port khác `3000`, thêm origin tương ứng vào Google Cloud Console.

### Không sinh được flashcard

- Kiểm tra Gemini API key trong Settings.
- Bấm test API key để xác nhận key hợp lệ.
- Kiểm tra model đang chọn còn được Gemini API hỗ trợ.
- Kiểm tra trình duyệt có chặn request tới Google API không.

### Không thấy dữ liệu sau khi deploy domain mới

- Đây là hành vi bình thường vì local storage gắn với origin.
- Đăng nhập Google Drive và restore dữ liệu từ Drive.

### Đồng bộ Drive bị lỗi hoặc không có dữ liệu

- Kiểm tra đã cấp quyền Drive cho đúng Google account.
- Kiểm tra Drive có folder `flashcard-db`.
- Mỗi user có file riêng theo dạng `flashcards-<userId>.json`.
- Thử bấm Sync Now hoặc Restore From Drive trong Settings.

## Bảo mật

- Không commit Gemini API key hoặc OAuth secret vào repository.
- Web OAuth flow này chỉ cần OAuth Client ID, không dùng client secret ở frontend.
- Dữ liệu học được lưu trong trình duyệt và trong Google Drive của user khi bật sync.
- Nếu deploy public, người dùng nên tự nhập API key và Client ID của họ trong Settings.

## License

Chưa khai báo license. Hãy bổ sung file `LICENSE` trước khi phân phối public hoặc open source.
