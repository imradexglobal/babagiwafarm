# Babagiwa Farm Management System — Security Specification (Phase 0)

## 1. Core Data Invariants
1. **Default Deny & Verified Identity**: All Firestore paths default to deny (`allow read, write: if false`). Every authenticated operation requires `request.auth != null` and `request.auth.token.email_verified == true`.
2. **One-Farm-Per-Account & Atomic Farm Creation**: `/users/{uid}` is immutable with respect to `farmId` and `role`, and cannot be listed (`allow list: if false`). Creating a new farm owner requires creating `/users/{uid}`, `/farms/{farmId}`, and `/farms/{farmId}/members/{uid}` atomically (`getAfter` / `existsAfter`).
3. **Tenant Isolation**: A user can only read or write documents inside `/farms/{farmId}/...` if `/farms/{farmId}/members/{request.auth.uid}` exists and has `status == 'active'`. Farm A members cannot read or write Farm B records even if guessing document IDs.
4. **No Self-Escalation**: A staff member cannot modify their own `role`, `status`, or `permissions`, nor promote anyone to `owner`.
5. **Granular Capability Enforcement**: `batches`, `production`, `feed`, `sales`, `reports`, `settings`, and `members` each enforce separate `read`, `create`, `edit`, and `delete` (void) checks. Member managers may remove staff membership and account bindings; operational records use void/deactivation so history is retained. `jobTitle` is descriptive only and grants zero authority.
6. **Active Batch & Pen Integrity**: `eggProduction` and `feedConsumption` cannot be created for an inactive or non-existent batch.
7. **Authoritative Feed Stock & Non-Negative Balance**: `feedStock/{feedItemId}.balanceGrams` is strictly `>= 0`.
8. **Sales Price Override Gate**: `eggSales.priceOverridden == true` or `unitPriceNgn != suggestedUnitPriceNgn` is rejected unless the member has `permissions.sales.overridePrice == true` (or is `owner`).
9. **Immutable Audit Trail**: `auditLogs` are append-only (`update` and `delete` always denied).

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Read**: Read `/farms/farm_a/eggProduction/entry_1` without `request.auth` -> `PERMISSION_DENIED`.
2. **Unverified Email Write**: Authenticated user with `email_verified: false` attempts to create `/farms/farm_a` -> `PERMISSION_DENIED`.
3. **Cross-Tenant Read/Write**: Active member of `farm_a` attempts to read or write `/farms/farm_b/batches/b1` -> `PERMISSION_DENIED`.
4. **Self-Assigned Owner on Existing Farm**: Non-member creates `/farms/farm_a/members/{theirUid}` with `role: 'owner'` -> `PERMISSION_DENIED`.
5. **Privilege Escalation**: Staff member updates `/farms/farm_a/members/{theirUid}` to set `permissions.sales.overridePrice = true` or `role = 'owner'` -> `PERMISSION_DENIED`.
6. **Second-Farm Hijack**: User already bound in `/users/{uid}` to `farm_a` attempts to overwrite `/users/{uid}` with `farmId: 'farm_b'` -> `PERMISSION_DENIED`.
7. **Shadow Ghost Field Injection**: Member with `production.create` sends `eggProduction` document containing an undeclared key `isVerified: true` -> `PERMISSION_DENIED`.
8. **ID Poisoning**: Client submits a 300-character or slash-containing `entryId` -> `PERMISSION_DENIED`.
9. **Spoofed Creator / Backdated Timestamp**: Client submits `createdBy: 'other_uid'` or `createdAt: <past client timestamp>` instead of `request.time` -> `PERMISSION_DENIED`.
10. **Negative Feed Stock**: Client attempts to update `/farms/farm_a/feedStock/f1` with `balanceGrams: -500` -> `PERMISSION_DENIED`.
11. **Unauthorized Price Override**: Staff member with `sales.create: true` and `sales.overridePrice: false` submits `eggSales` with `priceOverridden: true` or `unitPriceNgn != suggestedUnitPriceNgn` -> `PERMISSION_DENIED`.
12. **Audit Log Tampering / Production on Inactive Batch**: Client attempts to update/delete `/farms/farm_a/auditLogs/log_1` or create `eggProduction` referencing an `inactive` batch -> `PERMISSION_DENIED`.
