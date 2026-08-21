import Link from "next/link";
import { APP_NAME } from "@/config/app";
import { Button } from "@/components/ui/button";
import { MetricLabel } from "@/components/primitives/metric-label";
import { CompsVisual } from "@/components/marketing/comps-visual";
import { HeroMockup } from "@/components/marketing/hero-mockup";
import { MarketMapVisual } from "@/components/marketing/market-map-visual";
import { PipelineVisual } from "@/components/marketing/pipeline-visual";
import { PricingSection } from "@/components/marketing/pricing-section";

const PROOF = [
  {
    claim: "40 markets, coast to coast",
    sub: "From Phoenix to Myrtle Beach — occupancy, nightly rates, and lease spreads for every one.",
  },
  {
    claim: "Comps behind every number",
    sub: "Each projection shows the nearby properties that produced it.",
  },
  {
    claim: "Breakeven-first underwriting",
    sub: "One figure decides the deal: the occupancy where you clear the lease.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Pull an address",
    copy: "Paste any address in a covered market. You get the nightly comps, the lease estimate, and a full projection on one screen.",
  },
  {
    n: "02",
    title: "See breakeven vs the market",
    copy: "The gauge shows the occupancy where you clear costs, against what the market actually runs. The gap is your margin of safety.",
  },
  {
    n: "03",
    title: "Sign only what pencils",
    copy: "Save the deals that clear, pass on the ones that don't, and walk into the landlord call with the numbers printed.",
  },
];

export default function LandingPage() {
  return (
    <div className="divide-y divide-border">
      {/* 1 — Hero */}
      <section className="py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 md:px-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div>
            <h1 className="font-display text-5xl font-medium leading-[1.04] tracking-tight text-foreground md:text-6xl">
              Know your breakeven occupancy before you sign the lease.
            </h1>
            <p className="mt-6 max-w-xl text-base text-muted-foreground md:text-lg">
              {APP_NAME} answers the only question that matters in rental
              arbitrage — does the nightly revenue beat the lease — before you
              commit to one.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/dashboard">Get started</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <a href="#pricing">See pricing</a>
              </Button>
            </div>
          </div>
          <HeroMockup className="w-full max-w-md justify-self-center lg:justify-self-end" />
        </div>
      </section>

      {/* 2 — Proof row */}
      <section className="py-12 md:py-16">
        <div className="mx-auto max-w-6xl px-4 md:px-8">
          <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {PROOF.map((p) => (
              <div key={p.claim} className="py-5 sm:px-8 sm:py-2 sm:first:pl-0 sm:last:pr-0">
                <div className="text-base font-semibold tracking-tight text-foreground">
                  {p.claim}
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">{p.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3 — How it works */}
      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-4 md:px-8">
          <MetricLabel>How it works</MetricLabel>
          <h2 className="mt-3 max-w-xl font-display text-3xl font-medium tracking-tight text-foreground md:text-4xl">
            From address to decision.
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="rounded-sm border border-border bg-card p-6">
                <MetricLabel className="tabular">{s.n}</MetricLabel>
                <h3 className="mt-4 text-base font-semibold tracking-tight text-foreground">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {s.copy}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4a — Market explorer */}
      <section className="py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 md:px-8 lg:grid-cols-2">
          <div>
            <MetricLabel>Market explorer</MetricLabel>
            <h2 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground md:text-4xl">
              Start where the spread is widest.
            </h2>
            <p className="mt-4 max-w-md text-base text-muted-foreground">
              A split map of 40 markets across the country, ranked by the gap
              between nightly revenue and long-term rent. Gold clears the
              lease; muted red doesn&apos;t. Pick your market with the same
              discipline you pick your lease.
            </p>
          </div>
          <MarketMapVisual className="w-full max-w-xl justify-self-center lg:justify-self-end" />
        </div>
      </section>

      {/* 4b — Evidence-first comps */}
      <section className="py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 md:px-8 lg:grid-cols-2">
          <div className="lg:order-2 lg:justify-self-end">
            <MetricLabel>Evidence-first comps</MetricLabel>
            <h2 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground md:text-4xl">
              You never see an estimate without the comps that made it.
            </h2>
            <p className="mt-4 max-w-md text-base text-muted-foreground">
              Every projection sits on real nearby properties — their nightly
              rates, their occupancy, their revenue. If the comps look thin,
              the deal is thin. You find that out before you sign, not after.
            </p>
          </div>
          <CompsVisual className="w-full max-w-xl justify-self-center lg:order-1 lg:justify-self-start" />
        </div>
      </section>

      {/* 4c — Pipeline & landlord book */}
      <section className="py-20 md:py-28">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 md:px-8 lg:grid-cols-2">
          <div>
            <MetricLabel>Pipeline &amp; landlord book</MetricLabel>
            <h2 className="mt-3 font-display text-3xl font-medium tracking-tight text-foreground md:text-4xl">
              Your landlord book is yours.
            </h2>
            <p className="mt-4 max-w-md text-base text-muted-foreground">
              Track every deal from first call to signed lease, with the
              landlord conversation filed next to the numbers. Never pooled,
              never shared — your contacts stay off everyone else&apos;s map.
            </p>
          </div>
          <PipelineVisual className="w-full max-w-xl justify-self-center lg:justify-self-end" />
        </div>
      </section>

      {/* 5 — Pricing */}
      <section id="pricing" className="scroll-mt-14 py-20 md:py-28">
        <PricingSection />
      </section>

      {/* 6 — Closing */}
      <section className="py-20 md:py-28">
        <div className="mx-auto flex max-w-6xl flex-col items-center px-4 text-center md:px-8">
          <p className="max-w-2xl font-display text-3xl font-medium tracking-tight text-foreground md:text-5xl">
            The numbers first. Then the keys.
          </p>
          <Button asChild size="lg" className="mt-8">
            <Link href="/dashboard">Get started</Link>
          </Button>
          <p className="mt-4 text-sm text-muted-foreground">
            Free plan included. No card required.
          </p>
        </div>
      </section>
    </div>
  );
}
