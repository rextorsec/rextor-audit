// SPEC-6 §3 — agent-side review index: one SQLite row per settled review
// (attest + comment both attempted, including hard-incomplete and
// attest-skipped outcomes). The row is written AFTER the review settles: a
// postComment throw following a successful attest records NO row — a known
// divergence window where the chain holds a verdict the index lacks. This is
// the dashboard's data source; the web NEVER opens this DB — it reads through
// GET /reviews/:owner/:repo only.
// The DB file path is injectable (REXTOR_DB_PATH in production, one temp
// file per test) and every statement is prepared once at creation.
import Database from "better-sqlite3";
import { dismissalKey, type DismissalEntry } from "./config";

// Column names are the binding SPEC-6 §3 schema. `status` mirrors the
// on-chain encoding (0 = complete, 1 = incomplete); empty tx/chain fields
// mean "not attested" — absent values are stored as "", never faked.
export interface ReviewRow {
  repo: string;
  pr: number;
  head_sha: string;
  review_id: string;
  chain: string;
  tx_hash: string;
  explorer_url: string;
  risk_score: number;
  finding_count: number;
  status: number;
  comment_url: string;
  created_at: string;
}

export interface ReviewStore {
  insert(row: ReviewRow): void;
  /** Rows for `repo` ("owner/repo"), newest first; unknown repo → []. */
  listForRepo(repo: string): ReviewRow[];
  /** C1 re-drive guard: true when a settled review row already exists for the
   *  exact (repo, pr, headSha) — a re-driven delivery for reviewed work is
   *  answered skipped instead of re-queued. */
  hasReview(repo: string, pr: number, headSha: string): boolean;
  close(): void;
  /** SPEC-7 §4 — dismissals are repo-keyed, server-side (invariant 21): the
   *  base-branch yaml is synced in wholesale per review (the yaml IS the
   *  truth, so removals propagate), `source` records the syncing review's
   *  head sha as provenance. */
  syncDismissals(repo: string, entries: DismissalEntry[], source: string): void;
  /** Gate input: the repo's silenced (ruleId, path) keys. */
  dismissedKeys(repo: string): Set<string>;
  /** Learnings ledger: recurrence counter for one (ruleId, path) in a repo.
   *  Annotations only — a learning NEVER silences or re-scores a finding. */
  recordOccurrence(repo: string, ruleId: string, path: string, sample: string): { occurrences: number; lastSeenAt: string };
}

/** SPEC-7 §4 — what the review pipeline needs from the server-side memory.
 *  ReviewStore satisfies this structurally; tests inject fakes. */
export interface RepoMemory {
  syncDismissals(repo: string, entries: DismissalEntry[], source: string): void;
  dismissedKeys(repo: string): Set<string>;
  recordOccurrence(repo: string, ruleId: string, path: string, sample: string): { occurrences: number; lastSeenAt: string };
}

// The store owns the SQL — rows cross back out as plain typed objects, so
// consumers never see better-sqlite3's raw row shape.
function toRow(raw: Record<string, unknown>): ReviewRow {
  return {
    repo: String(raw.repo),
    pr: Number(raw.pr),
    head_sha: String(raw.head_sha),
    review_id: String(raw.review_id),
    chain: String(raw.chain),
    tx_hash: String(raw.tx_hash),
    explorer_url: String(raw.explorer_url),
    risk_score: Number(raw.risk_score),
    finding_count: Number(raw.finding_count),
    status: Number(raw.status),
    comment_url: String(raw.comment_url),
    created_at: String(raw.created_at),
  };
}

const COLUMNS =
  "repo, pr, head_sha, review_id, chain, tx_hash, explorer_url, risk_score, finding_count, status, comment_url, created_at";

export function createReviewStore(dbPath: string): ReviewStore {
  const db = new Database(dbPath);
  // Reviews are written from the webhook queue while the endpoint reads —
  // WAL keeps readers and the writer from blocking each other.
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      repo TEXT NOT NULL,
      pr INTEGER NOT NULL,
      head_sha TEXT NOT NULL,
      review_id TEXT NOT NULL,
      chain TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      explorer_url TEXT NOT NULL,
      risk_score INTEGER NOT NULL,
      finding_count INTEGER NOT NULL,
      status INTEGER NOT NULL,
      comment_url TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reviews_repo_created ON reviews(repo, created_at);
  `);
  const insertStmt = db.prepare(
    `INSERT INTO reviews (${COLUMNS})
     VALUES (@repo, @pr, @head_sha, @review_id, @chain, @tx_hash, @explorer_url, @risk_score, @finding_count, @status, @comment_url, @created_at)`,
  );
  // ISO-8601 created_at sorts lexicographically; rowid breaks ties between
  // rows written in the same millisecond (deterministic newest-first).
  const listStmt = db.prepare(
    `SELECT ${COLUMNS} FROM reviews WHERE repo = ? ORDER BY created_at DESC, rowid DESC`,
  );
  // C1 — the re-drive guard's point lookup (one row answers it; the repo
  // prefix of reviews_repo_created keeps it cheap).
  const hasReviewStmt = db.prepare(
    `SELECT 1 FROM reviews WHERE repo = ? AND pr = ? AND head_sha = ? LIMIT 1`,
  );

  // SPEC-7 §4 — server-side silencing memory (repo-file stores are an
  // injection vector; scope decision 5).
  db.exec(`
    CREATE TABLE IF NOT EXISTS dismissals (
      repo TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      path TEXT NOT NULL,
      line_hint INTEGER,
      reason TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (repo, rule_id, path)
    );
    CREATE TABLE IF NOT EXISTS learnings (
      repo TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      path TEXT NOT NULL,
      occurrences INTEGER NOT NULL,
      last_seen_at TEXT NOT NULL,
      sample TEXT NOT NULL,
      PRIMARY KEY (repo, rule_id, path)
    );
  `);
  const clearDismissalsStmt = db.prepare(`DELETE FROM dismissals WHERE repo = ?`);
  const insertDismissalStmt = db.prepare(
    `INSERT INTO dismissals (repo, rule_id, path, line_hint, reason, source, created_at)
     VALUES (@repo, @rule_id, @path, @line_hint, @reason, @source, @created_at)`,
  );
  const listDismissalsStmt = db.prepare(
    `SELECT rule_id, path FROM dismissals WHERE repo = ?`,
  );
  const upsertOccurrenceStmt = db.prepare(
    `INSERT INTO learnings (repo, rule_id, path, occurrences, last_seen_at, sample)
     VALUES (@repo, @rule_id, @path, 1, @last_seen_at, @sample)
     ON CONFLICT (repo, rule_id, path) DO UPDATE SET
       occurrences = occurrences + 1,
       last_seen_at = excluded.last_seen_at,
       sample = excluded.sample
     RETURNING occurrences, last_seen_at`,
  );

  const syncTransaction = db.transaction(
    (repo: string, entries: DismissalEntry[], source: string) => {
      clearDismissalsStmt.run(repo);
      const now = new Date().toISOString();
      for (const e of entries) {
        insertDismissalStmt.run({
          repo,
          rule_id: e.ruleId,
          path: e.path,
          line_hint: e.lineHint ?? null,
          reason: e.reason,
          source,
          created_at: now,
        });
      }
    },
  );
  return {
    insert(row: ReviewRow): void {
      insertStmt.run(row);
    },
    listForRepo(repo: string): ReviewRow[] {
      return (listStmt.all(repo) as Record<string, unknown>[]).map(toRow);
    },
    hasReview(repo: string, pr: number, headSha: string): boolean {
      return hasReviewStmt.get(repo, pr, headSha) !== undefined;
    },
    close(): void {
      db.close();
    },
    syncDismissals(repo: string, entries: DismissalEntry[], source: string): void {
      syncTransaction(repo, entries, source);
    },
    dismissedKeys(repo: string): Set<string> {
      const rows = listDismissalsStmt.all(repo) as Array<{ rule_id: string; path: string }>;
      return new Set(rows.map((r) => dismissalKey(r.rule_id, r.path)));
    },
    recordOccurrence(repo: string, ruleId: string, path: string, sample: string): { occurrences: number; lastSeenAt: string } {
      const row = upsertOccurrenceStmt.get({
        repo,
        rule_id: ruleId,
        path,
        last_seen_at: new Date().toISOString(),
        sample,
      }) as { occurrences: number; last_seen_at: string };
      return { occurrences: row.occurrences, lastSeenAt: row.last_seen_at };
    },
  };
}
