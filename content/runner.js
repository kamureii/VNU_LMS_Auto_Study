/* VNU LMS Auto Study: content script (isolated world)
 *
 * Cách hoạt động (dựa trên khảo sát lms-probe.json):
 *  - Danh sách bài:      GET LmsClassContent/frGetByClassId/{classId}   → mincore = số phút tối thiểu
 *  - Thời gian đã học:   GET LmsClass/FrUserJoinClassNew/{classId}       → lmsClassUserLearning[].learnTime, isFinish
 *  - LMS tính giờ qua kết nối SignalR mở khi đang ở trong bài, và CHỐT thời gian khi kết nối đóng
 *    (rời bài / chuyển tab). Vì vậy sau khi treo đủ giờ, tool rời bài rồi mới kiểm tra isFinish.
 *  - Tool chỉ thao tác trên giao diện thật (click mở bài, giữ video chạy). Không tự gửi dữ liệu
 *    thời gian lên server; mọi lời gọi API ở đây đều là GET để đọc.
 */
(() => {
  if (window.__lmsAutoRunner) return;
  window.__lmsAutoRunner = true;

  const STATE_KEY = 'lmsAutoState';
  const CFG_KEY = 'lmsAutoCfg';
  const DEFAULT_CFG = { bufferSec: 60, mute: true, maxRetries: 2, settleSec: 5, confirmSec: 60 };
  const ZERO = '00000000-0000-0000-0000-000000000000';
  const INTERACTIVE_TYPE_RE = /trắc nghiệm|kiểm tra|bài tập|bài thi|khảo sát|zoom|trực tuyến|thảo luận|nộp bài|survey|quiz|exercise|assignment/i;
  const INTERACTIVE_TITLE_RE = /zoom|trắc nghiệm|kiểm tra|khảo sát/i;
  const RESUME_WINDOW_MS = 10 * 60 * 1000;

  let cfg = { ...DEFAULT_CFG };
  let state = blankState();
  let running = false;
  let studying = false;
  let stopRequested = false;

  function blankState() {
    return { classId: null, status: 'idle', items: [], currentId: null, endsAt: null, error: null, log: [], scannedAt: null, updatedAt: Date.now() };
  }

  /* ---------------- tiện ích ---------------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || '')
    .normalize('NFC')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/[* ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const visible = (el) => !!(el && el.isConnected && el.getClientRects().length);
  const getClassId = () => (location.pathname.match(/\/lop-hoc\/chi-tiet\/([0-9a-f-]{36})/i) || [])[1] || null;
  const fmt = (sec) => {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };
  const counts = () => state.items.reduce((a, i) => ((a[i.status] = (a[i.status] || 0) + 1), a), {});

  class StopSignal extends Error {}
  class NotFound extends Error {}
  class FatalError extends Error {} // lỗi khiến cả hàng đợi phải dừng
  const checkStop = () => { if (stopRequested) throw new StopSignal('stopped'); };

  async function waitFor(fn, timeoutMs, msg) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      checkStop();
      const v = fn();
      if (v) return v;
      await sleep(300);
    }
    throw new Error(msg);
  }

  function log(msg) {
    const line = `${new Date().toLocaleTimeString('vi-VN')}  ${msg}`;
    state.log.push(line);
    if (state.log.length > 80) state.log.splice(0, state.log.length - 80);
    console.log('[LMS Auto]', msg);
  }

  function sendBg(msg) {
    try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch { /* extension vừa reload */ }
  }

  async function save() {
    state.updatedAt = Date.now();
    try { await chrome.storage.local.set({ [STATE_KEY]: state }); } catch { /* bỏ qua */ }
    sendBg({ evt: 'state', status: state.status, endsAt: state.endsAt });
    renderPill();
  }

  /* ---------------- cầu nối API (qua page-hook.js) ---------------- */
  let reqSeq = 0;
  let lastOpened = { id: null, at: 0 }; // bài mà app vừa tải (từ page-hook)
  const pending = new Map();
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (ev.source !== window || !m) return;
    if (m.__lmsAuto === 'opened') { lastOpened = { id: m.id, at: m.at }; return; }
    if (m.__lmsAuto !== 'res') return;
    const cb = pending.get(m.id);
    if (cb) { pending.delete(m.id); cb(m); }
  });

  function api(path, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const id = `${++reqSeq}-${Math.random().toString(36).slice(2)}`;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Hết thời gian chờ API: ' + path)); }, timeoutMs);
      pending.set(id, (m) => {
        clearTimeout(timer);
        if (m.status === 401 || m.status === 403) return reject(new FatalError('Phiên đăng nhập đã hết hạn, hãy đăng nhập lại'));
        if (!m.ok || !m.json) return reject(new Error(`API lỗi ${m.status || m.error || ''}: ${path}`));
        if (m.json.status === false) return reject(new Error(`API báo lỗi: ${m.json.message || path}`));
        resolve(m.json.data !== undefined ? m.json.data : m.json);
      });
      window.postMessage({ __lmsAuto: 'req', id, path }, location.origin);
    });
  }

  /* ---------------- quét danh sách bài ---------------- */
  function buildTree(raw) {
    const map = new Map();
    const walk = (arr) => (arr || []).forEach((n) => {
      if (!n || !n.id) return;
      if (!map.has(n.id)) map.set(n.id, n);
      walk(n.childrens);
    });
    walk(Array.isArray(raw) ? raw : [raw]);

    const kids = new Map();
    for (const n of map.values()) {
      const p = n.parentId && n.parentId !== ZERO && map.has(n.parentId) ? n.parentId : ZERO;
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(n);
    }
    for (const arr of kids.values()) arr.sort((a, b) => (a.orderNum ?? 0) - (b.orderNum ?? 0));

    const out = [];
    const seen = new Set();
    const dfs = (pid, chain) => {
      for (const n of kids.get(pid) || []) {
        if (seen.has(n.id) || n.isDeleted || n.isDisplay === false) continue;
        seen.add(n.id);
        out.push({ node: n, chain });
        if (kids.has(n.id)) dfs(n.id, [...chain, n.title]);
      }
    };
    dfs(ZERO, []);
    return out;
  }

  function isInteractive(n) {
    if (n.contentQuizId || n.contentSurveyId || n.exerciseId || n.zoomConfigId || n.classOnlineId || n.testFormName) return true;
    if (n.contentExerciseType != null) return true;
    if (INTERACTIVE_TYPE_RE.test(n.type?.title || '')) return true;
    return INTERACTIVE_TITLE_RE.test(n.title || '');
  }

  async function scan() {
    const classId = getClassId();
    if (!classId) throw new Error('Hãy mở trang chi tiết lớp học (…/lop-hoc/chi-tiet/…) trước');
    if (state.classId !== classId) state = blankState();
    state.classId = classId;
    log('Đang quét danh sách bài học…');

    const [contents, join] = await Promise.all([
      api(`LmsClassContent/frGetByClassId/${classId}`),
      api(`LmsClass/FrUserJoinClassNew/${classId}`),
    ]);
    const learn = new Map((join?.lmsClassUserLearning || []).map((l) => [l.classContentId, l]));
    const now = Date.now();

    state.items = buildTree(contents)
      .filter(({ node }) => !node.isFolder)
      .map(({ node: n, chain }) => {
        const l = learn.get(n.id);
        const item = {
          id: n.id,
          title: n.title || '(không tên)',
          chain,
          typeTitle: n.type?.title || '',
          requiredMin: Number(n.mincore) || 0,
          learnedMin: +(Number(l?.learnTime) || 0).toFixed(2),
          status: 'pending',
          note: '',
        };
        if (l?.isFinish) item.status = 'done';
        else if (isInteractive(n)) { item.status = 'manual'; item.note = 'Bài tương tác (quiz/zoom/bài tập), cần làm tay'; }
        else if (n.resultType != null && n.resultType !== 1) { item.status = 'manual'; item.note = 'Điều kiện hoàn thành không phải thời gian'; }
        else if (n.startDate && Date.parse(n.startDate) > now) {
          item.status = 'locked';
          item.note = 'Mở từ ' + new Date(n.startDate).toLocaleDateString('vi-VN');
        }
        return item;
      });

    state.status = 'scanned';
    state.scannedAt = now;
    state.error = null;
    const c = counts();
    log(`Quét xong ${state.items.length} mục: ${c.pending || 0} cần học, ${c.done || 0} đã xong, ${c.manual || 0} làm tay, ${c.locked || 0} chưa mở`);
    await save();
    return state;
  }

  /* ---------------- thao tác giao diện ---------------- */
  const sidebar = () => document.querySelector('#tnContentList');
  // Bài đang mở: tiêu đề khung nội dung bắt đầu bằng tên bài (bản desktop có thêm tên lớp phía sau),
  // hoặc mục đang được chọn trong sidebar chính là bài đó.
  function lessonOpened(item) {
    // 1) Tín hiệu chắc chắn nhất: app vừa tải dữ liệu của đúng bài này
    if (lastOpened.id && lastOpened.id === String(item.id).toLowerCase()) return true;
    // 2) Dự phòng theo giao diện
    const want = norm(item.title);
    const heads = document.querySelectorAll('app-class-content-view .modal-title, app-class-content-view h6');
    for (const h of heads) if (visible(h) && norm(h.textContent).startsWith(want)) return true;
    const sel = document.querySelector('#tnContentList .__lesson-name.content-selected a');
    return !!sel && norm(sel.textContent) === want;
  }

  function findTab(label) {
    const want = norm(label);
    const cands = [...document.querySelectorAll('a.nav-link, [role="tab"], .nav-item > a, ngb-tabset .nav a')];
    const hit = cands.find((a) => visible(a) && norm(a.textContent).startsWith(want));
    if (hit) return hit;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      if (norm(n.textContent) !== want) continue;
      const p = n.parentElement;
      if (!visible(p) || p.closest('#tnContentList, table, app-class-content-view, #lms-auto-pill')) continue;
      return p.closest('a, li, button, [role="tab"]') || p;
    }
    return null;
  }

  async function ensureContentTab() {
    if (visible(sidebar())) return;
    const tab = findTab('nội dung');
    if (!tab) throw new Error('Không tìm thấy tab "Nội dung"');
    tab.click();
    await waitFor(() => visible(sidebar()) && sidebar().querySelector('.__lesson-name a'), 20000, 'Tab "Nội dung" không tải được');
    await sleep(800);
  }

  async function openLesson(item) {
    await ensureContentTab();
    const sb = sidebar();
    let scope = sb;

    // Mở lần lượt các chương chứa bài (chevron-down = đang thu gọn)
    for (const folder of item.chain) {
      const want = norm(folder);
      const head = [...scope.querySelectorAll('.__lesson-name-child')]
        .find((h) => norm(h.querySelector('a')?.textContent) === want);
      if (!head) continue;
      const arrow = head.querySelector('i.fa-chevron-down');
      if (arrow) { arrow.click(); await sleep(700); }
      scope = head.closest('.class-lesson-child') || scope;
    }

    const want = norm(item.title);
    const find = (root) => [...root.querySelectorAll('.__lesson-name a')].find((a) => visible(a) && norm(a.textContent) === want);
    let link;
    try {
      link = await waitFor(() => find(scope) || find(sb), 8000, 'not found');
    } catch (e) {
      if (e instanceof StopSignal) throw e;
      throw new NotFound(`Không thấy "${item.title}" trong danh sách bài`);
    }
    link.scrollIntoView({ block: 'center' });
    lastOpened = { id: null, at: 0 }; // chờ tín hiệu mới từ lần click này
    link.click();
    await waitFor(() => lessonOpened(item), 20000, `Bài "${item.title}" không mở được`);
    await sleep(1500);
    keepVideo();
  }

  async function leaveLesson() {
    lastOpened = { id: null, at: 0 };
    const tab = findTab('tiến trình học tập') || findTab('giới thiệu');
    if (tab) {
      tab.click();
      await waitFor(() => !visible(document.querySelector('app-class-content-view video')) && !visible(sidebar()), 8000, '').catch(() => {});
    } else {
      document.querySelector('app-class-content-view video')?.pause();
    }
  }

  /* ---- Giữ video không bao giờ chạm điểm kết thúc ----
   * Bài đã xem hết video nhưng chưa đủ giờ: LMS mở lại ở vị trí cũ (cách cuối vài giây),
   * video hết ngay và app tự xử lý sự kiện "ended" (dừng / chuyển bài). Cách xử lý:
   *  1. Khi vừa mở bài, nếu còn dưới REWIND_IF_LEFT_SEC giây thì tua về đầu.
   *  2. Trong lúc chạy, cứ còn dưới NEAR_END_SEC giây là tua về đầu (video lặp mãi).
   *  3. Bật loop và chặn "ended" ở pha capture để app không bao giờ nhận được sự kiện này.
   */
  const REWIND_IF_LEFT_SEC = 60;
  const NEAR_END_SEC = 4;
  const lessonVideo = () => document.querySelector('app-class-content-view video');
  const isGuarded = (t) => running && t instanceof HTMLVideoElement && !!t.closest('app-class-content-view');
  const timeLeft = (v) => (v.duration && Number.isFinite(v.duration) ? v.duration - v.currentTime : Infinity);
  const rewind = (v) => { try { v.currentTime = 0; } catch { /* chưa có metadata */ } };

  window.addEventListener('ended', (e) => {
    if (!isGuarded(e.target)) return;
    e.stopImmediatePropagation();
    rewind(e.target);
    e.target.play().catch(() => {});
  }, true);

  window.addEventListener('timeupdate', (e) => {
    if (isGuarded(e.target) && timeLeft(e.target) < NEAR_END_SEC) rewind(e.target);
  }, true);

  window.addEventListener('loadedmetadata', (e) => {
    if (isGuarded(e.target) && timeLeft(e.target) < REWIND_IF_LEFT_SEC) rewind(e.target);
  }, true);

  const hookedVideos = new WeakSet();
  const checkedStart = new WeakSet();
  function keepVideo() {
    const v = lessonVideo();
    if (!v) return null;
    if (cfg.mute && !v.muted) v.muted = true;
    if (!v.loop) v.loop = true;
    if (!hookedVideos.has(v)) {
      hookedVideos.add(v);
      v.addEventListener('pause', () => {
        setTimeout(() => { if (running && v.isConnected && v.paused) v.play().catch(() => {}); }, 1500);
      });
    }
    // Lần đầu thấy video (khi đã có độ dài): nếu đang ở gần cuối thì tua về đầu
    if (!checkedStart.has(v) && Number.isFinite(v.duration) && v.duration > 0) {
      checkedStart.add(v);
      if (timeLeft(v) < REWIND_IF_LEFT_SEC) rewind(v);
    }
    if (v.ended || timeLeft(v) < NEAR_END_SEC) rewind(v);
    if (v.paused) v.play().catch(() => {});
    return v;
  }

  /* ---------------- vòng học ---------------- */
  async function studyFor(item, sec) {
    const endsAt = Date.now() + sec * 1000;
    state.currentId = item.id;
    state.endsAt = endsAt;
    await save();
    studying = true;
    try {
      let lastSave = Date.now();
      let reopens = 0;
      while (Date.now() < endsAt) {
        checkStop();
        if (!lessonOpened(item)) {
          if (++reopens > 3) throw new Error(`"${item.title}" liên tục bị chuyển sang bài khác`);
          log('Bài học bị chuyển ngoài ý muốn, mở lại…');
          await openLesson(item);
        }
        keepVideo();
        if (Date.now() - lastSave > 15000) { lastSave = Date.now(); await save(); }
        await sleep(Math.min(3000, Math.max(200, endsAt - Date.now())));
      }
    } finally {
      studying = false;
    }
  }

  async function fetchLearning(contentId) {
    const join = await api(`LmsClass/FrUserJoinClassNew/${state.classId}`);
    return (join?.lmsClassUserLearning || []).find((l) => l.classContentId === contentId) || null;
  }

  const isComplete = (item, l) => !!l?.isFinish || (item.requiredMin > 0 && (Number(l?.learnTime) || 0) >= item.requiredMin);

  /* Sau khi rời bài, LMS cần một lúc mới chốt xong learnTime / isFinish.
   * Hỏi lại nhiều lần: dừng khi đã hoàn thành, hoặc khi learnTime đứng yên 3 lần liên tiếp, hoặc hết confirmSec. */
  async function confirmLearning(item) {
    await sleep(cfg.settleSec * 1000);
    const deadline = Date.now() + cfg.confirmSec * 1000;
    let l = null, last = null, stable = 0;
    for (;;) {
      checkStop();
      l = await fetchLearning(item.id);
      const lt = Number(l?.learnTime) || 0;
      if (isComplete(item, l)) break;
      stable = last !== null && Math.abs(lt - last) < 0.01 ? stable + 1 : 0;
      last = lt;
      if (stable >= 3 || Date.now() > deadline) break;
      await sleep(5000);
    }
    return l;
  }

  // Kiểm tra lại trên server trước khi kết luận một bài bị lỗi
  async function markIfDone(item) {
    try {
      const l = await fetchLearning(item.id);
      if (l) item.learnedMin = +(Number(l.learnTime) || 0).toFixed(2);
      if (isComplete(item, l)) {
        item.status = 'done';
        item.note = l?.isFinish ? '' : 'Đã đủ giờ, LMS sẽ cập nhật trạng thái sau';
        log(`✓ Hoàn thành "${item.title}" (${item.learnedMin} phút)`);
        await save();
        return true;
      }
    } catch { /* bỏ qua, coi như chưa xong */ }
    return false;
  }

  async function processItem(item) {
    item.status = 'running';
    item.note = '';
    state.currentId = item.id;
    state.endsAt = null;
    await save();

    for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
      checkStop();
      if (attempt > 0 && (await markIfDone(item))) return;

      const base = Math.max(0, (item.requiredMin - item.learnedMin) * 60);
      const remainSec = base + Math.max(cfg.bufferSec, base * 0.1);
      log(`Mở "${item.title}", treo ${fmt(remainSec)}${attempt ? ` (lần ${attempt + 1})` : ''}`);

      try {
        await openLesson(item);
      } catch (e) {
        if (e instanceof StopSignal) throw e;
        if (await markIfDone(item)) return;
        if (e instanceof NotFound) {
          item.status = 'failed';
          item.note = e.message;
          log('✗ ' + e.message);
          await save();
          return;
        }
        throw e;
      }

      await studyFor(item, remainSec);

      // Rời bài để LMS đóng kết nối và chốt thời gian, rồi chờ server cập nhật
      await leaveLesson();
      state.endsAt = null;
      await save();

      const before = item.learnedMin;
      const l = await confirmLearning(item);
      item.learnedMin = +(Number(l?.learnTime) || 0).toFixed(2);

      if (isComplete(item, l)) {
        item.status = 'done';
        item.note = l?.isFinish ? '' : 'Đã đủ giờ, LMS sẽ cập nhật trạng thái sau';
        log(`✓ Hoàn thành "${item.title}" (${item.learnedMin} phút)`);
        await save();
        return;
      }
      if (item.learnedMin <= before + 0.05) {
        item.status = 'failed';
        item.note = 'LMS không cộng thời gian';
        await save();
        throw new FatalError(`LMS không ghi nhận thời gian cho "${item.title}". Đã dừng để bạn kiểm tra.`);
      }
      log(`"${item.title}" mới có ${item.learnedMin}/${item.requiredMin} phút, học thêm`);
      await save();
    }

    if (await markIfDone(item)) return;
    item.status = 'failed';
    item.note = `Đã thử ${cfg.maxRetries + 1} lần nhưng chưa hoàn thành`;
    log('✗ ' + item.note + `: "${item.title}"`);
    await save();
  }

  function summary() {
    const c = counts();
    return `Xong ${c.done || 0} bài. Lỗi ${c.failed || 0}, cần làm tay ${c.manual || 0}, chưa mở ${c.locked || 0}.`;
  }

  async function start() {
    if (running) return;
    running = true;
    stopRequested = false;
    try {
      await scan();
      state.status = 'running';
      const queue = state.items.filter((i) => i.status === 'pending');
      log(`Bắt đầu: ${queue.length} bài trong hàng đợi`);
      await save();

      for (const item of queue) {
        checkStop();
        try {
          await processItem(item);
        } catch (e) {
          if (e instanceof StopSignal || e instanceof FatalError) throw e;
          // Lỗi riêng của bài này: rời bài, kiểm tra lại trên server, rồi mới ghi lỗi
          await leaveLesson().catch(() => {});
          state.endsAt = null;
          await sleep(cfg.settleSec * 1000);
          if (await markIfDone(item)) continue;
          item.status = 'failed';
          item.note = e.message;
          log('✗ ' + e.message + ', bỏ qua bài này');
          await save();
        }
      }

      state.status = 'done';
      state.currentId = null;
      state.endsAt = null;
      log('Đã chạy hết hàng đợi. ' + summary());
      await save();
      sendBg({ evt: 'notify', title: 'LMS Auto Study: xong', message: summary() });
    } catch (e) {
      if (e instanceof StopSignal) {
        state.status = 'stopped';
        log('Đã dừng theo yêu cầu');
      } else {
        state.status = 'error';
        state.error = e.message;
        log('Lỗi: ' + e.message);
        sendBg({ evt: 'notify', title: 'LMS Auto Study gặp lỗi', message: e.message });
      }
      const cur = state.items.find((i) => i.status === 'running');
      if (cur) cur.status = 'pending';
      state.currentId = null;
      state.endsAt = null;
      await save();
    } finally {
      running = false;
      studying = false;
      renderPill();
    }
  }

  /* ---------------- nhãn trạng thái nổi trên trang ---------------- */
  let pill = null;
  function renderPill() {
    const show = (running || state.status === 'error') && !!getClassId();
    if (!show) { if (pill) pill.style.display = 'none'; return; }
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'lms-auto-pill';
      Object.assign(pill.style, {
        position: 'fixed', left: '12px', bottom: '12px', zIndex: '2147483647', display: 'flex',
        alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '10px',
        font: '13px/1.35 system-ui, -apple-system, Segoe UI, sans-serif', color: '#fff',
        boxShadow: '0 4px 16px rgba(0,0,0,.25)', maxWidth: '440px',
      });
      const text = document.createElement('span');
      text.className = 'lms-auto-text';
      const btn = document.createElement('button');
      Object.assign(btn.style, {
        border: '0', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer',
        font: 'inherit', background: '#fff', color: '#222', flex: 'none',
      });
      btn.addEventListener('click', () => {
        if (running) stopRequested = true;
        else { state.status = 'stopped'; save(); }
      });
      pill.append(text, btn);
      document.body.appendChild(pill);
    }
    pill.style.display = 'flex';
    pill.style.background = state.status === 'error' ? '#b71c1c' : '#1b5e20';
    const cur = state.items.find((i) => i.id === state.currentId);
    let t;
    if (state.status === 'error') t = 'Auto Study lỗi: ' + (state.error || '');
    else if (stopRequested) t = 'Auto Study: đang dừng…';
    else if (cur && state.endsAt) t = `Auto Study • ${cur.title} • còn ${fmt((state.endsAt - Date.now()) / 1000)}`;
    else if (cur) t = `Auto Study • đang mở / kiểm tra "${cur.title}"…`;
    else t = 'Auto Study • đang chuẩn bị…';
    pill.querySelector('.lms-auto-text').textContent = t;
    pill.querySelector('button').textContent = running ? 'Dừng' : 'Đóng';
  }
  setInterval(renderPill, 1000);

  /* ---------------- nhận lệnh từ popup ---------------- */
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      switch (msg?.cmd) {
        case 'getState':
          return { ok: true, state, running, classId: getClassId(), cfg };
        case 'scan':
          if (running) return { ok: false, error: 'Tool đang chạy' };
          await scan();
          return { ok: true };
        case 'start':
          if (!getClassId()) return { ok: false, error: 'Hãy mở trang chi tiết lớp học trước' };
          start();
          return { ok: true };
        case 'stop':
          stopRequested = true;
          return { ok: true };
        default:
          return { ok: false, error: 'Lệnh không hợp lệ' };
      }
    })().then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[CFG_KEY]) cfg = { ...DEFAULT_CFG, ...(changes[CFG_KEY].newValue || {}) };
  });

  /* ---------------- khởi động: khôi phục nếu trang bị tải lại giữa chừng ---------------- */
  (async () => {
    try {
      const got = await chrome.storage.local.get([STATE_KEY, CFG_KEY]);
      cfg = { ...DEFAULT_CFG, ...(got[CFG_KEY] || {}) };
      const saved = got[STATE_KEY];
      if (saved && saved.classId && saved.classId === getClassId()) {
        state = saved;
        if (state.status === 'running' && Date.now() - (state.updatedAt || 0) < RESUME_WINDOW_MS) {
          state.status = 'stopped';
          log('Trang vừa được tải lại, tự chạy tiếp sau 8 giây');
          setTimeout(() => { if (!running) start(); }, 8000);
        } else if (state.status === 'running') {
          state.status = 'stopped';
        }
        await save();
      }
    } catch { /* bỏ qua */ }
  })();
})();
