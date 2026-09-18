import { Button } from "@/components/ui/button";

function Wordmark({ className = "" }: { className?: string }) {
  return (
    <a
      href="#"
      className={`flex items-center gap-1 font-mono text-sm font-medium tracking-[0.08em] no-underline whitespace-nowrap before:inline-block before:size-2 before:rounded-[1px] before:bg-primary ${className}`}
    >
      REXTOR AUDIT
    </a>
  );
}

export { Wordmark };

export function PillNav() {
  return (
    <nav
      aria-label="Primary"
      className="nav-pill fixed top-4 right-4 z-[200] flex items-center gap-4 rounded-full border border-border px-4 py-2 whitespace-nowrap sm:left-1/2 sm:right-auto sm:-translate-x-1/2"
    >
      <Wordmark />
      <div className="hidden gap-4 sm:flex">
        <a className="text-sm no-underline whitespace-nowrap text-muted-foreground hover:text-foreground" href="#tour">
          Stage tour
        </a>
        <a className="text-sm no-underline whitespace-nowrap text-muted-foreground hover:text-foreground" href="#matrix">
          Capability matrix
        </a>
        <a className="text-sm no-underline whitespace-nowrap text-muted-foreground hover:text-foreground" href="#tracks">
          Tracks
        </a>
      </div>
      <Button asChild className="ml-1" size="sm">
        <a href="#install">Install</a>
      </Button>
    </nav>
  );
}