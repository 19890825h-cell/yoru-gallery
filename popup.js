const DEFAULT_CONFIG = {
  cloudinaryCloudName: 'dlab6ddls',
  cloudinaryUploadPreset: 'yoru_gallery',
  firebaseApiKey: 'AIzaSyBk_QX3wMDEwT-GsyCww2kLg6nRUEvzj1w',
  firebaseProjectId: 'databaseaistora',
  firestoreCollection: 'yoru-images',
};

const FIELDS = Object.keys(DEFAULT_CONFIG);
const GALLERY_URL = 'https://19890825h-cell.github.io/yoru-gallery/yoru-gallery3.html';

document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chrome.storage.sync.get(DEFAULT_CONFIG);
  FIELDS.forEach((key) => {
    const el = document.getElementById(key);
    if (el) el.value = stored[key] || DEFAULT_CONFIG[key];
  });
  showStatus('', 'Settings loaded. Right-click media or a video page to clip it.');
});

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
    showStatus('err', 'Please fill in every field.');
    return;
  }

  await chrome.storage.sync.set(values);
  showStatus('ok', 'Settings saved.');
});

document.getElementById('btn-reset').addEventListener('click', async () => {
  await chrome.storage.sync.set(DEFAULT_CONFIG);
  FIELDS.forEach((key) => {
    const el = document.getElementById(key);
    if (el) el.value = DEFAULT_CONFIG[key];
  });
  showStatus('ok', 'Defaults restored.');
});

document.getElementById('btn-gallery').addEventListener('click', () => {
  chrome.tabs.create({ url: GALLERY_URL });
});

FIELDS.forEach((key) => {
  const el = document.getElementById(key);
  if (!el) return;
  el.addEventListener('input', () => {
    el.classList.toggle('invalid', !el.value.trim());
    showStatus('', 'You have unsaved changes.');
  });
});

function showStatus(type, msg) {
  const el = document.getElementById('status');
  el.className = type || '';
  el.textContent = msg;
  if (!type) return;
  setTimeout(() => showStatus('', 'Settings loaded. Right-click media or a video page to clip it.'), 3000);
}
