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
  // トークン自動更新タイマーID
  let refreshTimer = null;
  // ポップアップブロック等でトークン更新が失敗し、ユーザー操作での再認証が必要
  let _reauthNeeded = false;
  // 再認証が必要になったときのコールバック
  let _onReauthNeeded = null;

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
          // 再認証が成功したらフラグをクリア
          _reauthNeeded = false;
          scheduleTokenRefresh(currentToken.expires_at);
        },
        error_callback: (err) => {
          // ポップアップブロック等のエラーをキャッチ
          console.warn('OAuth ポップアップエラー:', err);
          // 以前ログインしていた場合は再認証待ち状態にする（ログアウトしない）
          if (localStorage.getItem(PERSISTENT_KEY)) {
            _reauthNeeded = true;
            if (_onReauthNeeded) _onReauthNeeded();
          }
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
            scheduleTokenRefresh(currentToken.expires_at);
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

          // 4秒以内に応答がなければ再認証待ち状態として起動
          setTimeout(() => {
            if (!settled) {
              settled = true;
              tokenClient.callback = originalCallback;
              initAuthPromise = null;
              // ポップアップがブロックされた可能性が高い → 再認証待ちにする
              _reauthNeeded = true;
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
        _reauthNeeded = false;
        scheduleTokenRefresh(currentToken.expires_at);
        resolve(currentToken);
      };

      // 有効なトークンがあれば即座に解決、なければ（再）取得
      if (currentToken && currentToken.expires_at > Date.now() + 60 * 1000) {
        resolve(currentToken);
      } else {
        // 初回は同意画面を表示、自動更新時はサイレント更新を試みる
        tokenClient.requestAccessToken({ prompt: forceConsent ? 'consent' : '' });
      }
    });
  }

  // ────────────────────────────────────────
  // トークン自動更新スケジューラー
  // 期限5分前にサイレント更新を実行し、ページを開いたままでも継続ログイン
  // ────────────────────────────────────────
  function scheduleTokenRefresh(expiresAt) {
    if (refreshTimer) clearTimeout(refreshTimer);
    // 期限5分前に更新（最小30秒後）
    const delay = Math.max(30 * 1000, expiresAt - Date.now() - 5 * 60 * 1000);
    refreshTimer = setTimeout(async () => {
      try {
        await login(false);
        console.log('トークンを自動更新しました');
      } catch (e) {
        console.warn('トークン自動更新失敗:', e);
      }
    }, delay);
  }

  // ────────────────────────────────────────
  // ログアウト
  // ────────────────────────────────────────
  function logout() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    if (currentToken) {
      google.accounts.oauth2.revoke(currentToken.access_token, () => {
        console.log('トークンを失効させました');
      });
    }
    currentToken = null;
    _reauthNeeded = false;
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

    // 再認証待ち状態の場合、ユーザー操作を促すエラーを投げる
    if (_reauthNeeded) {
      throw new Error('REAUTH_NEEDED');
    }

    // 期限切れ or 未ログイン → サイレント更新を試みる（ポップアップなし）
    const token = await login(false);
    return token.access_token;
  }

  // ────────────────────────────────────────
  // ログイン状態確認
  // ────────────────────────────────────────
  function isLoggedIn() {
    // トークンが有効、または再認証待ち（以前ログインしていた）ならtrue
    if (currentToken !== null && currentToken.expires_at > Date.now()) return true;
    if (_reauthNeeded && localStorage.getItem(PERSISTENT_KEY)) return true;
    return false;
  }

  // 再認証が必要かどうか
  function needsReauth() {
    return _reauthNeeded;
  }

  // 再認証が必要になったときのコールバックを登録
  function onReauthNeeded(callback) {
    _onReauthNeeded = callback;
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

  return { init, login, logout, getAccessToken, isLoggedIn, getUserInfo, needsReauth, onReauthNeeded };
})();
