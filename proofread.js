// 맞춤법·문맥 다듬기: 고칠 곳을 "제안"만 받고, 적용은 사람이 하나씩 고른다.
// Claude(Anthropic SDK) 또는 내 컴퓨터의 Ollama 중 하나를 쓴다.

const SYSTEM = [
  '당신은 독서 기록의 맞춤법 교정자입니다.',
  '이 기록은 글쓴이가 AI에 기대지 않고 자기 생각을 자기 말로 쓰려고 직접 쓴 글입니다. 서툴러도 글쓴이의 목소리가 남아 있어야 합니다.',
  '',
  '할 일:',
  '- 오타, 맞춤법, 띄어쓰기, 명백한 문법 오류를 고칩니다.',
  '- 뜻이 잘 통하지 않을 만큼 어색하거나 끊긴 문장만 최소한으로 다듬습니다.',
  '',
  '하지 말 것:',
  '- 말투를 바꾸지 않습니다. 글쓴이가 "~함", "~했다", "~해요" 중 무엇을 쓰든 그대로 둡니다.',
  '- 더 멋지거나 세련된 문장으로 바꾸지 않습니다. 단어 선택과 문장 길이를 유지합니다.',
  '- 내용을 더하거나 빼거나 생각을 바꾸지 않습니다.',
  '',
  '고칠 것이 없는 항목은 suggestions에 넣지 않습니다. 넣는 항목은 id를 그대로 쓰고,',
  'revised에는 그 항목 전체를 고친 글로, reason에는 무엇을 왜 고쳤는지 한국어 한 문장으로 적습니다.'
].join('\n');

const SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          revised: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['id', 'revised', 'reason'],
        additionalProperties: false
      }
    }
  },
  required: ['suggestions'],
  additionalProperties: false
};

// fields: [{ id, label, text }]  →  [{ id, revised, reason }]
function clean(fields, suggestions) {
  const byId = Object.fromEntries(fields.map(f => [f.id, f.text]));
  return (suggestions || []).filter(s => s && typeof s.revised === 'string' && byId[s.id] != null &&
    s.revised.trim() && s.revised.trim() !== byId[s.id].trim())
    .map(s => ({ id: s.id, revised: s.revised, reason: s.reason || '' }));
}

export async function proofread(apiKey, fields) {
  const { default: Anthropic } = await import('./vendor/anthropic-sdk.js');
  const client = new Anthropic({ apiKey: apiKey, dangerouslyAllowBrowser: true });
  let res;
  try {
    res = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify({ fields: fields }) }]
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('API 키가 맞지 않아요. 설정에서 다시 확인해 주세요.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('요청이 많아서 잠시 막혔어요. 1분쯤 뒤에 다시 해주세요.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('인터넷 연결을 확인해 주세요.');
    if (e instanceof Anthropic.APIError) throw new Error('Claude 응답 오류 (' + (e.status || '') + '): ' + e.message);
    throw e;
  }
  if (res.stop_reason === 'refusal') throw new Error('이 내용은 검토할 수 없다는 응답이 왔어요.');
  if (res.stop_reason === 'max_tokens') throw new Error('글이 너무 길어서 끝까지 검토하지 못했어요.');
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return clean(fields, JSON.parse(text).suggestions);
}

// Ollama: 내 컴퓨터에서 돌아가는 모델. 기록이 밖으로 나가지 않는다.
function ollamaBase(url) { return (url || 'http://localhost:11434').replace(/\/+$/, ''); }

function ollamaError(e) {
  return new Error('Ollama에 연결하지 못했어요. Ollama가 켜져 있는지, 그리고 OLLAMA_ORIGINS 설정을 했는지 확인해 주세요. (' + (e.message || e) + ')');
}

export async function ollamaModels(url) {
  let res;
  try { res = await fetch(ollamaBase(url) + '/api/tags'); } catch (e) { throw ollamaError(e); }
  if (!res.ok) throw new Error('Ollama 응답 오류 ' + res.status);
  const j = await res.json();
  return (j.models || []).map(m => m.name);
}

export async function proofreadOllama(url, model, fields) {
  let res;
  try {
    res = await fetch(ollamaBase(url) + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        stream: false,
        format: SCHEMA,
        options: { temperature: 0 },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify({ fields: fields }) }
        ]
      })
    });
  } catch (e) { throw ollamaError(e); }
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).error || ''; } catch (e) { /* ignore */ }
    if (res.status === 404) throw new Error('"' + model + '" 모델을 찾지 못했어요. 설정에서 모델 목록을 다시 불러와 골라주세요.');
    throw new Error('Ollama 응답 오류 ' + res.status + ' ' + msg);
  }
  const j = await res.json();
  let parsed;
  try { parsed = JSON.parse(j.message && j.message.content); }
  catch (e) { throw new Error('모델이 형식에 맞지 않는 답을 줬어요. 다시 살펴보기를 눌러주세요.'); }
  return clean(fields, parsed.suggestions);
}

// LM Studio: OpenAI 호환 서버 (기본 http://127.0.0.1:1234). 서버 설정에서 Enable CORS를 켜야 한다.
function lmBase(url) { return (url || 'http://127.0.0.1:1234').replace(/\/+$/, ''); }
function lmError(e) {
  return new Error('LM Studio에 연결하지 못했어요. LM Studio의 Developer 탭에서 서버가 켜져 있는지(Status: Running), 서버 설정에서 Enable CORS가 켜져 있는지 확인해 주세요. (' + (e.message || e) + ')');
}
// 추론 모델이 본문에 섞어 내는 <think>…</think> 제거 (닫히지 않은 것도)
export function stripThink(s) {
  return String(s || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '').trim();
}

export async function lmstudioModels(url) {
  let res;
  try { res = await fetch(lmBase(url) + '/v1/models'); } catch (e) { throw lmError(e); }
  if (!res.ok) throw new Error('LM Studio 응답 오류 ' + res.status);
  const j = await res.json();
  return (j.data || []).map(m => m.id).filter(id => !/embed/i.test(id));
}

export async function proofreadLMStudio(url, model, fields) {
  let res;
  try {
    res = await fetch(lmBase(url) + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        stream: false,
        temperature: 0,
        max_tokens: 4096, // 추론 모델은 생각하는 데도 토큰을 쓴다
        response_format: { type: 'json_schema', json_schema: { name: 'proofread', strict: true, schema: SCHEMA } },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify({ fields: fields }) }
        ]
      })
    });
  } catch (e) { throw lmError(e); }
  if (!res.ok) {
    let msg = '';
    try { const j = await res.json(); msg = (j.error && (j.error.message || j.error)) || ''; } catch (e) { /* ignore */ }
    throw new Error('LM Studio 응답 오류 ' + res.status + ' ' + msg);
  }
  const j = await res.json();
  const choice = j.choices && j.choices[0];
  if (choice && choice.finish_reason === 'length') throw new Error('모델이 생각하다가 글자 수 한도에 걸렸어요. 다시 살펴보기를 눌러주세요.');
  let parsed;
  try {
    const raw = stripThink(choice && choice.message && choice.message.content);
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : raw);
  } catch (e) { throw new Error('모델이 형식에 맞지 않는 답을 줬어요. 다시 살펴보기를 눌러주세요.'); }
  return clean(fields, parsed.suggestions);
}
