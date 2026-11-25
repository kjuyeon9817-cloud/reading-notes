/* 독서노트 — 휴대폰·컴퓨터에서 같은 기록을 쓰는 작은 앱.
 * 기록은 이 기기(localStorage)에 먼저 저장되고, 설정에서 GitHub 비공개 저장소를 연결하면
 * books/<책id>.json 파일로 동기화된다. 빌드 도구 없이 이 파일 하나로 동작한다.
 */
(function () {
  'use strict';

  const LS_BOOKS = 'rn.books.v1';
  const LS_SETTINGS = 'rn.settings.v1';
  const LS_SYNC = 'rn.sync.v1'; // { shas: {id: sha}, dirty: {id: true}, deleted: {id: sha} }
  const DATA_DIR = 'books';

  // ---------- 저장소(로컬) ----------
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 저장 공간 부족 등 */ }
  }

  let books = load(LS_BOOKS, {});
  let settings = load(LS_SETTINGS, { owner: '', repo: 'reading-notes-data', token: '' });
  let sync = load(LS_SYNC, { shas: {}, dirty: {}, deleted: {} });
  sync.shas = sync.shas || {}; sync.dirty = sync.dirty || {}; sync.deleted = sync.deleted || {};

  let view = { name: 'list' };

  // ---------- 날짜 도우미 ----------
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function parseDay(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function daysBetween(a, b) { return Math.round((parseDay(b) - parseDay(a)) / 86400000); }
  function fmtDate(s) {
    if (!s) return '';
    const d = parseDay(s);
    const w = '일월화수목금토'[d.getDay()];
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + w + ')';
  }
  function readingDay(book) {
    const end = book.status === 'done' && book.finishedDate ? book.finishedDate : todayStr();
    return daysBetween(book.startDate, end) + 1;
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- 데이터 조작 ----------
  function newEntry(date) {
    return { date: date, pages: '', quotes: [], summary: '', applications: [] };
  }
  function newApplication() {
    return { id: uid(), text: '', practiced: null, result: '', reason: '' };
  }
  function getEntry(book, date) { return (book.entries || []).find(e => e.date === date); }
  function ensureEntry(book, date) {
    let e = getEntry(book, date);
    if (!e) {
      e = newEntry(date);
      book.entries.push(e);
      book.entries.sort((a, b) => a.date.localeCompare(b.date));
    }
    return e;
  }
  function entryIsEmpty(e) {
    return !e.pages && !e.summary && !e.quotes.some(q => q.text || q.reason) && !e.applications.some(a => a.text);
  }
  // 아직 "다음 날 실천 체크"를 안 한 지난 적용 방법 수
  function pendingChecks(book) {
    const t = todayStr();
    let n = 0;
    (book.entries || []).forEach(e => {
      if (e.date >= t) return;
      e.applications.forEach(a => { if (a.text && a.practiced === null) n++; });
    });
    return n;
  }

  let syncTimer = null;
  function saveBook(book, opts) {
    book.updatedAt = new Date().toISOString();
    books[book.id] = book;
    store(LS_BOOKS, books);
    sync.dirty[book.id] = true;
    store(LS_SYNC, sync);
    if (!opts || !opts.quiet) setStatus('이 기기에 저장됨');
    scheduleSync();
  }
  function scheduleSync() {
    if (!ghReady()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { pushDirty(); }, 2500);
  }

  // ---------- GitHub 동기화 ----------
  function ghReady() { return !!(settings.owner && settings.repo && settings.token); }
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(b64.replace(/\n/g, ''));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  async function gh(path, opts) {
    opts = opts || {};
    const url = 'https://api.github.com/repos/' + encodeURIComponent(settings.owner) + '/' +
      encodeURIComponent(settings.repo) + '/contents/' + path;
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers: {
        'Authorization': 'Bearer ' + settings.token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store'
    });
    if (res.status === 404 && opts.allow404) return null;
    if (!res.ok) {
      let msg = res.status + '';
      try { const j = await res.json(); msg += ' ' + (j.message || ''); } catch (e) { /* ignore */ }
      const err = new Error(msg); err.status = res.status; throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  async function fetchRemoteBook(id) {
    const f = await gh(DATA_DIR + '/' + id + '.json', { allow404: true });
    if (!f) return null;
    return { sha: f.sha, book: JSON.parse(b64decode(f.content)) };
  }

  let syncing = false;
  async function pullAll() {
    if (!ghReady() || syncing) return;
    syncing = true;
    setStatus('불러오는 중…');
    try {
      const list = await gh(DATA_DIR, { allow404: true }) || [];
      const remoteIds = {};
      let changed = false;
      for (const f of list) {
        if (!f.name.endsWith('.json')) continue;
        const id = f.name.slice(0, -5);
        remoteIds[id] = f.sha;
        if (sync.deleted[id]) continue;
        if (sync.shas[id] === f.sha) continue; // 바뀐 것 없음
        const r = await fetchRemoteBook(id);
        if (!r) continue;
        const local = books[id];
        if (!local || !sync.dirty[id] || (r.book.updatedAt || '') > (local.updatedAt || '')) {
          books[id] = r.book;
          delete sync.dirty[id];
          changed = true;
        }
        sync.shas[id] = r.sha;
      }
      // 다른 기기에서 지운 책: 원격에 없고, 이 기기에서 바뀐 적도 없으면 지움
      Object.keys(books).forEach(id => {
        if (!remoteIds[id] && sync.shas[id] && !sync.dirty[id]) {
          delete books[id]; delete sync.shas[id];
          changed = true;
        }
      });
      store(LS_BOOKS, books); store(LS_SYNC, sync);
      syncing = false;
      await pushDirty();
      if (changed) render();
    } catch (e) {
      syncing = false;
      setStatus('동기화 실패: ' + e.message, true);
    }
  }

  async function pushDirty() {
    if (!ghReady() || syncing) return;
    const ids = Object.keys(sync.dirty);
    const delIds = Object.keys(sync.deleted);
    if (!ids.length && !delIds.length) {
      setStatus('GitHub와 맞춰짐 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
      return;
    }
    syncing = true;
    setStatus('GitHub에 저장 중…');
    try {
      for (const id of ids) {
        const book = books[id];
        if (!book) { delete sync.dirty[id]; continue; }
        const version = book.updatedAt;
        await putBook(book);
        // 올리는 사이에 또 고쳤으면 다음 차례에 다시 올린다
        if (!books[id] || books[id].updatedAt === version) delete sync.dirty[id];
        else scheduleSync();
        store(LS_SYNC, sync);
      }
      for (const id of delIds) {
        let sha = sync.deleted[id];
        if (sha === true) { const r = await fetchRemoteBook(id); sha = r && r.sha; }
        if (sha) {
          try {
            await gh(DATA_DIR + '/' + id + '.json', { method: 'DELETE', body: { message: '책 삭제: ' + id, sha: sha } });
          } catch (e) { if (e.status !== 404 && e.status !== 409) throw e; }
        }
        delete sync.deleted[id]; delete sync.shas[id];
        store(LS_SYNC, sync);
      }
      syncing = false;
      setStatus('GitHub에 저장됨 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      syncing = false;
      setStatus('GitHub 저장 실패: ' + e.message, true);
    }
  }

  async function putBook(book, retried) {
    const body = {
      message: (book.title || '제목 없음') + ' 기록 ' + todayStr(),
      content: b64encode(JSON.stringify(book, null, 2) + '\n')
    };
    if (sync.shas[book.id]) body.sha = sync.shas[book.id];
    try {
      const r = await gh(DATA_DIR + '/' + book.id + '.json', { method: 'PUT', body: body });
      sync.shas[book.id] = r.content.sha;
    } catch (e) {
      // 다른 기기가 먼저 저장한 경우: 원격이 더 최신이면 원격을 받고, 아니면 덮어쓴다
      if ((e.status === 409 || e.status === 422) && !retried) {
        const remote = await fetchRemoteBook(book.id);
        if (remote && (remote.book.updatedAt || '') > (book.updatedAt || '')) {
          books[book.id] = remote.book; sync.shas[book.id] = remote.sha;
          store(LS_BOOKS, books);
          render();
          return;
        }
        sync.shas[book.id] = remote ? remote.sha : undefined;
        return putBook(book, true);
      }
      throw e;
    }
  }

  function setStatus(text, isErr) {
    const el = document.getElementById('sync-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('err', !!isErr);
  }

  // ---------- 화면 ----------
  const app = document.getElementById('app');

  function go(v) { view = v; render(); window.scrollTo(0, 0); }

  function render() {
    if (view.name === 'book' && !books[view.bookId]) view = { name: 'list' };
    if (view.name === 'list') renderList();
    else if (view.name === 'newbook') renderBookForm(null);
    else if (view.name === 'editbook') renderBookForm(books[view.bookId]);
    else if (view.name === 'book') renderBook();
    else if (view.name === 'settings') renderSettings();
    else if (view.name === 'export') renderExport();
    else if (view.name === 'dayexport') renderDayExport();
  }

  function sortedBooks(status) {
    return Object.values(books)
      .filter(b => (status === 'done' ? b.status === 'done' : b.status !== 'done'))
      .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  }

  function renderList() {
    const reading = sortedBooks('reading');
    const done = sortedBooks('done');
    const t = todayStr();
    const card = b => {
      const todayDone = (() => { const e = getEntry(b, t); return e && !entryIsEmpty(e); })();
      const pend = pendingChecks(b);
      return '<button class="book-card" data-open="' + esc(b.id) + '" type="button">' +
        '<div class="row"><span class="title">' + esc(b.title || '제목 없음') + '</span>' +
        '<span class="day-count">' + readingDay(b) + '일째</span></div>' +
        '<div class="meta">' + esc(b.author || '저자 미입력') + ' · ' + (b.format === 'ebook' ? '전자책' : '종이책') +
        ' · ' + fmtDate(b.startDate) + ' 시작' + (b.topic ? ' · ' + esc(b.topic) : '') + '</div>' +
        '<div class="badges">' +
        (b.status === 'done' ? '<span class="badge">완독 ' + fmtDate(b.finishedDate) + '</span>' :
          (todayDone ? '<span class="badge ok">오늘 기록함</span>' : '<span class="badge">오늘 기록 전</span>')) +
        (pend ? '<span class="badge warn">실천 체크 ' + pend + '개 남음</span>' : '') +
        '</div></button>';
    };
    app.innerHTML =
      '<h1>읽고 있는 책</h1>' +
      '<p class="muted small">' + fmtDate(t) + ' · 문장이 서툴러도 괜찮아요. 오늘 읽은 만큼만 적어요.</p>' +
      (!ghReady() ? '<p class="notice">아직 이 기기에만 저장돼요. <a href="#" data-go="settings">설정</a>에서 GitHub를 연결하면 휴대폰과 컴퓨터가 같은 기록을 봐요.</p>' : '') +
      '<div class="actions"><button class="btn" data-go="newbook" type="button">+ 새 책 시작하기</button>' +
      '<button class="btn ghost" id="day-export" type="button">오늘 기록으로 롱폼 대본 만들기</button></div>' +
      '<div class="book-list" style="margin-top:12px">' +
      (reading.length ? reading.map(card).join('') : '<div class="empty">아직 읽고 있는 책이 없어요.</div>') +
      '</div>' +
      (done.length ? '<h2 style="margin-top:28px">다 읽은 책 (' + done.length + ')</h2><div class="book-list">' + done.map(card).join('') + '</div>' : '');
    app.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => go({ name: 'book', bookId: el.dataset.open, date: todayStr() })));
    document.getElementById('day-export').addEventListener('click', () => go({ name: 'dayexport', date: todayStr() }));
  }

  function renderBookForm(book) {
    const isNew = !book;
    const b = book || { title: '', author: '', format: 'paper', startDate: todayStr(), topic: '', whyReading: '' };
    app.innerHTML =
      '<button class="back" type="button" id="back">← 돌아가기</button>' +
      '<h1>' + (isNew ? '새 책 시작하기' : '책 정보 고치기') + '</h1>' +
      '<div class="card">' +
      '<label for="f-title">책 이름</label><input id="f-title" type="text" value="' + esc(b.title) + '" required>' +
      '<label for="f-author">저자</label><input id="f-author" type="text" value="' + esc(b.author) + '">' +
      '<label>읽는 형태</label><div class="seg" id="f-format">' +
      '<button type="button" data-v="paper" class="' + (b.format !== 'ebook' ? 'on' : '') + '">종이책</button>' +
      '<button type="button" data-v="ebook" class="' + (b.format === 'ebook' ? 'on' : '') + '">전자책</button></div>' +
      '<label for="f-start">읽기 시작한 날</label><input id="f-start" type="date" value="' + esc(b.startDate) + '">' +
      '<label for="f-topic">주제 (선택)</label><input id="f-topic" type="text" placeholder="예: 심리, 경제, 에세이" value="' + esc(b.topic) + '">' +
      (isNew ? '<label for="f-why">이 책을 읽게 된 이유</label><textarea id="f-why" placeholder="나중에 적어도 돼요">' + esc(b.whyReading) + '</textarea>' : '') +
      '<div class="actions"><button class="btn" id="f-save" type="button">' + (isNew ? '시작하기' : '저장') + '</button>' +
      (!isNew ? '<button class="btn danger" id="f-delete" type="button">이 책 지우기</button>' : '') + '</div>' +
      '</div>';
    let format = b.format === 'ebook' ? 'ebook' : 'paper';
    app.querySelectorAll('#f-format button').forEach(btn => btn.addEventListener('click', () => {
      format = btn.dataset.v;
      app.querySelectorAll('#f-format button').forEach(x => x.classList.toggle('on', x === btn));
    }));
    document.getElementById('back').addEventListener('click', () => go(isNew ? { name: 'list' } : { name: 'book', bookId: book.id, date: todayStr() }));
    document.getElementById('f-save').addEventListener('click', () => {
      const title = document.getElementById('f-title').value.trim();
      if (!title) { alert('책 이름을 적어주세요.'); return; }
      const target = book || { id: uid(), status: 'reading', entries: [], createdAt: new Date().toISOString() };
      target.title = title;
      target.author = document.getElementById('f-author').value.trim();
      target.format = format;
      target.startDate = document.getElementById('f-start').value || todayStr();
      target.topic = document.getElementById('f-topic').value.trim();
      if (isNew) target.whyReading = document.getElementById('f-why').value;
      saveBook(target);
      go({ name: 'book', bookId: target.id, date: todayStr() });
    });
    if (!isNew) document.getElementById('f-delete').addEventListener('click', () => {
      if (!confirm('"' + book.title + '"의 모든 기록을 지울까요? 되돌릴 수 없어요.')) return;
      delete books[book.id];
      sync.deleted[book.id] = sync.shas[book.id] || true;
      delete sync.dirty[book.id];
      store(LS_BOOKS, books); store(LS_SYNC, sync);
      scheduleSync();
      go({ name: 'list' });
    });
  }

  function renderBook() {
    const book = books[view.bookId];
    const date = view.date || todayStr();
    const entry = getEntry(book, date) || newEntry(date);
    const dates = (book.entries || []).filter(e => !entryIsEmpty(e)).map(e => e.date);
    if (!dates.includes(todayStr())) dates.push(todayStr());
    if (!dates.includes(date)) dates.push(date);
    dates.sort().reverse();

    // 아직 저장되지 않은 새 기록이면 입력하는 순간 책에 붙인다
    function live() { return ensureEntry(book, date); }
    function commit() { saveBook(book, { quiet: false }); }

    const isPast = date < todayStr();

    app.innerHTML =
      '<button class="back" type="button" id="back">← 책 목록</button>' +
      '<h1>' + esc(book.title) + '</h1>' +
      '<p class="muted small">' + esc(book.author || '저자 미입력') + ' · ' + (book.format === 'ebook' ? '전자책' : '종이책') +
      ' · ' + fmtDate(book.startDate) + ' 시작 · <strong class="day-count">' + readingDay(book) + '일째</strong>' +
      (book.status === 'done' ? ' · 완독' : '') + '</p>' +
      '<div class="actions">' +
      '<button class="btn ghost small" id="edit-book" type="button">책 정보 고치기</button>' +
      (book.status === 'done'
        ? '<button class="btn ghost small" id="reopen" type="button">다시 읽는 중으로</button>'
        : '<button class="btn ghost small" id="finish" type="button">다 읽었어요</button>') +
      '</div>' +

      '<div class="card"><h2><span class="section-num">1</span>이 책을 읽게 된 이유</h2>' +
      '<textarea id="why" placeholder="왜 이 책을 골랐나요?">' + esc(book.whyReading) + '</textarea></div>' +

      '<div class="card">' +
      '<div class="date-bar"><h2 style="margin:0">' + fmtDate(date) + ' 기록</h2>' +
      '<input type="date" id="pick-date" value="' + esc(date) + '" aria-label="다른 날짜 기록 보기"></div>' +
      '<div class="date-chips">' + dates.map(d => '<button type="button" class="chip' + (d === date ? ' on' : '') + '" data-date="' + d + '">' +
        (d === todayStr() ? '오늘' : fmtDate(d)) + '</button>').join('') + '</div>' +
      '<label for="pages">오늘 읽은 곳 (선택)</label><input id="pages" type="text" placeholder="예: 45~92쪽, 3장까지" value="' + esc(entry.pages) + '">' +
      '<div class="actions"><button class="btn small" id="to-export" type="button">이 날 기록으로 포스팅용 글 만들기</button></div>' +
      '</div>' +

      '<div class="card"><h2><span class="section-num">2</span>발췌한 문장</h2>' +
      '<div id="quotes">' + entry.quotes.map((q, i) => quoteHtml(q, i)).join('') + '</div>' +
      '<button class="btn ghost small" id="add-quote" type="button">+ 문장 추가</button></div>' +

      '<div class="card"><h2><span class="section-num">3</span>오늘 읽은 내용 정리</h2>' +
      '<textarea id="summary" style="min-height:140px" placeholder="오늘 읽은 곳까지, 내 말로 정리해요.">' + esc(entry.summary) + '</textarea></div>' +

      '<div class="card"><h2><span class="section-num">4</span>현실에 적용하기 (1~3가지)</h2>' +
      '<p class="muted small">다음 날, 실천했는지 아래에서 체크해요.</p>' +
      '<div id="apps">' + entry.applications.map((a, i) => appHtml(a, i, isPast)).join('') + '</div>' +
      (entry.applications.length < 3 ? '<button class="btn ghost small" id="add-app" type="button">+ 적용 방법 추가</button>' : '') +
      '</div>';

    document.getElementById('back').addEventListener('click', () => go({ name: 'list' }));
    document.getElementById('to-export').addEventListener('click', () => go({ name: 'export', bookId: book.id, date: date, tab: 'blog' }));
    document.getElementById('edit-book').addEventListener('click', () => go({ name: 'editbook', bookId: book.id }));
    const fin = document.getElementById('finish');
    if (fin) fin.addEventListener('click', () => { book.status = 'done'; book.finishedDate = todayStr(); commit(); render(); });
    const reo = document.getElementById('reopen');
    if (reo) reo.addEventListener('click', () => { book.status = 'reading'; book.finishedDate = ''; commit(); render(); });

    bindText('why', v => { book.whyReading = v; });
    bindText('pages', v => { live().pages = v; });
    bindText('summary', v => { live().summary = v; });

    document.getElementById('pick-date').addEventListener('change', e => { if (e.target.value) go({ name: 'book', bookId: book.id, date: e.target.value }); });
    app.querySelectorAll('[data-date]').forEach(el => el.addEventListener('click', () => go({ name: 'book', bookId: book.id, date: el.dataset.date })));

    document.getElementById('add-quote').addEventListener('click', () => {
      live().quotes.push({ id: uid(), text: '', page: '', reason: '' }); commit(); render();
      const tas = app.querySelectorAll('#quotes textarea[data-qf="text"]'); if (tas.length) tas[tas.length - 1].focus();
    });
    app.querySelectorAll('#quotes [data-qi]').forEach(el => {
      const i = Number(el.dataset.qi), f = el.dataset.qf;
      if (f === 'remove') el.addEventListener('click', () => {
        if (!confirm('이 문장을 지울까요?')) return;
        live().quotes.splice(i, 1); commit(); render();
      });
      else bindEl(el, v => { live().quotes[i][f] = v; });
    });

    const addApp = document.getElementById('add-app');
    if (addApp) addApp.addEventListener('click', () => {
      live().applications.push(newApplication()); commit(); render();
      const tas = app.querySelectorAll('#apps textarea[data-af="text"]'); if (tas.length) tas[tas.length - 1].focus();
    });
    app.querySelectorAll('#apps [data-ai]').forEach(el => {
      const i = Number(el.dataset.ai), f = el.dataset.af;
      if (f === 'remove') el.addEventListener('click', () => {
        if (!confirm('이 적용 방법을 지울까요?')) return;
        live().applications.splice(i, 1); commit(); render();
      });
      else if (f === 'practiced') el.addEventListener('click', () => {
        const a = live().applications[i];
        const v = el.dataset.v === 'yes';
        a.practiced = a.practiced === v ? null : v;
        commit(); render();
      });
      else bindEl(el, v => { live().applications[i][f] = v; });
    });

    function bindText(id, set) { bindEl(document.getElementById(id), set); }
    function bindEl(el, set) {
      el.addEventListener('input', () => { set(el.value); commit(); });
    }
  }

  function quoteHtml(q, i) {
    return '<div class="quote">' +
      '<div class="quote-head"><h3>문장 ' + (i + 1) + '</h3>' +
      '<button class="btn danger small" type="button" data-qi="' + i + '" data-qf="remove">지우기</button></div>' +
      '<textarea data-qi="' + i + '" data-qf="text" placeholder="마음에 남은 문장을 그대로 옮겨요.">' + esc(q.text) + '</textarea>' +
      '<label>쪽수 (선택)</label><input type="text" data-qi="' + i + '" data-qf="page" value="' + esc(q.page) + '">' +
      '<label>이 문장을 고른 이유</label>' +
      '<textarea data-qi="' + i + '" data-qf="reason" placeholder="왜 이 문장이 남았나요?">' + esc(q.reason) + '</textarea>' +
      '</div>';
  }

  function appHtml(a, i, canCheck) {
    const yes = a.practiced === true, no = a.practiced === false;
    return '<div class="apply-item">' +
      '<div class="quote-head"><h3>적용 ' + (i + 1) + '</h3>' +
      '<button class="btn danger small" type="button" data-ai="' + i + '" data-af="remove">지우기</button></div>' +
      '<textarea data-ai="' + i + '" data-af="text" style="min-height:60px" placeholder="내 생활에서 해볼 수 있는 것">' + esc(a.text) + '</textarea>' +
      '<div class="check-box">' +
      '<div class="small" style="margin-bottom:6px"><strong>다음 날 실천 체크</strong>' +
      (!canCheck && a.practiced === null ? ' <span class="muted">· 내일 와서 체크해요</span>' : '') + '</div>' +
      '<div class="seg okwarn">' +
      '<button type="button" class="yes' + (yes ? ' on' : '') + '" data-ai="' + i + '" data-af="practiced" data-v="yes">실천했어요</button>' +
      '<button type="button" class="no' + (no ? ' on' : '') + '" data-ai="' + i + '" data-af="practiced" data-v="no">못 했어요</button></div>' +
      (yes ? '<label>실천해서 어떤 게 달라졌나요?</label><textarea data-ai="' + i + '" data-af="result">' + esc(a.result) + '</textarea>' : '') +
      (no ? '<label>왜 실천하지 못했나요?</label><textarea data-ai="' + i + '" data-af="reason">' + esc(a.reason) + '</textarea>' : '') +
      '</div></div>';
  }

  // ---------- 포스팅용 글 ----------
  const F = window.ReadingFormats;

  function copyBtn(id, label) {
    return '<button class="btn small" type="button" data-copy="' + id + '">' + (label || '복사') + '</button>';
  }
  function textBlock(id, text) {
    return '<pre class="out" id="' + id + '">' + esc(text) + '</pre>';
  }
  function bindCopy() {
    app.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', async () => {
      const el = document.getElementById(btn.dataset.copy);
      const text = el.dataset.raw != null ? el.dataset.raw : el.textContent;
      try { await navigator.clipboard.writeText(text); }
      catch (e) {
        const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
        ta.select(); document.execCommand('copy'); ta.remove();
      }
      const old = btn.textContent; btn.textContent = '복사됨'; setTimeout(() => { btn.textContent = old; }, 1200);
    }));
  }
  function scriptHtml(script, idPrefix) {
    const mm = Math.floor(script.totalSec / 60), ss = script.totalSec % 60;
    return '<p class="small"><strong>예상 길이 약 ' + (mm ? mm + '분 ' : '') + ss + '초</strong> <span class="muted">(1초에 5글자 정도로 읽는다고 계산한 대략값)</span></p>' +
      (script.note ? '<p class="notice">' + esc(script.note) + '</p>' : '') +
      '<div class="actions">' + copyBtn(idPrefix + '-all', '대본 전체 복사') + '</div>' +
      '<div hidden id="' + idPrefix + '-all" data-raw="' + esc(F.scriptText(script)) + '"></div>' +
      script.scenes.map(s => '<div class="scene"><div class="small muted">' + esc(s.part) + ' · 약 ' + s.sec + '초</div>' +
        (s.screen ? '<div class="scene-screen">' + esc(s.screen) + '</div>' : '') +
        (s.say ? '<div class="scene-say">🎙 ' + esc(s.say) + '</div>' : '') + '</div>').join('');
  }

  function renderExport() {
    const book = books[view.bookId];
    if (!book) { go({ name: 'list' }); return; }
    const entry = getEntry(book, view.date);
    const tab = view.tab || 'blog';
    const opts = { intro: settings.intro, outro: settings.outro };
    const tabs = [['blog', '네이버 블로그'], ['threads', 'Threads'], ['long', '롱폼 대본'], ['short', '쇼츠·릴스 대본']];
    let body = '';
    if (!entry || !F.hasContent(entry)) {
      body = '<div class="empty">이 날 기록이 아직 없어요.</div>';
    } else if (tab === 'blog') {
      const b = F.blog(book, entry, opts);
      body = '<label>제목</label>' + textBlock('o-title', b.title) + '<div class="actions">' + copyBtn('o-title', '제목 복사') + '</div>' +
        '<label>본문</label>' + textBlock('o-body', b.body) + '<div class="actions">' + copyBtn('o-body', '본문 복사') + '</div>';
    } else if (tab === 'threads') {
      const posts = F.threads(book, entry);
      body = '<p class="small muted">' + posts.length + '개 글을 순서대로 이어서 올려요. 첫 글을 올리고, 나머지는 그 글의 답글로 달면 돼요.</p>' +
        posts.map((p, i) => '<div class="scene"><div class="quote-head"><span class="small muted">' + (i + 1) + '번째 · ' + p.length + '/' + F.THREADS_LIMIT + '자</span>' + copyBtn('o-t' + i) + '</div>' + textBlock('o-t' + i, p) + '</div>').join('');
    } else if (tab === 'long') {
      body = '<p class="small muted">하루 한 권만으로는 짧을 수 있어요. 목록 화면의 "오늘 기록으로 롱폼 대본 만들기"는 오늘 읽은 책을 모두 묶어줘요.</p>' +
        scriptHtml(F.longScript(book, entry, opts), 'o-long');
    } else {
      const qs = (entry.quotes || []).filter(q => q.text && q.text.trim());
      const qi = Math.min(view.qi || 0, Math.max(qs.length - 1, 0));
      body = (qs.length > 1 ? '<label>쓸 문장 고르기</label><div class="date-chips">' + qs.map((q, i) =>
        '<button type="button" class="chip' + (i === qi ? ' on' : '') + '" data-qpick="' + i + '">문장 ' + (i + 1) + '</button>').join('') + '</div>' : '') +
        scriptHtml(F.shortScript(book, entry, { quoteIndex: qi }), 'o-short');
    }
    app.innerHTML =
      '<button class="back" type="button" id="back">← ' + esc(book.title) + '</button>' +
      '<h1>포스팅용 글</h1>' +
      '<p class="muted small">' + fmtDate(view.date) + ' 기록 · 내가 쓴 문장은 그대로 두고 순서와 형식만 바꿨어요.</p>' +
      '<div class="date-chips">' + tabs.map(([k, l]) => '<button type="button" class="chip' + (k === tab ? ' on' : '') + '" data-tab="' + k + '">' + l + '</button>').join('') + '</div>' +
      '<div class="card">' + body + '</div>';
    document.getElementById('back').addEventListener('click', () => go({ name: 'book', bookId: book.id, date: view.date }));
    app.querySelectorAll('[data-tab]').forEach(el => el.addEventListener('click', () => { view.tab = el.dataset.tab; render(); }));
    app.querySelectorAll('[data-qpick]').forEach(el => el.addEventListener('click', () => { view.qi = Number(el.dataset.qpick); render(); }));
    bindCopy();
  }

  function renderDayExport() {
    const date = view.date || todayStr();
    const items = Object.values(books)
      .map(b => ({ book: b, entry: getEntry(b, date) }))
      .filter(it => it.entry && F.hasContent(it.entry))
      .sort((a, b) => (a.book.startDate || '').localeCompare(b.book.startDate || ''));
    app.innerHTML =
      '<button class="back" type="button" id="back">← 책 목록</button>' +
      '<h1>하루 롱폼 대본</h1>' +
      '<div class="date-bar"><input type="date" id="pick-date" value="' + esc(date) + '" aria-label="날짜"></div>' +
      '<p class="muted small">' + fmtDate(date) + '에 기록한 ' + items.length + '권을 한 영상으로 묶었어요.</p>' +
      '<div class="card">' + (items.length ? scriptHtml(F.dayLongScript(items, { intro: settings.intro, outro: settings.outro }), 'o-day') :
        '<div class="empty">이 날 기록한 책이 없어요.</div>') + '</div>';
    document.getElementById('back').addEventListener('click', () => go({ name: 'list' }));
    document.getElementById('pick-date').addEventListener('change', e => { if (e.target.value) go({ name: 'dayexport', date: e.target.value }); });
    bindCopy();
  }

  function renderSettings() {
    app.innerHTML =
      '<button class="back" type="button" id="back">← 책 목록</button>' +
      '<h1>설정</h1>' +
      '<div class="card"><h2>GitHub 연결 (기기 간 동기화)</h2>' +
      '<p class="small muted">기록은 비공개 저장소의 <code>books/</code> 폴더에 책마다 파일 하나로 저장돼요. 토큰은 이 기기 브라우저에만 저장되고, 휴대폰과 컴퓨터에서 각각 한 번씩 입력하면 돼요.</p>' +
      '<label for="s-owner">GitHub 아이디</label><input id="s-owner" type="text" autocapitalize="off" autocomplete="off" value="' + esc(settings.owner) + '">' +
      '<label for="s-repo">기록 저장소 이름</label><input id="s-repo" type="text" autocapitalize="off" autocomplete="off" value="' + esc(settings.repo) + '">' +
      '<label for="s-token">토큰 (fine-grained personal access token)</label><input id="s-token" type="password" autocomplete="off" value="' + esc(settings.token) + '">' +
      '<p class="small muted">토큰 만들기: GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token. ' +
      'Repository access는 기록 저장소 <strong>하나만</strong> 고르고, Permissions에서 <strong>Contents: Read and write</strong>만 켜요.</p>' +
      '<div class="actions"><button class="btn" id="s-save" type="button">저장하고 동기화</button>' +
      '<button class="btn ghost" id="s-sync" type="button">지금 동기화</button>' +
      (settings.token ? '<button class="btn danger" id="s-forget" type="button">이 기기에서 토큰 지우기</button>' : '') + '</div>' +
      '</div>' +
      '<div class="card"><h2>내 인사말</h2>' +
      '<p class="small muted">포스팅용 글과 영상 대본의 시작과 끝에 그대로 들어가요. 비워두면 넣지 않아요. 이 기기에만 저장돼요.</p>' +
      '<label for="s-intro">영상 시작 인사</label><textarea id="s-intro" style="min-height:60px" placeholder="예: 오늘도 읽고 버틴 하루, 기록을 나눠요.">' + esc(settings.intro) + '</textarea>' +
      '<label for="s-outro">마무리 인사 (블로그·영상 끝)</label><textarea id="s-outro" style="min-height:60px">' + esc(settings.outro) + '</textarea>' +
      '</div>' +
      '<div class="card"><h2>백업</h2>' +
      '<p class="small muted">모든 기록을 파일 하나로 내려받거나, 백업 파일에서 불러와요.</p>' +
      '<div class="actions"><button class="btn ghost" id="b-export" type="button">백업 내려받기</button>' +
      '<label class="btn ghost" style="margin:0;color:var(--accent)">백업 불러오기<input id="b-import" type="file" accept="application/json" hidden></label></div>' +
      '</div>';
    document.getElementById('back').addEventListener('click', () => go({ name: 'list' }));
    document.getElementById('s-save').addEventListener('click', () => {
      settings.owner = document.getElementById('s-owner').value.trim();
      settings.repo = document.getElementById('s-repo').value.trim();
      settings.token = document.getElementById('s-token').value.trim();
      store(LS_SETTINGS, settings);
      // 처음 연결할 때 이 기기에만 있던 책도 올라가도록 표시
      Object.keys(books).forEach(id => { if (!sync.shas[id]) sync.dirty[id] = true; });
      store(LS_SYNC, sync);
      pullAll();
    });
    document.getElementById('s-sync').addEventListener('click', () => pullAll());
    ['intro', 'outro'].forEach(k => document.getElementById('s-' + k).addEventListener('input', e => {
      settings[k] = e.target.value; store(LS_SETTINGS, settings);
    }));
    const forget = document.getElementById('s-forget');
    if (forget) forget.addEventListener('click', () => {
      if (!confirm('이 기기에서 토큰을 지울까요? 기록은 남아 있어요.')) return;
      settings.token = ''; store(LS_SETTINGS, settings); setStatus(''); render();
    });
    document.getElementById('b-export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), books: books }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'reading-notes-backup-' + todayStr() + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    document.getElementById('b-import').addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const incoming = data.books || {};
        const n = Object.keys(incoming).length;
        if (!confirm(n + '권의 기록을 불러올까요? 같은 책은 더 최근 것으로 바뀌어요.')) return;
        Object.values(incoming).forEach(b => {
          const cur = books[b.id];
          if (!cur || (b.updatedAt || '') > (cur.updatedAt || '')) { books[b.id] = b; sync.dirty[b.id] = true; }
        });
        store(LS_BOOKS, books); store(LS_SYNC, sync); scheduleSync();
        alert('불러왔어요.'); go({ name: 'list' });
      } catch (err) { alert('백업 파일을 읽지 못했어요: ' + err.message); }
    });
  }

  // 상단 버튼과 안내 링크
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-go]');
    if (!el) return;
    e.preventDefault();
    go({ name: el.dataset.go });
  });

  // 다른 기기에서 쓴 기록을 가져오기: 앱을 열 때, 다시 화면으로 돌아올 때
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pullAll();
    else pushDirty();
  });
  window.addEventListener('beforeunload', () => { if (Object.keys(sync.dirty).length) pushDirty(); });

  render();
  if (ghReady()) pullAll();
  else setStatus('이 기기에만 저장');
})();
