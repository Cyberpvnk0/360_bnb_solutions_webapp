import Link from "next/link";
import { APP_NAME } from "@/config/app";
import { Button } from "@/components/ui/button";
import { MetricLabel } from "@/components/primitives/metric-label";
import { CompsVisual } from "@/components/marketing/comps-visual";
import { HeroMockup } from "@/components/marketing/hero-mockup";
import { MarketMapVisual } from "@/components/marketing/market-map-visual";
import { PipelineVisual } from "@/components/marketing/pipeline-visual";
import { PricingSection } from "@/components/marketing/pricing-section";

/**
 * The coverage, as figures rather than as a sentence about figures.
 *
 * These three were prose — "409 markets, 6,900+ submarkets" set at the
 * same weight as the two claims beside it, so the one genuinely
 * checkable fact on the page carried no more weight than an adjective.
 * A number is the most credible thing a product like this can show, and
 * it should look like one.
 *
 * Counted from the catalogue itself (lib/mock/markets, lib/mock/submarkets)
 * rather than rounded upward: 409 markets, 6,935 submarkets, 51 states
 * and DC. If the catalogue grows, these are the numbers to re-count —
 * they are claims, and a stale claim is a false one.
 */
const COVERAGE = [
  { figure: "409", label: "Markets", sub: "Every one measured, not sampled" },
  { figure: "6,935", label: "Submarkets", sub: "Down to the neighborhood" },
  { figure: "51", label: "States & DC", sub: "Coast to coast" },
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
      {/* 1 — Hero.
          The band was py-28 around content that did not need it: the
          headline floated a long way below the nav and the eye had to
          travel before it met anything. Tighter at the top, generous at
          the bottom, so the fold opens ON the claim. */}
      <section className="pt-12 pb-16 md:pt-16 md:pb-20">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 md:px-8 lg:gap-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div>
            <h1 className="font-display text-5xl font-semibold leading-[1.04] tracking-tight text-foreground md:text-6xl">
              Know your breakeven occupancy before you sign the lease.
            </h1>
            <p className="mt-6 max-w-xl text-base text-muted-foreground md:text-lg">
              {APP_NAME} answers the only question that matters in rental
              arbitrage — does the nightly revenue beat the lease — before you
              commit to one.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/deals">Get started</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <a href="#pricing">See pricing</a>
              </Button>
            </div>
            {/* Beside the decision, not buried at the foot of the page.
                The two things a person weighs before clicking are what
                it costs them to try and how long it takes. */}
            <p className="mt-4 text-sm text-muted-foreground">
              No card required. Your first analysis takes about a minute.
            </p>
          </div>
          <HeroMockup className="w-full max-w-md justify-self-center lg:max-w-lg lg:justify-self-end" />
        </div>
      </section>

      {/* 2 — Coverage, in figures. */}
      <section className="py-10 md:py-12">
        <div className="mx-auto max-w-6xl px-4 md:px-8">
          <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {COVERAGE.map((c) => (
              <div
                key={c.label}
                className="py-6 sm:px-10 sm:py-1 sm:first:pl-0 sm:last:pr-0"
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-4xl font-semibold tracking-tight tabular text-foreground md:text-5xl">
                    {c.figure}
                  </span>
                  <MetricLabel>{c.label}</MetricLabel>
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">{c.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3 — How it works */}
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-6xl px-4 md:px-8">
          <MetricLabel>How it works</MetricLabel>
          <h2 className="mt-3 max-w-xl font-display text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
            From address to decision.
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="rounded-sm border border-border bg-card p-7">
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
      <section className="py-16 md:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 md:px-8 lg:gap-14 lg:grid-cols-2">
          <div>
            <MetricLabel>Market explorer</MetricLabel>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              Start where the spread is widest.
            </h2>
            <p className="mt-4 max-w-md text-base text-muted-foreground">
              409 markets across every state and DC, ranked by the gap between
              nightly revenue and long-term rent — then drill into the
              neighborhoods inside each one. Gold clears the lease; muted red
              doesn&apos;t. Pick your market with the same discipline you pick
              your lease.
            </p>
          </div>
          <MarketMapVisual className="w-full max-w-xl justify-self-center lg:max-w-none lg:justify-self-end" />
        </div>
      </section>

      {/* 4b — Evidence-first comps */}
      <section className="py-16 md:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 md:px-8 lg:gap-14 lg:grid-cols-2">
          <div className="lg:order-2 lg:justify-self-end">
            <MetricLabel>Evidence-first comps</MetricLabel>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              You never see an estimate without the comps that made it.
            </h2>
            <p className="mt-4 max-w-md text-base text-muted-foreground">
              Every projection sits on real nearby properties — their nightly
              rates, their occupancy, their revenue. If the comps look thin,
              the deal is thin. You find that out before you sign, not after.
            </p>
          </div>
          <CompsVisual className="w-full max-w-xl justify-self-center lg:max-w-none lg:order-1 lg:justify-self-start" />
        </div>
      </section>

      {/* 4c — Pipeline & landlord book */}
      <section className="py-16 md:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 md:px-8 lg:gap-14 lg:grid-cols-2">
          <div>
            <MetricLabel>Pipeline &amp; landlord book</MetricLabel>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              Your landlord book is yours.
            </h2>
            <p className="mt-4 max-w-md text-base text-muted-foreground">
              Track every deal from first call to signed lease, with the
              landlord conversation filed next to the numbers. Never pooled,
              never shared — your contacts stay off everyone else&apos;s map.
            </p>
          </div>
          <PipelineVisual className="w-full max-w-xl justify-self-center lg:max-w-none lg:justify-self-end" />
        </div>
      </section>

      {/* 5 — Pricing */}
      <section id="pricing" className="scroll-mt-16 py-16 md:py-20">
        <PricingSection />
      </section>

      {/* 6 — Closing */}
      <section className="py-16 md:py-20">
        <div className="mx-auto flex max-w-6xl flex-col items-center px-4 text-center md:px-8">
          <p className="max-w-2xl font-display text-3xl font-semibold tracking-tight text-foreground md:text-5xl">
            The numbers first. Then the keys.
          </p>
          <Button asChild size="lg" className="mt-8">
            <Link href="/deals">Get started</Link>
          </Button>
          <p className="mt-4 text-sm text-muted-foreground">
            No card required. Cancel whenever.
          </p>
        </div>
      </section>
    </div>
  );
}
