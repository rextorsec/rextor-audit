import { Button } from "@/components/ui/button";

const WORDMARK_SIZES = { sm: "text-sm", md: "text-md", xs: "text-xs" } as const;

/** Wordmark — mono register + raptor mark. Shared by nav and footer. Size is
 *  a prop (not a className override) so the font-size can't silently lose to
 *  the base utility via stylesheet order. */
export function Wordmark({
  className = "",
  size = "sm",
}: {
  className?: string;
  size?: keyof typeof WORDMARK_SIZES;
}) {
  return (
    <a
      href="#"
      className={`flex items-center gap-1 font-mono ${WORDMARK_SIZES[size]} font-medium tracking-[0.08em] no-underline whitespace-nowrap before:inline-block before:size-2 before:rounded-[1px] before:bg-primary ${className}`}
    >
      REXTOR AUDIT
    </a>
  );
}

/** N1b · canonical SaaS three-section bar — wordmark / centred links / GitHub + CTA. */
export function Nav() {
  return (
    <nav
      aria-label="Primary"
      className="nav-bar sticky top-0 z-[200] border-b border-border"
    >
      <div className="mx-auto grid h-[3.75rem] w-full max-w-[72rem] grid-cols-[1fr_auto_1fr] items-center gap-4 px-[clamp(1rem,4vw,2rem)]">
        <Wordmark className="justify-self-start" />
        <div className="hidden justify-self-center gap-6 min-[56.25rem]:flex">
          <a
            className="text-sm no-underline whitespace-nowrap text-muted-foreground hover:text-foreground active:text-foreground"
            href="#tour"
          >
            Tour
          </a>
          <a
            className="text-sm no-underline whitespace-nowrap text-muted-foreground hover:text-foreground active:text-foreground"
            href="#matrix"
          >
            Capabilities
          </a>
          <a
            className="text-sm no-underline whitespace-nowrap text-muted-foreground hover:text-foreground active:text-foreground"
            href="#tracks"
          >
            Tracks
          </a>
          <a
            className="text-sm no-underline whitespace-nowrap text-muted-foreground hover:text-foreground active:text-foreground"
            href="#integrity"
          >
            Integrity
          </a>
          <a
            className="text-sm no-underline whitespace-nowrap text-muted-foreground hover:text-foreground active:text-foreground"
            href="#faq"
          >
            FAQ
          </a>
        </div>
        <div className="flex items-center justify-self-end gap-6">
          <a
            className="hidden text-sm no-underline whitespace-nowrap text-muted-foreground hover:text-foreground active:text-foreground min-[40rem]:inline"
            href="https://github.com/rextorsec/rextor-audit"
          >
            GitHub↗
          </a>
          <Button asChild size="sm">
            <a href="#install">Install</a>
          </Button>
        </div>
      </div>
    </nav>
  );
}
