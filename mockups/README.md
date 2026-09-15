# Mockups — approval gate before any web code

**The contract:** every UI surface (landing, dashboard, install flow, docs) is first built here as a static HTML/CSS mock under the **hallmark** skill (fired, always — `skill://hallmark`). RECTOR reviews. Only after approval does the surface get implemented in `packages/web`.

Rules:

1. Mocks are self-contained static HTML with locked design tokens (`tokens.css` per mock) — no framework, no build step. Open directly in a browser.
2. Each mock directory carries the Hallmark stamp (macrostructure · theme · enrichment) and the pre-emit critique scores.
3. `tokens.css` from the approved mock **is** the source of truth for the Next.js implementation — same token names, no re-invention.
4. Honest copy only: no invented metrics, no fake logos, no placeholder testimonials. Real numbers or labelled placeholders (`—`).
5. Verify every mock at 320 / 375 / 414 / 768 px before presenting.

Planned mocks (Week 3 per PLAN.md):

- `landing/` — rextoraudit.com product page
- `dashboard/` — living audit report (attestation ledger, risk history)
- `install/` — GitHub App install + onboarding flow
