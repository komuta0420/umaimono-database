// food-shop-auth - Cloudflare Worker
// Google OAuth Authorization Code Flow のトークン交換プロキシ

export default {
  async fetch(request, env) {
    // CORS プリフライト
    if (request.method === 'OPTIONS') {
      return corsResponse(env, new Response(null, { status: 204 }));
    }

    // POST のみ許可
    if (request.method !== 'POST') {
      return corsResponse(env, Response.json({ error: 'Method not allowed' }, { status: 405 }));
    }

    // Origin チェック
    const origin = request.headers.get('Origin');
    if (env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/auth/token') {
        return corsResponse(env, await handleToken(request, env));
      } else if (path === '/auth/refresh') {
        return corsResponse(env, await handleRefresh(request, env));
      } else if (path === '/auth/revoke') {
        return corsResponse(env, await handleRevoke(request));
      } else {
        return corsResponse(env, Response.json({ error: 'Not found' }, { status: 404 }));
      }
    } catch (e) {
      return corsResponse(env, Response.json({ error: e.message }, { status: 500 }));
    }
  },
};

// ────────────────────────────────────────
// POST /auth/token — authorization code → tokens
// ────────────────────────────────────────
async function handleToken(request, env) {
  const { code } = await request.json();
  if (!code) {
    return Response.json({ error: 'code is required' }, { status: 400 });
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: 'postmessage',
      grant_type: 'authorization_code',
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    return Response.json({ error: data.error_description || data.error }, { status: res.status });
  }

  return Response.json({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
  });
}

// ────────────────────────────────────────
// POST /auth/refresh — refresh_token → new access_token
// ────────────────────────────────────────
async function handleRefresh(request, env) {
  const { refresh_token } = await request.json();
  if (!refresh_token) {
    return Response.json({ error: 'refresh_token is required' }, { status: 400 });
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    return Response.json({ error: data.error_description || data.error }, { status: res.status });
  }

  return Response.json({
    access_token: data.access_token,
    expires_in: data.expires_in,
  });
}

// ────────────────────────────────────────
// POST /auth/revoke — トークン失効
// ────────────────────────────────────────
async function handleRevoke(request) {
  const { token } = await request.json();
  if (!token) {
    return Response.json({ error: 'token is required' }, { status: 400 });
  }

  const res = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return Response.json({ error: data.error_description || 'revoke failed' }, { status: res.status });
  }

  return Response.json({ success: true });
}

// ────────────────────────────────────────
// CORS ヘッダー付与
// ────────────────────────────────────────
function corsResponse(env, response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN || '*');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
