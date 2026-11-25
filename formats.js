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
    const n = dayNumber(book, entry.date);
    const title = '[독서노트 ' + n + '일째] ' + t(book.title) + (has(book.author) ? ' - ' + t(book.author) : '');
    const out = [];
    out.push('📖 ' + t(book.title));
    out.push('저자: ' + (t(book.author) || '-') + ' · ' + (book.format === 'ebook' ? '전자책' : '종이책'));
    out.push('읽기 시작: ' + fmtDate(book.startDate) + ' · 오늘 ' + n + '일째' + (has(entry.pages) ? ' · ' + t(entry.pages) + '까지' : ''));
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
        out.push('" ' + t(q.text) + ' "' + (has(q.page) ? ' (' + t(q.page) + ')' : ''));
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
  function threads(book, entry) {
    const n = dayNumber(book, entry.date);
    const blocks = [];
    const qs = quotes(entry);
    let head = '📖 ' + t(book.title) + ' · ' + n + '일째';
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
    const n = dayNumber(book, entry.date);
    const scenes = [];
    scenes.push({ part: '시작', screen: t(book.title) + '\n' + (t(book.author) || '') + '\n' + n + '일째', say: has(opts.intro) ? t(opts.intro) : '' });
    if (has(book.whyReading) && isFirstEntry(book, entry)) scenes.push({ part: '읽게 된 이유', screen: '이 책을 읽게 된 이유', say: t(book.whyReading) });
    const prev = previousChecks(book, entry);
    if (prev) prev.items.forEach(a => scenes.push({
      part: '어제의 실천', screen: (a.practiced ? '✅ ' : '⬜ ') + t(a.text),
      say: a.practiced ? t(a.result) : t(a.reason)
    }));
    quotes(entry).forEach((q, i) => {
      scenes.push({ part: '문장 ' + (i + 1), screen: t(q.text) + (has(q.page) ? '\n(' + t(q.page) + ')' : ''), say: t(q.text) });
      if (has(q.reason)) scenes.push({ part: '문장 ' + (i + 1) + '을 고른 이유', screen: '', say: t(q.reason) });
    });
    if (has(entry.summary)) scenes.push({ part: '오늘 읽은 내용', screen: '오늘 읽은 내용', say: t(entry.summary) });
    apps(entry).forEach((a, i) => scenes.push({ part: '적용 ' + (i + 1), screen: (i + 1) + '. ' + t(a.text), say: t(a.text) }));
    if (has(opts.outro)) scenes.push({ part: '마무리', screen: '', say: t(opts.outro) });
    return withTiming(scenes, 180, 300);
  }

  // 쇼츠·릴스: 문장 하나 + 고른 이유 + 적용 하나. 60초를 넘으면 경고만 한다 (내 문장을 자르지 않음).
  function shortScript(book, entry, opts) {
    opts = opts || {};
    const qi = opts.quoteIndex || 0;
    const n = dayNumber(book, entry.date);
    const q = quotes(entry)[qi];
    const scenes = [];
    scenes.push({ part: '첫 화면', screen: t(book.title) + ' · ' + n + '일째', say: '' });
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
    scriptText: scriptText, dayNumber: dayNumber, THREADS_LIMIT: THREADS_LIMIT
  };
});
