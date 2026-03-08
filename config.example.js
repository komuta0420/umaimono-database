// config.example.js - 設定テンプレート
// このファイルをコピーして config.js を作成し、実際のAPIキーを入力してください
// config.js は .gitignore により Git 管理外となります

const CONFIG = {
  // =============================
  // Google OAuth 2.0 設定
  // Google Cloud Console で取得
  // https://console.cloud.google.com/
  // =============================
  GOOGLE_CLIENT_ID: '25368500704-qipjp34h61oemh8u8d1pmikfbb1jjs32.apps.googleusercontent.com',

  // =============================
  // Google Geocoding API キー（任意）
  // 住所 → 緯度経度変換に使用
  // =============================
  GOOGLE_GEOCODING_API_KEY: 'YOUR_GOOGLE_GEOCODING_API_KEY',

  // =============================
  // 食べログURL検証設定
  // Jina AI Reader でページ取得し店名が一致するか確認する
  // true: 検証あり（誤URLを弾く）/ false: 検証なし・元の動作
  // =============================
  VERIFY_TABELOG_URL: true,

  // =============================
  // AI プロバイダー設定
  // 使用するAIを選択してください
  // =============================
  // デフォルト: 'gemini'
  // 選択肢: 'gemini'（Google検索）/ 'qwen'（Bing検索、無料枠1,000req/日）/ 'claude'
  AI_PROVIDER: 'gemini',

  // =============================
  // Jina AI API キー（Web検索用）
  // enrichStoreData / searchStore の検索に使用（無料枠: 1M tokens/月）
  // https://jina.ai/ でサインアップして取得（jina_... 形式）
  // =============================
  JINA_API_KEY: 'YOUR_JINA_API_KEY',

  // =============================
  // Gemini API キー（デフォルト）
  // Google AI Studio で取得
  // https://aistudio.google.com/
  // =============================
  GEMINI_API_KEY: 'YOUR_GEMINI_API_KEY',           // 有料枠・grounding用

  // =============================
  // Gemini API キー（無料枠・画像認識用）
  // analyzeScreenshot で使用（grounding なし）
  // diet manager 等の無料枠プロジェクトのキーを使用
  // =============================
  GEMINI_API_KEY_FREE: 'YOUR_GEMINI_API_KEY_FREE',  // 無料枠・画像認識用

  // =============================
  // Qwen DashScope API キー（オプション）
  // AI_PROVIDER を 'qwen' に変更した場合に使用
  // Alibaba Cloud DashScope で取得（無料枠1,000リクエスト/日）
  // https://dashscope.aliyun.com/
  // =============================
  QWEN_API_KEY: 'YOUR_QWEN_API_KEY',

  // =============================
  // Claude API キー（オプション）
  // AI_PROVIDER を 'claude' に変更した場合に使用
  // Anthropic Console で取得
  // https://console.anthropic.com/
  // =============================
  CLAUDE_API_KEY: 'YOUR_CLAUDE_API_KEY',
};
