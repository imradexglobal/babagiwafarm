export type PartyStatus = 'active' | 'inactive';
export type AccountPaymentMethod = 'cash' | 'bank_transfer' | 'pos' | 'cheque' | 'other';
export type InvoicePaymentStatus = 'unpaid' | 'partial' | 'paid';

export interface Customer {
  id: string;
  farmId: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  openingBalanceNgn: number;
  openingBalanceDate: string;
  status: PartyStatus;
  createdBy: string;
  updatedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface Vendor {
  id: string;
  farmId: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  openingBalanceNgn: number;
  openingBalanceDate: string;
  status: PartyStatus;
  createdBy: string;
  updatedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface SalesInvoiceLine {
  id: string;
  eggSaleId: string;
  grade: string;
  eggCategory: string;
  salesUnitId: string;
  unitNameSnapshot: string;
  eggsPerUnitSnapshot: number;
  quantity: number;
  totalEggs: number;
  unitPriceNgn: number;
  discountNgn: number;
  totalAmountNgn: number;
  suggestedUnitPriceNgn: number;
  priceOverridden: boolean;
  overrideReason: string;
  batchId: string;
  batchCodeSnapshot: string;
  sourcePenId: string;
  sourcePenNameSnapshot: string;
  remarks: string;
}

export interface SalesInvoice {
  id: string;
  farmId: string;
  invoiceNumber: string;
  transactionDate: string;
  transactionTime: string;
  customerId: string;
  customerNameSnapshot: string;
  lines: SalesInvoiceLine[];
  subtotalNgn: number;
  discountNgn: number;
  totalAmountNgn: number;
  paidAmountNgn: number;
  balanceNgn: number;
  paymentStatus: InvoicePaymentStatus;
  salesMode: 'phantom' | 'true_inventory';
  paymentMethod: AccountPaymentMethod | '';
  paymentReference: string;
  remarks: string;
  isVoided: boolean;
  voidReason: string;
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PurchaseInvoiceLine {
  id: string;
  lineType: 'feed' | 'general';
  sourceRecordId: string;
  category: string;
  itemNameSnapshot: string;
  feedItemId: string;
  feedTypeSnapshot: string;
  brandSnapshot: string;
  quantity: number;
  unit: string;
  bagWeightKgSnapshot: number;
  standardizedGrams: number;
  unitPriceNgn: number;
  totalAmountNgn: number;
  batchId: string;
  batchCodeSnapshot: string;
  remarks: string;
}

export interface PurchaseInvoice {
  id: string;
  farmId: string;
  invoiceNumber: string;
  transactionDate: string;
  vendorId: string;
  vendorNameSnapshot: string;
  reference: string;
  lines: PurchaseInvoiceLine[];
  subtotalNgn: number;
  totalAmountNgn: number;
  paidAmountNgn: number;
  balanceNgn: number;
  paymentStatus: InvoicePaymentStatus;
  paymentMethod: AccountPaymentMethod | '';
  paymentReference: string;
  remarks: string;
  isVoided: boolean;
  voidReason: string;
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface AccountPayment {
  id: string;
  farmId: string;
  direction: 'customer_receipt' | 'vendor_payment';
  partyId: string;
  partyNameSnapshot: string;
  invoiceId: string;
  invoiceNumberSnapshot: string;
  transactionDate: string;
  amountNgn: number;
  method: AccountPaymentMethod;
  reference: string;
  remarks: string;
  isVoided: boolean;
  voidReason: string;
  createdBy: string;
  createdByName: string;
  createdAt: unknown;
}
