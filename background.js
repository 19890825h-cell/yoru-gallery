// ===== デフォルト設定 =====
const DEFAULT_CONFIG = {
  cloudinaryCloudName: 'dlab6ddls',
  cloudinaryUploadPreset: 'yoru_gallery',
  firebaseApiKey: 'AIzaSyBk_QX3wMDEwT-GsyCww2kLg6nRUEvzj1w',
  firebaseProjectId: 'databaseaistora',
  firestoreCollection: 'yoru-images',
};

// ===== 初期化 =====
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(DEFAULT_CONFIG);
  await chrome.storage.sync.set(existing);

  // 既存メニューを一旦消してから作成（重複防止）
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'saveToYoru',
      title: 'Nocturneに保存',
      contexts: ['image'],
      // 全サイト対応 — documentUrlPatterns 制限なし
    });
  });
});

// ===== コンテキストメニュークリック =====
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'saveToYoru') return;

  log('コンテキストメニュー起動', { srcUrl: info.srcUrl, pageUrl: info.pageUrl });

  const config = await chrome.storage.sync.get(DEFAULT_CONFIG);

  try {
    // --- Step 1: 画像データ取得 ---
    notify('保存中… (1/2) 画像を取得しています');
    const base64Data = await getImageBase64(info, tab);
    log('画像取得完了', base64Data.substring(0, 60) + '...');

    // --- Step 2: Cloudinaryアップロード ---
    notify('保存中… (2/2) アップロード中');
    const cloudResult = await uploadToCloudinary(base64Data, config);
    log('Cloudinaryアップロード完了', cloudResult.secure_url);

    // --- Step 3: Firestore保存 ---
    notify('保存中… (2/2) Firestoreへ書き込み中');
    await saveToFirestore(
      {
        url:      cloudResult.secure_url,
        publicId: cloudResult.public_id,
        name:     extractName(info.srcUrl || ''),
        date:     new Date().toISOString(),
        fav:      false,
        size:     0,
      },
      config
    );

    notify(`保存完了！ ${cloudResult.width}×${cloudResult.height}px`, 'success');

  } catch (err) {
    console.error('[Nocturne] 保存失敗:', err);
    notify(`保存失敗: ${err.message}`, 'error');
  }
});

// ===== 画像base64取得（全パターン対応） =====
async function getImageBase64(info, tab) {
  const srcUrl = info.srcUrl;

  // パターン1: blob: URL → content script経由
  if (srcUrl && srcUrl.startsWith('blob:')) {
    log('blob URL検出 → content script経由で取得');
    return await fetchViaContentScript(tab.id, srcUrl);
  }

  // パターン2: data: URL → そのまま使う
  if (srcUrl && srcUrl.startsWith('data:')) {
    log('data URL検出 → そのまま使用');
    return srcUrl;
  }

  // パターン3: 通常のhttps URL → service workerで直接fetch（CORS失敗時はcontent script経由）
  if (srcUrl && srcUrl.startsWith('http')) {
    log('https URL検出 → 直接fetch試行');
    try {
      return await fetchImageAsBase64(srcUrl);
    } catch (err) {
      log('直接fetch失敗（CORS？）→ content script経由にフォールバック:', err.message);
      return await fetchViaContentScript(tab.id, srcUrl);
    }
  }

  // パターン4: srcUrlが空 → content scriptでDOM取得を試みる
  log('srcUrl未取得 → content script経由でDOM検索');
  return await fetchLastImageViaScript(tab.id);
}

// ===== content script経由でblob URLを取得 =====
async function fetchViaContentScript(tabId, url) {
  try {
    const result = await chrome.tabs.sendMessage(tabId, {
      type: 'FETCH_IMAGE_AS_BASE64',
      url,
    });
    if (result && result.error) throw new Error('content script: ' + result.error);
    if (result && result.base64) return result.base64;
    throw new Error('content scriptからレスポンスなし');
  } catch (err) {
    // content scriptが応答しない場合はscripting APIで注入
    log('sendMessage失敗、scripting APIにフォールバック:', err.message);
    return await injectAndFetch(tabId, url);
  }
}

// ===== scripting APIで直接注入してfetch =====
async function injectAndFetch(tabId, url) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (blobUrl) => {
      try {
        const res = await fetch(blobUrl);
        const blob = await res.blob();
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        return null;
      }
    },
    args: [url],
  });
  const base64 = results?.[0]?.result;
  if (!base64) throw new Error('scripting APIでの画像取得に失敗');
  return base64;
}

// ===== srcUrlが取れない場合: 最後に表示した画像をDOM検索 =====
async function fetchLastImageViaScript(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      // ページ上の画像要素を汎用的に探す
      const selectors = [
        'img[src^="blob:"]',
        'img[src^="data:"]',
        'img[src^="https://"]',
        'canvas',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;

        if (el.tagName === 'CANVAS') {
          return el.toDataURL('image/png');
        }
        const src = el.src || el.getAttribute('src');
        if (!src) continue;

        try {
          const res = await fetch(src);
          const blob = await res.blob();
          return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch (_) {
          continue;
        }
      }
      return null;
    },
    args: [],
  });
  const base64 = results?.[0]?.result;
  if (!base64) throw new Error('ページから画像を取得できませんでした。画像の上で右クリックしているか確認してください。');
  return base64;
}

// ===== 通常URLから直接取得 =====
async function fetchImageAsBase64(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`画像fetch失敗 HTTP ${response.status}`);
  const blob = await response.blob();
  return blobToBase64(blob);
}

// ===== Blob → base64（Service Worker対応・チャンク処理） =====
async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return `data:${blob.type};base64,` + btoa(binary);
}

// ===== Cloudinaryアップロード =====
async function uploadToCloudinary(base64Data, config) {
  const formData = new FormData();
  formData.append('file', base64Data);
  formData.append('upload_preset', config.cloudinaryUploadPreset);
  formData.append('folder', 'yoru');

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudinaryCloudName}/image/upload`,
    { method: 'POST', body: formData }
  );

  const json = await res.json();
  if (!res.ok) {
    const msg = json.error?.message || `HTTP ${res.status}`;
    throw new Error(`Cloudinary: ${msg}`);
  }
  return json;
}

// ===== Firestoreに保存（REST API） =====
// フィールド名はギャラリー（yoru-gallery3.html）の読み取り構造に合わせる
async function saveToFirestore(data, config) {
  const url =
    `https://firestore.googleapis.com/v1/projects/${config.firebaseProjectId}` +
    `/databases/(default)/documents/${config.firestoreCollection}` +
    `?key=${config.firebaseApiKey}`;

  const body = {
    fields: {
      url:      { stringValue: data.url },
      publicId: { stringValue: data.publicId },
      name:     { stringValue: data.name },
      date:     { stringValue: data.date },
      fav:      { booleanValue: data.fav },
      size:     { integerValue: String(data.size) },
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) {
    const msg = json.error?.message || `HTTP ${res.status}`;
    throw new Error(`Firestore: ${msg}`);
  }
  return json;
}

// ===== ユーティリティ =====

// 拡張子付きファイル名
function extractFilename(url) {
  if (!url) return `yoru_${Date.now()}.png`;
  try {
    const path = new URL(url).pathname;
    return path.split('/').pop() || `yoru_${Date.now()}.png`;
  } catch {
    return `yoru_${Date.now()}.png`;
  }
}

// 拡張子なしファイル名（ギャラリーの name フィールド用）
function extractName(url) {
  const filename = extractFilename(url);
  if (!filename || filename.length < 3) return `yoru_${Date.now()}`;
  // blob: UUID や意味のない文字列の場合はドメイン+日時にする
  const noExt = filename.replace(/\.[^.]+$/, '');
  if (/^[0-9a-f-]{32,}$/i.test(noExt)) {
    try {
      const host = new URL(url).hostname.replace('www.', '').split('.')[0];
      return `${host}_${Date.now()}`;
    } catch { return `yoru_${Date.now()}`; }
  }
  return noExt || `yoru_${Date.now()}`;
}

function notify(message, type = 'progress') {
  const titles = {
    success:  'Nocturne - 保存完了',
    error:    'Nocturne - エラー',
    progress: 'Nocturne',
  };
  // アイコンが存在しない場合でもクラッシュしないよう lastError を握りつぶす
  chrome.notifications.create(
    `yoru_${Date.now()}`,
    {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: titles[type] || 'Nocturne',
      message,
    },
    () => { void chrome.runtime.lastError; }
  );
}

function log(...args) {
  console.log('[Nocturne]', ...args);
}
