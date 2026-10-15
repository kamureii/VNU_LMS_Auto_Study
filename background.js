// Service worker: chỉ cập nhật badge trên biểu tượng và hiện thông báo hệ thống.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.evt === 'state' && sender.tab?.id != null) {
    let text = '';
    if (msg.status === 'running') {
      text = msg.endsAt ? String(Math.max(0, Math.ceil((msg.endsAt - Date.now()) / 60000))) : '…';
    } else if (msg.status === 'error') {
      text = '!';
    }
    chrome.action.setBadgeText({ tabId: sender.tab.id, text });
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: msg.status === 'error' ? '#b71c1c' : '#1b5e20' });
  }
  if (msg?.evt === 'notify') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: msg.title || 'LMS Auto Study',
      message: msg.message || '',
    });
  }
});
