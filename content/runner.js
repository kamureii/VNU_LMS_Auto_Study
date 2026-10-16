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
  const DEFAULT_CFG = { bufferMinSec: 10, bufferMaxSec: 50, mute: true, maxRetries: 2, settleSec: 5, confirmSec: 60 };
  const ZERO = '00000000-0000-0000-0000-000000000000';
  // Loại bài "chỉ cần xem" (video, văn bản, tài liệu...): không bao giờ bị coi là bài tương tác chỉ vì tên
  const PASSIVE_TYPE_RE = /video|âm thanh|audio|văn bản|tài liệu|pdf|bài giảng|slide|trình chiếu|hình ảnh|liên kết|đường dẫn|link|html|scorm/i;
  const INTERACTIVE_TYPE_RE = /trắc nghiệm|kiểm tra|bài tập|bài thi|khảo sát|zoom|lớp học trực tuyến|họp trực tuyến|thảo luận|nộp bài|điểm danh|survey|quiz|exercise|assignment/i;
  // Chỉ dùng khi không biết loại bài: tên phải BẮT ĐẦU bằng từ khóa (bỏ qua số thứ tự "1.6 ").
  // Tránh nhầm các tiêu đề như "Video: … về trọng số kiểm tra, đánh giá".
  const INTERACTIVE_TITLE_RE = /^(?:[\d.]+\s*)?(?:bài\s+|phiếu\s+)?(?:trắc nghiệm|kiểm tra|khảo sát|thi\b)|\bzoom\b|buổi học trực tiếp/i;
  const RESUME_WINDOW_MS = 10 * 60 * 1000;

  let cfg = { ...DEFAULT_CFG };
  let state = blankState();
  let running = false;
  let studying = false;
  let stopRequested = false;

  function blankState() {
    return { classId: null, status: 'idle', items: [], overrides: {}, currentId: null, endsAt: null, error: null, log: [], scannedAt: null, updatedAt: Date.now() };
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
  // Thời gian đệm ngẫu nhiên (giây) trong khoảng [bufferMinSec, bufferMaxSec]
  const randomBuffer = () => {
    const lo = Math.max(0, Number(cfg.bufferMinSec) || 0);
    const hi = Math.max(lo, Number(cfg.bufferMaxSec) || 0);
    return lo + Math.floor(Math.random() * (hi - lo + 1));
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

  const hasId = (v) => typeof v === 'string' ? v.trim() !== '' && v !== ZERO : v != null && v !== 0;

  // Trả về lý do nếu là bài tương tác (cần làm tay), ngược lại trả về null
  function interactiveReason(n) {
    // 1) Dấu hiệu chắc chắn từ dữ liệu LMS
    if (hasId(n.contentQuizId)) return 'Bài trắc nghiệm';
    if (hasId(n.contentSurveyId)) return 'Phiếu khảo sát';
    if (hasId(n.exerciseId) || n.contentExerciseType != null) return 'Bài tập / nộp bài';
    if (hasId(n.zoomConfigId) || hasId(n.classOnlineId)) return 'Buổi học trực tuyến (Zoom)';
    if (hasId(n.testFormName)) return 'Bài thi';
    // 2) Theo loại bài
    const type = n.type?.title || '';
    if (type) {
      if (PASSIVE_TYPE_RE.test(type)) return null;
      if (INTERACTIVE_TYPE_RE.test(type)) return `Loại bài "${type.replace(/\s*\(.*$/, '')}"`;
      return null;
    }
    // 3) Không biết loại bài: đoán theo tên
    return INTERACTIVE_TITLE_RE.test(norm(n.title)) ? 'Đoán theo tên bài' : null;
  }

  async function scan() {
    const classId = getClassId();
    if (!classId) throw new Error('Hãy mở trang chi tiết lớp học (…/lop-hoc/chi-tiet/…) trước');
    if (state.classId !== classId) state = blankState();
    state.classId = classId;
    state.overrides = state.overrides || {};
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
          autoStatus: 'pending',
        };
        const why = interactiveReason(n);
        if (l?.isFinish) item.status = 'done';
        else if (why) { item.status = 'manual'; item.note = why + ', cần làm tay'; }
        else if (n.resultType != null && n.resultType !== 1) { item.status = 'manual'; item.note = 'Điều kiện hoàn thành không phải thời gian'; }
        else if (n.startDate && Date.parse(n.startDate) > now) {
          item.status = 'locked';
          item.note = 'Mở từ ' + new Date(n.startDate).toLocaleDateString('vi-VN');
        }
        item.autoStatus = item.status;
        // Người dùng tự chọn học / bỏ qua bài này
        const ov = state.overrides?.[n.id];
        if (ov === 'pending' && (item.status === 'manual' || item.status === 'failed')) { item.status = 'pending'; item.note = 'Bạn đã chọn cho tool học bài này'; }
        else if (ov === 'manual' && item.status === 'pending') { item.status = 'manual'; item.note = 'Bạn đã chọn bỏ qua bài này'; }
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
    state.startedAt = Date.now();
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
      const bufSec = randomBuffer();
      const remainSec = base + bufSec;
      log(`Mở "${item.title}", treo ${fmt(remainSec)} (đệm ${bufSec}s)${attempt ? ` (lần ${attempt + 1})` : ''}`);

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
        item.note = 'LMS không cộng thời gian cho bài này';
        noAccrualStreak++;
        await save();
        if (noAccrualStreak >= 2) {
          throw new FatalError(`LMS không ghi nhận thời gian cho 2 bài liên tiếp (gần nhất: "${item.title}"). Đã dừng để bạn kiểm tra.`);
        }
        log(`✗ LMS không cộng thời gian cho "${item.title}", bỏ qua bài này`);
        return;
      }
      noAccrualStreak = 0;
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

  let noAccrualStreak = 0;

  async function start() {
    if (running) return;
    running = true;
    stopRequested = false;
    noAccrualStreak = 0;
    try {
      await scan();
      state.status = 'running';
      const queue = state.items.filter((i) => i.status === 'pending');
      log(`Bắt đầu: ${queue.length} bài trong hàng đợi`);
      await save();

      const queued = new Set();
      for (let item; (item = queue.shift() || state.items.find((i) => i.status === 'pending' && !queued.has(i.id)));) {
        queued.add(item.id);
        if (item.status !== 'pending') continue; // người dùng đã bỏ qua bài này trong lúc chờ
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

  /* ---------------- thẻ trạng thái nổi trên trang ----------------
   * Dựng trong shadow DOM để CSS của LMS không ảnh hưởng và ngược lại. */
  const PILL_CSS = `
    :host { all: initial; }
    .card {
      position: fixed; left: 16px; bottom: 16px; z-index: 2147483647; box-sizing: border-box;
      width: 320px; padding: 12px 14px 14px; border-radius: 8px;
      font: 13px/1.4 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif;
      color: #effaf3; background: #0e3b26; box-shadow: 0 10px 30px rgba(0, 0, 0, .28);
      animation: in .28s cubic-bezier(.2, .7, .2, 1);
    }
    .card.error { background: #7d1c16; }
    .top { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: #a9c7b6; }
    .error .top { color: #f6c9c4; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: #7be0a8; animation: pulse 1.6s ease-in-out infinite; }
    .error .dot { background: #ffb4ab; animation: none; }
    .title { margin-top: 6px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .error .title { white-space: normal; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 2px; }
    .time { font-size: 26px; font-weight: 700; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
    .time.small { font-size: 14px; font-weight: 600; letter-spacing: 0; color: #a9c7b6; }
    button {
      flex: none; height: 32px; padding: 0 14px; border: 0; border-radius: 6px; cursor: pointer;
      font: inherit; font-weight: 600; color: #0e3b26; background: #effaf3;
      transition: transform .12s, opacity .15s;
    }
    .error button { color: #7d1c16; }
    button:hover { opacity: .9; }
    button:disabled { opacity: .6; cursor: default; }
    button:active { transform: scale(.96); }
    button:focus-visible { outline: 2px solid #7be0a8; outline-offset: 2px; }
    .bar { height: 4px; margin-top: 10px; border-radius: 2px; overflow: hidden; background: #24563d; }
    .bar span { display: block; height: 100%; width: 0; background: #7be0a8; transition: width .8s linear; }
    @keyframes in { from { opacity: 0; transform: translateY(12px); } }
    @keyframes pulse { 50% { opacity: .35; } }
    @media (prefers-reduced-motion: reduce) { .card, .dot, .bar span { animation: none; transition: none; } }
  `;
  let pill = null;
  let pillUi = null;
  function renderPill() {
    const show = (running || state.status === 'error') && !!getClassId();
    if (!show) { if (pill) pill.style.display = 'none'; return; }
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'lms-auto-pill';
      const root = pill.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = PILL_CSS;
      const card = document.createElement('div');
      card.className = 'card';
      card.setAttribute('role', 'status');
      card.innerHTML = '<div class="top"><span class="dot"></span><span class="label"></span></div>'
        + '<div class="title"></div><div class="row"><span class="time"></span><button type="button"></button></div>'
        + '<div class="bar"><span></span></div>';
      card.querySelector('button').addEventListener('click', () => {
        if (running) stopRequested = true;
        else { state.status = 'stopped'; save(); }
      });
      root.append(style, card);
      document.body.appendChild(pill);
      pillUi = {
        card, label: card.querySelector('.label'), title: card.querySelector('.title'),
        time: card.querySelector('.time'), btn: card.querySelector('button'),
        bar: card.querySelector('.bar'), fill: card.querySelector('.bar span'),
      };
    }
    pill.style.display = '';
    const ui = pillUi;
    const isErr = state.status === 'error';
    ui.card.classList.toggle('error', isErr);
    const cur = state.items.find((i) => i.id === state.currentId);
    const c = counts();
    const total = state.items.length;
    let label, title, time = '', small = false, progress = null;
    if (isErr) {
      label = 'Auto Study đã dừng vì lỗi';
      title = state.error || 'Mở popup để xem chi tiết';
    } else if (stopRequested) {
      label = 'Auto Study đang dừng…';
      title = cur ? cur.title : '';
      time = 'Đang lưu thời gian đã học'; small = true;
    } else if (cur && state.endsAt) {
      label = `Auto Study · đang học · ${c.done || 0}/${total} bài xong`;
      title = cur.title;
      time = fmt((state.endsAt - Date.now()) / 1000);
      if (state.startedAt && state.endsAt > state.startedAt) {
        progress = Math.min(1, Math.max(0, (Date.now() - state.startedAt) / (state.endsAt - state.startedAt)));
      }
    } else if (cur) {
      label = `Auto Study · ${c.done || 0}/${total} bài xong`;
      title = cur.title;
      time = 'Đang mở bài hoặc chờ LMS…'; small = true;
    } else {
      label = 'Auto Study';
      title = 'Đang chuẩn bị hàng đợi…';
    }
    ui.label.textContent = label;
    ui.title.textContent = title;
    ui.title.style.display = title ? '' : 'none';
    ui.time.textContent = time;
    ui.time.classList.toggle('small', small);
    ui.bar.style.display = progress == null ? 'none' : '';
    if (progress != null) ui.fill.style.width = (progress * 100).toFixed(1) + '%';
    ui.btn.textContent = running ? (stopRequested ? 'Đang dừng' : 'Dừng') : 'Đóng';
    ui.btn.disabled = running && stopRequested;
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
        case 'toggle': {
          // Đổi một bài giữa "Chờ học" và "Bỏ qua (làm tay)"
          const it = state.items.find((i) => i.id === msg.id);
          if (!it) return { ok: false, error: 'Không tìm thấy bài' };
          if (it.status === 'running') return { ok: false, error: 'Bài này đang được học' };
          state.overrides = state.overrides || {};
          if (it.status === 'pending') {
            it.status = 'manual';
            it.note = 'Bạn đã chọn bỏ qua bài này';
            state.overrides[it.id] = 'manual';
          } else if (it.status === 'manual' || it.status === 'failed') {
            it.status = 'pending';
            it.note = 'Bạn đã chọn cho tool học bài này';
            state.overrides[it.id] = 'pending';
          } else {
            return { ok: false, error: 'Không đổi được trạng thái của bài này' };
          }
          if (state.overrides[it.id] === it.autoStatus) delete state.overrides[it.id];
          log(`Đổi "${it.title}" → ${it.status === 'pending' ? 'Chờ học' : 'Làm tay'}`);
          await save();
          return { ok: true };
        }
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
