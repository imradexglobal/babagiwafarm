import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { calculateBirdAgeDays, generateId } from '../domain/calculations.ts';
import { db, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import type {
  EnvironmentMetricLog,
  MedicationLog,
  MedicationTreatmentType,
  PoultryBatch,
  TimeOfDay,
} from '../types/farm.ts';
import { buildAuditLogEntry } from './auditHelper.ts';

const VALID_TIMES_OF_DAY: readonly TimeOfDay[] = ['morning', 'afternoon', 'night'];
const VALID_TREATMENT_TYPES: readonly MedicationTreatmentType[] = [
  'medication',
  'vaccination',
  'vitamin',
  'deworming',
  'other',
];

export const MEDICATION_TREATMENT_OPTIONS: {
  value: MedicationTreatmentType;
  label: string;
}[] = [
  { value: 'medication', label: 'Medication / Antibiotic' },
  { value: 'vaccination', label: 'Vaccination' },
  { value: 'vitamin', label: 'Vitamins / Electrolytes' },
  { value: 'deworming', label: 'Deworming' },
  { value: 'other', label: 'Other Treatment' },
];

export const ADMINISTRATION_ROUTES = [
  'Drinking Water',
  'Feed Mix',
  'Injection (IM / SC)',
  'Eye Drop',
  'Spray / Mist',
  'Oral Drench',
  'Topical / Other',
] as const;

export async function createMedicationLog(params: {
  farmId: string;
  transactionDate: string;
  timeOfDay: TimeOfDay;
  transactionTime: string;
  batch: PoultryBatch;
  medicationName: string;
  treatmentType: MedicationTreatmentType;
  dosage: string;
  administrationRoute: string;
  remarks: string;
  actorUid: string;
  actorName: string;
}): Promise<string> {
  if (params.batch.status !== 'active') {
    throw new Error(
      `Batch "${params.batch.batchCode}" is inactive and cannot accept new medication logs.`
    );
  }
  if (!VALID_TIMES_OF_DAY.includes(params.timeOfDay)) {
    throw new Error('Time of day must be Morning, Afternoon, or Night.');
  }
  if (!VALID_TREATMENT_TYPES.includes(params.treatmentType)) {
    throw new Error('Invalid treatment type.');
  }
  const medicationName = params.medicationName.trim().slice(0, 120);
  const dosage = params.dosage.trim().slice(0, 80);
  const administrationRoute = params.administrationRoute.trim().slice(0, 60);
  if (!medicationName) throw new Error('Medication or vaccine name is required.');
  if (!dosage) throw new Error('Dosage is required.');
  if (!administrationRoute) throw new Error('Administration route is required.');

  const birdAgeDaysAtTransaction = calculateBirdAgeDays({
    hatchDate: params.batch.hatchDate,
    placementDate: params.batch.placementDate,
    ageAtPlacementDays: params.batch.ageAtPlacementDays,
    transactionDate: params.transactionDate,
  });

  const id = generateId('med');
  const batchWrite = writeBatch(db);
  batchWrite.set(doc(db, 'farms', params.farmId, 'medicationLogs', id), {
    id,
    farmId: params.farmId,
    transactionDate: params.transactionDate,
    timeOfDay: params.timeOfDay,
    transactionTime: params.transactionTime.trim().slice(0, 5),
    batchId: params.batch.id,
    batchCodeSnapshot: params.batch.batchCode,
    penId: params.batch.penId,
    penNameSnapshot: params.batch.penNameSnapshot,
    birdAgeDaysAtTransaction,
    medicationName,
    treatmentType: params.treatmentType,
    dosage,
    administrationRoute,
    remarks: params.remarks.trim().slice(0, 500),
    isVoided: false,
    voidReason: '',
    voidedBy: '',
    createdBy: params.actorUid,
    createdByName: params.actorName.slice(0, 150),
    updatedBy: params.actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'medicationLogs',
    entityId: id,
    action: 'create',
    summary: `Recorded ${params.treatmentType}: ${medicationName} (${dosage}) for ${params.batch.batchCode} on ${params.transactionDate}`,
    after: {
      transactionDate: params.transactionDate,
      timeOfDay: params.timeOfDay,
      batchCode: params.batch.batchCode,
      medicationName,
      treatmentType: params.treatmentType,
      dosage,
      administrationRoute,
    },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batchWrite.set(audit.ref, audit.data);

  try {
    await batchWrite.commit();
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `farms/${params.farmId}/medicationLogs/${id}`);
  }
}

export async function updateMedicationLog(params: {
  farmId: string;
  entry: MedicationLog;
  batch: PoultryBatch;
  transactionDate: string;
  timeOfDay: TimeOfDay;
  transactionTime: string;
  medicationName: string;
  treatmentType: MedicationTreatmentType;
  dosage: string;
  administrationRoute: string;
  remarks: string;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  if (params.entry.isVoided) throw new Error('Voided medication logs cannot be edited.');
  if (!VALID_TIMES_OF_DAY.includes(params.timeOfDay)) {
    throw new Error('Time of day must be Morning, Afternoon, or Night.');
  }
  if (!VALID_TREATMENT_TYPES.includes(params.treatmentType)) {
    throw new Error('Invalid treatment type.');
  }
  const medicationName = params.medicationName.trim().slice(0, 120);
  const dosage = params.dosage.trim().slice(0, 80);
  const administrationRoute = params.administrationRoute.trim().slice(0, 60);
  if (!medicationName) throw new Error('Medication or vaccine name is required.');
  if (!dosage) throw new Error('Dosage is required.');
  if (!administrationRoute) throw new Error('Administration route is required.');

  const birdAgeDaysAtTransaction = calculateBirdAgeDays({
    hatchDate: params.batch.hatchDate,
    placementDate: params.batch.placementDate,
    ageAtPlacementDays: params.batch.ageAtPlacementDays,
    transactionDate: params.transactionDate,
  });

  const batchWrite = writeBatch(db);
  const updates = {
    transactionDate: params.transactionDate,
    timeOfDay: params.timeOfDay,
    transactionTime: params.transactionTime.trim().slice(0, 5),
    batchId: params.batch.id,
    batchCodeSnapshot: params.batch.batchCode,
    penId: params.batch.penId,
    penNameSnapshot: params.batch.penNameSnapshot,
    birdAgeDaysAtTransaction,
    medicationName,
    treatmentType: params.treatmentType,
    dosage,
    administrationRoute,
    remarks: params.remarks.trim().slice(0, 500),
    updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
  };

  batchWrite.update(doc(db, 'farms', params.farmId, 'medicationLogs', params.entry.id), updates);

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'medicationLogs',
    entityId: params.entry.id,
    action: 'update',
    summary: `Updated medication log (${medicationName}) for ${params.batch.batchCode} on ${params.transactionDate}`,
    before: {
      medicationName: params.entry.medicationName,
      treatmentType: params.entry.treatmentType,
      dosage: params.entry.dosage,
      administrationRoute: params.entry.administrationRoute,
    },
    after: {
      medicationName,
      treatmentType: params.treatmentType,
      dosage,
      administrationRoute,
    },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batchWrite.set(audit.ref, audit.data);

  try {
    await batchWrite.commit();
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `farms/${params.farmId}/medicationLogs/${params.entry.id}`
    );
  }
}

export async function voidMedicationLog(params: {
  farmId: string;
  entry: MedicationLog;
  voidReason: string;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const reason = params.voidReason.trim();
  if (!reason) throw new Error('Void reason is required.');
  if (params.entry.isVoided) throw new Error('Medication log is already voided.');

  const batchWrite = writeBatch(db);
  batchWrite.update(doc(db, 'farms', params.farmId, 'medicationLogs', params.entry.id), {
    isVoided: true,
    voidReason: reason.slice(0, 300),
    voidedBy: params.actorUid,
    updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
  });

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'medicationLogs',
    entityId: params.entry.id,
    action: 'void',
    summary: `Voided medication log (${params.entry.medicationName} on ${params.entry.transactionDate}): ${reason}`,
    before: { isVoided: false, medicationName: params.entry.medicationName },
    after: { isVoided: true, voidReason: reason },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batchWrite.set(audit.ref, audit.data);

  try {
    await batchWrite.commit();
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `farms/${params.farmId}/medicationLogs/${params.entry.id}`
    );
  }
}

export function subscribeMedicationLogs(
  farmId: string,
  onData: (entries: MedicationLog[]) => void,
  onError: (err: Error) => void,
  maxRecords: number = 500
) {
  const path = `farms/${farmId}/medicationLogs`;
  const q = query(
    collection(db, 'farms', farmId, 'medicationLogs'),
    orderBy('transactionDate', 'desc'),
    limit(maxRecords)
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as MedicationLog)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

export async function fetchMedicationLogsByDateRange(
  farmId: string,
  startDate: string,
  endDate: string
): Promise<MedicationLog[]> {
  const path = `farms/${farmId}/medicationLogs`;
  const q = query(
    collection(db, 'farms', farmId, 'medicationLogs'),
    where('transactionDate', '>=', startDate),
    where('transactionDate', '<=', endDate),
    orderBy('transactionDate', 'desc')
  );
  try {
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as MedicationLog);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export function subscribeMedicationLogsByDateRange(
  farmId: string,
  startDate: string,
  endDate: string,
  onData: (entries: MedicationLog[]) => void,
  onError: (err: Error) => void
) {
  const path = `farms/${farmId}/medicationLogs`;
  const q = query(
    collection(db, 'farms', farmId, 'medicationLogs'),
    where('transactionDate', '>=', startDate),
    where('transactionDate', '<=', endDate),
    orderBy('transactionDate', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as MedicationLog)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Environment & Weight Metric Logs (Weight, Temperature, Humidity)
// ---------------------------------------------------------------------------

function normalizeEnvironmentMetrics(params: {
  averageWeightGrams: number | null;
  sampleSize: number;
  temperatureC: number | null;
  humidityPct: number | null;
}) {
  const w = params.averageWeightGrams;
  const t = params.temperatureC;
  const h = params.humidityPct;

  if (w !== null && (!Number.isFinite(w) || w <= 0 || w > 20000)) {
    throw new Error('Average bird weight must be between 1g and 20,000g.');
  }
  if (!Number.isInteger(params.sampleSize) || params.sampleSize < 0 || params.sampleSize > 10000) {
    throw new Error('Weighed sample size must be a whole number between 0 and 10,000.');
  }
  if (t !== null && (!Number.isFinite(t) || t < -10 || t > 70)) {
    throw new Error('Temperature must be between -10°C and 70°C.');
  }
  if (h !== null && (!Number.isFinite(h) || h < 0 || h > 100)) {
    throw new Error('Relative humidity must be between 0% and 100%.');
  }
  if (w === null && t === null && h === null) {
    throw new Error(
      'Enter at least one metric: average bird weight (g), temperature (°C), or humidity (%).'
    );
  }
  return {
    averageWeightGrams: w !== null ? Math.round(w * 100) / 100 : null,
    sampleSize: w !== null ? params.sampleSize : 0,
    temperatureC: t !== null ? Math.round(t * 100) / 100 : null,
    humidityPct: h !== null ? Math.round(h * 100) / 100 : null,
  };
}

export async function createEnvironmentLog(params: {
  farmId: string;
  transactionDate: string;
  timeOfDay: TimeOfDay;
  transactionTime: string;
  batch: PoultryBatch;
  averageWeightGrams: number | null;
  sampleSize: number;
  temperatureC: number | null;
  humidityPct: number | null;
  remarks: string;
  actorUid: string;
  actorName: string;
}): Promise<string> {
  if (params.batch.status !== 'active') {
    throw new Error(
      `Batch "${params.batch.batchCode}" is inactive and cannot accept new environment/weight logs.`
    );
  }
  if (!VALID_TIMES_OF_DAY.includes(params.timeOfDay)) {
    throw new Error('Time of day must be Morning, Afternoon, or Night.');
  }

  const normalized = normalizeEnvironmentMetrics({
    averageWeightGrams: params.averageWeightGrams,
    sampleSize: params.sampleSize,
    temperatureC: params.temperatureC,
    humidityPct: params.humidityPct,
  });

  const birdAgeDaysAtTransaction = calculateBirdAgeDays({
    hatchDate: params.batch.hatchDate,
    placementDate: params.batch.placementDate,
    ageAtPlacementDays: params.batch.ageAtPlacementDays,
    transactionDate: params.transactionDate,
  });

  const id = generateId('env');
  const batchWrite = writeBatch(db);
  batchWrite.set(doc(db, 'farms', params.farmId, 'environmentLogs', id), {
    id,
    farmId: params.farmId,
    transactionDate: params.transactionDate,
    timeOfDay: params.timeOfDay,
    transactionTime: params.transactionTime.trim().slice(0, 5),
    batchId: params.batch.id,
    batchCodeSnapshot: params.batch.batchCode,
    penId: params.batch.penId,
    penNameSnapshot: params.batch.penNameSnapshot,
    birdAgeDaysAtTransaction,
    averageWeightGrams: normalized.averageWeightGrams,
    sampleSize: normalized.sampleSize,
    temperatureC: normalized.temperatureC,
    humidityPct: normalized.humidityPct,
    remarks: params.remarks.trim().slice(0, 500),
    isVoided: false,
    voidReason: '',
    voidedBy: '',
    createdBy: params.actorUid,
    createdByName: params.actorName.slice(0, 150),
    updatedBy: params.actorUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const parts: string[] = [];
  if (normalized.averageWeightGrams !== null) parts.push(`${normalized.averageWeightGrams}g avg wt`);
  if (normalized.temperatureC !== null) parts.push(`${normalized.temperatureC}°C`);
  if (normalized.humidityPct !== null) parts.push(`${normalized.humidityPct}% RH`);

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'environmentLogs',
    entityId: id,
    action: 'create',
    summary: `Recorded weight/environment (${parts.join(', ')}) for ${params.batch.batchCode} on ${params.transactionDate}`,
    after: {
      transactionDate: params.transactionDate,
      timeOfDay: params.timeOfDay,
      batchCode: params.batch.batchCode,
      ...normalized,
    },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batchWrite.set(audit.ref, audit.data);

  try {
    await batchWrite.commit();
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `farms/${params.farmId}/environmentLogs/${id}`);
  }
}

export async function updateEnvironmentLog(params: {
  farmId: string;
  entry: EnvironmentMetricLog;
  batch: PoultryBatch;
  transactionDate: string;
  timeOfDay: TimeOfDay;
  transactionTime: string;
  averageWeightGrams: number | null;
  sampleSize: number;
  temperatureC: number | null;
  humidityPct: number | null;
  remarks: string;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  if (params.entry.isVoided) throw new Error('Voided weight/environment logs cannot be edited.');
  if (!VALID_TIMES_OF_DAY.includes(params.timeOfDay)) {
    throw new Error('Time of day must be Morning, Afternoon, or Night.');
  }

  const normalized = normalizeEnvironmentMetrics({
    averageWeightGrams: params.averageWeightGrams,
    sampleSize: params.sampleSize,
    temperatureC: params.temperatureC,
    humidityPct: params.humidityPct,
  });

  const birdAgeDaysAtTransaction = calculateBirdAgeDays({
    hatchDate: params.batch.hatchDate,
    placementDate: params.batch.placementDate,
    ageAtPlacementDays: params.batch.ageAtPlacementDays,
    transactionDate: params.transactionDate,
  });

  const batchWrite = writeBatch(db);
  const updates = {
    transactionDate: params.transactionDate,
    timeOfDay: params.timeOfDay,
    transactionTime: params.transactionTime.trim().slice(0, 5),
    batchId: params.batch.id,
    batchCodeSnapshot: params.batch.batchCode,
    penId: params.batch.penId,
    penNameSnapshot: params.batch.penNameSnapshot,
    birdAgeDaysAtTransaction,
    averageWeightGrams: normalized.averageWeightGrams,
    sampleSize: normalized.sampleSize,
    temperatureC: normalized.temperatureC,
    humidityPct: normalized.humidityPct,
    remarks: params.remarks.trim().slice(0, 500),
    updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
  };

  batchWrite.update(doc(db, 'farms', params.farmId, 'environmentLogs', params.entry.id), updates);

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'environmentLogs',
    entityId: params.entry.id,
    action: 'update',
    summary: `Updated weight/environment log for ${params.batch.batchCode} on ${params.transactionDate}`,
    before: {
      averageWeightGrams: params.entry.averageWeightGrams,
      temperatureC: params.entry.temperatureC,
      humidityPct: params.entry.humidityPct,
    },
    after: {
      averageWeightGrams: normalized.averageWeightGrams,
      temperatureC: normalized.temperatureC,
      humidityPct: normalized.humidityPct,
    },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batchWrite.set(audit.ref, audit.data);

  try {
    await batchWrite.commit();
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `farms/${params.farmId}/environmentLogs/${params.entry.id}`
    );
  }
}

export async function voidEnvironmentLog(params: {
  farmId: string;
  entry: EnvironmentMetricLog;
  voidReason: string;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const reason = params.voidReason.trim();
  if (!reason) throw new Error('Void reason is required.');
  if (params.entry.isVoided) throw new Error('Weight/environment log is already voided.');

  const batchWrite = writeBatch(db);
  batchWrite.update(doc(db, 'farms', params.farmId, 'environmentLogs', params.entry.id), {
    isVoided: true,
    voidReason: reason.slice(0, 300),
    voidedBy: params.actorUid,
    updatedBy: params.actorUid,
    updatedAt: serverTimestamp(),
  });

  const audit = buildAuditLogEntry({
    farmId: params.farmId,
    entityType: 'environmentLogs',
    entityId: params.entry.id,
    action: 'void',
    summary: `Voided weight/environment log (${params.entry.batchCodeSnapshot} on ${params.entry.transactionDate}): ${reason}`,
    before: { isVoided: false },
    after: { isVoided: true, voidReason: reason },
    actorUid: params.actorUid,
    actorName: params.actorName,
  });
  batchWrite.set(audit.ref, audit.data);

  try {
    await batchWrite.commit();
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `farms/${params.farmId}/environmentLogs/${params.entry.id}`
    );
  }
}

export function subscribeEnvironmentLogs(
  farmId: string,
  onData: (entries: EnvironmentMetricLog[]) => void,
  onError: (err: Error) => void,
  maxRecords: number = 500
) {
  const path = `farms/${farmId}/environmentLogs`;
  const q = query(
    collection(db, 'farms', farmId, 'environmentLogs'),
    orderBy('transactionDate', 'desc'),
    limit(maxRecords)
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as EnvironmentMetricLog)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}

export async function fetchEnvironmentLogsByDateRange(
  farmId: string,
  startDate: string,
  endDate: string
): Promise<EnvironmentMetricLog[]> {
  const path = `farms/${farmId}/environmentLogs`;
  const q = query(
    collection(db, 'farms', farmId, 'environmentLogs'),
    where('transactionDate', '>=', startDate),
    where('transactionDate', '<=', endDate),
    orderBy('transactionDate', 'desc')
  );
  try {
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as EnvironmentMetricLog);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export function subscribeEnvironmentLogsByDateRange(
  farmId: string,
  startDate: string,
  endDate: string,
  onData: (entries: EnvironmentMetricLog[]) => void,
  onError: (err: Error) => void
) {
  const path = `farms/${farmId}/environmentLogs`;
  const q = query(
    collection(db, 'farms', farmId, 'environmentLogs'),
    where('transactionDate', '>=', startDate),
    where('transactionDate', '<=', endDate),
    orderBy('transactionDate', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as EnvironmentMetricLog)),
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        onError(e as Error);
      }
    }
  );
}
