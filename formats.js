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

  // ---------- 오늘의 원고 ----------
  // 기록(나를 위한 메모)과 따로, 보는 사람을 위해 내가 다시 쓴 3~5줄. 하나라도 적었으면 원고를 쓴다.
  function draftOf(entry) {
    const d = entry && entry.draft;
    if (!d || !(has(d.hook) || has(d.story) || has(d.action) || has(d.ask))) return null;
    const qs = quotes(entry);
    const quote = qs.find(q => q.id && q.id === d.starId) || null;
    return { hook: t(d.hook), story: t(d.story), action: t(d.action), ask: t(d.ask), quote: quote };
  }
  function draftSeconds(entry) {
    const d = draftOf(entry);
    if (!d) return 0;
    return seconds([d.hook, d.quote ? d.quote.text : '', d.story, d.action, d.ask].join(' ')) + 2 * 5;
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
    const out = [];
    const dr = draftOf(entry);
    if (dr && dr.hook) out.push(dr.hook, '');
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
        out.push('" ' + t(q.text) + ' "' + (has(q.page) ? ' (' + t(q.page) + ')' : ''));
        if (has(q.reason)) out.push('', '고른 이유: ' + t(q.reason));
        out.push('');
      });
    }
    if (dr && dr.story) out.push('■ 이 문장에서 멈춘 이유', '', dr.story, '');
    if (has(entry.summary)) out.push('■ 오늘 읽은 내용', '', t(entry.summary), '');
    const as = apps(entry);
    if (as.length) {
      out.push('■ 내 삶에 적용해 보기', '');
      as.forEach((a, i) => out.push((i + 1) + '. ' + t(a.text)));
      out.push('', '내일 해봤는지 다시 적을게요.', '');
    }
    if (dr && dr.ask) out.push(dr.ask, '');
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
    const n = sessionNumber(book, entry.date);
    const blocks = [];
    const dr = draftOf(entry);
    if (dr) {
      // 원고가 있으면 원고만으로 짧고 깔끔하게
      let head = (dr.hook ? dr.hook + '\n\n' : '') + '📖 ' + t(book.title) + ' · ' + n + '번째 날';
      if (dr.quote) head += '\n\n"' + t(dr.quote.text) + '"';
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
    const dr = draftOf(entry);
    if (dr && dr.hook) scenes.push({ part: '첫 마디', screen: dr.hook, say: dr.hook });
    scenes.push({ part: '시작', screen: t(book.title) + '\n' + (t(book.author) || '') + '\n' + n + '번째 날', say: has(opts.intro) ? t(opts.intro) : '' });
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
    const dr = draftOf(entry);
    if (dr) {
      scenes.push(dr.hook ? { part: '첫 마디', screen: dr.hook, say: dr.hook } : { part: '첫 화면', screen: t(book.title) + ' · ' + n + '번째 날', say: '' });
      if (dr.quote) scenes.push({ part: '오늘의 문장', screen: t(dr.quote.text), say: t(dr.quote.text) });
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
  const RS_PLATFORMS = { threads: { name: 'Threads', limit: 500 }, x: { name: 'X(트위터)', limit: 280 } };
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
      qs.forEach((q, i) => lines.push((i + 1) + '. "' + t(q.text) + '"' + (has(q.page) ? ' (' + t(q.page) + ')' : ''), '   고른 이유: ' + (t(q.reason) || '(안 적음)')));
    }
    if (has(entry.summary)) lines.push('', '[오늘 읽은 내용 정리]', t(entry.summary));
    const as = apps(entry);
    if (as.length) { lines.push('', '[내 삶에 적용할 것]'); as.forEach((a, i) => lines.push((i + 1) + '. ' + t(a.text))); }
    return lines.join('\n');
  }

  // 원고 코치: 고쳐 쓰지 않고 짚어만 준다
  function coachMessages(book, entry) {
    const d = (entry && entry.draft) || {};
    const q = quotes(entry).find(x => x.id && x.id === d.starId);
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
    const user = '[책] ' + t(book.title) + '\n\n[첫 한 줄]\n' + (t(d.hook) || '(비어 있음)') +
      '\n\n[오늘의 문장]\n' + (q ? t(q.text) : '(고르지 않음)') +
      '\n\n[내 이야기]\n' + (t(d.story) || '(비어 있음)') +
      '\n\n[하나의 실천]\n' + (t(d.action) || '(비어 있음)') +
      '\n\n[마지막 질문]\n' + (t(d.ask) || '(비어 있음)');
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
  }

  function restyleMessages(book, entry, o) {
    const p = RS_PLATFORMS[o.platform] || RS_PLATFORMS.threads;
    const f = RS_FORMATS[o.format] || RS_FORMATS.short;
    const tone = RS_TONES[o.tone] || RS_TONES.viral;
    const system = [
      '당신은 한 사람의 독서 기록을 ' + p.name + ' 글로 다시 구성하는 편집자입니다.',
      '글쓴이는 AI가 대신 생각해 주는 글이 아니라, 자기가 직접 읽고 느낀 것을 사람 대 사람으로 나누고 싶어 합니다.',
      '',
      '반드시 지킬 것:',
      '- 재료는 아래 독서 기록뿐입니다. 기록에 없는 경험, 사례, 숫자, 통계, 인용을 지어내지 않습니다.',
      '- 글쓴이의 생각, 느낌, 실천 결과가 글의 중심입니다. 일반론으로 바꾸지 않습니다.',
      '- 책에서 옮긴 문장을 쓸 때는 한 글자도 바꾸지 않고 따옴표로 그대로 씁니다.',
      '- 글쓴이 시점(1인칭 "나")으로 씁니다.',
      '',
      '바꿔도 되는 것:',
      '- 어투: ' + tone.prompt,
      '- 목표 독자에게 닿도록 순서, 강조점, 첫 문장, 말 거는 방식을 다시 구성합니다.',
      '',
      '형식:',
      '- 포스트 하나당 ' + p.limit + '자를 넘기지 않습니다.',
      '- 1~2문장마다 줄을 바꾸고 빈 줄로 나눕니다.',
      '- "~에 대해 알아보겠습니다" 같은 AI 말투를 쓰지 않습니다.',
      '- 해시태그는 마지막 포스트에만 최대 2개.',
      '- 포스트 개수: ' + f.count,
      '- 각 포스트 앞에 ###POST### 를 한 줄로 쓰고, 번호(1/5 등)는 붙이지 않습니다. 인사말이나 설명 없이 첫 ###POST### 부터 시작합니다.'
    ].join('\n');
    const user = '[목표 독자]\n' + (t(o.target) || '(지정 안 함)') + '\n\n[독서 기록]\n' + recordText(book, entry) +
      '\n\n이 기록으로 목표 독자에게 닿는 ' + p.name + ' 글을 써주세요.';
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
    draftOf: draftOf, draftSeconds: draftSeconds, coachMessages: coachMessages,
    restyleMessages: restyleMessages, parsePosts: parsePosts, RS_PLATFORMS: RS_PLATFORMS, RS_FORMATS: RS_FORMATS, RS_TONES: RS_TONES
  };
});
