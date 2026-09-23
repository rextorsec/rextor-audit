// R2 — ERC-8004 automated reputation ingestion. The feedback carries the REAL
// evidence (the settled attestation's findingsURI + findingsHash) and stays
// config-gated: REXTOR_AUTO_FEEDBACK defaults OFF — the mainnet broadcast is a
// 🔴 RECTOR gate. Registry addresses are env-only; never hardcoded here.
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAbiItem, zeroHash } from "viem";

import {
  createFeedbackDep,
  ERC8004_FEEDBACK_ABI,
  ERC8004_IDENTITY_VIEW_ABI,
  feedbackConfig,
  feedbackDisabledReason,
  submitFeedback,
  tagFromRepo,
  type FeedbackIo,
  type FeedbackRecord,
} from "../src/feedback";

// anvil test keys — never real funds.
const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // anvil #1
const SUBMITTER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as `0x${string}`; // anvil #1's address
const OWNER = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266" as `0x${string}`; // anvil #0
const REPUTATION = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const TX_HASH = ("0x" + "cd".repeat(32)) as `0x${string}`;
const HASH = ("0x" + "ab".repeat(32)) as `0x${string}`;

const gatedEnv = () => ({
  REXTOR_AUTO_FEEDBACK: "on",
  REXTOR_AGENT_PRIVATE_KEY: PK,
  ERC8004_REPUTATION_REGISTRY: REPUTATION,
  ERC8004_IDENTITY_REGISTRY: REPUTATION, // any address works for fakes
  REXTOR_FEEDBACK_RPC_URL: "https://rpc.example",
});

const cfg = {
  account: SUBMITTER,
  agentId: 50891n,
  value: 95n,
  valueDecimals: 0,
  endpoint: "https://www.rextoraudit.com",
};

const record = (over: Partial<FeedbackRecord> = {}): FeedbackRecord => ({
  findingsURI: "ipfs://bafy/report.json",
  findingsHash: HASH,
  ...over,
});

// Fake wallet+public client seam: preflight answers and the write are fakes.
const io = (over: Partial<FeedbackIo> = {}): { io: FeedbackIo; writes: unknown[] } => {
  const writes: unknown[] = [];
  const fake: FeedbackIo = {
    readIdentity: async (fn) => (fn === "ownerOf" ? OWNER : SUBMITTER),
    giveFeedback: async (args) => {
      writes.push(args);
      return TX_HASH;
    },
    waitFor: async () => {},
    ...over,
  };
  return { io: fake, writes };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("gating (REXTOR_AUTO_FEEDBACK, default OFF)", () => {
  it("is undefined with the flag unset or anything but exactly on", () => {
    expect(createFeedbackDep(() => ({}))).toBeUndefined();
    expect(createFeedbackDep(() => ({ REXTOR_AUTO_FEEDBACK: "OFF" }))).toBeUndefined();
    expect(createFeedbackDep(() => ({ REXTOR_AUTO_FEEDBACK: "ON" }))).toBeUndefined();
    expect(createFeedbackDep(() => ({ REXTOR_AUTO_FEEDBACK: "1" }))).toBeUndefined();
    expect(feedbackDisabledReason({})).toBe("auto-feedback disabled (REXTOR_AUTO_FEEDBACK off)");
  });

  it("is undefined with the flag on but the identity/registry keys missing; the reason names them", () => {
    expect(createFeedbackDep(() => ({ REXTOR_AUTO_FEEDBACK: "on" }))).toBeUndefined();
    expect(feedbackDisabledReason({ REXTOR_AUTO_FEEDBACK: "on" })).toMatch(/REXTOR_AGENT_PRIVATE_KEY/);
    expect(feedbackDisabledReason({ REXTOR_AUTO_FEEDBACK: "on", REXTOR_AGENT_PRIVATE_KEY: PK })).toMatch(
      /ERC8004_REPUTATION_REGISTRY/,
    );
  });

  it("is a function with the flag on and both keys set", () => {
    expect(createFeedbackDep(() => gatedEnv())).toBeTypeOf("function");
  });
});

describe("feedbackConfig (documented defaults)", () => {
  it("defaults agentId 50891, value 95, decimals 0, endpoint www.rextoraudit.com", () => {
    expect(feedbackConfig({})).toEqual({
      agentId: 50891n,
      value: 95n,
      valueDecimals: 0,
      endpoint: "https://www.rextoraudit.com",
    });
  });

  it("env overrides flow through (agentId as bigint)", () => {
    expect(
      feedbackConfig({
        ERC8004_AGENT_ID: "42",
        ERC8004_FEEDBACK_VALUE: "88",
        ERC8004_FEEDBACK_DECIMALS: "2",
        REXTOR_FEEDBACK_ENDPOINT: "https://rextoraudit.example",
      }),
    ).toEqual({
      agentId: 42n,
      value: 88n,
      valueDecimals: 2,
      endpoint: "https://rextoraudit.example",
    });
  });

  it("throws on a non-integer agentId (caller degrades to a skip, never a guess)", () => {
    expect(() => feedbackConfig({ ERC8004_AGENT_ID: "abc" })).toThrow();
    expect(() => feedbackConfig({ ERC8004_AGENT_ID: "50891.5" })).toThrow();
  });
});

describe("tagFromRepo (registry tag limit: 32 bytes)", () => {
  it("keeps a normal repo name whole", () => {
    expect(tagFromRepo("rextorsec/rextor-audit")).toBe("rextorsec/rextor-audit");
  });

  it("truncates to at most 32 bytes", () => {
    expect(tagFromRepo("r".repeat(40))).toBe("r".repeat(32));
    expect(new TextEncoder().encode(tagFromRepo("r".repeat(40))).length).toBe(32);
  });

  it("never splits a multibyte codepoint", () => {
    // 31 ASCII bytes + a 2-byte é would exceed 32 — the é is dropped whole.
    expect(tagFromRepo("r".repeat(31) + "é")).toBe("r".repeat(31));
  });
});

describe("submitFeedback (fake wallet client)", () => {
  it("happy path: preflight passes and giveFeedback gets the exact payload", async () => {
    const { io: fake, writes } = io();
    const out = await submitFeedback(record(), "rextorsec/rextor-audit", fake, cfg);
    expect(out).toEqual({ txHash: TX_HASH, explorerUrl: "" });
    expect(writes).toEqual([
      {
        agentId: 50891n,
        value: 95n,
        valueDecimals: 0,
        tag1: "audit",
        tag2: "rextorsec/rextor-audit",
        endpoint: "https://www.rextoraudit.com",
        feedbackURI: "ipfs://bafy/report.json",
        feedbackHash: HASH,
      },
    ]);
  });

  it("degraded evidence: absent hash → zero bytes32, absent URI → empty string", async () => {
    const { io: fake, writes } = io();
    await submitFeedback(record({ findingsURI: "", findingsHash: undefined }), "o/r", fake, cfg);
    expect(writes[0]).toMatchObject({ feedbackURI: "", feedbackHash: zeroHash });
  });

  it("over-32-byte repo name truncates into tag2", async () => {
    const { io: fake, writes } = io();
    await submitFeedback(record(), "r".repeat(40), fake, cfg);
    expect(writes[0]).toMatchObject({ tag2: "r".repeat(32) });
  });

  it("owner collision → clean skip, no write (giveFeedback rejects the owner on-chain)", async () => {
    const { io: fake, writes } = io({ readIdentity: async (fn) => (fn === "ownerOf" ? SUBMITTER : SUBMITTER) });
    const out = await submitFeedback(record(), "o/r", fake, cfg);
    expect(out).toEqual({ skipped: expect.stringMatching(/owner/) });
    expect(writes).toEqual([]);
  });

  it("submitter is not the bound agentWallet → clean skip, no write", async () => {
    const { io: fake, writes } = io({ readIdentity: async (fn) => (fn === "ownerOf" ? OWNER : OWNER) });
    const out = await submitFeedback(record(), "o/r", fake, cfg);
    expect(out).toEqual({ skipped: expect.stringMatching(/agentWallet/) });
    expect(writes).toEqual([]);
  });

  it("identity read failure → skip with reason, never throws", async () => {
    const { io: fake, writes } = io({ readIdentity: async () => { throw new Error("rpc down"); } });
    const out = await submitFeedback(record(), "o/r", fake, cfg);
    expect(out).toEqual({ skipped: expect.stringMatching(/identity registry read failed.*rpc down/s) });
    expect(writes).toEqual([]);
  });

  it("submit failure → logged, returned as skipped, never throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { io: fake, writes } = io({ giveFeedback: async () => { throw new Error("gas spike"); } });
    const out = await submitFeedback(record(), "o/r", fake, cfg);
    expect(out).toEqual({ skipped: expect.stringMatching(/gas spike/) });
    expect(writes).toEqual([]);
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/feedback submit failed/), expect.stringMatching(/gas spike/));
  });

  it("mined-but-reverted tx never passes as success", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { io: fake, writes } = io({ waitFor: async () => { throw new Error("reverted: gas"); } });
    const out = await submitFeedback(record(), "o/r", fake, cfg);
    expect(out).toEqual({ skipped: expect.stringMatching(/reverted/) });
    expect(writes).toHaveLength(1);
    expect(err).toHaveBeenCalled();
  });
});

describe("createFeedbackDep call-time fail-closed paths", () => {
  it("skips when the env keys vanish after wiring (rotated-key doctrine)", async () => {
    let env: NodeJS.ProcessEnv = gatedEnv();
    const dep = createFeedbackDep(() => env)!;
    env = { REXTOR_AUTO_FEEDBACK: "on" };
    const out = await dep(record(), "o/r");
    expect(out).toEqual({ skipped: expect.stringMatching(/call time/) });
  });

  it("skips with a reason when the identity registry env is missing", async () => {
    const dep = createFeedbackDep(() => ({ ...gatedEnv(), ERC8004_IDENTITY_REGISTRY: undefined }))!;
    expect(await dep(record(), "o/r")).toEqual({ skipped: expect.stringMatching(/ERC8004_IDENTITY_REGISTRY/) });
  });

  it("skips with a reason when the RPC env is missing (fail closed, never guess infra)", async () => {
    const dep = createFeedbackDep(() => ({ ...gatedEnv(), REXTOR_FEEDBACK_RPC_URL: undefined }))!;
    expect(await dep(record(), "o/r")).toEqual({ skipped: expect.stringMatching(/REXTOR_FEEDBACK_RPC_URL/) });
  });

  it("skips with a reason when a numeric env is invalid", async () => {
    const dep = createFeedbackDep(() => ({ ...gatedEnv(), ERC8004_AGENT_ID: "abc" }))!;
    expect(await dep(record(), "o/r")).toEqual({ skipped: expect.stringMatching(/invalid/) });
  });
});

describe("ERC-8004 ABIs (viem-ready, live registry 2.0.0 selectors)", () => {
  // Regression discipline from attest: the ABI must ship as PARSED items —
  // raw human-readable strings throw `'name' in …` at writeContract call time.
  it("giveFeedback matches the live 2.0.0 signature (int128 value, not the uint8 draft)", () => {
    const giveFeedback = getAbiItem({ abi: ERC8004_FEEDBACK_ABI, name: "giveFeedback" });
    expect(giveFeedback.type).toBe("function");
    expect(giveFeedback.inputs.map((i) => i.name)).toEqual([
      "agentId", "value", "valueDecimals", "tag1", "tag2", "endpoint", "feedbackURI", "feedbackHash",
    ]);
    expect(giveFeedback.inputs[1].type).toBe("int128");
    expect(giveFeedback.inputs[2].type).toBe("uint8");
    expect(giveFeedback.inputs[7].type).toBe("bytes32");
  });

  it("identity view ABI exposes the two preflight reads", () => {
    const ownerOf = getAbiItem({ abi: ERC8004_IDENTITY_VIEW_ABI, name: "ownerOf" });
    const wallet = getAbiItem({ abi: ERC8004_IDENTITY_VIEW_ABI, name: "getAgentWallet" });
    expect(ownerOf.inputs).toHaveLength(1);
    expect(wallet.inputs).toHaveLength(1);
    expect(wallet.outputs[0].type).toBe("address");
  });
});
