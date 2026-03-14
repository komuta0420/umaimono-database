// auth.js - Google OAuth 2.0 認証（Authorization Code Flow + Cloudflare Worker）

const AUTH = (() => {
  // OAuth 2.0 スコープ（Drive ファイル読み書き）
  const SCOPES = 'https://www.googleapis.com/auth/drive.file';
  const STORAGE_KEY = 'restaurant_db_token';
  // ログイン状態を永続化するフラグ（ページ再読み込み後も自動再ログインするため）
  const PERSISTENT_KEY = 'restaurant_db_logged_in';

  let codeClient = null;
  let currentToken = null;
  // トークン自動更新タイマーID
  let refreshTimer = null;
  // ポップアップブロック等でトークン更新が失敗し、ユーザー操作での再認証が必要
  let _reauthNeeded = false;
  // 再認証が必要になったときのコールバック
  let _onReauthNeeded = null;

  // ────────────────────────────────────────
  // Worker API 呼び出しヘルパー
  // ────────────────────────────────────────
  async function workerFetch(endpoint, body) {
    const res = await fetch(`${CONFIG.WORKER_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Worker error: ${res.status}`);
    }
    return data;
  }

  // ────────────────────────────────────────
  // authorization code → tokens（Worker経由）
  // ────────────────────────────────────────
  async function handleCodeResponse(response) {
    if (response.error) {
      throw new Error(`認証エラー: ${response.error}`);
    }

    // Worker にコードを送ってトークンと交換
    const data = await workerFetch('/auth/token', { code: response.code });

    // 既存の refresh_token を保持（Googleは2回目以降返さない場合がある）
    const saved = getSavedToken();
    const refreshToken = data.refresh_token || (saved && saved.refresh_token) || null;

    currentToken = {
      access_token: data.access_token,
      refresh_token: refreshToken,
      expires_at: Date.now() + (data.expires_in * 1000),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentToken));
    localStorage.setItem(PERSISTENT_KEY, '1');
    _reauthNeeded = false;
    scheduleTokenRefresh(currentToken.expires_at);
  }

  // ────────────────────────────────────────
  // refresh_token → new access_token（Worker経由、ポップアップ不要）
  // ────────────────────────────────────────
  async function refreshAccessToken() {
    const saved = getSavedToken();
    if (!saved || !saved.refresh_token) {
      throw new Error('refresh_token がありません');
    }

    const data = await workerFetch('/auth/refresh', { refresh_token: saved.refresh_token });

    currentToken = {
      access_token: data.access_token,
      refresh_token: saved.refresh_token,
      expires_at: Date.now() + (data.expires_in * 1000),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentToken));
    _reauthNeeded = false;
    scheduleTokenRefresh(currentToken.expires_at);
  }

  // ────────────────────────────────────────
  // localStorage からトークンを読み出す
  // ────────────────────────────────────────
  function getSavedToken() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  // ────────────────────────────────────────
  // 初期化: Google Identity Services をロード
  // ────────────────────────────────────────
  async function init() {
    // GIS (Google Identity Services) スクリプトのロード確認
    if (typeof google === 'undefined' || !google.accounts) {
      throw new Error('Google Identity Services が読み込まれていません');
    }

    // Authorization Code Client を初期化（コールバックは login() で設定）
    codeClient = google.accounts.oauth2.initCodeClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: SCOPES,
      ux_mode: 'popup',
      callback: () => {}, // login() で上書きする
    });

    // 保存済みトークンを復元
    const saved = getSavedToken();
    if (saved) {
      // アクセストークンがまだ有効（5分の余裕）
      if (saved.expires_at > Date.now() + 5 * 60 * 1000) {
        currentToken = saved;
        scheduleTokenRefresh(currentToken.expires_at);
        return;
      }

      // 期限切れだが refresh_token がある → サイレント更新（HTTP のみ）
      if (saved.refresh_token) {
        try {
          await refreshAccessToken();
          console.log('トークンをサイレント更新しました');
          return;
        } catch (e) {
          console.warn('サイレント更新失敗:', e);
          // refresh_token が失効 → 再認証が必要
          _reauthNeeded = true;
          if (_onReauthNeeded) _onReauthNeeded();
          return;
        }
      }
    }

    // 永続フラグがあるが refresh_token がない（旧形式トークン）→ 再認証を促す
    if (localStorage.getItem(PERSISTENT_KEY)) {
      _reauthNeeded = true;
      if (_onReauthNeeded) _onReauthNeeded();
    }
  }

  // ────────────────────────────────────────
  // ログイン（ユーザー操作で呼ばれる）
  // ────────────────────────────────────────
  async function login() {
    // 既に有効なトークンがあればそのまま返す
    if (currentToken && currentToken.expires_at > Date.now() + 60 * 1000) {
      return currentToken;
    }

    if (!codeClient) {
      throw new Error('認証クライアントが初期化されていません');
    }

    return new Promise((resolve, reject) => {
      // コールバックを設定してコードリクエスト
      codeClient.callback = async (response) => {
        try {
          await handleCodeResponse(response);
          resolve(currentToken);
        } catch (e) {
          reject(e);
        }
      };

      codeClient.requestCode();
    });
  }

  // ────────────────────────────────────────
  // トークン自動更新スケジューラー
  // 期限5分前にWorker経由でサイレント更新（ポップアップ不要）
  // ────────────────────────────────────────
  function scheduleTokenRefresh(expiresAt) {
    if (refreshTimer) clearTimeout(refreshTimer);
    // 期限5分前に更新（最小30秒後）
    const delay = Math.max(30 * 1000, expiresAt - Date.now() - 5 * 60 * 1000);
    refreshTimer = setTimeout(async () => {
      try {
        await refreshAccessToken();
        console.log('トークンを自動更新しました');
      } catch (e) {
        console.warn('トークン自動更新失敗:', e);
        _reauthNeeded = true;
        if (_onReauthNeeded) _onReauthNeeded();
      }
    }, delay);
  }

  // ────────────────────────────────────────
  // ログアウト
  // ────────────────────────────────────────
  async function logout() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }

    // Worker経由でトークンを失効
    if (currentToken && currentToken.access_token) {
      try {
        await workerFetch('/auth/revoke', { token: currentToken.access_token });
        console.log('トークンを失効させました');
      } catch (e) {
        console.warn('トークン失効エラー:', e);
      }
    }

    currentToken = null;
    _reauthNeeded = false;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PERSISTENT_KEY);
  }

  // ────────────────────────────────────────
  // アクセストークン取得（有効期限切れなら再取得）
  // ────────────────────────────────────────
  async function getAccessToken() {
    // トークンが有効なら即返す
    if (currentToken && currentToken.expires_at > Date.now() + 60 * 1000) {
      return currentToken.access_token;
    }

    // refresh_token があればサイレント更新
    const saved = getSavedToken();
    if (saved && saved.refresh_token) {
      try {
        await refreshAccessToken();
        return currentToken.access_token;
      } catch (e) {
        _reauthNeeded = true;
        if (_onReauthNeeded) _onReauthNeeded();
        throw new Error('REAUTH_NEEDED');
      }
    }

    // 再認証待ち状態の場合、ユーザー操作を促すエラーを投げる
    throw new Error('REAUTH_NEEDED');
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
