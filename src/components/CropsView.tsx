import React from 'react';
import { CalendarDays, Leaf, Map, SprayCan } from 'lucide-react';

const plots = [
  { name: 'North Plot', size: '2.5 ha', variety: 'Maize · Oba Super 6', planted: '02 Nov 2026', harvest: 'Feb 2027' },
  { name: 'River Plot', size: '1.2 ha', variety: 'Cassava · TME 419', planted: '28 Oct 2026', harvest: 'Oct 2027' },
  { name: 'Garden Plot', size: '0.4 ha', variety: 'Tomato · Roma VF', planted: '10 Nov 2026', harvest: 'Jan 2027' },
];

export const CropsView: React.FC = () => (
  <div className="space-y-6">
    <header className="rounded-2xl bg-gradient-to-r from-lime-900 to-emerald-800 p-6 text-white shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-lime-200">Operations · Crops</p>
      <h1 className="mt-2 text-2xl font-bold">Plots &amp; Crop Calendar</h1>
      <p className="mt-1 max-w-xl text-sm text-lime-50/80">A minimal workspace for crop operations. Preview information is illustrative and not saved to farm records.</p>
    </header>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Crop plot cards">
      {plots.map((plot) => <article key={plot.name} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Map className="h-4 w-4 text-emerald-700"/><p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{plot.name}</p></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">{plot.size}</span></div><h2 className="mt-3 text-lg font-bold text-stone-900">{plot.variety}</h2><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-stone-500">Planting date</p><p className="mt-1 font-medium">{plot.planted}</p></div><div><p className="text-xs text-stone-500">Expected harvest</p><p className="mt-1 font-medium">{plot.harvest}</p></div></div></article>)}
    </section>
    <section className="grid gap-4 lg:grid-cols-2"><article className="rounded-2xl border border-stone-200 bg-white p-5"><div className="flex items-center gap-2"><SprayCan className="h-5 w-5 text-emerald-700"/><h2 className="font-bold">Spraying Schedule Preview</h2></div><div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-950"><p className="font-semibold">No spraying tasks scheduled</p><p className="mt-1 text-xs text-amber-900/80">Future crop tasks can be added when crop records are implemented.</p></div></article><article className="rounded-2xl border border-stone-200 bg-white p-5"><div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-lime-700"/><h2 className="font-bold">Fertilizer Calendar Preview</h2></div><div className="mt-4 rounded-xl bg-stone-50 p-4 text-sm"><div className="flex items-center gap-2 text-stone-600"><Leaf className="h-4 w-4"/>No upcoming fertilizer entries</div><p className="mt-2 text-xs text-stone-500">This panel is UI-only and does not write to Firestore.</p></div></article></section>
  </div>
);
