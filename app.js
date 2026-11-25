/* 독서노트 — 휴대폰·컴퓨터에서 같은 기록을 쓰는 작은 앱.
 * 기록은 이 기기(localStorage)에 먼저 저장되고, 설정에서 GitHub 비공개 저장소를 연결하면
 * books/<책id>.json 파일로 동기화된다. 빌드 도구 없이 이 파일 하나로 동작한다.
 */
(function () {
  'use strict';

  // 새 버전을 올릴 때마다 바꾼다. 브라우저가 예전 파일을 쓰지 않게 하려고.
  const APP_VERSION = '20261125d';

  const LS_STATE = 'rn.state.v2';
  const DATA_DIR = 'books';

  // ---------- 저장소(로컬) ----------
  let readFailed = false;
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { readFailed = true; return fallback; }
  }
  function profile(books = {}) {
    return { books, sync: { shas: {}, dirty: {}, deleted: {}, bases: {}, conflicts: {} } };
  }

  function migrate() {
    const old = load('rn.settings.v1', {});
    const key = old.owner && old.repo ? targetKey(old.owner, old.repo) : '';
    const initial = profile(load('rn.books.v1', {}));
    Object.assign(initial.sync, load('rn.sync.v1', {}));
    return { active: key, profiles: { [key]: initial }, intro: old.intro, outro: old.outro };
  }

  function targetKey(owner, repo) { return (owner + '/' + repo).toLowerCase(); }
  function connection(key, token = '') {
    const [owner = '', repo = 'reading-notes-data'] = key.split('/');
    return { owner, repo, token };
  }

  let state = load(LS_STATE, null) || migrate();
  let { books, sync } = state.profiles[state.active];
  const legacySettings = load('rn.settings.v1', {});
  let settings = connection(state.active,
    state.active === targetKey(legacySettings.owner, legacySettings.repo) ? legacySettings.token : '');
  let storageFailed = false;

  function persist() {
    if (readFailed) {
      storageFailed = true;
      setStatus('기기에서 기존 기록을 읽지 못했어요. 입력한 글은 화면을 닫기 전에 백업하세요.', true);
      return false;
    }
    try {
      localStorage.setItem(LS_STATE, JSON.stringify(state));
    } catch (e) {
      storageFailed = true;
      setStatus('기기에 저장하지 못했어요. 화면을 닫기 전에 백업을 내려받으세요.', true);
      return false;
    }
    storageFailed = false;
    // Keep legacy records for recovery, but remove the old stored credential.
    try { localStorage.removeItem('rn.settings.v1'); } catch (e) { /* storage unavailable */ }
    return true;
  }

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
    sync.dirty[book.id] = true;
    if (!persist()) return;
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
  async function github(path, opts = {}, account = settings) {
    const res = await fetch('https://api.github.com' + path, {
      method: opts.method || 'GET',
      headers: {
        Authorization: 'Bearer ' + account.token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
      redirect: 'error'
    });
    if (res.status === 404 && opts.allow404) return null;
    if (!res.ok) throw new Error('GitHub 응답 ' + res.status);
    return res.json();
  }

  function repoPath(account = settings) {
    return '/repos/' + encodeURIComponent(account.owner) + '/' + encodeURIComponent(account.repo);
  }

  async function verifyPrivateRepo(account = settings) {
    const repo = await github(repoPath(account), {}, account);
    if (repo.private !== true || repo.visibility !== 'private') {
      throw new Error('비공개 저장소에만 기록을 보낼 수 있어요.');
    }
    if (targetKey(account.owner, account.repo) !== String(repo.full_name).toLowerCase()) {
      throw new Error('기록 저장소 주소를 다시 확인해 주세요.');
    }
    return repo.id;
  }

  function gh(path, opts) { return github(repoPath() + '/contents/' + path, opts); }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function validateBook(book, id) {
    const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    const item = value => value && typeof value.id === 'string';
    if (!book || book.id !== id || !/^[a-z0-9]+$/.test(id) || Object.hasOwn(Object.prototype, id) || !day(book.startDate) ||
        (book.finishedDate && !day(book.finishedDate)) || !Array.isArray(book.entries) ||
        !book.entries.every(e => e && day(e.date) && Array.isArray(e.quotes) && e.quotes.every(item) &&
          Array.isArray(e.applications) && e.applications.every(item))) {
      throw new Error('독서 기록 파일의 형식이 올바르지 않아요.');
    }
  }

  // Merge independent edits using the last version both sides shared.
  function mergeValue(base, local, remote, conflicts, choice, path = []) {
    if (same(local, remote)) return local;
    if (same(local, base)) return remote;
    if (same(remote, base)) return local;

    const key = path.at(-1);
    const itemKey = key === 'entries' ? 'date' : (key === 'quotes' || key === 'applications' ? 'id' : null);
    if (itemKey && Array.isArray(local) && Array.isArray(remote) && (base === undefined || Array.isArray(base))) {
      const index = items => new Map((items || []).map(item => [item[itemKey], item]));
      const [before, here, there] = [base, local, remote].map(index);
      const ids = new Set([...here.keys(), ...there.keys()]);
      const items = [...ids].map(id => {
        const localItem = here.get(id);
        const remoteItem = there.get(id);
        const baseline = before.get(id) ??
          (key === 'entries' && localItem && remoteItem ? newEntry(id) : undefined);
        return mergeValue(baseline, localItem, remoteItem, conflicts, choice, [...path, id]);
      }).filter(Boolean);
      if (key === 'applications' && items.length > 3) {
        conflicts.push(path.join(' / '));
        return choice === 'remote' ? remote : local;
      }
      return key === 'entries' ? items.sort((a, b) => a.date.localeCompare(b.date)) : items;
    }
    const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    if (record(local) && record(remote) && (base === undefined || record(base))) {
      const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
      return Object.fromEntries([...keys].map(key => {
        if (path.length === 0 && key === 'updatedAt') {
          return [key, [local.updatedAt, remote.updatedAt].sort().at(-1)];
        }
        const get = (object, name) => object && Object.hasOwn(object, name) ? object[name] : undefined;
        return [key, mergeValue(get(base, key), get(local, key), get(remote, key), conflicts, choice, [...path, key])];
      }).filter(([, value]) => value !== undefined));
    }
    conflicts.push(path.join(' / ') || '책 전체');
    return choice === 'remote' ? remote : local;
  }

  async function fetchRemoteBook(id) {
    const file = await gh(DATA_DIR + '/' + encodeURIComponent(id) + '.json', { allow404: true });
    if (!file) return null;
    const book = JSON.parse(b64decode(file.content));
    validateBook(book, id);
    return { sha: file.sha, book };
  }

  function reconcile(id, remote) {
    const local = books[id];
    if (!local || !sync.dirty[id]) {
      const changed = !same(local, remote.book);
      if (changed) books[id] = remote.book;
      sync.shas[id] = remote.sha;
      sync.bases[id] = copy(remote.book);
      delete sync.conflicts[id];
      if (changed) refreshView(id);
      return;
    }

    if (sync.shas[id] === remote.sha) {
      // A legacy SHA without a baseline may already refer to a skipped remote edit.
      if (sync.bases[id]) {
        delete sync.conflicts[id];
        return;
      }
    }
    const fields = [];
    const merged = mergeValue(sync.bases[id], local, remote.book, fields);
    if (fields.length) {
      sync.conflicts[id] = { remote, fields };
      return;
    }
    if (!same(local, merged)) {
      books[id] = merged;
      refreshView(id);
    }
    sync.shas[id] = remote.sha;
    sync.bases[id] = copy(remote.book);
    delete sync.conflicts[id];
    if (same(merged, remote.book)) delete sync.dirty[id];
  }

  let syncing = false;
  let syncAgain = false;
  let configuring = false;

  function refreshView(id) {
    if (view.name === 'list' || (view.name === 'book' && view.bookId === id)) render();
  }

  async function pullAll() { return runSync(true); }
  async function pushDirty() { return runSync(false); }

  async function runSync(pull) {
    if (!ghReady() || configuring) return;
    if (syncing) { syncAgain = true; return; }
    if (!persist()) return;

    syncing = true;
    setStatus('GitHub 동기화 중…');
    try {
      const repoId = await verifyPrivateRepo();
      const current = state.profiles[state.active];
      if (current.repoId != null && current.repoId !== repoId) throw new Error('기록 저장소가 바뀌었어요.');
      current.repoId = repoId;

      if (pull) {
        const list = await gh(DATA_DIR, { allow404: true }) || [];
        for (const file of list) {
          if (file.type !== 'file' || !/^[a-z0-9]+\.json$/.test(file.name)) continue;
          const id = file.name.slice(0, -5);
          if (sync.dirty[id] || sync.deleted[id] || (sync.shas[id] === file.sha && books[id] && sync.bases[id])) continue;
          const remote = await fetchRemoteBook(id);
          if (remote) reconcile(id, remote);
        }
      }

      // Earlier versions queued permanent deletion. Convert those requests to recoverable trash.
      for (const id of Object.keys(sync.deleted)) {
        const remote = await fetchRemoteBook(id);
        const book = remote ? remote.book : books[id];
        if (book) {
          books[id] = { ...book, trashedAt: new Date().toISOString() };
          sync.dirty[id] = true;
          if (remote) {
            sync.bases[id] = copy(remote.book);
            sync.shas[id] = remote.sha;
          }
        }
        delete sync.deleted[id];
      }
      if (!persist()) return;

      for (const id of Object.keys(sync.dirty)) {
        const remote = await fetchRemoteBook(id);
        if (remote) reconcile(id, remote);
        if (!persist()) return;
        if (sync.conflicts[id] || !sync.dirty[id] || !books[id]) continue;

        if (await verifyPrivateRepo() !== repoId) throw new Error('기록 저장소가 바뀌었어요.');
        const book = copy(books[id]);
        const result = await gh(DATA_DIR + '/' + encodeURIComponent(id) + '.json', {
          method: 'PUT',
          body: {
            message: '독서 기록 저장',
            content: b64encode(JSON.stringify(book, null, 2) + '\n'),
            ...(remote ? { sha: remote.sha } : {})
          }
        });
        sync.shas[id] = result.content.sha;
        sync.bases[id] = book;
        if (same(books[id], book)) delete sync.dirty[id];
        if (!persist()) return;
      }

      const conflicts = Object.keys(sync.conflicts).length;
      setStatus(conflicts ? '동기화 충돌 ' + conflicts + '건 · 설정에서 확인' : 'GitHub 동기화 완료', !!conflicts);
      if (view.name === 'settings') renderRecovery();
    } catch (e) {
      setStatus('동기화 실패 · ' + e.message, true);
    } finally {
      syncing = false;
      if (syncAgain) {
        syncAgain = false;
        setTimeout(pullAll, 0);
      }
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
    if (view.name === 'book' && (!books[view.bookId] || books[view.bookId].trashedAt)) view = { name: 'list' };
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
      .filter(b => !b.trashedAt)
      .filter(b => (status === 'done' ? b.status === 'done' : b.status !== 'done'))
      .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  }

  // 책마다 다른 흙빛 표지색 (제목으로 정함)
  function coverTone(title) {
    const tones = [['#b9a28e', '#8f7a68'], ['#c8b6a4', '#a48d79'], ['#a99a8a', '#7b6c5f'], ['#cbb9a0', '#9c8669'], ['#b4a596', '#8a7b70'], ['#bfae9f', '#957f6f']];
    let h = 0; for (const c of String(title || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const [a, b] = tones[h % tones.length];
    return 'radial-gradient(70% 60% at 30% 25%, rgba(255,255,255,.28), transparent 70%), linear-gradient(160deg,' + a + ',' + b + ')';
  }

  function renderList() {
    const reading = sortedBooks('reading');
    const done = sortedBooks('done');
    const t = todayStr();
    const card = b => {
      const todayDone = (() => { const e = getEntry(b, t); return e && !entryIsEmpty(e); })();
      const pend = pendingChecks(b);
      return '<button class="book-card" data-open="' + esc(b.id) + '" type="button">' +
        '<div class="book-cover" style="background:' + coverTone(b.title) + '">' + esc(b.title || '제목 없음') +
        '<span class="cover-day">' + (b.status === 'done' ? '완독' : 'DAY ' + readingDay(b)) + '</span></div>' +
        '<div class="book-body">' +
        '<div class="meta">' + esc(b.author || '저자 미입력') + ' · ' + (b.format === 'ebook' ? '전자책' : '종이책') +
        (b.topic ? ' · ' + esc(b.topic) : '') + '</div>' +
        '<div class="meta">' + fmtDate(b.startDate) + ' 시작 · <span class="day-count">' + readingDay(b) + '일째</span></div>' +
        '<div class="badges">' +
        (b.status === 'done' ? '<span class="badge">완독 ' + fmtDate(b.finishedDate) + '</span>' :
          (todayDone ? '<span class="badge ok">오늘 기록함</span>' : '<span class="badge">오늘 기록 전</span>')) +
        (pend ? '<span class="badge warn">실천 체크 ' + pend + '개</span>' : '') +
        '</div></div></button>';
    };
    app.innerHTML =
      '<section class="hero">' +
      '<h1 class="hero-word">Reading<br>Notes</h1>' +
      '<p class="hero-sub">읽 고 · 쓰 고 · 버 티 는 기 록</p>' +
      '<div class="actions"><button class="btn arrow" data-go="newbook" type="button">새 책 시작하기</button>' +
      '<button class="btn ghost" id="day-export" type="button">오늘 롱폼 대본</button></div>' +
      '</section>' +
      '<div class="intro"><p class="spaced">문장이 서툴러도<br>괜찮아요</p>' +
      '<p>' + fmtDate(t) + '<br>오늘 읽은 만큼만, 내 말로 적어요. 기록은 휴대폰과 컴퓨터 어디서든 이어져요.</p></div>' +
      (!ghReady() ? '<p class="notice">아직 이 기기에만 저장돼요. <a href="#" data-go="settings">설정</a>에서 GitHub를 연결하면 휴대폰과 컴퓨터가 같은 기록을 봐요.</p>' : '') +
      '<h2 class="list-section-title">지금 읽는 책</h2>' +
      (reading.length ? '<div class="book-list">' + reading.map(card).join('') + '</div>' : '<div class="empty-hero">아직 읽고 있는 책이 없어요</div>') +
      (done.length ? '<h2 class="list-section-title">다 읽은 책 · ' + done.length + '</h2><div class="book-list">' + done.map(card).join('') + '</div>' : '') +
      '<p class="foot">하루하루 버티는 사람들에게, 사람의 문장으로</p>';
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
      const target = isNew ? { id: uid(), status: 'reading', entries: [], createdAt: new Date().toISOString() } : books[book.id];
      if (!target || target.trashedAt) { go({ name: 'list' }); return; }
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
      const current = books[book.id];
      if (!current || !confirm('"' + current.title + '"을 휴지통으로 옮길까요? 설정에서 복원할 수 있어요.')) return;
      current.trashedAt = new Date().toISOString();
      saveBook(current);
      go({ name: 'list' });
    });
  }

  function renderBook() {
    const book = books[view.bookId];
    const date = view.date || todayStr();
    const entry = getEntry(book, date) || newEntry(date);
    // 기록한 날을 1, 2, 3… 번호로. 오늘(또는 고른 날)이 아직 비어 있으면 다음 번호로 붙인다.
    const dates = (book.entries || []).filter(e => !entryIsEmpty(e)).map(e => e.date);
    if (book.status !== 'done' && !dates.includes(todayStr())) dates.push(todayStr());
    if (!dates.includes(date)) dates.push(date);
    dates.sort();
    const sessionNo = dates.indexOf(date) + 1;
    const shortDate = d => { const x = parseDay(d); return (x.getMonth() + 1) + '/' + x.getDate(); };

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
      '<div class="session-tabs" role="tablist">' + dates.map((d, i) => {
        const filled = (() => { const e = getEntry(book, d); return e && !entryIsEmpty(e); })();
        return '<button type="button" role="tab" aria-selected="' + (d === date) + '" class="session' + (d === date ? ' on' : '') + (filled ? '' : ' empty') + '" data-date="' + d + '">' +
          '<span class="session-no">' + (i + 1) + '</span><span class="session-date">' + (d === todayStr() ? '오늘' : shortDate(d)) + '</span></button>';
      }).join('') + '</div>' +
      '<div class="date-bar"><h2 style="margin:0">' + sessionNo + '번째 날 · ' + fmtDate(date) + '</h2></div>' +
      '<p class="small muted" style="margin:4px 0 0">이 날 읽은 내용만 적어요. 포스팅용 글도 이 날 기록으로만 만들어요. ' +
      '<label class="inline-date">지난 날 추가 <input type="date" id="pick-date" value="' + esc(date) + '" aria-label="다른 날짜 기록 보기"></label></p>' +
      '<label for="pages">이 날 읽은 곳 (선택)</label><input id="pages" type="text" placeholder="예: 45~92쪽, 3장까지" value="' + esc(entry.pages) + '">' +
      '<div class="actions"><button class="btn small" id="to-export" type="button">' + sessionNo + '번째 날 기록으로 포스팅용 글 만들기</button></div>' +
      '</div>' +

      '<div class="card"><h2><span class="section-num">2</span>발췌한 문장</h2>' +
      quotesListHtml(entry.quotes) +
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
      const qs = live().quotes;
      qs.push({ id: uid(), text: '', page: '', reason: '' }); commit();
      view.openQuote = qs.length - 1;
      view.qpage = Math.floor((qs.length - 1) / QUOTES_PER_PAGE);
      render();
      const ta = app.querySelector('#quotes textarea[data-qf="text"]'); if (ta) ta.focus();
    });
    app.querySelectorAll('[data-qopen]').forEach(el => el.addEventListener('click', () => {
      const i = Number(el.dataset.qopen);
      view.openQuote = view.openQuote === i ? null : i;
      render();
      const row = app.querySelector('[data-qopen="' + i + '"]'); if (row) row.scrollIntoView({ block: 'nearest' });
    }));
    app.querySelectorAll('[data-qpage]').forEach(el => el.addEventListener('click', () => {
      view.qpage = Number(el.dataset.qpage); view.openQuote = null; render();
    }));
    app.querySelectorAll('#quotes [data-qi]').forEach(el => {
      const i = Number(el.dataset.qi), f = el.dataset.qf;
      if (f === 'remove') el.addEventListener('click', () => {
        if (!confirm('이 문장을 지울까요?')) return;
        live().quotes.splice(i, 1); view.openQuote = null; commit(); render();
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

  const QUOTES_PER_PAGE = 20;

  // 발췌 문장: 한 줄 목록으로 접어 두고, 누른 문장만 펼쳐서 쪽수·고른 이유와 함께 고친다.
  function quotesListHtml(quotes) {
    const pages = Math.max(1, Math.ceil(quotes.length / QUOTES_PER_PAGE));
    const page = Math.min(Math.max(view.qpage || 0, 0), pages - 1);
    const start = page * QUOTES_PER_PAGE;
    const rows = quotes.slice(start, start + QUOTES_PER_PAGE).map((q, k) => {
      const i = start + k;
      const first = (q.text || '').trim().split('\n')[0];
      const preview = first ? (first.length > 40 ? first.slice(0, 40) + '…' : first) : '(아직 비어 있어요)';
      const open = view.openQuote === i;
      return '<div class="qrow' + (open ? ' open' : '') + '">' +
        '<button type="button" class="qrow-head" data-qopen="' + i + '" aria-expanded="' + open + '">' +
        '<span class="qnum">' + (i + 1) + '</span>' +
        '<span class="qtext' + (first ? '' : ' muted') + '">' + esc(preview) + '</span>' +
        (q.page ? '<span class="qpage">' + esc(q.page) + '</span>' : '') +
        '<span class="qmark" title="' + (q.reason && q.reason.trim() ? '고른 이유 있음' : '고른 이유 없음') + '">' + (q.reason && q.reason.trim() ? '✎' : '') + '</span>' +
        '<span class="qchev">' + (open ? '▲' : '▼') + '</span></button>' +
        (open ? quoteHtml(q, i) : '') + '</div>';
    }).join('');
    const pager = pages > 1 ? '<div class="pager">' + Array.from({ length: pages }, (_, p) =>
      '<button type="button" class="chip' + (p === page ? ' on' : '') + '" data-qpage="' + p + '">' +
      (p * QUOTES_PER_PAGE + 1) + '–' + Math.min((p + 1) * QUOTES_PER_PAGE, quotes.length) + '</button>').join('') + '</div>' : '';
    return (quotes.length ? '<p class="small muted">' + quotes.length + '개 · 누르면 쪽수와 고른 이유가 보여요</p>' : '') +
      '<div id="quotes">' + rows + '</div>' + pager;
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
        (s.same ? '<div class="scene-screen">📺🎙 ' + esc(s.screen) + '</div><div class="small muted">화면에 띄우고 그대로 읽어요</div>' :
          (s.screen ? '<div class="scene-screen">📺 ' + esc(s.screen) + '</div>' : '') +
          (s.say ? '<div class="scene-say">🎙 ' + esc(s.say) + '</div>' : '')) + '</div>').join('');
  }

  // ---------- 맞춤법·문맥 다듬기 (Claude) ----------
  // 다듬을 수 있는 칸 목록. 책에서 옮긴 문장(quote.text)은 원문이라 넣지 않는다.
  function proofFields(book, entry) {
    const f = [];
    const add = (id, label, get, set) => { const v = get(); if (v && v.trim()) f.push({ id, label, text: v, set }); };
    add('why', '읽게 된 이유', () => book.whyReading, v => { book.whyReading = v; });
    (entry.quotes || []).forEach((q, i) => add('q' + i, '문장 ' + (i + 1) + '을 고른 이유', () => q.reason, v => { q.reason = v; }));
    add('summary', '오늘 읽은 내용', () => entry.summary, v => { entry.summary = v; });
    (entry.applications || []).forEach((a, i) => {
      add('a' + i, '적용 ' + (i + 1), () => a.text, v => { a.text = v; });
      add('a' + i + 'r', '적용 ' + (i + 1) + ' 실천 결과', () => a.result, v => { a.result = v; });
      add('a' + i + 'n', '적용 ' + (i + 1) + ' 못 한 이유', () => a.reason, v => { a.reason = v; });
    });
    const prev = (book.entries || []).filter(e => e.date < entry.date && F.hasContent(e)).pop();
    if (prev) (prev.applications || []).forEach((a, i) => {
      add('p' + i + 'r', '어제 적용 ' + (i + 1) + ' 실천 결과', () => a.result, v => { a.result = v; });
      add('p' + i + 'n', '어제 적용 ' + (i + 1) + ' 못 한 이유', () => a.reason, v => { a.reason = v; });
    });
    return f;
  }

  // 단어 단위로 바뀐 곳 표시
  function diffHtml(a, b) {
    const x = a.split(/(\s+)/), y = b.split(/(\s+)/);
    const n = x.length, m = y.length;
    if (n * m > 400000) return { before: esc(a), after: esc(b) };
    const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0, before = '', after = '';
    while (i < n || j < m) {
      if (i < n && j < m && x[i] === y[j]) { before += esc(x[i]); after += esc(y[j]); i++; j++; }
      else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { after += '<ins>' + esc(y[j]) + '</ins>'; j++; }
      else { before += '<del>' + esc(x[i]) + '</del>'; i++; }
    }
    return { before, after };
  }

  function llm() {
    return Object.assign({ provider: 'lmstudio', lmUrl: 'http://127.0.0.1:1234', lmModel: '', ollamaUrl: 'http://localhost:11434', ollamaModel: '' }, state.llm || {});
  }
  function llmReady() {
    const l = llm();
    if (l.provider === 'lmstudio') return !!l.lmModel;
    return l.provider === 'ollama' ? !!l.ollamaModel : !!settings.claudeKey;
  }

  function proofCardHtml() {
    const st = view.proof || {};
    const l = llm();
    let h = '<div class="card"><h2>맞춤법·문맥 다듬기</h2>';
    if (!llmReady()) {
      return h + '<p class="small muted">AI가 오타와 어색한 곳을 찾아 제안해요. 쓰려면 <a href="#" data-go="settings">설정</a>에서 ' +
        (l.provider === 'claude' ? 'Claude API 키를 넣어주세요.' : '모델을 골라주세요.') + '</p></div>';
    }
    h += '<p class="small muted">사용 중: ' + (l.provider === 'lmstudio' ? 'LM Studio · ' + esc(l.lmModel) :
      l.provider === 'ollama' ? 'Ollama · ' + esc(l.ollamaModel) : 'Claude') + '</p>';
    h += '<p class="small muted">오타, 띄어쓰기, 뜻이 안 통하는 곳만 제안해요. 말투는 그대로 두고, 적용할지는 하나씩 직접 골라요. 책에서 옮긴 문장은 건드리지 않아요.</p>';
    if (st.loading) return h + '<p>살펴보는 중이에요…</p></div>';
    if (st.error) h += '<p class="notice">' + esc(st.error) + '</p>';
    if (st.items) {
      if (!st.items.length) h += '<p class="notice">' + (st.applied ? '제안을 모두 처리했어요.' : '고칠 곳을 찾지 못했어요. 그대로 올려도 좋아요.') + '</p>';
      else {
        h += '<div class="actions" style="margin-bottom:8px"><button class="btn small" type="button" id="pf-all">모두 적용</button></div>';
        st.items.forEach((s, k) => {
          const d = diffHtml(s.original, s.revised);
          h += '<div class="scene"><div class="small muted">' + esc(s.label) + '</div>' +
            '<div class="pf-before">' + d.before + '</div>' +
            '<div class="pf-after">' + d.after + '</div>' +
            '<div class="small muted">' + esc(s.reason) + '</div>' +
            '<div class="actions"><button class="btn small" type="button" data-pf-apply="' + k + '">적용</button>' +
            '<button class="btn ghost small" type="button" data-pf-skip="' + k + '">그대로 두기</button></div></div>';
        });
      }
    }
    if (!st.items || !st.items.length) h += '<div class="actions"><button class="btn" type="button" id="pf-run">' + (st.items ? '다시 살펴보기' : '살펴보기') + '</button></div>';
    return h + '</div>';
  }

  function bindProof(book, entry) {
    const run = document.getElementById('pf-run');
    if (run) run.addEventListener('click', async () => {
      const fields = proofFields(book, entry);
      if (!fields.length) { view.proof = { items: [], error: '살펴볼 글이 아직 없어요.' }; render(); return; }
      view.proof = { loading: true }; render();
      try {
        const mod = await import('./proofread.js?v=' + APP_VERSION);
        const l = llm();
        const payload = fields.map(f => ({ id: f.id, label: f.label, text: f.text }));
        const res = l.provider === 'lmstudio' ? await mod.proofreadLMStudio(l.lmUrl, l.lmModel, payload)
          : l.provider === 'ollama' ? await mod.proofreadOllama(l.ollamaUrl, l.ollamaModel, payload)
          : await mod.proofread(settings.claudeKey, payload);
        const byId = Object.fromEntries(fields.map(f => [f.id, f]));
        view.proof = { items: res.map(r => ({ id: r.id, label: byId[r.id].label, original: byId[r.id].text, revised: r.revised, reason: r.reason })) };
      } catch (e) {
        view.proof = { error: e.message || String(e) };
      }
      if (view.name === 'export') render();
    });
    const applyOne = s => {
      const f = proofFields(book, entry).find(x => x.id === s.id);
      if (f && f.text === s.original) f.set(s.revised);
    };
    const done = () => { saveBook(book); view.proof.applied = true; render(); };
    app.querySelectorAll('[data-pf-apply]').forEach(b => b.addEventListener('click', () => {
      const k = Number(b.dataset.pfApply); applyOne(view.proof.items[k]); view.proof.items.splice(k, 1); done();
    }));
    app.querySelectorAll('[data-pf-skip]').forEach(b => b.addEventListener('click', () => {
      view.proof.items.splice(Number(b.dataset.pfSkip), 1); view.proof.applied = true; render();
    }));
    const all = document.getElementById('pf-all');
    if (all) all.addEventListener('click', () => { view.proof.items.forEach(applyOne); view.proof.items = []; done(); });
  }

  // ---------- 어투·목표 독자 맞춤 재구성 ----------
  function rsOpts() {
    return Object.assign({ target: '', tone: 'friendly', platform: 'threads', format: 'short' }, state.restyle || {});
  }
  function setRs(patch) { state.restyle = Object.assign(rsOpts(), patch); persist(); }

  function restyleHtml(entry) {
    const o = rsOpts();
    const st = view.rs || {};
    const l = llm();
    const seg = (key, items) => '<div class="date-chips">' + Object.entries(items).map(([k, v]) =>
      '<button type="button" class="chip' + (o[key] === k ? ' on' : '') + '" data-rs="' + key + '" data-v="' + k + '">' + esc(v) + '</button>').join('') + '</div>';
    const saved = entry.restyled;
    let h = '<p class="small muted">내 기록을 재료로, 고른 어투와 목표 독자에 맞춰 글을 다시 구성해요. 기록에 없는 경험이나 숫자는 지어내지 않고, 책 문장은 그대로 둬요. 결과는 직접 고칠 수 있어요.</p>' +
      '<label for="rs-target">목표 독자</label>' +
      '<textarea id="rs-target" style="min-height:60px" placeholder="예: 하루하루 버티느라 자기 자신을 돌볼 틈이 없는 20~30대">' + esc(o.target) + '</textarea>' +
      '<label>어투</label>' + seg('tone', Object.fromEntries(Object.entries(F.RS_TONES).map(([k, v]) => [k, v.label]))) +
      '<label>플랫폼</label>' + seg('platform', { threads: 'Threads (500자)', x: 'X (280자)' }) +
      '<label>분량</label>' + seg('format', Object.fromEntries(Object.entries(F.RS_FORMATS).map(([k, v]) => [k, v.label + ' ' + v.count]))) +
      '<p class="small muted">사용 중: ' + (l.provider === 'lmstudio' ? 'LM Studio · ' + esc(l.lmModel || '모델 미선택') : l.provider === 'ollama' ? 'Ollama · ' + esc(l.ollamaModel || '모델 미선택') : 'Claude') +
      ' (<a href="#" data-go="settings">바꾸기</a>)</p>' +
      '<div class="actions">' + (st.busy
        ? '<button class="btn" type="button" disabled>만드는 중…</button><button class="btn danger" type="button" id="rs-stop">⏹ 중단</button>'
        : '<button class="btn" type="button" id="rs-run"' + (llmReady() ? '' : ' disabled') + '>' + (saved ? '다시 만들기' : '만들기') + '</button>') + '</div>' +
      (!llmReady() ? '<p class="notice">설정에서 AI 모델을 먼저 골라주세요.</p>' : '') +
      (st.error ? '<p class="notice">' + esc(st.error) + '</p>' : '');
    if (st.busy) {
      h += '<p class="small" id="rs-think">' + (st.reasoning ? '🧠 모델이 깊게 생각하는 중… (' + st.reasoning + '자 추론)' : '') + '</p>' +
        '<pre class="out" id="rs-live">' + esc(st.raw || '') + '</pre>';
    } else if (saved && saved.posts && saved.posts.length) {
      const lim = (F.RS_PLATFORMS[saved.platform] || F.RS_PLATFORMS.threads).limit;
      h += '<div class="quote-head" style="margin-top:14px"><span class="small muted">' + saved.posts.length + '개 · ' +
        esc((F.RS_TONES[saved.tone] || {}).label || '') + ' · ' + esc(saved.platform === 'x' ? 'X' : 'Threads') + '</span>' +
        '<button class="btn small" type="button" data-rscopy="all">전체 복사</button></div>' +
        saved.posts.map((p, i) => {
          const n = Array.from(p).length;
          return '<div class="scene"><div class="quote-head"><span class="small ' + (n > lim ? 'over' : 'muted') + '" id="rs-count-' + i + '">' + (i + 1) + '/' + saved.posts.length + ' · ' + n + '/' + lim + '자' + (n > lim ? ' · 너무 길어요' : '') + '</span>' +
            '<button class="btn small" type="button" data-rscopy="' + i + '">복사</button></div>' +
            '<textarea class="rs-post" data-rspost="' + i + '">' + esc(p) + '</textarea></div>';
        }).join('');
    }
    return h;
  }

  function bindRestyle(book, entry) {
    const ta = document.getElementById('rs-target');
    if (ta) ta.addEventListener('input', e => setRs({ target: e.target.value }));
    app.querySelectorAll('[data-rs]').forEach(b => b.addEventListener('click', () => { setRs({ [b.dataset.rs]: b.dataset.v }); render(); }));
    const run = document.getElementById('rs-run');
    if (run) run.addEventListener('click', async () => {
      const o = rsOpts();
      if (!o.target.trim() && !confirm('목표 독자를 비워두고 만들까요?')) return;
      const ctrl = new AbortController();
      view.rs = { busy: true, raw: '', reasoning: 0, ctrl };
      render();
      try {
        const mod = await import('./proofread.js?v=' + APP_VERSION);
        const cfg = Object.assign({}, llm(), { claudeKey: settings.claudeKey });
        const text = await mod.generateText(cfg, F.restyleMessages(book, entry, o), {
          temperature: 0.7, signal: ctrl.signal,
          onText: tx => { view.rs.raw = tx; const el = document.getElementById('rs-live'); if (el) { el.textContent = tx; el.scrollTop = el.scrollHeight; } },
          onReasoning: n => { view.rs.reasoning = n; const el = document.getElementById('rs-think'); if (el) el.textContent = '🧠 모델이 깊게 생각하는 중… (' + n + '자 추론)'; }
        });
        const posts = F.parsePosts(text);
        if (!posts.length) throw new Error('모델이 빈 답을 줬어요. 다시 만들어 주세요.');
        entry.restyled = { platform: o.platform, format: o.format, tone: o.tone, target: o.target, posts, at: new Date().toISOString() };
        saveBook(book);
        view.rs = {};
      } catch (e) {
        view.rs = { error: e.name === 'AbortError' ? '만들기를 중단했어요.' : (e.message || String(e)) };
      }
      if (view.name === 'export') render();
    });
    const stop = document.getElementById('rs-stop');
    if (stop) stop.addEventListener('click', () => { if (view.rs && view.rs.ctrl) view.rs.ctrl.abort(); });
    const saved = entry.restyled;
    if (!saved) return;
    const lim = (F.RS_PLATFORMS[saved.platform] || F.RS_PLATFORMS.threads).limit;
    app.querySelectorAll('[data-rspost]').forEach(el => el.addEventListener('input', () => {
      const i = Number(el.dataset.rspost);
      saved.posts[i] = el.value;
      const n = Array.from(el.value).length;
      const c = document.getElementById('rs-count-' + i);
      if (c) { c.textContent = (i + 1) + '/' + saved.posts.length + ' · ' + n + '/' + lim + '자' + (n > lim ? ' · 너무 길어요' : ''); c.className = 'small ' + (n > lim ? 'over' : 'muted'); }
      saveBook(book, { quiet: true });
    }));
    app.querySelectorAll('[data-rscopy]').forEach(b => b.addEventListener('click', async () => {
      const k = b.dataset.rscopy;
      const text = k === 'all' ? saved.posts.join('\n\n\n') : saved.posts[Number(k)];
      try { await navigator.clipboard.writeText(text); } catch (e) {
        const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
      }
      const old = b.textContent; b.textContent = '복사됨'; setTimeout(() => { b.textContent = old; }, 1200);
    }));
  }

  function renderExport() {
    const book = books[view.bookId];
    if (!book || book.trashedAt) { go({ name: 'list' }); return; }
    const entry = getEntry(book, view.date);
    const tab = view.tab || 'blog';
    const opts = { intro: state.intro, outro: state.outro };
    const tabs = [['restyle', '✨ 타깃 맞춤 재구성'], ['blog', '네이버 블로그'], ['threads', 'Threads'], ['long', '롱폼 대본'], ['short', '쇼츠·릴스 대본']];
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
    } else if (tab === 'restyle') {
      body = restyleHtml(entry);
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
      '<p class="muted small">' + F.sessionNumber(book, view.date) + '번째 날 · ' + fmtDate(view.date) + ' 기록만 썼어요 · 내가 쓴 문장은 그대로 두고 순서와 형식만 바꿨어요.</p>' +
      (entry && F.hasContent(entry) ? proofCardHtml() : '') +
      '<div class="date-chips">' + tabs.map(([k, l]) => '<button type="button" class="chip' + (k === tab ? ' on' : '') + '" data-tab="' + k + '">' + l + '</button>').join('') + '</div>' +
      '<div class="card">' + body + '</div>';
    document.getElementById('back').addEventListener('click', () => go({ name: 'book', bookId: book.id, date: view.date }));
    app.querySelectorAll('[data-tab]').forEach(el => el.addEventListener('click', () => { view.tab = el.dataset.tab; render(); }));
    app.querySelectorAll('[data-qpick]').forEach(el => el.addEventListener('click', () => { view.qi = Number(el.dataset.qpick); render(); }));
    if (entry && F.hasContent(entry)) bindProof(book, entry);
    if (tab === 'restyle' && entry && F.hasContent(entry)) bindRestyle(book, entry);
    bindCopy();
  }

  function renderDayExport() {
    const date = view.date || todayStr();
    const items = Object.values(books)
      .filter(book => !book.trashedAt)
      .map(b => ({ book: b, entry: getEntry(b, date) }))
      .filter(it => it.entry && F.hasContent(it.entry))
      .sort((a, b) => (a.book.startDate || '').localeCompare(b.book.startDate || ''));
    app.innerHTML =
      '<button class="back" type="button" id="back">← 책 목록</button>' +
      '<h1>하루 롱폼 대본</h1>' +
      '<div class="date-bar"><input type="date" id="pick-date" value="' + esc(date) + '" aria-label="날짜"></div>' +
      '<p class="muted small">' + fmtDate(date) + '에 기록한 ' + items.length + '권을 한 영상으로 묶었어요.</p>' +
      '<div class="card">' + (items.length ? scriptHtml(F.dayLongScript(items, { intro: state.intro, outro: state.outro }), 'o-day') :
        '<div class="empty">이 날 기록한 책이 없어요.</div>') + '</div>';
    document.getElementById('back').addEventListener('click', () => go({ name: 'list' }));
    document.getElementById('pick-date').addEventListener('change', e => { if (e.target.value) go({ name: 'dayexport', date: e.target.value }); });
    bindCopy();
  }

  function renderRecovery() {
    const section = document.getElementById('recovery');
    if (!section) return;
    const conflicts = Object.entries(sync.conflicts);
    const trash = Object.values(books).filter(book => book.trashedAt);
    section.innerHTML = '<div class="card"><h2>동기화 충돌</h2>' +
      (conflicts.length ? '<p class="small">같은 항목이 두 기기에서 바뀌었어요. 겹치지 않는 변경은 함께 보존돼요. 원본 두 버전은 백업 파일로 저장할 수 있어요.</p>' :
        '<p class="small muted">해결할 충돌이 없어요.</p>') +
      conflicts.map(([id, conflict]) =>
        '<details><summary>' + esc(books[id]?.title || id) + ' · 변경 비교</summary>' +
        '<p class="small">겹친 항목: ' + esc(conflict.fields.join(', ')) + '</p>' +
        '<h3>이 기기 기록</h3><textarea readonly aria-label="이 기기 기록">' + esc(JSON.stringify(books[id], null, 2)) + '</textarea>' +
        '<h3>GitHub 기록</h3><textarea readonly aria-label="GitHub 기록">' + esc(JSON.stringify(conflict.remote.book, null, 2)) + '</textarea>' +
        '<div class="actions"><button class="btn small" type="button" data-conflict="' + esc(id) + '" data-choice="local">겹친 항목은 이 기기 버전 사용</button>' +
        '<button class="btn ghost small" type="button" data-conflict="' + esc(id) + '" data-choice="remote">겹친 항목은 GitHub 버전 사용</button></div></details>').join('') +
      '</div><div class="card"><h2>휴지통</h2>' +
      (trash.length ? trash.map(book => '<p>' + esc(book.title) +
        ' <button class="btn ghost small" type="button" data-restore="' + esc(book.id) + '">복원</button></p>').join('') :
        '<p class="small muted">휴지통이 비어 있어요.</p>') + '</div>';

    section.querySelectorAll('[data-restore]').forEach(button => button.addEventListener('click', () => {
      const book = books[button.dataset.restore];
      delete book.trashedAt;
      saveBook(book);
      renderRecovery();
    }));
    section.querySelectorAll('[data-conflict]').forEach(button => button.addEventListener('click', () => {
      const id = button.dataset.conflict;
      const conflict = sync.conflicts[id];
      if (!conflict || syncing || configuring) return;
      const { remote } = conflict;
      const merged = mergeValue(sync.bases[id], books[id], remote.book, [], button.dataset.choice);
      sync.shas[id] = remote.sha;
      sync.bases[id] = remote.book;
      delete sync.conflicts[id];
      saveBook(merged);
      renderRecovery();
    }));
  }

  async function changeConnection(account) {
    if (syncing || configuring) { setStatus('동기화가 끝난 뒤 다시 눌러주세요.'); return; }
    if (!account.owner || !account.repo || !account.token ||
        !/^[a-z\d-]+$/i.test(account.owner) || !/^[a-z\d_.-]+$/i.test(account.repo) ||
        account.repo === '.' || account.repo === '..') {
      setStatus('GitHub 아이디, 저장소 이름, 토큰을 확인해 주세요.', true);
      return;
    }
    configuring = true;
    setStatus('비공개 저장소인지 확인 중…');
    try {
      const repoId = await verifyPrivateRepo(account);
      const key = targetKey(account.owner, account.repo);
      const current = state.profiles[key];
      if (current?.repoId != null && current.repoId !== repoId) throw new Error('기록 저장소가 바뀌었어요.');
      const next = current || (state.active === '' ? state.profiles[''] : profile());
      if (!current && state.active === '') {
        Object.keys(next.books).forEach(id => { next.sync.dirty[id] = true; });
      }
      const previousState = state;
      state = { ...state, active: key, profiles: { ...state.profiles, [key]: { ...next, repoId } } };
      if (state.active !== previousState.active && previousState.active === '' && !current) delete state.profiles[''];
      if (!persist()) { state = previousState; return; }
      ({ books, sync } = state.profiles[key]);
      settings = { ...account, claudeKey: settings.claudeKey };
      if (view.name === 'settings') renderSettings();
      else if (previousState.active !== state.active) go({ name: 'list' });
    } catch (e) {
      setStatus('연결 실패 · ' + e.message, true);
      return;
    } finally {
      configuring = false;
    }
    await pullAll();
  }

  function renderSettings() {
    app.innerHTML =
      '<button class="back" type="button" id="back">← 책 목록</button>' +
      '<h1>설정</h1>' +
      '<div class="card"><h2>GitHub 연결 (기기 간 동기화)</h2>' +
      '<p class="small muted">기록은 비공개 저장소의 <code>books/</code> 폴더에 저장돼요. 저장소를 바꾸면 해당 저장소의 기록이 열려요. 토큰은 페이지를 닫거나 새로 열면 다시 입력해요.</p>' +
      '<label for="s-owner">GitHub 아이디</label><input id="s-owner" type="text" autocapitalize="off" autocomplete="off" value="' + esc(settings.owner) + '">' +
      '<label for="s-repo">기록 저장소 이름</label><input id="s-repo" type="text" autocapitalize="off" autocomplete="off" value="' + esc(settings.repo) + '">' +
      '<label for="s-token">토큰 (fine-grained personal access token)</label><input id="s-token" type="password" autocomplete="off">' +
      '<p class="small muted">토큰 만들기: GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token. ' +
      'Repository access는 기록 저장소 <strong>하나만</strong> 고르고, Permissions에서 <strong>Contents: Read and write</strong>만 켜요.</p>' +
      '<div class="actions"><button class="btn" id="s-save" type="button">저장하고 동기화</button>' +
      '<button class="btn ghost" id="s-sync" type="button">지금 동기화</button>' +
      (settings.token ? '<button class="btn danger" id="s-forget" type="button">이 기기에서 토큰 지우기</button>' : '') + '</div>' +
      '</div>' +
      (() => {
        const l = llm();
        const isO = l.provider === 'ollama', isL = l.provider === 'lmstudio';
        const local = (urlId, urlVal, modelId, modelVal, ph, note) =>
          '<p class="small muted">' + note + '</p>' +
          '<label for="' + urlId + '">서버 주소</label><input id="' + urlId + '" type="text" autocapitalize="off" value="' + esc(urlVal) + '">' +
          '<label for="' + modelId + '">모델</label>' +
          '<div class="date-bar"><input id="' + modelId + '" type="text" autocapitalize="off" style="flex:1" placeholder="' + ph + '" value="' + esc(modelVal) + '">' +
          '<button class="btn ghost small" type="button" id="s-olist">모델 목록 불러오기</button></div>' +
          '<div id="s-olist-out" class="date-chips"></div>';
        return '<div class="card"><h2>맞춤법·문맥 다듬기</h2>' +
          '<p class="small muted">포스팅용 글 화면에서 오타와 어색한 곳을 제안받을 때 쓸 AI를 골라요.</p>' +
          '<div class="seg" id="s-provider">' +
          '<button type="button" data-v="lmstudio" class="' + (isL ? 'on' : '') + '">LM Studio</button>' +
          '<button type="button" data-v="ollama" class="' + (isO ? 'on' : '') + '">Ollama</button>' +
          '<button type="button" data-v="claude" class="' + (!isO && !isL ? 'on' : '') + '">Claude</button></div>' +
          (isL
            ? local('s-ourl', l.lmUrl, 's-omodel', l.lmModel, '예: google/gemma-4-e2b',
                '내 컴퓨터의 LM Studio를 써요. 기록이 밖으로 나가지 않고 요금도 없어요. LM Studio Developer 탭에서 서버를 켜고, 서버 설정의 <strong>Enable CORS</strong>를 켜주세요. 그 컴퓨터에서만 돼요.')
            : isO
            ? local('s-ourl', l.ollamaUrl, 's-omodel', l.ollamaModel, '예: gemma3n:e4b',
                '내 컴퓨터의 Ollama를 써요. OLLAMA_ORIGINS 설정이 필요해요 (README 참고). 그 컴퓨터에서만 돼요.')
            : '<p class="small muted">GitHub 토큰처럼 화면이 열려 있는 동안만 기억하고 저장하지 않아요. 쓴 만큼 Anthropic에 요금이 나가요.</p>' +
              '<label for="s-claude">Claude API 키</label><input id="s-claude" type="password" autocomplete="off" placeholder="sk-ant-..." value="' + esc(settings.claudeKey) + '">' +
              '<p class="small muted">키 만들기: platform.claude.com → API Keys → Create Key. 결제 수단 등록이 필요해요.</p>') +
          '</div>';
      })() +
      '<div class="card"><h2>내 인사말</h2>' +
      '<p class="small muted">포스팅용 글과 영상 대본의 시작과 끝에 그대로 들어가요. 비워두면 넣지 않아요. 이 기기에만 저장돼요.</p>' +
      '<label for="s-intro">영상 시작 인사</label><textarea id="s-intro" style="min-height:60px" placeholder="예: 오늘도 읽고 버틴 하루, 기록을 나눠요.">' + esc(state.intro) + '</textarea>' +
      '<label for="s-outro">마무리 인사 (블로그·영상 끝)</label><textarea id="s-outro" style="min-height:60px">' + esc(state.outro) + '</textarea>' +
      '</div>' +
      '<div class="card"><h2>백업</h2>' +
      '<p class="small muted">모든 기록을 파일 하나로 내려받거나, 백업 파일에서 불러와요.</p>' +
      '<div class="actions"><button class="btn ghost" id="b-export" type="button">백업 내려받기</button>' +
      '<label class="btn ghost" style="margin:0;color:var(--accent)">백업 불러오기<input id="b-import" type="file" accept="application/json" hidden></label></div>' +
      '</div><div id="recovery"></div>';
    document.getElementById('back').addEventListener('click', () => go({ name: 'list' }));
    document.getElementById('s-save').addEventListener('click', () => {
      const owner = document.getElementById('s-owner').value.trim();
      const repo = document.getElementById('s-repo').value.trim();
      const token = document.getElementById('s-token').value.trim() ||
        (targetKey(owner, repo) === state.active ? settings.token : '');
      changeConnection({ owner, repo, token });
    });
    document.getElementById('s-sync').addEventListener('click', () => pullAll());
    ['intro', 'outro'].forEach(k => document.getElementById('s-' + k).addEventListener('input', e => {
      state[k] = e.target.value; persist();
    }));
    const setLlm = patch => { state.llm = Object.assign(llm(), patch); persist(); };
    app.querySelectorAll('#s-provider button').forEach(b => b.addEventListener('click', () => { setLlm({ provider: b.dataset.v }); renderSettings(); }));
    const sc = document.getElementById('s-claude');
    if (sc) sc.addEventListener('input', e => {
      settings.claudeKey = e.target.value.trim(); // 토큰처럼 화면이 열려 있는 동안만 기억한다
    });
    const isLm = () => llm().provider === 'lmstudio';
    const ourl = document.getElementById('s-ourl');
    if (ourl) ourl.addEventListener('input', e => setLlm(isLm() ? { lmUrl: e.target.value.trim() } : { ollamaUrl: e.target.value.trim() }));
    const omodel = document.getElementById('s-omodel');
    if (omodel) omodel.addEventListener('input', e => setLlm(isLm() ? { lmModel: e.target.value.trim() } : { ollamaModel: e.target.value.trim() }));
    const olist = document.getElementById('s-olist');
    if (olist) olist.addEventListener('click', async () => {
      const out = document.getElementById('s-olist-out');
      out.innerHTML = '<span class="small muted">불러오는 중…</span>';
      try {
        const mod = await import('./proofread.js?v=' + APP_VERSION);
        const cur = isLm() ? llm().lmModel : llm().ollamaModel;
        const names = isLm() ? await mod.lmstudioModels(llm().lmUrl) : await mod.ollamaModels(llm().ollamaUrl);
        out.innerHTML = names.length
          ? names.map(n => '<button type="button" class="chip' + (n === cur ? ' on' : '') + '" data-model="' + esc(n) + '">' + esc(n) + '</button>').join('')
          : '<span class="small muted">' + (isLm() ? 'LM Studio에 받아둔 모델이 없어요.' : '설치된 모델이 없어요. 터미널에서 ollama pull 로 받아주세요.') + '</span>';
        out.querySelectorAll('[data-model]').forEach(c => c.addEventListener('click', () => {
          setLlm(isLm() ? { lmModel: c.dataset.model } : { ollamaModel: c.dataset.model }); omodel.value = c.dataset.model;
          out.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c));
        }));
      } catch (e) {
        out.innerHTML = '<p class="notice">' + esc(e.message) + '</p>';
      }
    });
    const forget = document.getElementById('s-forget');
    if (forget) forget.addEventListener('click', () => {
      if (syncing || configuring) { setStatus('동기화가 끝난 뒤 다시 눌러주세요.'); return; }
      if (!confirm('이 기기에서 토큰을 지울까요? 기록은 남아 있어요.')) return;
      settings.token = '';
      if (persist()) setStatus('이 기기에만 저장');
      render();
    });
    document.getElementById('b-export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), books, conflicts: sync.conflicts }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'reading-notes-backup-' + todayStr() + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    document.getElementById('b-import').addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      const previousProfile = state.active;
      try {
        const data = JSON.parse(await file.text());
        if (previousProfile !== state.active || syncing || configuring) return;
        if (!data.books || typeof data.books !== 'object' || Array.isArray(data.books)) throw new Error('책 목록이 없어요.');
        const entries = Object.entries(data.books);
        entries.forEach(([id, book]) => validateBook(book, id));
        const additions = entries.filter(([id]) => !Object.hasOwn(books, id));
        if (!confirm(additions.length + '권을 불러올까요? 이미 있는 책 ' + (entries.length - additions.length) + '권은 그대로 둬요.')) return;
        additions.forEach(([id, book]) => {
          books[id] = book;
          sync.dirty[id] = true;
        });
        if (!persist()) return;
        scheduleSync();
        alert('불러왔어요.'); go({ name: 'list' });
      } catch (err) { alert('백업 파일을 읽지 못했어요: ' + err.message); }
    });
    renderRecovery();
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
  window.addEventListener('beforeunload', event => {
    if (!storageFailed) return;
    event.preventDefault();
    event.returnValue = '';
  });

  render();
  if (persist()) {
    if (ghReady()) pullAll();
    else setStatus('이 기기에만 저장');
  }
})();
