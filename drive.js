// drive.js - Google Drive API v3 操作

const DRIVE = (() => {
  const API_BASE = 'https://www.googleapis.com/drive/v3';
  const UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
  const DB_FOLDER_NAME = 'restaurant-db';
  const IMAGES_FOLDER_NAME = 'images';

  // フォルダIDキャッシュ
  let dbFolderId = null;
  let imagesFolderId = null;

  // ────────────────────────────────────────
  // 共通 fetch ラッパー（認証ヘッダー付き）
  // ────────────────────────────────────────
  async function apiFetch(url, options = {}) {
    const token = await AUTH.getAccessToken();
    const headers = {
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    };
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Drive API エラー ${res.status}: ${err.error?.message || res.statusText}`);
    }
    return res;
  }

  // ────────────────────────────────────────
  // フォルダ検索（なければ作成）
  // ────────────────────────────────────────
  async function findOrCreateFolder(name, parentId = null) {
    // 既存フォルダを検索
    let query = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    if (parentId) query += ` and '${parentId}' in parents`;

    const res = await apiFetch(
      `${API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`
    );
    const data = await res.json();

    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }

    // フォルダ作成
    const metadata = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    };
    const createRes = await apiFetch(`${API_BASE}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    });
    const created = await createRes.json();
    return created.id;
  }

  // ────────────────────────────────────────
  // 初期化: restaurant-db/ と images/ フォルダを確認・作成
  // ────────────────────────────────────────
  async function driveInit() {
    dbFolderId = await findOrCreateFolder(DB_FOLDER_NAME);
    imagesFolderId = await findOrCreateFolder(IMAGES_FOLDER_NAME, dbFolderId);
    return { dbFolderId, imagesFolderId };
  }

  // ────────────────────────────────────────
  // ファイルID検索（フォルダ内）
  // ────────────────────────────────────────
  async function findFileId(filename, folderId) {
    const query = `name='${filename}' and '${folderId}' in parents and trashed=false`;
    const res = await apiFetch(
      `${API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`
    );
    const data = await res.json();
    return data.files && data.files.length > 0 ? data.files[0].id : null;
  }

  // ────────────────────────────────────────
  // JSON 読み込み
  // ────────────────────────────────────────
  async function driveReadJson(filename) {
    if (!dbFolderId) await driveInit();

    const fileId = await findFileId(filename, dbFolderId);
    if (!fileId) {
      // ファイルが存在しない場合は空配列を返す
      return [];
    }

    const res = await apiFetch(
      `${API_BASE}/files/${fileId}?alt=media`
    );
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      console.warn(`${filename} のJSON解析に失敗しました:`, e);
      return [];
    }
  }

  // ────────────────────────────────────────
  // JSON 書き込み（なければ作成、あれば更新）
  // ────────────────────────────────────────
  async function driveWriteJson(filename, data) {
    if (!dbFolderId) await driveInit();

    const content = JSON.stringify(data, null, 2);
    const blob = new Blob([content], { type: 'application/json' });

    const existingId = await findFileId(filename, dbFolderId);

    if (existingId) {
      // 既存ファイルを更新
      const res = await apiFetch(
        `${UPLOAD_BASE}/files/${existingId}?uploadType=media`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: blob,
        }
      );
      return await res.json();
    } else {
      // 新規作成（マルチパート）
      const metadata = {
        name: filename,
        parents: [dbFolderId],
        mimeType: 'application/json',
      };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', blob);

      const res = await apiFetch(
        `${UPLOAD_BASE}/files?uploadType=multipart`,
        {
          method: 'POST',
          body: form,
        }
      );
      return await res.json();
    }
  }

  // ────────────────────────────────────────
  // 画像アップロード
  // ────────────────────────────────────────
  async function driveUploadImage(storeId, index, blob) {
    if (!imagesFolderId) await driveInit();

    const filename = `${storeId}_${index}.jpg`;

    // 既存ファイルを確認
    const existingId = await findFileId(filename, imagesFolderId);

    if (existingId) {
      // 既存ファイルを更新
      const res = await apiFetch(
        `${UPLOAD_BASE}/files/${existingId}?uploadType=media`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob,
        }
      );
      const file = await res.json();
      return file.id;
    } else {
      // 新規アップロード
      const metadata = {
        name: filename,
        parents: [imagesFolderId],
        mimeType: 'image/jpeg',
      };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', blob);

      const res = await apiFetch(
        `${UPLOAD_BASE}/files?uploadType=multipart`,
        {
          method: 'POST',
          body: form,
        }
      );
      const file = await res.json();
      return file.id;
    }
  }

  // ────────────────────────────────────────
  // 画像表示用 URL 生成（APIコール不要）
  // sz=w400: サムネイル / sz=w1600: 拡大表示
  // ────────────────────────────────────────
  function driveGetImageUrl(fileId, size = 'w400') {
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=${size}`;
  }

  // ────────────────────────────────────────
  // ファイル削除
  // ────────────────────────────────────────
  async function driveDeleteFile(fileId) {
    await apiFetch(`${API_BASE}/files/${fileId}`, {
      method: 'DELETE',
    });
  }

  return {
    driveInit,
    driveReadJson,
    driveWriteJson,
    driveUploadImage,
    driveGetImageUrl,
    driveDeleteFile,
  };
})();
