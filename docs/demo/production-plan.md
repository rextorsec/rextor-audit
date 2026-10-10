# CWF demo video — production plan (2026-10-10, autonomous pipeline)

**Status:** PRODUCTION UNDERWAY (RECTOR nod 2026-10-10). **v1 picture cut DONE** — `~/local-dev/tmp/rextor-demo-video/edit/segments/v1-picture-cut.mp4` (87.9 s, 1920×1080@30, scene-labeled, silent). Voice samples (George/Daniel/Brian) at `/tmp/vo-samples/`. Pending: voice pick → VO → final mix (subs, loudnorm) → fresh trigger PR final take → receipts re-verify → upload. **Music/SFX: the ElevenLabs key is TTS-scoped (`music_generation` + SFX perms missing → HTTP 401) — mix defaults VO-only unless RECTOR flips the permissions.** Deadline: hard Oct 12.
**Content source of truth:** `docs/demo/script.md` (3:00 draft + 2026-09-25 receipt re-verification table).
**Delivery:** 1920×1080@30, H.264 mp4, dark theme matching the landing mock. Terminal + browser surfaces only, no stock footage. Burned-in subtitles (judges watch muted — veto in chat if unwanted).

---

## 1. Pipeline overview

```
scene captures (real surfaces) ─┐
VO (ElevenLabs TTS, per scene) ─┼─→ ffmpeg assembly → self-eval → final.mp4 → RECTOR → submit
music bed + SFX (ElevenLabs)  ──┘
```

Capture = real motion of real surfaces, recorded autonomously:

| Surface | Mechanism |
|---|---|
| Web (GitHub PR, dashboard, landing) | omp browser tab on **managed Chromium** (NOT relay — etiquette), viewport 1920×1080, `recordStart(path)/recordStop` → mp4 segments per camera move |
| Terminal (`cast`, `ipfs get`, `git log`) | `asciinema rec` of the real commands → `agg` render (1080p dark theme) → mp4. Real output, deterministic render. (`brew install agg` — pending, one command) |
| Audit PDF (§1 prop) | fictional **generic** audit PDF rendered to images → ffmpeg `zoompan` slow scroll. No real firm named or impersonated (receipts-not-claims: the PDF is an illustration of the stale-audit problem, labeled generic) |

Hard rules carried from the video-use skill: per-segment extract → lossless concat; 30 ms audio fades at every boundary; overlays PTS-shifted; subtitles applied LAST; loudness measured (ebur128), never assumed.

## 2. Scene list (from script beats)

| # | Time | Screen | Capture | VO (script verbatim) |
|---|---|---|---|---|
| §1 The gap | 0:00–0:20 | split: PDF slow scroll \| `git log` scrolling past audit date | zoompan + asciinema | "This audit covered this commit… all deltas." (40 w) |
| §2 Every PR an audit event | 0:20–0:55 | GitHub: PR opened → webhook 200 → bot comment: verdict banner, findings table, cited lines | browser tab: PR files view → delivery log → comment (honest cut across the minutes-long review; nothing faked) | "Rextor Audit reviews every pull request…" (35 w) |
| §3 Money shot: stale vs live | 0:55–1:30 | PDF "No criticals at commit abc123" → hard cut → same pattern caught: risk-scored finding, cited lines, fix diff block "Suggestion — review before applying" | zoompan close-up + browser: scroll to high finding | "The audit saw this function before it was rewired…" (45 w) |
| §4 Anyone can verify | 1:30–2:10 | comment footer (reviewId, findingsHash, tx) → terminal: derivation + `attestations()` + `verify()` true → tamper false → `ipfs get` + sha256 match → dashboard ledger/expanders/identity card | asciinema (cast sheet — all commands tested 2026-10-10, see `cast-verify-sheet.md`) + browser dashboard | "Every verdict is attested on-chain…" (60 w) |
| §5 Operator experience | 2:10–2:40 | `@rextor-audit` chat verdict reply + dismissal refusal; `rextor.yaml` gate + dismiss entry on base branch | browser: test repo comment thread + file view | "Ask the agent in-PR… PR content can never silence its own findings." (55 w) |
| §6 Close | 2:40–3:00 | landing: Tempo receipt, Hyperliquid mainnet row, Solana, ERC-8004 identity card, capabilities table → end card rextoraudit.com + Rextor Security (PIL card, hold ≥1 s) | browser scroll + PIL end card | "Attested on **Tempo and Hyperliquid mainnet** today…" (35 w, red-pen #1 applied) |

VO total ≈ 270 words ≈ 1:55 at natural pace; each scene = max(VO + 1 s, minimum screen time). If §4 overruns its 40 s, the `ipfs get` fetch plays at 2× (real output, honest edit) and the dashboard pan trims — §5 stays the flexible scene per script.

## 3. VO (ElevenLabs text-to-speech)

- Model `eleven_v4`, per-scene single requests (each ≤ 60 words — no stitching artifacts), `previous_text`/`next_text` chaining across scene boundaries for tonal continuity, output `mp3_44100_192`.
- Voice: sample 3 candidates on the §1 line AFTER nod, RECTOR picks one: George `JBFqnCBsd6RMkjVDRZzb` (narrative) · Daniel `onwK4e9ZLuTAKqWW03F9` (authoritative) · Brian `nPczCjzI2devNBz1zQrb` (deep, neutral). Stability 0.5, similarity 0.75 starting point.
- Pronunciation pass: "ERC" spelled out, "0x…" addresses spoken as "zero-x seven-f-e-six…" only where the scene points at them — else numbers stay on screen only (VO script avoids reading hashes aloud).

## 4. Music + SFX

- Two contrasting 3:00-capable beds generated post-nod (`music_v2_5`): (a) minimal dark synth pulse, restrained; (b) cinematic ambient build. RECTOR listens to both (video-use rule: music taste is the user's call — never claim a mix sounds good, only measure it).
- Duck −12 to −15 dB under VO; ramp out before end card. Master: two-pass loudnorm −14 LUFS, true peak ≤ −1 dBTP; per-section ebur128 numbers reported.
- SFX ≤ 8, every one tied to a visible event: webhook delivery ping · comment-arrival impact · gate FAILURE thunk · verify-true chime · tamper-false low thud · ipfs-fetch completion tick · dashboard reveal swell · end-card stinger.

## 5. Receipts discipline (binding)

- Every number on screen re-verified at camera time; the §4 terminal flow is fully tested as of 2026-10-10 (`cast-verify-sheet.md`) and re-run fresh before the take.
- Fresh trigger PR at final camera time (no aged evidence trails on screen).
- Never claim Robinhood-chain attestation (config support only). §6 shows Tempo + Hyperliquid mainnet + Solana devnet + ERC-8004 — all with live receipts.
- Honest edits only: cuts across the review pipeline's real duration, 2× on real terminal output — nothing re-staged or synthesized to look like a live event that wasn't.

## 6. Dress rehearsal (support pack A)

1. Branch `demo/rehearsal-1` on `rextorsec/rextor-audit-test`: SmokeVault reentrancy pattern (high → trips the severity gate on camera). PROVEN class: smoke #10 tripped the gate 2026-10-06 under the durable PAT.
2. Watch the full chain: comment → check-run FAILURE → attestation tx → PR comment under PAT.
3. Re-arm a FRESH trigger PR (`demo/final-take-N`) at actual camera time so §2/§3 are same-day.
4. Budget: one attestation tx per run; cap 2–3 rehearsal runs.
5. Chat scene pre-check: `@rextor-audit` verdict reply + dismissal refusal reply captured in rehearsal (deterministic, cached — safe to re-ask on camera).

## 7. Timeline to hard Oct 12

| When | Work |
|---|---|
| Oct 10, after nod | `brew install agg` · build PDF prop + end card · dress-rehearsal PR · 3 voice samples + 2 beds → RECTOR picks |
| Oct 10 night | full VO · scene captures · assembly v1 · self-eval (cut-boundary timeline views, ebur128, critic pass, ≤3 fix rounds) → v1 to RECTOR |
| Oct 11 | RECTOR feedback → fixes → final render + loudness report → video link live |
| Oct 12 | RECTOR submits (form copy ready in `cwf-form-copy.md`) — full-day buffer |

## 8. Script changes required (need RECTOR sign-off)

1. **§4 IPFS beat:** every public gateway (ipfs.io, dweb.link, w3s.link) now serves a deprecation notice page — verified 2026-10-10. Replace "gateway fetch" with **local-node DHT retrieval**: `ipfs get <cid>` → `shasum` == on-chain findingsHash (4.5 s, proven). Stronger claim, same honesty: no gateway trust at all.
2. **§6 VO:** "Attested on Tempo today" → "Attested on **Tempo and Hyperliquid mainnet** today" (HyperEVM mainnet registry `0x8f63…850c`, reviewCount 3 — verified live 2026-10-10). Red-pen suggestion #1 from the script, receipt exists.
3. **§4 values:** use the 2026-10-10 tested set (registry `0x51ac…495a`, reviewId `0x3e9e…06f6`, risk 100 / 125 findings, tx `0x13be66d7…`) — supersedes the 09-25 table's "current full-loop receipt".

## 9. Decisions for RECTOR (blocking production)

1. Nod on the pipeline + capture approach (this doc).
2. VO voice (samples generated first, then pick).
3. Music bed (both generated, then pick).
4. §4 beat change to local-node retrieval (§8.1).
5. Video hosting for the submission link: YouTube unlisted vs Google Drive vs IPFS pin + link. (YouTube removed RECTOR's channel twice historically — RECTOR's call.)
