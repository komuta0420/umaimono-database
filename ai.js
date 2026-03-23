// ai.js - AI解析（Gemini / Claude 共通インターフェース）
// CONFIG.AI_PROVIDER = 'gemini' または 'claude' で切り替え

const AI = (() => {
  // ────────────────────────────────────────
  // Gemini API 実装（デフォルト）
  // ────────────────────────────────────────
  const GEMINI = {
    API_BASE: 'https://generativelanguage.googleapis.com/v1beta',
    MODEL: 'gemini-2.5-flash', // 20RPD, 検索は無料だと500RPD(先に20RPD制限かかる)
    // MODEL: 'gemini-2.5-flash-lite',  // 20RPD, 検索は無料だと500RPD(先に20RPD制限かかる)
    // MODEL: 'gemini-3-flash-preview', // 無料だと検索機能✕　
    // MODEL: 'gemini-3.1-flash-lite-previe', // 無料だと検索機能✕　https://ai.google.dev/gemini-api/docs/pricing?hl=ja

    // 通常リクエスト（画像解析用、JSON強制モード）
    async request(prompt, imageBase64 = null) {
      const parts = [{ text: prompt }];
      if (imageBase64) {
        parts.unshift({
          inlineData: {
            mimeType: 'image/jpeg',
            data: imageBase64,
          },
        });
      }

      const body = {
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      };

      const res = await fetch(
        `${this.API_BASE}/models/gemini-3.1-flash-lite-preview:generateContent?key=${CONFIG.GEMINI_API_KEY_FREE}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Gemini API エラー: ${err.error?.message || res.statusText}`);
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Gemini からの応答が空です');

      try {
        return JSON.parse(text);
      } catch {
        return { raw: text };
      }
    },

    // Google検索グラウンディングを使ったリクエスト（Web検索して回答）
    async requestWithSearch(prompt) {
      const body = {
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.1 },
      };

      const res = await fetch(
        `${this.API_BASE}/models/${this.MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Gemini API 詳細エラー:', JSON.stringify(err, null, 2));
        throw new Error(`Gemini API エラー: ${err.error?.message || res.statusText}`);
      }

      const data = await res.json();
      // グラウンディング時は複数パーツからテキストを結合
      const parts = data.candidates?.[0]?.content?.parts || [];
      const text = parts.map((p) => p.text || '').join('');
      if (!text) throw new Error('Gemini からの応答が空です');

      // レスポンスからJSON部分を抽出
      const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) ||
        text.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        try { return JSON.parse(jsonMatch[1]); } catch { /* fallthrough */ }
      }
      try { return JSON.parse(text); } catch {
        return { raw: text };
      }
    },
  };

  // ────────────────────────────────────────
  // Claude API 実装（コメントアウト状態）
  // AI_PROVIDER を 'claude' にした場合に使用
  // ────────────────────────────────────────
  const CLAUDE = {
    API_BASE: 'https://api.anthropic.com/v1',
    MODEL: 'claude-opus-4-6',

    async request(prompt, imageBase64 = null) {
      const content = [];
      if (imageBase64) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: imageBase64,
          },
        });
      }
      content.push({ type: 'text', text: prompt });

      const body = {
        model: this.MODEL,
        max_tokens: 2048,
        messages: [{ role: 'user', content }],
      };

      const res = await fetch(`${this.API_BASE}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CONFIG.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Claude API エラー: ${err.error?.message || res.statusText}`);
      }

      const data = await res.json();
      const text = data.content?.[0]?.text;
      if (!text) throw new Error('Claude からの応答が空です');

      // JSON 部分を抽出
      const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) ||
        text.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1]);
        } catch { /* fallthrough */ }
      }

      try {
        return JSON.parse(text);
      } catch {
        return { raw: text };
      }
    },
  };

  // ────────────────────────────────────────
  // Qwen DashScope API 実装（無料枠1,000リクエスト/日）
  // AI_PROVIDER を 'qwen' にした場合に使用
  // ────────────────────────────────────────
  // Qwen web_search グラウンディングを使ったリクエスト（Bing検索）
  async function requestQwenWithSearch(prompt) {
    const body = {
      model: 'qwen-plus',
      messages: [{ role: 'user', content: prompt }],
      tools: [{ type: 'builtin_function', name: 'web_search' }],
      temperature: 0.1,
    };

    const res = await fetch(
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CONFIG.QWEN_API_KEY}`,
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('Qwen API 詳細エラー:', JSON.stringify(err, null, 2));
      throw new Error(`Qwen API エラー: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    if (!text) throw new Error('Qwen からの応答が空です');

    // レスポンスからJSON部分を抽出（Gemini版と同様のパース処理）
    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) ||
      text.match(/(\{[\s\S]*\})/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[1]); } catch { /* fallthrough */ }
    }
    try { return JSON.parse(text); } catch {
      return { raw: text };
    }
  }

  // ────────────────────────────────────────
  // Jina AI Search + Gemini Flash Lite（無料キー）によるリクエスト
  //
  // 【変更理由】(2026-03-08)
  // Gemini grounding（requestWithSearch）は検索とLLM処理が1APIコールで分離不可。
  // food-shop-database プロジェクトを Tier1（有料）に移行後、grounding のトークン
  // 処理分が課金対象になる恐れがあった。
  // → Jina AI Search（s.jina.ai、完全無料・APIキー不要）で検索結果を取得し、
  //   Flash Lite（GEMINI_API_KEY_FREE、無料枠500RPD）でテキスト処理することで
  //   完全無料化を実現。
  // ────────────────────────────────────────
  // Jina AI Search（検索）
  // APIキーがあれば認証ありで高レート、なければ無料tierで動作
  async function jinaSearch(query) {
    const headers = { 'Accept': 'text/plain' };
    if (CONFIG.JINA_API_KEY) headers['Authorization'] = `Bearer ${CONFIG.JINA_API_KEY}`;
    const res = await fetch(`https://s.jina.ai/${encodeURIComponent(query)}`, { headers });
    if (!res.ok) throw new Error(`Jina Search エラー: ${res.status}`);
    return await res.text();
  }

  // Jina AI Reader（URLのページ本文取得）
  async function jinaRead(url) {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { 'Accept': 'text/plain' },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.split('\n').filter(line =>
      !/Switch to|Click here to change|한국어|클릭|简体中文|点击/.test(line)
    ).join('\n');
  }

  // 食べログ専用 Jina Reader
  // X-Target-Selector でデータセクションを狙い、ナビゲーションを除去
  async function jinaReadTabelog(url) {
    const headers = { 'Accept': 'text/plain' };
    if (CONFIG.JINA_API_KEY) {
      // APIキーがある場合のみカスタムヘッダーを付与（CORSプリフライトを回避）
      headers['Authorization'] = `Bearer ${CONFIG.JINA_API_KEY}`;
      headers['X-Target-Selector'] = '#rstdata, .rstinfo-table, #rst-data-head, .js-rstinfo-table';
      headers['X-Remove-Selector'] = 'header, nav, footer, .modal-overlay, .lang-change, .breadcrumb, .rstlist-contents';
    }
    const res = await fetch(`https://r.jina.ai/${url}`, { headers });
    if (!res.ok) return null;
    const text = await res.text();
    return text.split('\n').filter(line =>
      !/Switch to|Click here to change|한국어|클릭|简体中文|点击/.test(line)
    ).join('\n');
  }

  // searchStore 用: 1クエリ検索 → Gemini 抽出
  async function requestJinaWithFree(searchQuery, extractPrompt) {
    const searchText = await jinaSearch(searchQuery);
    const fullPrompt = `${extractPrompt}\n\n# 検索結果\n${searchText.slice(0, 6000)}`;
    return await GEMINI.request(fullPrompt);
  }

  // ────────────────────────────────────────
  // 使用するプロバイダーを返す
  // ────────────────────────────────────────
  function getProvider() {
    if (CONFIG.AI_PROVIDER === 'claude') return CLAUDE;
    if (CONFIG.AI_PROVIDER === 'qwen') return 'qwen';
    return GEMINI;
  }

  // ────────────────────────────────────────
  // スクリーンショット解析（画像から読み取れる情報 + 検索用識別子のみ）
  // 返値: { name, search_query, shop_instagram, area, tags, memo }
  // ────────────────────────────────────────
  async function analyzeScreenshot(base64Image) {
    const prompt = `
この画像はレストランや飲食店に関するスクリーンショットです（Instagramや食べログ等）。
画像から読み取れる情報を以下のJSON形式で返してください。
情報が読み取れない項目は null にしてください。

【重要な判断基準】
- 投稿ヘッダーに表示されているアカウント名は「投稿者（グルメレポーター等）」であり、店ではない場合が多い
- キャプション内に登場する @〇〇 が店の公式インスタアカウントの可能性が高い
- 画像内のロケーションタグ、地名テキスト、ハッシュタグからエリアを特定する
- 店名はキャプション本文、画像内のテキスト、ロケーションタグから探す

{
  "name": "店名（必須。キャプション・画像テキスト・ロケーションタグから特定する。不明な場合はnull）",
  "search_query": "検索キーワード（「店名 エリア ジャンル」形式。例: Le Coin 日暮里 カフェ）",
  "shop_instagram": "店の公式インスタハンドル（キャプション内の@〇〇。投稿者とは別。例: @lecoin1224。なければnull）",
  "area": "エリア・地区名（ロケーションタグや地名から。なければnull）",
  "tags": ["読み取れたタグ"],
  "memo": "読み取れた特記事項。なければnull"
}

JSONのみを返してください。余分なテキストは不要です。
`;

    try {
      return await getProvider().request(prompt, base64Image);
    } catch (e) {
      console.error('スクリーンショット解析エラー:', e);
      // フォールバック: 空データを返す
      return {
        name: null, search_query: null, shop_instagram: null,
        area: null, tags: [], memo: null,
        _error: e.message,
      };
    }
  }

  // ────────────────────────────────────────
  // 店名検索: 候補リストを返す
  // 返値: [{ name, station, area, address, reason }, ...]
  // ────────────────────────────────────────
  async function searchStore(storeName, stationName = '') {
    const stationHint = stationName ? ` ${stationName}駅周辺` : '';
    const searchQuery = `${storeName}${stationHint} 飲食店`;

    const extractPrompt = `
以下の検索結果を参照して、「${storeName}」${stationHint ? `（${stationHint.trim()}）` : ''}に該当する飲食店の候補を最大5件、JSON配列で返してください。
情報が不明な項目は null にしてください。

# 候補選定ルール
1. 店名が完全一致 or ほぼ一致する結果を最優先
2. 駅名・エリアが指定されている場合、近辺の店を優先
3. 同名の店が複数ある場合、地域で区別して全て候補に含める
4. 飲食店以外の結果は除外
5. 該当なしなら空配列 [] を返す

[
  {
    "name": "店名",
    "station": "最寄り駅名",
    "area": "エリア",
    "address": "住所",
    "genres": ["ジャンル"],
    "reason": "この候補を選んだ理由（日本語30文字以内）"
  }
]

JSONのみを返してください。余分なテキストは不要です。
`;

    try {
      const provider = getProvider();
      let result;
      if (CONFIG.USE_GEMINI_GROUNDING && provider === GEMINI) {
        // Gemini grounding モード: Google検索を使って1回で候補を取得
        result = await GEMINI.requestWithSearch(
          `「${storeName}」${stationHint ? `（${stationHint.trim()}）` : ''}という店をGoogle検索して、候補を最大5件JSON配列で返してください。\n\n` + extractPrompt
        );
      } else if (provider === GEMINI) {
        // Jina Search + Flash Lite モード（USE_GEMINI_GROUNDING=false 時）
        result = await requestJinaWithFree(searchQuery, extractPrompt);
      } else if (provider === 'qwen') {
        result = await requestQwenWithSearch(
          `「${storeName}」${stationHint ? `（${stationHint.trim()}）` : ''}という飲食店を検索して候補を最大5件JSON配列で返してください。` + extractPrompt
        );
      } else {
        result = await provider.request(extractPrompt);
      }
      return Array.isArray(result) ? result : [];
    } catch (e) {
      console.error('店舗検索エラー:', e);
      return [];
    }
  }

  // ────────────────────────────────────────
  // 食べログURL検証（Jina AI Reader でページ取得し店名確認）
  // CONFIG.VERIFY_TABELOG_URL: true の場合に使用
  // ────────────────────────────────────────
  async function verifyTabelogUrl(url, storeName) {
    if (!url || !storeName) return null;
    try {
      const res = await fetch(`https://r.jina.ai/${url}`, {
        headers: { 'Accept': 'text/plain' },
      });
      if (!res.ok) return null;
      const text = await res.text();
      // 店名（スペース・記号を無視して部分一致確認）
      const normalized = (s) => s.replace(/[\s・\-_]/g, '').toLowerCase();
      if (normalized(text).includes(normalized(storeName))) return url;
      console.warn(`食べログURL不一致: "${storeName}" が ${url} に見つかりません`);
      return null;
    } catch (e) {
      console.warn('食べログURL検証エラー:', e.message);
      return null;
    }
  }

  // ────────────────────────────────────────
  // スクショ解析結果を受け取りWebから詳細情報を収集
  // 引数: analyzeScreenshot の返値 { name, search_query, shop_instagram, area }
  // 返値: { station, address, hours, closed,
  //         url_tabelog, url_instagram, url_official,
  //         shop_instagram, area, tags, memo }
  // ────────────────────────────────────────
  async function enrichStoreData({ name, search_query, shop_instagram, area } = {}) {
    // 1. 検索キーワードを最適化（エリア情報を強制的に入れる）
    const baseQuery = search_query || name;
    const optimizedQuery = area ? `${area} ${baseQuery}` : baseQuery;

    const extractPrompt = `
# 依頼
以下の3セクションの検索結果から「${name}」（エリア: ${area || '不明'}）の情報を抽出し、JSONで出力してください。
${shop_instagram ? `店の公式Instagram: ${shop_instagram}` : ''}

# 各セクションの役割
- 「食べログページ」: address / hours / closed / station / url_tabelog を探す
- 「Instagram・公式サイト検索」: url_instagram（instagram.com/...）と url_official（tabelog/instagram 以外のURL）を探す

# 食べログURL 厳守事項
- 「tabelog.com/.../{数字}/」形式のURLのみ採用
- エリア（${area || '不明'}）が一致することを確認
- 確信が持てない場合は null（推測・生成禁止）

# 全般的な厳守事項
- 検索結果に含まれる情報だけを記入する
- 不明な項目は null にする
- URLは検索結果に実際に存在するものだけ記入し、推測・補完・生成は絶対にしない

# 出力形式 (JSON)
{
  "station": "最寄り駅名",
  "area": "${area || 'エリア名'}",
  "address": "正確な住所（〒含む）",
  "hours": "営業時間",
  "closed": "定休日",
  "url_tabelog": "食べログURL",
  "url_instagram": "Instagram URL",
  "url_official": "公式サイトURL（tabelog/instagram以外）",
  "shop_instagram": "${shop_instagram || null}",
  "tags": ["特徴"],
  "memo": "特記事項"
}

JSONのみを返してください。余分なテキストは不要です。
`;

    try {
      const provider = getProvider();
      let result;
      if (CONFIG.USE_GEMINI_GROUNDING && provider === GEMINI) {
        // Gemini grounding モード: 食べログ特化で検索 + 必要時Instagram補完
        const knownInstagramUrl = shop_instagram
          ? `https://www.instagram.com/${shop_instagram.replace(/^@/, '')}/`
          : null;

        // ── Call 1: 食べログ特化（1RPD）──
        const tabelogPrompt = `
「${name}」（${area || ''}）の食べログページをGoogle検索で探してください。

# 出力形式 (JSON)
{
  "url_tabelog": "食べログURL（検索結果に実在するtabelog.comのURLのみ。推測・生成禁止）",
  "station": "最寄り駅名",
  "area": "${area || 'エリア名'}",
  "address": "住所（〒含む）",
  "hours": "営業時間",
  "closed": "定休日",
  "url_instagram": "検索結果にInstagram URLがあれば記入（なければnull）",
  "url_official": "検索結果に公式サイトURLがあれば記入（なければnull）",
  "shop_instagram": "Instagramハンドル（なければnull）",
  "tags": ["特徴"],
  "memo": "特記事項"
}

# 注意
- url_tabelog は検索結果に実際に表示された tabelog.com のURLのみ記入する
- 存在しないURLの推測・補完・生成は絶対にしない
- 見つからない項目は null

JSONのみを返してください。
`;
        try {
          result = await GEMINI.requestWithSearch(tabelogPrompt);
        } catch (e) {
          console.error('食べログ検索エラー:', e);
          result = {};
        }

        // knownInstagramUrl があれば確実にセット
        if (knownInstagramUrl) {
          result.url_instagram = knownInstagramUrl;
          result.shop_instagram = shop_instagram;
        }

        // ── Call 2: Instagramが取れなかった場合のみ補完（+1RPD）──
        const needsInstagram = !result.url_instagram && !knownInstagramUrl;
        if (needsInstagram) {
          const snsPrompt = `
「${name}」（${area || ''}）のInstagramアカウントと公式サイトをGoogle検索で探してください。

# 出力形式 (JSON)
{
  "url_instagram": "instagram.com のURL（検索結果に実在するもののみ）",
  "url_official": "公式サイトURL（tabelog.com / instagram.com 以外）",
  "shop_instagram": "Instagramハンドル（@付き。なければnull）",
  "tags": ["特徴"],
  "memo": "特記事項"
}

# 注意
- URLは検索結果に実際に表示されたもののみ記入する
- 存在しないURLの推測・補完・生成は絶対にしない
- 見つからない項目は null

JSONのみを返してください。
`;
          try {
            const snsResult = await GEMINI.requestWithSearch(snsPrompt);
            // 不足フィールドのみ補完（Call 1の結果を上書きしない）
            for (const key of ['url_instagram', 'url_official', 'shop_instagram']) {
              if (!result[key] && snsResult[key]) result[key] = snsResult[key];
            }
            // tags/memo: Call 1が空の場合はCall 2で上書き
            if ((!result.tags || result.tags.length === 0) && snsResult.tags?.length > 0) {
              result.tags = snsResult.tags;
            }
            if (!result.memo && snsResult.memo) {
              result.memo = snsResult.memo;
            }
          } catch (e) {
            console.error('SNS検索エラー:', e);
            // Call 1の結果だけで続行
          }
        }
      } else if (provider === GEMINI) {
        // Jina Search + Flash Lite モード（USE_GEMINI_GROUNDING=false 時）
        const [tabelogText, snsText] = await Promise.all([
          jinaSearch(`${optimizedQuery} 食べログ`),
          jinaSearch(`${name} ${area || ''} Instagram 公式サイト`),
        ]);

        // 食べログURLをregexで抽出してページを読む
        const tabelogMatch = tabelogText.match(
          /https?:\/\/tabelog\.com\/[a-z]+\/[A-Z0-9]+\/[A-Z0-9]+\/[0-9]+\//
        );
        const tabelogPageText = tabelogMatch ? await jinaReadTabelog(tabelogMatch[0]) : null;

        const sections = [
          tabelogPageText
            ? `## 食べログページ（住所・営業時間・定休日の主要ソース）\n${tabelogPageText.slice(0, 6000)}`
            : `## 食べログ検索\n${tabelogText.slice(0, 4000)}`,
          `## Instagram・公式サイト検索\n${snsText.slice(0, 3000)}`,
        ].join('\n\n');
        result = await GEMINI.request(`${extractPrompt}\n\n# 取得コンテンツ\n${sections}`);

        if (tabelogMatch) {
          result.url_tabelog = await verifyTabelogUrl(tabelogMatch[0], name);
        }
      } else if (provider === 'qwen') {
        result = await requestQwenWithSearch(extractPrompt);
      // Claude版: Web検索なし（プロンプトのみ）
      } else {
        result = await provider.request(extractPrompt);
      }
      return result;
    } catch (e) {
      console.error('詳細情報補完エラー:', e);
      return {
        station: null, area: null, address: null, hours: null, closed: null,
        url_tabelog: null, url_instagram: null, url_official: null,
        shop_instagram: null, tags: [], memo: null, _error: e.message,
      };
    }
  }

  // fetchStoreDetails は enrichStoreData で代替済みのため削除

  return {
    analyzeScreenshot,
    enrichStoreData,
    searchStore,
  };
})();
