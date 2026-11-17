import React from 'react';
import { HeartPulse, Layers3, Scale, Wheat } from 'lucide-react';

const herds = [
  { name: 'Cattle · East Paddock', count: '24 head', status: 'Healthy', note: 'Routine check due 20 Nov' },
  { name: 'Goats · Unit A', count: '38 head', status: 'Review', note: '3 animals flagged for follow-up' },
  { name: 'Sheep · Unit B', count: '16 head', status: 'Healthy', note: 'No open health notes' },
];

export const LivestockView: React.FC = () => (
  <div className="space-y-6">
    <header className="rounded-2xl bg-gradient-to-r from-amber-900 to-orange-800 p-6 text-white shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">Operations · Livestock</p>
      <h1 className="mt-2 text-2xl font-bold">Herd &amp; Pen Overview</h1>
      <p className="mt-1 max-w-xl text-sm text-amber-50/80">A UI foundation for non-poultry livestock operations. Sample cards are placeholders only; no livestock schema or backend is created.</p>
    </header>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Herd overview cards">
      {herds.map((herd) => <article key={herd.name} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between"><div><p className="text-xs font-medium uppercase tracking-wide text-stone-500">{herd.name}</p><h2 className="mt-1 text-xl font-bold text-stone-900">{herd.count}</h2></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${herd.status === 'Healthy' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{herd.status}</span></div><p className="mt-4 text-sm text-stone-600">{herd.note}</p><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-xl bg-stone-50 p-3"><div className="flex items-center gap-1.5 text-xs text-stone-500"><Wheat className="h-3.5 w-3.5"/>Feed log</div><p className="mt-1 text-sm font-medium">No entries</p></div><div className="rounded-xl bg-stone-50 p-3"><div className="flex items-center gap-1.5 text-xs text-stone-500"><Scale className="h-3.5 w-3.5"/>Weight sample</div><p className="mt-1 text-sm font-medium">No entries</p></div></div></article>)}
    </section>
    <article className="rounded-2xl border border-stone-200 bg-white p-5"><div className="flex items-center gap-2"><HeartPulse className="h-5 w-5 text-rose-700"/><h2 className="font-bold">Health &amp; Welfare Notes</h2></div><div className="mt-4 flex items-center gap-2 rounded-xl bg-stone-50 p-4 text-sm text-stone-600"><Layers3 className="h-4 w-4"/>No livestock health records are connected yet.</div></article>
  </div>
);
