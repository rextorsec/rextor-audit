// SPEC-2 §3 — OpenRouter transport. Pure HTTP + parsing; triage policy lives
// in triage.ts. Every failure mode collapses to TriageUnavailableError so the
// caller can degrade the review to soft-incomplete (never a crash).
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_LLM_TIMEOUT_MS = 90_000;
// 16000: reasoning models (glm-5.3 family) burn completion budget on
// reasoning before emitting content — a 4000 budget returns empty content on
// real triage prompts (observed live 2026-09-19). Budget is a ceiling, not a
// target: non-reasoning models are unaffected.
export const DEFAULT_MAX_TOKENS = 16000;

export class TriageUnavailableError extends Error {
  constructor(cause: string) {
    super(`triage LLM unavailable: ${cause}`);
    this.name = "TriageUnavailableError";
  }
}

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

/** A provider can return HTTP 200 with empty content (reasoning burnout /
 *  provider hiccup — observed live on glm-5.3-flash 2026-09-22 killing a PoC
 *  generation). One retry on THIS failure mode only; http/parse errors stay
 *  immediate (retrying a 401 is noise, retrying 5xx belongs to the provider). */
const EMPTY_CONTENT_ATTEMPTS = 2;

export async function chatCompletion(config: OpenRouterConfig, messages: ChatMessage[]): Promise<string> {
  for (let attempt = 0; attempt < EMPTY_CONTENT_ATTEMPTS; attempt++) {
    const content = await chatCompletionOnce(config, messages);
    if (content.length > 0) return content;
  }
  throw new TriageUnavailableError("response carried no content");
}

async function chatCompletionOnce(config: OpenRouterConfig, messages: ChatMessage[]): Promise<string> {
  const controller = new AbortController();
  const budgetMs = config.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
  // The deadline arms for the WHOLE exchange — headers AND body. Clearing it
  // after the headers land would let a stalled response body hang a serial
  // queue slot indefinitely (the abort never fires; undici's default body
  // timeout is a safety net, not a contract).
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    let res: Response;
    try {
      res = await (config.fetchFn ?? fetch)(OPENROUTER_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
          max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
          messages,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new TriageUnavailableError(err instanceof Error ? err.message : String(err));
    }
    if (!res.ok) throw new TriageUnavailableError(`http ${res.status}`);
    let data: { choices?: Array<{ message?: { content?: unknown } }> };
    try {
      data = (await res.json()) as typeof data;
    } catch (err) {
      if (controller.signal.aborted) {
        throw new TriageUnavailableError(`response body did not settle within ${budgetMs}ms`);
      }
      throw new TriageUnavailableError(`unparseable response: ${err instanceof Error ? err.message : String(err)}`);
    }
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") return "";
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/** First balanced JSON array in the text (fences/prose tolerated), or null. */
export function extractJsonArray(text: string): unknown[] | null {
  const start = text.indexOf("[");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1));
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** SPEC-2 §3 escalation: frontier iff any critical or high finding. */
export function triageModelFor(
  findings: Array<{ severity: string }>,
  env: Partial<Pick<NodeJS.ProcessEnv, "REXTOR_TRIAGE_MODEL" | "REXTOR_FRONTIER_MODEL">>,
): string | null {
  const base = env.REXTOR_TRIAGE_MODEL;
  const frontier = env.REXTOR_FRONTIER_MODEL;
  if (!base || !frontier) return null;
  return findings.some((f) => f.severity === "critical" || f.severity === "high") ? frontier : base;
}
