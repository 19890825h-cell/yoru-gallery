const DEFAULT_CONFIG = {
  cloudinaryCloudName: 'dlab6ddls',
  cloudinaryUploadPreset: 'yoru_gallery',
  firebaseApiKey: 'AIzaSyBk_QX3wMDEwT-GsyCww2kLg6nRUEvzj1w',
  firebaseProjectId: 'databaseaistora',
  firestoreCollection: 'yoru-images',
};

const FIELDS = Object.keys(DEFAULT_CONFIG);

// ===== 起動時に設定を読み込む =====
document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chrome.storage.sync.get(DEFAULT_CONFIG);
  FIELDS.forEach((key) => {
    const el = document.getElementById(key);
    if (el) el.value = stored[key] || DEFAULT_CONFIG[key];
  });
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
      el.style.borderColor = '#ef4444';
    } else {
      el.style.borderColor = '';
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

function showStatus(type, msg) {
  const el = document.getElementById('status');
  el.className = type;
  el.textContent = msg;
  setTimeout(() => {
    el.className = '';
    el.textContent = '';
    el.style.display = 'none';
  }, 3000);
}
