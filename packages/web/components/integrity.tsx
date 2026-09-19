import type { ReactNode } from "react";

const itemRow =
  "grid grid-cols-1 gap-1 border-t border-border py-6 min-[60rem]:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] min-[60rem]:gap-6";

const items: Array<{ title: string; body: ReactNode }> = [
  {
    title: "Findings require citations",
    body: "Every LLM operation carries a cited line range or it is discarded. The agent never invents findings and never scores anything.",
  },
  {
    title: "INCOMPLETE is on‑chain",
    body: (
      <>
        A broken analyzer produces <code>status = 1</code>, attested — an on‑chain{" "}
        <code>riskScore: 0</code> can never masquerade as a clean pass.
      </>
    ),
  },
  {
    title: "PR content is untrusted input",
    body: "PR titles, comments, and code are adversarial by assumption — rendered inert, prompt‑injection hardened, simulation sandboxed.",
  },
  {
    title: "The attestation key has no fund path",
    body: "Worst case from key theft: visible, attributable bogus attestations. There is nothing to steal.",
  },
];

export function Integrity() {
  return (
    <section className="py-16" aria-label="Integrity rails">
      <h2 className="mb-10 text-2xl font-bold tracking-[-0.02em] [overflow-wrap:anywhere]">
        The integrity rails
      </h2>
      {items.map(({ title, body }) => (
        <div key={title} className={itemRow}>
          <h3 className="text-md font-medium [overflow-wrap:anywhere]">{title}</h3>
          <p className="max-w-[60ch] text-muted-foreground [&>code]:font-mono [&>code]:text-sm [&>code]:text-foreground">
            {body}
          </p>
        </div>
      ))}
    </section>
  );
}