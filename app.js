// app.js - アプリロジック・CRUD・検索・フィルタ

// ────────────────────────────────────────
// グローバル状態
// ────────────────────────────────────────
let stores = [];   // 全店舗データ（メモリ）
let genres = [];   // 全ジャンルデータ（メモリ）

// 現在の検索・フィルタ状態
let currentFilter = {
  query: '',
  genreIds: [],
  stationName: '',
  budgetRange: null, // 'low' | 'mid' | 'high' | 'premium'
  visitedState: 'all', // 'all' | 'visited' | 'unvisited'
  wantLevel: 'all',   // 'all' | '1' | '2'
  includesTags: false,
  sortBy: 'added_desc', // 'added_desc' | 'added_asc' | 'score_desc' | 'score_asc'
};

// ────────────────────────────────────────
// データロード（起動時に1回だけ呼ぶ）
// ────────────────────────────────────────
async function loadData() {
  try {
    [stores, genres] = await Promise.all([
      DRIVE.driveReadJson('db.json'),
      DRIVE.driveReadJson('genres.json'),
    ]);

    // genres.json が空の場合、ローカルの genres.json から初期データを投入
    if (!genres || genres.length === 0) {
      const res = await fetch('./genres.json');
      genres = await res.json();
      await DRIVE.driveWriteJson('genres.json', genres);
    }

    // stores が null/undefined の場合は空配列
    if (!stores) stores = [];

    return true;
  } catch (e) {
    console.error('データロードエラー:', e);
    throw e;
  }
}

// ────────────────────────────────────────
// UUID 生成
// ────────────────────────────────────────
function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

// ────────────────────────────────────────
// 店舗 CRUD
// ────────────────────────────────────────
async function addStore(storeData) {
  const now = new Date().toISOString();
  const store = {
    id: generateId(),
    name: storeData.name || '',
    genres: storeData.genres || [],
    station: storeData.station || '',
    area: storeData.area || '',
    address: storeData.address || '',
    lat: storeData.lat || null,
    lng: storeData.lng || null,
    budget_min: storeData.budget_min || null,
    budget_max: storeData.budget_max || null,
    hours: storeData.hours || '',
    closed: storeData.closed || '',
    url_tabelog: storeData.url_tabelog || '',
    url_instagram: storeData.url_instagram || '',
    url_official: storeData.url_official || '',
    google_map_score: storeData.google_map_score || null,
    tags: storeData.tags || [],
    memo: storeData.memo || '',
    visited: storeData.visited || false,
    want_level: storeData.want_level || 0,
    review_score: storeData.review_score || null,
    review_text: storeData.review_text || '',
    review_images: storeData.review_images || [],
    review_date: storeData.review_date || null,
    added_at: now,
  };

  stores.push(store);
  await DRIVE.driveWriteJson('db.json', stores);
  return store;
}

async function updateStore(storeId, updates) {
  const idx = stores.findIndex((s) => s.id === storeId);
  if (idx === -1) throw new Error(`店舗が見つかりません: ${storeId}`);

  stores[idx] = { ...stores[idx], ...updates };
  await DRIVE.driveWriteJson('db.json', stores);
  return stores[idx];
}

async function deleteStore(storeId) {
  const store = stores.find((s) => s.id === storeId);
  if (!store) throw new Error(`店舗が見つかりません: ${storeId}`);

  // Drive の画像ファイルを削除
  for (const fileId of (store.review_images || [])) {
    try {
      await DRIVE.driveDeleteFile(fileId);
    } catch (e) {
      console.warn(`画像削除失敗 (${fileId}):`, e);
    }
  }

  stores = stores.filter((s) => s.id !== storeId);
  await DRIVE.driveWriteJson('db.json', stores);
}

function getStore(storeId) {
  return stores.find((s) => s.id === storeId) || null;
}

// ────────────────────────────────────────
// ジャンル CRUD
// ────────────────────────────────────────
async function addGenre(genreData) {
  const maxOrder = genres.reduce((m, g) => Math.max(m, g.order || 0), 0);
  const genre = {
    id: generateId(),
    name: genreData.name || '',
    emoji: genreData.emoji || '🍽️',
    color: genreData.color || '#888888',
    order: genreData.order || maxOrder + 1,
  };
  genres.push(genre);
  await DRIVE.driveWriteJson('genres.json', genres);
  return genre;
}

async function updateGenre(genreId, updates) {
  const idx = genres.findIndex((g) => g.id === genreId);
  if (idx === -1) throw new Error(`ジャンルが見つかりません: ${genreId}`);
  genres[idx] = { ...genres[idx], ...updates };
  await DRIVE.driveWriteJson('genres.json', genres);
  return genres[idx];
}

async function deleteGenre(genreId) {
  genres = genres.filter((g) => g.id !== genreId);
  await DRIVE.driveWriteJson('genres.json', genres);
}

async function reorderGenres(orderedIds) {
  orderedIds.forEach((id, index) => {
    const genre = genres.find((g) => g.id === id);
    if (genre) genre.order = index + 1;
  });
  genres.sort((a, b) => a.order - b.order);
  await DRIVE.driveWriteJson('genres.json', genres);
}

function getGenresSorted() {
  return [...genres].sort((a, b) => (a.order || 0) - (b.order || 0));
}

// ────────────────────────────────────────
// 検索・フィルタ
// ────────────────────────────────────────

// フリーワード検索（店名・エリア・駅名・メモ・タグ）
function matchQuery(store, query, includesTags = false) {
  if (!query) return true;
  const terms = query.trim().split(/\s+/).filter(Boolean);
  const targets = [
    store.name,
    store.area,
    store.station,
    store.memo,
    ...(includesTags ? (store.tags || []) : []),
  ].map((s) => (s || '').toLowerCase());

  // TODO: あいまい検索 - 将来AI実装予定
  // 現在はルールベース: 全タームが少なくとも1フィールドにマッチすればOK
  return terms.every((term) => targets.some((t) => t.includes(term.toLowerCase())));
}

// 予算範囲フィルタ
function matchBudget(store, budgetRange) {
  if (!budgetRange) return true;
  const min = store.budget_min;
  const max = store.budget_max;
  const price = max || min; // 最高額を基準に判定
  if (!price) return true;

  switch (budgetRange) {
    case 'low':     return price <= 1000;
    case 'mid':     return price > 1000 && price <= 3000;
    case 'high':    return price > 3000 && price <= 8000;
    case 'premium': return price > 8000;
    default:        return true;
  }
}

// メインフィルタ関数
async function filterStores(filter = currentFilter) {
  let result = [...stores];

  // フリーワード検索
  if (filter.query) {
    result = result.filter((s) => matchQuery(s, filter.query, filter.includesTags));
  }

  // ジャンル絞り込み（複数選択、OR条件）
  if (filter.genreIds && filter.genreIds.length > 0) {
    result = result.filter((s) =>
      (s.genres || []).some((g) => filter.genreIds.includes(g))
    );
  }

  // 駅名 + 半径1.2km フィルタ
  if (filter.stationName) {
    const filtered = [];
    for (const s of result) {
      if (s.lat && s.lng) {
        const within = await GEO.isWithin15min(s.lat, s.lng, filter.stationName);
        if (within) filtered.push(s);
      }
    }
    result = filtered;
  }

  // 予算フィルタ
  result = result.filter((s) => matchBudget(s, filter.budgetRange));

  // 訪問状態フィルタ
  if (filter.visitedState === 'visited') {
    result = result.filter((s) => s.visited);
  } else if (filter.visitedState === 'unvisited') {
    result = result.filter((s) => !s.visited);
  }

  // want_level フィルタ
  if (filter.wantLevel === '1') {
    result = result.filter((s) => s.want_level >= 1);
  } else if (filter.wantLevel === '2') {
    result = result.filter((s) => s.want_level >= 2);
  }

  // 並び替え
  result.sort((a, b) => {
    switch (filter.sortBy) {
      case 'added_asc':
        return new Date(a.added_at) - new Date(b.added_at);
      case 'score_desc':
        return (b.review_score || 0) - (a.review_score || 0);
      case 'score_asc':
        return (a.review_score || 0) - (b.review_score || 0);
      case 'added_desc':
      default:
        return new Date(b.added_at) - new Date(a.added_at);
    }
  });

  return result;
}

// ジャンル別にグルーピング（アコーディオン用）
function groupByGenre(storeList) {
  const sortedGenres = getGenresSorted();
  const groups = sortedGenres.map((genre) => ({
    genre,
    stores: storeList.filter((s) => (s.genres || []).includes(genre.name)),
  }));

  // ジャンル未設定の店舗を「その他」として追加
  const categorized = new Set(storeList.flatMap((s) => s.genres || []));
  const uncategorized = storeList.filter(
    (s) => !s.genres || s.genres.length === 0
  );
  if (uncategorized.length > 0) {
    groups.push({
      genre: { id: 'uncategorized', name: 'その他', emoji: '🍽️', color: '#888888' },
      stores: uncategorized,
    });
  }

  return groups.filter((g) => g.stores.length > 0);
}

// ────────────────────────────────────────
// レビュー操作（updateStore のラッパー）
// ────────────────────────────────────────
async function saveReview(storeId, { score, text, imageFileIds, date }) {
  const hasReview = score || text || (imageFileIds && imageFileIds.length > 0);
  return updateStore(storeId, {
    review_score: score || null,
    review_text: text || '',
    review_images: imageFileIds || [],
    review_date: hasReview ? (date || new Date().toISOString().slice(0, 10)) : null,
    visited: hasReview, // レビューあれば訪問済み、全空なら未訪問に戻す
  });
}

// ────────────────────────────────────────
// 画像アップロードヘルパー
// ────────────────────────────────────────
async function uploadReviewImages(storeId, files, existingFileIds = []) {
  const fileIds = [...existingFileIds];
  let index = fileIds.length + 1;

  for (const file of files) {
    // JPEG に変換して圧縮
    const blob = await compressImage(file, 1200, 0.85);
    const fileId = await DRIVE.driveUploadImage(storeId, index, blob);
    fileIds.push(fileId);
    index++;
  }
  return fileIds;
}

// 画像圧縮（Canvas 使用）
async function compressImage(file, maxWidth = 1200, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, maxWidth / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(resolve, 'image/jpeg', quality);
    };
    img.src = url;
  });
}

// ────────────────────────────────────────
// エラーメッセージ表示
// ────────────────────────────────────────
function showError(message) {
  const el = document.getElementById('error-toast');
  if (!el) {
    alert(`エラー: ${message}`);
    return;
  }
  el.textContent = message;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 4000);
}

function showSuccess(message) {
  const el = document.getElementById('success-toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 3000);
}
