const CFG_KEY = 'lmsAutoCfg';
const DEFAULT_CFG = { bufferSec: 60, mute: true, maxRetries: 2, settleSec: 5, confirmSec: 60 };
const ITEM_LABEL = { pending: 'Chờ học', running: 'Đang học', done: 'Xong', manual: 'Làm tay', locked: 'Chưa mở', failed: 'Lỗi' };
const STATUS_LABEL = { idle: 'Chưa quét', scanned: 'Sẵn sàng', running: 'Đang chạy', stopped: 'Đã dừng', done: 'Hoàn tất', error: 'Lỗi' };
const LIST_DEFAULT = new Set(['running', 'pending', 'failed', 'manual', 'locked']);

const $ = (s) => document.querySelector(s);
let tabId = null;
let busy = false;

const fmt = (sec) => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function showMsg(text) {
  const m = $('#msg');
  m.hidden = !text;
  m.textContent = text || '';
}

async function send(cmd, extra = {}) {
  try {
    return await chrome.tabs.sendMessage(tabId, { cmd, ...extra });
  } catch {
    return { ok: false, error: 'Chưa kết nối được với trang. Hãy tải lại trang LMS (F5) rồi mở lại popup.' };
  }
}

function render({ state, running, cfg }) {
  const st = state.status || 'idle';
  const chip = $('#status');
  chip.textContent = STATUS_LABEL[st] || st;
  chip.className = 'chip ' + st;

  // Bài đang học
  const cur = state.items.find((i) => i.id === state.currentId);
  $('#current').hidden = !(running && cur);
  if (running && cur) {
    $('#curTitle').textContent = cur.title;
    $('#curTime').textContent = state.endsAt ? 'còn ' + fmt((state.endsAt - Date.now()) / 1000) : 'đang kiểm tra…';
  }

  // Nút
  $('#btnScan').disabled = running || busy;
  $('#btnStart').disabled = running || busy;
  $('#btnStop').disabled = !running;

  // Tổng kết
  const c = {};
  let estSec = 0;
  for (const i of state.items) {
    c[i.status] = (c[i.status] || 0) + 1;
    if (i.status === 'pending' || i.status === 'running') {
      estSec += Math.max(0, (i.requiredMin - i.learnedMin) * 60) + (cfg?.bufferSec ?? 60);
    }
  }
  if (!state.items.length) {
    $('#summary').textContent = 'Bấm "Quét" để lấy danh sách bài và thời gian yêu cầu.';
  } else {
    const parts = [`${(c.pending || 0) + (c.running || 0)} bài cần học (~${fmt(estSec)})`, `${c.done || 0} xong`];
    if (c.manual) parts.push(`${c.manual} làm tay`);
    if (c.locked) parts.push(`${c.locked} chưa mở`);
    if (c.failed) parts.push(`${c.failed} lỗi`);
    $('#summary').textContent = parts.join(' · ');
  }

  // Danh sách
  const showAll = $('#showAll').checked;
  const list = $('#list');
  // Chỉ vẽ lại danh sách khi có thay đổi, để không làm mất cú click vào nút
  const sig = JSON.stringify([showAll, running, state.items.map((i) => [i.id, i.status, i.learnedMin, i.note])]);
  if (list.dataset.sig === sig) { $('#log').textContent = (state.log || []).slice(-40).join('\n'); if (state.status === 'error' && state.error) showMsg(state.error); return; }
  list.dataset.sig = sig;
  list.replaceChildren();
  for (const i of state.items) {
    if (!showAll && !LIST_DEFAULT.has(i.status)) continue;
    const li = el('li');
    li.append(el('span', 'chip ' + i.status, ITEM_LABEL[i.status] || i.status));
    const t = el('div', 't');
    t.append(el('div', 'name', i.title));
    const sub = [];
    if (i.requiredMin) sub.push(`${i.learnedMin}/${i.requiredMin} phút`);
    else if (i.status === 'pending') sub.push('Không yêu cầu thời gian, chỉ cần mở');
    if (i.note) sub.push(i.note);
    if (sub.length) t.append(el('div', 'sub', sub.join(' · ')));
    li.append(t);
    if (i.status === 'manual' || i.status === 'failed' || i.status === 'pending') {
      const b = el('button', 'mini', i.status === 'pending' ? 'Bỏ qua' : 'Học bài này');
      b.title = i.status === 'pending' ? 'Không cho tool học bài này' : 'Cho tool treo bài này như bài thường';
      b.dataset.id = i.id;
      li.append(b);
    }
    list.append(li);
  }

  $('#log').textContent = (state.log || []).slice(-40).join('\n');
  if (state.status === 'error' && state.error) showMsg(state.error);
}

async function refresh() {
  const res = await send('getState');
  if (!res?.ok) { showMsg(res?.error); return; }
  if (!document.querySelector('#msg').hidden && res.state.status !== 'error' && !busy) showMsg('');
  render(res);
}

async function loadCfg() {
  const got = await chrome.storage.local.get(CFG_KEY);
  const cfg = { ...DEFAULT_CFG, ...(got[CFG_KEY] || {}) };
  $('#cfgBuffer').value = cfg.bufferSec;
  $('#cfgRetries').value = cfg.maxRetries;
  $('#cfgMute').checked = cfg.mute;
}

async function saveCfg() {
  const got = await chrome.storage.local.get(CFG_KEY);
  const cfg = {
    ...DEFAULT_CFG,
    ...(got[CFG_KEY] || {}),
    bufferSec: Math.min(900, Math.max(0, Number($('#cfgBuffer').value) || 0)),
    maxRetries: Math.min(5, Math.max(0, Math.round(Number($('#cfgRetries').value) || 0))),
    mute: $('#cfgMute').checked,
  };
  await chrome.storage.local.set({ [CFG_KEY]: cfg });
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/lms\.vnu\.edu\.vn\/learn\/lop-hoc\/chi-tiet\//.test(tab.url || '')) {
    $('#offpage').hidden = false;
    $('#status').textContent = 'Không ở trang lớp';
    return;
  }
  tabId = tab.id;
  $('#main').hidden = false;
  await loadCfg();

  $('#btnScan').addEventListener('click', async () => {
    busy = true; showMsg('');
    $('#btnScan').textContent = 'Đang quét…';
    const r = await send('scan');
    busy = false;
    $('#btnScan').textContent = 'Quét';
    if (!r?.ok) showMsg(r?.error);
    refresh();
  });
  $('#btnStart').addEventListener('click', async () => {
    showMsg('');
    const r = await send('start');
    if (!r?.ok) showMsg(r?.error);
    setTimeout(refresh, 300);
  });
  $('#btnStop').addEventListener('click', async () => {
    await send('stop');
    setTimeout(refresh, 300);
  });
  $('#showAll').addEventListener('change', refresh);
  $('#list').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button.mini');
    if (!b) return;
    b.disabled = true;
    const r = await send('toggle', { id: b.dataset.id });
    if (!r?.ok) showMsg(r?.error);
    refresh();
  });
  for (const id of ['#cfgBuffer', '#cfgRetries', '#cfgMute']) $(id).addEventListener('change', saveCfg);

  refresh();
  setInterval(refresh, 1000);
}

init();
