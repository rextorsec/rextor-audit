// SPEC-6 §3 — agent-side review index: one SQLite row per settled review
// (attest + comment both attempted, including hard-incomplete and
// attest-skipped outcomes). This is the dashboard's data source; the web
// NEVER opens this DB — it reads through GET /reviews/:owner/:repo only.
// The DB file path is injectable (REXTOR_DB_PATH in production, one temp
// file per test) and every statement is prepared once at creation.
import Database from "better-sqlite3";

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
  close(): void;
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
  return {
    insert(row: ReviewRow): void {
      insertStmt.run(row);
    },
    listForRepo(repo: string): ReviewRow[] {
      return (listStmt.all(repo) as Record<string, unknown>[]).map(toRow);
    },
    close(): void {
      db.close();
    },
  };
}
