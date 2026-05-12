const DEFAULT_CONFIG = {
  cloudinaryCloudName: 'dlab6ddls',
  cloudinaryUploadPreset: 'yoru_gallery',
  firebaseApiKey: 'AIzaSyBk_QX3wMDEwT-GsyCww2kLg6nRUEvzj1w',
  firebaseProjectId: 'databaseaistora',
  firestoreCollection: 'yoru-images',
};

const MENU_MEDIA_ID = 'saveMediaToNocturne';
const MENU_LINK_ID = 'saveLinkToNocturne';

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(DEFAULT_CONFIG);
  await chrome.storage.sync.set(existing);

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_MEDIA_ID,
      title: 'Nocturneにメディア保存',
      contexts: ['image', 'video', 'audio'],
    });
    chrome.contextMenus.create({
      id: MENU_LINK_ID,
      title: 'Nocturneにリンク保存',
      contexts: ['page', 'link'],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const config = await chrome.storage.sync.get(DEFAULT_CONFIG);

  try {
    if (info.menuItemId === MENU_LINK_ID) {
      notify('リンクを保存中...');
      const result = await saveVideoLink(info, tab, config);
      notify(`リンクを保存しました: ${result.provider}`, 'success');
      return;
    }

    if (info.menuItemId !== MENU_MEDIA_ID) return;
    await saveMediaFile(info, tab, config);
  } catch (err) {
    console.error('[Nocturne]', err);
    notify(`保存に失敗しました: ${err.message}`, 'error');
  }
});

async function saveMediaFile(info, tab, config) {
  const mediaType = getContextMediaType(info);
  const resourceType = mediaType === 'image' ? 'image' : 'video';
  const sourceUrl = info.srcUrl || info.linkUrl || info.pageUrl || '';

  notify(`${mediaType}を取得しています...`);
  const dataUrl = await getMediaBase64(info, tab, mediaType);

  notify('Cloudinaryへアップロード中...');
  const cloudResult = await uploadToCloudinary(dataUrl, config, resourceType);
  const originalName = extractFilename(sourceUrl, mediaType);
  const bytes = cloudResult.bytes || estimateBase64Bytes(dataUrl);

  await saveToFirestore({
    url: cloudResult.secure_url,
    publicId: cloudResult.public_id,
    name: extractName(sourceUrl, mediaType),
    originalName,
    date: new Date().toISOString(),
    fav: false,
    nsfw: false,
    size: bytes || 0,
    resourceType: cloudResult.resource_type || resourceType,
    format: cloudResult.format || getExtension(originalName),
    mediaType,
    mimeType: parseMimeType(dataUrl),
    duration: cloudResult.duration || 0,
    sourceType: 'file',
  }, config);

  notify(`保存しました: ${mediaType}`, 'success');
}

async function saveVideoLink(info, tab, config) {
  const pageUrl = info.linkUrl || info.pageUrl || tab?.url || '';
  if (!pageUrl) throw new Error('保存するURLが見つかりませんでした');

  const meta = await getLinkMetadata(pageUrl, tab);
  await saveToFirestore({
    url: meta.url,
    name: meta.title,
    originalName: meta.title,
    date: new Date().toISOString(),
    fav: false,
    nsfw: false,
    size: 0,
    resourceType: 'remote',
    format: 'link',
    mediaType: 'videoLink',
    mimeType: 'text/uri-list',
    duration: 0,
    provider: meta.provider,
    thumbnailUrl: meta.thumbnailUrl,
    embedUrl: meta.embedUrl,
    sourceType: 'link',
  }, config);

  return meta;
}

async function getLinkMetadata(url, tab) {
  const youtubeId = getYouTubeId(url);
  if (youtubeId) {
    const fallback = {
      provider: 'youtube',
      url: normalizeYouTubeUrl(youtubeId),
      title: tab?.title || `YouTube ${youtubeId}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
      embedUrl: `https://www.youtube.com/embed/${youtubeId}`,
    };

    try {
      const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(fallback.url)}`);
      if (!res.ok) return fallback;
      const data = await res.json();
      return {
        ...fallback,
        title: data.title || fallback.title,
        thumbnailUrl: data.thumbnail_url || fallback.thumbnailUrl,
      };
    } catch {
      return fallback;
    }
  }

  return {
    provider: 'link',
    url,
    title: tab?.title || extractName(url, 'video'),
    thumbnailUrl: '',
    embedUrl: '',
  };
}

function getYouTubeId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') return cleanYouTubeId(url.pathname.slice(1));
    if (host.endsWith('youtube.com')) {
      if (url.pathname.startsWith('/watch')) return cleanYouTubeId(url.searchParams.get('v'));
      if (url.pathname.startsWith('/shorts/')) return cleanYouTubeId(url.pathname.split('/')[2]);
      if (url.pathname.startsWith('/embed/')) return cleanYouTubeId(url.pathname.split('/')[2]);
    }
  } catch {
    return '';
  }
  return '';
}

function cleanYouTubeId(id) {
  const value = String(id || '').match(/[a-zA-Z0-9_-]{11}/)?.[0] || '';
  return value;
}

function normalizeYouTubeUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

function getContextMediaType(info) {
  if (info.mediaType === 'video') return 'video';
  if (info.mediaType === 'audio') return 'audio';
  const url = String(info.srcUrl || '').toLowerCase();
  if (/\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/.test(url)) return 'video';
  if (/\.(mp3|wav|m4a|aac|ogg|flac)(\?|#|$)/.test(url)) return 'audio';
  return 'image';
}

async function getMediaBase64(info, tab, mediaType) {
  const srcUrl = info.srcUrl;
  if (srcUrl && srcUrl.startsWith('blob:')) return await fetchViaContentScript(tab.id, srcUrl);
  if (srcUrl && srcUrl.startsWith('data:')) return srcUrl;
  if (srcUrl && srcUrl.startsWith('http')) {
    try {
      return await fetchMediaAsBase64(srcUrl);
    } catch (err) {
      log('direct fetch failed, using content script:', err.message);
      return await fetchViaContentScript(tab.id, srcUrl);
    }
  }
  return await fetchLastMediaViaScript(tab.id, mediaType);
}

async function fetchViaContentScript(tabId, url) {
  try {
    const result = await chrome.tabs.sendMessage(tabId, { type: 'FETCH_MEDIA_AS_BASE64', url });
    if (result && result.error) throw new Error('content script: ' + result.error);
    if (result && result.base64) return result.base64;
    throw new Error('content script returned no media data');
  } catch (err) {
    log('sendMessage failed, falling back to scripting API:', err.message);
    return await injectAndFetch(tabId, url);
  }
}

async function injectAndFetch(tabId, url) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (mediaUrl) => {
      try {
        const res = await fetch(mediaUrl);
        const blob = await res.blob();
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    },
    args: [url],
  });
  const base64 = results?.[0]?.result;
  if (!base64) throw new Error('ページからメディアを取得できませんでした');
  return base64;
}

async function fetchLastMediaViaScript(tabId, mediaType) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (type) => {
      const selectors = type === 'video'
        ? ['video[src]', 'video source[src]', 'a[href$=".mp4"]', 'a[href$=".webm"]', 'canvas']
        : type === 'audio'
          ? ['audio[src]', 'audio source[src]', 'a[href$=".mp3"]', 'a[href$=".wav"]', 'a[href$=".m4a"]']
          : ['img[src^="blob:"]', 'img[src^="data:"]', 'img[src^="https://"]', 'canvas'];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        if (el.tagName === 'CANVAS') return el.toDataURL('image/png');

        const src = el.src || el.currentSrc || el.getAttribute('src') || el.getAttribute('href');
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
        } catch {
          continue;
        }
      }
      return null;
    },
    args: [mediaType],
  });
  const base64 = results?.[0]?.result;
  if (!base64) throw new Error('ページからメディアを取得できませんでした');
  return base64;
}

async function fetchMediaAsBase64(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch failed: HTTP ${response.status}`);
  const blob = await response.blob();
  return blobToBase64(blob);
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return `data:${blob.type || 'application/octet-stream'};base64,` + btoa(binary);
}

async function uploadToCloudinary(dataUrl, config, resourceType) {
  const formData = new FormData();
  formData.append('file', dataUrl);
  formData.append('upload_preset', config.cloudinaryUploadPreset);
  formData.append('folder', 'yoru');

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudinaryCloudName}/${resourceType}/upload`,
    { method: 'POST', body: formData }
  );

  const json = await res.json();
  if (!res.ok) {
    const msg = json.error?.message || `HTTP ${res.status}`;
    throw new Error(`Cloudinary: ${msg}`);
  }
  return json;
}

async function saveToFirestore(data, config) {
  const url =
    `https://firestore.googleapis.com/v1/projects/${config.firebaseProjectId}` +
    `/databases/(default)/documents/${config.firestoreCollection}` +
    `?key=${config.firebaseApiKey}`;

  const fields = {
    url: { stringValue: data.url || '' },
    publicId: { stringValue: data.publicId || '' },
    name: { stringValue: data.name || '' },
    originalName: { stringValue: data.originalName || '' },
    date: { stringValue: data.date },
    fav: { booleanValue: Boolean(data.fav) },
    nsfw: { booleanValue: Boolean(data.nsfw) },
    size: { integerValue: String(data.size || 0) },
    resourceType: { stringValue: data.resourceType || '' },
    format: { stringValue: data.format || '' },
    mediaType: { stringValue: data.mediaType || 'image' },
    mimeType: { stringValue: data.mimeType || '' },
    duration: { doubleValue: Number(data.duration || 0) },
    provider: { stringValue: data.provider || '' },
    thumbnailUrl: { stringValue: data.thumbnailUrl || '' },
    embedUrl: { stringValue: data.embedUrl || '' },
    sourceType: { stringValue: data.sourceType || '' },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });

  const json = await res.json();
  if (!res.ok) {
    const msg = json.error?.message || `HTTP ${res.status}`;
    throw new Error(`Firestore: ${msg}`);
  }
  return json;
}

function extractFilename(url, mediaType = 'image') {
  const fallbackExt = mediaType === 'video' ? 'mp4' : mediaType === 'audio' ? 'mp3' : 'png';
  if (!url) return `nocturne_${Date.now()}.${fallbackExt}`;
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.split('/').pop()) || `nocturne_${Date.now()}.${fallbackExt}`;
  } catch {
    return `nocturne_${Date.now()}.${fallbackExt}`;
  }
}

function extractName(url, mediaType = 'image') {
  const filename = extractFilename(url, mediaType);
  const noExt = filename.replace(/\.[^.]+$/, '');
  if (!noExt || /^[0-9a-f-]{32,}$/i.test(noExt)) {
    try {
      const host = new URL(url).hostname.replace('www.', '').split('.')[0];
      return `${host}_${Date.now()}`;
    } catch {
      return `nocturne_${Date.now()}`;
    }
  }
  return noExt;
}

function getExtension(filename) {
  const match = String(filename || '').match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : '';
}

function parseMimeType(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)[;,]/);
  return match ? match[1] : '';
}

function estimateBase64Bytes(dataUrl) {
  const base64 = String(dataUrl || '').split(',')[1] || '';
  return Math.floor((base64.length * 3) / 4);
}

function notify(message, type = 'progress') {
  const titles = {
    success: 'Nocturne - 保存完了',
    error: 'Nocturne - エラー',
    progress: 'Nocturne',
  };
  chrome.notifications.create(
    `nocturne_${Date.now()}`,
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
