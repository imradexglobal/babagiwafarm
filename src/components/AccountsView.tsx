import React, { useMemo, useState } from 'react';
import { Printer, UserPlus } from 'lucide-react';
import { formatDateInTimezone, formatIsoDateDisplay, formatNgn, hasPermission } from '../domain/calculations.ts';
import { formatUserFriendlyError } from '../lib/firebase.ts';
import { postAccountPayment, saveParty, setPartyStatus } from '../services/accountsService.ts';
import type { AccountPayment, AccountPaymentMethod, Customer, PurchaseInvoice, SalesInvoice, Vendor } from '../types/accounts.ts';
import type { Farm, FarmMember } from '../types/farm.ts';

type PartyKind = 'customer' | 'vendor';
const methods: AccountPaymentMethod[] = ['cash', 'bank_transfer', 'pos', 'cheque', 'other'];
const moneyLabel = (amount: number) => formatNgn(Math.abs(amount));

interface Props {
  farm: Farm;
  member: FarmMember;
  customers: Customer[];
  vendors: Vendor[];
  salesInvoices: SalesInvoice[];
  purchaseInvoices: PurchaseInvoice[];
  payments: AccountPayment[];
}

export const AccountsView: React.FC<Props> = ({ farm, member, customers, vendors, salesInvoices, purchaseInvoices, payments }) => {
  const today = formatDateInTimezone(new Date(), farm.timezone);
  const [kind, setKind] = useState<PartyKind>('customer');
  const [activeTab, setActiveTab] = useState<'register' | 'payments' | 'statements'>('register');
  const [selectedId, setSelectedId] = useState('');
  const [editing, setEditing] = useState<Customer | Vendor | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [openingDate, setOpeningDate] = useState(today);
  const [paymentDate, setPaymentDate] = useState(today);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<AccountPaymentMethod>('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentRemarks, setPaymentRemarks] = useState('');
  const [paymentInvoiceId, setPaymentInvoiceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const parties = kind === 'customer' ? customers : vendors;
  const activeParties = parties.filter((p) => p.status === 'active');
  const selected = parties.find((p) => p.id === selectedId) || null;
  const canManage = kind === 'customer'
    ? hasPermission(member, 'sales', 'create') || hasPermission(member, 'sales', 'edit')
    : hasPermission(member, 'feed', 'create') || hasPermission(member, 'feed', 'edit');
  const canPostPayment = kind === 'customer' ? hasPermission(member, 'sales', 'create') : hasPermission(member, 'feed', 'create');
  const invoices = useMemo(() => kind === 'customer'
    ? salesInvoices.filter((i) => !i.isVoided && i.customerId === selectedId && i.balanceNgn > 0)
    : purchaseInvoices.filter((i) => !i.isVoided && i.vendorId === selectedId && i.balanceNgn > 0), [kind, salesInvoices, purchaseInvoices, selectedId]);

  const balanceFor = (party: Customer | Vendor) => {
    const isCustomer = kind === 'customer';
    const invoiceOutstanding = isCustomer
      ? salesInvoices.filter((i) => !i.isVoided && i.customerId === party.id).reduce((s, i) => s + i.balanceNgn, 0)
      : purchaseInvoices.filter((i) => !i.isVoided && i.vendorId === party.id).reduce((s, i) => s + i.balanceNgn, 0);
    const unallocated = payments.filter((p) => !p.isVoided && p.partyId === party.id && p.direction === (isCustomer ? 'customer_receipt' : 'vendor_payment') && !p.invoiceId).reduce((s, p) => s + p.amountNgn, 0);
    return Math.round((party.openingBalanceNgn + invoiceOutstanding - unallocated) * 100) / 100;
  };

  const resetForm = () => {
    setEditing(null); setName(''); setPhone(''); setEmail(''); setAddress(''); setNotes('');
    setOpeningBalance('0'); setOpeningDate(today); setError('');
  };
  const beginEdit = (party: Customer | Vendor) => {
    setEditing(party); setSelectedId(party.id); setName(party.name); setPhone(party.phone); setEmail(party.email);
    setAddress(party.address); setNotes(party.notes); setOpeningBalance(String(party.openingBalanceNgn));
    setOpeningDate(party.openingBalanceDate || today); setError(''); setNotice('');
  };
  const changeKind = (next: PartyKind) => {
    setKind(next); setSelectedId(''); setPaymentInvoiceId(''); resetForm(); setError(''); setNotice('');
  };
  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const id = await saveParty({ farmId: farm.farmId, kind, partyId: editing?.id, name, phone, email, address, notes,
        openingBalanceNgn: Number(openingBalance), openingBalanceDate: openingDate, actorUid: member.uid });
      setSelectedId(id); resetForm(); setNotice(`${kind === 'customer' ? 'Customer' : 'Vendor'} saved.`);
    } catch (e) { setError(formatUserFriendlyError(e)); } finally { setBusy(false); }
  };
  const handlePayment = async (event: React.FormEvent) => {
    event.preventDefault(); if (!selected) { setError('Select an account first.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const invoice = invoices.find((i) => i.id === paymentInvoiceId) || null;
      await postAccountPayment({ farmId: farm.farmId, direction: kind === 'customer' ? 'customer_receipt' : 'vendor_payment',
        party: selected, invoice, transactionDate: paymentDate, amountNgn: Number(paymentAmount), method: paymentMethod,
        reference: paymentReference, remarks: paymentRemarks, actor: member });
      setPaymentAmount(''); setPaymentReference(''); setPaymentRemarks(''); setPaymentInvoiceId('');
      setNotice(kind === 'customer' ? 'Customer receipt recorded.' : 'Vendor payment recorded.');
    } catch (e) { setError(formatUserFriendlyError(e)); } finally { setBusy(false); }
  };
  const toggleStatus = async (party: Customer | Vendor) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await setPartyStatus({ farmId: farm.farmId, kind, party, status: party.status === 'active' ? 'inactive' : 'active', actorUid: member.uid });
      setNotice(`${party.name} marked ${party.status === 'active' ? 'inactive' : 'active'}.`);
    } catch (e) { setError(formatUserFriendlyError(e)); } finally { setBusy(false); }
  };
  const statementRows = useMemo(() => {
    const partyId = selectedId;
    if (!partyId) return [] as { date: string; description: string; debit: number; credit: number; balance: number }[];
    const party = parties.find((p) => p.id === partyId);
    if (!party) return [];
    const rows: { date: string; description: string; debit: number; credit: number; balance: number }[] = [];
    if (party.openingBalanceNgn) rows.push({ date: party.openingBalanceDate, description: 'Opening balance', debit: party.openingBalanceNgn, credit: 0, balance: 0 });
    if (kind === 'customer') {
      salesInvoices.filter((i) => !i.isVoided && i.customerId === partyId).forEach((i) => rows.push({ date: i.transactionDate, description: `Sales invoice ${i.invoiceNumber}`, debit: i.totalAmountNgn, credit: 0, balance: 0 }));
    } else {
      purchaseInvoices.filter((i) => !i.isVoided && i.vendorId === partyId).forEach((i) => rows.push({ date: i.transactionDate, description: `Purchase invoice ${i.invoiceNumber}`, debit: i.totalAmountNgn, credit: 0, balance: 0 }));
    }
    payments.filter((p) => {
      if (p.isVoided) return false;
      if (p.partyId !== partyId) return false;
      if (p.direction !== (kind === 'customer' ? 'customer_receipt' : 'vendor_payment')) return false;
      if (p.invoiceId) {
        const parentInv = (kind === 'customer' ? salesInvoices : purchaseInvoices).find((i) => i.id === p.invoiceId);
        if (parentInv && parentInv.isVoided) return false;
      }
      return true;
    }).forEach((p) => rows.push({ date: p.transactionDate, description: `${kind === 'customer' ? 'Receipt' : 'Payment'}${p.invoiceNumberSnapshot ? ` · ${p.invoiceNumberSnapshot}` : ''} · ${p.method.replace('_', ' ')}`, debit: 0, credit: p.amountNgn, balance: 0 }));
    rows.sort((a, b) => a.date.localeCompare(b.date));
    let running = 0; for (const row of rows) { running += row.debit - row.credit; row.balance = running; }
    return rows;
  }, [selectedId, parties, kind, salesInvoices, purchaseInvoices, payments]);

  const isReadable = member.role === 'owner' || hasPermission(member, 'reports', 'read') || hasPermission(member, 'sales', 'read') || hasPermission(member, 'feed', 'read');
  if (!isReadable && !canManage) return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">You do not have permission to access accounts.</div>;

  return <div className="space-y-5">
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Customers & Vendors</h1>
        <p className="mt-1 text-xs sm:text-sm text-slate-500">Manage party records, account balances, receipts, payments and printable statements.</p>
      </div>
      <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-50 self-start sm:self-auto shrink-0">
        <Printer className="h-4 w-4" />
        <span>Print statement</span>
      </button>
    </div>
    <div className="flex items-center gap-2">
      <button onClick={() => changeKind('customer')} className={`rounded-lg px-4 py-2 text-xs sm:text-sm font-semibold transition-colors ${kind === 'customer' ? 'bg-emerald-800 text-white' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
        Customers
      </button>
      <button onClick={() => changeKind('vendor')} className={`rounded-lg px-4 py-2 text-xs sm:text-sm font-semibold transition-colors ${kind === 'vendor' ? 'bg-emerald-800 text-white' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
        Vendors
      </button>
    </div>
    <div className="flex gap-2 border-b border-slate-200 overflow-x-auto no-scrollbar py-0.5">
      {(['register', 'payments', 'statements'] as const).map((tab) => (
        <button
          key={tab}
          onClick={() => setActiveTab(tab)}
          className={`whitespace-nowrap border-b-2 px-3 py-2 text-xs sm:text-sm capitalize transition-colors ${activeTab === tab ? 'border-emerald-700 font-semibold text-emerald-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          {tab === 'register' ? 'Directory' : tab === 'payments' ? (kind === 'customer' ? 'Receive Payment' : 'Pay Vendor') : 'Statements'}
        </button>
      ))}
    </div>
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}{notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}
    {activeTab === 'register' && <div className="grid gap-5 xl:grid-cols-[1fr_1.1fr]">
      {canManage && <form onSubmit={handleSave} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">{editing ? `Edit ${kind}` : `Register ${kind}`}</h2><UserPlus className="h-5 w-5 text-emerald-800"/></div>
        <label className="block text-xs font-medium text-slate-600">Name<input required minLength={2} maxLength={150} value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-slate-600">Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label><label className="text-xs font-medium text-slate-600">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label></div>
        <label className="block text-xs font-medium text-slate-600">Address<textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-slate-600">Opening balance (NGN)<input type="number" min="0" step="0.01" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label><label className="text-xs font-medium text-slate-600">Opening date<input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label></div>
        <label className="block text-xs font-medium text-slate-600">Notes<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>
        <div className="flex gap-2"><button disabled={busy} className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : editing ? 'Save changes' : 'Register'}</button>{editing && <button type="button" onClick={resetForm} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Cancel</button>}</div>
      </form>}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold text-slate-900">{kind === 'customer' ? 'Customer' : 'Vendor'} directory <span className="font-normal text-slate-500">({parties.length})</span></h2>
        </div>
        {/* Mobile card stack */}
        <div className="sm:hidden divide-y divide-slate-100 p-3 space-y-2.5">
          {parties.map((p) => {
            const bal = balanceFor(p);
            return (
              <div key={p.id} className={`rounded-xl border border-slate-200 bg-white p-3 shadow-xs space-y-2 ${selectedId === p.id ? 'ring-2 ring-emerald-600 bg-emerald-50/30' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <button onClick={() => setSelectedId(p.id)} className="font-semibold text-slate-900 text-left hover:text-emerald-800">
                      {p.name}
                    </button>
                    <div className="text-xs text-slate-500 mt-0.5">{p.phone || p.email || 'No contact details'}</div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
                    {p.status}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
                  <div>
                    <span className="text-slate-500">Balance: </span>
                    <span className={`font-bold ${bal > 0 ? 'text-amber-700' : 'text-slate-800'}`}>{moneyLabel(bal)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => beginEdit(p)} className="font-medium text-emerald-800 hover:text-emerald-950">
                      Edit
                    </button>
                    {canManage && (
                      <button disabled={busy} onClick={() => void toggleStatus(p)} className="text-slate-500 hover:text-slate-700">
                        {p.status === 'active' ? 'Deactivate' : 'Activate'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {parties.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-500">No {kind}s registered yet.</p>}
        </div>
        {/* Desktop table */}
        <div className="hidden sm:block max-h-[620px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Balance</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {parties.map((p) => (
                <tr key={p.id} className={`border-t border-slate-100 ${selectedId === p.id ? 'bg-emerald-50' : ''}`}>
                  <td className="px-4 py-3">
                    <button onClick={() => setSelectedId(p.id)} className="font-medium text-slate-900 hover:text-emerald-800">{p.name}</button>
                    <div className="text-xs text-slate-500">{p.phone || p.email || 'No contact details'}</div>
                  </td>
                  <td className="px-4 py-3 font-medium">{moneyLabel(balanceFor(p))}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs ${p.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>{p.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => beginEdit(p)} className="text-xs font-medium text-emerald-800">Edit</button>
                      {canManage && <button disabled={busy} onClick={() => void toggleStatus(p)} className="text-xs text-slate-500">{p.status === 'active' ? 'Deactivate' : 'Activate'}</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {parties.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">No {kind}s registered yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>}
    {activeTab === 'payments' && <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]"><form onSubmit={handlePayment} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">{kind === 'customer' ? 'Record customer receipt' : 'Record vendor payment'}</h2><label className="block text-xs font-medium text-slate-600">{kind === 'customer' ? 'Customer' : 'Vendor'}<select required value={selectedId} onChange={(e) => { setSelectedId(e.target.value); setPaymentInvoiceId(''); }} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Choose…</option>{activeParties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="block text-xs font-medium text-slate-600">Apply to invoice (optional)<select value={paymentInvoiceId} onChange={(e) => setPaymentInvoiceId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Unallocated account payment</option>{invoices.map((i) => <option key={i.id} value={i.id}>{i.invoiceNumber} · due {formatNgn(i.balanceNgn)}</option>)}</select></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-slate-600">Date<input type="date" required value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label><label className="text-xs font-medium text-slate-600">Amount (NGN)<input type="number" required min="0.01" step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label></div>
      <label className="block text-xs font-medium text-slate-600">Method<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as AccountPaymentMethod)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">{methods.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}</select></label><label className="block text-xs font-medium text-slate-600">Reference<input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label><label className="block text-xs font-medium text-slate-600">Notes<textarea rows={2} value={paymentRemarks} onChange={(e) => setPaymentRemarks(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label><button disabled={busy || !canPostPayment} className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Posting…' : 'Post payment'}</button>{!canPostPayment && <p className="text-xs text-amber-700">You need the corresponding sales/feed create permission to post a payment.</p>}</form>
      <div className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Current account balance</h2>{selected ? <><p className="mt-2 text-3xl font-bold text-slate-900">{moneyLabel(balanceFor(selected))}</p><p className="text-xs text-slate-500">{balanceFor(selected) >= 0 ? (kind === 'customer' ? 'Customer owes the farm' : 'Farm owes this vendor') : 'Account is in credit'}</p></> : <p className="mt-3 text-sm text-slate-500">Select an account to see its balance and invoice allocation choices.</p>}<p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Unallocated payments reduce the account balance but do not change an individual invoice. Choose an invoice above to allocate a payment directly.</p></div></div>}
    {activeTab === 'statements' && <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="font-semibold text-slate-900">{selected ? `${selected.name} statement` : `All ${kind}s`}</h2>
          <p className="text-xs text-slate-500">{selected ? 'Individual account activity' : 'Consolidated outstanding balances'}</p>
        </div>
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm">
          <option value="">All accounts</option>
          {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {selected ? (
        <>
          {/* Mobile statement card stack */}
          <div className="sm:hidden divide-y divide-slate-100 p-3 space-y-2">
            {statementRows.map((r, i) => (
              <div key={`${r.date}-${i}`} className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-500">{formatIsoDateDisplay(r.date)}</span>
                  <span className="font-bold text-slate-900">{formatNgn(r.balance)}</span>
                </div>
                <p className="text-sm font-medium text-slate-800">{r.description}</p>
                <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                  {r.debit ? <span className="text-rose-600 font-semibold">Debit: +{formatNgn(r.debit)}</span> : <span className="text-slate-400">—</span>}
                  {r.credit ? <span className="text-emerald-700 font-semibold">Credit: -{formatNgn(r.credit)}</span> : <span className="text-slate-400">—</span>}
                </div>
              </div>
            ))}
            {statementRows.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-500">No account activity has been recorded.</p>}
          </div>
          {/* Desktop statement table */}
          <div className="hidden sm:block overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 text-right">Debit</th>
                  <th className="px-4 py-3 text-right">Credit</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {statementRows.map((r, i) => (
                  <tr key={`${r.date}-${i}`} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-mono">{formatIsoDateDisplay(r.date)}</td>
                    <td className="px-4 py-3">{r.description}</td>
                    <td className="px-4 py-3 text-right font-mono">{r.debit ? formatNgn(r.debit) : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono">{r.credit ? formatNgn(r.credit) : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono font-medium">{formatNgn(r.balance)}</td>
                  </tr>
                ))}
                {statementRows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No account activity has been recorded.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          {/* Mobile consolidated cards */}
          <div className="sm:hidden divide-y divide-slate-100 p-3 space-y-2">
            {parties.map((p) => (
              <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs flex items-center justify-between">
                <div>
                  <button onClick={() => setSelectedId(p.id)} className="font-semibold text-emerald-800 text-left hover:underline">
                    {p.name}
                  </button>
                  <div className="text-xs text-slate-500 mt-0.5">{p.phone || p.email || '—'}</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-slate-400">Outstanding</div>
                  <div className="font-bold text-slate-900 text-sm">{formatNgn(balanceFor(p))}</div>
                </div>
              </div>
            ))}
            {parties.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-500">No account records yet.</p>}
          </div>
          {/* Desktop consolidated table */}
          <div className="hidden sm:block overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3 text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {parties.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-4 py-3"><button onClick={() => setSelectedId(p.id)} className="font-medium text-emerald-800 hover:underline">{p.name}</button></td>
                    <td className="px-4 py-3 text-slate-500">{p.phone || p.email || '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatNgn(balanceFor(p))}</td>
                  </tr>
                ))}
                {parties.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-500">No account records yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>}
  </div>;
};
