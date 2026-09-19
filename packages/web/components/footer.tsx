import { Wordmark } from "@/components/pill-nav";

export function Footer() {
  return (
    <footer className="container flex flex-wrap items-baseline gap-3 border-t border-border py-6 font-mono text-xs text-muted-foreground">
      <Wordmark className="text-xs text-foreground" />
      <span>
        by <a className="no-underline hover:text-foreground" href="https://rextorsecurity.com">Rextor Security</a>
      </span>
      <span>Audits are point‑in‑time. Code is continuous.</span>
      <span>© 2026</span>
    </footer>
  );
}