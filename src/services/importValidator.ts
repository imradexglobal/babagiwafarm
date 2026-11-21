/**
 * SQLite file parser, structural validator, and record-level business logic validator.
 */

import { getSqlInstance, isSqliteFile } from './sqliteEngine.ts';
import {
  SCHEMA_VERSION,
  TABLE_DEFINITIONS,
  TableDefinition,
} from './importExportSchema.ts';

export interface ValidationError {
  table: string;
  rowNumber: number;
  recordId: string;
  column: string;
  value: string;
  reason: string;
  suggestedCorrection?: string;
  severity: 'error' | 'warning';
}

export interface TableValidationSummary {
  tableName: string;
  displayName: string;
  totalRecords: number;
  validRecords: number;
  errorRecords: number;
  warningRecords: number;
  duplicateRecords: number;
}

export interface ExistingFarmContext {
  farmId: string;
  existingPenIds: Set<string>;
  existingPenCodes: Set<string>;
  existingBatchIds: Set<string>;
  existingBatchCodes: Set<string>;
  existingFeedItemIds: Set<string>;
  existingSalesUnitIds: Set<string>;
  existingCustomerIds: Set<string>;
  existingVendorIds: Set<string>;
  existingCarePlanIds: Set<string>;
}

export interface ValidationReport {
  isValid: boolean;
  canProceedWithImport: boolean;
  structuralError?: string;
  totalTablesDetected: number;
  totalRecords: number;
  validRecords: number;
  errorRecords: number;
  warningRecords: number;
  duplicateRecords: number;
  tableSummaries: TableValidationSummary[];
  errors: ValidationError[];
  metadata: Record<string, string>;
  parsedData: Record<string, Record<string, any>[]>;
}

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function isValidDateString(str: string): boolean {
  if (!ISO_DATE_REGEX.test(str)) return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
}

/**
 * Validates an uploaded SQLite file against the application schema and business rules.
 */
export async function validateImportDatabase(
  fileBuffer: ArrayBuffer | Uint8Array,
  context: ExistingFarmContext
): Promise<ValidationReport> {
  const bytes = fileBuffer instanceof Uint8Array ? fileBuffer : new Uint8Array(fileBuffer);

  // 1. Check Magic Header
  if (!isSqliteFile(bytes)) {
    return {
      isValid: false,
      canProceedWithImport: false,
      structuralError: 'The selected file is not a valid SQLite database. Expected SQLite 3 format header.',
      totalTablesDetected: 0,
      totalRecords: 0,
      validRecords: 0,
      errorRecords: 0,
      warningRecords: 0,
      duplicateRecords: 0,
      tableSummaries: [],
      errors: [],
      metadata: {},
      parsedData: {},
    };
  }

  // Check file size limit (reasonable limit: 50MB)
  if (bytes.length > 50 * 1024 * 1024) {
    return {
      isValid: false,
      canProceedWithImport: false,
      structuralError: 'File size exceeds maximum supported limit (50 MB).',
      totalTablesDetected: 0,
      totalRecords: 0,
      validRecords: 0,
      errorRecords: 0,
      warningRecords: 0,
      duplicateRecords: 0,
      tableSummaries: [],
      errors: [],
      metadata: {},
      parsedData: {},
    };
  }

  const SQL = await getSqlInstance();
  let db: any;
  try {
    db = new SQL.Database(bytes);
  } catch (err: any) {
    return {
      isValid: false,
      canProceedWithImport: false,
      structuralError: `Failed to open SQLite database: ${err?.message || 'Corrupted database file.'}`,
      totalTablesDetected: 0,
      totalRecords: 0,
      validRecords: 0,
      errorRecords: 0,
      warningRecords: 0,
      duplicateRecords: 0,
      tableSummaries: [],
      errors: [],
      metadata: {},
      parsedData: {},
    };
  }

  try {
    // 2. Read Metadata Table
    const metadata: Record<string, string> = {};
    const tableListRes = db.exec("SELECT name FROM sqlite_master WHERE type='table';");
    const existingTableNames = new Set<string>();
    if (tableListRes.length > 0 && tableListRes[0].values) {
      for (const row of tableListRes[0].values) {
        existingTableNames.add(String(row[0]));
      }
    }

    if (!existingTableNames.has('_template_metadata')) {
      return {
        isValid: false,
        canProceedWithImport: false,
        structuralError:
          'Missing expected "_template_metadata" table. Ensure you are uploading a database derived from the official Farm_Data_Template.db template.',
        totalTablesDetected: existingTableNames.size,
        totalRecords: 0,
        validRecords: 0,
        errorRecords: 0,
        warningRecords: 0,
        duplicateRecords: 0,
        tableSummaries: [],
        errors: [],
        metadata: {},
        parsedData: {},
      };
    }

    const metaRes = db.exec('SELECT key, value FROM _template_metadata;');
    if (metaRes.length > 0 && metaRes[0].values) {
      for (const row of metaRes[0].values) {
        metadata[String(row[0])] = String(row[1]);
      }
    }

    const fileSchemaVersion = metadata['schema_version'];
    if (!fileSchemaVersion) {
      return {
        isValid: false,
        canProceedWithImport: false,
        structuralError: 'Template metadata is missing "schema_version". Unsupported template structure.',
        totalTablesDetected: existingTableNames.size,
        totalRecords: 0,
        validRecords: 0,
        errorRecords: 0,
        warningRecords: 0,
        duplicateRecords: 0,
        tableSummaries: [],
        errors: [],
        metadata,
        parsedData: {},
      };
    }

    if (fileSchemaVersion !== SCHEMA_VERSION) {
      return {
        isValid: false,
        canProceedWithImport: false,
        structuralError: `Incompatible schema version: template has version "${fileSchemaVersion}", but this application requires version "${SCHEMA_VERSION}". Please download the latest template.`,
        totalTablesDetected: existingTableNames.size,
        totalRecords: 0,
        validRecords: 0,
        errorRecords: 0,
        warningRecords: 0,
        duplicateRecords: 0,
        tableSummaries: [],
        errors: [],
        metadata,
        parsedData: {},
      };
    }

    // 3. Inspect Tables & Load Records
    const errors: ValidationError[] = [];
    const tableSummaries: TableValidationSummary[] = [];
    const parsedData: Record<string, Record<string, any>[]> = {};

    // In-memory sets to resolve relationships within this file
    const filePenIds = new Set<string>();
    const filePenCodes = new Set<string>();
    const fileBatchIds = new Set<string>();
    const fileBatchCodes = new Set<string>();
    const fileFeedItemIds = new Set<string>();
    const fileSalesUnitIds = new Set<string>();
    const fileCustomerIds = new Set<string>();
    const fileVendorIds = new Set<string>();
    const fileCarePlanIds = new Set<string>();

    let totalRecordsCount = 0;
    let duplicateRecordsCount = 0;

    // First pass: Read all table rows and populate IDs so foreign key checks can resolve forward references
    for (const tableDef of TABLE_DEFINITIONS) {
      parsedData[tableDef.tableName] = [];
      if (!existingTableNames.has(tableDef.tableName)) {
        errors.push({
          table: tableDef.tableName,
          rowNumber: 0,
          recordId: 'STRUCTURAL',
          column: 'table',
          value: tableDef.tableName,
          reason: `Required table "${tableDef.tableName}" does not exist in the database.`,
          suggestedCorrection: 'Use the official Farm_Data_Template.db which includes all tables.',
          severity: 'error',
        });
        continue;
      }

      // Check column definitions in sqlite_master or PRAGMA table_info
      const pragmaRes = db.exec(`PRAGMA table_info(${tableDef.tableName});`);
      const foundCols = new Set<string>();
      if (pragmaRes.length > 0 && pragmaRes[0].values) {
        for (const r of pragmaRes[0].values) {
          foundCols.add(String(r[1])); // column name is index 1
        }
      }

      for (const col of tableDef.columns) {
        if (!foundCols.has(col.name)) {
          errors.push({
            table: tableDef.tableName,
            rowNumber: 0,
            recordId: 'STRUCTURAL',
            column: col.name,
            value: '(missing column)',
            reason: `Table "${tableDef.tableName}" is missing expected column "${col.name}".`,
            suggestedCorrection: 'Ensure table structure matches the template.',
            severity: 'error',
          });
        }
      }

      // Read rows safely using SELECT *
      try {
        const queryRes = db.exec(`SELECT * FROM ${tableDef.tableName};`);
        if (queryRes.length > 0 && queryRes[0].values) {
          const colNames: string[] = queryRes[0].columns;
          for (const row of queryRes[0].values) {
            const rowObj: Record<string, any> = {};
            for (let i = 0; i < colNames.length; i++) {
              rowObj[colNames[i]] = row[i];
            }
            parsedData[tableDef.tableName].push(rowObj);

            // Populate tracking sets
            const rowId = rowObj['id'] ? String(rowObj['id']).trim() : '';
            if (rowId) {
              if (tableDef.tableName === 'pens') {
                filePenIds.add(rowId);
                if (rowObj['code']) filePenCodes.add(String(rowObj['code']).trim().toUpperCase());
              } else if (tableDef.tableName === 'batches') {
                fileBatchIds.add(rowId);
                if (rowObj['batch_code']) fileBatchCodes.add(String(rowObj['batch_code']).trim().toUpperCase());
              } else if (tableDef.tableName === 'feed_items') {
                fileFeedItemIds.add(rowId);
              } else if (tableDef.tableName === 'sales_units') {
                fileSalesUnitIds.add(rowId);
              } else if (tableDef.tableName === 'customers') {
                fileCustomerIds.add(rowId);
              } else if (tableDef.tableName === 'vendors') {
                fileVendorIds.add(rowId);
              } else if (tableDef.tableName === 'care_plans') {
                fileCarePlanIds.add(rowId);
              }
            }
          }
        }
      } catch (err: any) {
        errors.push({
          table: tableDef.tableName,
          rowNumber: 0,
          recordId: 'QUERY_ERROR',
          column: '*',
          value: '',
          reason: `Failed to query table "${tableDef.tableName}": ${err?.message}`,
          severity: 'error',
        });
      }
    }

    // Second pass: Comprehensive row-by-row validation & relationship validation
    for (const tableDef of TABLE_DEFINITIONS) {
      const rows = parsedData[tableDef.tableName] || [];
      const seenIds = new Set<string>();
      let tableErrors = 0;
      let tableWarnings = 0;
      let tableDuplicates = 0;

      for (let rIdx = 0; rIdx < rows.length; rIdx++) {
        const row = rows[rIdx];
        const rowNum = rIdx + 1;
        const rowId = row['id'] ? String(row['id']).trim() : `row_${rowNum}`;
        let rowHasError = false;

        // Check primary key
        if (!row['id'] || String(row['id']).trim() === '') {
          errors.push({
            table: tableDef.tableName,
            rowNumber: rowNum,
            recordId: rowId,
            column: 'id',
            value: '',
            reason: 'Missing compulsory primary key (id).',
            suggestedCorrection: 'Provide a unique non-empty identifier.',
            severity: 'error',
          });
          rowHasError = true;
        } else {
          const strId = String(row['id']).trim();
          if (seenIds.has(strId)) {
            errors.push({
              table: tableDef.tableName,
              rowNumber: rowNum,
              recordId: strId,
              column: 'id',
              value: strId,
              reason: `Duplicate ID "${strId}" within table "${tableDef.tableName}".`,
              suggestedCorrection: 'Ensure every record in this table has a distinct ID.',
              severity: 'error',
            });
            rowHasError = true;
          } else {
            seenIds.add(strId);
          }

          // Check against existing farm records for duplicate/update detection
          let isExistingInFarm = false;
          if (tableDef.tableName === 'pens' && context.existingPenIds.has(strId)) isExistingInFarm = true;
          if (tableDef.tableName === 'batches' && context.existingBatchIds.has(strId)) isExistingInFarm = true;
          if (tableDef.tableName === 'feed_items' && context.existingFeedItemIds.has(strId)) isExistingInFarm = true;
          if (tableDef.tableName === 'sales_units' && context.existingSalesUnitIds.has(strId)) isExistingInFarm = true;
          if (tableDef.tableName === 'customers' && context.existingCustomerIds.has(strId)) isExistingInFarm = true;
          if (tableDef.tableName === 'vendors' && context.existingVendorIds.has(strId)) isExistingInFarm = true;
          if (tableDef.tableName === 'care_plans' && context.existingCarePlanIds.has(strId)) isExistingInFarm = true;

          if (isExistingInFarm) {
            tableDuplicates++;
            duplicateRecordsCount++;
            errors.push({
              table: tableDef.tableName,
              rowNumber: rowNum,
              recordId: strId,
              column: 'id',
              value: strId,
              reason: `Record with ID "${strId}" already exists in the farm database.`,
              suggestedCorrection: 'Will be skipped by default, or updated if update option is selected.',
              severity: 'warning',
            });
          }
        }

        // Validate each column
        for (const col of tableDef.columns) {
          const val = row[col.name];
          const isNullOrEmpty = val === null || val === undefined || (typeof val === 'string' && val.trim() === '');

          // Compulsory check
          if (col.isRequired && isNullOrEmpty && !col.isPrimaryKey) {
            errors.push({
              table: tableDef.tableName,
              rowNumber: rowNum,
              recordId: rowId,
              column: col.name,
              value: String(val ?? ''),
              reason: `Compulsory field "${col.name}" is empty.`,
              suggestedCorrection: `Provide a valid value: ${col.example}`,
              severity: 'error',
            });
            rowHasError = true;
            continue;
          }

          if (!isNullOrEmpty) {
            // Type validation
            if (col.type === 'INTEGER') {
              const num = Number(val);
              if (!Number.isInteger(num)) {
                errors.push({
                  table: tableDef.tableName,
                  rowNumber: rowNum,
                  recordId: rowId,
                  column: col.name,
                  value: String(val),
                  reason: `Field "${col.name}" must be an integer.`,
                  suggestedCorrection: 'Enter a whole number with no decimals.',
                  severity: 'error',
                });
                rowHasError = true;
              }
            } else if (col.type === 'REAL') {
              const num = Number(val);
              if (isNaN(num)) {
                errors.push({
                  table: tableDef.tableName,
                  rowNumber: rowNum,
                  recordId: rowId,
                  column: col.name,
                  value: String(val),
                  reason: `Field "${col.name}" must be a numeric value.`,
                  suggestedCorrection: 'Enter a valid number.',
                  severity: 'error',
                });
                rowHasError = true;
              }
            }

            // Allowed values check
            if (col.allowedValues && col.allowedValues.length > 0) {
              const strVal = String(val).trim();
              if (!col.allowedValues.includes(strVal as any)) {
                errors.push({
                  table: tableDef.tableName,
                  rowNumber: rowNum,
                  recordId: rowId,
                  column: col.name,
                  value: strVal,
                  reason: `Value "${strVal}" is not permitted for "${col.name}".`,
                  suggestedCorrection: `Allowed values: ${col.allowedValues.join(', ')}`,
                  severity: 'error',
                });
                rowHasError = true;
              }
            }

            // Date validation
            if (col.name.endsWith('_date') || col.name === 'due_date' || col.name === 'placement_date' || col.name === 'hatch_date') {
              const dateStr = String(val).trim();
              if (!isValidDateString(dateStr)) {
                errors.push({
                  table: tableDef.tableName,
                  rowNumber: rowNum,
                  recordId: rowId,
                  column: col.name,
                  value: dateStr,
                  reason: `Invalid date format in "${col.name}". Must strictly be YYYY-MM-DD.`,
                  suggestedCorrection: 'Format as YYYY-MM-DD (e.g. 2026-01-15).',
                  severity: 'error',
                });
                rowHasError = true;
              }
            }

            // Time validation
            if (col.name === 'transaction_time') {
              const timeStr = String(val).trim();
              if (timeStr && !TIME_REGEX.test(timeStr)) {
                errors.push({
                  table: tableDef.tableName,
                  rowNumber: rowNum,
                  recordId: rowId,
                  column: col.name,
                  value: timeStr,
                  reason: `Invalid time format in "${col.name}". Expected HH:mm in 24-hour format.`,
                  suggestedCorrection: 'Use HH:mm (e.g. 08:30 or 15:00).',
                  severity: 'warning',
                });
              }
            }

            // Non-negative checks for quantities and counts
            if (
              [
                'capacity',
                'initial_count',
                'male_count',
                'female_count',
                'crates',
                'pieces',
                'intact_eggs',
                'cracked_eggs',
                'damaged_eggs',
                'total_eggs',
                'mortality_count',
                'entered_quantity',
                'quantity',
                'total_eggs_equivalent',
                'unit_price_ngn',
                'total_cost_ngn',
                'total_amount_ngn',
                'unit_purchase_price_ngn',
                'sample_size',
              ].includes(col.name)
            ) {
              const numVal = Number(val);
              if (numVal < 0) {
                errors.push({
                  table: tableDef.tableName,
                  rowNumber: rowNum,
                  recordId: rowId,
                  column: col.name,
                  value: String(val),
                  reason: `Column "${col.name}" cannot be negative (${val}).`,
                  suggestedCorrection: 'Enter a value greater than or equal to 0.',
                  severity: 'error',
                });
                rowHasError = true;
              }
            }

            // Foreign Key validation
            if (col.isForeignKey && col.foreignTable) {
              const refId = String(val).trim();
              let exists = false;

              if (col.foreignTable === 'pens') {
                exists = filePenIds.has(refId) || context.existingPenIds.has(refId);
              } else if (col.foreignTable === 'batches') {
                exists = fileBatchIds.has(refId) || context.existingBatchIds.has(refId);
              } else if (col.foreignTable === 'feed_items') {
                exists = fileFeedItemIds.has(refId) || context.existingFeedItemIds.has(refId);
              } else if (col.foreignTable === 'sales_units') {
                exists = fileSalesUnitIds.has(refId) || context.existingSalesUnitIds.has(refId);
              } else if (col.foreignTable === 'care_plans') {
                exists = fileCarePlanIds.has(refId) || context.existingCarePlanIds.has(refId);
              }

              if (!exists) {
                errors.push({
                  table: tableDef.tableName,
                  rowNumber: rowNum,
                  recordId: rowId,
                  column: col.name,
                  value: refId,
                  reason: `Foreign key reference "${refId}" was not found in table "${col.foreignTable}".`,
                  suggestedCorrection: `Ensure record "${refId}" is declared in "${col.foreignTable}" before referencing it.`,
                  severity: 'error',
                });
                rowHasError = true;
              }
            }
          }
        }

        // Table-specific Business Rules
        if (tableDef.tableName === 'batches') {
          const initCount = Number(row['initial_count']);
          const maleCount = Number(row['male_count'] ?? 0);
          const femaleCount = Number(row['female_count'] ?? 0);

          if (initCount < 1) {
            errors.push({
              table: 'batches',
              rowNumber: rowNum,
              recordId: rowId,
              column: 'initial_count',
              value: String(row['initial_count']),
              reason: 'Initial bird count must be at least 1.',
              suggestedCorrection: 'Set initial_count >= 1.',
              severity: 'error',
            });
            rowHasError = true;
          }

          if (maleCount + femaleCount > initCount) {
            errors.push({
              table: 'batches',
              rowNumber: rowNum,
              recordId: rowId,
              column: 'male_count',
              value: `${maleCount} males + ${femaleCount} females`,
              reason: `Sum of male (${maleCount}) and female (${femaleCount}) counts cannot exceed initial count (${initCount}).`,
              suggestedCorrection: 'Adjust male and female breakdown to fit within initial count.',
              severity: 'error',
            });
            rowHasError = true;
          }

          const batchCode = row['batch_code'] ? String(row['batch_code']).trim().toUpperCase() : '';
          if (batchCode && context.existingBatchCodes.has(batchCode)) {
            errors.push({
              table: 'batches',
              rowNumber: rowNum,
              recordId: rowId,
              column: 'batch_code',
              value: batchCode,
              reason: `Batch code "${batchCode}" is already in use by an existing flock in this farm.`,
              suggestedCorrection: 'Batch codes must be unique per farm.',
              severity: 'warning',
            });
          }
        }

        if (tableDef.tableName === 'egg_production') {
          const crates = Number(row['crates'] ?? 0);
          const pieces = Number(row['pieces'] ?? 0);
          const intact = Number(row['intact_eggs'] ?? 0);
          const cracked = Number(row['cracked_eggs'] ?? 0);
          const damaged = Number(row['damaged_eggs'] ?? 0);
          const total = Number(row['total_eggs'] ?? 0);

          if (pieces >= 30) {
            errors.push({
              table: 'egg_production',
              rowNumber: rowNum,
              recordId: rowId,
              column: 'pieces',
              value: String(pieces),
              reason: `Loose pieces should be less than 30 (found ${pieces}). 30 pieces equals 1 crate.`,
              suggestedCorrection: `Convert ${pieces} pieces to crates and remaining loose eggs.`,
              severity: 'warning',
            });
          }

          const computedIntact = crates * 30 + pieces;
          if (intact > 0 && Math.abs(intact - computedIntact) > 0) {
            errors.push({
              table: 'egg_production',
              rowNumber: rowNum,
              recordId: rowId,
              column: 'intact_eggs',
              value: String(intact),
              reason: `Mismatch: intact_eggs (${intact}) does not match crates*30 + pieces (${computedIntact}).`,
              suggestedCorrection: 'Intact eggs should equal crates * 30 + pieces.',
              severity: 'warning',
            });
          }

          const computedTotal = (intact || computedIntact) + cracked + damaged;
          if (total > 0 && Math.abs(total - computedTotal) > 0) {
            errors.push({
              table: 'egg_production',
              rowNumber: rowNum,
              recordId: rowId,
              column: 'total_eggs',
              value: String(total),
              reason: `Grand total (${total}) does not match intact + cracked + damaged (${computedTotal}).`,
              suggestedCorrection: 'Ensure total_eggs equals intact + cracked + damaged.',
              severity: 'warning',
            });
          }
        }

        if (rowHasError) {
          tableErrors++;
        }
      }

      totalRecordsCount += rows.length;
      const validRecordsInTable = rows.length - tableErrors;

      tableSummaries.push({
        tableName: tableDef.tableName,
        displayName: tableDef.displayName,
        totalRecords: rows.length,
        validRecords: Math.max(0, validRecordsInTable),
        errorRecords: tableErrors,
        warningRecords: tableWarnings,
        duplicateRecords: tableDuplicates,
      });
    }

    const totalErrors = errors.filter((e) => e.severity === 'error').length;
    const totalWarnings = errors.filter((e) => e.severity === 'warning').length;
    const overallValidRecords = totalRecordsCount - totalErrors;
    const canProceed = totalErrors === 0 && totalRecordsCount > 0;

    return {
      isValid: totalErrors === 0,
      canProceedWithImport: canProceed,
      totalTablesDetected: existingTableNames.size,
      totalRecords: totalRecordsCount,
      validRecords: Math.max(0, overallValidRecords),
      errorRecords: totalErrors,
      warningRecords: totalWarnings,
      duplicateRecords: duplicateRecordsCount,
      tableSummaries,
      errors,
      metadata,
      parsedData,
    };
  } finally {
    db.close();
  }
}

/**
 * Generate a CSV report of validation errors and warnings.
 */
export function generateValidationCsvReport(report: ValidationReport): string {
  const lines: string[] = [];
  lines.push('Severity,Table,Row,Record ID,Column,Value,Reason,Suggested Correction');

  for (const err of report.errors) {
    const esc = (s?: string) => `"${(s || '').replace(/"/g, '""')}"`;
    lines.push(
      [
        err.severity.toUpperCase(),
        esc(err.table),
        err.rowNumber,
        esc(err.recordId),
        esc(err.column),
        esc(err.value),
        esc(err.reason),
        esc(err.suggestedCorrection),
      ].join(',')
    );
  }

  return lines.join('\n');
}
