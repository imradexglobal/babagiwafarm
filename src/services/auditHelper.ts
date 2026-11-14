import { collection, doc, serverTimestamp } from 'firebase/firestore';
import { generateId } from '../domain/calculations.ts';
import { db } from '../lib/firebase.ts';
import type { AuditAction } from '../types/farm.ts';

export function buildAuditLogEntry(params: {
  farmId: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  summary: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  actorUid: string;
  actorName: string;
}) {
  const id = generateId('aud');
  const ref = doc(collection(db, 'farms', params.farmId, 'auditLogs'), id);
  const data = {
    id,
    farmId: params.farmId,
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    summary: params.summary.slice(0, 300),
    before: params.before ?? {},
    after: params.after ?? {},
    actorUid: params.actorUid,
    actorName: params.actorName.slice(0, 150),
    createdAt: serverTimestamp(),
  };
  return { ref, data };
}
