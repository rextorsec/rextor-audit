# Cast verify() sheet — §4 terminal scene (all commands tested live 2026-10-10)

**Target:** Tempo testnet registry `0x51ac8214089daf85b188437b087519acfc6c495a` (chainId 42431).
**Receipt:** sip-protocol/sip-protocol#1267, head `f88a4831252bf34801881dc5f9bc3e8c353d141a`, risk 100, 125 findings, status 0 (complete), targetChainId 42431, tx `0x13be66d7eff4bec9afc51bcafb5be5c495c12c3f56aff19803e4411757f5f8c9`.
**Rule:** re-run every command fresh at camera time; if the fresh trigger PR's attestation is used instead, substitute its comment-footer values (repo, PR, headSha → reviewId).

```bash
RPC=https://rpc.moderato.tempo.xyz
REG=0x51ac8214089daf85b188437b087519acfc6c495a
```

## 1) Registry is live (chainId + code) — ✅ 2026-10-10

```bash
cast chain-id --rpc-url $RPC
# → 42431
cast codesize $REG --rpc-url $RPC
# → 6226
```

## 2) reviewId derivation from public inputs — ✅ matches on-chain identity

```bash
cast keccak "rextor/review/v1|sip-protocol/sip-protocol|1267|f88a4831252bf34801881dc5f9bc3e8c353d141a"
# → 0x3e9e2579004b7b90c12a7a9595f4fba406b3701b6dfbc75f531e175ee4e106f6
```

## 3) Read the attestation — ✅

```bash
cast call $REG \
  "attestations(bytes32)(address,bytes32,bytes32,string,uint16,uint16,uint8,uint32)" \
  0x3e9e2579004b7b90c12a7a9595f4fba406b3701b6dfbc75f531e175ee4e106f6 \
  --rpc-url $RPC
# → 0x5f2b9C1549F7e178dC0cC15FdCf3719c9fb47f37            (agent)
#   0xf88a4831252bf34801881dc5f9bc3e8c353d141a000000000000000000000000  (commitHash: 20-byte git sha, right-zero-padded)
#   0x763958f8e5c5013b153158bfe28aa58e3f9801a9c66a58f4870f522d08a04d58  (findingsHash: sha256 of canonical findings JSON)
#   "ipfs://QmfPgW2SsTodfs3qihTqCZ5KHHmpd5GFaEKWdtZ8jNoHLy"             (findingsURI)
#   100 125 0 42431                                      (riskScore, findingCount, status, targetChainId)
```

## 4) verify() — true path — ✅ `true`

Paste the record exactly as returned:

```bash
cast call $REG \
  "verify(bytes32,bytes32,bytes32,string,uint16,uint16,uint8,uint32)(bool)" \
  0x3e9e2579004b7b90c12a7a9595f4fba406b3701b6dfbc75f531e175ee4e106f6 \
  0xf88a4831252bf34801881dc5f9bc3e8c353d141a000000000000000000000000 \
  0x763958f8e5c5013b153158bfe28aa58e3f9801a9c66a58f4870f522d08a04d58 \
  "ipfs://QmfPgW2SsTodfs3qihTqCZ5KHHmpd5GFaEKWdtZ8jNoHLy" \
  100 125 0 42431 --rpc-url $RPC
# → true
```

## 5) verify() — tampered (one byte) — ✅ `false`

Same call, findingsHash last byte `…d58` → `…d59`:

```bash
cast call $REG \
  "verify(bytes32,bytes32,bytes32,string,uint16,uint16,uint8,uint32)(bool)" \
  0x3e9e2579004b7b90c12a7a9595f4fba406b3701b6dfbc75f531e175ee4e106f6 \
  0xf88a4831252bf34801881dc5f9bc3e8c353d141a000000000000000000000000 \
  0x763958f8e5c5013b153158bfe28aa58e3f9801a9c66a58f4870f522d08a04d59 \
  "ipfs://QmfPgW2SsTodfs3qihTqCZ5KHHmpd5GFaEKWdtZ8jNoHLy" \
  100 125 0 42431 --rpc-url $RPC
# → false
```

## 6) IPFS: pull the pin from the network, hash it — ✅ sha256 == findingsHash

All public gateways now serve deprecation notices (ipfs.io / dweb.link / w3s.link — verified 2026-10-10), so the camera beat is a **local kubo node pulling from the IPFS DHT** — no gateway trust at all. Node is already running locally (ports moved off 8080 to avoid the agent service):

```bash
brew install kubo                                  # done 2026-10-10 (0.43.1)
export IPFS_PATH="$HOME/.ipfs-rextor-demo"         # repo initialized; Gateway 127.0.0.1:18080, API 15001
ipfs daemon                                        # hub proc `ipfs-demo-node`, running since 2026-10-10
```

Fetch + hash (measured: 4.5 s):

```bash
ipfs get QmfPgW2SsTodfs3qihTqCZ5KHHmpd5GFaEKWdtZ8jNoHLy -o report.json
shasum -a 256 report.json
# → 763958f8e5c5013b153158bfe28aa58e3f9801a9c66a58f4870f522d08a04d58
#   == on-chain findingsHash (0x763958f8…)  ✅ byte-identical
```

The pinned file IS the canonical findings JSON (SPEC-2 §2 form, uploaded raw via Pinata `pinFileToIPFS` — `packages/agent/src/ipfs.ts`), so the sha256 comparison is the whole verification story.

## 7) Camera-time re-verify checklist

- [ ] §1–§6 re-run in order, outputs on screen match this sheet
- [ ] tx link from the PR comment footer shown next to the terminal (`#issuecomment-5995895646` → tx `0x13be66d7…`)
- [ ] if a fresh rehearsal PR attestation replaces this receipt: recompute reviewId via §2 with the new repo/pr/headSha
- [ ] `ipfs-demo-node` daemon alive (`proc://ipfs-demo-node`), report.json absent from disk before the take (fresh fetch on camera)
