import type { ReactNode } from "react";

const items: Array<{ title: string; body: ReactNode }> = [
  {
    title: "It can't invent findings.",
    body: "Every operation carries a cited line range or it is discarded. The agent never scores anything — the published rubric does, and anyone can recompute it.",
  },
  {
    title: "It can't fake a clean pass.",
    body: (
      <>
        A broken analyzer produces <code>status = 1</code>, attested on-chain — a{" "}
        <code>riskScore: 0</code> can never masquerade as &quot;all clear&quot;.
      </>
    ),
  },
  {
    title: "It can't be hijacked by PR content.",
    body: "Titles, comments, and code are adversarial by assumption — rendered inert, prompt-injection hardened, simulation sandboxed.",
  },
  {
    title: "It can't lose money.",
    body: "The attestation key has no fund path. Worst case from key theft: visible, attributable bogus attestations. There is nothing to steal.",
  },
];

export function Integrity() {
  return (
    <section className="pb-16 pt-10" id="integrity" aria-label="What Rextor can't do">
      <h2 className="mb-2 text-2xl font-semibold leading-[1.15] tracking-[-0.02em] [overflow-wrap:anywhere]">
        What Rextor can&apos;t do
      </h2>
      <p className="m-0 mb-10 max-w-[60ch] text-muted-foreground">
        The integrity rails, in plain words — the refusals are the product.
      </p>
      {items.map(({ title, body }) => (
        <div key={title} className="border-t border-border py-6">
          <h3 className="m-0 mb-1 text-md font-semibold tracking-[-0.01em] [overflow-wrap:anywhere]">
            {title}
          </h3>
          <p className="m-0 max-w-[68ch] text-muted-foreground [&>code]:rounded-sm [&>code]:bg-card [&>code]:px-0.5 [&>code]:font-mono [&>code]:text-sm [&>code]:text-muted-foreground">
            {body}
          </p>
        </div>
      ))}
    </section>
  );
}
