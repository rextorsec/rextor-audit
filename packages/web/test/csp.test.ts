// Roast 2026-09-25 #1 (second half) — the script-src policy must be
// nonce-based: no 'unsafe-inline' scripts, ever. style-src keeps
// 'unsafe-inline' (App Router + geist inject styles; style is not
// executable). These pin the one CSP definition the middleware ships.
import { describe, expect, it } from "vitest";
import { buildScriptCsp } from "@/lib/csp";

const scriptSrc = (csp: string): string =>
  csp.split("; ").find((d) => d.startsWith("script-src")) ?? "";

describe("buildScriptCsp", () => {
  it("script-src carries the request nonce and strict-dynamic — never unsafe-inline", () => {
    const csp = buildScriptCsp("c3Rhcg==");
    const s = scriptSrc(csp);
    expect(s).toContain("'nonce-c3Rhcg=='");
    expect(s).toContain("'strict-dynamic'");
    expect(s).not.toContain("'unsafe-inline'");
  });

  it("dev builds add unsafe-eval (next-dev HMR) — prod builds never do", () => {
    expect(scriptSrc(buildScriptCsp("n", true))).toContain("'unsafe-eval'");
    expect(scriptSrc(buildScriptCsp("n", false))).not.toContain("'unsafe-eval'");
  });

  it("the XSS second layer stays pinned: object/base/frame anchors", () => {
    const csp = buildScriptCsp("n");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("default-src 'self'");
  });

  it("interpolates the nonce exactly once (no second nonce leaks via default-src)", () => {
    const csp = buildScriptCsp("abc123");
    expect(csp.split("'nonce-abc123'").length - 1).toBe(1);
  });
});
