const CFG_KEY = 'lmsAutoCfg';
const DEFAULT_CFG = { bufferMinSec: 10, bufferMaxSec: 50, mute: true, maxRetries: 2, settleSec: 5, confirmSec: 60 };
const LEGEND_LABEL = { done: 'xong', running: 'đang học', pending: 'chờ học', manual: 'làm tay', failed: 'lỗi', locked: 'chưa mở' };
const ITEM_LABEL = { pending: 'Chờ học', running: 'Đang học', done: 'Xong', manual: 'Làm tay', locked: 'Chưa mở', failed: 'Lỗi' };
const STATUS_LABEL = { idle: 'Chưa quét', scanned: 'Sẵn sàng', running: 'Đang chạy', stopped: 'Đã dừng', done: 'Hoàn tất', error: 'Lỗi' };
const LEGEND_ORDER = ['done', 'running', 'pending', 'manual', 'failed', 'locked'];
const TODO = new Set(['running', 'pending', 'failed', 'manual', 'locked']);

const $ = (s) => document.querySelector(s);
let tabId = null;
let busy = false;

/* ---------------- tiện ích ---------------- */
const fmt = (sec) => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
const fmtLong = (sec) => {
  const min = Math.round(sec / 60);
  if (min < 1) return 'dưới 1 phút';
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m} phút`;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
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

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* bỏ qua */ } },
};

/* ---------------- khối chính ---------------- */
function setBig(text, unit) {
  const big = $('#heroBig');
  big.replaceChildren();
  if (unit == null) { big.textContent = text; return; }
  big.append(el('span', 'num', text));
  if (unit) big.append(el('span', 'unit', unit));
}

function renderHero(state, running, c, estSec) {
  const hero = $('#hero');
  const total = state.items.length;
  const todo = (c.pending || 0) + (c.running || 0);
  const cur = state.items.find((i) => i.id === state.currentId);
  const bar = $('#lessonBar');
  bar.hidden = true;

  if (running) {
    hero.dataset.mode = 'running';
    const after = Math.max(0, todo - (cur ? 1 : 0));
    const sub = [`${c.done || 0}/${total} bài đã xong`];
    if (after) sub.push(`còn ${after} bài sau, khoảng ${fmtLong(estSec)}`);
    $('#heroSub').textContent = sub.join(' · ');
    if (cur && state.endsAt) {
      $('#heroTop').textContent = cur.title;
      setBig(fmt((state.endsAt - Date.now()) / 1000), '');
      if (state.startedAt && state.endsAt > state.startedAt) {
        const p = Math.min(1, Math.max(0, (Date.now() - state.startedAt) / (state.endsAt - state.startedAt)));
        bar.hidden = false;
        bar.firstElementChild.style.width = (p * 100).toFixed(1) + '%';
      }
    } else if (cur) {
      $('#heroTop').textContent = cur.title;
      setBig('Đang mở bài hoặc chờ LMS xác nhận…');
    } else {
      $('#heroTop').textContent = 'Đang chạy';
      setBig('Đang chuẩn bị hàng đợi…');
    }
    return;
  }

  if (state.status === 'error') {
    hero.dataset.mode = 'error';
    $('#heroTop').textContent = 'Tool đã dừng';
    setBig('Có lỗi cần bạn xem');
    $('#heroSub').textContent = state.error || 'Mở tab Nhật ký để xem chi tiết.';
    return;
  }

  if (!total) {
    hero.dataset.mode = 'idle';
    $('#heroTop').textContent = 'Chưa quét khóa học';
    setBig('Sẵn sàng treo bài');
    $('#heroSub').textContent = 'Bấm Bắt đầu học: tool tự quét danh sách bài rồi học lần lượt từng bài cho đủ giờ.';
    return;
  }

  hero.dataset.mode = 'ready';
  const when = state.scannedAt ? new Date(state.scannedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
  $('#heroTop').textContent = state.status === 'stopped' ? 'Đã dừng, có thể học tiếp' : (when ? `Quét lúc ${when}` : 'Đã quét');
  if (todo) {
    setBig(String(todo), 'bài cần học');
    $('#heroSub').textContent = `Khoảng ${fmtLong(estSec)} · ${c.done || 0}/${total} bài đã xong`;
  } else {
    setBig(`${c.done || 0}/${total}`, 'bài đã xong');
    const left = [];
    if (c.manual) left.push(`${c.manual} bài cần làm tay`);
    if (c.failed) left.push(`${c.failed} bài lỗi`);
    if (c.locked) left.push(`${c.locked} bài chưa mở`);
    $('#heroSub').textContent = left.length ? left.join(' · ') : 'Không còn bài nào cần treo.';
  }
}

function renderOverview(state, c) {
  const total = state.items.length;
  $('#overview').hidden = !total;
  if (!total) return;
  const bar = $('#courseBar');
  const legend = $('#legend');
  bar.replaceChildren();
  legend.replaceChildren();
  const parts = [];
  for (const st of LEGEND_ORDER) {
    const n = c[st] || 0;
    if (!n) continue;
    const seg = el('span', 'seg-' + st);
    seg.style.flex = String(n);
    bar.append(seg);
    const li = el('li');
    li.append(el('i', 'seg-' + st), el('b', null, String(n)), document.createTextNode(LEGEND_LABEL[st]));
    legend.append(li);
    parts.push(`${n} ${LEGEND_LABEL[st]}`);
  }
  bar.setAttribute('aria-label', 'Tiến độ khóa học: ' + parts.join(', '));
}

/* ---------------- danh sách bài ---------------- */
function renderList(state, running) {
  const mode = document.querySelector('input[name="filter"]:checked').value;
  const list = $('#list');
  // Chỉ vẽ lại khi có thay đổi, để không làm mất cú click vào nút
  const sig = JSON.stringify([mode, running, state.items.map((i) => [i.id, i.status, i.learnedMin, i.note])]);
  if (list.dataset.sig === sig) return;
  list.dataset.sig = sig;
  const keepScroll = list.scrollTop;
  list.replaceChildren();

  let lastGroup = null;
  let shown = 0;
  for (const i of state.items) {
    if (mode === 'todo' && !TODO.has(i.status)) continue;
    const group = i.chain?.length ? i.chain[i.chain.length - 1] : '';
    if (group && group !== lastGroup) list.append(el('li', 'group', group));
    lastGroup = group;
    shown++;

    const li = el('li', `row st-${i.status}${i.status === 'running' ? ' running' : ''}`);
    li.append(el('span', 'dot'));
    const t = el('div', 't');
    t.append(el('div', 'name', i.title));
    const meta = el('div', 'meta');
    meta.append(el('span', 'tag', ITEM_LABEL[i.status] || i.status));
    if (i.requiredMin) meta.append(el('span', null, `${i.learnedMin}/${i.requiredMin} phút`));
    else if (i.status === 'pending') meta.append(el('span', null, 'Chỉ cần mở'));
    if (i.note) meta.append(el('span', null, i.note));
    t.append(meta);
    li.append(t);

    if (i.status === 'manual' || i.status === 'failed' || i.status === 'pending') {
      const skip = i.status === 'pending';
      const b = el('button', 'mini' + (skip ? '' : ' learn'), skip ? 'Bỏ qua' : 'Học bài này');
      b.title = skip ? 'Không cho tool học bài này' : 'Cho tool treo bài này như bài thường';
      b.dataset.id = i.id;
      li.append(b);
    } else {
      li.append(el('span'));
    }
    list.append(li);
  }
  list.scrollTop = keepScroll;

  list.hidden = shown === 0;
  document.querySelector('.filter').hidden = !state.items.length;
  const empty = $('#listEmpty');
  empty.hidden = shown > 0;
  if (!shown) {
    empty.textContent = !state.items.length
      ? 'Danh sách bài sẽ hiện ở đây sau khi quét.'
      : 'Không còn bài nào cần xử lý. Chọn "Tất cả" để xem các bài đã xong.';
  }
}

function renderLog(state) {
  const lines = (state.log || []).slice(-60);
  const box = $('#log');
  const sig = lines.length + '|' + (lines[lines.length - 1] || '');
  $('#logEmpty').hidden = lines.length > 0;
  box.hidden = !lines.length;
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
  box.replaceChildren();
  for (const line of lines) {
    const m = line.match(/^(\S+)\s{2}(.*)$/s);
    const li = el('li');
    const msg = m ? m[2] : line;
    li.append(el('time', null, m ? m[1] : ''), el('span', /^✓/.test(msg) ? 'ok' : /^(✗|Lỗi)/.test(msg) ? 'bad' : null, msg));
    box.append(li);
  }
  if (atBottom) box.scrollTop = box.scrollHeight;
}

/* ---------------- tổng ---------------- */
function render({ state, running, cfg }) {
  const st = running ? 'running' : (state.status || 'idle');
  const chip = $('#status');
  chip.textContent = STATUS_LABEL[st] || st;
  chip.dataset.st = st;

  const bufLo = cfg?.bufferMinSec ?? DEFAULT_CFG.bufferMinSec;
  const bufHi = Math.max(bufLo, cfg?.bufferMaxSec ?? DEFAULT_CFG.bufferMaxSec);
  const bufAvg = (bufLo + bufHi) / 2;

  const c = {};
  let estSec = 0;
  for (const i of state.items) {
    c[i.status] = (c[i.status] || 0) + 1;
    if (i.status === 'pending') estSec += Math.max(0, (i.requiredMin - i.learnedMin) * 60) + bufAvg;
  }

  renderHero(state, running, c, estSec);
  renderOverview(state, c);

  $('#btnStart').hidden = running;
  $('#btnStop').hidden = !running;
  $('#btnStart').disabled = busy;
  $('#btnStart').textContent = state.status === 'stopped' || state.status === 'error' ? 'Học tiếp' : 'Bắt đầu học';
  $('#btnScan').disabled = running || busy;
  if (!busy) $('#btnScan').textContent = state.items.length ? 'Quét lại' : 'Chỉ quét';

  const todo = (c.pending || 0) + (c.running || 0);
  $('#tabCount').textContent = todo ? String(todo) : '';

  renderList(state, running);
  renderLog(state);
}

async function refresh() {
  const res = await send('getState');
  if (!res?.ok) { showMsg(res?.error); return; }
  if (!$('#msg').hidden && !busy) showMsg('');
  render(res);
}

/* ---------------- tab ---------------- */
function selectTab(name, focus) {
  for (const t of document.querySelectorAll('[role="tab"]')) {
    const on = t.id === 'tab-' + name;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    if (on && focus) t.focus();
    $('#' + t.getAttribute('aria-controls')).hidden = !on;
  }
  store.set('lmsAutoTab', name);
}

/* ---------------- cài đặt ---------------- */
async function loadCfg() {
  const got = await chrome.storage.local.get(CFG_KEY);
  const cfg = { ...DEFAULT_CFG, ...(got[CFG_KEY] || {}) };
  $('#cfgBufMin').value = cfg.bufferMinSec;
  $('#cfgBufMax').value = cfg.bufferMaxSec;
  $('#cfgRetries').value = cfg.maxRetries;
  $('#cfgMute').checked = cfg.mute;
}

let savedTimer = null;
async function saveCfg() {
  const got = await chrome.storage.local.get(CFG_KEY);
  const clampSec = (v) => Math.min(900, Math.max(0, Math.round(Number(v) || 0)));
  let lo = clampSec($('#cfgBufMin').value), hi = clampSec($('#cfgBufMax').value);
  if (hi < lo) [lo, hi] = [hi, lo];
  $('#cfgBufMin').value = lo; $('#cfgBufMax').value = hi;
  const retries = Math.min(5, Math.max(0, Math.round(Number($('#cfgRetries').value) || 0)));
  $('#cfgRetries').value = retries;
  const { bufferSec: _old, ...prev } = got[CFG_KEY] || {};
  const cfg = {
    ...DEFAULT_CFG,
    ...prev,
    bufferMinSec: lo,
    bufferMaxSec: hi,
    maxRetries: retries,
    mute: $('#cfgMute').checked,
  };
  await chrome.storage.local.set({ [CFG_KEY]: cfg });
  const note = $('#savedNote');
  note.textContent = 'Đã lưu';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { note.textContent = ''; }, 1800);
}

/* ---------------- khởi động ---------------- */
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/lms\.vnu\.edu\.vn\/learn\/lop-hoc\/chi-tiet\//.test(tab.url || '')) {
    $('#offpage').hidden = false;
    $('#status').textContent = 'Không ở trang lớp';
    $('#status').dataset.st = 'idle';
    $('#btnOpenLms').addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://lms.vnu.edu.vn/' });
      window.close();
    });
    return;
  }
  tabId = tab.id;
  document.body.classList.add('app');
  $('#main').hidden = false;
  await loadCfg();

  $('#btnScan').addEventListener('click', async () => {
    busy = true; showMsg('');
    $('#btnScan').textContent = 'Đang quét…';
    $('#btnScan').disabled = true;
    $('#btnStart').disabled = true;
    const r = await send('scan');
    busy = false;
    if (!r?.ok) showMsg(r?.error);
    refresh();
  });
  $('#btnStart').addEventListener('click', async () => {
    showMsg('');
    $('#btnStart').disabled = true;
    const r = await send('start');
    if (!r?.ok) showMsg(r?.error);
    setTimeout(refresh, 300);
  });
  $('#btnStop').addEventListener('click', async () => {
    $('#btnStop').disabled = true;
    await send('stop');
    setTimeout(() => { $('#btnStop').disabled = false; refresh(); }, 300);
  });

  for (const r of document.querySelectorAll('input[name="filter"]')) {
    r.addEventListener('change', () => { store.set('lmsAutoFilter', r.value); refresh(); });
  }
  const savedFilter = store.get('lmsAutoFilter');
  const fr = savedFilter && document.querySelector(`input[name="filter"][value="${savedFilter}"]`);
  if (fr) fr.checked = true;

  $('#list').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button.mini');
    if (!b) return;
    b.disabled = true;
    const r = await send('toggle', { id: b.dataset.id });
    if (!r?.ok) { showMsg(r?.error); b.disabled = false; }
    refresh();
  });

  const tabs = [...document.querySelectorAll('[role="tab"]')];
  tabs.forEach((t, idx) => {
    t.addEventListener('click', () => selectTab(t.id.slice(4)));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = tabs[(idx + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      selectTab(next.id.slice(4), true);
    });
  });
  selectTab(store.get('lmsAutoTab') || 'lessons');

  for (const id of ['#cfgBufMin', '#cfgBufMax', '#cfgRetries', '#cfgMute']) $(id).addEventListener('change', saveCfg);

  refresh();
  setInterval(refresh, 1000);
}

init();
