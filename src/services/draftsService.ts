import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { generateId } from '../domain/calculations.ts';
import { db, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import type { DraftType, RecordDraft } from '../types/farm.ts';

export async function saveRecordDraft(params: {
  farmId: string;
  existingDraftId?: string | null;
  draftType: DraftType;
  title: string;
  transactionDate: string;
  batchId: string;
  payload: Record<string, unknown>;
  actorUid: string;
  actorName: string;
}): Promise<string> {
  const title = params.title.trim().slice(0, 160) || 'Untitled Draft';
  const cleanDate = /^\d{4}-\d{2}-\d{2}$/.test(params.transactionDate)
    ? params.transactionDate
    : '';
  const cleanBatchId = params.batchId.trim().slice(0, 128);

  if (params.existingDraftId) {
    const ref = doc(db, 'farms', params.farmId, 'drafts', params.existingDraftId);
    try {
      await updateDoc(ref, {
        title,
        transactionDate: cleanDate,
        batchId: cleanBatchId,
        payload: params.payload,
        updatedBy: params.actorUid,
        updatedAt: serverTimestamp(),
      });
      return params.existingDraftId;
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.UPDATE,
        `farms/${params.farmId}/drafts/${params.existingDraftId}`
      );
    }
  }

  const id = generateId('drf');
  const ref = doc(db, 'farms', params.farmId, 'drafts', id);
  try {
    await setDoc(ref, {
      id,
      farmId: params.farmId,
      draftType: params.draftType,
      title,
      transactionDate: cleanDate,
      batchId: cleanBatchId,
      payload: params.payload,
      createdBy: params.actorUid,
      createdByName: params.actorName.slice(0, 150),
      updatedBy: params.actorUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `farms/${params.farmId}/drafts/${id}`);
  }
}

export async function deleteRecordDraft(params: {
  farmId: string;
  draftId: string;
}): Promise<void> {
  const ref = doc(db, 'farms', params.farmId, 'drafts', params.draftId);
  try {
    await deleteDoc(ref);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `farms/${params.farmId}/drafts/${params.draftId}`);
  }
}

export function subscribeRecordDrafts(
  farmId: string,
  onData: (drafts: RecordDraft[]) => void,
  onError: (err: Error) => void,
  maxRecords: number = 100
) {
  const path = `farms/${farmId}/drafts`;
  const q = query(
    collection(db, 'farms', farmId, 'drafts'),
    orderBy('updatedAt', 'desc'),
    limit(maxRecords)
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as RecordDraft)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}
