import { CapabilityTable, type Capabilities } from "@/components/capability-table";
import { Faq } from "@/components/faq";
import { FinalCta } from "@/components/final-cta";
import { Footer } from "@/components/footer";
import { Hero, FALLBACK_COUNTS } from "@/components/hero";
import { Integrity } from "@/components/integrity";
import { Nav } from "@/components/nav";
import { PlainWords } from "@/components/plain-words";
import { Tracks } from "@/components/tracks";
import { Tour } from "@/components/tour";
import capabilitiesData from "@/content/capabilities.json";
import { readAgentIdentity } from "@/lib/chain-read";

const capabilities = capabilitiesData as Capabilities;

// Hero facts are live RPC reads (agent identity + review counts) — revalidate
// the landing every 5 minutes; honest static fallbacks cover RPC outages.
export const revalidate = 300;

// Nonce-CSP requires per-request rendering: the middleware mints a fresh
// nonce per request, so build-time-cached HTML would carry inline scripts no
// live nonce can vouch for (verified empirically — prerendered HTML ships
// unstamped scripts). The RPC reads stay Data-Cache-bounded; only the
// template render runs per request.
export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const [tempo, hyperliquid] = await Promise.all([
    readAgentIdentity("tempo"),
    readAgentIdentity("hyperliquid"),
  ]);
  const totalReviews =
    (tempo?.reviewCount ?? FALLBACK_COUNTS.tempo) +
    (hyperliquid?.reviewCount ?? FALLBACK_COUNTS.hyperliquid);

  return (
    <>
      <Nav />
      <Hero tempo={tempo} hyperliquid={hyperliquid} />
      <main className="container">
        <PlainWords />
        <Tour />
        <CapabilityTable data={capabilities} />
        <Tracks totalReviews={totalReviews} />
        <Integrity />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
