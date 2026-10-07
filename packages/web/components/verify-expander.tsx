"use client";

// SPEC-6 §3 (dashboard v2) — the verify/why expander as a Base UI Collapsible
// (the stack directive's third detection marker: Radix + Tailwind + Base UI).
// Server components pass the expander BODY as children — this client island
// only owns open/close state; all content stays server-rendered.
// keepMounted: the body stays in the DOM when closed (hidden), matching the
// v1 <details> DOM that tests and no-JS readers could see.
import { Collapsible } from "@base-ui-components/react/collapsible";
import type { ReactNode } from "react";

export function VerifyExpander({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Collapsible.Root className="mt-2">
      <Collapsible.Trigger
        className="cursor-pointer font-mono text-xs tracking-[0.08em] uppercase text-muted-foreground outline-none before:text-subtle-foreground before:content-['▸_'] aria-expanded:before:content-['▾_'] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {label}
      </Collapsible.Trigger>
      <Collapsible.Panel keepMounted className="mt-2">
        {children}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
