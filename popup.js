const DEFAULT_CONFIG = {
  cloudinaryCloudName: 'dlab6ddls',
  cloudinaryUploadPreset: 'yoru_gallery',
  firebaseApiKey: 'AIzaSyBk_QX3wMDEwT-GsyCww2kLg6nRUEvzj1w',
  firebaseProjectId: 'databaseaistora',
  firestoreCollection: 'yoru-images',
};

const FIELDS = Object.keys(DEFAULT_CONFIG);
const GALLERY_URL = 'https://19890825h-cell.github.io/yoru-gallery/yoru-gallery3.html';

// ===== 起動時に設定を読み込む =====
document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chrome.storage.sync.get(DEFAULT_CONFIG);
  FIELDS.forEach((key) => {
    const el = document.getElementById(key);
    if (el) el.value = stored[key] || DEFAULT_CONFIG[key];
  });
  showStatus('', '設定を確認して、必要なら保存してください。');
});

// ===== 保存ボタン =====
document.getElementById('btn-save').addEventListener('click', async () => {
  const values = {};
  let valid = true;

  FIELDS.forEach((key) => {
    const el = document.getElementById(key);
    const val = el ? el.value.trim() : '';
    if (!val) {
      valid = false;
      el.classList.add('invalid');
    } else {
      el.classList.remove('invalid');
      values[key] = val;
    }
  });

  if (!valid) {
    showStatus('err', '空のフィールドがあります。');
    return;
  }

  await chrome.storage.sync.set(values);
  showStatus('ok', '設定を保存しました。');
});

// ===== リセットボタン =====
document.getElementById('btn-reset').addEventListener('click', async () => {
  await chrome.storage.sync.set(DEFAULT_CONFIG);
  FIELDS.forEach((key) => {
    const el = document.getElementById(key);
    if (el) el.value = DEFAULT_CONFIG[key];
  });
  showStatus('ok', 'デフォルト設定に戻しました。');
});

document.getElementById('btn-gallery').addEventListener('click', () => {
  chrome.tabs.create({ url: GALLERY_URL });
});

FIELDS.forEach((key) => {
  const el = document.getElementById(key);
  if (!el) return;
  el.addEventListener('input', () => {
    el.classList.toggle('invalid', !el.value.trim());
    showStatus('', '未保存の変更があります。');
  });
});

function showStatus(type, msg) {
  const el = document.getElementById('status');
  el.className = type || '';
  el.textContent = msg;
  if (!type) return;
  setTimeout(() => showStatus('', '設定を確認して、必要なら保存してください。'), 3000);
}
