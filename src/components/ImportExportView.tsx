import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Database,
  Download,
  FileArchive,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  History,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { hasPermission } from '../domain/calculations.ts';
import {
  SCHEMA_VERSION,
  TABLE_DEFINITIONS,
  TableDefinition,
  TEMPLATE_VERSION,
} from '../services/importExportSchema.ts';
import {
  createTemplateDatabase,
  createTemplateZipPackage,
  triggerFileDownload,
} from '../services/templateGenerator.ts';
import {
  generateValidationCsvReport,
  validateImportDatabase,
  ValidationReport,
} from '../services/importValidator.ts';
import {
  executeSafeImport,
  ImportHistoryEntry,
  subscribeImportHistory,
} from '../services/importExecutionService.ts';
import { createFarmExportDatabase } from '../services/exportService.ts';
import type {
  CarePlan,
  EggProductionEntry,
  EggSale,
  EnvironmentMetricLog,
  Farm,
  FarmMember,
  FarmPurchase,
  FarmReminder,
  FeedConsumption,
  FeedItem,
  FeedPurchase,
  FeedStock,
  MedicationLog,
  MortalityEntry,
  Pen,
  PoultryBatch,
  SalesUnit,
} from '../types/farm.ts';
import type { Customer, Vendor } from '../types/accounts.ts';

interface ImportExportViewProps {
  farm: Farm;
  member: FarmMember;
  pens: Pen[];
  feedItems: FeedItem[];
  feedStocks: FeedStock[];
  salesUnits: SalesUnit[];
  batches: PoultryBatch[];
  carePlans: CarePlan[];
  production: EggProductionEntry[];
  purchases: FeedPurchase[];
  farmPurchases: FarmPurchase[];
  consumptions: FeedConsumption[];
  sales: EggSale[];
  mortalityEntries: MortalityEntry[];
  medicationLogs: MedicationLog[];
  environmentLogs: EnvironmentMetricLog[];
  farmReminders: FarmReminder[];
  customers: Customer[];
  vendors: Vendor[];
}

type ActiveTab = 'template' | 'import' | 'export' | 'history';

export const ImportExportView: React.FC<ImportExportViewProps> = ({
  farm,
  member,
  pens,
  feedItems,
  salesUnits,
  batches,
  carePlans,
  production,
  purchases,
  farmPurchases,
  consumptions,
  sales,
  mortalityEntries,
  medicationLogs,
  environmentLogs,
  farmReminders,
  customers,
  vendors,
}) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('template');

  // Permission checks
  const canExport = member.role === 'owner' || hasPermission(member, 'reports', 'export');
  const canImport =
    member.role === 'owner' ||
    (hasPermission(member, 'settings', 'edit') && hasPermission(member, 'batches', 'create'));

  // Template State
  const [downloadingTemplateZip, setDownloadingTemplateZip] = useState(false);
  const [downloadingTemplateDb, setDownloadingTemplateDb] = useState(false);
  const [selectedTableDoc, setSelectedTableDoc] = useState<TableDefinition>(TABLE_DEFINITIONS[0]);

  // Import State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    stage: string;
    current: number;
    total: number;
    percent: number;
  } | null>(null);
  const [duplicateStrategy, setDuplicateStrategy] = useState<'skip' | 'update'>('skip');
  const [importSuccessMessage, setImportSuccessMessage] = useState<string | null>(null);
  const [importErrorMessage, setImportErrorMessage] = useState<string | null>(null);
  const [errorSearch, setErrorSearch] = useState('');
  const [errorTableFilter, setErrorTableFilter] = useState('all');

  // Export State
  const [exportingDb, setExportingDb] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);
  const [exportSuccessMessage, setExportSuccessMessage] = useState<string | null>(null);

  // History State
  const [historyList, setHistoryList] = useState<ImportHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Subscribe to import history
  useEffect(() => {
    const unsub = subscribeImportHistory(
      farm.farmId,
      (history) => {
        setHistoryList(history);
        setLoadingHistory(false);
      },
      () => {
        setLoadingHistory(false);
      }
    );
    return unsub;
  }, [farm.farmId]);

  // Context of existing records for conflict / reference checks
  const existingContext = useMemo(() => {
    return {
      farmId: farm.farmId,
      existingPenIds: new Set(pens.map((p) => p.id)),
      existingPenCodes: new Set(pens.map((p) => p.code.toUpperCase())),
      existingBatchIds: new Set(batches.map((b) => b.id)),
      existingBatchCodes: new Set(batches.map((b) => b.batchCode.toUpperCase())),
      existingFeedItemIds: new Set(feedItems.map((f) => f.id)),
      existingSalesUnitIds: new Set(salesUnits.map((su) => su.id)),
      existingCustomerIds: new Set(customers.map((c) => c.id)),
      existingVendorIds: new Set(vendors.map((v) => v.id)),
      existingCarePlanIds: new Set(carePlans.map((cp) => cp.id)),
    };
  }, [farm.farmId, pens, batches, feedItems, salesUnits, customers, vendors, carePlans]);

  // Handle Template Downloads
  const handleDownloadTemplateZip = async () => {
    try {
      setDownloadingTemplateZip(true);
      const res = await createTemplateZipPackage();
      triggerFileDownload(res.zipBytes, 'Farm_Data_Import_Template.zip', 'application/zip');
    } catch (err: any) {
      alert(`Failed to generate template package: ${err?.message || err}`);
    } finally {
      setDownloadingTemplateZip(false);
    }
  };

  const handleDownloadTemplateDb = async () => {
    try {
      setDownloadingTemplateDb(true);
      const bytes = await createTemplateDatabase();
      triggerFileDownload(bytes, 'Farm_Data_Template.db', 'application/x-sqlite3');
    } catch (err: any) {
      alert(`Failed to generate template database: ${err?.message || err}`);
    } finally {
      setDownloadingTemplateDb(false);
    }
  };

  // Handle File Upload & Validation
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setValidationReport(null);
    setImportSuccessMessage(null);
    setImportErrorMessage(null);
    setValidating(true);

    try {
      const buffer = await file.arrayBuffer();
      const report = await validateImportDatabase(buffer, existingContext);
      setValidationReport(report);
    } catch (err: any) {
      setImportErrorMessage(`Validation error: ${err?.message || 'Failed to inspect file.'}`);
    } finally {
      setValidating(false);
    }
  };

  // Handle Safe Import
  const handleExecuteImport = async () => {
    if (!validationReport || !selectedFile) return;

    setImporting(true);
    setImportErrorMessage(null);
    setImportSuccessMessage(null);
    setImportProgress({ stage: 'Initiating import...', current: 0, total: 100, percent: 0 });

    try {
      const result = await executeSafeImport(
        validationReport,
        selectedFile.name,
        farm,
        member,
        batches,
        {
          duplicateStrategy,
          existingPenIds: new Set(pens.map((p) => p.id)),
          existingFeedItemIds: new Set(feedItems.map((f) => f.id)),
          existingSalesUnitIds: new Set(salesUnits.map((u) => u.id)),
          existingBatchIds: new Set(batches.map((b) => b.id)),
          existingCustomerIds: new Set(customers.map((c) => c.id)),
          existingVendorIds: new Set(vendors.map((v) => v.id)),
          onProgress: (p) => setImportProgress(p),
        }
      );

      if (result.success) {
        setImportSuccessMessage(
          `Import complete! ${result.recordsImported} records were safely committed to your farm.`
        );
        // Reset file selection
        setSelectedFile(null);
        setValidationReport(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        setImportErrorMessage(result.message);
      }
    } catch (err: any) {
      setImportErrorMessage(`Import failed: ${err?.message || 'Database transaction error.'}`);
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  // Handle Database Export
  const handleExportDatabase = async (format: 'db' | 'zip') => {
    try {
      if (format === 'db') setExportingDb(true);
      else setExportingZip(true);
      setExportSuccessMessage(null);

      const result = await createFarmExportDatabase({
        farm,
        pens,
        feedItems,
        salesUnits,
        customers,
        vendors,
        batches,
        production,
        mortalityEntries,
        feedPurchases: purchases,
        consumptions,
        medicationLogs,
        environmentLogs,
        sales,
        farmPurchases,
        carePlans,
        farmReminders,
      });

      if (format === 'db') {
        triggerFileDownload(result.dbBytes, result.fileNameDb, 'application/x-sqlite3');
      } else {
        triggerFileDownload(result.zipBytes, result.fileNameZip, 'application/zip');
      }

      setExportSuccessMessage(
        `Export generated successfully! Downloaded ${result.totalRecords.toLocaleString()} records.`
      );
    } catch (err: any) {
      alert(`Export failed: ${err?.message || err}`);
    } finally {
      setExportingDb(false);
      setExportingZip(false);
    }
  };

  // Filtered validation errors
  const filteredErrors = useMemo(() => {
    if (!validationReport) return [];
    return validationReport.errors.filter((err) => {
      const matchesTable = errorTableFilter === 'all' || err.table === errorTableFilter;
      const matchesSearch =
        errorSearch === '' ||
        err.column.toLowerCase().includes(errorSearch.toLowerCase()) ||
        err.reason.toLowerCase().includes(errorSearch.toLowerCase()) ||
        err.recordId.toLowerCase().includes(errorSearch.toLowerCase()) ||
        err.value.toLowerCase().includes(errorSearch.toLowerCase());
      return matchesTable && matchesSearch;
    });
  }, [validationReport, errorTableFilter, errorSearch]);

  const handleDownloadValidationReportCsv = () => {
    if (!validationReport) return;
    const csv = generateValidationCsvReport(validationReport);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Validation_Report_${farm.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-stone-200 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-800 to-green-900 text-white shadow-xs">
              <Database className="h-5 w-5 text-emerald-200" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-emerald-950">
                Data Import &amp; Export
              </h1>
              <p className="text-xs text-stone-500">
                Bulk onboarding, historical migration, and portable SQLite database exports.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100/70 px-2.5 py-1 text-xs font-semibold text-emerald-900 border border-emerald-200/60">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
            SQLite Schema v{SCHEMA_VERSION}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto rounded-xl border border-stone-200 bg-white p-1 shadow-2xs">
        <button
          type="button"
          onClick={() => setActiveTab('template')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all cursor-pointer ${
            activeTab === 'template'
              ? 'bg-emerald-800 text-white shadow-xs'
              : 'text-stone-600 hover:text-emerald-950 hover:bg-stone-50'
          }`}
        >
          <ArrowDownToLine className="h-4 w-4" />
          <span>1. Download Template</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('import')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all cursor-pointer ${
            activeTab === 'import'
              ? 'bg-emerald-800 text-white shadow-xs'
              : 'text-stone-600 hover:text-emerald-950 hover:bg-stone-50'
          }`}
        >
          <Upload className="h-4 w-4" />
          <span>2. Import Farm Data</span>
          {validationReport && validationReport.errors.length > 0 && (
            <span className="ml-1 rounded-full bg-amber-400 px-1.5 py-0.2 text-[10px] font-bold text-stone-900">
              {validationReport.errors.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('export')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all cursor-pointer ${
            activeTab === 'export'
              ? 'bg-emerald-800 text-white shadow-xs'
              : 'text-stone-600 hover:text-emerald-950 hover:bg-stone-50'
          }`}
        >
          <ArrowUpFromLine className="h-4 w-4" />
          <span>3. Export Farm Database</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all cursor-pointer ${
            activeTab === 'history'
              ? 'bg-emerald-800 text-white shadow-xs'
              : 'text-stone-600 hover:text-emerald-950 hover:bg-stone-50'
          }`}
        >
          <History className="h-4 w-4" />
          <span>Import History</span>
          {historyList.length > 0 && (
            <span className="ml-1 rounded-full bg-stone-200 px-1.5 py-0.2 text-[10px] font-bold text-stone-800">
              {historyList.length}
            </span>
          )}
        </button>
      </div>

      {/* TAB 1: DOWNLOAD DATABASE TEMPLATE */}
      {activeTab === 'template' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-stone-200/90 bg-white p-6 shadow-xs">
            <div className="max-w-3xl">
              <h2 className="text-lg font-bold text-stone-900">Download Blank Database Template</h2>
              <p className="mt-1 text-sm text-stone-600">
                Download a clean SQLite database template configured with the application&apos;s complete
                data models, relational foreign keys, constraints, and table documentation. Fill the database
                externally using DB Browser for SQLite, Python, or spreadsheet scripts, then upload it back.
              </p>
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Full ZIP Package */}
              <div className="flex flex-col justify-between rounded-xl border-2 border-emerald-600/30 bg-emerald-50/40 p-5 transition-all hover:border-emerald-600/60">
                <div>
                  <div className="flex items-center gap-2 text-emerald-950">
                    <FileArchive className="h-5 w-5 text-emerald-700" />
                    <h3 className="font-bold text-base">Complete Documentation &amp; Template Package (.zip)</h3>
                  </div>
                  <p className="mt-2 text-xs text-stone-600 leading-relaxed">
                    Includes <strong>Farm_Data_Template.db</strong> and a complete <strong>Documentation/</strong> folder with
                    a README and individual text specification files for all 17 tables with column rules and examples.
                  </p>
                  <ul className="mt-3 text-xs text-stone-500 space-y-1">
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Farm_Data_Template.db
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> 17 Detailed Table Documentation Files (.txt)
                    </li>
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> README with recommended tools &amp; step-by-step guide
                    </li>
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadTemplateZip}
                  disabled={downloadingTemplateZip}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-emerald-900 disabled:opacity-50 cursor-pointer"
                >
                  {downloadingTemplateZip ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Generating ZIP Package...</span>
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      <span>Download Full Template (.zip)</span>
                    </>
                  )}
                </button>
              </div>

              {/* Standalone DB */}
              <div className="flex flex-col justify-between rounded-xl border border-stone-200 bg-stone-50/50 p-5 transition-all hover:border-stone-300">
                <div>
                  <div className="flex items-center gap-2 text-stone-900">
                    <Database className="h-5 w-5 text-stone-700" />
                    <h3 className="font-bold text-base">Standalone SQLite Database (.db)</h3>
                  </div>
                  <p className="mt-2 text-xs text-stone-600 leading-relaxed">
                    Download only the <strong>Farm_Data_Template.db</strong> file without the extra documentation files.
                    Ready to open directly in SQLiteStudio, DB Browser for SQLite, or automated ETL scripts.
                  </p>
                  <div className="mt-3 rounded-lg bg-white p-3 border border-stone-200/60 text-xs text-stone-600 space-y-1">
                    <p>• Blank database without any farm records</p>
                    <p>• All primary keys and indexes pre-configured</p>
                    <p>• Compatible with version {SCHEMA_VERSION} import</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadTemplateDb}
                  disabled={downloadingTemplateDb}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 shadow-2xs hover:bg-stone-100 disabled:opacity-50 cursor-pointer"
                >
                  {downloadingTemplateDb ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Generating Database...</span>
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      <span>Download Standalone (.db)</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Table Specification Browser */}
          <div className="rounded-2xl border border-stone-200/90 bg-white p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-stone-200 pb-4">
              <div>
                <h3 className="font-bold text-base text-stone-900">Interactive Schema &amp; Table Specifications</h3>
                <p className="text-xs text-stone-500">
                  Select a table below to preview its compulsory columns, foreign keys, and validation rules.
                </p>
              </div>
              <span className="text-xs font-semibold text-stone-500">
                {TABLE_DEFINITIONS.length} Supported Tables
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* Tables list */}
              <div className="space-y-1 lg:col-span-1 max-h-[460px] overflow-y-auto pr-1">
                {TABLE_DEFINITIONS.map((tbl) => {
                  const selected = selectedTableDoc.tableName === tbl.tableName;
                  return (
                    <button
                      key={tbl.tableName}
                      type="button"
                      onClick={() => setSelectedTableDoc(tbl)}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors cursor-pointer ${
                        selected
                          ? 'bg-emerald-800 text-white font-semibold shadow-xs'
                          : 'text-stone-700 hover:bg-stone-100'
                      }`}
                    >
                      <span className="truncate">{tbl.displayName}</span>
                      <span className={`text-[10px] ${selected ? 'text-emerald-200' : 'text-stone-400'}`}>
                        {tbl.tableName}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Active Table Details */}
              <div className="lg:col-span-3 rounded-xl border border-stone-200 bg-stone-50/40 p-4 max-h-[460px] overflow-y-auto">
                <div className="border-b border-stone-200 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-emerald-100 px-2 py-0.5 font-mono text-xs font-bold text-emerald-900">
                      {selectedTableDoc.tableName}
                    </span>
                    <h4 className="font-bold text-stone-900 text-sm">{selectedTableDoc.displayName}</h4>
                    <span className="ml-auto text-[11px] font-medium text-stone-500">
                      Population Order: Stage {selectedTableDoc.order}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-stone-600">{selectedTableDoc.purpose}</p>
                </div>

                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-stone-200 text-[11px] font-bold text-stone-600 bg-white">
                        <th className="py-2 px-2.5">Column</th>
                        <th className="py-2 px-2">Type</th>
                        <th className="py-2 px-2">Required</th>
                        <th className="py-2 px-2.5">Description</th>
                        <th className="py-2 px-2.5">Example</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200/80 bg-white">
                      {selectedTableDoc.columns.map((col) => (
                        <tr key={col.name} className="hover:bg-stone-50/60">
                          <td className="py-2 px-2.5 font-mono font-semibold text-emerald-950">
                            {col.name}
                            {col.isPrimaryKey && (
                              <span className="ml-1 rounded bg-amber-100 px-1 py-0.2 text-[9px] font-bold text-amber-900">
                                PK
                              </span>
                            )}
                            {col.isForeignKey && (
                              <span className="ml-1 rounded bg-blue-100 px-1 py-0.2 text-[9px] font-bold text-blue-900">
                                FK → {col.foreignTable}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-2 font-mono text-[11px] text-stone-600">{col.type}</td>
                          <td className="py-2 px-2">
                            {col.isRequired ? (
                              <span className="font-semibold text-red-600">Yes</span>
                            ) : (
                              <span className="text-stone-400">Optional</span>
                            )}
                          </td>
                          <td className="py-2 px-2.5 text-stone-700">
                            <div>{col.description}</div>
                            {col.allowedValues && (
                              <div className="mt-0.5 text-[10px] text-stone-500">
                                Allowed: {col.allowedValues.join(', ')}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-2.5 font-mono text-stone-600">{col.example}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: IMPORT FARM DATA */}
      {activeTab === 'import' && (
        <div className="space-y-6">
          {/* Permission restriction notice */}
          {!canImport && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-700 mt-0.5" />
              <div>
                <p className="font-bold">Administrative Permission Required</p>
                <p className="mt-0.5">
                  Your current account role does not permit bulk database import. Contact the farm owner to grant
                  batch management and setup permissions.
                </p>
              </div>
            </div>
          )}

          {/* Success or Error banners */}
          {importSuccessMessage && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 flex items-start gap-2.5">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700 mt-0.5" />
              <div>
                <p className="font-bold">Import Completed</p>
                <p className="mt-0.5">{importSuccessMessage}</p>
              </div>
            </div>
          )}

          {importErrorMessage && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 flex items-start gap-2.5">
              <AlertCircle className="h-5 w-5 shrink-0 text-red-700 mt-0.5" />
              <div>
                <p className="font-bold">Import Notice</p>
                <p className="mt-0.5">{importErrorMessage}</p>
              </div>
            </div>
          )}

          {/* File Upload Dropzone */}
          <div className="rounded-2xl border border-stone-200/90 bg-white p-6 shadow-xs">
            <h2 className="text-lg font-bold text-stone-900">Import Farm Database</h2>
            <p className="mt-1 text-sm text-stone-600">
              Upload a completed SQLite database (.db) based on the downloaded template. The application will
              perform comprehensive structural, relational, and business-logic validation before committing any records.
            </p>

            <div className="mt-5">
              <label
                htmlFor="db-file-input"
                className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                  validating
                    ? 'border-emerald-300 bg-emerald-50/30'
                    : 'border-stone-300 hover:border-emerald-600 bg-stone-50/50 hover:bg-emerald-50/20 cursor-pointer'
                }`}
              >
                <input
                  id="db-file-input"
                  ref={fileInputRef}
                  type="file"
                  accept=".db,application/x-sqlite3,application/vnd.sqlite3"
                  onChange={handleFileChange}
                  disabled={validating || importing || !canImport}
                  className="sr-only"
                />
                <Database className="h-10 w-10 text-emerald-800" />
                <p className="mt-3 font-semibold text-stone-900 text-sm">
                  {selectedFile ? selectedFile.name : 'Click to select SQLite Database (.db)'}
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  {selectedFile
                    ? `${(selectedFile.size / 1024).toFixed(1)} KB — Click to change file`
                    : 'Accepted format: .db (SQLite 3 template format)'}
                </p>

                {validating && (
                  <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-emerald-800">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Running multi-level database validation...</span>
                  </div>
                )}
              </label>
            </div>
          </div>

          {/* Validation Report */}
          {validationReport && (
            <div className="space-y-6">
              {/* Structural Error Check */}
              {validationReport.structuralError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-900 flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-bold">Database File Validation Failed</h3>
                    <p className="mt-1">{validationReport.structuralError}</p>
                    <p className="mt-2 text-xs text-red-700">
                      Please download the official template from Tab 1 and populate records without modifying
                      the internal table structures.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Summary Scorecard */}
                  <div className="rounded-2xl border border-stone-200/90 bg-white p-6 shadow-xs">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-stone-200 pb-4">
                      <div>
                        <h3 className="font-bold text-base text-stone-900">Database Validation Report</h3>
                        <p className="text-xs text-stone-500">
                          Template: {validationReport.metadata['template_name'] || 'Babagiwa Template'} · Schema v
                          {validationReport.metadata['schema_version']}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        {validationReport.errors.length > 0 && (
                          <button
                            type="button"
                            onClick={handleDownloadValidationReportCsv}
                            className="flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 cursor-pointer"
                          >
                            <FileSpreadsheet className="h-3.5 w-3.5" />
                            <span>Download Error Report (CSV)</span>
                          </button>
                        )}
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${
                            validationReport.isValid
                              ? 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                              : 'bg-red-100 text-red-900 border border-red-200'
                          }`}
                        >
                          {validationReport.isValid ? (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                              Ready for Import
                            </>
                          ) : (
                            <>
                              <AlertCircle className="h-3.5 w-3.5 text-red-700" />
                              {validationReport.errorRecords} Errors Detected
                            </>
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                      <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-3 text-center">
                        <p className="text-[11px] font-semibold text-stone-500 uppercase">Tables Detected</p>
                        <p className="mt-1 font-display text-xl font-bold text-stone-900">
                          {validationReport.totalTablesDetected}
                        </p>
                      </div>

                      <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-3 text-center">
                        <p className="text-[11px] font-semibold text-stone-500 uppercase">Total Records</p>
                        <p className="mt-1 font-display text-xl font-bold text-stone-900">
                          {validationReport.totalRecords.toLocaleString()}
                        </p>
                      </div>

                      <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 text-center">
                        <p className="text-[11px] font-semibold text-emerald-800 uppercase">Valid Records</p>
                        <p className="mt-1 font-display text-xl font-bold text-emerald-900">
                          {validationReport.validRecords.toLocaleString()}
                        </p>
                      </div>

                      <div className="rounded-xl border border-red-200 bg-red-50/40 p-3 text-center">
                        <p className="text-[11px] font-semibold text-red-800 uppercase">Records with Errors</p>
                        <p className="mt-1 font-display text-xl font-bold text-red-900">
                          {validationReport.errorRecords}
                        </p>
                      </div>

                      <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 text-center">
                        <p className="text-[11px] font-semibold text-amber-800 uppercase">Warnings</p>
                        <p className="mt-1 font-display text-xl font-bold text-amber-900">
                          {validationReport.warningRecords}
                        </p>
                      </div>

                      <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3 text-center">
                        <p className="text-[11px] font-semibold text-blue-800 uppercase">Existing Matches</p>
                        <p className="mt-1 font-display text-xl font-bold text-blue-900">
                          {validationReport.duplicateRecords}
                        </p>
                      </div>
                    </div>

                    {/* Per-Table Breakdown Table */}
                    <div className="mt-6">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-stone-500 mb-2">
                        Per-Entity Validation Status
                      </h4>
                      <div className="overflow-x-auto rounded-xl border border-stone-200">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="bg-stone-50 text-[11px] font-bold text-stone-600 border-b border-stone-200">
                              <th className="py-2.5 px-3">Table</th>
                              <th className="py-2.5 px-3 text-right">Total Records</th>
                              <th className="py-2.5 px-3 text-right">Valid</th>
                              <th className="py-2.5 px-3 text-right">Errors</th>
                              <th className="py-2.5 px-3 text-right">Warnings</th>
                              <th className="py-2.5 px-3 text-right">Existing Matches</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-200/80 bg-white">
                            {validationReport.tableSummaries
                              .filter((t) => t.totalRecords > 0)
                              .map((t) => (
                                <tr key={t.tableName} className="hover:bg-stone-50/60">
                                  <td className="py-2 px-3 font-semibold text-stone-900">
                                    {t.displayName}{' '}
                                    <span className="font-mono text-[10px] text-stone-400">({t.tableName})</span>
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono">{t.totalRecords.toLocaleString()}</td>
                                  <td className="py-2 px-3 text-right font-mono font-bold text-emerald-700">
                                    {t.validRecords.toLocaleString()}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono">
                                    {t.errorRecords > 0 ? (
                                      <span className="font-bold text-red-600">{t.errorRecords}</span>
                                    ) : (
                                      <span className="text-stone-400">0</span>
                                    )}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono text-amber-700">
                                    {t.warningRecords > 0 ? t.warningRecords : '0'}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono text-blue-700">
                                    {t.duplicateRecords > 0 ? t.duplicateRecords : '0'}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* Detailed Error Reporting */}
                  {validationReport.errors.length > 0 && (
                    <div className="rounded-2xl border border-stone-200/90 bg-white p-6 shadow-xs">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-stone-200 pb-4">
                        <div>
                          <h3 className="font-bold text-base text-stone-900">Detailed Issue &amp; Validation Log</h3>
                          <p className="text-xs text-stone-500">
                            Identify exact rows, invalid columns, and suggested corrections.
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <div className="relative">
                            <Search className="h-3.5 w-3.5 text-stone-400 absolute left-2.5 top-2.5" />
                            <input
                              type="text"
                              value={errorSearch}
                              onChange={(e) => setErrorSearch(e.target.value)}
                              placeholder="Search issues..."
                              className="rounded-lg border border-stone-300 pl-8 pr-3 py-1.5 text-xs text-stone-900"
                            />
                          </div>

                          <select
                            value={errorTableFilter}
                            onChange={(e) => setErrorTableFilter(e.target.value)}
                            className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs text-stone-700"
                          >
                            <option value="all">All Tables</option>
                            {validationReport.tableSummaries.map((t) => (
                              <option key={t.tableName} value={t.tableName}>
                                {t.tableName}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="mt-4 overflow-x-auto max-h-[380px] rounded-xl border border-stone-200">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-stone-50 text-[11px] font-bold text-stone-600 sticky top-0">
                            <tr className="border-b border-stone-200">
                              <th className="py-2 px-2.5">Severity</th>
                              <th className="py-2 px-2.5">Table</th>
                              <th className="py-2 px-2">Row</th>
                              <th className="py-2 px-2.5">Record ID</th>
                              <th className="py-2 px-2.5">Column</th>
                              <th className="py-2 px-2.5">Value</th>
                              <th className="py-2 px-3">Problem &amp; Suggestion</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-200 bg-white">
                            {filteredErrors.map((err, i) => (
                              <tr key={i} className="hover:bg-stone-50/70">
                                <td className="py-2 px-2.5">
                                  {err.severity === 'error' ? (
                                    <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-900">
                                      <AlertCircle className="h-3 w-3" /> Error
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                                      <AlertTriangle className="h-3 w-3" /> Warning
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 px-2.5 font-mono text-stone-800">{err.table}</td>
                                <td className="py-2 px-2 font-mono text-stone-500">{err.rowNumber}</td>
                                <td className="py-2 px-2.5 font-mono text-stone-700">{err.recordId}</td>
                                <td className="py-2 px-2.5 font-mono font-semibold text-stone-900">{err.column}</td>
                                <td className="py-2 px-2.5 font-mono text-stone-600 truncate max-w-[120px]">
                                  {err.value || '—'}
                                </td>
                                <td className="py-2 px-3 text-stone-700">
                                  <div className="font-medium text-stone-900">{err.reason}</div>
                                  {err.suggestedCorrection && (
                                    <div className="text-[11px] text-emerald-800 mt-0.5">
                                      💡 {err.suggestedCorrection}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Import Confirmation & Execution Card */}
                  <div className="rounded-2xl border-2 border-emerald-700/30 bg-emerald-50/30 p-6 shadow-xs">
                    <div className="max-w-2xl">
                      <h3 className="text-base font-bold text-emerald-950">Confirm Import Execution</h3>
                      <p className="mt-1 text-xs text-stone-600">
                        Please review duplicate-handling rules and verify the numbers before confirming.
                        Imported records will be mapped into your farm collections and visible immediately.
                      </p>
                    </div>

                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="rounded-xl border border-stone-200 bg-white p-4">
                        <label className="text-xs font-bold text-stone-900 block mb-1">
                          Duplicate Record Strategy
                        </label>
                        <div className="space-y-2 mt-2">
                          <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                            <input
                              type="radio"
                              name="dup_strat"
                              value="skip"
                              checked={duplicateStrategy === 'skip'}
                              onChange={() => setDuplicateStrategy('skip')}
                              className="text-emerald-800 focus:ring-emerald-800"
                            />
                            <span>
                              <strong>Skip existing records (Default):</strong> Preserve existing records, insert new ones only.
                            </span>
                          </label>

                          <label className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                            <input
                              type="radio"
                              name="dup_strat"
                              value="update"
                              checked={duplicateStrategy === 'update'}
                              onChange={() => setDuplicateStrategy('update')}
                              className="text-emerald-800 focus:ring-emerald-800"
                            />
                            <span>
                              <strong>Update matching records:</strong> Overwrite fields on matching IDs.
                            </span>
                          </label>
                        </div>
                      </div>

                      <div className="rounded-xl border border-stone-200 bg-white p-4 flex flex-col justify-between">
                        <div>
                          <p className="text-xs font-bold text-stone-900">Import Target Summary</p>
                          <div className="mt-2 text-xs text-stone-600 space-y-1">
                            <p>• Farm: <strong>{farm.name}</strong></p>
                            <p>• Ready records: <strong>{validationReport.validRecords}</strong></p>
                            <p>• Critical errors: <strong>{validationReport.errorRecords}</strong></p>
                          </div>
                        </div>

                        {importProgress && (
                          <div className="mt-3">
                            <div className="flex justify-between text-[11px] font-semibold text-emerald-900 mb-1">
                              <span>{importProgress.stage}</span>
                              <span>{importProgress.percent}%</span>
                            </div>
                            <div className="w-full bg-stone-200 rounded-full h-2 overflow-hidden">
                              <div
                                className="bg-emerald-800 h-2 rounded-full transition-all duration-300"
                                style={{ width: `${importProgress.percent}%` }}
                              />
                            </div>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={handleExecuteImport}
                          disabled={importing || !validationReport.canProceedWithImport || !canImport}
                          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-emerald-900 disabled:opacity-50 cursor-pointer"
                        >
                          {importing ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span>Committing Records...</span>
                            </>
                          ) : (
                            <>
                              <Upload className="h-4 w-4" />
                              <span>
                                {!validationReport.canProceedWithImport
                                  ? 'Fix Errors Before Importing'
                                  : `Confirm & Import ${validationReport.validRecords.toLocaleString()} Records`}
                              </span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: EXPORT FARM DATABASE */}
      {activeTab === 'export' && (
        <div className="space-y-6">
          {!canExport && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-700 mt-0.5" />
              <div>
                <p className="font-bold">Administrative Permission Required</p>
                <p className="mt-0.5">
                  Your current account role does not permit exporting operational farm databases. Contact the farm
                  owner to request export permissions.
                </p>
              </div>
            </div>
          )}

          {exportSuccessMessage && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 flex items-start gap-2.5">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700 mt-0.5" />
              <div>
                <p className="font-bold">Database Export Ready</p>
                <p className="mt-0.5">{exportSuccessMessage}</p>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-stone-200/90 bg-white p-6 shadow-xs">
            <div className="max-w-3xl">
              <h2 className="text-lg font-bold text-stone-900">Download Complete Farm Database (.db)</h2>
              <p className="mt-1 text-sm text-stone-600">
                Generate and download an independent portable SQLite database containing all operational records
                for <strong>{farm.name}</strong>. The exported database contains all flocks, production logs, feed
                usages, expenses, and health records, complete with relational foreign keys and indexes.
              </p>
            </div>

            {/* Live Records Count Preview */}
            <div className="mt-6 rounded-xl border border-stone-200 bg-stone-50/50 p-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-stone-500 mb-3">
                Live Records Available for Export
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 text-center">
                <div className="bg-white p-2.5 rounded-lg border border-stone-200">
                  <p className="text-[10px] text-stone-500 font-semibold uppercase">Flock Batches</p>
                  <p className="font-display text-lg font-bold text-stone-900">{batches.length}</p>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-stone-200">
                  <p className="text-[10px] text-stone-500 font-semibold uppercase">Production Logs</p>
                  <p className="font-display text-lg font-bold text-stone-900">{production.length}</p>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-stone-200">
                  <p className="text-[10px] text-stone-500 font-semibold uppercase">Mortality Logs</p>
                  <p className="font-display text-lg font-bold text-stone-900">{mortalityEntries.length}</p>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-stone-200">
                  <p className="text-[10px] text-stone-500 font-semibold uppercase">Feed Consumed</p>
                  <p className="font-display text-lg font-bold text-stone-900">{consumptions.length}</p>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-stone-200">
                  <p className="text-[10px] text-stone-500 font-semibold uppercase">Egg Sales</p>
                  <p className="font-display text-lg font-bold text-stone-900">{sales.length}</p>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-stone-200">
                  <p className="text-[10px] text-stone-500 font-semibold uppercase">Medication Logs</p>
                  <p className="font-display text-lg font-bold text-stone-900">{medicationLogs.length}</p>
                </div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Standalone DB Export */}
              <div className="flex flex-col justify-between rounded-xl border-2 border-emerald-700/30 bg-emerald-50/40 p-5">
                <div>
                  <div className="flex items-center gap-2 text-emerald-950">
                    <Database className="h-5 w-5 text-emerald-700" />
                    <h3 className="font-bold text-base">Portable SQLite Database (.db)</h3>
                  </div>
                  <p className="mt-2 text-xs text-stone-600 leading-relaxed">
                    Downloads an independent SQLite database named{' '}
                    <code className="bg-emerald-100 text-emerald-900 px-1 py-0.5 rounded font-mono text-[11px]">
                      {farm.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_Export_YYYYMMDD.db
                    </code>
                    . Opens directly in DB Browser for SQLite, SQLiteStudio, or Python.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleExportDatabase('db')}
                  disabled={exportingDb || !canExport}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-emerald-900 disabled:opacity-50 cursor-pointer"
                >
                  {exportingDb ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Generating Database Export...</span>
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      <span>Download Farm Database (.db)</span>
                    </>
                  )}
                </button>
              </div>

              {/* Complete Export Package ZIP */}
              <div className="flex flex-col justify-between rounded-xl border border-stone-200 bg-stone-50/50 p-5">
                <div>
                  <div className="flex items-center gap-2 text-stone-900">
                    <FileArchive className="h-5 w-5 text-stone-700" />
                    <h3 className="font-bold text-base">Complete Export Archive (.zip)</h3>
                  </div>
                  <p className="mt-2 text-xs text-stone-600 leading-relaxed">
                    Includes the portable SQLite database plus the complete Documentation folder containing
                    table schemas, column definitions, and a README for external data analysts.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleExportDatabase('zip')}
                  disabled={exportingZip || !canExport}
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 shadow-2xs hover:bg-stone-100 disabled:opacity-50 cursor-pointer"
                >
                  {exportingZip ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Packaging ZIP...</span>
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      <span>Download Export Package (.zip)</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* External Tool Compatibility Guide */}
            <div className="mt-6 rounded-xl border border-stone-200/80 bg-white p-5">
              <h4 className="text-xs font-bold text-stone-900 uppercase tracking-wider mb-2">
                External Data Analysis &amp; BI Compatibility
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-stone-600">
                <div className="p-3 rounded-lg bg-stone-50 border border-stone-200/60">
                  <p className="font-bold text-stone-900 mb-1">🐍 Python / Jupyter</p>
                  <p className="text-[11px] font-mono text-stone-500">
                    import sqlite3<br />
                    import pandas as pd<br />
                    conn = sqlite3.connect(&apos;export.db&apos;)<br />
                    df = pd.read_sql(&apos;SELECT * FROM egg_production&apos;, conn)
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-stone-50 border border-stone-200/60">
                  <p className="font-bold text-stone-900 mb-1">📊 DB Browser for SQLite</p>
                  <p className="text-[11px]">
                    Free GUI for Windows/Mac. Execute custom SQL queries, inspect table structures, and export
                    tables directly to Excel or CSV.
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-stone-50 border border-stone-200/60">
                  <p className="font-bold text-stone-900 mb-1">📈 Power BI &amp; Excel</p>
                  <p className="text-[11px]">
                    Connect using the official SQLite ODBC Driver to build live dashboards, financial models, and
                    yield trends.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: IMPORT HISTORY */}
      {activeTab === 'history' && (
        <div className="rounded-2xl border border-stone-200/90 bg-white p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-stone-200 pb-4">
            <div>
              <h2 className="text-lg font-bold text-stone-900">Import History &amp; Audit Log</h2>
              <p className="text-xs text-stone-500">
                Historical record of all bulk SQLite template uploads and migrations for {farm.name}.
              </p>
            </div>
            <span className="text-xs font-semibold text-stone-500">{historyList.length} Imports Recorded</span>
          </div>

          {loadingHistory ? (
            <div className="py-12 text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-emerald-800" />
              <p className="mt-2 text-xs text-stone-500">Loading import records...</p>
            </div>
          ) : historyList.length === 0 ? (
            <div className="py-12 text-center rounded-xl border border-dashed border-stone-300">
              <History className="mx-auto h-8 w-8 text-stone-400" />
              <p className="mt-2 text-sm font-semibold text-stone-700">No Import History Yet</p>
              <p className="mt-1 text-xs text-stone-500">
                When you import data using the template, previous import details will be recorded here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-stone-200">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-stone-50 text-[11px] font-bold text-stone-600 border-b border-stone-200">
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">File Name</th>
                    <th className="py-2.5 px-3">Imported By</th>
                    <th className="py-2.5 px-3 text-right">Records Imported</th>
                    <th className="py-2.5 px-3 text-right">Skipped</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200 bg-white">
                  {historyList.map((entry) => (
                    <tr key={entry.id} className="hover:bg-stone-50/60">
                      <td className="py-2.5 px-3 font-mono text-stone-600 whitespace-nowrap">
                        {entry.importDate ? entry.importDate.slice(0, 16).replace('T', ' ') : '—'}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-stone-900">
                        {entry.originalFileName}
                      </td>
                      <td className="py-2.5 px-3 text-stone-700">{entry.actorName}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-800">
                        {entry.recordsImported.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-stone-500">
                        {entry.recordsSkipped || 0}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold ${
                            entry.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-900'
                              : 'bg-red-100 text-red-900'
                          }`}
                        >
                          {entry.status === 'completed' ? 'Completed' : 'Partial'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-stone-600 max-w-xs truncate">{entry.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
