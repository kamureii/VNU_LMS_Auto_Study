/* Chạy trong MAIN world (cùng ngữ cảnh với app Angular của LMS).
 * - Ghi nhớ header Authorization / X-Authorize mà app đang dùng (chỉ giữ trong bộ nhớ, không lưu đi đâu)
 * - Nhận yêu cầu GET từ runner.js qua window.postMessage, gọi API LMS và trả kết quả về
 * Chỉ thực hiện GET tới /dhqg.lms.api/api/v1/ — không ghi dữ liệu gì lên server.
 */
(() => {
  if (window.__lmsAutoHook) return;
  window.__lmsAutoHook = true;

  const API_BASE = '/dhqg.lms.api/api/v1/';
  const auth = {};

  const X = XMLHttpRequest.prototype;
  const origSet = X.setRequestHeader;
  const origOpen = X.open;

  // Mỗi khi app mở một bài, nó gọi LmsClassContent/FrGetById/{id}.
  // Báo id đó cho runner.js: đây là tín hiệu "bài đã mở" không phụ thuộc giao diện (video, PDF, bài đọc...).
  X.open = function (method, url) {
    const m = String(url).match(/LmsClassContent\/FrGetById\/([0-9a-f-]{36})/i);
    if (m) window.postMessage({ __lmsAuto: 'opened', id: m[1].toLowerCase(), at: Date.now() }, location.origin);
    return origOpen.apply(this, arguments);
  };
  X.setRequestHeader = function (name, value) {
    if (/^(authorization|x-authorize)$/i.test(name)) auth[name] = value;
    return origSet.apply(this, arguments);
  };

  window.addEventListener('message', async (ev) => {
    const m = ev.data;
    if (ev.source !== window || !m || m.__lmsAuto !== 'req') return;
    if (typeof m.path !== 'string' || /^\w+:|\.\./.test(m.path)) return;

    let out;
    try {
      const headers = { Accept: 'application/json, text/plain, */*', ...auth };
      if (!Object.keys(auth).some((k) => /^authorization$/i.test(k))) {
        const t = localStorage.getItem('access_token');
        if (t) headers.Authorization = 'Bearer ' + t.replace(/^"|"$/g, '');
      }
      const res = await fetch(API_BASE + m.path, { method: 'GET', headers, credentials: 'include' });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* không phải JSON */ }
      out = { ok: res.ok, status: res.status, json };
    } catch (e) {
      out = { ok: false, status: 0, error: String(e) };
    }
    window.postMessage({ __lmsAuto: 'res', id: m.id, ...out }, location.origin);
  });
})();
