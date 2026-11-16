import React from 'react';
import { ArrowLeft, CheckCircle2, Clock, Printer, X } from 'lucide-react';
import { formatEggCountInCrates, formatIsoDateDisplay, formatNgn } from '../domain/calculations.ts';
import type { Farm } from '../types/farm.ts';
import type { PurchaseInvoice, SalesInvoice } from '../types/accounts.ts';

export interface InvoicePrintDocumentProps {
  farm: Farm;
  docType: 'sales' | 'purchase';
  salesInvoice?: SalesInvoice | null;
  purchaseInvoice?: PurchaseInvoice | null;
  onClose: () => void;
}

export const InvoicePrintDocument: React.FC<InvoicePrintDocumentProps> = ({
  farm,
  docType,
  salesInvoice,
  purchaseInvoice,
  onClose,
}) => {
  const isSales = docType === 'sales';
  const invoice = isSales ? salesInvoice : purchaseInvoice;

  if (!invoice) return null;

  const handlePrint = () => {
    window.print();
  };

  const isPaid = invoice.paymentStatus === 'paid';
  const isPartial = invoice.paymentStatus === 'partial';

  const title = isSales
    ? isPaid
      ? 'SALES INVOICE & RECEIPT'
      : isPartial
      ? 'SALES INVOICE & PARTIAL RECEIPT'
      : 'SALES INVOICE'
    : isPaid
    ? 'PURCHASE BILL & PAYMENT VOUCHER'
    : 'PURCHASE BILL';

  const partyLabel = isSales ? 'Customer' : 'Vendor / Supplier';
  const partyName = isSales ? (salesInvoice?.customerNameSnapshot || 'Walk-in Customer') : (purchaseInvoice?.vendorNameSnapshot || 'One-off Supplier');
  const discountNgn = isSales ? (salesInvoice?.discountNgn || 0) : 0;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 p-2 sm:p-6 backdrop-blur-xs flex justify-center items-start print:p-0 print:bg-white print:fixed-none">
      {/* Container */}
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden print:border-none print:shadow-none print:max-w-none print:w-full">
        {/* Screen Action Bar (Hidden during Print) */}
        <div className="no-print flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back</span>
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-emerald-900 transition-colors cursor-pointer"
            >
              <Printer className="h-4 w-4" />
              <span>Print {isSales ? 'Invoice / Receipt' : 'Bill / Voucher'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Printable Paper Area */}
        <div id="printable-invoice-area" className="p-8 sm:p-12 text-slate-900 bg-white">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start gap-6 border-b-2 border-emerald-800 pb-6">
            <div>
              <div className="inline-block rounded-md bg-emerald-900 px-2.5 py-1 text-xs font-bold tracking-wider text-emerald-100 uppercase">
                Babagiwa Farm
              </div>
              <h1 className="mt-2 text-2xl font-black text-slate-900 tracking-tight">{farm.name}</h1>
              {farm.location && <p className="text-xs text-slate-600 mt-0.5">{farm.location}</p>}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 font-mono">
                {farm.contactPhone && <span>Tel: {farm.contactPhone}</span>}
                {farm.contactEmail && <span>Email: {farm.contactEmail}</span>}
              </div>
            </div>

            <div className="sm:text-right shrink-0">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md">
                {title}
              </span>
              <p className="mt-3 text-lg font-extrabold font-mono text-slate-900">{invoice.invoiceNumber}</p>
              <p className="text-xs text-slate-500 mt-1">
                Date: <span className="font-semibold text-slate-700">{formatIsoDateDisplay(invoice.transactionDate)}</span>
              </p>
              {isSales && salesInvoice?.transactionTime && (
                <p className="text-xs text-slate-500">
                  Time: <span className="font-mono text-slate-700">{salesInvoice.transactionTime}</span>
                </p>
              )}
            </div>
          </div>

          {/* Party & Payment Status Grid */}
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-6 bg-slate-50/80 p-4 rounded-xl border border-slate-200">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{partyLabel}</span>
              <p className="mt-1 text-base font-bold text-slate-900">{partyName}</p>
              {isSales && salesInvoice?.customerId === 'walk-in' && (
                <span className="inline-block mt-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded font-medium">
                  Walk-in / Over-the-counter
                </span>
              )}
              {isSales && salesInvoice?.remarks && (
                <p className="mt-2 text-xs text-slate-600 italic">"{salesInvoice.remarks}"</p>
              )}
              {!isSales && purchaseInvoice?.remarks && (
                <p className="mt-2 text-xs text-slate-600 italic">"{purchaseInvoice.remarks}"</p>
              )}
            </div>

            <div className="sm:text-right flex flex-col justify-between sm:items-end">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Payment Status</span>
                <div className="mt-1.5 flex items-center sm:justify-end gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold tracking-wide uppercase ${
                      isPaid
                        ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                        : isPartial
                        ? 'bg-amber-100 text-amber-900 border border-amber-300'
                        : 'bg-red-100 text-red-900 border border-red-300'
                    }`}
                  >
                    {isPaid ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                    <span>{invoice.paymentStatus}</span>
                  </span>
                </div>
              </div>

              {invoice.paymentMethod && (
                <div className="mt-3 text-xs text-slate-600">
                  <span className="text-slate-400">Method: </span>
                  <span className="font-semibold uppercase">{invoice.paymentMethod.replace('_', ' ')}</span>
                  {invoice.paymentReference && (
                    <span className="font-mono text-slate-500 block sm:inline sm:ml-2">
                      (Ref: {invoice.paymentReference})
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Table of Line Items */}
          <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-700 border-b border-slate-200 font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4 w-12 text-center">#</th>
                  <th className="py-3 px-4">Item & Description</th>
                  <th className="py-3 px-4 text-center">Quantity</th>
                  <th className="py-3 px-4 text-right">Unit Price</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800">
                {isSales && salesInvoice && salesInvoice.lines.map((l, index) => (
                  <tr key={l.id} className="hover:bg-slate-50/50">
                    <td className="py-3.5 px-4 text-center font-mono text-slate-400">{index + 1}</td>
                    <td className="py-3.5 px-4">
                      <p className="font-bold text-slate-900">{l.unitNameSnapshot}</p>
                      <p className="text-[11px] text-slate-500">
                        Grade: <span className="font-semibold text-slate-700">{l.eggCategory}</span>
                        {l.eggsPerUnitSnapshot > 1 && ` · (${l.eggsPerUnitSnapshot} eggs/unit)`}
                        {l.batchCodeSnapshot && ` · Flock: ${l.batchCodeSnapshot}`}
                      </p>
                      {l.priceOverridden && (
                        <p className="text-[10px] text-amber-700 mt-0.5">Price adjusted: {l.overrideReason}</p>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className="font-mono font-bold text-slate-900">{l.quantity}</span>
                      <span className="text-[10px] text-slate-500 block">({formatEggCountInCrates(l.totalEggs)})</span>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono">{formatNgn(l.unitPriceNgn)}</td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">{formatNgn(l.totalAmountNgn)}</td>
                  </tr>
                ))}

                {!isSales && purchaseInvoice && purchaseInvoice.lines.map((l, index) => (
                  <tr key={l.id} className="hover:bg-slate-50/50">
                    <td className="py-3.5 px-4 text-center font-mono text-slate-400">{index + 1}</td>
                    <td className="py-3.5 px-4">
                      <p className="font-bold text-slate-900">{l.itemNameSnapshot}</p>
                      <p className="text-[11px] text-slate-500 capitalize">
                        Type: <span className="font-semibold text-slate-700">{l.lineType}</span>
                        {l.category && ` · Category: ${l.category}`}
                        {l.brandSnapshot && ` · Brand: ${l.brandSnapshot}`}
                        {l.batchCodeSnapshot && ` · Flock: ${l.batchCodeSnapshot}`}
                      </p>
                    </td>
                    <td className="py-3.5 px-4 text-center font-mono font-bold text-slate-900">
                      {l.quantity} {l.unit}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono">{formatNgn(l.unitPriceNgn)}</td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">{formatNgn(l.totalAmountNgn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Financial Calculation Totals */}
          <div className="mt-6 flex justify-end">
            <div className="w-full sm:w-72 space-y-2 text-xs border-t border-slate-200 pt-3">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal:</span>
                <span className="font-mono font-semibold text-slate-900">{formatNgn(invoice.subtotalNgn)}</span>
              </div>

              {discountNgn > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Discount:</span>
                  <span className="font-mono font-semibold">- {formatNgn(discountNgn)}</span>
                </div>
              )}

              <div className="flex justify-between text-sm font-bold border-t border-slate-300 pt-2 text-slate-900">
                <span>Total Amount:</span>
                <span className="font-mono text-base text-emerald-900">{formatNgn(invoice.totalAmountNgn)}</span>
              </div>

              <div className="flex justify-between text-slate-600 pt-1">
                <span>Amount Paid:</span>
                <span className="font-mono font-semibold text-emerald-700">{formatNgn(invoice.paidAmountNgn)}</span>
              </div>

              <div className={`flex justify-between font-bold border-t border-slate-200 pt-2 ${invoice.balanceNgn > 0 ? 'text-red-700' : 'text-slate-500'}`}>
                <span>Balance Due:</span>
                <span className="font-mono text-sm">{formatNgn(invoice.balanceNgn)}</span>
              </div>
            </div>
          </div>

          {/* Signatures & Footer Notice */}
          <div className="mt-12 pt-8 border-t border-slate-200 grid grid-cols-2 gap-8 text-center text-xs text-slate-500">
            <div>
              <div className="border-b border-slate-300 pb-8 mb-2"></div>
              <p className="font-medium text-slate-700">Prepared By: {invoice.createdByName || 'Staff'}</p>
            </div>
            <div>
              <div className="border-b border-slate-300 pb-8 mb-2"></div>
              <p className="font-medium text-slate-700">Received By / Authorized Signatory</p>
            </div>
          </div>

          <div className="mt-8 text-center text-[11px] text-slate-400">
            <p>Thank you for doing business with {farm.name}!</p>
            <p className="font-mono mt-0.5">This is a computer-generated commercial document.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
