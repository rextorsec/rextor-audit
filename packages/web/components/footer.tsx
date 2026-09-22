import { Wordmark } from "@/components/nav";

/** Ft5 · Statement — one closing line, meta row beneath. The firm link returns
 *  when rextorsecurity.com resolves (dead DNS as of 2026-09-22). */
export function Footer() {
  return (
    <footer className="container pb-10 pt-16">
      <p className="m-0 mb-10 max-w-[28ch] text-display-s leading-[1.08] font-semibold tracking-[-0.025em] [overflow-wrap:anywhere]">
        Audits are point&#8209;in&#8209;time. Code is continuous.
      </p>
      <div className="flex flex-wrap items-baseline gap-6 border-t border-border pt-4 font-mono text-xs text-subtle-foreground">
        <Wordmark size="xs" className="text-foreground" />
        <span>by Rextor Security</span>
        <span className="ml-auto max-[60rem]:ml-0">© 2026</span>
      </div>
    </footer>
  );
}
