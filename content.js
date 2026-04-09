// content.js — 全サイトで動作するコンテンツスクリプト
// blob: URL や data: URL の画像をバックグラウンドスクリプトに渡す役割

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_IMAGE_AS_BASE64') {
    fetchAsBase64(message.url)
      .then((base64) => sendResponse({ base64 }))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // 非同期レスポンスのためチャンネルを開いたままにする
  }
});

async function fetchAsBase64(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('FileReader失敗'));
    reader.readAsDataURL(blob);
  });
}
