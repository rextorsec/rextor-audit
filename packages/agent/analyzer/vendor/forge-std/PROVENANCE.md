# Provenance

- `src/` (plus `package.json` for identity): vendored from upstream
  `foundry-rs/forge-std` master @ `7fdf81f9ceb2f6ebbb8f9f1c6c5274d5bcc9a1f5`
  (2026-09-10), byte-identical to the `lib/forge-std` tree in
  `fixtures/vault` (see that fixture's PROVENANCE.md — the vendored tree
  carries 5 post-1.16.2-tag files, so identity is against the commit, not the
  release tag).
- Baked into `rextor/analyzer` at `/opt/rextor/forge-std` so the sim harness
  can pin `forge-std/` remappings to a known-good copy (fix for the
  PR-controlled forge-std poisoning vector, SPEC-3 §2 hardening): a PR that
  ships its own forge-std (vendored lib, `remappings = [...]`, or a root
  `remappings.txt`) must not own `assert`/`assertTrue` inside the PoC run.
- Upgrade procedure: re-vendor `fixtures/vault/lib/forge-std`, update both
  PROVENANCE.md files, rebuild the image.
