// 점토 스톱모션 스타일 화면 (브라우저 캔버스로 직접 그림, 외부 서비스·비용 없음)
// - 손으로 빚은 점토 인물: 울퉁불퉁한 외곽선, 지문 자국, 구슬 눈
// - 지문 글씨: 점토로 빚은 것처럼 도톰하고 지문 무늬가 있는 글자
// - 따뜻한 조명: 주황빛 스포트라이트, 가장자리 어둡게, 살짝 깜빡임
// - 스톱모션: 1초 12장으로 끊어 움직이고, 장마다 모양이 아주 조금씩 흔들림(boil)
// 인물은 장면 글의 낱말을 보고 고르고(autoPose), md의 [인물: …]이나 화면에서 바꿀 수 있다.

export const POSES = {
  read: { label: '책 읽기', hint: '발췌·책' },
  think: { label: '생각하기', hint: '생각·고민·깨달음' },
  comfort: { label: '안아주기', hint: '위로·함께·괜찮아' },
  walk: { label: '걸어가기', hint: '시작·도전·실천' },
  rest: { label: '쉬어가기', hint: '휴식·멈춤·천천히' },
  cheer: { label: '기뻐하기', hint: '기쁨·감사·행복' },
  write: { label: '기록하기', hint: '쓰기·기록·일기' },
  hope: { label: '하늘 보기', hint: '희망·내일·빛' },
  sad: { label: '고개 숙이기', hint: '슬픔·힘듦·지침' },
  none: { label: '인물 없음', hint: '글만' }
};

const POSE_WORDS = [
  ['comfort', ['위로', '안아', '괜찮아', '곁에', '함께', '토닥', '응원', '다정', '덜 외로']],
  ['sad', ['슬프', '슬픔', '힘들', '지쳐', '지친', '눈물', '아프', '외로', '우울', '무너', '견디', '버티']],
  ['rest', ['쉬어', '쉬는', '쉬고', '휴식', '잠들', '멈추', '멈춤', '여유', '천천히', '숨을']],
  ['hope', ['희망', '내일', '빛', '꿈', '바라', '기대', '언젠가', '앞으로']],
  ['cheer', ['기쁘', '기쁨', '행복', '감사', '고마', '웃', '신나', '즐거', '해냈']],
  ['walk', ['걷', '걸어', '걸음', '시작', '도전', '나아', '움직', '실천', '출발', '속도']],
  ['write', ['쓰기', '쓰는', '적어', '적었', '기록', '글을', '일기', '메모']],
  ['think', ['생각', '왜', '고민', '궁금', '질문', '깨달', '의미', '떠올']],
  ['read', ['읽', '책', '문장', '구절']]
];

export function autoPose(scene) {
  const s = (scene.say || '') + ' ' + (scene.screen || '');
  for (const [p, words] of POSE_WORDS) if (words.some(w => s.includes(w))) return p;
  if (scene.kind === 'quote' || /문장/.test(scene.part || '')) return 'read';
  if (scene.kind === 'title' || scene.kind === 'heading') return 'read';
  return 'think';
}

// ---------- 작은 도구 ----------
const FPS = 12;
const rnd = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const ease = x => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);
const pop = x => { x = Math.min(Math.max(x, 0), 1); return x < 0.6 ? ease(x / 0.6) * 1.12 : 1.12 - 0.12 * ease((x - 0.6) / 0.4); };
function hex(c) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  if (m) return [+m[1], +m[2], +m[3]];
  c = c.replace('#', ''); return [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16));
}
function shade(c, amt) {
  const [r, g, b] = hex(c), to = amt > 0 ? 255 : 0, k = Math.abs(amt);
  return 'rgb(' + [r, g, b].map(v => Math.round(v + (to - v) * k)).join(',') + ')';
}
function rgba(c, a) { const [r, g, b] = hex(c); return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'; }

const K = {
  wall1: '#f7d9a6', wall2: '#e9b77a', table1: '#c98a55', table2: '#9c6338',
  ink: '#4a2f1e', cream: '#f6e6c8', plate: '#fbefd6',
  people: [['#e07a52', '#f1c9a0'], ['#7fa07a', '#f0cfa8'], ['#6f8fb8', '#efc8a0'], ['#d9a441', '#f2cda4']],
  sun: '#f6b73c', heart: '#e2574c', bulb: '#ffd35c', book: '#b5523b', paper: '#fbf3e2', cloud: '#c9c2bd', drop: '#7fa8d6'
};

// 울퉁불퉁한 점토 덩어리 외곽선
function blob(ctx, cx, cy, rx, ry, seed, boil, lump, rot) {
  const N = 22, pts = [];
  lump = lump == null ? 0.05 : lump;
  for (let i = 0; i < N; i++) {
    const a = i / N * Math.PI * 2 + (rot || 0);
    const k = 1 + lump * (rnd(seed * 13 + i) - 0.5) * 2 + 0.018 * (rnd(seed * 7 + boil * 31 + i) - 0.5) * 2;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  ctx.beginPath();
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  let m = mid(pts[N - 1], pts[0]); ctx.moveTo(m[0], m[1]);
  for (let i = 0; i < N; i++) { const p = pts[i], q = pts[(i + 1) % N]; m = mid(p, q); ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]); }
  ctx.closePath();
}

// 지문 자국: 동심 타원 몇 겹
function prints(ctx, x, y, r, color, seed, n) {
  ctx.save();
  ctx.strokeStyle = shade(color, -0.35); ctx.lineWidth = Math.max(1, r * 0.018);
  for (let p = 0; p < (n || 2); p++) {
    const px = x + (rnd(seed + p * 3.1) - 0.5) * r * 1.2, py = y + (rnd(seed + p * 5.7) - 0.5) * r * 1.2;
    const rot = rnd(seed + p) * Math.PI, pr = r * (0.35 + rnd(seed + p * 9) * 0.3);
    for (let k = 1; k <= 7; k++) {
      ctx.globalAlpha = 0.16 - k * 0.012;
      ctx.beginPath(); ctx.ellipse(px, py, pr * k / 7, pr * k / 7 * 0.72, rot, 0.2 + k * 0.3, Math.PI * 1.75 + k * 0.3); ctx.stroke();
    }
  }
  ctx.restore();
}

// 현재 경로를 점토처럼 칠한다 (왼쪽 위에서 오는 따뜻한 빛)
function clay(ctx, x, y, r, color, seed, printsN) {
  const g = ctx.createRadialGradient(x - r * 0.45, y - r * 0.55, r * 0.05, x, y, r * 1.35);
  g.addColorStop(0, shade(color, 0.32)); g.addColorStop(0.5, color); g.addColorStop(1, shade(color, -0.32));
  ctx.fillStyle = g; ctx.fill();
  if (printsN !== 0) { ctx.save(); ctx.clip(); prints(ctx, x, y, r, color, seed, printsN); ctx.restore(); }
}

// 굵은 점토 팔·다리
function limb(ctx, pts, w, color) {
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const path = () => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); };
  ctx.translate(w * 0.06, w * 0.1); path(); ctx.strokeStyle = shade(color, -0.4); ctx.lineWidth = w; ctx.stroke();
  ctx.translate(-w * 0.06, -w * 0.1); path(); ctx.strokeStyle = color; ctx.lineWidth = w * 0.92; ctx.stroke();
  ctx.translate(-w * 0.12, -w * 0.16); path(); ctx.strokeStyle = shade(color, 0.28); ctx.lineWidth = w * 0.28; ctx.globalAlpha = 0.6; ctx.stroke();
  ctx.restore();
  const e = pts[pts.length - 1];
  blob(ctx, e[0], e[1], w * 0.62, w * 0.56, pts.length * 3 + e[0], 0, 0.06); clay(ctx, e[0], e[1], w * 0.6, color, e[1], 0);
}

function shadowAt(ctx, x, y, rx) {
  ctx.save(); ctx.globalAlpha = 0.28;
  const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
  g.addColorStop(0, '#5a3218'); g.addColorStop(1, 'rgba(90,50,24,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, rx, rx * 0.22, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

// 점토 인물 한 명. (x, y) = 발이 닿는 곳, s = 키 기준 크기
// p: { lean, tilt, look:[dx,dy], eyes:'open'|'closed'|'down'|'up', mouth:'smile'|'flat'|'sad'|'open',
//      armL, armR: [[elbowX,elbowY],[handX,handY]] (어깨 기준, s 단위), legL, legR: 같은 방식(엉덩이 기준), sit }
function person(ctx, x, y, s, p, look, seed, boil) {
  const [body, skin] = look;
  const lean = (p.lean || 0) * s, hipY = y - s * (p.sit ? 0.28 : 0.4);
  const bodyC = [x + lean * 0.5, hipY - s * 0.22], headC = [x + lean, hipY - s * 0.64 + (p.bob || 0) * s];
  const sh = (side) => [x + side * s * 0.17 + lean * 0.6, hipY - s * 0.36];
  const hip = (side) => [x + side * s * 0.09, hipY];
  const pt = (o, d) => [o[0] + d[0] * s, o[1] + d[1] * s];
  const legs = side => { const o = hip(side), L = side < 0 ? p.legL : p.legR; return [o, pt(o, L[0]), pt(o, L[1])]; };
  const arms = side => { const o = sh(side), A = side < 0 ? p.armL : p.armR; return [o, pt(o, A[0]), pt(o, A[1])]; };
  const lw = s * 0.11;
  shadowAt(ctx, x + lean * 0.3, y + s * 0.02, s * 0.38);
  limb(ctx, legs(-1), lw, shade(body, -0.12)); limb(ctx, legs(1), lw, shade(body, -0.12));
  if (p.armBehind) limb(ctx, arms(p.armBehind), lw * 0.85, body);
  blob(ctx, bodyC[0], bodyC[1], s * 0.24, s * 0.29, seed + 1, boil, 0.05); clay(ctx, bodyC[0], bodyC[1], s * 0.27, body, seed + 2, 2);
  // 머리
  ctx.save(); ctx.translate(headC[0], headC[1]); ctx.rotate(p.tilt || 0);
  blob(ctx, 0, 0, s * 0.21, s * 0.2, seed + 3, boil, 0.04); clay(ctx, 0, 0, s * 0.21, skin, seed + 4, 1);
  // 머리카락 덩어리
  blob(ctx, -s * 0.02, -s * 0.13, s * 0.2, s * 0.1, seed + 5, boil, 0.1); clay(ctx, 0, -s * 0.15, s * 0.2, shade(body, -0.45), seed + 6, 1);
  const lk = p.look || [0, 0], ex = lk[0] * s * 0.05, ey = lk[1] * s * 0.04;
  const eye = (dx) => {
    const cx = dx * s + ex, cy = s * 0.01 + ey;
    ctx.fillStyle = '#2a1a12';
    if (p.eyes === 'closed') { ctx.lineWidth = s * 0.018; ctx.strokeStyle = '#2a1a12'; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(cx, cy - s * 0.01, s * 0.03, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); return; }
    const ry = p.eyes === 'down' ? s * 0.02 : s * 0.032;
    ctx.beginPath(); ctx.ellipse(cx, cy + (p.eyes === 'down' ? s * 0.015 : 0), s * 0.027, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(cx - s * 0.009, cy - s * 0.012, s * 0.008, 0, Math.PI * 2); ctx.fill();
  };
  if (p.eyes !== 'none') { eye(-0.075); eye(0.075); }
  // 볼
  ctx.globalAlpha = 0.35; ctx.fillStyle = '#e8735a';
  ctx.beginPath(); ctx.ellipse(-s * 0.12 + ex, s * 0.07, s * 0.03, s * 0.018, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(s * 0.12 + ex, s * 0.07, s * 0.03, s * 0.018, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1; ctx.strokeStyle = '#5a2a1a'; ctx.lineWidth = s * 0.016; ctx.lineCap = 'round';
  ctx.beginPath();
  const my = s * 0.09 + ey;
  if (p.mouth === 'sad') ctx.arc(ex, my + s * 0.04, s * 0.04, 1.15 * Math.PI, 1.85 * Math.PI);
  else if (p.mouth === 'flat') { ctx.moveTo(ex - s * 0.03, my); ctx.lineTo(ex + s * 0.03, my); }
  else if (p.mouth === 'open') { ctx.fillStyle = '#7a2e22'; ctx.ellipse(ex, my, s * 0.03, s * 0.025, 0, 0, Math.PI * 2); ctx.fill(); }
  else ctx.arc(ex, my - s * 0.02, s * 0.04, 0.2 * Math.PI, 0.8 * Math.PI);
  if (p.mouth !== 'open') ctx.stroke();
  ctx.restore();
  // 앞 팔
  [-1, 1].forEach(side => { if (p.armBehind !== side) limb(ctx, arms(side), lw * 0.85, body); });
  return { headC, hand: side => arms(side)[2], hipY };
}

// ---------- 소품 ----------
function book(ctx, x, y, s, open, seed, boil) {
  ctx.save(); ctx.translate(x, y);
  blob(ctx, 0, s * 0.02, s * 0.3, s * 0.13, seed, boil, 0.04); clay(ctx, 0, 0, s * 0.3, K.book, seed, 1);
  [-1, 1].forEach(side => {
    ctx.save(); ctx.scale(side, 1); ctx.rotate(-0.12 - open * 0.1);
    blob(ctx, s * 0.14, -s * 0.03, s * 0.15, s * 0.1, seed + side, boil, 0.03); clay(ctx, s * 0.14, -s * 0.03, s * 0.16, K.paper, seed + 2, 0);
    ctx.strokeStyle = 'rgba(120,80,50,.35)'; ctx.lineWidth = s * 0.012;
    for (let l = 0; l < 3; l++) { ctx.beginPath(); ctx.moveTo(s * 0.05, -s * 0.07 + l * s * 0.04); ctx.lineTo(s * 0.23, -s * 0.07 + l * s * 0.04); ctx.stroke(); }
    ctx.restore();
  });
  ctx.restore();
}
function heart(ctx, x, y, r, seed, boil) {
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath();
  const j = (rnd(seed + boil) - 0.5) * r * 0.06;
  ctx.moveTo(0, r * 0.35);
  ctx.bezierCurveTo(-r * 1.1 + j, -r * 0.2, -r * 0.5, -r * 1.0, 0, -r * 0.45);
  ctx.bezierCurveTo(r * 0.5, -r * 1.0, r * 1.1 - j, -r * 0.2, 0, r * 0.35);
  clay(ctx, 0, -r * 0.2, r, K.heart, seed, 1); ctx.restore();
}
function sun(ctx, x, y, r, t, seed, boil) {
  ctx.save();
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2 + t * 0.15;
    const d = r * (1.45 + 0.06 * Math.sin(t * 2 + i));
    blob(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.18, r * 0.12, seed + i, boil, 0.08, a);
    clay(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.18, shade(K.sun, 0.1), seed + i, 0);
  }
  const g = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 2.6);
  g.addColorStop(0, 'rgba(255,200,90,.45)'); g.addColorStop(1, 'rgba(255,200,90,0)');
  ctx.fillStyle = g; ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
  blob(ctx, x, y, r, r, seed, boil, 0.04); clay(ctx, x, y, r, K.sun, seed, 2);
  ctx.restore();
}
function cloud(ctx, x, y, r, seed, boil, tone) {
  [[-0.6, 0.1, 0.55], [0, -0.15, 0.7], [0.6, 0.1, 0.55]].forEach(([dx, dy, k], i) => {
    blob(ctx, x + dx * r, y + dy * r, r * k, r * k * 0.85, seed + i, boil, 0.05); clay(ctx, x + dx * r, y + dy * r, r * k, tone || K.cloud, seed + i, 1);
  });
}
function ball(ctx, x, y, r, color, seed, boil) { blob(ctx, x, y, r, r, seed, boil, 0.06); clay(ctx, x, y, r, color, seed, 0); }

// ---------- 인물 장면 (자세마다) ----------
function stage(ctx, pose, x, y, s, tt, dur, seed, boil) {
  const A = K.people[0], B = K.people[1];
  const sw = Math.sin(tt * 2.2);
  if (pose === 'read') {
    const nod = Math.sin(tt * 1.6) * 0.04;
    person(ctx, x, y, s, { tilt: 0.12 + nod, look: [0, 0.6], eyes: 'down', mouth: 'smile',
      armL: [[-0.12, 0.2], [-0.02, 0.1]], armR: [[0.12, 0.2], [0.02, 0.1]], legL: [[-0.02, 0.2], [-0.04, 0.4]], legR: [[0.02, 0.2], [0.04, 0.4]] }, A, seed, boil);
    book(ctx, x, y - s * 0.66, s * 0.9, 0.5 + 0.5 * Math.sin(tt * 0.7), seed + 40, boil);
    // 책에서 떠오르는 글자 조각
    for (let i = 0; i < 4; i++) {
      const u = ((tt * 0.35 + i / 4) % 1);
      ctx.globalAlpha = Math.sin(u * Math.PI) * 0.9;
      ball(ctx, x + (i - 1.5) * s * 0.12 + Math.sin(u * 6 + i) * s * 0.04, y - s * (0.78 + u * 0.55), s * 0.025, K.people[(i + 1) % 4][0], seed + i * 9, boil);
      ctx.globalAlpha = 1;
    }
  } else if (pose === 'think') {
    person(ctx, x, y, s, { tilt: -0.14 + sw * 0.03, look: [0.6, -0.7], mouth: 'flat',
      armL: [[-0.1, 0.22], [-0.05, 0.4]], armR: [[0.16, 0.12], [0.06, -0.2]], legL: [[-0.02, 0.2], [-0.04, 0.4]], legR: [[0.02, 0.2], [0.04, 0.4]] }, A, seed, boil);
    const phase = (tt % 5) / 5;
    [[0.25, -1.05, 0.04], [0.36, -1.2, 0.06], [0.5, -1.38, 0.09]].forEach(([dx, dy, r], i) => {
      const a = ease((phase - i * 0.12) * 4);
      if (a > 0) { ctx.globalAlpha = a; ball(ctx, x + dx * s, y + dy * s, r * s * pop((phase - i * 0.12) * 4), K.cream, seed + i, boil); }
    });
    ctx.globalAlpha = 1;
    if (phase > 0.45) {
      const k = pop((phase - 0.45) * 3);
      const bx = x + s * 0.62, by = y - s * 1.62;
      ctx.save(); const g = ctx.createRadialGradient(bx, by, 0, bx, by, s * 0.4); g.addColorStop(0, 'rgba(255,220,120,.6)'); g.addColorStop(1, 'rgba(255,220,120,0)');
      ctx.fillStyle = g; ctx.fillRect(bx - s * 0.4, by - s * 0.4, s * 0.8, s * 0.8); ctx.restore();
      blob(ctx, bx, by, s * 0.11 * k, s * 0.12 * k, seed + 50, boil); clay(ctx, bx, by, s * 0.12 * k, K.bulb, seed + 50, 1);
      blob(ctx, bx, by + s * 0.14 * k, s * 0.05 * k, s * 0.035 * k, seed + 51, boil); clay(ctx, bx, by + s * 0.14 * k, s * 0.05 * k, '#9a8f86', seed, 0);
    }
  } else if (pose === 'comfort') {
    const lean = 0.04 * Math.sin(tt * 1.2);
    const up = Math.min(1, tt / Math.max(dur * 0.6, 1));
    person(ctx, x + s * 0.3, y, s * 0.88, { tilt: 0.25 - up * 0.2, look: [-0.5, 0.8 - up * 1.2], eyes: up > 0.6 ? 'open' : 'down', mouth: up > 0.6 ? 'smile' : 'flat',
      armL: [[-0.1, 0.22], [-0.06, 0.4]], armR: [[0.1, 0.22], [0.06, 0.4]], legL: [[-0.02, 0.2], [-0.04, 0.4]], legR: [[0.02, 0.2], [0.04, 0.4]] }, B, seed + 20, boil);
    person(ctx, x - s * 0.22, y, s, { lean: 0.08 + lean, tilt: 0.18, look: [0.8, 0.4], eyes: 'closed', mouth: 'smile', armBehind: -1,
      armL: [[-0.1, 0.22], [-0.06, 0.4]], armR: [[0.22, -0.02], [0.44, 0.06 + lean]], legL: [[-0.02, 0.2], [-0.04, 0.4]], legR: [[0.02, 0.2], [0.04, 0.4]] }, A, seed, boil);
    for (let i = 0; i < 3; i++) {
      const u = (tt * 0.25 + i / 3) % 1;
      ctx.globalAlpha = Math.sin(u * Math.PI);
      heart(ctx, x + s * (0.05 + 0.1 * Math.sin(u * 5 + i)), y - s * (1.05 + u * 0.6), s * (0.05 + 0.03 * u), seed + i * 7, boil);
    }
    ctx.globalAlpha = 1;
  } else if (pose === 'walk') {
    const ph = tt * 4.5, a = Math.sin(ph), travel = ((tt / Math.max(dur, 4)) - 0.5) * s * 0.5;
    for (let i = 0; i < 5; i++) { blob(ctx, x - s * 0.8 + i * s * 0.4, y + s * 0.03, s * 0.09, s * 0.03, seed + i * 3, boil, 0.1); clay(ctx, x - s * 0.8 + i * s * 0.4, y + s * 0.03, s * 0.09, '#d6b48c', seed + i, 0); }
    person(ctx, x + travel, y, s, { bob: -Math.abs(a) * 0.03, lean: 0.05, look: [1, 0], mouth: 'smile',
      armL: [[-0.04 - a * 0.1, 0.2], [-a * 0.2, 0.36]], armR: [[0.04 + a * 0.1, 0.2], [a * 0.2, 0.36]],
      legL: [[a * 0.1, 0.2], [a * 0.2, 0.4]], legR: [[-a * 0.1, 0.2], [-a * 0.2, 0.4]] }, A, seed, boil);
    // 깃발
    const fx = x + s * 0.75, fy = y;
    limb(ctx, [[fx, fy], [fx, fy - s * 0.7]], s * 0.035, '#8a5a3a');
    ctx.beginPath(); ctx.moveTo(fx, fy - s * 0.7); ctx.quadraticCurveTo(fx + s * 0.18, fy - s * (0.66 + 0.03 * Math.sin(tt * 3)), fx + s * 0.3, fy - s * 0.6); ctx.lineTo(fx, fy - s * 0.52); ctx.closePath();
    clay(ctx, fx + s * 0.12, fy - s * 0.62, s * 0.15, K.sun, seed + 60, 1);
  } else if (pose === 'rest') {
    shadowAt(ctx, x - s * 0.02, y + s * 0.02, s * 0.45);
    blob(ctx, x - s * 0.04, y - s * 0.2, s * 0.26, s * 0.21, seed + 30, boil, 0.03); clay(ctx, x - s * 0.04, y - s * 0.2, s * 0.26, '#b88e6a', seed + 30, 2);
    const br = Math.sin(tt * 1.3) * 0.02;
    person(ctx, x, y - s * 0.2, s, { sit: true, bob: br, tilt: 0.1, eyes: 'closed', mouth: 'smile',
      armL: [[-0.12, 0.18], [0.0, 0.18]], armR: [[0.14, 0.16], [0.06, 0.16]], legL: [[0.2, 0.0], [0.22, 0.24]], legR: [[0.26, 0.02], [0.3, 0.24]] }, A, seed, boil);
    const cx = x + s * 0.04, cy = y - s * 0.44 + br * s;
    blob(ctx, cx, cy, s * 0.07, s * 0.06, seed + 70, boil, 0.04); clay(ctx, cx, cy, s * 0.07, K.cream, seed + 70, 0);
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = s * 0.014; ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const u = (tt * 0.5 + i * 0.5) % 1; ctx.globalAlpha = Math.sin(u * Math.PI) * 0.8;
      ctx.beginPath();
      for (let k = 0; k <= 10; k++) { const yy = cy - s * 0.08 - k * s * 0.025 - u * s * 0.1; const xx = cx + (i - 0.5) * s * 0.05 + Math.sin(k * 0.8 + tt * 2) * s * 0.02; k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }
      ctx.stroke();
    }
    ctx.restore();
  } else if (pose === 'cheer') {
    const j = Math.abs(Math.sin(tt * 3.2)), w = Math.sin(tt * 6.4) * 0.05;
    person(ctx, x, y - j * s * 0.06, s, { look: [0, -0.4], mouth: 'open', tilt: w,
      armL: [[-0.16, -0.12], [-0.22 - w, -0.34]], armR: [[0.16, -0.12], [0.22 - w, -0.34]], legL: [[-0.04, 0.2], [-0.06, 0.4]], legR: [[0.04, 0.2], [0.06, 0.4]] }, A, seed, boil);
    for (let i = 0; i < 12; i++) {
      const u = (tt * 0.4 + rnd(seed + i)) % 1;
      ball(ctx, x + (rnd(seed + i * 3) - 0.5) * s * 1.6, y - s * (1.7 - u * 1.5), s * 0.025, K.people[i % 4][0], seed + i, boil);
    }
  } else if (pose === 'write') {
    blob(ctx, x + s * 0.28, y - s * 0.3, s * 0.36, s * 0.06, seed + 80, boil, 0.02); clay(ctx, x + s * 0.28, y - s * 0.3, s * 0.36, '#a8744c', seed + 80, 1);
    limb(ctx, [[x + s * 0.02, y - s * 0.3], [x + s * 0.02, y]], s * 0.06, '#8a5a3a'); limb(ctx, [[x + s * 0.56, y - s * 0.3], [x + s * 0.56, y]], s * 0.06, '#8a5a3a');
    blob(ctx, x + s * 0.32, y - s * 0.37, s * 0.2, s * 0.04, seed + 81, boil, 0.02); clay(ctx, x + s * 0.32, y - s * 0.37, s * 0.2, K.paper, seed + 81, 0);
    const lines = Math.min(3, (tt * 0.6) % 4);
    ctx.save(); ctx.strokeStyle = 'rgba(74,47,30,.6)'; ctx.lineWidth = s * 0.01; ctx.lineCap = 'round';
    for (let l = 0; l < Math.ceil(lines); l++) { const len = Math.min(1, lines - l); ctx.beginPath(); ctx.moveTo(x + s * 0.18, y - s * (0.39 - l * 0.016)); ctx.lineTo(x + s * (0.18 + 0.26 * len), y - s * (0.39 - l * 0.016)); ctx.stroke(); }
    ctx.restore();
    const hx = Math.sin(tt * 7) * 0.04;
    const P = person(ctx, x - s * 0.14, y, s, { tilt: 0.2, look: [0.8, 0.8], eyes: 'down', mouth: 'flat',
      armL: [[0.1, 0.16], [0.2, 0.2]], armR: [[0.22, 0.12], [0.34 + hx, 0.26]], legL: [[0.0, 0.2], [-0.02, 0.4]], legR: [[0.04, 0.2], [0.06, 0.4]] }, A, seed, boil);
    const h = P.hand(1);
    limb(ctx, [[h[0], h[1]], [h[0] + s * 0.05, h[1] - s * 0.14]], s * 0.03, K.sun);
  } else if (pose === 'hope') {
    const rise = ease(tt / Math.max(dur * 0.8, 2));
    sun(ctx, x + s * 0.55, y - s * (0.9 + rise * 0.6), s * 0.16, tt, seed + 90, boil);
    person(ctx, x - s * 0.1, y, s, { tilt: -0.22, look: [0.6, -1], eyes: 'up', mouth: 'smile',
      armL: [[-0.1, 0.22], [-0.06, 0.4]], armR: [[0.14, -0.08], [0.26, -0.24 - rise * 0.1]], legL: [[-0.02, 0.2], [-0.04, 0.4]], legR: [[0.02, 0.2], [0.04, 0.4]] }, A, seed, boil);
  } else if (pose === 'sad') {
    const lift = ease((tt / Math.max(dur, 3) - 0.55) * 3);
    person(ctx, x, y, s, { tilt: 0.32 - lift * 0.25, bob: 0.04 - lift * 0.04, look: [0, 1 - lift * 1.4], eyes: lift > 0.5 ? 'open' : 'down', mouth: lift > 0.5 ? 'flat' : 'sad',
      armL: [[-0.08, 0.24], [-0.02, 0.42]], armR: [[0.08, 0.24], [0.02, 0.42]], legL: [[-0.02, 0.2], [-0.04, 0.4]], legR: [[0.02, 0.2], [0.04, 0.4]] }, A, seed, boil);
    const cy = y - s * 1.62;
    ctx.globalAlpha = 1 - lift * 0.7;
    cloud(ctx, x, cy, s * 0.22, seed + 95, boil);
    for (let i = 0; i < 5; i++) {
      const u = (tt * 0.8 + i / 5) % 1;
      ctx.globalAlpha = (1 - u) * (1 - lift);
      blob(ctx, x + (i - 2) * s * 0.08, cy + s * (0.2 + u * 0.4), s * 0.018, s * 0.03, seed + i, boil); clay(ctx, x + (i - 2) * s * 0.08, cy + s * 0.3, s * 0.03, K.drop, seed, 0);
    }
    ctx.globalAlpha = 1;
    if (lift > 0) { ctx.globalAlpha = lift; heart(ctx, x + s * 0.32, y - s * 1.0, s * 0.07 * pop(lift), seed + 99, boil); ctx.globalAlpha = 1; }
  }
}

// ---------- 지문 글씨 ----------
const CLAY_FONT = '"Jua", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
let tmp = null;
function clayText(ctx, lines, cx, top, size, lineH, shown, boil, color, seed) {
  const W = Math.ceil(ctx.canvas.width), Hh = Math.ceil(lines.length * lineH + size);
  if (!tmp) tmp = document.createElement('canvas');
  if (tmp.width !== W || tmp.height < Hh) { tmp.width = W; tmp.height = Hh; }
  const t = tmp.getContext('2d');
  t.setTransform(1, 0, 0, 1, 0, 0); t.globalCompositeOperation = 'source-over'; t.globalAlpha = 1;
  t.clearRect(0, 0, tmp.width, tmp.height);
  t.font = size + 'px ' + CLAY_FONT; t.textBaseline = 'middle'; t.textAlign = 'left';
  let n = 0;
  lines.forEach((line, li) => {
    const chars = Array.from(line), full = t.measureText(line).width;
    let x = cx - full / 2;
    const y = li * lineH + lineH / 2 + size * 0.2;
    chars.forEach((ch, ci) => {
      const w = t.measureText(ch).width, k = n++;
      const a = Math.min(1, Math.max(0, shown - k));
      if (a > 0 && ch.trim()) {
        const sc = pop(a);
        t.save();
        t.translate(x + w / 2 + (rnd(k * 3 + boil) - 0.5) * size * 0.03, y + (rnd(k * 5 + boil) - 0.5) * size * 0.03);
        t.rotate((rnd(k * 7 + seed) - 0.5) * 0.09 + (rnd(k + boil * 11) - 0.5) * 0.03);
        t.scale(sc, sc);
        t.fillStyle = color; t.fillText(ch, -w / 2, 0);
        t.restore();
      }
      x += w;
    });
  });
  // 점토 질감: 위는 밝게, 아래는 어둡게 + 지문 결
  t.globalCompositeOperation = 'source-atop';
  const g = t.createLinearGradient(0, 0, 0, lineH);
  g.addColorStop(0, 'rgba(255,240,215,.35)'); g.addColorStop(0.45, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(40,15,5,.35)');
  for (let li = 0; li < lines.length; li++) { t.save(); t.translate(0, li * lineH + size * 0.2); t.fillStyle = g; t.fillRect(0, 0, W, lineH); t.restore(); }
  t.strokeStyle = 'rgba(30,12,4,.22)'; t.lineWidth = Math.max(1, size * 0.03);
  for (let p = 0; p < Math.max(3, lines.length * 4); p++) {
    const px = cx + (rnd(seed + p * 2.3) - 0.5) * W * 0.6, py = rnd(seed + p * 4.1) * Hh, pr = size * (0.6 + rnd(p + seed) * 0.6), rot = rnd(p * 9 + seed) * 3;
    for (let k = 1; k <= 6; k++) { t.beginPath(); t.ellipse(px, py, pr * k / 6, pr * k / 6 * 0.7, rot, 0.3 * k, Math.PI * 1.7 + 0.3 * k); t.stroke(); }
  }
  t.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.shadowColor = 'rgba(70,30,10,.45)'; ctx.shadowBlur = size * 0.1; ctx.shadowOffsetX = size * 0.03; ctx.shadowOffsetY = size * 0.07;
  ctx.drawImage(tmp, 0, 0, W, Hh, 0, top - size * 0.2, W, Hh);
  ctx.restore();
}

// 글자에 필요한 글꼴 조각을 미리 받아 둔다 (한글 웹글꼴은 글자 범위별로 나뉘어 있어서)
export async function prepare(texts) {
  const all = Array.from(new Set(Array.from(texts.join('')))).join('');
  try { await document.fonts.load('60px "Jua"', all || '가'); await document.fonts.load('700 40px "Noto Sans KR"', all || '가'); } catch (e) { /* 글꼴 없이도 그린다 */ }
}

// ---------- 장면 하나 ----------
let frameCache = null;
export function draw(ctx, W, H, scene, t, dur, info, U) {
  const frame = Math.floor(t * FPS), tt = frame / FPS, boil = Math.floor(t * FPS / 2) % 3;
  const key = [scene._id, frame, W, H, Math.round(info.progress * 200)].join('|');
  if (!frameCache || frameCache.width !== W || frameCache.height !== H) { frameCache = document.createElement('canvas'); frameCache.width = W; frameCache.height = H; frameCache.key = ''; }
  if (frameCache.key !== key) { render(frameCache.getContext('2d'), W, H, scene, tt, dur, info, U, frame, boil); frameCache.key = key; }
  ctx.save(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(frameCache, 0, 0); ctx.restore();
}

function render(ctx, W, H, scene, tt, dur, info, U, frame, boil) {
  const vertical = H > W, S = Math.min(W, H), seed = scene.seed || 0;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.shadowColor = 'transparent';
  // 무대: 벽 + 탁자
  const tableY = H * (vertical ? 0.8 : 0.74);
  let g = ctx.createLinearGradient(0, 0, 0, tableY);
  g.addColorStop(0, K.wall2); g.addColorStop(1, K.wall1);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, tableY);
  // 벽의 손자국 결
  ctx.save(); ctx.globalAlpha = 0.5; prints(ctx, W * 0.2, H * 0.2, S * 0.5, K.wall1, 3, 3); prints(ctx, W * 0.8, H * 0.5, S * 0.5, K.wall1, 7, 3); ctx.restore();
  g = ctx.createLinearGradient(0, tableY, 0, H);
  g.addColorStop(0, K.table1); g.addColorStop(1, K.table2);
  ctx.fillStyle = g; ctx.fillRect(0, tableY, W, H - tableY);
  ctx.fillStyle = 'rgba(255,220,170,.35)'; ctx.fillRect(0, tableY, W, S * 0.006);
  ctx.save(); ctx.globalAlpha = 0.35; ctx.strokeStyle = shade(K.table2, -0.2); ctx.lineWidth = S * 0.003;
  for (let i = 0; i < 5; i++) { ctx.beginPath(); const yy = tableY + (H - tableY) * (0.2 + i * 0.18); ctx.moveTo(0, yy); ctx.bezierCurveTo(W * 0.3, yy + S * 0.01, W * 0.6, yy - S * 0.012, W, yy + S * 0.004); ctx.stroke(); }
  ctx.restore();

  // 따뜻한 조명 (왼쪽 위 스포트라이트)
  const flick = 1 + (rnd(frame * 1.7) - 0.5) * 0.06;
  g = ctx.createRadialGradient(W * 0.32, H * 0.18, S * 0.05, W * 0.4, H * 0.4, S * 1.1);
  g.addColorStop(0, 'rgba(255,214,140,' + (0.55 * flick) + ')'); g.addColorStop(0.6, 'rgba(255,170,90,.12)'); g.addColorStop(1, 'rgba(255,150,80,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // 배치
  let charX, charY, charS, box;
  if (vertical) { charX = W * 0.5; charY = H * 0.86; charS = H * 0.24; box = { x: W * 0.07, y: H * 0.13, w: W * 0.86, h: H * 0.4 }; }
  else { charX = W * 0.25; charY = H * 0.84; charS = H * 0.42; box = { x: W * 0.45, y: H * 0.14, w: W * 0.5, h: H * 0.6 }; }
  const pose = scene.pose && POSES[scene.pose] ? scene.pose : autoPose(scene);
  if (pose === 'none') { box = vertical ? { x: W * 0.07, y: H * 0.2, w: W * 0.86, h: H * 0.5 } : { x: W * 0.12, y: H * 0.16, w: W * 0.76, h: H * 0.56 }; }

  // 글 받침 (점토 판)
  const mainText = scene.screen || scene.say || '';
  const isTitle = scene.kind === 'title' || scene.kind === 'heading';
  if (mainText) {
    const appear = pop(tt * 2.2);
    const bx = box.x + box.w / 2, by = box.y + box.h / 2;
    ctx.save(); ctx.translate(bx, by); ctx.scale(appear, appear); ctx.rotate((rnd(seed) - 0.5) * 0.03);
    ctx.shadowColor = 'rgba(80,35,10,.35)'; ctx.shadowBlur = S * 0.03; ctx.shadowOffsetY = S * 0.018;
    blob(ctx, 0, 0, box.w / 2, box.h / 2, seed + 200, boil, 0.025);
    ctx.fillStyle = K.plate; ctx.fill(); ctx.shadowColor = 'transparent';
    clay(ctx, 0, 0, Math.max(box.w, box.h) / 2, scene.kind === 'quote' ? K.plate : '#f8e3c0', seed + 201, 3);
    ctx.restore();
    if (scene.kind === 'quote') {
      ctx.save(); ctx.font = Math.round(S * 0.16) + 'px ' + CLAY_FONT; ctx.fillStyle = shade(K.people[0][0], -0.05); ctx.globalAlpha = 0.85 * appear;
      ctx.textBaseline = 'top'; ctx.textAlign = 'left'; ctx.fillText('“', box.x + box.w * 0.03, box.y - S * 0.04); ctx.restore();
    }
  }
  if (pose !== 'none') stage(ctx, pose, charX, charY, charS, tt, dur, seed, boil);

  // 지문 글씨
  if (mainText) {
    const cs = U.chunks(mainText, vertical ? 56 : 70);
    const idx = U.pickChunk(cs, tt, dur), main = cs[idx] || '';
    const ct = tt - U.chunkStart(cs, idx, dur);
    const innerW = box.w * 0.84, innerH = box.h * 0.78;
    let size = S * (isTitle ? 0.1 : main.length < 24 ? 0.082 : main.length < 50 ? 0.066 : 0.054), lines;
    for (;;) {
      ctx.font = size + 'px ' + CLAY_FONT;
      lines = U.wrap(ctx, main, innerW);
      if (lines.length * size * 1.4 < innerH || size < S * 0.028) break;
      size *= 0.92;
    }
    const lineH = size * 1.4, top = box.y + box.h / 2 - lines.length * lineH / 2;
    const shown = (ct - 0.25) * 16; // 1초에 16글자씩 빚어져 나옴
    clayText(ctx, lines, box.x + box.w / 2, top, size, lineH, shown, boil, isTitle ? '#c4532f' : K.ink, seed + idx * 17);
  }

  // 장면 이름 (작은 점토 알약) + 진행 막대
  const label = scene.part || '';
  if (label && !isTitle) {
    ctx.font = '700 ' + Math.round(S * 0.03) + 'px ' + U.FONT;
    const lw = ctx.measureText(label).width + S * 0.06, lh = S * 0.06, lx = vertical ? W * 0.07 : W * 0.04, ly = vertical ? H * 0.06 : H * 0.05;
    blob(ctx, lx + lw / 2, ly + lh / 2, lw / 2, lh / 2, seed + 300, boil, 0.03); clay(ctx, lx + lw / 2, ly + lh / 2, lw / 2, K.people[3][0], seed + 300, 1);
    ctx.fillStyle = '#4a2f1e'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(label, lx + S * 0.03, ly + lh / 2 + 1);
  }
  ctx.fillStyle = 'rgba(74,47,30,.18)'; ctx.fillRect(0, H - S * 0.01, W, S * 0.01);
  ctx.fillStyle = K.people[0][0]; ctx.fillRect(0, H - S * 0.01, W * Math.min(info.progress, 1), S * 0.01);
  if (scene.book) {
    ctx.font = '600 ' + Math.round(S * 0.024) + 'px ' + U.FONT; ctx.fillStyle = 'rgba(255,240,220,.85)';
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'; ctx.fillText(scene.book, W - S * 0.04, H - S * 0.035);
  }

  // 가장자리 어둡게 + 필름 알갱이 + 장면 시작 때 불 켜지듯
  g = ctx.createRadialGradient(W / 2, H * 0.45, S * 0.45, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(40,15,0,0)'); g.addColorStop(1, 'rgba(40,15,0,.45)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(60,30,10,.06)';
  for (let i = 0; i < 220; i++) ctx.fillRect(rnd(frame * 1000 + i) * W, rnd(frame * 2000 + i * 3) * H, S * 0.002, S * 0.002);
  if (tt < 0.42) { ctx.globalAlpha = 1 - tt / 0.42; ctx.fillStyle = '#2a1408'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  ctx.restore();
}
