# Controlled Production Approval — Architecture Review and Implementation Plan

## Current architecture reviewed

- React/Vite client with Firestore as the authoritative data store.
- Production is currently a flat `farms/{farmId}/eggProduction/{entryId}` collection. Each entry has `isVoided`, but no approval status, parent record, approver, or approval timestamp.
- Production writes are in `src/services/productionService.ts`; both `ProductionView` and `DailyProductionView` call the same service.
- Operational consumers include dashboard totals, batch metrics/financial summaries, reports/date-range analytics, daily trends, and the egg-store transfer workflow.
- Firestore rules are default-deny with strict field validators, but production currently permits ordinary writes/updates based on CRUD permissions and does not distinguish approval authority.
- Owner checks already exist in the client and rules, but the production permission matrix has no dedicated approval capability.
- Egg-store transfers currently accept any non-voided production entry, so pending records would otherwise become stock-eligible.

## Implementation design

1. Add a deterministic parent document at `farms/{farmId}/productionRecords/{parentId}`, where `parentId` is derived from batch ID and production date. This gives one database address per batch/date and makes duplicate parents impossible for normal writes.
2. Keep child records in the existing `eggProduction` collection for compatibility with existing reports and inventory references. Add `parentId`, `status`, `approvedBy`, `approvedByName`, `approvedAt`, and `approvalAuditId` to every child.
3. New records are created in one Firestore transaction: create-if-missing parent, then append a child with `PENDING`; never auto-approve.
4. Approval is a Firestore transaction that re-reads the parent and all children, verifies `production.approve` (exposed as the dedicated `can_approve_production` capability), verifies all eligible children are valid and pending, then atomically marks parent and children `APPROVED` and appends an immutable audit event.
5. Pending child edits/voids remain permission-controlled. Approved child edits/voids are rejected in the service and rules. Parent approval is the locking point. Parent voiding is atomic for pending children.
6. Owner role continues to bypass permission checks. Staff approval requires the dedicated approval capability and does not grant unrelated permissions.
7. Operational consumers filter `status === 'APPROVED'` (legacy records without a status are treated as historical approved records in the client while migration is pending). Egg-store transfers also re-read and require `APPROVED` in the transaction.
8. Migration is conservative: do not mass-change existing historical values. Existing children without status remain historical/operationally approved for compatibility, while a migration report identifies them. New parent records are created only for new writes and explicit migration tooling; consumed historical records remain immutable by existing downstream rules.

## Affected modules

- `src/types/farm.ts`, `src/domain/calculations.ts`: status/approval metadata and permission capability.
- `src/services/productionService.ts`: transactional parent-child creation, guarded edit/void, parent approval.
- `src/services/eggStoreService.ts`: approved-only production transfer.
- `src/components/ProductionView.tsx`, `src/components/DailyProductionView.tsx`, `src/components/EggStoreView.tsx`: status display, approval action, approved-only eligibility, locked actions.
- `src/components/DashboardView.tsx`, `BatchesView.tsx`, `ReportsView.tsx`, `DailyTrendsCharts.tsx`, `useDateRangeAnalytics.ts`: approved-only operational filtering.
- `firestore.rules`: dedicated approval permission, parent/child validators, pending-only edits/voids, atomic approval and immutable approved records.
- `tests/domain.test.ts`: approved-only calculation and owner/approval permission coverage.

## Migration/reconciliation report approach

Historical rows are preserved exactly. Rows missing the new status are classified as `LEGACY_HISTORICAL_APPROVED` for operational compatibility; rows already voided remain excluded. No historical record is silently made editable or re-approved. A later farm-approved migration can create parent snapshots and attach legacy children in batches, with counts and exceptions recorded separately.
