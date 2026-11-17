import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, ClipboardList, ShieldCheck, Wheat } from 'lucide-react';

interface LandingPageProps {
  onSignIn: () => Promise<void>;
  authError: string | null;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onSignIn, authError }) => {
  const [signingIn, setSigningIn] = useState(false);

  const handleSignInClick = async () => {
    setSigningIn(true);
    try {
      await onSignIn();
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top Bar Contract: 3 exact zones */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-4">
          <a
            href="#top"
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Babagiwa Farms
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a
              href="#operations"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Operations
            </a>
            <a
              href="#workflow"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Daily Workflow
            </a>
            <a
              href="#controls"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Cost &amp; Audit
            </a>
            <a
              href="#sectors"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Farm Sectors
            </a>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={handleSignInClick}
              disabled={signingIn}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900 transition-colors disabled:opacity-60 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
            >
              <span>{signingIn ? 'Connecting...' : 'Sign In'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main id="top">
        {/* Hero Split */}
        <section className="mx-auto max-w-6xl px-6 pt-12 pb-16 lg:pt-16 lg:pb-20">
          {authError && (
            <div
              role="alert"
              className="mb-8 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {authError}
            </div>
          )}

          <div className="grid grid-cols-1 items-stretch gap-10 lg:grid-cols-12">
            <div className="flex flex-col justify-center lg:col-span-6">
              <p className="text-xs font-medium tracking-wide text-emerald-800">
                Babagiwa Agricultural Operations · Poultry Layer Edition
              </p>
              <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl leading-[1.12] text-balance">
                Dependable daily farm records for poultry production, feed, and egg sales.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-600">
                Built for Babagiwa farm managers and pen attendants to record flock placements,
                multiple daily egg collections, gram-standardized feed stock with locked historical
                costs, and egg sales with clear NGN reporting.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={handleSignInClick}
                  disabled={signingIn}
                  className="inline-flex items-center gap-2.5 rounded-lg bg-emerald-800 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-900 transition-colors disabled:opacity-60 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
                >
                  <span>{signingIn ? 'Signing in with Google...' : 'Sign in with Google'}</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
                <a
                  href="#operations"
                  className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
                >
                  Review MVP Scope
                </a>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-200 pt-5 text-xs text-slate-500">
                <span>Poultry Layer Active</span>
                <span aria-hidden="true">·</span>
                <span>Default Currency NGN (₦)</span>
                <span aria-hidden="true">·</span>
                <span>Role-Based Access Control</span>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="relative h-72 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-200 lg:h-full lg:min-h-[380px]">
                <img
                  src="/images/landing/nigerian-poultry-farm.jpg"
                  alt="Well-managed Nigerian poultry layer house in warm morning light"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-transparent" />
                <div className="absolute bottom-4 left-4 right-4 text-white">
                  <p className="text-xs font-medium text-slate-200">
                    Layer Houses &amp; Feed Store · Africa/Lagos Timezone
                  </p>
                  <p className="mt-0.5 text-sm font-semibold">
                    Every crate, kilogram, and sale recorded against persisted farm ledgers.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Core Capabilities */}
        <section id="operations" className="border-t border-slate-200 bg-white py-16">
          <div className="mx-auto max-w-6xl px-6">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                Core poultry workflows included in this release
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Focused strictly on complete, auditable daily workflows rather than unbuilt menus.
              </p>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-6">
                <p className="font-mono text-xs font-medium text-emerald-800">01. Flock &amp; Pen Registry</p>
                <h3 className="mt-2 text-lg font-semibold text-slate-900">
                  Pens, unique batches, and historical age tracking
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Configure poultry houses, assign active flocks without overlapping pen occupancy,
                  and compute bird age accurately relative to each historical transaction date from
                  hatch date or placement age.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-6">
                <p className="font-mono text-xs font-medium text-emerald-800">02. Egg Production</p>
                <h3 className="mt-2 text-lg font-semibold text-slate-900">
                  Multiple independent collections per batch and day
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Record morning, afternoon, or evening pickups separately in 30-egg crates,
                  individual pieces, cracked eggs, and damaged eggs. Editing one entry never alters
                  sibling records from the same day.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-6">
                <p className="font-mono text-xs font-medium text-emerald-800">03. Feed Stock &amp; Costing</p>
                <h3 className="mt-2 text-lg font-semibold text-slate-900">
                  Authoritative gram balances and protected cost snapshots
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Enter purchases and issues in kg or bags (configurable 25 kg default). Stock is
                  validated transactionally to block negative balances, and consumption locks the
                  latest purchase cost on or before the consumption date.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-6">
                <p className="font-mono text-xs font-medium text-emerald-800">04. Egg Sales &amp; Reports</p>
                <h3 className="mt-2 text-lg font-semibold text-slate-900">
                  Selling unit price snapshots and reconciled summaries
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Suggest configured unit prices (crates, half crates, singles) while gating price
                  overrides behind an explicit permission. Filter reports by date range and export
                  authorized data to CSV.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Grading / Workflow Section */}
        <section id="workflow" className="border-t border-slate-200 bg-slate-50 py-16">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-6 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-200 aspect-[4/3]">
                <img
                  src="/images/landing/nigerian-egg-grading.jpg"
                  alt="Fresh brown eggs arranged in recycled-pulp crates at a Nigerian farm grading table"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>

            <div className="lg:col-span-7">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                Built around real pen-to-store accountability
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                Every mutation records who created or updated it, preserves historical cost and
                price snapshots when farm settings change, and uses auditable voiding instead of
                silent deletion.
              </p>

              <dl id="controls" className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <dt className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                    <ClipboardList className="h-4 w-4 text-emerald-800" />
                    <span>Before/After Audit</span>
                  </dt>
                  <dd className="mt-1.5 text-xs leading-relaxed text-slate-600">
                    Consequential edits, price overrides, and void actions append immutable logs.
                  </dd>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <dt className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                    <Wheat className="h-4 w-4 text-emerald-800" />
                    <span>Zero Negative Stock</span>
                  </dt>
                  <dd className="mt-1.5 text-xs leading-relaxed text-slate-600">
                    Transactional checks prevent feed issues when available inventory is insufficient.
                  </dd>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <dt className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                    <ShieldCheck className="h-4 w-4 text-emerald-800" />
                    <span>Tenant Isolation</span>
                  </dt>
                  <dd className="mt-1.5 text-xs leading-relaxed text-slate-600">
                    Firestore security rules enforce active farm membership and per-module permissions.
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        {/* Sector Roadmap Transparency */}
        <section id="sectors" className="border-t border-slate-200 bg-white py-12">
          <div className="mx-auto max-w-6xl px-6">
            <div className="flex flex-col justify-between gap-6 rounded-xl border border-slate-200 bg-slate-50 p-6 md:flex-row md:items-center">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Babagiwa Multi-Sector Roadmap
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Poultry layer operations are active in this MVP. Fishery, oil palm, vegetables, and
                  medication inventory are intentionally deferred to upcoming releases.
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs font-medium text-emerald-800 shrink-0">
                <CheckCircle2 className="h-4 w-4" />
                <span>Poultry Layer Active Now</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 text-xs text-slate-500 sm:flex-row sm:items-center">
          <p>Babagiwa Farm Management System · Poultry Operations MVP</p>
          <p>Currency: NGN (₦) · Timezone: Africa/Lagos</p>
        </div>
      </footer>
    </div>
  );
};
