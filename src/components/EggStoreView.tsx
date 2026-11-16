import React, { useEffect, useMemo, useState } from 'react';
import { formatDateInTimezone, formatEggCountInCrates, formatIsoDateDisplay, hasPermission } from '../domain/calculations.ts';
import { cratesAndPiecesFromEggs, eggsFromCratesAndPieces, formatEggQuantity, validateSortingReconciliation } from '../domain/eggStore.ts';
import { formatUserFriendlyError } from '../lib/firebase.ts';
import {
  createProductionTransfer,
  postOpeningStock,
  receiveEggTransfer,
  recordEggInventoryMovement,
  saveEggStoreSettings,
  sortReceivedEggs,
} from '../services/eggStoreService.ts';
import type { Farm, FarmMember, EggProductionEntry, Pen } from '../types/farm.ts';
import type { EggGrade, EggInventoryBalance, EggInventoryMovement, EggQuantities, EggSalesMode, EggStoreReceipt, EggStoreSettings, EggStockCategory, EggTransfer } from '../types/eggStore.ts';

interface EggStoreViewProps {
  farm: Farm;
  member: FarmMember;
  pens: Pen[];
  production: EggProductionEntry[];
  settings: EggStoreSettings | null;
  transfers: EggTransfer[];
  receipts: EggStoreReceipt[];
  sortingBatches: { id: string }[];
  balances: EggInventoryBalance[];
  movements: EggInventoryMovement[];
}

type Tab = 'overview' | 'transfer' | 'receiving' | 'sorting' | 'inventory' | 'movements' | 'setup';
const DEFAULT_GRADES: EggGrade[] = ['Jumbo', 'Big', 'Medium', 'Small', 'Pullet', 'Unsorted'];
const EMPTY_QTY: EggQuantities = { intactEggs: 0, crackedEggs: 0, damagedEggs: 0 };

export const EggStoreView: React.FC<EggStoreViewProps> = ({
  farm, member, pens, production, settings, transfers, receipts, sortingBatches, balances, movements,
}) => {
  const today = formatDateInTimezone(new Date(), farm.timezone);
  const canRead = hasPermission(member, 'eggStore', 'read');
  const canTransfer = hasPermission(member, 'eggStore', 'transfer');
  const canReceive = hasPermission(member, 'eggStore', 'receive');
  const canSort = hasPermission(member, 'eggStore', 'sort');
  const canAdjust = hasPermission(member, 'eggStore', 'adjust');
  const canDistribute = hasPermission(member, 'eggStore', 'distribute');
  const canDispose = hasPermission(member, 'eggStore', 'dispose');
  const canInventoryRead = canRead || canAdjust || canDistribute || canDispose;
  const canEditSettings = hasPermission(member, 'settings', 'edit');
  const cfg: EggStoreSettings = settings || {
    id: 'current', farmId: farm.farmId, salesMode: 'phantom', inventoryOrganization: 'mixed',
    gradingMode: 'graded', grades: DEFAULT_GRADES, allowCrackedSales: false, allowDamagedSales: false,
    openingStockCompleted: false, createdBy: member.uid, updatedBy: member.uid, createdAt: null, updatedAt: null,
  };
  const penById = useMemo(() => new Map(pens.map((p) => [p.id, p])), [pens]);
  const transferTotals = useMemo(() => {
    const map = new Map<string, EggQuantities>();
    for (const t of transfers) {
      if (t.status === 'voided') continue;
      const cur = map.get(t.productionEntryId) || { ...EMPTY_QTY };
      cur.intactEggs += t.quantities.intactEggs;
      cur.crackedEggs += t.quantities.crackedEggs;
      cur.damagedEggs += t.quantities.damagedEggs;
      map.set(t.productionEntryId, cur);
    }
    return map;
  }, [transfers]);
  const availableProduction = useMemo(() => production.filter((p) => {
    const moved = transferTotals.get(p.id) || EMPTY_QTY;
    return (p.status === 'APPROVED' || p.status === undefined) && !p.isVoided && (p.intactEggs > moved.intactEggs || p.crackedEggs > moved.crackedEggs || p.damagedEggs > moved.damagedEggs);
  }), [production, transferTotals]);
  const pendingTransfers = useMemo(() => transfers.filter((t) => t.status === 'awaiting_receipt'), [transfers]);
  const unsortedReceipts = useMemo(() => receipts.filter((r) => !sortingBatches.some((b) => b.id === r.id)), [receipts, sortingBatches]);

  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [productionId, setProductionId] = useState('');
  const [transferCrates, setTransferCrates] = useState('0');
  const [transferPieces, setTransferPieces] = useState('0');
  const [transferCracked, setTransferCracked] = useState('0');
  const [transferDamaged, setTransferDamaged] = useState('0');
  const [transferReference, setTransferReference] = useState('');
  const [transferRemarks, setTransferRemarks] = useState('');
  const [selectedTransferId, setSelectedTransferId] = useState('');
  const [actualCrates, setActualCrates] = useState('0');
  const [actualPieces, setActualPieces] = useState('0');
  const [actualCracked, setActualCracked] = useState('0');
  const [actualDamaged, setActualDamaged] = useState('0');
  const [receiptDate, setReceiptDate] = useState(today);
  const [receiptRemarks, setReceiptRemarks] = useState('');
  const [sortReceiptId, setSortReceiptId] = useState('');
  const [sortOutputs, setSortOutputs] = useState<Record<string, string>>({});
  const [sortCracked, setSortCracked] = useState('0');
  const [sortDamaged, setSortDamaged] = useState('0');
  const [sortRemarks, setSortRemarks] = useState('');
  const [movementKind, setMovementKind] = useState<'free_distribution' | 'breakage' | 'adjustment' | 'disposal'>('free_distribution');
  const [movementBalanceId, setMovementBalanceId] = useState('');
  const [movementCategory, setMovementCategory] = useState<EggStockCategory>('Unsorted');
  const [movementQty, setMovementQty] = useState('1');
  const [movementDate, setMovementDate] = useState(today);
  const [movementReference, setMovementReference] = useState('');
  const [movementReason, setMovementReason] = useState('');
  const [movementRemarks, setMovementRemarks] = useState('');
  const [salesMode, setSalesMode] = useState<EggSalesMode>(cfg.salesMode);
  const [organization, setOrganization] = useState(cfg.inventoryOrganization);
  const [gradingMode, setGradingMode] = useState(cfg.gradingMode);
  const [grades, setGrades] = useState<EggGrade[]>(cfg.grades);
  const [allowCracked, setAllowCracked] = useState(cfg.allowCrackedSales);
  const [allowDamaged, setAllowDamaged] = useState(cfg.allowDamagedSales);
  const [openingDate, setOpeningDate] = useState(today);
  const [openingLines, setOpeningLines] = useState<{ category: EggStockCategory; sourcePenId: string; quantityEggs: string }[]>([
    { category: 'Unsorted', sourcePenId: '', quantityEggs: '0' },
  ]);
  const [openingRemarks, setOpeningRemarks] = useState('');

  useEffect(() => {
    if (!settings) return;
    setSalesMode(settings.salesMode);
    setOrganization(settings.inventoryOrganization);
    setGradingMode(settings.gradingMode);
    setGrades(settings.grades);
    setAllowCracked(settings.allowCrackedSales);
    setAllowDamaged(settings.allowDamagedSales);
  }, [settings]);

  const selectedProduction = availableProduction.find((p) => p.id === productionId);
  const transferRemaining = selectedProduction ? (() => {
    const used = transferTotals.get(selectedProduction.id) || EMPTY_QTY;
    return {
      intactEggs: selectedProduction.intactEggs - used.intactEggs,
      crackedEggs: selectedProduction.crackedEggs - used.crackedEggs,
      damagedEggs: selectedProduction.damagedEggs - used.damagedEggs,
    };
  })() : EMPTY_QTY;
  const selectedTransfer = pendingTransfers.find((t) => t.id === selectedTransferId);
  const selectedReceipt = unsortedReceipts.find((r) => r.id === sortReceiptId);
  const movementBalance = balances.find((b) => b.id === movementBalanceId);
  const stockTotal = balances.reduce((s, b) => s + Math.max(0, b.balanceEggs), 0);
  const gradeCounts = useMemo(() => {
    const map = new Map<EggStockCategory, number>();
    balances.forEach((b) => map.set(b.category, (map.get(b.category) || 0) + Math.max(0, b.balanceEggs)));
    return map;
  }, [balances]);

  const report = (fn: () => Promise<unknown>, success: string) => async (e: React.FormEvent) => {
    e.preventDefault(); setFeedback(null); setBusy(true);
    try { await fn(); setFeedback({ type: 'success', text: success }); }
    catch (err) { setFeedback({ type: 'error', text: formatUserFriendlyError(err) }); }
    finally { setBusy(false); }
  };

  const submitTransfer = report(async () => {
    if (!selectedProduction) throw new Error('Select a production record with remaining eggs.');
    const intactEggs = eggsFromCratesAndPieces(Number(transferCrates), Number(transferPieces));
    await createProductionTransfer({ farmId: farm.farmId, productionEntryId: selectedProduction.id,
      quantities: { intactEggs, crackedEggs: Number(transferCracked), damagedEggs: Number(transferDamaged) },
      reference: transferReference, remarks: transferRemarks, actor: member });
    setTransferCrates('0'); setTransferPieces('0'); setTransferCracked('0'); setTransferDamaged('0');
    setTransferReference(''); setTransferRemarks('');
  }, 'Production transfer recorded. Store stock will increase only after physical receiving.');

  const chooseTransfer = (id: string) => {
    setSelectedTransferId(id); setReceiptRemarks('');
    const transfer = pendingTransfers.find((t) => t.id === id);
    if (transfer) {
      const split = cratesAndPiecesFromEggs(transfer.quantities.intactEggs);
      setActualCrates(String(split.crates)); setActualPieces(String(split.pieces));
      setActualCracked(String(transfer.quantities.crackedEggs)); setActualDamaged(String(transfer.quantities.damagedEggs));
    }
  };

  const submitReceipt = report(async () => {
    if (!selectedTransfer) throw new Error('Select an awaiting transfer.');
    const actual: EggQuantities = {
      intactEggs: eggsFromCratesAndPieces(Number(actualCrates), Number(actualPieces)),
      crackedEggs: Number(actualCracked), damagedEggs: Number(actualDamaged),
    };
    await receiveEggTransfer({ farmId: farm.farmId, transfer: selectedTransfer, actual,
      transactionDate: receiptDate, transactionTime: new Date().toTimeString().slice(0, 5), remarks: receiptRemarks, actor: member });
    setReceiptRemarks(''); setSelectedTransferId('');
  }, 'Actual received quantities posted to the store ledger.');

  const chooseReceipt = (id: string) => {
    setSortReceiptId(id); setSortRemarks('');
    const receipt = unsortedReceipts.find((r) => r.id === id);
    const defaults: Record<string, string> = {};
    if (receipt && gradingMode === 'unsorted') defaults.Unsorted = String(receipt.received.intactEggs);
    setSortOutputs(defaults);
    setSortCracked(String(receipt?.received.crackedEggs || 0));
    setSortDamaged(String(receipt?.received.damagedEggs || 0));
  };

  const submitSorting = report(async () => {
    if (!selectedReceipt) throw new Error('Select a received, unsorted transfer.');
    const outputsByGrade = Object.fromEntries(grades.map((grade) => [grade, Number(sortOutputs[grade] || 0)])) as Partial<Record<EggGrade, number>>;
    validateSortingReconciliation({ inputs: selectedReceipt.received, outputsByGrade, crackedEggs: Number(sortCracked), damagedEggs: Number(sortDamaged) });
    await sortReceivedEggs({ farmId: farm.farmId, receipt: selectedReceipt, outputsByGrade,
      crackedEggs: Number(sortCracked), damagedEggs: Number(sortDamaged), transactionDate: today,
      transactionTime: new Date().toTimeString().slice(0, 5), remarks: sortRemarks, actor: member });
    setSortReceiptId(''); setSortRemarks('');
  }, 'Sorting posted. Grade outputs exactly reconcile to the received egg count.');

  const submitMovement = report(async () => {
    const removing = movementKind !== 'adjustment' || Number(movementQty) < 0;
    const balance = removing ? movementBalance : undefined;
    if (removing && !balance) throw new Error('Select the stock lot to reduce.');
    await recordEggInventoryMovement({ farmId: farm.farmId, movementType: movementKind,
      category: balance?.category || movementCategory, quantityDelta: (removing ? -1 : 1) * Math.abs(Number(movementQty)),
      balance, sourcePenId: balance?.sourcePenId || '', sourcePenName: balance?.sourcePenNameSnapshot || '',
      transactionDate: movementDate, reference: movementReference, reason: movementReason,
      remarks: movementRemarks, actor: member });
    setMovementQty('1'); setMovementReference(''); setMovementReason(''); setMovementRemarks('');
  }, 'Inventory movement recorded.');

  const submitSettings = report(async () => {
    await saveEggStoreSettings({ farmId: farm.farmId, current: cfg, salesMode, inventoryOrganization: organization,
      gradingMode, grades, allowCrackedSales: allowCracked, allowDamagedSales: allowDamaged, actorUid: member.uid });
  }, 'Egg Store configuration saved.');

  const submitOpening = report(async () => {
    await postOpeningStock({ farmId: farm.farmId, transactionDate: openingDate,
      lines: openingLines.map((line) => ({ category: line.category, sourcePenId: line.sourcePenId,
        sourcePenName: penById.get(line.sourcePenId)?.name || 'Opening stock', quantityEggs: Number(line.quantityEggs) })),
      remarks: openingRemarks, actor: member });
    setOpeningRemarks(''); setOpeningLines([{ category: 'Unsorted', sourcePenId: '', quantityEggs: '0' }]);
  }, 'Audited physical opening stock posted.');

  const tabs: { id: Tab; label: string; visible: boolean }[] = [
    { id: 'overview', label: 'Overview', visible: true },
    { id: 'transfer', label: 'Production Transfer', visible: canTransfer },
    { id: 'receiving', label: 'Receiving', visible: canReceive },
    { id: 'sorting', label: 'Sorting & Grades', visible: canSort },
    { id: 'inventory', label: 'Inventory', visible: canInventoryRead },
    { id: 'movements', label: 'Movement History', visible: canInventoryRead },
    { id: 'setup', label: 'Farm Setup', visible: canEditSettings },
  ];

  if (!canRead && !canTransfer && !canReceive && !canSort && !canAdjust && !canDistribute && !canDispose && !canEditSettings) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">You do not have permission to access the Egg Store.</div>;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Egg Store</h1>
        <p className="mt-1 text-xs text-slate-500">Transfers do not increase stock until received. All stock changes are online transactions and are recorded in an append-only movement ledger.</p>
      </header>
      {feedback && <div role={feedback.type === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${feedback.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>{feedback.text}</div>}
      <nav className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1" aria-label="Egg Store sections">
        {tabs.filter((t) => t.visible).map((t) => <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`rounded-lg px-3 py-2 text-xs font-medium ${tab === t.id ? 'bg-emerald-800 text-white' : 'text-slate-700 hover:bg-slate-100'}`}>{t.label}</button>)}
      </nav>

      {tab === 'overview' && <section className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Summary label="Store balance" value={formatEggQuantity(stockTotal)} />
          <Summary label="Unsorted" value={formatEggQuantity(gradeCounts.get('Unsorted') || 0)} />
          <Summary label="Awaiting receipt" value={String(pendingTransfers.length)} />
          <Summary label="Sales mode" value={cfg.salesMode === 'true_inventory' ? 'True Egg Sales' : 'Phantom Egg Sales'} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="font-semibold text-slate-900">Current stock by category</h2><div className="mt-3 space-y-2 text-sm">{(['Jumbo','Big','Medium','Small','Pullet','Unsorted','Cracked','Damaged'] as EggStockCategory[]).map((c) => <div key={c} className="flex justify-between border-b border-slate-100 pb-2"><span>{c}</span><strong className="font-mono">{formatEggQuantity(gradeCounts.get(c) || 0)}</strong></div>)}</div></div>
          <div className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="font-semibold text-slate-900">Workflow queue</h2><p className="mt-3 text-sm text-slate-600">{pendingTransfers.length} transfer(s) waiting for physical receiving.</p><p className="mt-1 text-sm text-slate-600">{unsortedReceipts.length} receipt(s) waiting for sorting.</p><p className="mt-3 text-xs text-slate-500">Inventory view: {cfg.inventoryOrganization === 'pen_based' ? 'Pen-based origin balances' : 'General/mixed pooled balances'} · Grading: {cfg.gradingMode === 'graded' ? 'graded' : 'unsorted'}</p></div>
        </div>
      </section>}

      {tab === 'transfer' && <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <form onSubmit={submitTransfer} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Transfer production to store</h2>
          <label className="block text-xs font-medium">Production record<select required value={productionId} onChange={(e) => setProductionId(e.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2"><option value="">Select record</option>{availableProduction.map((p) => <option key={p.id} value={p.id}>{formatIsoDateDisplay(p.transactionDate)} · {p.batchCodeSnapshot} · {p.penNameSnapshot} · {formatEggCountInCrates(p.totalEggs)}</option>)}</select></label>
          {selectedProduction && <p className="text-xs text-slate-600">Remaining to transfer: intact {transferRemaining.intactEggs.toLocaleString()}, cracked {transferRemaining.crackedEggs.toLocaleString()}, damaged {transferRemaining.damagedEggs.toLocaleString()} eggs.</p>}
          <div className="grid grid-cols-2 gap-2"><NumberField label="Intact crates" value={transferCrates} set={setTransferCrates}/><NumberField label="Intact pieces" value={transferPieces} set={setTransferPieces}/><NumberField label="Cracked eggs" value={transferCracked} set={setTransferCracked}/><NumberField label="Damaged eggs" value={transferDamaged} set={setTransferDamaged}/></div>
          <TextField label="Transfer/reference no." value={transferReference} set={setTransferReference}/><TextField label="Notes" value={transferRemarks} set={setTransferRemarks}/>
          <button disabled={busy || !canTransfer} className="rounded bg-emerald-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Posting…' : 'Record transfer'}</button>
        </form>
        <RecordList title="Transfer register" empty="No transfers recorded." rows={transfers.map((t) => <div key={t.id} className="flex justify-between gap-3 border-b border-slate-100 py-2 text-xs"><div><strong>{formatIsoDateDisplay(t.productionDate)} · {t.batchCodeSnapshot} / {t.penNameSnapshot}</strong><div className="text-slate-500">{formatEggCountInCrates(t.totalEggs)} expected · {t.reference || 'No reference'}</div></div><span className="h-fit rounded bg-slate-100 px-2 py-1 capitalize">{t.status.replace('_',' ')}</span></div>)}/>
      </section>}

      {tab === 'receiving' && <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <form onSubmit={submitReceipt} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Receive physical transfer</h2>
          <label className="block text-xs font-medium">Awaiting transfer<select required value={selectedTransferId} onChange={(e) => chooseTransfer(e.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2"><option value="">Select transfer</option>{pendingTransfers.map((t) => <option key={t.id} value={t.id}>{formatIsoDateDisplay(t.productionDate)} · {t.batchCodeSnapshot} / {t.penNameSnapshot} · {formatEggCountInCrates(t.totalEggs)}</option>)}</select></label>
          {selectedTransfer && <div className="rounded bg-slate-50 p-2 text-xs">Expected: {selectedTransfer.quantities.intactEggs} intact, {selectedTransfer.quantities.crackedEggs} cracked, {selectedTransfer.quantities.damagedEggs} damaged ({selectedTransfer.totalEggs} total)</div>}
          <label className="block text-xs font-medium">Receipt date<input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2"/></label>
          <div className="grid grid-cols-2 gap-2"><NumberField label="Actual intact crates" value={actualCrates} set={setActualCrates}/><NumberField label="Actual intact pieces" value={actualPieces} set={setActualPieces}/><NumberField label="Actual cracked eggs" value={actualCracked} set={setActualCracked}/><NumberField label="Actual damaged eggs" value={actualDamaged} set={setActualDamaged}/></div>
          <TextField label="Variance / receiving notes (required if total differs)" value={receiptRemarks} set={setReceiptRemarks}/>
          <button disabled={busy || !canReceive || !pendingTransfers.length} className="rounded bg-emerald-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Posting…' : 'Post physical receipt'}</button>
        </form>
        <RecordList title="Store receipts" empty="No store receipts yet." rows={receipts.map((r) => <div key={r.id} className="border-b border-slate-100 py-2 text-xs"><strong>{formatIsoDateDisplay(r.transactionDate)} · {r.batchCodeSnapshot} / {r.penNameSnapshot}</strong><div className="text-slate-600">Expected {formatEggCountInCrates(r.expectedTotalEggs)} · received {formatEggCountInCrates(r.receivedTotalEggs)} · variance {r.varianceEggs.toLocaleString()}</div><div className="text-slate-500">{r.remarks || 'No variance notes'}</div></div>)}/>
      </section>}

      {tab === 'sorting' && <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <form onSubmit={submitSorting} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Sort and grade a received lot</h2>
          <label className="block text-xs font-medium">Unsorted receipt<select required value={sortReceiptId} onChange={(e) => chooseReceipt(e.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2"><option value="">Select receipt</option>{unsortedReceipts.map((r) => <option key={r.id} value={r.id}>{formatIsoDateDisplay(r.transactionDate)} · {r.batchCodeSnapshot} / {r.penNameSnapshot} · {formatEggCountInCrates(r.receivedTotalEggs)}</option>)}</select></label>
          {selectedReceipt && <p className="text-xs text-slate-600">Exact reconciliation required: {selectedReceipt.receivedTotalEggs.toLocaleString()} eggs across all outputs.</p>}
          <div className="grid grid-cols-2 gap-2">{grades.map((g) => <NumberField key={g} label={`${g} eggs`} value={sortOutputs[g] || '0'} set={(v) => setSortOutputs((old) => ({ ...old, [g]: v }))}/>) }<NumberField label="Cracked eggs" value={sortCracked} set={setSortCracked}/><NumberField label="Damaged eggs" value={sortDamaged} set={setSortDamaged}/></div>
          <TextField label="Sorting notes" value={sortRemarks} set={setSortRemarks}/>
          <button disabled={busy || !canSort || !selectedReceipt} className="rounded bg-emerald-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Posting…' : 'Post reconciled sorting'}</button>
        </form>
        <RecordList title="Sorting batches" empty="No receipts sorted yet." rows={sortingBatches.map((b) => <div key={b.id} className="border-b border-slate-100 py-2 text-xs"><strong>Receipt {b.id}</strong><div className="text-slate-500">Sorting record permanently linked to its source receipt.</div></div>)}/>
      </section>}

      {tab === 'inventory' && <section className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">{(['Jumbo','Big','Medium','Small','Pullet','Unsorted','Cracked','Damaged'] as EggStockCategory[]).map((c) => <Summary key={c} label={c} value={formatEggQuantity(gradeCounts.get(c) || 0)} />)}</div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-600"><tr><th className="p-3">Grade/type</th><th className="p-3">Pen of origin</th><th className="p-3">Lot/receipt</th><th className="p-3 text-right">Balance</th><th className="p-3 text-right">Crates + pieces</th></tr></thead><tbody className="divide-y divide-slate-100">{balances.filter((b) => b.balanceEggs > 0).map((b) => <tr key={b.id}><td className="p-3 font-medium">{b.category}</td><td className="p-3">{b.sourcePenNameSnapshot || 'Opening stock'}</td><td className="p-3 font-mono">{b.lotId}</td><td className="p-3 text-right font-mono">{formatEggQuantity(b.balanceEggs)}</td><td className="p-3 text-right font-mono">{formatEggQuantity(b.balanceEggs)}</td></tr>)}{balances.every((b) => b.balanceEggs <= 0) && <tr><td className="p-6 text-center text-slate-500" colSpan={5}>No stock yet. Receive transfers or enter the audited opening count.</td></tr>}</tbody></table></div>
      </section>}

      {tab === 'movements' && <section className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        <form onSubmit={submitMovement} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Record inventory movement</h2>
          <label className="block text-xs font-medium">Movement<select value={movementKind} onChange={(e) => setMovementKind(e.target.value as typeof movementKind)} className="mt-1 w-full rounded border border-slate-300 p-2"><option value="free_distribution">Free distribution</option><option value="breakage">Breakage / loss</option><option value="adjustment">Audited adjustment</option><option value="disposal">Disposal</option></select></label>
          <label className="block text-xs font-medium">Stock lot to reduce<select required={movementKind !== 'adjustment' || Number(movementQty) < 0} value={movementBalanceId} onChange={(e) => {setMovementBalanceId(e.target.value); const b = balances.find((x) => x.id === e.target.value); if (b) setMovementCategory(b.category);}} className="mt-1 w-full rounded border border-slate-300 p-2"><option value="">Select lot</option>{balances.filter((b) => b.balanceEggs > 0).map((b) => <option key={b.id} value={b.id}>{b.category} · {b.sourcePenNameSnapshot} · {formatEggCountInCrates(b.balanceEggs)}</option>)}</select></label>
          {movementKind === 'adjustment' && <label className="block text-xs font-medium">Adjustment direction<select value={Number(movementQty) < 0 ? 'decrease' : 'increase'} onChange={(e) => {setMovementBalanceId(''); setMovementQty(e.target.value === 'decrease' ? '-1' : '1');}} className="mt-1 w-full rounded border border-slate-300 p-2"><option value="decrease">Reduce selected lot</option><option value="increase">Add counted stock</option></select></label>}
          {movementKind === 'adjustment' && Number(movementQty) > 0 && <label className="block text-xs font-medium">New stock category<select value={movementCategory} onChange={(e) => setMovementCategory(e.target.value as EggStockCategory)} className="mt-1 w-full rounded border border-slate-300 p-2">{(['Jumbo','Big','Medium','Small','Pullet','Unsorted','Cracked','Damaged'] as EggStockCategory[]).map((c) => <option key={c}>{c}</option>)}</select></label>}
          <NumberField label="Egg pieces" value={String(Math.abs(Number(movementQty)))} set={(v) => setMovementQty(`${Number(movementQty) < 0 ? '-' : ''}${v}`)}/>
          <label className="block text-xs font-medium">Date<input type="date" value={movementDate} onChange={(e) => setMovementDate(e.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2"/></label>
          <TextField label="Reason (required)" value={movementReason} set={setMovementReason}/><TextField label="Reference / recipient" value={movementReference} set={setMovementReference}/><TextField label="Notes" value={movementRemarks} set={setMovementRemarks}/>
          <button disabled={busy || (movementKind === 'free_distribution' && !canDistribute) || (movementKind === 'disposal' && !canDispose) || ((movementKind === 'breakage' || movementKind === 'adjustment') && !canAdjust)} className="rounded bg-emerald-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Posting…' : 'Record movement'}</button>
        </form>
        <RecordList title="Append-only movement ledger" empty="No inventory movements yet." rows={movements.map((m) => <div key={m.id} className="grid grid-cols-[1fr_auto] gap-3 border-b border-slate-100 py-2 text-xs"><div><strong>{formatIsoDateDisplay(m.transactionDate)} · {m.movementType.replace('_',' ')} · {m.category}</strong><div className="text-slate-500">{m.reason} · {m.sourcePenNameSnapshot || 'Opening stock'} · {m.reference || '—'}</div></div><span className={`font-mono font-semibold ${m.quantityDelta < 0 ? 'text-red-700' : 'text-emerald-800'}`}>{m.quantityDelta > 0 ? '+' : ''}{m.quantityDelta}</span></div>)}/>
      </section>}

      {tab === 'setup' && <section className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={submitSettings} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Egg Store settings</h2>
          <label className="block text-xs font-medium">Sales mode<select value={salesMode} onChange={(e) => setSalesMode(e.target.value as EggSalesMode)} className="mt-1 w-full rounded border border-slate-300 p-2"><option value="phantom">Phantom Egg Sales (no stock deduction)</option><option value="true_inventory">True Egg Sales (stock enforced)</option></select></label>
          <label className="block text-xs font-medium">Inventory organization<select value={organization} onChange={(e) => setOrganization(e.target.value as EggStoreSettings['inventoryOrganization'])} className="mt-1 w-full rounded border border-slate-300 p-2"><option value="pen_based">Pen-Based origin balances</option><option value="mixed">General / Mixed pooled by grade</option></select></label>
          <label className="block text-xs font-medium">Grading mode<select value={gradingMode} onChange={(e) => setGradingMode(e.target.value as EggStoreSettings['gradingMode'])} className="mt-1 w-full rounded border border-slate-300 p-2"><option value="graded">Grade eggs at receiving</option><option value="unsorted">Keep intact eggs as Unsorted</option></select></label>
          <fieldset className="rounded border border-slate-200 p-3"><legend className="px-1 text-xs font-medium">Grades enabled</legend><div className="grid grid-cols-2 gap-2">{DEFAULT_GRADES.map((g) => <label key={g} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={grades.includes(g)} onChange={(e) => setGrades((old) => e.target.checked ? [...old, g] : old.filter((x) => x !== g))}/>{g}</label>)}</div></fieldset>
          <div className="flex flex-wrap gap-4"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={allowCracked} onChange={(e) => setAllowCracked(e.target.checked)}/>Allow cracked eggs in sale</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={allowDamaged} onChange={(e) => setAllowDamaged(e.target.checked)}/>Allow damaged eggs in sale</label></div>
          {!cfg.openingStockCompleted && salesMode === 'true_inventory' && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">True mode cannot be enabled until an audited physical opening stock count is posted.</p>}
          <button disabled={busy || !canEditSettings} className="rounded bg-emerald-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Save settings</button>
        </form>
        <form onSubmit={submitOpening} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Audited physical opening stock</h2>
          {cfg.openingStockCompleted ? <p className="rounded bg-emerald-50 p-3 text-sm text-emerald-900">Opening count has already been posted. Later corrections must use an audited adjustment.</p> : <>
            <label className="block text-xs font-medium">Count date<input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2"/></label>
            {openingLines.map((line, i) => <div key={i} className="grid grid-cols-3 gap-2"><label className="text-xs">Category<select value={line.category} onChange={(e) => setOpeningLines((old) => old.map((x,j) => i===j ? {...x, category:e.target.value as EggStockCategory} : x))} className="mt-1 w-full rounded border p-2">{(['Jumbo','Big','Medium','Small','Pullet','Unsorted','Cracked','Damaged'] as EggStockCategory[]).map(c=><option key={c}>{c}</option>)}</select></label><label className="text-xs">Pen origin<select value={line.sourcePenId} onChange={(e) => setOpeningLines((old) => old.map((x,j) => i===j ? {...x, sourcePenId:e.target.value} : x))} className="mt-1 w-full rounded border p-2"><option value="">Mixed / unknown</option>{pens.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="text-xs">Egg pieces<input type="number" min="0" step="1" value={line.quantityEggs} onChange={(e) => setOpeningLines((old) => old.map((x,j) => i===j ? {...x, quantityEggs:e.target.value} : x))} className="mt-1 w-full rounded border p-2"/></label></div>)}
            <button type="button" onClick={() => setOpeningLines((old) => [...old, {category:'Unsorted',sourcePenId:'',quantityEggs:'0'}])} className="rounded border px-3 py-1.5 text-xs">Add stock line</button>
            <TextField label="Count notes (required)" value={openingRemarks} set={setOpeningRemarks}/>
            <button disabled={busy || !canEditSettings} className="rounded bg-emerald-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Post opening count</button>
          </>}
        </form>
      </section>}

      <div className="text-[11px] text-slate-500">Mode: {cfg.salesMode === 'true_inventory' ? 'True inventory enforcement' : 'Phantom sales compatibility'} · Stock rows are retained by source lot even when the display is pooled.</div>
    </div>
  );
};

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-mono text-lg font-bold">{value}</p></div>;
}
function NumberField({ label, value, set }: { label: string; value: string; set: (v: string) => void }) {
  return <label className="block text-xs font-medium">{label}<input type="number" min="0" step="1" value={value} onChange={(e) => set(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-3 py-2 font-mono"/></label>;
}
function TextField({ label, value, set }: { label: string; value: string; set: (v: string) => void }) {
  return <label className="block text-xs font-medium">{label}<input type="text" value={value} onChange={(e) => set(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-3 py-2"/></label>;
}
function RecordList({ title, empty, rows }: { title: string; empty: string; rows: React.ReactNode[] }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="font-semibold">{title}</h2><div className="mt-2 max-h-[34rem] overflow-y-auto">{rows.length ? rows : <p className="py-6 text-center text-sm text-slate-500">{empty}</p>}</div></div>;
}
