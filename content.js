chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_MEDIA_AS_BASE64' || message.type === 'FETCH_IMAGE_AS_BASE64') {
    fetchAsBase64(message.url)
      .then((base64) => sendResponse({ base64 }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});

async function fetchAsBase64(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}
