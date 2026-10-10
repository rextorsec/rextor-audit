// Structured logger — the service's single stdout writer: one JSON line per
// event. Line shape, field order included, is the contract:
//   {"ts":"<ISO>","level":"error|warn|info|debug","event":"<namespace.name>",
//    "msg":"<human text, verbatim minus the [rextor] prefix>", ...fields,
//    "err":{"name","message"[,"stack"]}}
// Events use the frozen taxonomy namespaces: webhook.* (delivery ack/queue/
// dedupe/redrive), review.* (pipeline stages incl. clone), github.*
// (comment/check-run/api/auth), chain.* (attestation, ERC-8004 feedback,
// IPFS, chain clients), http.* (routes/responses), service.* (boot/config/
// env/drain/watchdog/db-open).
//
// err policy — never less detail than the pre-logger stderr lines, never
// more secrets: an Error serializes to {name, message}; `stack` is opt-in
// (only the sites that historically logged the full error object). A string
// err is an ALREADY-EXTRACTED message — the feedback/attest/solana secret
// discipline (never a stack trace or env that could echo secrets) — and
// serializes message-only.
//
// REXTOR_LOG_LEVEL filters by threshold (default "info": debug suppressed
// unless "debug" is set); the env is read at emit time, the SPEC-1 idiom —
// an operator's env change needs no code change to matter.
//
// Canonical signatures follow the line's job: failures carry the thrown value
// (logError/logWarn: event, msg, err?, fields?, and stack opt-in on error),
// receipts carry structured fields (logInfo/logDebug: event, msg, fields?).
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogFields {
  readonly [key: string]: string | number | boolean | null | undefined;
}

export interface LogErrOptions {
  /** Include Error.stack — only at sites that historically logged full errors. */
  stack?: boolean;
}

/** Active threshold: REXTOR_LOG_LEVEL when it names a level (trim +
 *  case-insensitive), else "info". */
export function logLevel(): LogLevel {
  const raw = process.env.REXTOR_LOG_LEVEL?.trim().toLowerCase();
  return raw === "debug" || raw === "info" || raw === "warn" || raw === "error" ? raw : "info";
}

interface SerializedErr {
  name?: string;
  message: string;
  stack?: string;
}

function serializeErr(err: unknown, withStack: boolean): SerializedErr {
  if (err instanceof Error) {
    const out: SerializedErr = { name: err.name, message: err.message };
    if (withStack && err.stack !== undefined) out.stack = err.stack;
    return out;
  }
  return { message: String(err) };
}

function emit(
  level: LogLevel,
  event: string,
  msg: string,
  fields?: LogFields,
  err?: SerializedErr,
): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[logLevel()]) return;
  const ts = new Date().toISOString();
  const line: Record<string, unknown> = { ts, level, event, msg };
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) line[key] = value;
    }
  }
  if (err) line.err = err;
  try {
    process.stdout.write(`${JSON.stringify(line)}\n`);
  } catch {
    // A logging failure must never take the service down: fall back to the
    // minimal always-serializable line.
    process.stdout.write(`${JSON.stringify({ ts, level, event, msg })}\n`);
  }
}

export function logDebug(event: string, msg: string, fields?: LogFields): void {
  emit("debug", event, msg, fields);
}

export function logInfo(event: string, msg: string, fields?: LogFields): void {
  emit("info", event, msg, fields);
}

/** Failure lines carry the thrown value BEFORE fields (same slot order as
 *  logError); a fields-only site passes `undefined` for the err slot. */
export function logWarn(
  event: string,
  msg: string,
  err?: unknown,
  fields?: LogFields,
): void {
  emit("warn", event, msg, fields, err === undefined ? undefined : serializeErr(err, false));
}

/** `err` may be the raw thrown value (serialized {name, message}) or an
 *  already-extracted message string (serialized message-only). */
export function logError(
  event: string,
  msg: string,
  err?: unknown,
  fields?: LogFields,
  opts?: LogErrOptions,
): void {
  emit("error", event, msg, fields, err === undefined ? undefined : serializeErr(err, opts?.stack === true));
}
