import React from 'react';
import { Activity, Droplets, Fish, Thermometer } from 'lucide-react';

const ponds = [
  { name: 'Pond 01', status: 'Stocked', count: '2,400 fingerlings', date: '12 Nov 2026', harvest: '18 Mar 2027', color: 'bg-cyan-50 text-cyan-800' },
  { name: 'Pond 02', status: 'Preparing', count: 'Awaiting stock', date: '—', harvest: '—', color: 'bg-amber-50 text-amber-800' },
  { name: 'Pond 03', status: 'Stocked', count: '1,800 fingerlings', date: '05 Nov 2026', harvest: '10 Mar 2027', color: 'bg-cyan-50 text-cyan-800' },
];

export const FisheryView: React.FC = () => (
  <div className="space-y-6">
    <header className="rounded-2xl bg-gradient-to-r from-cyan-900 to-teal-800 p-6 text-white shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Operations · Fishery</p>
      <h1 className="mt-2 text-2xl font-bold">Pond Overview</h1>
      <p className="mt-1 max-w-xl text-sm text-cyan-50/80">A starter view for pond operations. These preview values are illustrative and are not stored as farm records.</p>
    </header>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Pond overview cards">
      {ponds.map((pond) => <article key={pond.name} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between"><div><p className="text-xs font-medium uppercase tracking-wide text-stone-500">{pond.name}</p><h2 className="mt-1 text-lg font-bold text-stone-900">{pond.count}</h2></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${pond.color}`}>{pond.status}</span></div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-stone-500">Stocking date</p><p className="mt-1 font-medium">{pond.date}</p></div><div><p className="text-xs text-stone-500">Target harvest</p><p className="mt-1 font-medium">{pond.harvest}</p></div></div>
      </article>)}
    </section>
    <section className="grid gap-4 lg:grid-cols-2">
      <article className="rounded-2xl border border-stone-200 bg-white p-5"><div className="flex items-center gap-2"><Droplets className="h-5 w-5 text-cyan-700"/><h2 className="font-bold">Water Quality · Latest Preview</h2></div><div className="mt-4 grid grid-cols-3 gap-3">{[['pH','7.2'],['Dissolved oxygen','5.8 mg/L'],['Temperature','27 °C']].map(([label,value],i)=><div key={label} className="rounded-xl bg-cyan-50/70 p-3"><div className="flex items-center gap-1 text-xs text-stone-500">{i===2?<Thermometer className="h-3.5 w-3.5"/>:<Activity className="h-3.5 w-3.5"/>}{label}</div><p className="mt-2 font-semibold text-cyan-950">{value}</p></div>)}</div><p className="mt-3 text-xs text-stone-500">Mock preview only; water-quality logging is not connected yet.</p></article>
      <article className="rounded-2xl border border-stone-200 bg-white p-5"><div className="flex items-center gap-2"><Fish className="h-5 w-5 text-teal-700"/><h2 className="font-bold">Feeding &amp; Sampling</h2></div><div className="mt-4 space-y-3 text-sm"><div className="flex justify-between rounded-xl bg-stone-50 p-3"><span className="text-stone-600">Last feed log</span><span className="font-medium">No entries yet</span></div><div className="flex justify-between rounded-xl bg-stone-50 p-3"><span className="text-stone-600">Last sample weight</span><span className="font-medium">No entries yet</span></div></div><p className="mt-3 text-xs text-stone-500">Fishery records will be enabled in a future data-model phase.</p></article>
    </section>
  </div>
);
