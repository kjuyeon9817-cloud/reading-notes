// 내가 쓴 md 파일 → 영상 장면. 글은 한 글자도 바꾸지 않는다.
// 규칙 (README에도 적어 둠)
//   # 제목            → 영상 제목 + 첫 화면 (읽을 글 없음)
//   ## 소제목          → 소제목 화면 (읽을 글 없음), 아래 장면들의 이름이 됨
//   > 발췌 문장 (p.23) → 발췌 장면 (화면에는 쪽수까지, 읽을 글에는 쪽수 빼고)
//   빈 줄로 나뉜 문단  → 내 생각 장면 하나
//   - 목록 한 줄       → 장면 하나
//   [인물: 위로]       → 이 장면에 나올 인물 (줄 안 어디에 있어도 되고, 혼자 한 줄이면 다음 장면에 붙음)
//   --- , 빈 줄        → 장면 나눔
// 꾸밈 기호(**굵게**, `코드`, [글](링크))만 벗기고 글은 그대로 둔다.

const POSE_ALIASES = {
  read: ['읽기', '책', '책 읽기', '독서', 'read'],
  think: ['생각', '생각하기', '고민', 'think'],
  comfort: ['위로', '안아주기', '포옹', '함께', 'comfort', 'hug'],
  walk: ['걷기', '걸어가기', '시작', '도전', 'walk'],
  rest: ['쉬기', '쉬어가기', '휴식', 'rest'],
  cheer: ['기쁨', '기뻐하기', '감사', '행복', 'cheer', 'joy'],
  write: ['쓰기', '기록', '기록하기', '글쓰기', 'write'],
  hope: ['희망', '하늘', '하늘 보기', '내일', 'hope'],
  sad: ['슬픔', '힘듦', '고개 숙이기', '지침', 'sad'],
  none: ['없음', '인물 없음', 'none']
};
export function poseFromWord(w) {
  w = String(w || '').trim().toLowerCase();
  for (const k in POSE_ALIASES) if (POSE_ALIASES[k].some(a => a.toLowerCase() === w)) return k;
  return '';
}

const POSE_TAG = /[\[［]\s*(?:인물|캐릭터|character)\s*[:：]\s*([^\]］]+)[\]］]|<!--\s*(?:인물|캐릭터|character)\s*[:：]\s*(.+?)\s*-->/gi;
const PAGE_TAIL = /\s*[(（]\s*(?:p\.?|pp\.?|P\.?)?\s*\d+[^)）]*[)）]\s*$|\s*[(（][^)）]*\d+\s*(?:쪽|페이지|p)[^)）]*[)）]\s*$/;

function inline(s) {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1$2')
    .replace(/~~([^~]+)~~/g, '$1');
}

export function parseMd(text) {
  let src = String(text || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  src = src.replace(/^---\n[\s\S]*?\n---\n/, ''); // 맨 위 머리말(front matter)
  const lines = src.split('\n');
  const scenes = [];
  let title = '', section = '', pending = '', buf = null; // buf = { kind, lines }
  let nQuote = 0, nThought = 0;

  function takePose(s) {
    let pose = '';
    s = s.replace(POSE_TAG, (m, a, b) => { pose = poseFromWord(a || b) || pose; return ''; });
    return { s: s.replace(/[ \t]+$/g, ''), pose };
  }
  function flush() {
    if (!buf) return;
    const raw = buf.lines.join('\n');
    const { s, pose } = takePose(raw);
    const body = inline(s).split('\n').map(x => x.trim()).join('\n').trim();
    const usePose = pose || pending; pending = '';
    if (body) {
      if (buf.kind === 'quote') {
        nQuote++;
        const say = body.replace(PAGE_TAIL, '').trim();
        scenes.push({ kind: 'quote', part: section || ('발췌 ' + nQuote), screen: body, say: say || body, same: true, pose: usePose });
      } else {
        nThought++;
        scenes.push({ kind: 'thought', part: section || ('내 생각 ' + nThought), screen: body, say: body, same: true, pose: usePose });
      }
    } else if (usePose) pending = usePose;
    buf = null;
  }

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flush(); continue; }
    // 인물 표시가 아닌 주석 한 줄(<!-- 저자 · 날짜 -->)은 영상에 넣지 않는다
    if (/^<!--[\s\S]*-->$/.test(trimmed) && !/(인물|캐릭터|character)\s*[:：]/i.test(trimmed)) continue;
    // 인물 표시만 있는 줄 → 다음 장면에
    const only = takePose(trimmed);
    if (only.pose && !only.s.trim()) { if (buf) { flush(); } pending = only.pose; continue; }
    let m = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      flush();
      const { s, pose } = takePose(m[2]);
      const h = inline(s).replace(/\s*#+\s*$/, '').trim();
      if (!h) continue;
      if (m[1].length === 1 && !title) { title = h; scenes.push({ kind: 'title', part: '제목', screen: h, say: '', pose: pose || pending || 'read' }); }
      else { section = h; scenes.push({ kind: 'heading', part: h, screen: h, say: '', pose: pose || pending }); }
      pending = '';
      continue;
    }
    m = line.match(/^\s*>\s?(.*)$/);
    if (m) {
      if (buf && buf.kind !== 'quote') flush();
      if (!buf) buf = { kind: 'quote', lines: [] };
      if (!m[1].trim()) { flush(); continue; } // 인용 안의 빈 줄 = 다음 발췌
      buf.lines.push(m[1]);
      continue;
    }
    m = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (m) { flush(); buf = { kind: 'item', lines: [m[1]] }; continue; }
    if (buf && buf.kind === 'quote') flush();
    if (!buf) buf = { kind: 'para', lines: [] };
    buf.lines.push(line);
  }
  flush();
  return { title, scenes };
}

if (typeof window !== 'undefined') window.RNmd = { parseMd, poseFromWord };
