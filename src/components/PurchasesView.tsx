import React, { useMemo, useState } from 'react';
import {
  Ban,
  Bookmark,
  Calendar,
  Edit2,
  FileEdit,
  FileSpreadsheet,
  Package,
  Plus,
  Printer,
  Receipt,
  ShoppingCart,
  Trash2,
  Truck,
  Wheat,
  X,
} from 'lucide-react';
import {
  DEFAULT_BAG_WEIGHT_KG,
  convertFeedToGrams,
  formatDateInTimezone,
  formatGramsToKgAndBags,
  formatIsoDateDisplay,
  formatNgn,
  hasPermission,
} from '../domain/calculations.ts';
import { formatUserFriendlyError } from '../lib/firebase.ts';
import { voidPurchaseInvoice } from '../services/accountsService.ts';
import { deleteRecordDraft, saveRecordDraft } from '../services/draftsService.ts';
import { createFeedPurchase, voidFeedPurchase } from '../services/feedService.ts';
import {
  PURCHASE_CATEGORIES,
  PURCHASE_CATEGORY_LABEL,
  createFarmPurchase,
  updateFarmPurchase,
  voidFarmPurchase,
} from '../services/purchasesService.ts';
import type { PurchaseInvoice, Vendor } from '../types/accounts.ts';
import type {
  Farm,
  FarmMember,
  FarmPurchase,
  FeedItem,
  FeedPurchase,
  FeedStock,
  FeedUnit,
  PoultryBatch,
  PurchaseCategory,
  PurchaseDraftPayload,
  RecordDraft,
} from '../types/farm.ts';
import { ConfirmVoidModal } from './ConfirmVoidModal.tsx';
import { InvoicePrintDocument } from './InvoicePrintDocument.tsx';
import { PurchaseInvoiceCreator } from './PurchaseInvoiceCreator.tsx';

interface PurchasesViewProps {
  farm: Farm;
  member: FarmMember;
  batches: PoultryBatch[];
  feedItems: FeedItem[];
  feedStocks: FeedStock[];
  feedPurchases: FeedPurchase[];
  farmPurchases: FarmPurchase[];
  drafts: RecordDraft[];
  vendors: Vendor[];
  purchaseInvoices: PurchaseInvoice[];
}

export const PurchasesView: React.FC<PurchasesViewProps> = ({
  farm,
  member,
  batches,
  feedItems,
  feedStocks,
  feedPurchases,
  farmPurchases,
  drafts,
  vendors,
  purchaseInvoices,
}) => {
  const todayStr = formatDateInTimezone(new Date(), farm.timezone);
  const canCreate = hasPermission(member, 'feed', 'create');
  const canEdit = hasPermission(member, 'feed', 'edit');
  const canDelete = hasPermission(member, 'feed', 'delete');

  const activeFeedItems = useMemo(() => feedItems.filter((i) => i.status === 'active'), [feedItems]);
  const activeVendors = useMemo(() => vendors.filter((v) => v.status === 'active'), [vendors]);
  const itemById = useMemo(() => new Map(feedItems.map((i) => [i.id, i])), [feedItems]);
  const stockByItemId = useMemo(() => new Map(feedStocks.map((s) => [s.feedItemId, s])), [feedStocks]);
  const batchById = useMemo(() => new Map(batches.map((b) => [b.id, b])), [batches]);

  const purchaseDrafts = useMemo(
    () => drafts.filter((d) => d.draftType === 'purchase'),
    [drafts]
  );

  // View Mode: 'list' | 'create' | 'print'
  const [viewMode, setViewMode] = useState<'list' | 'create' | 'print'>('list');
  const [activePrintInvoice, setActivePrintInvoice] = useState<PurchaseInvoice | null>(null);

  // Sub-tabs: 'bills' | 'general' | 'feed'
  const [ledgerTab, setLedgerTab] = useState<'bills' | 'general' | 'feed'>('bills');
  const [startDate, setStartDate] = useState(`${todayStr.slice(0, 7)}-01`);
  const [endDate, setEndDate] = useState(todayStr);
  const [categoryFilter, setCategoryFilter] = useState<'all' | PurchaseCategory>('all');
  const [showVoided, setShowVoided] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Quick Single Purchase Modal ('feed' | 'general')
  const [modalOpen, setModalOpen] = useState(false);
  const [purchaseKind, setPurchaseKind] = useState<'general' | 'feed'>('general');
  const [editingGeneral, setEditingGeneral] = useState<FarmPurchase | null>(null);
  const [loadedDraftId, setLoadedDraftId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Shared single purchase fields
  const [txDate, setTxDate] = useState(todayStr);
  const [supplier, setSupplier] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [reference, setReference] = useState('');
  const [remarks, setRemarks] = useState('');

  // Feed single purchase fields
  const [feedItemId, setFeedItemId] = useState('');
  const [feedQty, setFeedQty] = useState('');
  const [feedUnit, setFeedUnit] = useState<FeedUnit>('bags');
  const [feedBagWeight, setFeedBagWeight] = useState(String(DEFAULT_BAG_WEIGHT_KG));
  const [feedUnitPrice, setFeedUnitPrice] = useState('');

  // General / Medication single purchase fields
  const [category, setCategory] = useState<PurchaseCategory>('medication');
  const [itemName, setItemName] = useState('');
  const [genQty, setGenQty] = useState('1');
  const [genUnit, setGenUnit] = useState('bottle');
  const [genUnitPrice, setGenUnitPrice] = useState('');
  const [batchId, setBatchId] = useState('');

  // Void targets
  const [voidFeedTarget, setVoidFeedTarget] = useState<FeedPurchase | null>(null);
  const [voidGenTarget, setVoidGenTarget] = useState<FarmPurchase | null>(null);
  const [voidInvoiceTarget, setVoidInvoiceTarget] = useState<PurchaseInvoice | null>(null);

  const openModal = (opts: {
    kind: 'general' | 'feed';
    editPurchase?: FarmPurchase;
    draft?: RecordDraft;
  }) => {
    setFormError(null);
    if (opts.draft) {
      const p = opts.draft.payload as Partial<PurchaseDraftPayload>;
      setLoadedDraftId(opts.draft.id);
      setEditingGeneral(null);
      setPurchaseKind(p.kind || 'general');
      setTxDate(p.transactionDate || opts.draft.transactionDate || todayStr);
      setFeedItemId(p.feedItemId || activeFeedItems[0]?.id || '');
      setFeedQty(p.feedQty ?? '');
      setFeedUnit(p.feedUnit || 'bags');
      setFeedBagWeight(p.feedBagWeight || String(DEFAULT_BAG_WEIGHT_KG));
      setFeedUnitPrice(p.feedUnitPrice ?? '');
      setCategory(p.category || 'medication');
      setItemName(p.itemName ?? '');
      setGenQty(p.quantity ?? '1');
      setGenUnit(p.unit ?? 'bottle');
      setGenUnitPrice(p.unitPriceNgn ?? '');
      setBatchId(p.batchId || opts.draft.batchId || '');
      const initSup = p.supplier ?? '';
      setSupplier(initSup);
      const matchedV = vendors.find((v) => v.name.toLowerCase() === initSup.toLowerCase());
      setSelectedVendorId(matchedV ? matchedV.id : '');
      setReference(p.reference ?? '');
      setRemarks(p.remarks ?? '');
      setModalOpen(true);
      return;
    }

    if (opts.editPurchase) {
      const ep = opts.editPurchase;
      setLoadedDraftId(null);
      setEditingGeneral(ep);
      setPurchaseKind('general');
      setTxDate(ep.transactionDate);
      setCategory(ep.category);
      setItemName(ep.itemName);
      setGenQty(String(ep.quantity));
      setGenUnit(ep.unit);
      setGenUnitPrice(String(ep.unitPriceNgn));
      setBatchId(ep.batchId || '');
      const editSup = ep.supplier || '';
      setSupplier(editSup);
      const matchedEditV = vendors.find((v) => v.name.toLowerCase() === editSup.toLowerCase());
      setSelectedVendorId(matchedEditV ? matchedEditV.id : '');
      setReference(ep.reference);
      setRemarks(ep.remarks);
      setModalOpen(true);
      return;
    }

    const firstFeed = activeFeedItems[0];
    setLoadedDraftId(null);
    setEditingGeneral(null);
    setPurchaseKind(opts.kind);
    setTxDate(todayStr);
    setFeedItemId(firstFeed?.id || '');
    setFeedQty('');
    setFeedUnit('bags');
    setFeedBagWeight(String(firstFeed?.defaultBagWeightKg ?? DEFAULT_BAG_WEIGHT_KG));
    setFeedUnitPrice('');
    setCategory('medication');
    setItemName('');
    setGenQty('1');
    setGenUnit('bottle');
    setGenUnitPrice('');
    setBatchId('');
    setSupplier('');
    setSelectedVendorId('');
    setReference('');
    setRemarks('');
    setModalOpen(true);
  };

  const feedPreview = useMemo(() => {
    const qty = Number(feedQty);
    const bagW = Number(feedBagWeight);
    const unitPrice = Number(feedUnitPrice);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(bagW) || bagW <= 0) return null;
    try {
      const grams = convertFeedToGrams(qty, feedUnit, bagW);
      const totalNgn = Number.isFinite(unitPrice) && unitPrice >= 0 ? qty * unitPrice : 0;
      const costPerKg = grams > 0 ? (totalNgn / grams) * 1000 : 0;
      return { grams, kg: grams / 1000, totalNgn, costPerKg };
    } catch {
      return null;
    }
  }, [feedQty, feedUnit, feedBagWeight, feedUnitPrice]);

  const generalTotalPreview = useMemo(() => {
    const qty = Number(genQty);
    const price = Number(genUnitPrice);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0) return 0;
    return Math.round(qty * price * 100) / 100;
  }, [genQty, genUnitPrice]);

  const handleSaveDraft = async () => {
    setFormError(null);
    setSavingDraft(true);
    try {
      const feedItem = itemById.get(feedItemId);
      const title =
        purchaseKind === 'feed'
          ? `Feed Stock-In: ${feedItem?.feedType || 'Feed'} · ${formatIsoDateDisplay(txDate)}`
          : `${PURCHASE_CATEGORY_LABEL[category]}: ${itemName.trim() || 'Draft Purchase'} · ${formatIsoDateDisplay(txDate)}`;

      const payload: PurchaseDraftPayload = {
        kind: purchaseKind,
        transactionDate: txDate,
        feedItemId,
        feedQty,
        feedUnit,
        feedBagWeight,
        feedUnitPrice,
        category,
        itemName,
        quantity: genQty,
        unit: genUnit,
        unitPriceNgn: genUnitPrice,
        batchId,
        supplier,
        reference,
        remarks,
      };

      const savedId = await saveRecordDraft({
        farmId: farm.farmId,
        existingDraftId: loadedDraftId,
        draftType: 'purchase',
        title,
        transactionDate: txDate,
        batchId,
        payload: payload as unknown as Record<string, unknown>,
        actorUid: member.uid,
        actorName: member.displayName,
      });
      setLoadedDraftId(savedId);
      setModalOpen(false);
      setFeedback({ type: 'success', text: `Saved purchase draft "${title}".` });
    } catch (err) {
      setFormError(formatUserFriendlyError(err));
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      if (purchaseKind === 'feed') {
        const item = itemById.get(feedItemId);
        if (!item) throw new Error('Please select a feed type & brand.');
        await createFeedPurchase({
          farmId: farm.farmId,
          transactionDate: txDate,
          feedItem: item,
          enteredQuantity: Number(feedQty),
          enteredUnit: feedUnit,
          bagWeightKg: Number(feedBagWeight),
          unitPurchasePriceNgn: Number(feedUnitPrice),
          supplier,
          reference,
          remarks,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({
          type: 'success',
          text: `Feed purchase recorded for ${item.feedType} (${item.brand}) and added to stock.`,
        });
      } else if (editingGeneral) {
        await updateFarmPurchase({
          farmId: farm.farmId,
          purchase: editingGeneral,
          transactionDate: txDate,
          category,
          itemName,
          quantity: Number(genQty),
          unit: genUnit,
          unitPriceNgn: Number(genUnitPrice),
          supplier,
          reference,
          batch: batchId ? batchById.get(batchId) || null : null,
          remarks,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({ type: 'success', text: `Updated purchase "${itemName.trim()}".` });
      } else {
        await createFarmPurchase({
          farmId: farm.farmId,
          transactionDate: txDate,
          category,
          itemName,
          quantity: Number(genQty),
          unit: genUnit,
          unitPriceNgn: Number(genUnitPrice),
          supplier,
          reference,
          batch: batchId ? batchById.get(batchId) || null : null,
          remarks,
          actorUid: member.uid,
          actorName: member.displayName,
        });
        setFeedback({
          type: 'success',
          text: `Recorded ${PURCHASE_CATEGORY_LABEL[category]} purchase (${formatNgn(generalTotalPreview)}).`,
        });
      }

      if (loadedDraftId) {
        await deleteRecordDraft({ farmId: farm.farmId, draftId: loadedDraftId });
        setLoadedDraftId(null);
      }
      setModalOpen(false);
    } catch (err) {
      setFormError(formatUserFriendlyError(err));
    } finally {
      setSubmitting(false);
    }
  };

  // Filtered Purchase Invoices (Multi-item Bills)
  const filteredInvoices = useMemo(() => {
    return purchaseInvoices.filter((inv) => {
      if (!showVoided && inv.isVoided) return false;
      if (startDate && inv.transactionDate < startDate) return false;
      if (endDate && inv.transactionDate > endDate) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = (inv.vendorNameSnapshot || '').toLowerCase().includes(q);
        const matchesNum = (inv.invoiceNumber || '').toLowerCase().includes(q);
        const matchesRef = (inv.reference || '').toLowerCase().includes(q);
        if (!matchesName && !matchesNum && !matchesRef) return false;
      }
      return true;
    });
  }, [purchaseInvoices, showVoided, startDate, endDate, searchQuery]);

  // Filtered Feed Purchases
  const filteredFeedPurchases = useMemo(
    () =>
      feedPurchases.filter(
        (p) =>
          (showVoided || !p.isVoided) &&
          (!startDate || p.transactionDate >= startDate) &&
          (!endDate || p.transactionDate <= endDate) &&
          (!searchQuery.trim() ||
            (p.feedTypeSnapshot || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
            (p.supplier || '').toLowerCase().includes(searchQuery.toLowerCase()))
      ),
    [feedPurchases, showVoided, startDate, endDate, searchQuery]
  );

  // Filtered General Farm Purchases
  const filteredFarmPurchases = useMemo(
    () =>
      farmPurchases.filter(
        (p) =>
          (showVoided || !p.isVoided) &&
          (!startDate || p.transactionDate >= startDate) &&
          (!endDate || p.transactionDate <= endDate) &&
          (categoryFilter === 'all' || p.category === categoryFilter) &&
          (!searchQuery.trim() ||
            (p.itemName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
            (p.supplier || '').toLowerCase().includes(searchQuery.toLowerCase()))
      ),
    [farmPurchases, showVoided, startDate, endDate, categoryFilter, searchQuery]
  );

  const spendSummary = useMemo(() => {
    const feedTotal = filteredFeedPurchases
      .filter((p) => !p.isVoided)
      .reduce((s, p) => s + p.totalCostNgn, 0);
    const medTotal = filteredFarmPurchases
      .filter((p) => !p.isVoided && (p.category === 'medication' || p.category === 'vaccines_vet' || p.category === 'supplements'))
      .reduce((s, p) => s + p.totalCostNgn, 0);
    const otherTotal = filteredFarmPurchases
      .filter((p) => !p.isVoided && p.category !== 'medication' && p.category !== 'vaccines_vet' && p.category !== 'supplements')
      .reduce((s, p) => s + p.totalCostNgn, 0);
    return {
      feedTotal,
      medTotal,
      otherTotal,
      combinedTotal: feedTotal + medTotal + otherTotal,
    };
  }, [filteredFeedPurchases, filteredFarmPurchases]);

  // If in Create Mode, render the full-page purchase bill creator
  if (viewMode === 'create') {
    return (
      <PurchaseInvoiceCreator
        farm={farm}
        member={member}
        vendors={vendors}
        feedItems={feedItems}
        batches={batches}
        onCancel={() => setViewMode('list')}
        onInvoiceCreated={(invoice, printImmediately) => {
          setFeedback({
            type: 'success',
            text: `Purchase bill ${invoice.invoiceNumber} (${formatNgn(invoice.totalAmountNgn)}) recorded successfully.`,
          });
          if (printImmediately) {
            setActivePrintInvoice(invoice);
            setViewMode('print');
          } else {
            setViewMode('list');
          }
        }}
      />
    );
  }

  // If in Print Mode, render the invoice print document
  if (viewMode === 'print' && activePrintInvoice) {
    return (
      <InvoicePrintDocument
        farm={farm}
        docType="purchase"
        purchaseInvoice={activePrintInvoice}
        onClose={() => {
          setActivePrintInvoice(null);
          setViewMode('list');
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Purchases &amp; Feed Inventory
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Manage multi-item purchase bills, feed stock-in, medications, equipment, vendor balances, and printable vouchers.
          </p>
        </div>

        {canCreate && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode('create')}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900 shadow-xs whitespace-nowrap cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Create Purchase Bill</span>
            </button>
            <button
              type="button"
              onClick={() => openModal({ kind: 'feed' })}
              disabled={activeFeedItems.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              <Wheat className="h-3.5 w-3.5 text-emerald-800" />
              <span>Quick Feed</span>
            </button>
            <button
              type="button"
              onClick={() => openModal({ kind: 'general' })}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              <Package className="h-3.5 w-3.5" />
              <span>Quick Expense</span>
            </button>
          </div>
        )}
      </div>

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border px-4 py-3 text-sm ${
            feedback.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Saved Purchase Drafts */}
      {purchaseDrafts.length > 0 && canCreate && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Bookmark className="h-4 w-4 text-amber-800" />
              <h2 className="text-sm font-semibold text-amber-950">
                Saved Purchase Drafts ({purchaseDrafts.length})
              </h2>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {purchaseDrafts.map((draft) => (
              <div
                key={draft.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2.5 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 truncate">{draft.title}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Saved by {draft.createdByName}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => openModal({ kind: 'general', draft })}
                    className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-900 hover:bg-emerald-100 cursor-pointer"
                  >
                    <FileEdit className="h-3 w-3" />
                    <span>Resume</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await deleteRecordDraft({ farmId: farm.farmId, draftId: draft.id });
                      setFeedback({ type: 'success', text: 'Purchase draft discarded.' });
                    }}
                    className="rounded border border-slate-200 p-1 text-slate-500 hover:bg-red-50 hover:text-red-700 cursor-pointer"
                    title="Discard draft"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Spend Summary Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 tabular-nums">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs text-slate-500">Feed Purchases</p>
          <p className="mt-1 font-mono text-xl font-bold text-slate-900">
            {formatNgn(spendSummary.feedTotal)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs text-slate-500">Meds, Vaccines &amp; Vet</p>
          <p className="mt-1 font-mono text-xl font-bold text-slate-900">
            {formatNgn(spendSummary.medTotal)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs text-slate-500">Other Farm Expenses</p>
          <p className="mt-1 font-mono text-xl font-bold text-slate-900">
            {formatNgn(spendSummary.otherTotal)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs text-slate-500">Combined Period Spend</p>
          <p className="mt-1 font-mono text-xl font-bold text-emerald-800">
            {formatNgn(spendSummary.combinedTotal)}
          </p>
        </div>
      </div>

      {/* Live Feed Stock Balances */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Wheat className="h-4 w-4 text-emerald-800" />
            <h2 className="text-sm font-semibold text-slate-900">Live Feed Store Balance</h2>
          </div>
          <span className="text-xs text-slate-500">Updated automatically from Feed Purchases &amp; Daily Consumption</span>
        </div>
        {feedItems.length === 0 ? (
          <p className="py-4 text-xs text-slate-500">
            No feed items configured yet. Add feed items in Farm Setup to track store balances.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {feedItems.map((item) => {
              const stock = stockByItemId.get(item.id);
              const balGrams = stock?.balanceGrams ?? 0;
              const formatted = formatGramsToKgAndBags(balGrams, item.defaultBagWeightKg);
              const latestKgCost = stock ? stock.lastUnitCostPerGramNgn * 1000 : 0;
              return (
                <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{item.feedType}</p>
                      <p className="text-xs text-slate-500">
                        {item.brand} · {item.defaultBagWeightKg} kg/bag
                      </p>
                    </div>
                    <span className="text-[11px] font-medium text-slate-500 capitalize">
                      {item.status}
                    </span>
                  </div>
                  <p
                    className={`mt-2.5 font-mono text-lg font-bold tabular-nums ${
                      balGrams <= 0 ? 'text-amber-700' : 'text-emerald-800'
                    }`}
                  >
                    {formatted.kgText}
                  </p>
                  <p className="text-xs font-mono text-slate-600 tabular-nums">
                    {formatted.bagsText}
                    {latestKgCost > 0 && ` · Last ${formatNgn(latestKgCost)}/kg`}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Filters & Sub-tabs */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setLedgerTab('bills')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                ledgerTab === 'bills'
                  ? 'bg-emerald-800 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Receipt className="h-3.5 w-3.5" />
              <span>Purchase Bills ({filteredInvoices.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setLedgerTab('general')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                ledgerTab === 'general'
                  ? 'bg-emerald-800 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Package className="h-3.5 w-3.5" />
              <span>Medication &amp; Farm Ledger ({filteredFarmPurchases.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setLedgerTab('feed')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                ledgerTab === 'feed'
                  ? 'bg-emerald-800 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <ShoppingCart className="h-3.5 w-3.5" />
              <span>Feed Stock-In Ledger ({filteredFeedPurchases.length})</span>
            </button>
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={showVoided}
              onChange={(e) => setShowVoided(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-emerald-800"
            />
            <span>Include voided purchases</span>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4">
          <div>
            <label htmlFor="pur-start" className="block text-xs font-medium text-slate-600">
              From Date
            </label>
            <input
              id="pur-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono"
            />
          </div>
          <div>
            <label htmlFor="pur-end" className="block text-xs font-medium text-slate-600">
              To Date
            </label>
            <input
              id="pur-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-mono"
            />
          </div>
          <div>
            <label htmlFor="pur-search" className="block text-xs font-medium text-slate-600">
              Search Vendor / Ref #
            </label>
            <input
              id="pur-search"
              type="text"
              placeholder="Search vendor or BILL-..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
            />
          </div>
          {ledgerTab === 'general' && (
            <div>
              <label htmlFor="pur-cat" className="block text-xs font-medium text-slate-600">
                Category
              </label>
              <select
                id="pur-cat"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as 'all' | PurchaseCategory)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
              >
                <option value="all">All Categories</option>
                {PURCHASE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Ledger Tables */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        {ledgerTab === 'bills' ? (
          /* Purchase Bills Table */
          filteredInvoices.length === 0 ? (
            <div className="p-8 text-center">
              <Receipt className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-800">No purchase bills found.</p>
              <p className="mt-1 text-xs text-slate-500">
                Click "Create Purchase Bill" above to record a multi-product bill and generate vouchers.
              </p>
            </div>
          ) : (
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-bold uppercase text-[11px]">
                    <th className="px-4 py-3">Bill # / Date</th>
                    <th className="px-4 py-3">Vendor / Supplier</th>
                    <th className="px-4 py-3">Items Purchased</th>
                    <th className="px-4 py-3 text-right">Total Amount</th>
                    <th className="px-4 py-3 text-right">Amount Paid</th>
                    <th className="px-4 py-3 text-right">Balance Due</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {filteredInvoices.map((inv) => {
                    const isOneOff = inv.vendorId === 'one-off';
                    const itemsSummary = inv.lines
                      .map((l) => `${l.quantity} ${l.unit} ${l.itemNameSnapshot}`)
                      .join(', ');

                    return (
                      <tr
                        key={inv.id}
                        className={inv.isVoided ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50/60'}
                      >
                        <td className="px-4 py-3 font-mono">
                          <div className={inv.isVoided ? 'line-through' : 'font-bold text-slate-900'}>
                            {inv.invoiceNumber}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {formatIsoDateDisplay(inv.transactionDate)} {inv.reference ? `· Ref: ${inv.reference}` : ''}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                            <span>{inv.vendorNameSnapshot}</span>
                            {isOneOff && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                                One-off
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 max-w-xs truncate text-slate-600" title={itemsSummary}>
                          {itemsSummary}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                          {formatNgn(inv.totalAmountNgn)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-800 font-semibold">
                          {formatNgn(inv.paidAmountNgn)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono font-bold ${
                            inv.balanceNgn > 0 ? 'text-red-700' : 'text-slate-500'
                          }`}
                        >
                          {formatNgn(inv.balanceNgn)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                              inv.paymentStatus === 'paid'
                                ? 'bg-emerald-100 text-emerald-800'
                                : inv.paymentStatus === 'partial'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {inv.paymentStatus}
                          </span>
                          {inv.isVoided && (
                            <div className="text-[10px] font-bold text-red-600 mt-0.5">VOIDED</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setActivePrintInvoice(inv);
                                setViewMode('print');
                              }}
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50 text-[11px] font-semibold cursor-pointer"
                              title="Print Bill / Payment Voucher"
                            >
                              <Printer className="h-3 w-3" />
                              <span>Voucher</span>
                            </button>
                            {!inv.isVoided && canDelete && (
                              <button
                                type="button"
                                onClick={() => setVoidInvoiceTarget(inv)}
                                className="rounded border border-red-200 p-1 text-red-700 hover:bg-red-50 cursor-pointer"
                                title="Void bill"
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : ledgerTab === 'general' ? (
          /* General Purchases Table */
          filteredFarmPurchases.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-slate-800">
                No medication or farm purchases match this filter.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Record vaccines, antibiotics, chicks, bedding, packaging, fuel, or repairs for full P&amp;L visibility.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-bold uppercase text-[11px]">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Category &amp; Item</th>
                    <th className="px-4 py-3 text-right">Qty / Unit</th>
                    <th className="px-4 py-3 text-right">Unit Price</th>
                    <th className="px-4 py-3 text-right">Total Cost</th>
                    <th className="px-4 py-3">Batch / Supplier</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {filteredFarmPurchases.map((p) => (
                    <tr key={p.id} className={p.isVoided ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50'}>
                      <td className="px-4 py-3 font-mono whitespace-nowrap">
                        <span className={p.isVoided ? 'line-through' : 'font-medium text-slate-900'}>
                          {formatIsoDateDisplay(p.transactionDate)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{p.itemName}</div>
                        <div className="text-slate-500">{PURCHASE_CATEGORY_LABEL[p.category]}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {p.quantity} {p.unit}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{formatNgn(p.unitPriceNgn)}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                        {formatNgn(p.totalCostNgn)}
                      </td>
                      <td className="px-4 py-3">
                        <div>{p.batchCodeSnapshot ? `Batch: ${p.batchCodeSnapshot}` : 'Farm-wide'}</div>
                        <div className="text-[11px] text-slate-500">
                          {p.supplier || '—'} {p.reference ? `· ${p.reference}` : ''}
                        </div>
                        {p.isVoided && (
                          <div className="text-[11px] font-medium text-red-700">
                            VOIDED: {p.voidReason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!p.isVoided && (
                          <div className="inline-flex items-center gap-2">
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => openModal({ kind: 'general', editPurchase: p })}
                                className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-100 cursor-pointer"
                                title="Edit purchase"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => setVoidGenTarget(p)}
                                className="rounded border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50 cursor-pointer"
                                title="Void purchase"
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : filteredFeedPurchases.length === 0 ? (
          /* Feed Purchases Table */
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-slate-800">No feed purchases in this filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-bold uppercase text-[11px]">
                  <th className="px-4 py-3">Purchase Date</th>
                  <th className="px-4 py-3">Feed / Brand</th>
                  <th className="px-4 py-3 text-right">Entered</th>
                  <th className="px-4 py-3 text-right">Std. (kg)</th>
                  <th className="px-4 py-3 text-right">Unit Price</th>
                  <th className="px-4 py-3 text-right">Total Cost</th>
                  <th className="px-4 py-3">Supplier / Ref</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {filteredFeedPurchases.map((p) => (
                  <tr key={p.id} className={p.isVoided ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50'}>
                    <td className="px-4 py-3 font-mono whitespace-nowrap">
                      <span className={p.isVoided ? 'line-through' : 'font-medium text-slate-900'}>
                        {formatIsoDateDisplay(p.transactionDate)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{p.feedTypeSnapshot}</div>
                      <div className="text-slate-500">{p.brandSnapshot}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {p.enteredQuantity} {p.enteredUnit}
                      <div className="text-[11px] text-slate-500">({p.bagWeightKgSnapshot} kg/bag)</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-900">
                      {(p.standardizedGrams / 1000).toFixed(2)} kg
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {formatNgn(p.unitPurchasePriceNgn)}/{p.enteredUnit === 'bags' ? 'bag' : 'kg'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                      {formatNgn(p.totalCostNgn)}
                    </td>
                    <td className="px-4 py-3">
                      <div>{p.supplier || '—'}</div>
                      <div className="text-[11px] text-slate-500">{p.reference || '—'}</div>
                      {p.isVoided && (
                        <div className="text-[11px] font-medium text-red-700">
                          VOIDED: {p.voidReason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!p.isVoided && canDelete && (
                        <button
                          type="button"
                          onClick={() => setVoidFeedTarget(p)}
                          className="rounded border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50 cursor-pointer"
                          title="Void purchase"
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Single Purchase Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[92vh] sm:max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl sm:rounded-xl border border-slate-200 bg-white p-4 sm:p-6 shadow-2xl pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:pb-6">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-lg font-bold text-slate-900">
                {editingGeneral
                  ? `Edit Purchase: ${editingGeneral.itemName}`
                  : purchaseKind === 'feed'
                  ? 'Record Feed Purchase (Stock-In)'
                  : 'Record Medication / Farm Purchase'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {!editingGeneral && (
              <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setPurchaseKind('general')}
                  className={`rounded-md py-1.5 text-xs font-medium cursor-pointer ${
                    purchaseKind === 'general'
                      ? 'bg-emerald-800 text-white'
                      : 'text-slate-700 hover:bg-white'
                  }`}
                >
                  Medication &amp; Other Expenses
                </button>
                <button
                  type="button"
                  onClick={() => setPurchaseKind('feed')}
                  disabled={activeFeedItems.length === 0}
                  className={`rounded-md py-1.5 text-xs font-medium disabled:opacity-50 cursor-pointer ${
                    purchaseKind === 'feed'
                      ? 'bg-emerald-800 text-white'
                      : 'text-slate-700 hover:bg-white'
                  }`}
                >
                  Feed (Stock-In)
                </button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              {formError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Purchase Date <span className="text-red-600">*</span>
                </label>
                <div className="relative mt-1">
                  <input
                    type="date"
                    required
                    value={txDate}
                    onChange={(e) => setTxDate(e.target.value)}
                    className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                  />
                  <div className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-900">
                    <span>{txDate ? formatIsoDateDisplay(txDate) : 'Select date'}</span>
                    <Calendar className="h-4 w-4 text-slate-400" />
                  </div>
                </div>
              </div>

              {purchaseKind === 'feed' ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Feed Type &amp; Brand <span className="text-red-600">*</span>
                    </label>
                    <select
                      required
                      value={feedItemId}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        setFeedItemId(nextId);
                        const found = itemById.get(nextId);
                        if (found) setFeedBagWeight(String(found.defaultBagWeightKg));
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="">Select feed...</option>
                      {activeFeedItems.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.feedType} — {i.brand}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700">Quantity</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={feedQty}
                        onChange={(e) => setFeedQty(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700">Unit</label>
                      <select
                        value={feedUnit}
                        onChange={(e) => setFeedUnit(e.target.value as FeedUnit)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      >
                        <option value="bags">Bags</option>
                        <option value="kg">Kilograms (kg)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700">Bag Wt (kg)</label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        required
                        value={feedBagWeight}
                        onChange={(e) => setFeedBagWeight(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Price per {feedUnit === 'bags' ? 'Bag' : 'kg'} (NGN) <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={feedUnitPrice}
                      onChange={(e) => setFeedUnitPrice(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                    />
                  </div>

                  {feedPreview && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs tabular-nums">
                      <div className="flex justify-between">
                        <span>Standardized Weight:</span>
                        <strong className="font-mono">{feedPreview.kg.toLocaleString()} kg</strong>
                      </div>
                      <div className="mt-1 flex justify-between">
                        <span>Total Cost:</span>
                        <strong className="font-mono text-emerald-800">
                          {formatNgn(feedPreview.totalNgn)} ({formatNgn(feedPreview.costPerKg)}/kg)
                        </strong>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-700">
                        Category <span className="text-red-600">*</span>
                      </label>
                      <select
                        required
                        value={category}
                        onChange={(e) => setCategory(e.target.value as PurchaseCategory)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      >
                        {PURCHASE_CATEGORIES.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700">
                        Item / Service Name <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={120}
                        value={itemName}
                        onChange={(e) => setItemName(e.target.value)}
                        placeholder="e.g. Oxytetracycline 100ml, Wood Shavings"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700">Quantity</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={genQty}
                        onChange={(e) => setGenQty(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700">Unit</label>
                      <input
                        type="text"
                        required
                        maxLength={40}
                        value={genUnit}
                        onChange={(e) => setGenUnit(e.target.value)}
                        placeholder="bottle, vial, bag..."
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700">Unit Price (NGN)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        value={genUnitPrice}
                        onChange={(e) => setGenUnitPrice(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      Assign to Flock Batch (Optional)
                    </label>
                    <select
                      value={batchId}
                      onChange={(e) => setBatchId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="">Farm-wide / Shared Expense</option>
                      {batches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.batchCode} — {b.penNameSnapshot} ({b.status})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs tabular-nums">
                    <span>Total Purchase Cost</span>
                    <strong className="font-mono text-base text-emerald-800">
                      {formatNgn(generalTotalPreview)}
                    </strong>
                  </div>
                </>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700">Vendor / Supplier</label>
                  <select
                    value={selectedVendorId}
                    onChange={(e) => {
                      const vid = e.target.value;
                      setSelectedVendorId(vid);
                      if (vid) {
                        const foundV = vendors.find((v) => v.id === vid);
                        if (foundV) setSupplier(foundV.name);
                      } else {
                        setSupplier('');
                      }
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">One-off / Walk-in Supplier</option>
                    {activeVendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} {v.phone ? `(${v.phone})` : ''}
                      </option>
                    ))}
                  </select>
                  {!selectedVendorId && (
                    <input
                      type="text"
                      maxLength={120}
                      value={supplier}
                      onChange={(e) => setSupplier(e.target.value)}
                      placeholder="Supplier Name (optional)"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Invoice / Ref (Opt.)</label>
                  <input
                    type="text"
                    maxLength={80}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Remarks</label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
                {!editingGeneral ? (
                  <button
                    type="button"
                    onClick={handleSaveDraft}
                    disabled={savingDraft || submitting}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60 cursor-pointer"
                  >
                    <Bookmark className="h-4 w-4" />
                    <span>{savingDraft ? 'Saving...' : 'Save as Draft'}</span>
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || savingDraft}
                    className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900 disabled:opacity-60 cursor-pointer"
                  >
                    {submitting ? 'Saving...' : editingGeneral ? 'Save Changes' : 'Save Purchase'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Void Single Feed Purchase Modal */}
      <ConfirmVoidModal
        open={Boolean(voidFeedTarget)}
        title="Void Feed Purchase?"
        description={`Voiding this feed purchase (${voidFeedTarget?.feedTypeSnapshot || ''}) will deduct ${(voidFeedTarget ? voidFeedTarget.standardizedGrams / 1000 : 0).toFixed(2)} kg from feed stock if unconsumed.`}
        confirmLabel="Void Feed Purchase"
        onConfirm={async (reason) => {
          if (!voidFeedTarget) return;
          await voidFeedPurchase({
            farmId: farm.farmId,
            purchase: voidFeedTarget,
            voidReason: reason,
            actorUid: member.uid,
            actorName: member.displayName,
          });
          setFeedback({ type: 'success', text: 'Feed purchase voided and stock adjusted.' });
        }}
        onClose={() => setVoidFeedTarget(null)}
      />

      {/* Confirm Void Single General Purchase Modal */}
      <ConfirmVoidModal
        open={Boolean(voidGenTarget)}
        title="Void Farm Purchase?"
        description={`Voiding this purchase (${voidGenTarget?.itemName || ''}, ${formatNgn(voidGenTarget?.totalCostNgn || 0)}) will exclude it from expense and P&L calculations while keeping full audit history.`}
        confirmLabel="Void Purchase"
        onConfirm={async (reason) => {
          if (!voidGenTarget) return;
          await voidFarmPurchase({
            farmId: farm.farmId,
            purchase: voidGenTarget,
            voidReason: reason,
            actorUid: member.uid,
            actorName: member.displayName,
          });
          setFeedback({ type: 'success', text: 'Farm purchase voided.' });
        }}
        onClose={() => setVoidGenTarget(null)}
      />

      {/* Confirm Void Purchase Bill Modal */}
      <ConfirmVoidModal
        open={Boolean(voidInvoiceTarget)}
        title={`Void Purchase Bill ${voidInvoiceTarget?.invoiceNumber || ''}?`}
        description={`Voiding this purchase bill (${formatNgn(voidInvoiceTarget?.totalAmountNgn || 0)}) will mark the bill voided, reverse any accounts payable credited to the vendor, and void all ${voidInvoiceTarget?.lines.length || 0} associated line records.`}
        confirmLabel="Void Bill"
        onConfirm={async (reason) => {
          if (!voidInvoiceTarget) return;
          await voidPurchaseInvoice({
            farmId: farm.farmId,
            invoice: voidInvoiceTarget,
            voidReason: reason,
            actor: member,
          });
          setFeedback({ type: 'success', text: `Purchase bill ${voidInvoiceTarget.invoiceNumber} voided.` });
        }}
        onClose={() => setVoidInvoiceTarget(null)}
      />
    </div>
  );
};
