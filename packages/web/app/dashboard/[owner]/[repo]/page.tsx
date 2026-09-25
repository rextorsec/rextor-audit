// SPEC-6 §3 — living audit report. Server component ONLY: the agent-service
// token (REXTOR_AGENT_TOKEN) and all RPC reads stay server-side (invariants
// 18/19); nothing key-bearing is serialized to the client. Every failure is
// rendered honestly — error panels and "—" fields, never fabricated data.
import { AgentIdentityCard } from "@/components/agent-identity-card";
import { ReviewLedger } from "@/components/review-ledger";
import { ScoreHistory } from "@/components/score-history";
import { Wordmark } from "@/components/nav";
import { readAgentIdentity } from "@/lib/chain-read";
import { DEFAULT_CHAIN_KEY, shortHex, webChainByName, WEB_CHAINS } from "@/lib/chains";
import { fetchReviews } from "@/lib/reviews";
import identityData from "@/content/identity.json";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  // Next 15: page params are a Promise — awaited before use.
  const { owner: ownerParam, repo: repoParam } = await params;
  // GitHub owner/repo is case-insensitive; the agent store compares BINARY.
  // Canonicalize at this layer so /dashboard/RextorSec/Demo resolves the same
  // ledger as /dashboard/rextorsec/demo (T9 review #2).
  const owner = ownerParam.toLowerCase();
  const repo = repoParam.toLowerCase();
  const repoFullName = `${owner}/${repo}`;

  const reviews = await fetchReviews(owner, repo);
  const rows = reviews.ok ? reviews.rows : [];

  // Active attestation chain: the latest attested row's chain, else the
  // registry default. Identity is an independent live read — the page renders
  // even when the index is down.
  const latestAttested = rows.find((row) => row.tx_hash.length > 0);
  const activeChain = latestAttested?.chain ? webChainByName(latestAttested.chain) : undefined;
  const chain = activeChain ?? WEB_CHAINS[DEFAULT_CHAIN_KEY];
  const identity = await readAgentIdentity(chain.key);
  const attestedIncomplete = rows.filter((row) => row.tx_hash.length > 0 && row.status === 1).length;

  return (
    <>
      <nav
        aria-label="Primary"
        className="flex items-center justify-between border-b border-border py-6"
      >
        <Wordmark />
        <a
          className="rounded-full border border-border px-6 py-3 font-sans text-sm font-normal leading-none whitespace-nowrap no-underline hover:border-rule-strong"
          href="/install"
        >
          Install on a repo
        </a>
      </nav>

      <main>
        <header className="pt-10 pb-10">
          <p className="font-mono text-sm text-muted-foreground tabular-nums">
            {owner} / {repo}
          </p>
          <h1 className="mt-1 text-xl font-bold tracking-[-0.02em] break-all">
            Living audit report
          </h1>
          <div className="mt-4 flex flex-wrap gap-3 font-mono text-xs tabular-nums">
            <span className="rounded-full border border-primary px-3 py-0.5 whitespace-nowrap text-primary">
              {chain.name} · {chain.chainId}
            </span>
            <span className="rounded-full border border-border px-3 py-0.5 whitespace-nowrap text-muted-foreground">
              Contract {shortHex(chain.attestation)}
            </span>
            <span className="rounded-full border border-border px-3 py-0.5 whitespace-nowrap text-muted-foreground">
              riskScore 0–100 · higher = riskier
            </span>
          </div>
        </header>

        {!reviews.ok ? (
          <section
            aria-label="Index unavailable"
            className="my-10 rounded-lg border border-dashed border-rule-strong p-10 text-center"
          >
            <span className="mb-2 block font-mono text-xs tracking-[0.12em] uppercase text-label">
              index unavailable
            </span>
            <p className="mx-auto max-w-[46ch] text-muted-foreground">
              The review index could not be read ({reviews.reason}) — no data is shown rather than
              guessed.
            </p>
          </section>
        ) : rows.length === 0 ? (
          <section
            aria-label="No reviews yet"
            className="my-10 rounded-lg border border-dashed border-rule-strong p-10 text-center"
          >
            <p className="mx-auto max-w-[46ch] text-muted-foreground">
              No attested reviews yet for this repo. Install the GitHub App and open a pull request
              that touches money-code — the first verdict lands here, with its on-chain receipt.
            </p>
          </section>
        ) : (
          <>
            <ScoreHistory rows={rows} />
            <ReviewLedger
              rows={rows}
              repoFullName={repoFullName}
              agentName={identity?.name ?? null}
            />
          </>
        )}

        <AgentIdentityCard
          name={identity?.name ?? null}
          active={identity?.active ?? null}
          reviewCount={identity?.reviewCount ?? null}
          attestedIncomplete={attestedIncomplete}
          agentAddress={chain.agent}
          erc8004={identityData.erc8004}
          unavailableReason={identity ? undefined : "rpc read failed"}
        />
      </main>

      <footer className="border-t border-border pt-10 pb-6">
        <p className="max-w-[28ch] text-xl font-bold tracking-[-0.02em] break-all">
          The verdict lives <span className="text-primary">on-chain</span> — recomputable by anyone,
          from the findings alone.
        </p>
        <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-4 font-mono text-xs text-muted-foreground">
          <span>Rextor Security</span>
          <span>
            {chain.name} {chain.chainId}
          </span>
          <span>{shortHex(chain.attestation)}</span>
          <span>© 2026</span>
        </div>
      </footer>
    </>
  );
}
