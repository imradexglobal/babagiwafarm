# Approved FarmLogNG upgrade scope

Source: user attachment `pasted_content_guIZNeuWujEDy3ebW3r6tS.txt` (uploaded in this task; full text read with functions.read). User approved the recommended design and answered all five design questions on 2026-11-15.

## User decisions
- Stay plain local; no Manus WebDev connection or code upload.
- Stock-changing transactions require online connectivity; cached viewing and offline drafts are okay.
- Sorting must reconcile exactly: total received egg count equals the total assigned after sorting across Jumbo, Big, Medium, Small, Pullet, Unsorted, Cracked, and Damaged.
- Farm may establish True-mode stock with an audited physical opening count; do not auto-migrate historic production/sales.
- Include the earlier customer/vendor registration, payment/receivable/payable balances, multi-line sales/purchase invoices, and printable general/individual statements.
- In General/Mixed mode pool visible balances by grade, while retaining source/pen provenance in movement/lot records.
- Safe interpretation from initial exchange: app must prevent selling above stock; allow store/pen-origin functionality; cracked/damaged saleability configurable; exact 30 eggs/crate canonical integer pieces.

## Egg Store requested behavior
- Farm config: True Egg Sales (inventory enforcing) or Phantom Egg Sales (existing no-stock workflow); inventory organization Pen-Based or General/Mixed; grading config with defaults Jumbo/Big/Medium/Small/Pullet/Unsorted.
- Workflow: daily production -> partial/complete transfer -> physical store receiving with expected vs actual counts and discrepancy explanation -> sorting/reconciliation -> inventory -> sale/free distribution, breakage/adjustment, disposal.
- Production records stay unchanged/historical; transfer balances prevent double transfers; receipt once per transfer; only actual receipt quantities increase stock.
- Maintain append-only movement ledger and current balances; don't store only latest stock.
- True-mode sales use online Firestore transactions, line-level grade/stock deductions, prohibit negative stock; Phantom mode continues old behavior without affecting inventory.
- preserve audit, farm tenant scope, existing reports, offline cache behavior, and permissions; do not introduce Cloud Functions/paid services or deploy rules without separate approval.
- Existing production supports crates/pieces/cracked/damaged and calculates intact = crates*30+pieces; does not currently stock egg inventory. Existing egg sales are single-line, free-text customer/category, no invoice/stock deduction. Existing purchases split feed and general expenses. Permissions strict; Firestore rules field validators strict.

## Important implementation notes
- Sorting example in attachment has a 25-egg discrepancy (input 615 total; example output 590). Exact reconciliation means reject such output unless the missing eggs are assigned to an explained separate movement (but user answered exact sum across grading categories including cracked/damaged).
- Firestore JS persistentLocalCache enabled; transaction writes require network for stock integrity; do not claim offline transaction posting.
- Firestore rules path currently scopes all farm collections and has default-deny; add new per-collection match validators and granular existing-matrix Egg Store permissions. No existing Egg Store collections exist.
- Customer/vendor payments and invoices are new; legacy transactions remain historical, no guessed migration; opening balances are manually entered.
