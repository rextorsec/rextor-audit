import type { ReactNode } from "react";

import { receiptLink } from "@/lib/receipt-link";

const faqs: Array<{ q: string; a: ReactNode }> = [
  {
    q: "What does it cost?",
    a: "Free. If that ever changes, pricing ships on this page first — no surprise invoices.",
  },
  {
    q: "Which chains does it run on?",
    a: (
      <>
        Tempo testnet runs the full loop today, and verdicts anchor on HyperEVM mainnet as of
        2026‑09‑21. Ethereum, Base, Arbitrum, and Robinhood Chain ride the same deterministic pass
        with home‑chain anchoring.{" "}
        <a
          className={receiptLink}
          href="https://explorer.solana.com/address/Aj6NxH8Ptjn7v3QVCZEQ9dPNWx8DjmaE2oPMNvnikMDs?cluster=devnet"
        >
          Solana devnet is live ↗
        </a>
        .
      </>
    ),
  },
  {
    q: 'What is a "verdict on-chain"?',
    a: (
      <>
        Every review ends with a small record written to the blockchain — commit hash, findings
        hash, risk score, agent identity. After it lands, nobody can edit it, including us.{" "}
        <a
          className={receiptLink}
          href="https://hyperevmscan.io/address/0x8f63c0581ab3b2836c95f97fcf104d2dd962850c"
        >
          See one ↗
        </a>
      </>
    ),
  },
  {
    q: "Does this replace my auditor?",
    a: "No. Rextor makes every pull request an audit event between the human audits. Your annual engagement still matters — this is the continuous layer underneath it.",
  },
  {
    q: "What happens when the tooling breaks?",
    a: "The run marks itself INCOMPLETE and attests that on-chain. A broken analyzer can never look like a clean pass — failure is a visible, checkable state.",
  },
  {
    q: "Can I see it working before installing?",
    a: (
      <>
        Yes —{" "}
        <a
          className={receiptLink}
          href="https://explore.testnet.tempo.xyz/address/0x51ac8214089daf85b188437b087519acfc6c495a"
        >
          live verdicts on Tempo ↗
        </a>
        , and the whole system is built in the open:{" "}
        <a className={receiptLink} href="https://github.com/rextorsec/rextor-audit">
          public repo ↗
        </a>
        .
      </>
    ),
  },
];

export function Faq() {
  return (
    <section className="pb-16 pt-10" id="faq" aria-label="Questions, answered straight">
      <h2 className="mb-10 text-2xl font-semibold leading-[1.15] tracking-[-0.02em] [overflow-wrap:anywhere]">
        Questions, answered straight
      </h2>
      <div>
        {faqs.map(({ q, a }) => (
          <details key={q} className="border-t border-border last:border-b">
            <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4 rounded-sm py-4 text-base font-medium focus-visible:[outline:2px_solid_var(--ring)] focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden after:font-mono after:font-normal after:text-md after:text-subtle-foreground after:content-['+'] open:after:content-['–']">
              {q}
            </summary>
            <p className="mx-0 mb-4 max-w-[65ch] pr-16 text-muted-foreground">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
