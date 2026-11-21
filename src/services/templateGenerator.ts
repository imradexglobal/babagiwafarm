/**
 * Database template and documentation ZIP package generator.
 */

import JSZip from 'jszip';
import { getSqlInstance } from './sqliteEngine.ts';
import {
  APPLICATION_NAME,
  generateReadmeDocumentation,
  generateSchemaSql,
  generateTableDocumentation,
  SCHEMA_VERSION,
  TABLE_DEFINITIONS,
  TEMPLATE_VERSION,
} from './importExportSchema.ts';

export interface TemplatePackageResult {
  dbBytes: Uint8Array;
  zipBytes: Uint8Array;
  tableDocMap: Record<string, string>;
  readmeText: string;
}

/**
 * Builds the blank SQLite template database.
 */
export async function createTemplateDatabase(): Promise<Uint8Array> {
  const SQL = await getSqlInstance();
  const db = new SQL.Database();

  try {
    // Execute DDL
    const ddl = generateSchemaSql();
    db.run(ddl);

    // Insert metadata
    const now = new Date().toISOString();
    const metadataEntries = [
      ['template_name', 'Babagiwa Farm Data Template'],
      ['template_version', TEMPLATE_VERSION],
      ['schema_version', SCHEMA_VERSION],
      ['application_name', APPLICATION_NAME],
      ['generation_date', now],
      ['supported_import_version', '1.x'],
      ['export_type', 'template'],
    ];

    for (const [key, val] of metadataEntries) {
      db.run('INSERT INTO _template_metadata (key, value) VALUES (?, ?);', [key, val]);
    }

    const binary = db.export();
    return binary;
  } finally {
    db.close();
  }
}

/**
 * Creates the complete ZIP package with Farm_Data_Template.db and Documentation/ folder.
 */
export async function createTemplateZipPackage(): Promise<TemplatePackageResult> {
  const dbBytes = await createTemplateDatabase();
  const zip = new JSZip();

  // Root database file
  zip.file('Farm_Data_Template.db', dbBytes);

  // Documentation folder
  const docFolder = zip.folder('Documentation');
  const readmeText = generateReadmeDocumentation();
  docFolder?.file('README.txt', readmeText);

  const tableDocMap: Record<string, string> = {};
  for (const table of TABLE_DEFINITIONS) {
    const docText = generateTableDocumentation(table);
    tableDocMap[table.tableName] = docText;
    docFolder?.file(`${table.tableName}.txt`, docText);
  }

  const zipBytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return {
    dbBytes,
    zipBytes,
    tableDocMap,
    readmeText,
  };
}

/**
 * Trigger browser file download from Uint8Array.
 */
export function triggerFileDownload(bytes: Uint8Array, fileName: string, mimeType = 'application/octet-stream'): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 500);
}
