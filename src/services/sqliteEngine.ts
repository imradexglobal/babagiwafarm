// src/services/sqliteEngine.ts
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import initSqlJs from 'sql.js/dist/sql-asm.js';

let sqlPromise: Promise<any> | null = null;

export async function getSqlInstance(): Promise<any> {
  if (!sqlPromise) {
    sqlPromise = (initSqlJs as any)();
  }
  return sqlPromise;
}

export function isSqliteFile(buffer: Uint8Array | ArrayBuffer): boolean {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 16) return false;
  // SQLite header is "SQLite format 3\0"
  const expected = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00];
  for (let i = 0; i < 16; i++) {
    if (bytes[i] !== expected[i]) return false;
  }
  return true;
}
