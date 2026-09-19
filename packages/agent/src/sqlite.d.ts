// Minimal ambient surface for better-sqlite3 (v13) — only what db.ts uses.
// Kept local so the ONE new runtime dependency drags in no types package.
declare module "better-sqlite3" {
  export interface Statement {
    run(...params: unknown[]): { changes: number | bigint };
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  }
  export interface DatabaseOptions {
    readonly?: boolean;
  }
  export default class Database {
    constructor(path: string, options?: DatabaseOptions);
    prepare(sql: string): Statement;
    exec(sql: string): void;
    pragma(source: string, options?: { simple?: boolean }): unknown;
    close(): void;
  }
}
