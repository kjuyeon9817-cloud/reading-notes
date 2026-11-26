/* 하루 기록 → 채널별 글.
 * 원칙: 내가 쓴 문장은 한 글자도 바꾸지 않는다. 순서, 제목, 나누기만 한다.
 * 브라우저(window.ReadingFormats)와 Node(require) 둘 다에서 쓴다. 4단계 자동 업로드도 이 파일을 쓴다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReadingFormats = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const THREADS_LIMIT = 500;     // Threads 게시물 1개 글자 수 제한
  const CHARS_PER_SEC = 5;       // 소리 내어 읽는 속도 대략값 (사람마다 다름)
  const SHORT_MAX_SEC = 60;

  function parseDay(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function dayNumber(book, date) { return Math.round((parseDay(date) - parseDay(book.startDate)) / 86400000) + 1; }
  // 이 책을 기록한 날 중 몇 번째 날인지 (건너뛴 날은 세지 않음)
  function sessionNumber(book, date) {
    const ds = new Set((book.entries || []).filter(e => e.date <= date && hasContent(e)).map(e => e.date));
    ds.add(date);
    return ds.size;
  }
  function fmtDate(s) {
    const d = parseDay(s);
    return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
  }
  function has(s) { return !!(s && String(s).trim()); }
  function t(s) { return String(s || '').trim(); }
  function tag(s) { return '#' + t(s).replace(/[\s,·]+/g, ''); }

  function isFirstEntry(book, entry) {
    const filled = (book.entries || []).filter(e => e.date <= entry.date && hasContent(e));
    return !filled.length || filled[0].date === entry.date;
  }
  function hasContent(e) {
    return has(e.summary) || (e.quotes || []).some(q => has(q.text)) || (e.applications || []).some(a => has(a.text));
  }
  // 이 기록 바로 전 날의 실천 결과 (체크한 것만)
  function previousChecks(book, entry) {
    const prev = (book.entries || []).filter(e => e.date < entry.date && hasContent(e)).pop();
    if (!prev) return null;
    const items = (prev.applications || []).filter(a => has(a.text) && a.practiced !== null && a.practiced !== undefined);
    return items.length ? { date: prev.date, items: items } : null;
  }
  function quotes(entry) { return (entry.quotes || []).filter(q => has(q.text)); }
  function apps(entry) { return (entry.applications || []).filter(a => has(a.text)); }
  function tocTitle(book, q) { const x = q && q.tocId ? (book.toc || []).find(c => c.id === q.tocId) : null; return x ? t(x.title) : ''; }

  // ---------- 오늘의 원고 ----------
  // 기록(나를 위한 메모)과 따로, 보는 사람을 위해 내가 다시 쓴 3~5줄. 하나라도 적었으면 원고를 쓴다.
  // 하루에 원고 여러 개 (entry.drafts). 예전 하나짜리(entry.draft)도 읽는다.
  function draftList(entry) {
    if (!entry) return [];
    if (Array.isArray(entry.drafts)) return entry.drafts;
    return entry.draft ? [Object.assign({ id: 'd0' }, entry.draft)] : [];
  }
  function filledDraft(d) { return !!d && (has(d.hook) || has(d.story) || has(d.action) || has(d.ask)); }
  function draftOf(entry, id) {
    if (id === 'none') return null;
    const list = draftList(entry).filter(filledDraft);
    const d = (id && list.find(x => x.id === id)) || list[0];
    if (!d) return null;
    const qs = quotes(entry);
    const ids = Array.isArray(d.starIds) ? d.starIds : (d.starId ? [d.starId] : []);
    const ql = ids.map(i => qs.find(q => q.id === i)).filter(Boolean);
    return { id: d.id, theme: t(d.theme), hook: t(d.hook), story: t(d.story), action: t(d.action), ask: t(d.ask), quotes: ql, quote: ql[0] || null };
  }
  function draftSeconds(entry, id) {
    const d = draftOf(entry, id);
    if (!d) return 0;
    const n = [d.hook, d.story, d.action, d.ask].filter(Boolean).length + d.quotes.length;
    return seconds([d.hook, d.quotes.map(q => q.text).join(' '), d.story, d.action, d.ask].join(' ')) + 2 * n;
  }
  function hashtags(book, extra) {
    const tags = ['#독서노트', '#매일독서', tag(book.title)];
    if (has(book.author)) t(book.author).split(/\s*,\s*/).forEach(a => tags.push(tag(a)));
    if (has(book.topic)) tags.push(tag(book.topic));
    (extra || []).forEach(x => tags.push(x));
    return Array.from(new Set(tags)).join(' ');
  }
  function checkLine(a) {
    if (a.practiced) return '✅ ' + t(a.text) + (has(a.result) ? '\n→ ' + t(a.result) : '');
    return '⬜ ' + t(a.text) + (has(a.reason) ? '\n→ 못 한 이유: ' + t(a.reason) : '');
  }

  // ---------- 네이버 블로그 ----------
  function blog(book, entry, opts) {
    opts = opts || {};
    const n = sessionNumber(book, entry.date);
    const title = '[독서노트 ' + n + '번째 날] ' + t(book.title) + (has(book.author) ? ' - ' + t(book.author) : '');
    const dr = draftOf(entry, opts.draftId);
    if (dr) return draftBlog(book, entry, dr, opts);
    const out = [];
    out.push('📖 ' + t(book.title));
    out.push('저자: ' + (t(book.author) || '-') + ' · ' + (book.format === 'ebook' ? '전자책' : '종이책'));
    out.push('읽기 시작: ' + fmtDate(book.startDate) + ' · ' + n + '번째 날 (' + fmtDate(entry.date) + ')' + (has(entry.pages) ? ' · ' + t(entry.pages) + '까지' : ''));
    out.push('');
    if (has(book.whyReading) && (isFirstEntry(book, entry) || opts.alwaysWhy)) {
      out.push('■ 이 책을 읽게 된 이유', '', t(book.whyReading), '');
    }
    const prev = previousChecks(book, entry);
    if (prev) {
      out.push('■ 어제 다짐한 것, 해봤나요?', '');
      prev.items.forEach(a => out.push(checkLine(a), ''));
    }
    const qs = quotes(entry);
    if (qs.length) {
      out.push('■ 오늘 마음에 남은 문장', '');
      qs.forEach(q => {
        const where = [tocTitle(book, q), t(q.page)].filter(Boolean).join(' · ');
        out.push('" ' + t(q.text) + ' "' + (where ? ' (' + where + ')' : ''));
        if (has(q.reason)) out.push('', '고른 이유: ' + t(q.reason));
        out.push('');
      });
    }
    if (has(entry.summary)) out.push('■ 오늘 읽은 내용', '', t(entry.summary), '');
    const as = apps(entry);
    if (as.length) {
      out.push('■ 내 삶에 적용해 보기', '');
      as.forEach((a, i) => out.push((i + 1) + '. ' + t(a.text)));
      out.push('', '내일 해봤는지 다시 적을게요.', '');
    }
    if (has(opts.outro)) out.push(t(opts.outro), '');
    out.push(hashtags(book));
    return { title: title, body: out.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
  }

  // 원고로 쓰는 블로그: 주제 하나, 문장 1~2개, 내 이야기 중심
  function draftBlog(book, entry, dr, opts) {
    const n = sessionNumber(book, entry.date);
    const head = dr.theme || dr.hook || t(book.title);
    const title = head + ' | 『' + t(book.title) + '』 독서노트 ' + n + '번째 날';
    const out = [];
    if (dr.hook) out.push(dr.hook, '');
    dr.quotes.forEach(q => {
      const where = [tocTitle(book, q), t(q.page)].filter(Boolean).join(' · ');
      out.push('" ' + t(q.text) + ' "' + (where ? ' (' + where + ')' : ''), '');
    });
    if (dr.story) out.push(dr.story, '');
    if (dr.action) out.push('■ 오늘 해볼 것 하나', '', dr.action, '');
    if (dr.ask) out.push(dr.ask, '');
    out.push('─', '📖 ' + t(book.title) + (has(book.author) ? ' · ' + t(book.author) : '') + ' · ' + n + '번째 날 (' + fmtDate(entry.date) + ')', '');
    if (has(opts.outro)) out.push(t(opts.outro), '');
    out.push(hashtags(book, dr.theme ? [tag(dr.theme)] : []));
    return { title: title, body: out.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
  }

  // ---------- Threads (500자씩 이어지는 글) ----------
  function splitToLimit(text, limit) {
    if (text.length <= limit) return [text];
    const parts = [];
    let rest = text;
    while (rest.length > limit) {
      let cut = -1;
      for (const sep of ['\n\n', '\n', '. ', '다. ', '요. ', ' ']) {
        const i = rest.lastIndexOf(sep, limit - 1);
        if (i > limit * 0.5) { cut = i + sep.length; break; }
      }
      if (cut < 0) cut = limit;
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) parts.push(rest);
    return parts;
  }
  function threads(book, entry, opts) {
    const n = sessionNumber(book, entry.date);
    const blocks = [];
    const dr = draftOf(entry, opts && opts.draftId);
    if (dr) {
      // 원고가 있으면 원고만으로 짧고 깔끔하게
      let head = (dr.hook ? dr.hook + '\n\n' : '') + '📖 ' + t(book.title) + ' · ' + n + '번째 날';
      dr.quotes.forEach(q => { head += '\n\n"' + t(q.text) + '"'; });
      blocks.push(head);
      if (dr.story) blocks.push(dr.story);
      if (dr.action) blocks.push('오늘 해볼 것 하나\n\n' + dr.action);
      if (dr.ask) blocks.push(dr.ask);
      blocks[blocks.length - 1] += '\n\n' + hashtags(book).split(' ').slice(0, 3).join(' ');
      const out = [];
      blocks.forEach(b => splitToLimit(b, THREADS_LIMIT).forEach(p => out.push(p)));
      return out;
    }
    const qs = quotes(entry);
    let head = '📖 ' + t(book.title) + ' · ' + n + '번째 날';
    if (qs.length) head += '\n\n"' + t(qs[0].text) + '"' + (has(qs[0].reason) ? '\n\n' + t(qs[0].reason) : '');
    else if (has(entry.summary)) head += '\n\n' + t(entry.summary);
    blocks.push(head);
    qs.slice(1).forEach(q => blocks.push('"' + t(q.text) + '"' + (has(q.reason) ? '\n\n' + t(q.reason) : '')));
    if (qs.length && has(entry.summary)) blocks.push('오늘 읽은 내용\n\n' + t(entry.summary));
    const as = apps(entry);
    if (as.length) blocks.push('내 삶에 적용해 보기\n\n' + as.map((a, i) => (i + 1) + '. ' + t(a.text)).join('\n'));
    const prev = previousChecks(book, entry);
    if (prev) blocks.push('어제 다짐한 것\n\n' + prev.items.map(checkLine).join('\n\n'));
    const tagLine = hashtags(book).split(' ').slice(0, 3).join(' ');
    blocks[blocks.length - 1] += '\n\n' + tagLine;
    const posts = [];
    blocks.forEach(b => splitToLimit(b, THREADS_LIMIT).forEach(p => posts.push(p)));
    return posts;
  }

  // ---------- 영상 대본 ----------
  // 각 장면: say = 내 목소리로 읽을 말, screen = 화면에 띄울 글
  function seconds(text) { return Math.round(t(text).replace(/\s+/g, '').length / CHARS_PER_SEC); }

  function longScript(book, entry, opts) {
    opts = opts || {};
    const n = sessionNumber(book, entry.date);
    const scenes = [];
    const dr = draftOf(entry, opts.draftId);
    if (dr && dr.hook) scenes.push({ part: '첫 마디', screen: dr.hook, say: dr.hook });
    scenes.push({ part: '시작', screen: t(book.title) + '\n' + (t(book.author) || '') + '\n' + n + '번째 날', say: has(opts.intro) ? t(opts.intro) : '' });
    if (has(book.whyReading) && isFirstEntry(book, entry)) scenes.push({ part: '읽게 된 이유', screen: '이 책을 읽게 된 이유', say: t(book.whyReading) });
    const prev = previousChecks(book, entry);
    if (prev) prev.items.forEach(a => scenes.push({
      part: '어제의 실천', screen: (a.practiced ? '✅ ' : '⬜ ') + t(a.text),
      say: a.practiced ? t(a.result) : t(a.reason)
    }));
    quotes(entry).forEach((q, i) => {
      const where = [tocTitle(book, q), t(q.page)].filter(Boolean).join(' · ');
      scenes.push({ part: tocTitle(book, q) || ('문장 ' + (i + 1)), screen: t(q.text) + (where ? '\n(' + where + ')' : ''), say: t(q.text) });
      if (has(q.reason)) scenes.push({ part: '문장 ' + (i + 1) + '을 고른 이유', screen: '', say: t(q.reason) });
    });
    if (dr && dr.story) scenes.push({ part: '내 이야기', screen: '', say: dr.story });
    if (has(entry.summary)) scenes.push({ part: '오늘 읽은 내용', screen: '오늘 읽은 내용', say: t(entry.summary) });
    apps(entry).forEach((a, i) => scenes.push({ part: '적용 ' + (i + 1), screen: (i + 1) + '. ' + t(a.text), say: t(a.text) }));
    if (dr && dr.ask) scenes.push({ part: '여러분은요?', screen: dr.ask, say: dr.ask });
    if (has(opts.outro)) scenes.push({ part: '마무리', screen: '', say: t(opts.outro) });
    return withTiming(scenes, 180, 300);
  }

  // 쇼츠·릴스: 문장 하나 + 고른 이유 + 적용 하나. 60초를 넘으면 경고만 한다 (내 문장을 자르지 않음).
  function shortScript(book, entry, opts) {
    opts = opts || {};
    const qi = opts.quoteIndex || 0;
    const n = sessionNumber(book, entry.date);
    const q = quotes(entry)[qi];
    const scenes = [];
    const dr = draftOf(entry, opts.draftId);
    if (dr) {
      scenes.push(dr.hook ? { part: '첫 마디', screen: dr.hook, say: dr.hook } : { part: '첫 화면', screen: t(book.title) + ' · ' + n + '번째 날', say: '' });
      dr.quotes.forEach((q, i) => scenes.push({ part: dr.quotes.length > 1 ? '오늘의 문장 ' + (i + 1) : '오늘의 문장', screen: t(q.text), say: t(q.text) }));
      if (dr.story) scenes.push({ part: '내 이야기', screen: '', say: dr.story });
      if (dr.action) scenes.push({ part: '오늘 해볼 것', screen: dr.action, say: dr.action });
      if (dr.ask) scenes.push({ part: '여러분은요?', screen: dr.ask, say: dr.ask });
      return withTiming(scenes, 0, SHORT_MAX_SEC);
    }
    scenes.push({ part: '첫 화면', screen: t(book.title) + ' · ' + n + '번째 날', say: '' });
    if (q) {
      scenes.push({ part: '문장', screen: t(q.text), say: t(q.text) });
      if (has(q.reason)) scenes.push({ part: '고른 이유', screen: '', say: t(q.reason) });
    } else if (has(entry.summary)) {
      scenes.push({ part: '오늘 읽은 내용', screen: '', say: t(entry.summary) });
    }
    const a = apps(entry)[0];
    if (a) scenes.push({ part: '적용', screen: '오늘의 실천: ' + t(a.text), say: t(a.text) });
    return withTiming(scenes, 0, SHORT_MAX_SEC);
  }

  function withTiming(scenes, minSec, maxSec) {
    scenes.forEach(s => {
      s.sec = seconds(s.say) + 2; // 장면 전환 여유 2초
      // 화면 글을 그대로 읽는 장면이면 한 번만 보여준다
      s.same = !!(s.say && s.screen && s.screen.includes(s.say));
    });
    const total = scenes.reduce((n, s) => n + s.sec, 0);
    let note = '';
    if (total > maxSec) note = '예상 ' + total + '초로 목표(' + maxSec + '초)보다 길어요.';
    else if (minSec && total < minSec) note = '예상 ' + total + '초로 목표(' + minSec + '초 이상)보다 짧아요. 문장이나 정리를 더 적거나, 같은 날 다른 책과 묶어도 돼요.';
    return { scenes: scenes, totalSec: total, note: note };
  }

  // ---------- 어투·목표 독자 맞춤 재구성 (AI에게 줄 지시) ----------
  // 플랫폼마다 글의 생김새가 다르다. multi = 여러 개로 나뉘는 글(스레드·대본 장면)
  const RS_PLATFORMS = {
    blog: { name: '네이버 블로그', limit: 3000, unit: '글', spec: [
      '- 첫 줄에 "제목: (검색하는 사람의 고민이 담긴 제목, 30자 안팎)"을 씁니다.',
      '- 본문 1500~2500자. 소제목 3~4개(■ 로 시작)로 나눕니다.',
      '- 흐름: 독자의 고민에 공감하는 도입 → 이 책을 읽게 된 이유 → 마음에 남은 문장(그대로 인용)과 내 생각 → 오늘 읽은 내용 → 내 삶에 적용할 것 → 독자에게 던지는 질문.',
      '- 처음 보는 사람도 이해하도록 책과 저자를 한두 문장으로 소개합니다(기록 안의 정보만).',
      '- 마지막 줄에 해시태그 5~8개.'] },
    threads: { name: 'Threads', limit: 500, multi: true, unit: '포스트', formats: true, spec: [
      '- 첫 포스트는 스크롤을 멈추게 하는 한 줄로 시작합니다.',
      '- 1~2문장마다 줄을 바꾸고 빈 줄로 나눕니다.',
      '- 마지막 포스트는 댓글을 부르는 질문으로 끝내고, 해시태그는 최대 2개.'] },
    insta: { name: '인스타그램 캡션', limit: 2200, unit: '캡션', spec: [
      '- 첫 줄은 40자 이내의 훅. 피드에서 "더 보기"를 누르게 만드는 문장.',
      '- 짧은 문단 4~6개, 문단 사이 빈 줄. 이모지는 문단 앞에 1개 정도만.',
      '- 마음에 남은 문장 1~2개만 인용하고 내 생각을 붙입니다.',
      '- 끝에서 "저장해두고 다시 꺼내보세요" 같은 저장·공유 유도 한 줄과 질문 하나.',
      '- 마지막에 해시태그 8~12개.'] },
    shorts: { name: '쇼츠·릴스 대본', limit: 120, multi: true, unit: '장면', spec: [
      '- 내 목소리로 읽을 40~55초 대본(말하는 글 전체 220~280자).',
      '- 장면 5~7개. 장면 하나는 한두 문장, 120자 이내.',
      '- 장면1: 2초 안에 멈추게 하는 훅. 장면2~3: 문장 인용 1개와 왜 멈췄는지. 다음: 내 생각·적용. 마지막: 짧은 질문.',
      '- 말로 읽기 쉬운 짧은 문장, 입말로 씁니다.'] },
    longform: { name: '유튜브 롱폼 대본', limit: 400, multi: true, unit: '장면', spec: [
      '- 내 목소리로 읽을 3~5분 대본(말하는 글 전체 900~1400자).',
      '- 장면 10~16개. 장면 하나는 1~3문장, 400자 이내.',
      '- 흐름: 훅(시청자의 고민) → 오늘 책 소개와 읽게 된 이유 → 문장 2~3개 인용과 각각의 내 생각 → 오늘 읽은 내용 → 적용할 것 → 질문과 다음 이야기 예고.',
      '- 말로 읽기 쉬운 입말로 씁니다.'] },
    x: { name: 'X(트위터)', limit: 280, multi: true, unit: '포스트', formats: true, spec: [
      '- 짧고 단단한 문장. 해시태그는 마지막에 최대 2개.'] }
  };
  const RS_FORMATS = { single: { label: '단일 포스트', count: '1개' }, short: { label: '숏 스레드', count: '4~5개' }, long: { label: '롱 스레드', count: '7~9개' } };
  const RS_TONES = {
    viral: { label: '바이럴 후킹', prompt: '바이럴 후킹형 — 강렬한 호기심 유발, 짧고 임팩트 있는 문장, 반전과 넘버링 활용' },
    friendly: { label: '친근·유쾌', prompt: '친근·유쾌형 — 친구에게 말하듯 다정하고 편한 말투, 가벼운 유머, 공감 표현' },
    expert: { label: '전문가', prompt: '전문가형 — 근거를 앞세운 신뢰감 있는 말투, 정확한 용어, 군더더기 없는 설명' },
    direct: { label: '직설', prompt: '직설형 — 돌려 말하지 않는 단호한 문장, 핵심만 짧게, 결론부터' }
  };

  function recordText(book, entry) {
    const lines = ['책: ' + t(book.title) + (has(book.author) ? ' (' + t(book.author) + ')' : '') + ' · 이 책을 읽은 ' + sessionNumber(book, entry.date) + '번째 날'];
    if (has(book.whyReading)) lines.push('', '[이 책을 읽게 된 이유]', t(book.whyReading));
    const prev = previousChecks(book, entry);
    if (prev) {
      lines.push('', '[어제 다짐한 것과 실천 결과]');
      prev.items.forEach(a => lines.push('- ' + t(a.text) + ' → ' + (a.practiced ? '실천함. 달라진 점: ' + (t(a.result) || '(안 적음)') : '못 함. 이유: ' + (t(a.reason) || '(안 적음)'))));
    }
    const qs = quotes(entry);
    if (qs.length) {
      lines.push('', '[책에서 옮긴 문장과 고른 이유]');
      qs.forEach((q, i) => {
        const where = [tocTitle(book, q), t(q.page)].filter(Boolean).join(' · ');
        lines.push((i + 1) + '. "' + t(q.text) + '"' + (where ? ' (' + where + ')' : ''), '   고른 이유: ' + (t(q.reason) || '(안 적음)'));
      });
    }
    if (has(entry.summary)) lines.push('', '[오늘 읽은 내용 정리]', t(entry.summary));
    const as = apps(entry);
    if (as.length) { lines.push('', '[내 삶에 적용할 것]'); as.forEach((a, i) => lines.push((i + 1) + '. ' + t(a.text))); }
    draftList(entry).filter(filledDraft).forEach(d0 => {
      const d = draftOf(entry, d0.id);
      lines.push('', '[내가 쓴 원고' + (d.theme ? ': ' + d.theme : '') + ']');
      if (d.hook) lines.push('첫 한 줄: ' + d.hook);
      if (d.story) lines.push('내 이야기: ' + d.story);
      if (d.action) lines.push('실천: ' + d.action);
      if (d.ask) lines.push('질문: ' + d.ask);
    });
    return lines.join('\n');
  }

  // ---------- 옵시디언·wikiagent용 마크다운 ----------
  // 내가 쓴 문장은 그대로 두고, 제목·머리말(frontmatter)·[[링크]]만 붙인다.
  function safeName(s) { return t(s).replace(/[\\/:*?"<>|#^\[\]]+/g, ' ').replace(/\s+/g, ' ').trim() || '제목 없음'; }
  function yamlStr(s) { return '"' + t(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"'; }
  function markdown(book, entry) {
    const n = sessionNumber(book, entry.date);
    const authors = has(book.author) ? t(book.author).split(/\s*,\s*/).filter(Boolean) : [];
    const tags = ['독서노트', safeName(book.title).replace(/\s+/g, '_')].concat(has(book.topic) ? [t(book.topic).replace(/\s+/g, '_')] : []);
    const L = [];
    L.push('---', 'type: reading-note', 'book: ' + yamlStr(book.title), 'author: ' + yamlStr(book.author),
      'format: ' + (book.format === 'ebook' ? '전자책' : '종이책'), 'topic: ' + yamlStr(book.topic),
      'started: ' + t(book.startDate), 'date: ' + entry.date, 'day: ' + n, 'pages: ' + yamlStr(entry.pages),
      'tags: [' + tags.map(yamlStr).join(', ') + ']', 'source: reading-notes', '---', '');
    L.push('# ' + t(book.title) + ' · ' + n + '번째 날 (' + entry.date + ')', '');
    L.push('책: [[' + safeName(book.title) + ']]' + (authors.length ? ' · 저자: ' + authors.map(a => '[[' + safeName(a) + ']]').join(', ') : '') +
      (has(book.topic) ? ' · 주제: [[' + safeName(book.topic) + ']]' : '') + (has(entry.pages) ? ' · 읽은 곳: ' + t(entry.pages) : ''), '');
    if (has(book.whyReading) && isFirstEntry(book, entry)) L.push('## 이 책을 읽게 된 이유', '', t(book.whyReading), '');
    const prev = previousChecks(book, entry);
    if (prev) {
      L.push('## 지난번 실천 확인 (' + prev.date + ')', '');
      prev.items.forEach(a => L.push('- [' + (a.practiced ? 'x' : ' ') + '] ' + t(a.text) + (a.practiced ? (has(a.result) ? ' → ' + t(a.result) : '') : (has(a.reason) ? ' → 못 한 이유: ' + t(a.reason) : ''))));
      L.push('');
    }
    const qs = quotes(entry);
    if (qs.length) {
      L.push('## 발췌한 문장', '');
      qs.forEach(q => {
        t(q.text).split('\n').forEach(line => L.push('> ' + line));
        const where = [tocTitle(book, q), t(q.page)].filter(Boolean).join(' · ');
        if (where) L.push('> — ' + where);
        L.push('');
        if (has(q.reason)) L.push('**고른 이유:** ' + t(q.reason), '');
      });
    }
    if (has(entry.summary)) L.push('## 오늘 읽은 내용', '', t(entry.summary), '');
    const as = apps(entry);
    if (as.length) {
      L.push('## 현실에 적용하기', '');
      as.forEach(a => L.push('- [' + (a.practiced ? 'x' : ' ') + '] ' + t(a.text) +
        (a.practiced === true && has(a.result) ? ' → ' + t(a.result) : '') + (a.practiced === false && has(a.reason) ? ' → 못 한 이유: ' + t(a.reason) : '')));
      L.push('');
    }
    draftList(entry).filter(filledDraft).forEach((d0, k) => {
      const dr = draftOf(entry, d0.id);
      L.push('## 원고 ' + (k + 1) + (dr.theme ? ': ' + dr.theme : ''), '');
      if (dr.hook) L.push('- 첫 한 줄: ' + dr.hook);
      dr.quotes.forEach(q => L.push('- 문장: "' + t(q.text).replace(/\n/g, ' ') + '"'));
      if (dr.story) L.push('- 내 이야기: ' + dr.story);
      if (dr.action) L.push('- 하나의 실천: ' + dr.action);
      if (dr.ask) L.push('- 마지막 질문: ' + dr.ask);
      L.push('');
    });
    return { fileName: safeName(book.title) + ' - ' + n + '번째 날.md', folder: entry.date, text: L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n' };
  }

  // 원고 코치: 고쳐 쓰지 않고 짚어만 준다
  function coachMessages(book, entry, id) {
    const d = draftList(entry).find(x => x.id === id) || draftList(entry)[0] || {};
    const dq = draftOf(entry, d.id);
    const q = dq && dq.quotes.length ? { text: dq.quotes.map(x => t(x.text)).join('\n/ ') } : null;
    const system = [
      '당신은 짧은 독서 영상(쇼츠·릴스) 원고를 봐주는 코치입니다.',
      '글쓴이는 AI가 대신 써주는 글을 원하지 않습니다. 생각은 글쓴이가 합니다.',
      '',
      '반드시 지킬 것:',
      '- 문장을 고쳐 쓰거나, 바꿀 문장이나 예시 문장을 절대 주지 않습니다.',
      '- 대신 무엇이 아쉬운지와, 글쓴이가 스스로 답해 볼 질문을 줍니다.',
      '- 최대 3가지만, 가장 중요한 것부터. 각 항목은 2문장 이내.',
      '- 각 항목 앞에 어느 칸인지 [첫 한 줄] [오늘의 문장] [내 이야기] [하나의 실천] [마지막 질문] 중 하나를 붙입니다.',
      '- 잘된 점이 있으면 마지막에 한 줄로 짚어줍니다.',
      '',
      '보는 기준: 첫 한 줄은 2초 안에 멈추게 하는가(짧고 구체적인가), 내 이야기에 구체적인 장면이 있는가, 실천은 보는 사람도 오늘 할 수 있을 만큼 작은가, 질문은 댓글로 답하기 쉬운가, 전체가 한 가지 메시지로 모이는가.',
      '인사말 없이 바로 시작합니다.'
    ].join('\n');
    const user = '[책] ' + t(book.title) + '\n\n[주제·제목]\n' + (t(d.theme) || '(비어 있음)') + '\n\n[첫 한 줄]\n' + (t(d.hook) || '(비어 있음)') +
      '\n\n[오늘의 문장]\n' + (q ? t(q.text) : '(고르지 않음)') +
      '\n\n[내 이야기]\n' + (t(d.story) || '(비어 있음)') +
      '\n\n[하나의 실천]\n' + (t(d.action) || '(비어 있음)') +
      '\n\n[마지막 질문]\n' + (t(d.ask) || '(비어 있음)');
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
  }

  // 첫 한 줄(훅) 후보: 포장만 돕는다. 글쓴이가 골라서 자기 말로 고친다.
  function hookMessages(book, entry, id) {
    const d = draftList(entry).find(x => x.id === id) || {};
    const dq = draftOf(entry, d.id);
    const ql = dq ? dq.quotes : [];
    const system = [
      '당신은 짧은 독서 콘텐츠(쇼츠·릴스·블로그)의 첫 문장을 제안하는 편집자입니다.',
      '첫 문장(훅)은 처음 2초 안에 "이건 내 얘기다" 하고 멈추게 만드는 한 줄입니다.',
      '',
      '반드시 지킬 것:',
      '- 후보 3개만, 서로 다른 방식으로: (1) 독자를 부르는 말 "~한 사람이라면" (2) 질문 "왜 ~할까?" (3) 의외의 사실이나 반전.',
      '- 각 25자 안팎, 한 줄. 과장, 낚시, 숫자 지어내기 금지.',
      '- 글쓴이의 제목·문장·이야기 안에 있는 내용만 씁니다. 기록에 없는 경험을 지어내지 않습니다.',
      '- 형식: 1. (후보)\n2. (후보)\n3. (후보)  — 설명이나 인사말 없이.'
    ].join('\n');
    const user = '[책] ' + t(book.title) + '\n[제목·주제] ' + (t(d.theme) || '(없음)') +
      ql.map((q, i) => '\n[문장 ' + (i + 1) + '] ' + t(q.text) + '\n[고른 이유] ' + (t(q.reason) || '(없음)')).join('') +
      '\n[내 이야기] ' + (t(d.story) || '(없음)') + '\n[지금 쓴 첫 한 줄] ' + (t(d.hook) || '(없음)');
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
  }
  function parseHooks(text) {
    return String(text || '').split('\n').map(l => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').replace(/^["“]|["”]$/g, '').trim())
      .filter(l => l && l.length <= 80 && !/^#|후보/.test(l)).slice(0, 3);
  }

  // 주제로 묶기: AI는 묶음과 제목 후보만 제안한다. 본문은 쓰지 않는다.
  function themeMessages(book, entry) {
    const qs = quotes(entry);
    const system = [
      '당신은 독서 콘텐츠 편집자입니다. 한 사람이 오늘 책에서 고른 문장들과, 그 문장을 고른 이유를 받습니다.',
      '할 일: 이 문장들을 사람들이 실제로 고민하고 검색할 만한 주제 2~3개로 묶고, 묶음마다 제목 후보 2개를 제안합니다.',
      '',
      '반드시 지킬 것:',
      '- 본문, 첫 문장, 예시 글은 쓰지 않습니다. 글은 글쓴이가 직접 씁니다.',
      '- 한 묶음에는 문장 1~3개. 모든 문장을 다 쓸 필요는 없습니다.',
      '- 제목은 책 이름이 아니라 독자의 고민이나 질문으로 씁니다(예: "~할 때 덜 상처받는 법", "왜 ~할까?"). 25자 이내.',
      '- 글쓴이가 고른 이유에 이미 들어 있는 질문과 생각을 최대한 살립니다. 기록에 없는 내용을 지어내지 않습니다.',
      '',
      '형식(이 형식만, 인사말 없이):',
      '###THEME###',
      '제목1: (제목 후보)',
      '제목2: (제목 후보)',
      '문장: (문장 번호, 쉼표로. 예: 1, 3)',
      '이유: (왜 이렇게 묶었는지 한 문장)'
    ].join('\n');
    const lines = ['[책] ' + t(book.title) + (has(book.topic) ? ' · 주제: ' + t(book.topic) : '')];
    if (has(book.whyReading)) lines.push('[이 책을 읽게 된 이유] ' + t(book.whyReading));
    qs.forEach((q, i) => lines.push('', '[문장 ' + (i + 1) + '] ' + t(q.text), '[고른 이유] ' + (t(q.reason) || '(없음)')));
    return [{ role: 'system', content: system }, { role: 'user', content: lines.join('\n') }];
  }
  function parseThemes(text, entry) {
    const qs = quotes(entry);
    return String(text || '').split('###THEME###').map(b => {
      const get = k => { const m = b.match(new RegExp(k + '\\s*[:：]\\s*(.+)')); return m ? m[1].replace(/^["“]|["”]$/g, '').trim() : ''; };
      const nums = (get('문장').match(/\d+/g) || []).map(Number).filter(n => n >= 1 && n <= qs.length);
      const titles = [get('제목1'), get('제목2')].filter(Boolean);
      if (!titles.length && !nums.length) return null;
      return { titles, quoteIds: Array.from(new Set(nums)).map(n => qs[n - 1].id).filter(Boolean), nums: Array.from(new Set(nums)), why: get('이유') };
    }).filter(Boolean);
  }

  function restyleMessages(book, entry, o) {
    const p = RS_PLATFORMS[o.platform] || RS_PLATFORMS.threads;
    const f = RS_FORMATS[o.format] || RS_FORMATS.short;
    const tone = RS_TONES[o.tone] || RS_TONES.friendly;
    const count = p.formats ? f.count : null;
    const system = [
      '당신은 한 사람의 독서 기록을 ' + p.name + '에 맞게 처음부터 끝까지 다시 구성하는 편집자입니다.',
      '처음 보는 사람도 자연스럽게 읽고 공감하도록, 그 플랫폼에서 실제로 잘 읽히는 글의 모양으로 만듭니다.',
      '',
      '반드시 지킬 것:',
      '- 재료는 아래 독서 기록뿐입니다. 기록에 없는 경험, 사례, 숫자, 통계, 다른 책·사람의 말을 지어내지 않습니다.',
      '- 글쓴이의 생각, 느낌, 실천 결과가 글의 중심입니다. 일반론으로 바꾸지 않습니다.',
      '- 책에서 옮긴 문장을 쓸 때는 한 글자도 바꾸지 않고 따옴표로 그대로 씁니다.',
      '- 글쓴이 시점(1인칭 "나")으로 씁니다.',
      '- "~에 대해 알아보겠습니다", "결론적으로" 같은 AI 말투를 쓰지 않습니다.',
      '',
      '어투: ' + tone.prompt,
      '',
      p.name + ' 형식:'
    ].concat(p.spec).concat(p.multi ? [
      '- ' + p.unit + ' 하나당 ' + p.limit + '자를 넘기지 않습니다.' + (count ? ' ' + p.unit + ' 개수: ' + count : ''),
      '- 각 ' + p.unit + ' 앞에 ###POST### 를 한 줄로 쓰고, 번호는 붙이지 않습니다. 인사말이나 설명 없이 첫 ###POST### 부터 시작합니다.'
    ] : [
      '- 전체 ' + p.limit + '자를 넘기지 않습니다. 인사말이나 설명 없이 바로 글을 씁니다.'
    ]).join('\n');
    const user = '[목표 독자]\n' + (t(o.target) || '(지정 안 함)') + '\n\n[독서 기록]\n' + recordText(book, entry) +
      '\n\n이 기록으로 목표 독자에게 닿는 ' + p.name + '를 처음부터 끝까지 써주세요.';
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
  }

  function parsePosts(text) {
    const s = String(text || '').trim();
    if (!s) return [];
    let parts = s.split(/#{2,}\s*POST\s*#{2,}/i).map(x => x.trim()).filter(Boolean);
    if (parts.length <= 1) {
      const numbered = s.split(/(?:^|\n)\s*(?:\[\d+\s*\/\s*\d+\]|\d+\s*\/\s*\d*|\d+\.)\s+/).map(x => x.trim()).filter(Boolean);
      if (numbered.length > 1) parts = numbered;
    }
    return (parts.length ? parts : [s]);
  }

  // 같은 날 읽은 여러 권을 하나의 롱폼으로 묶기: items = [{book, entry}]
  function dayLongScript(items, opts) {
    opts = opts || {};
    let scenes = [];
    if (has(opts.intro)) scenes.push({ part: '시작', screen: '', say: t(opts.intro) });
    items.forEach(it => {
      const one = longScript(it.book, it.entry, {}).scenes;
      one[0].part = t(it.book.title);
      scenes = scenes.concat(one);
    });
    if (has(opts.outro)) scenes.push({ part: '마무리', screen: '', say: t(opts.outro) });
    return withTiming(scenes, 180, 300);
  }

  function scriptText(script) {
    return script.scenes.map(s =>
      '[' + s.part + '] 약 ' + s.sec + '초' +
      (s.same ? '\n화면에 띄우고 그대로 읽기: ' + s.screen.replace(/\n/g, ' / ') :
        (s.screen ? '\n화면: ' + s.screen.replace(/\n/g, ' / ') : '') +
        (s.say ? '\n말하기: ' + s.say : ''))
    ).join('\n\n');
  }

  return {
    blog: blog, threads: threads, longScript: longScript, dayLongScript: dayLongScript, hasContent: hasContent, shortScript: shortScript,
    scriptText: scriptText, dayNumber: dayNumber, sessionNumber: sessionNumber, THREADS_LIMIT: THREADS_LIMIT,
    markdown: markdown, draftOf: draftOf, draftList: draftList, themeMessages: themeMessages, hookMessages: hookMessages, parseHooks: parseHooks, parseThemes: parseThemes, draftSeconds: draftSeconds, coachMessages: coachMessages,
    restyleMessages: restyleMessages, parsePosts: parsePosts, RS_PLATFORMS: RS_PLATFORMS, RS_FORMATS: RS_FORMATS, RS_TONES: RS_TONES
  };
});
