// auth.js - Google OAuth 2.0 認証

const AUTH = (() => {
  // OAuth 2.0 スコープ（Drive ファイル読み書き）
  const SCOPES = 'https://www.googleapis.com/auth/drive.file';
  const STORAGE_KEY = 'restaurant_db_token';
  // ログイン状態を永続化するフラグ（ページ再読み込み後も自動再ログインするため）
  const PERSISTENT_KEY = 'restaurant_db_logged_in';

  let tokenClient = null;
  let currentToken = null;
  // init()のサイレント再ログインが完了するまで待機するためのPromise
  let initAuthPromise = null;

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
            resolve();
            return;
          }
        } catch (e) {
          localStorage.removeItem(STORAGE_KEY);
        }
      }

      // トークン期限切れでも永続フラグがあればサイレント再ログインを試みる
      // （Googleにサインイン済みなら画面操作なしで復帰できる）
      if (localStorage.getItem(PERSISTENT_KEY)) {
        let settled = false;
        const originalCallback = tokenClient.callback;

        // login()が競合しないよう、完了を追跡するPromiseを保持する
        initAuthPromise = new Promise((initResolve) => {
          tokenClient.callback = (response) => {
            originalCallback(response);
            if (!settled) {
              settled = true;
              tokenClient.callback = originalCallback;
              initAuthPromise = null;
              initResolve();
              resolve();
            }
          };

          // 4秒以内に応答がなければログアウト状態として起動
          setTimeout(() => {
            if (!settled) {
              settled = true;
              tokenClient.callback = originalCallback;
              initAuthPromise = null;
              initResolve();
              resolve();
            }
          }, 4000);
        });

        tokenClient.requestAccessToken({ prompt: '' });
      } else {
        resolve();
      }
    });
  }

  // ────────────────────────────────────────
  // ログイン（トークン要求）
  // forceConsent=true: 初回ログイン時（同意画面を表示）
  // forceConsent=false: 自動更新時（サイレント更新を試みる）
  // ────────────────────────────────────────
  async function login(forceConsent = true) {
    // init()のサイレント再ログインが進行中なら完了を待つ（競合防止）
    if (initAuthPromise) await initAuthPromise;

    // init()のサイレント再ログインで既にトークンが取得できていれば即返す
    if (currentToken && currentToken.expires_at > Date.now() + 60 * 1000) {
      return currentToken;
    }

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
        localStorage.setItem(PERSISTENT_KEY, '1'); // 永続フラグをセット
        resolve(currentToken);
      };

      // 既存トークンがあれば即座に解決、なければポップアップ
      if (currentToken) {
        resolve(currentToken);
      } else {
        // 初回は同意画面を表示、自動更新時はサイレント更新を試みる
        tokenClient.requestAccessToken({ prompt: forceConsent ? 'consent' : '' });
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
    localStorage.removeItem(PERSISTENT_KEY); // 永続フラグを削除
  }

  // ────────────────────────────────────────
  // アクセストークン取得（有効期限切れなら再取得）
  // ────────────────────────────────────────
  async function getAccessToken() {
    // トークンが有効なら即返す
    if (currentToken && currentToken.expires_at > Date.now() + 60 * 1000) {
      return currentToken.access_token;
    }

    // 期限切れ or 未ログイン → サイレント更新を試みる（ポップアップなし）
    const token = await login(false);
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
