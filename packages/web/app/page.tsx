import { CapabilityTable, type Capabilities } from "@/components/capability-table";
import { FinalCta } from "@/components/final-cta";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { Integrity } from "@/components/integrity";
import { PillNav } from "@/components/pill-nav";
import { Tracks } from "@/components/tracks";
import { Tour } from "@/components/tour";
import capabilitiesData from "@/content/capabilities.json";

const capabilities = capabilitiesData as Capabilities;

export default function LandingPage() {
  return (
    <>
      <PillNav />
      <Hero />
      <main className="container">
        <Tour />
        <CapabilityTable data={capabilities} />
        <Tracks />
        <Integrity />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}