// auth.js - Google OAuth 2.0 認証

const AUTH = (() => {
  // OAuth 2.0 スコープ（Drive ファイル読み書き）
  const SCOPES = 'https://www.googleapis.com/auth/drive.file';
  const STORAGE_KEY = 'restaurant_db_token';

  let tokenClient = null;
  let currentToken = null;

  // ────────────────────────────────────────
  // 初期化: Google Identity Services をロード
  // ────────────────────────────────────────
  async function init() {
    return new Promise((resolve, reject) => {
      // GIS (Google Identity Services) スクリプトのロード確認
      if (typeof google === 'undefined' || !google.accounts) {
        reject(new Error('Google Identity Services が読み込まれていません'));
        return;
      }

      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.GOOGLE_CLIENT_ID,
        scope: SCOPES,
        callback: (response) => {
          if (response.error) {
            console.error('OAuth エラー:', response.error);
            return;
          }
          // トークンをメモリと localStorage に保存
          currentToken = {
            access_token: response.access_token,
            expires_at: Date.now() + (response.expires_in * 1000),
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(currentToken));
        },
      });

      // 保存済みトークンを復元
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // 有効期限チェック（5分の余裕を持たせる）
          if (parsed.expires_at > Date.now() + 5 * 60 * 1000) {
            currentToken = parsed;
          }
        } catch (e) {
          localStorage.removeItem(STORAGE_KEY);
        }
      }

      resolve();
    });
  }

  // ────────────────────────────────────────
  // ログイン（トークン要求）
  // ────────────────────────────────────────
  async function login() {
    return new Promise((resolve, reject) => {
      if (!tokenClient) {
        reject(new Error('認証クライアントが初期化されていません'));
        return;
      }

      // コールバックを上書きして Promise で解決
      tokenClient.callback = (response) => {
        if (response.error) {
          reject(new Error(`認証エラー: ${response.error}`));
          return;
        }
        currentToken = {
          access_token: response.access_token,
          expires_at: Date.now() + (response.expires_in * 1000),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(currentToken));
        resolve(currentToken);
      };

      // 既存トークンがあれば即座に解決、なければポップアップ
      if (currentToken) {
        resolve(currentToken);
      } else {
        tokenClient.requestAccessToken({ prompt: 'consent' });
      }
    });
  }

  // ────────────────────────────────────────
  // ログアウト
  // ────────────────────────────────────────
  function logout() {
    if (currentToken) {
      google.accounts.oauth2.revoke(currentToken.access_token, () => {
        console.log('トークンを失効させました');
      });
    }
    currentToken = null;
    localStorage.removeItem(STORAGE_KEY);
  }

  // ────────────────────────────────────────
  // アクセストークン取得（有効期限切れなら再取得）
  // ────────────────────────────────────────
  async function getAccessToken() {
    // トークンが有効なら即返す
    if (currentToken && currentToken.expires_at > Date.now() + 60 * 1000) {
      return currentToken.access_token;
    }

    // 期限切れ or 未ログイン → ログインフローを実行
    const token = await login();
    return token.access_token;
  }

  // ────────────────────────────────────────
  // ログイン状態確認
  // ────────────────────────────────────────
  function isLoggedIn() {
    return currentToken !== null && currentToken.expires_at > Date.now();
  }

  // ────────────────────────────────────────
  // ログイン中のユーザー情報を取得
  // ────────────────────────────────────────
  async function getUserInfo() {
    const token = await getAccessToken();
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('ユーザー情報の取得に失敗しました');
    return await res.json();
  }

  return { init, login, logout, getAccessToken, isLoggedIn, getUserInfo };
})();
