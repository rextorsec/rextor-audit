import { Button } from "@/components/ui/button";

export function FinalCta() {
  return (
    <section className="border-t border-border py-[6rem]" id="install">
      <h2 className="max-w-[30ch] text-lg font-bold tracking-[-0.02em] [overflow-wrap:anywhere]">
        Install once. Every PR after that is an audit event.
      </h2>
      <p className="mt-4 mb-6 max-w-[55ch] text-base font-normal text-muted-foreground">
        Two‑click install on GitHub. The agent reviews the PRs that touch money‑code and anchors
        each verdict on‑chain.
      </p>
      <Button asChild>
        <a href="#install">Install the GitHub App</a>
      </Button>
    </section>
  );
}