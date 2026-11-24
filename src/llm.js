// LLM access: Gemini or any OpenAI-compatible API (Groq, OpenRouter, Ollama Cloud, ...). Retries busy
// errors, falls back to a second model, never hangs (every request has a timeout), and turns provider
// errors (bad key, no credits, model removed) into messages a person can act on.
import { SYSTEM } from './prompt.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const TIMEOUT_MS = +process.env.LLM_TIMEOUT_MS || 90000; // reasoning models think for a while

// 0.7 keeps joint numbers precise while still varying poses between runs. Override with LLM_TEMPERATURE.
const temperature = () => { const v = parseFloat(process.env.LLM_TEMPERATURE); return Number.isFinite(v) ? Math.min(1.5, Math.max(0, v)) : 0.7; };
const maxTokens = () => { const v = parseInt(process.env.LLM_MAX_TOKENS, 10); return v > 0 ? v : undefined; };

export const providerInfo = () => {
  const openai = !!process.env.LLM_BASE_URL;
  const need = openai ? ['LLM_API_KEY', 'LLM_MODEL'] : ['GEMINI_API_KEY'];
  return { openai, missing: need.filter(k => !process.env[k]) };
};

// Pulls the JSON object out of a model reply. Tolerates <think> blocks, code fences and prose around the
// JSON, and braces inside strings (a greedy /{...}/ match breaks on all three).
export function parseJson(text) {
  const s = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(s); } catch { /* fall through to the scan */ }
  for (let i = s.indexOf('{'); i >= 0; i = s.indexOf('{', i + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { try { return JSON.parse(s.slice(i, j + 1)); } catch { break; } }
    }
  }
  throw new SyntaxError('The model did not return JSON');
}

function httpError(name, r, body, retryable) {
  const e = new Error(`${name} ${r.status}: ${String(body).slice(0, 300)}`);
  e.upstream = r.status;
  e.detail = (() => { try { const j = JSON.parse(body); return String(j.error?.message ?? j.message ?? j.error ?? '').slice(0, 200); } catch { return ''; } })();
  e.retryable = retryable.includes(r.status);
  return e;
}

// What the person sees. Only provider errors are rewritten; anything else passes through untouched.
export function explain(e, model) {
  if (!e?.upstream) return e;
  const code = e.upstream, why = e.detail ? ` Provider says: ${e.detail}` : '';
  const text = {
    400: `The AI provider rejected the request (400).${why}`,
    401: 'The AI provider rejected the API key (401). Check GEMINI_API_KEY / LLM_API_KEY.',
    402: `The AI provider wants payment for this model (402): add credits or switch to a free model.${why}`,
    403: `The AI provider refused access (403). Check the key and that the model is enabled for it.${why}`,
    404: `The AI provider does not offer the model "${model}" (404). It may have been renamed or removed: check LLM_MODEL / GEMINI_MODEL.${why}`,
    429: 'The AI provider is rate limiting you (429). Wait a minute, or use another model.',
  }[code] ?? `The AI provider returned an error (${code}).${why}`;
  return Object.assign(new Error(text), { status: code === 429 ? 503 : 502, cause: e });
}

async function callOpenAIStyle(model, user) {
  const body = { model, temperature: temperature(), messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }] };
  if (process.env.LLM_JSON_MODE !== 'off') body.response_format = { type: 'json_object' };
  if (maxTokens()) body.max_tokens = maxTokens();
  const r = await fetch(`${process.env.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LLM_API_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw httpError('LLM', r, await r.text(), [429, 500, 502, 503, 504]);
  const j = await r.json();
  return parseJson(j.choices?.[0]?.message?.content ?? '');
}

async function callGemini(model, user) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: temperature(), ...(maxTokens() ? { maxOutputTokens: maxTokens() } : {}) },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw httpError('Gemini', r, await r.text(), [429, 500, 503, 504]);
  const j = await r.json();
  return parseJson(j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '');
}

// Which models to try, in order. "generate" (new animations and revisions) uses the strong model first;
// "fix" (auto-repair and the Fix button) uses the fast one first. Each falls back to the other.
//   Gemini: GEMINI_MODEL (default gemini-3.5-flash), GEMINI_FIX_MODEL / GEMINI_FALLBACK_MODEL (default gemini-3.5-flash-lite)
//   OpenAI-style: LLM_MODEL, LLM_FIX_MODEL, LLM_FALLBACK_MODEL
export function modelList(role = 'generate', env = process.env, openai = !!env.LLM_BASE_URL) {
  const main = openai ? env.LLM_MODEL : env.GEMINI_MODEL || 'gemini-3.5-flash';
  const fallback = openai ? env.LLM_FALLBACK_MODEL : env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite';
  const fast = (openai ? env.LLM_FIX_MODEL : env.GEMINI_FIX_MODEL) || fallback || main;
  const order = role === 'fix' ? [fast, main, fallback] : [main, fallback];
  return [...new Set(order.filter(Boolean))];
}

export async function askModel(user, { call, models, role = 'generate' } = {}) {
  const { openai } = providerInfo();
  const list = models ?? modelList(role, process.env, openai);
  const fn = call ?? (openai ? callOpenAIStyle : callGemini);
  let lastErr, lastModel;
  for (const model of list) {
    lastModel = model;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await fn(model, user); }
      catch (e) {
        lastErr = e;
        const again = e.retryable || e instanceof SyntaxError || e.name === 'TimeoutError';
        if (!again) {
          // A hard provider error on the main model (removed, unpaid) can still be rescued by the fallback model.
          if (e.upstream && model !== list.at(-1)) break;
          throw explain(e, model);
        }
        await sleep(1200 * (attempt + 1));
      }
    }
  }
  const busy = lastErr?.retryable || lastErr?.name === 'TimeoutError';
  if (busy) throw Object.assign(new Error('The AI model is busy or slow right now. Try again in a minute.'), { status: 503 });
  if (lastErr instanceof SyntaxError) throw Object.assign(new Error('The AI model keeps answering with something that is not valid JSON. Try again, or try another model.'), { status: 502 });
  const out = explain(lastErr, lastModel);
  if (!out.status) out.status = 503;
  throw out;
}
