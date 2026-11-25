// 독서 기록 → 마크다운 파일 → wikiagent(옵시디언 볼트)의 00_Raw/날짜/ 폴더
// 컴퓨터 크롬·엣지는 폴더에 바로 저장(File System Access API). 안 되는 기기는 파일로 내려받는다.

const DB = 'rn-fs', STORE = 'handles', KEY = 'vault';

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const d = await idb();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const q = fn(t.objectStore(STORE));
    t.oncomplete = () => res(q && q.result);
    t.onerror = () => rej(t.error);
  });
}

export function supported() { return typeof window.showDirectoryPicker === 'function'; }

export async function getFolder() {
  if (!supported()) return null;
  try { return (await tx('readonly', s => s.get(KEY))) || null; } catch (e) { return null; }
}

export async function pickFolder() {
  const h = await window.showDirectoryPicker({ id: 'wikiagent', mode: 'readwrite' });
  await tx('readwrite', s => s.put(h, KEY));
  return h;
}

export async function forgetFolder() { await tx('readwrite', s => s.delete(KEY)); }

async function permitted(h) {
  const o = { mode: 'readwrite' };
  if ((await h.queryPermission(o)) === 'granted') return true;
  return (await h.requestPermission(o)) === 'granted';
}

// notes: [{ folder: 'YYYY-MM-DD', fileName, text }]
export async function writeNotes(h, notes) {
  if (!(await permitted(h))) throw new Error('폴더에 저장할 권한을 받지 못했어요. 다시 눌러서 "허용"을 골라 주세요.');
  // wikiagent 폴더를 골랐으면 그 안의 00_Raw에, 00_Raw를 직접 골랐으면 거기에 저장
  const raw = h.name === '00_Raw' ? h : await h.getDirectoryHandle('00_Raw', { create: true });
  const written = [];
  for (const n of notes) {
    const dir = await raw.getDirectoryHandle(n.folder, { create: true });
    const f = await dir.getFileHandle(n.fileName, { create: true });
    const w = await f.createWritable();
    await w.write(n.text); await w.close();
    written.push((h.name === '00_Raw' ? '' : '00_Raw/') + n.folder + '/' + n.fileName);
  }
  return written;
}

function save(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// 폴더 저장이 안 되는 기기: 하나면 그대로, 여러 개면 한 파일로 묶어서 내려받는다
export function download(notes) {
  if (notes.length === 1) { save(notes[0].fileName, notes[0].text); return; }
  save('독서노트-모음-' + new Date().toISOString().slice(0, 10) + '.md',
    notes.map(n => '<!-- ' + n.folder + '/' + n.fileName + ' -->\n' + n.text).join('\n\n---\n\n'));
}
