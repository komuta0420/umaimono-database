// config.example.js - 公開設定（リポジトリにコミット済み）
// 秘密情報（AIのAPIキー）はアプリ内設定画面から入力 → ブラウザの localStorage に保存されます
// このファイルには公開しても問題ない設定のみ記載します

const CONFIG_DEFAULT = {
  // =============================
  // Google OAuth 2.0 クライアントID
  // Google Cloud Console で取得・設定済み
  // https://console.cloud.google.com/
  // =============================
  GOOGLE_CLIENT_ID: '25368500704-qipjp34h61oemh8u8d1pmikfbb1jjs32.apps.googleusercontent.com',

  // =============================
  // オーナーの Google アカウント（公開しないため空欄）
  // アプリ内の🔑設定画面から入力 → localStorage に保存されます
  // =============================
  OWNER_EMAIL: atob('a2NjLmtvbXRhbkBnbWFpbC5jb20='),

  // =============================
  // Google Drive 公開読み取り用 API キー
  // Google Cloud Console で取得（Drive API を有効にして発行）
  // ビューア（未ログイン）がDBを閲覧するために使用
  // 制限: Drive API のみ + このサイトのドメインに限定することを推奨
  // =============================
  GOOGLE_API_KEY: 'YOUR_GOOGLE_API_KEY',

  // =============================
  // Drive の restaurant-db フォルダID
  // オーナーが初回セットアップ後、設定画面に表示される値を貼り付けてコミットしてください
  // =============================
  DB_FOLDER_ID: '1U5cgLRCbormSqPHQvcN5Fe23U6ykRcBa',

  // =============================
  // 食べログURL検証設定
  // =============================
  VERIFY_TABELOG_URL: true,

  // =============================
  // AI プロバイダー設定（'gemini' / 'claude' / 'qwen'）
  // =============================
  AI_PROVIDER: 'gemini',

  // 以下は localStorage に保存される秘密キーのデフォルト（空）
  JINA_API_KEY: '',
  GEMINI_API_KEY: '',
  GEMINI_API_KEY_FREE: '',
  QWEN_API_KEY: '',
  CLAUDE_API_KEY: '',
};
