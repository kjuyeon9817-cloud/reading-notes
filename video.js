// 3단계: 주제별 모션그래픽 + 내 목소리 더빙 영상 (브라우저 안에서 만듦)
// 대본 한 줄 = 장면 하나. 장면마다 녹음하면 장면 길이가 녹음 길이에 맞춰진다.
// 글은 바꾸지 않는다. 모션은 정해둔 디자인 묶음에서 고른다.

export const MOTIONS = {
  pages: { label: '펼쳐지는 페이지', hint: '인문·문학·역사' },
  wave: { label: '잔잔한 물결', hint: '심리·에세이·마음' },
  growth: { label: '올라가는 선', hint: '경제·경영·자기계발' },
  orbit: { label: '궤도와 별', hint: '과학·철학·우주' },
  bloom: { label: '피어나는 원', hint: '그 밖의 모든 책' }
};

const KEYWORDS = [
  ['wave', ['심리', '에세이', '마음', '감정', '상담', '치유', '관계', '명상', '육아']],
  ['growth', ['경제', '경영', '자기계발', '투자', '돈', '재테크', '마케팅', '비즈니스', '성장', '습관', '생산성', '커리어']],
  ['orbit', ['과학', '철학', '우주', '물리', '생물', '수학', '기술', 'IT', '뇌', '인공지능', 'AI']],
  ['pages', ['인문', '문학', '소설', '역사', '시', '고전', '독서', '글쓰기', '문해', '언어', '예술']]
];

export function pickMotion(book) {
  if (book && book.motion && MOTIONS[book.motion]) return book.motion;
  const s = ((book && book.topic) || '') + ' ' + ((book && book.title) || '');
  for (const [m, words] of KEYWORDS) if (words.some(w => s.includes(w))) return m;
  return 'bloom';
}

// ---------- 녹음 보관 (이 기기의 IndexedDB) ----------
const DB_NAME = 'rn-dub', STORE = 'clips';
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => res(req && req.result);
    tx.onerror = () => rej(tx.error);
  });
}
const clipGet = k => idb('readonly', s => s.get(k)).catch(() => null);
const clipPut = (k, v) => idb('readwrite', s => s.put(v, k));
const clipDel = k => idb('readwrite', s => s.delete(k));

function hash(str) { let h = 5381; for (const c of String(str)) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return h.toString(36); }

// ---------- 글자 나누기 ----------
function chunks(text, max) {
  text = String(text || '').trim();
  if (!text) return [];
  const sentences = text.split(/(?<=[.!?。…])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  const out = [];
  let cur = '';
  for (const s of sentences) {
    if (!cur) cur = s;
    else if ((cur + ' ' + s).length <= max) cur += ' ' + s;
    else { out.push(cur); cur = s; }
  }
  if (cur) out.push(cur);
  // 한 문장이 너무 길면 띄어쓰기 기준으로 다시 자른다
  const res = [];
  out.forEach(c => {
    if (c.length <= max * 1.4) { res.push(c); return; }
    const words = c.split(' ');
    let line = '';
    words.forEach(w => { if ((line + ' ' + w).trim().length > max && line) { res.push(line); line = w; } else line = (line + ' ' + w).trim(); });
    if (line) res.push(line);
  });
  return res;
}

function wrap(ctx, text, maxW) {
  const lines = [];
  String(text).split('\n').forEach(par => {
    const words = par.split(' ');
    let line = '';
    words.forEach(w => {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
      // 띄어쓰기 없이 긴 단어는 글자 단위로 자른다
      while (ctx.measureText(line).width > maxW && line.length > 1) {
        let i = line.length - 1;
        while (i > 1 && ctx.measureText(line.slice(0, i)).width > maxW) i--;
        lines.push(line.slice(0, i)); line = line.slice(i);
      }
    });
    lines.push(line);
  });
  return lines;
}

// ---------- 그리기 ----------
const C = { bg: '#fffdf5', cream: '#fff6d1', y1: '#ffe27a', y2: '#ffd43b', y3: '#f5b800', ink: '#4a3f2c', muted: '#9a8f7a', white: '#ffffff' };
const FONT = '"Noto Sans KR", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const ease = x => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawMotion(ctx, W, H, motion, t, seed) {
  const S = Math.min(W, H);
  ctx.save();
  if (motion === 'wave') {
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      const base = H * (0.72 + k * 0.07), amp = S * (0.03 + k * 0.012), len = W / (1.2 + k * 0.4);
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) ctx.lineTo(x, base + Math.sin(x / len * Math.PI * 2 + t * (0.8 + k * 0.25) + seed) * amp);
      ctx.lineTo(W, H); ctx.closePath();
      ctx.fillStyle = [C.cream, C.y1, C.y2, C.y3][k]; ctx.globalAlpha = 0.55 - k * 0.08; ctx.fill();
    }
    ctx.globalAlpha = 0.5;
    for (let k = 0; k < 3; k++) {
      const r = ((t * 0.25 + k / 3) % 1) * S * 0.6;
      ctx.beginPath(); ctx.arc(W * 0.82, H * 0.16, r, 0, Math.PI * 2);
      ctx.strokeStyle = C.y2; ctx.lineWidth = S * 0.006; ctx.globalAlpha = 0.6 * (1 - r / (S * 0.6)); ctx.stroke();
    }
  } else if (motion === 'growth') {
    const n = 7, bw = W * 0.07, gap = W * 0.035, x0 = W * 0.08, baseY = H * 0.93;
    for (let i = 0; i < n; i++) {
      const target = H * (0.06 + 0.035 * i + 0.02 * Math.sin(seed + i));
      const h = target * ease(t * 0.9 - i * 0.12) * (1 + 0.04 * Math.sin(t * 2 + i));
      ctx.globalAlpha = 0.55; ctx.fillStyle = i % 2 ? C.y1 : C.y2;
      rr(ctx, x0 + i * (bw + gap), baseY - h, bw, h, bw * 0.3); ctx.fill();
    }
    // 올라가는 선
    const p = ease(t * 0.5);
    ctx.globalAlpha = 0.9; ctx.strokeStyle = C.y3; ctx.lineWidth = S * 0.01; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    let lx = 0, ly = 0;
    for (let i = 0; i <= 60 * p; i++) {
      const u = i / 60;
      lx = W * (0.06 + u * 0.88); ly = H * (0.9 - u * 0.22 - 0.025 * Math.sin(u * 9 + seed));
      if (i === 0) ctx.moveTo(lx, ly); else ctx.lineTo(lx, ly);
    }
    ctx.stroke();
    ctx.fillStyle = C.y3; ctx.beginPath(); ctx.arc(lx, ly, S * (0.016 + 0.004 * Math.sin(t * 5)), 0, Math.PI * 2); ctx.fill();
  } else if (motion === 'orbit') {
    const cx = W * 0.5, cy = H * 0.5;
    for (let i = 0; i < 40; i++) {
      const sx = (Math.sin(i * 12.9898 + seed) * 43758.5453 % 1 + 1) % 1, sy = (Math.sin(i * 78.233 + seed) * 12345.678 % 1 + 1) % 1;
      ctx.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2 + i));
      ctx.fillStyle = C.y3; ctx.beginPath(); ctx.arc(sx * W, sy * H, S * 0.004, 0, Math.PI * 2); ctx.fill();
    }
    for (let k = 0; k < 3; k++) {
      const rx = S * (0.3 + k * 0.12), ry = rx * 0.38, rot = -0.35 + k * 0.3;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
      ctx.globalAlpha = 0.35; ctx.strokeStyle = C.y2; ctx.lineWidth = S * 0.004;
      ctx.beginPath(); ctx.ellipse(0, 0, rx * ease(t * 1.2 - k * 0.15), ry * ease(t * 1.2 - k * 0.15), 0, 0, Math.PI * 2); ctx.stroke();
      const a = t * (0.6 - k * 0.15) + k * 2 + seed;
      ctx.globalAlpha = 0.85; ctx.fillStyle = [C.y3, C.y2, C.y1][k];
      ctx.beginPath(); ctx.arc(Math.cos(a) * rx, Math.sin(a) * ry, S * (0.022 - k * 0.004), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  } else if (motion === 'pages') {
    const pw = S * 0.34, ph = pw * 1.3;
    for (let k = 0; k < 3; k++) {
      const flip = Math.cos(((t * 0.35 + k * 0.33) % 1) * Math.PI);
      const x = W * (0.12 + k * 0.32), y = H * (0.78 - (k % 2) * 0.06);
      ctx.save(); ctx.translate(x, y); ctx.rotate(-0.12 + k * 0.1); ctx.scale(Math.max(Math.abs(flip), 0.04), 1);
      ctx.globalAlpha = 0.5; ctx.fillStyle = flip > 0 ? C.cream : C.y1;
      rr(ctx, -pw / 2, -ph / 2, pw, ph, S * 0.02); ctx.fill();
      ctx.globalAlpha = 0.35; ctx.fillStyle = C.y3;
      for (let l = 0; l < 6; l++) { rr(ctx, -pw * 0.36, -ph * 0.34 + l * ph * 0.11, pw * (l === 5 ? 0.4 : 0.72), S * 0.008, S * 0.004); ctx.fill(); }
      ctx.restore();
    }
    // 잉크 번짐
    for (let k = 0; k < 3; k++) {
      const u = (t * 0.3 + k / 3) % 1;
      ctx.globalAlpha = 0.35 * (1 - u); ctx.fillStyle = C.y2;
      ctx.beginPath(); ctx.arc(W * (0.2 + 0.3 * k), H * (0.12 + 0.05 * k), S * 0.2 * ease(u), 0, Math.PI * 2); ctx.fill();
    }
  } else {
    const cx = W * 0.5, cy = H * 0.5;
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2 + t * 0.2 + seed;
      const d = S * 0.42 * ease(t * 0.8 - k * 0.08);
      const r = S * (0.09 + 0.02 * Math.sin(t * 1.5 + k));
      ctx.globalAlpha = 0.45; ctx.fillStyle = [C.y1, C.y2, C.cream][k % 3];
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * (H > W ? 1.5 : 0.8), r, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

// 장면 하나를 그린다. t = 장면 시작부터 흐른 초, dur = 장면 길이
function drawScene(ctx, W, H, scene, t, dur, info) {
  const vertical = H > W, S = Math.min(W, H), pad = S * 0.08;
  ctx.globalAlpha = 1;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, C.white); g.addColorStop(1, C.cream);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  drawMotion(ctx, W, H, scene.motion, t, scene.seed || 0);

  // 위: 장면 이름 알약 + 진행 막대
  ctx.globalAlpha = 1;
  ctx.font = '700 ' + Math.round(S * 0.032) + 'px ' + FONT;
  const label = scene.part || '';
  const lw = ctx.measureText(label).width + S * 0.06, lh = S * 0.065, ly = vertical ? H * 0.09 : pad * 0.8;
  ctx.fillStyle = C.y2; rr(ctx, pad, ly, lw, lh, lh / 2); ctx.fill();
  ctx.fillStyle = C.ink; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(label, pad + S * 0.03, ly + lh / 2);
  ctx.fillStyle = 'rgba(74,63,44,.12)'; rr(ctx, 0, 0, W, S * 0.008, 0); ctx.fill();
  ctx.fillStyle = C.y3; rr(ctx, 0, 0, W * Math.min(info.progress, 1), S * 0.008, 0); ctx.fill();

  // 가운데: 큰 글자 (단어가 하나씩 떠오름)
  const mainText = scene.screen || scene.say || '';
  const mainChunks = chunks(mainText, vertical ? 70 : 90);
  const idx = pickChunk(mainChunks, t, dur);
  const main = mainChunks[idx] || '';
  const ct = t - chunkStart(mainChunks, idx, dur);
  const boxW = W - pad * 2;
  let size = S * (main.length < 20 ? 0.085 : main.length < 50 ? 0.066 : 0.054);
  let lines;
  for (;;) {
    ctx.font = '800 ' + Math.round(size) + 'px ' + FONT;
    lines = wrap(ctx, main, boxW);
    if (lines.length * size * 1.35 < H * (vertical ? 0.5 : 0.46) || size < S * 0.03) break;
    size *= 0.92;
  }
  const lineH = size * 1.35, top = H * (vertical ? 0.46 : 0.47) - lines.length * lineH / 2;
  ctx.textAlign = 'center';
  let w = 0;
  lines.forEach((line, li) => {
    const words = line.split(' ');
    const full = ctx.measureText(line).width;
    let x = W / 2 - full / 2;
    const y = top + li * lineH + lineH / 2;
    // 형광펜 밑줄 (첫 장면 제목에만)
    if (scene.highlight) {
      const p = ease((ct - 0.3 - li * 0.2) * 1.5);
      ctx.globalAlpha = 0.9; ctx.fillStyle = C.y2;
      rr(ctx, x - size * 0.1, y + size * 0.05, (full + size * 0.2) * p, size * 0.42, size * 0.08); ctx.fill();
    }
    words.forEach(word => {
      const ww = ctx.measureText(word).width, sp = ctx.measureText(' ').width;
      const a = ease((ct - w * 0.06) * 3);
      ctx.globalAlpha = a; ctx.fillStyle = C.ink; ctx.textAlign = 'left';
      ctx.fillText(word, x, y + (1 - a) * size * 0.5);
      x += ww + sp; w++;
    });
  });

  // 아래: 자막 (화면 글과 읽는 말이 다를 때)
  ctx.textAlign = 'center';
  if (scene.screen && scene.say && !scene.same) {
    const subs = chunks(scene.say, vertical ? 34 : 60);
    const sub = subs[pickChunk(subs, t, dur)] || '';
    const fs = S * 0.036;
    ctx.font = '600 ' + Math.round(fs) + 'px ' + FONT;
    const sl = wrap(ctx, sub, W - pad * 2.6);
    const bh = sl.length * fs * 1.45 + fs * 0.9, by = H * (vertical ? 0.8 : 0.8) - bh / 2;
    ctx.globalAlpha = 0.92; ctx.fillStyle = C.white;
    rr(ctx, pad, by, W - pad * 2, bh, fs * 0.6); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = C.ink;
    sl.forEach((l, i) => ctx.fillText(l, W / 2, by + fs * 0.45 + fs * 1.45 * (i + 0.5)));
  }

  // 맨 아래: 책 이름 · 브랜드
  ctx.globalAlpha = 1; ctx.font = '600 ' + Math.round(S * 0.026) + 'px ' + FONT; ctx.fillStyle = C.muted;
  const fy = vertical ? H * 0.94 : H - pad * 0.6;
  ctx.textAlign = 'left'; ctx.fillText(scene.book || '', pad, fy);
  ctx.textAlign = 'right'; ctx.fillStyle = C.ink; ctx.fillText('Reading Notes', W - pad, fy);
  ctx.fillStyle = C.y2; ctx.beginPath();
  ctx.arc(W - pad - ctx.measureText('Reading Notes').width - S * 0.022, fy, S * 0.011, 0, Math.PI * 2); ctx.fill();

  // 장면 들어올 때 살짝 밝게
  if (t < 0.35) { ctx.globalAlpha = 1 - t / 0.35; ctx.fillStyle = C.white; ctx.fillRect(0, 0, W, H); }
  ctx.globalAlpha = 1;
}

// 글자 수에 비례해 몇 번째 덩어리를 보여줄지 정한다
function pickChunk(list, t, dur) {
  if (list.length < 2) return 0;
  const total = list.reduce((n, c) => n + c.length, 0);
  let acc = 0;
  for (let i = 0; i < list.length; i++) { acc += list[i].length; if (t < dur * acc / total) return i; }
  return list.length - 1;
}
function chunkStart(list, i, dur) {
  if (list.length < 2) return 0;
  const total = list.reduce((n, c) => n + c.length, 0);
  return dur * list.slice(0, i).reduce((n, c) => n + c.length, 0) / total;
}

// ---------- 화면 ----------
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LEAD = 0.35, TAIL = 0.6; // 목소리 앞뒤 여유(초)

function pickRecorderType(kind) {
  const list = kind === 'audio'
    ? ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg']
    // MP4는 H.264(avc1)일 때만 고른다. 인스타그램 릴스가 가장 잘 받는 형식이라서.
    : ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1.4D401F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  if (!window.MediaRecorder) return null;
  return list.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

export async function mount(root, opts) {
  // opts: { title, scenes:[{part,screen,say,same,sec,motion,book}], vertical, storeKey, motions:[{bookId,title,motion}], onMotion(bookId,m), onBack }
  const W = opts.vertical ? 1080 : 1920, H = opts.vertical ? 1920 : 1080;
  const scenes = opts.scenes.map((s, i) => Object.assign({}, s, { seed: i * 1.7, highlight: i === 0 }));
  const keyOf = (s, i) => opts.storeKey + '|' + i + '|' + hash(s.say);
  const clips = await Promise.all(scenes.map((s, i) => s.say ? clipGet(keyOf(s, i)) : null));
  let actx = null;
  const audioCtx = () => (actx = actx || new (window.AudioContext || window.webkitAudioContext)());
  const durOf = i => clips[i] ? clips[i].dur + LEAD + TAIL : (scenes[i].say ? scenes[i].sec : 2.5);
  const totalDur = () => scenes.reduce((n, s, i) => n + durOf(i), 0);
  const recorded = () => scenes.filter((s, i) => !s.say || clips[i]).length;
  let stopFn = null, recState = null;

  try { await document.fonts.load('800 60px "Noto Sans KR"'); await document.fonts.load('600 40px "Noto Sans KR"'); } catch (e) { /* 글꼴 없이도 그린다 */ }

  function fmt(sec) { sec = Math.round(sec); return (sec >= 60 ? Math.floor(sec / 60) + '분 ' : '') + (sec % 60) + '초'; }

  function html() {
    const tot = totalDur(), need = scenes.filter(s => s.say).length, done = scenes.filter((s, i) => s.say && clips[i]).length;
    return '<button class="back" type="button" id="v-back">← 돌아가기</button>' +
      '<h1>🎬 더빙 영상 만들기</h1>' +
      '<p class="muted small">' + esc(opts.title) + ' · ' + (opts.vertical ? '세로 9:16 (쇼츠·릴스)' : '가로 16:9 (유튜브 롱폼)') + '</p>' +
      '<div class="video-wrap' + (opts.vertical ? ' v' : ' h') + '"><canvas id="v-canvas" width="' + W + '" height="' + H + '"></canvas></div>' +
      '<div class="actions center"><button class="btn ghost" id="v-play" type="button">▶ 전체 미리보기</button>' +
      '<button class="btn arrow" id="v-export" type="button">영상 파일 만들기</button></div>' +
      '<p class="small muted center" id="v-status">녹음 ' + done + '/' + need + '장면 · 영상 길이 약 ' + fmt(tot) + '</p>' +
      '<div class="card"><h2>모션 스타일</h2>' +
      opts.motions.map(m => '<label class="small">' + esc(m.title) + '</label><div class="date-chips">' +
        Object.keys(MOTIONS).map(k => '<button type="button" class="chip' + (k === m.motion ? ' on' : '') + '" data-motion="' + k + '" data-mbook="' + esc(m.bookId) + '" title="' + esc(MOTIONS[k].hint) + '">' + esc(MOTIONS[k].label) + '</button>').join('') + '</div>').join('') +
      '<p class="small muted">책의 주제를 보고 자동으로 골랐어요. 눌러서 바꿀 수 있어요.</p></div>' +
      '<div class="card"><h2>장면별 녹음</h2><p class="small muted">장면을 누르면 위 화면에서 움직임을 볼 수 있어요. 🎙를 누르고 아래 글을 읽은 뒤 ■로 멈춰요. 틀린 장면만 다시 녹음하면 돼요.</p>' +
      scenes.map((s, i) => '<div class="dub-row' + (clips[i] ? ' done' : '') + '" data-scene="' + i + '">' +
        '<div class="dub-head"><span class="dub-no">' + (i + 1) + '</span><span class="small muted">' + esc(s.part) + ' · ' +
        (s.say ? (clips[i] ? '녹음 ' + clips[i].dur.toFixed(1) + '초' : '녹음 전') : '읽을 글 없음 · 2.5초') + '</span></div>' +
        (s.say ? '<div class="dub-say">' + esc(s.say) + '</div><div class="actions">' +
          '<button class="btn small-btn" type="button" data-rec="' + i + '">' + (recState && recState.i === i ? '■ 멈추기' : '🎙 ' + (clips[i] ? '다시 녹음' : '녹음')) + '</button>' +
          (clips[i] ? '<button class="btn ghost small-btn" type="button" data-listen="' + i + '">▶ 듣기</button><button class="btn danger small-btn" type="button" data-del="' + i + '">지우기</button>' : '') +
          '</div>' : '<div class="dub-say muted">' + esc(s.screen) + '</div>') +
        '</div>').join('') + '</div>' +
      '<p class="small muted">녹음은 이 기기에만 저장돼요(GitHub에 올라가지 않아요). 영상 파일 만들기는 영상 길이만큼 시간이 걸리니, 그동안 이 화면을 열어 두세요.</p>';
  }

  let canvas, ctx;
  function draw(i, t) {
    const before = scenes.slice(0, i).reduce((n, s, k) => n + durOf(k), 0);
    drawScene(ctx, W, H, scenes[i], t, durOf(i), { progress: (before + t) / totalDur() });
  }

  function stop() { if (stopFn) { const f = stopFn; stopFn = null; f(); } }

  // 장면 하나만 반복해서 보여줌
  function loopScene(i) {
    stop();
    let alive = true; const t0 = performance.now();
    const tick = () => { if (!alive) return; const d = durOf(i); draw(i, ((performance.now() - t0) / 1000) % d); requestAnimationFrame(tick); };
    stopFn = () => { alive = false; };
    tick();
  }

  // 전체 재생 (녹음과 함께). recorder가 있으면 영상으로 녹화
  async function playAll(dest, onEnd) {
    stop();
    const ac = audioCtx();
    if (ac.state === 'suspended') await ac.resume();
    const bufs = await Promise.all(clips.map(async c => c ? ac.decodeAudioData(await c.blob.arrayBuffer()) : null));
    const starts = []; let acc = 0;
    scenes.forEach((s, i) => { starts.push(acc); acc += durOf(i); });
    const total = acc, t0 = ac.currentTime + 0.15;
    const sources = [];
    bufs.forEach((b, i) => {
      if (!b) return;
      const src = ac.createBufferSource(); src.buffer = b;
      src.connect(ac.destination); if (dest) src.connect(dest);
      src.start(t0 + starts[i] + LEAD); sources.push(src);
    });
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const now = ac.currentTime - t0;
      if (now >= total) { alive = false; stopFn = null; onEnd && onEnd(); return; }
      let i = 0; while (i < scenes.length - 1 && now >= starts[i + 1]) i++;
      draw(i, Math.max(now - starts[i], 0));
      status('재생 중 ' + fmt(Math.max(now, 0)) + ' / ' + fmt(total));
      requestAnimationFrame(tick);
    };
    stopFn = () => { alive = false; sources.forEach(s => { try { s.stop(); } catch (e) { /* 이미 멈춤 */ } }); onEnd && onEnd(true); };
    tick();
  }

  function status(msg) { const el = root.querySelector('#v-status'); if (el) el.textContent = msg; }

  async function startRec(i) {
    stop();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { alert('마이크를 쓸 수 없어요. 브라우저 주소창 옆 자물쇠에서 마이크 권한을 허용해 주세요.\n(' + e.message + ')'); return; }
    const type = pickRecorderType('audio');
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const parts = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) parts.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(parts, { type: rec.mimeType || type || 'audio/webm' });
      let dur = (performance.now() - recState.t0) / 1000;
      try { dur = (await audioCtx().decodeAudioData(await blob.arrayBuffer())).duration; } catch (e) { /* 길이는 시계로 */ }
      const clip = { blob, dur, at: new Date().toISOString() };
      clips[i] = clip; recState = null;
      try { await clipPut(keyOf(scenes[i], i), clip); } catch (e) { alert('녹음을 이 기기에 저장하지 못했어요: ' + e.message); }
      paint(); loopScene(i);
    };
    recState = { i, rec, t0: performance.now() };
    rec.start();
    paint();
    // 녹음하는 동안 장면이 처음부터 움직인다
    let alive = true; const t0 = performance.now();
    const tick = () => { if (!alive || !recState) return; const t = (performance.now() - t0) / 1000; draw(i, Math.min(t, Math.max(durOf(i), t))); requestAnimationFrame(tick); };
    stopFn = () => { alive = false; };
    tick();
  }

  async function exportVideo() {
    const missing = scenes.map((s, i) => s.say && !clips[i] ? i + 1 : 0).filter(Boolean);
    if (missing.length && !confirm('아직 녹음하지 않은 장면이 있어요: ' + missing.join(', ') + '번\n그 장면은 소리 없이 넘어가요. 그래도 만들까요?')) return;
    const type = pickRecorderType('video');
    if (type === null || !canvas.captureStream) { alert('이 브라우저는 영상 파일 만들기를 지원하지 않아요. 컴퓨터의 크롬이나 엣지에서 해 주세요.'); return; }
    const ac = audioCtx();
    const dest = ac.createMediaStreamDestination();
    const vstream = canvas.captureStream(30);
    const mixed = new MediaStream([...vstream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(mixed, Object.assign(type ? { mimeType: type } : {}, { videoBitsPerSecond: 8000000, audioBitsPerSecond: 160000 }));
    const parts = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) parts.push(e.data); };
    const btn = root.querySelector('#v-export'); btn.disabled = true; btn.textContent = '만드는 중… 화면을 열어 두세요';
    rec.onstop = () => {
      const mime = rec.mimeType || type || 'video/webm';
      const ext = mime.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(parts, { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = (opts.fileName || 'reading-notes') + '.' + ext; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      btn.disabled = false; btn.textContent = '영상 파일 만들기';
      status('완성! ' + ext.toUpperCase() + ' 파일로 내려받았어요 (' + (blob.size / 1048576).toFixed(1) + 'MB).' +
        (ext === 'webm' ? ' 유튜브는 그대로 올릴 수 있어요. 인스타그램 릴스는 MP4가 필요할 수 있어요.' : ''));
    };
    rec.start(1000);
    await playAll(dest, cancelled => { setTimeout(() => rec.state !== 'inactive' && rec.stop(), 300); if (cancelled) status('영상 만들기를 멈췄어요.'); });
  }

  function paint() {
    stop();
    root.innerHTML = html();
    canvas = root.querySelector('#v-canvas'); ctx = canvas.getContext('2d');
    draw(0, 1.5);
    root.querySelector('#v-back').addEventListener('click', () => { stop(); if (recState) recState.rec.stop(); opts.onBack(); });
    root.querySelector('#v-play').addEventListener('click', e => {
      if (stopFn) { stop(); e.target.textContent = '▶ 전체 미리보기'; return; }
      e.target.textContent = '■ 멈추기';
      playAll(null, () => { const b = root.querySelector('#v-play'); if (b) b.textContent = '▶ 전체 미리보기'; });
    });
    root.querySelector('#v-export').addEventListener('click', exportVideo);
    root.querySelectorAll('[data-motion]').forEach(el => el.addEventListener('click', () => {
      const m = el.dataset.motion, bid = el.dataset.mbook;
      opts.motions.forEach(x => { if (x.bookId === bid) x.motion = m; });
      scenes.forEach(s => { if (s.bookId === bid) s.motion = m; });
      opts.onMotion(bid, m);
      paint();
    }));
    root.querySelectorAll('[data-scene]').forEach(el => el.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      loopScene(Number(el.dataset.scene));
    }));
    root.querySelectorAll('[data-rec]').forEach(el => el.addEventListener('click', () => {
      const i = Number(el.dataset.rec);
      if (recState) { if (recState.i === i) recState.rec.stop(); return; }
      startRec(i);
    }));
    root.querySelectorAll('[data-listen]').forEach(el => el.addEventListener('click', () => {
      const i = Number(el.dataset.listen); loopScene(i);
      const a = new Audio(URL.createObjectURL(clips[i].blob)); a.play();
    }));
    root.querySelectorAll('[data-del]').forEach(el => el.addEventListener('click', async () => {
      const i = Number(el.dataset.del);
      if (!confirm((i + 1) + '번 장면 녹음을 지울까요?')) return;
      clips[i] = null; await clipDel(keyOf(scenes[i], i)).catch(() => {}); paint();
    }));
  }

  paint();
  return { stop };
}

// 테스트용: 장면 하나를 그려 본다
export function preview(canvas, scene, t, dur) {
  drawScene(canvas.getContext('2d'), canvas.width, canvas.height, Object.assign({ seed: 0 }, scene), t, dur || 5, { progress: 0.4 });
}
