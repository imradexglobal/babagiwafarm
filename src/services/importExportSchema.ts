/**
 * Schema definitions and automatic documentation generators for
 * Farm Management SQLite Data Import & Export.
 */

export interface ColumnDefinition {
  name: string;
  type: 'TEXT' | 'INTEGER' | 'REAL';
  isPrimaryKey?: boolean;
  isRequired?: boolean;
  isForeignKey?: boolean;
  foreignTable?: string;
  foreignColumn?: string;
  defaultValue?: string | number | null;
  allowedValues?: readonly string[];
  description: string;
  validationRules: string;
  example: string;
  systemManaged?: boolean;
}

export interface TableDefinition {
  tableName: string;
  displayName: string;
  purpose: string;
  order: number; // Suggested order of population
  columns: ColumnDefinition[];
  indexes?: { name: string; columns: string[] }[];
}

export const SCHEMA_VERSION = '1';
export const TEMPLATE_VERSION = '1.0.0';
export const APPLICATION_NAME = 'Babagiwa Farm Management';

export const TABLE_DEFINITIONS: TableDefinition[] = [
  {
    tableName: 'pens',
    displayName: 'Pens & Housing Units',
    purpose: 'Defines the physical housing structures (pens, houses, barns) where animal batches reside.',
    order: 1,
    columns: [
      {
        name: 'id',
        type: 'TEXT',
        isPrimaryKey: true,
        isRequired: true,
        description: 'Unique primary identifier for the pen (e.g., PEN-001 or pen_north_house).',
        validationRules: 'Must be unique across all pens. Non-empty text.',
        example: 'pen-house-1',
      },
      {
        name: 'name',
        type: 'TEXT',
        isRequired: true,
        description: 'Descriptive human-readable pen name.',
        validationRules: 'Required. Non-empty text up to 100 characters.',
        example: 'Layer House Alpha',
      },
      {
        name: 'code',
        type: 'TEXT',
        isRequired: true,
        description: 'Short uppercase alphanumeric code used in identifiers.',
        validationRules: 'Required. Alphanumeric, unique per farm.',
        example: 'PEN-1',
      },
      {
        name: 'capacity',
        type: 'INTEGER',
        isRequired: true,
        description: 'Maximum animal capacity of this pen.',
        validationRules: 'Required integer >= 1.',
        example: '2500',
      },
      {
        name: 'sector',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'poultry',
        allowedValues: ['poultry'],
        description: 'Agricultural sector.',
        validationRules: 'Must be "poultry".',
        example: 'poultry',
      },
      {
        name: 'department',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'poultry',
        allowedValues: ['poultry', 'fishery', 'crops', 'livestock', 'general'],
        description: 'Operational department to which this pen belongs.',
        validationRules: 'Must be one of the allowed department values.',
        example: 'poultry',
      },
      {
        name: 'notes',
        type: 'TEXT',
        isRequired: false,
        description: 'General observations, ventilation type, or structural notes.',
        validationRules: 'Optional free-form text.',
        example: 'Equipped with automatic nipple drinkers and tunnel ventilation.',
      },
      {
        name: 'status',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'active',
        allowedValues: ['active', 'inactive'],
        description: 'Current operational status of the pen.',
        validationRules: 'Must be "active" or "inactive".',
        example: 'active',
      },
    ],
    indexes: [{ name: 'idx_pens_code', columns: ['code'] }],
  },

  {
    tableName: 'feed_items',
    displayName: 'Feed Catalog & Types',
    purpose: 'Catalog of feed products, formulations, brands, and standard packaging bag weights.',
    order: 2,
    columns: [
      {
        name: 'id',
        type: 'TEXT',
        isPrimaryKey: true,
        isRequired: true,
        description: 'Unique feed item identifier.',
        validationRules: 'Must be unique. Non-empty text.',
        example: 'feed-layers-mash-topfeed',
      },
      {
        name: 'feed_type',
        type: 'TEXT',
        isRequired: true,
        description: 'Feed formulation or category name.',
        validationRules: 'Required. e.g. Layers Mash, Broiler Starter, Growers Mash.',
        example: 'Layers Mash Phase 1',
      },
      {
        name: 'brand',
        type: 'TEXT',
        isRequired: true,
        description: 'Feed brand or feed mill manufacturer.',
        validationRules: 'Required non-empty text.',
        example: 'TopFeed',
      },
      {
        name: 'default_bag_weight_kg',
        type: 'REAL',
        isRequired: false,
        defaultValue: 25.0,
        description: 'Standard weight of one bag in kilograms (kg).',
        validationRules: 'Numeric value > 0. Defaults to 25.0 kg.',
        example: '25.0',
      },
      {
        name: 'notes',
        type: 'TEXT',
        isRequired: false,
        description: 'Nutritional specifications, crude protein % or supplier notes.',
        validationRules: 'Optional text.',
        example: '17.5% Crude Protein, 3.8% Calcium formulation.',
      },
      {
        name: 'status',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'active',
        allowedValues: ['active', 'inactive'],
        description: 'Catalog status.',
        validationRules: 'Must be "active" or "inactive".',
        example: 'active',
      },
    ],
  },

  {
    tableName: 'sales_units',
    displayName: 'Sales Units & Price Tiers',
    purpose: 'Packaging units for egg sales (crates, half-crates) and standard selling prices.',
    order: 3,
    columns: [
      {
        name: 'id',
        type: 'TEXT',
        isPrimaryKey: true,
        isRequired: true,
        description: 'Unique sales unit identifier.',
        validationRules: 'Required unique non-empty text.',
        example: 'unit-crate-30',
      },
      {
        name: 'name',
        type: 'TEXT',
        isRequired: true,
        description: 'Unit display name.',
        validationRules: 'Required text.',
        example: 'Standard Crate (30 eggs)',
      },
      {
        name: 'egg_count_per_unit',
        type: 'INTEGER',
        isRequired: true,
        description: 'Number of individual eggs represented by one unit.',
        validationRules: 'Integer >= 1.',
        example: '30',
      },
      {
        name: 'current_price_ngn',
        type: 'REAL',
        isRequired: true,
        description: 'Current selling price in farm currency (e.g. NGN).',
        validationRules: 'Numeric value >= 0.',
        example: '4500.0',
      },
      {
        name: 'effective_date',
        type: 'TEXT',
        isRequired: false,
        description: 'Date price took effect in YYYY-MM-DD format.',
        validationRules: 'ISO date YYYY-MM-DD.',
        example: '2026-01-01',
      },
      {
        name: 'status',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'active',
        allowedValues: ['active', 'inactive'],
        description: 'Status of unit.',
        validationRules: 'Must be "active" or "inactive".',
        example: 'active',
      },
    ],
  },

  {
    tableName: 'customers',
    displayName: 'Customers & Wholesalers',
    purpose: 'Directory of wholesale and retail egg buyers, credit balances, and contacts.',
    order: 4,
    columns: [
      {
        name: 'id',
        type: 'TEXT',
        isPrimaryKey: true,
        isRequired: true,
        description: 'Unique customer identifier.',
        validationRules: 'Required unique non-empty text.',
        example: 'cust-hajiya-amina',
      },
      {
        name: 'name',
        type: 'TEXT',
        isRequired: true,
        description: 'Full customer or business name.',
        validationRules: 'Required non-empty text.',
        example: 'Hajiya Amina Wholesale',
      },
      {
        name: 'phone',
        type: 'TEXT',
        isRequired: false,
        description: 'Phone contact number.',
        validationRules: 'Optional text.',
        example: '+2348031234567',
      },
      {
        name: 'email',
        type: 'TEXT',
        isRequired: false,
        description: 'Email address.',
        validationRules: 'Optional valid email format.',
        example: 'amina.wholesale@example.com',
      },
      {
        name: 'address',
        type: 'TEXT',
        isRequired: false,
        description: 'Physical or delivery address.',
        validationRules: 'Optional text.',
        example: 'Shop 14, Main Market, Kaduna',
      },
      {
        name: 'opening_balance_ngn',
        type: 'REAL',
        isRequired: false,
        defaultValue: 0,
        description: 'Opening balance (+ positive = owes farm; - negative = credit deposit).',
        validationRules: 'Numeric value.',
        example: '0',
      },
      {
        name: 'opening_balance_date',
        type: 'TEXT',
        isRequired: false,
        description: 'Date of opening balance in YYYY-MM-DD format.',
        validationRules: 'ISO date YYYY-MM-DD.',
        example: '2026-01-01',
      },
      {
        name: 'notes',
        type: 'TEXT',
        isRequired: false,
        description: 'Credit limits, payment terms, or preferred grades.',
        validationRules: 'Optional text.',
        example: 'Weekly credit terms; buys Large/Jumbo grade.',
      },
      {
        name: 'status',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'active',
        allowedValues: ['active', 'inactive'],
        description: 'Account status.',
        validationRules: 'Must be "active" or "inactive".',
        example: 'active',
      },
    ],
  },

  {
    tableName: 'vendors',
    displayName: 'Vendors & Suppliers',
    purpose: 'Directory of feed mills, hatcheries, veterinarians, and farm equipment vendors.',
    order: 5,
    columns: [
      {
        name: 'id',
        type: 'TEXT',
        isPrimaryKey: true,
        isRequired: true,
        description: 'Unique vendor identifier.',
        validationRules: 'Required unique non-empty text.',
        example: 'vend-chi-hatchery',
      },
      {
        name: 'name',
        type: 'TEXT',
        isRequired: true,
        description: 'Company or supplier name.',
        validationRules: 'Required text.',
        example: 'Chiwetalu Feed & Hatcheries Ltd',
      },
      {
        name: 'phone',
        type: 'TEXT',
        isRequired: false,
        description: 'Contact phone number.',
        validationRules: 'Optional text.',
        example: '+2348029876543',
      },
      {
        name: 'email',
        type: 'TEXT',
        isRequired: false,
        description: 'Supplier email address.',
        validationRules: 'Optional email.',
        example: 'orders@chiwetalu.com',
      },
      {
        name: 'address',
        type: 'TEXT',
        isRequired: false,
        description: 'Physical address or depot location.',
        validationRules: 'Optional text.',
        example: 'Industrial Layout, Zaria Road, Kano',
      },
      {
        name: 'opening_balance_ngn',
        type: 'REAL',
        isRequired: false,
        defaultValue: 0,
        description: 'Opening balance owed to vendor.',
        validationRules: 'Numeric value.',
        example: '0',
      },
      {
        name: 'opening_balance_date',
        type: 'TEXT',
        isRequired: false,
        description: 'Date of opening balance in YYYY-MM-DD format.',
        validationRules: 'ISO date YYYY-MM-DD.',
        example: '2026-01-01',
      },
      {
        name: 'notes',
        type: 'TEXT',
        isRequired: false,
        description: 'Bank payment details or terms.',
        validationRules: 'Optional text.',
        example: 'Main feed mill supplier.',
      },
      {
        name: 'status',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'active',
        allowedValues: ['active', 'inactive'],
        description: 'Account status.',
        validationRules: 'Must be "active" or "inactive".',
        example: 'active',
      },
    ],
  },

  {
    tableName: 'batches',
    displayName: 'Animal Batches & Flocks',
    purpose: 'Core entity representing a flock of animals placed in a specific pen.',
    order: 6,
    columns: [
      {
        name: 'id',
        type: 'TEXT',
        isPrimaryKey: true,
        isRequired: true,
        description: 'Unique primary identifier for the batch (e.g. batch-pen1-2401).',
        validationRules: 'Must be unique across all batches. Non-empty text.',
        example: 'batch-layer-2026-01',
      },
      {
        name: 'batch_code',
        type: 'TEXT',
        isRequired: true,
        description: 'Unique farm batch code, e.g. PEN-1-240115.',
        validationRules: 'Required. Unique per farm. Uppercase alphanumeric format.',
        example: 'PEN-1-260115',
      },
      {
        name: 'pen_id',
        type: 'TEXT',
        isRequired: true,
        isForeignKey: true,
        foreignTable: 'pens',
        foreignColumn: 'id',
        description: 'Identifier of the pen where this batch is housed.',
        validationRules: 'Must reference a valid existing pen in the pens table.',
        example: 'pen-house-1',
      },
      {
        name: 'bird_type',
        type: 'TEXT',
        isRequired: true,
        description: 'Type of bird or poultry classification.',
        validationRules: 'Required. e.g. Layer, Broiler, Pullet, Cockerel, Turkey, Duck.',
        example: 'Layer',
      },
      {
        name: 'animal_type',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'Chicken',
        description: 'Species of animal.',
        validationRules: 'Defaults to "Chicken".',
        example: 'Chicken',
      },
      {
        name: 'production_type',
        type: 'TEXT',
        isRequired: false,
        description: 'Production purpose (Layer, Broiler, Breeder).',
        validationRules: 'Optional. Recommended for automated care schedule generation.',
        example: 'Layer',
      },
      {
        name: 'production_stage',
        type: 'TEXT',
        isRequired: false,
        description: 'Current or placement life stage (Day-Old Chick, Pullet, Point of Lay, Laying).',
        validationRules: 'Optional text.',
        example: 'Point of Lay',
      },
      {
        name: 'breed',
        type: 'TEXT',
        isRequired: true,
        description: 'Breed name.',
        validationRules: 'Required. e.g. ISA Brown, Lohmann Brown, Bovans Brown, Ross 308, Cobb 500.',
        example: 'ISA Brown',
      },
      {
        name: 'strain',
        type: 'TEXT',
        isRequired: false,
        description: 'Specific strain or genetic line.',
        validationRules: 'Optional text.',
        example: 'ISA Brown Classic',
      },
      {
        name: 'source',
        type: 'TEXT',
        isRequired: true,
        description: 'Hatchery or source supplier.',
        validationRules: 'Required text.',
        example: 'Chiwetalu Hatcheries',
      },
      {
        name: 'hatch_date',
        type: 'TEXT',
        isRequired: false,
        description: 'Hatch date in YYYY-MM-DD format (if known).',
        validationRules: 'ISO date YYYY-MM-DD. Must be <= placement_date.',
        example: '2025-09-15',
      },
      {
        name: 'age_at_placement_days',
        type: 'INTEGER',
        isRequired: false,
        defaultValue: 0,
        description: 'Age in days at the time of placement if hatch_date is omitted.',
        validationRules: 'Integer >= 0. Compulsory if hatch_date is empty.',
        example: '112',
      },
      {
        name: 'placement_date',
        type: 'TEXT',
        isRequired: true,
        description: 'Date flock arrived and was placed in the pen (YYYY-MM-DD).',
        validationRules: 'Required ISO date format YYYY-MM-DD.',
        example: '2026-01-05',
      },
      {
        name: 'initial_count',
        type: 'INTEGER',
        isRequired: true,
        description: 'Initial number of live birds placed in the pen.',
        validationRules: 'Required integer >= 1.',
        example: '2000',
      },
      {
        name: 'male_count',
        type: 'INTEGER',
        isRequired: false,
        defaultValue: 0,
        description: 'Number of male birds (for breeders or mixed flocks).',
        validationRules: 'Integer >= 0. male_count + female_count <= initial_count.',
        example: '0',
      },
      {
        name: 'female_count',
        type: 'INTEGER',
        isRequired: false,
        defaultValue: 0,
        description: 'Number of female birds.',
        validationRules: 'Integer >= 0. male_count + female_count <= initial_count.',
        example: '2000',
      },
      {
        name: 'remarks',
        type: 'TEXT',
        isRequired: false,
        description: 'Health status upon delivery, vaccination certificate #, etc.',
        validationRules: 'Optional text.',
        example: 'Placed at 16 weeks, healthy with uniform body weights.',
      },
      {
        name: 'status',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'active',
        allowedValues: ['active', 'inactive'],
        description: 'Active housing flock status.',
        validationRules: 'Must be "active" or "inactive".',
        example: 'active',
      },
    ],
    indexes: [
      { name: 'idx_batches_code', columns: ['batch_code'] },
      { name: 'idx_batches_pen', columns: ['pen_id'] },
    ],
  },

  {
    tableName: 'egg_production',
    displayName: 'Daily Egg Production Records',
    purpose: 'Daily egg collection tallies by pen and batch, including intact crates, pieces, cracks, and defects.',
    order: 7,
    columns: [
      {
        name: 'id',
        type: 'TEXT',
        isPrimaryKey: true,
        isRequired: true,
        description: 'Unique production entry identifier.',
        validationRules: 'Required unique non-empty text.',
        example: 'prod-2026-01-10-pen1',
      },
      {
        name: 'transaction_date',
        type: 'TEXT',
        isRequired: true,
        description: 'Collection date in YYYY-MM-DD format.',
        validationRules: 'Required ISO date format YYYY-MM-DD.',
        example: '2026-01-10',
      },
      {
        name: 'transaction_time',
        type: 'TEXT',
        isRequired: false,
        description: 'Time of collection in HH:mm format (24-hour).',
        validationRules: 'Format HH:mm (e.g. 09:30 or 15:45).',
        example: '10:00',
      },
      {
        name: 'batch_id',
        type: 'TEXT',
        isRequired: true,
        isForeignKey: true,
        foreignTable: 'batches',
        foreignColumn: 'id',
        description: 'Identifier of the producing flock batch.',
        validationRules: 'Must reference a valid batch in the batches table.',
        example: 'batch-layer-2026-01',
      },
      {
        name: 'pen_id',
        type: 'TEXT',
        isRequired: true,
        isForeignKey: true,
        foreignTable: 'pens',
        foreignColumn: 'id',
        description: 'Identifier of the pen where collection took place.',
        validationRules: 'Must reference a valid pen in the pens table.',
        example: 'pen-house-1',
      },
      {
        name: 'crates',
        type: 'INTEGER',
        isRequired: false,
        defaultValue: 0,
        description: 'Number of full commercial crates (30 eggs each).',
        validationRules: 'Integer >= 0.',
        example: '55',
      },
      {
        name: 'pieces',
        type: 'INTEGER',
        isRequired: false,
        defaultValue: 0,
        description: 'Number of additional loose intact eggs (< 30).',
        validationRules: 'Integer >= 0 and <= 29.',
        example: '18',
      },
      {
        name: 'intact_eggs',
        type: 'INTEGER',
        isRequired: false,
        defaultValue: 0,
        description: 'Total intact commercial eggs (crates * 30 + pieces).',
        validationRules: 'Integer >= 0. If 0 and crates/pieces provided, automatically computed.',
        example: '1668',
      },
      {
        name: 'cracked_eggs',
        type: 'INTEGER',
        isRequired: false,
        defaultValue: 0,
        description: 'Hairline cracked eggs suitable for immediate discounted kitchen/bakery sale.',
        validationRules: 'Integer >= 0.',
        example: '12',
      },
      {
        name: 'damaged_eggs',
        type: 'INTEGER',
        isRequired: false,
        defaultValue: 0,
        description: 'Broken, leaking, soft-shelled, or discarded eggs.',
        validationRules: 'Integer >= 0.',
        example: '4',
      },
      {
        name: 'total_eggs',
        type: 'INTEGER',
        isRequired: false,
        defaultValue: 0,
        description: 'Grand total eggs laid (intact + cracked + damaged).',
        validationRules: 'Must equal intact_eggs + cracked_eggs + damaged_eggs.',
        example: '1684',
      },
      {
        name: 'remarks',
        type: 'TEXT',
        isRequired: false,
        description: 'Observations regarding egg size, shell texture, or collection rounds.',
        validationRules: 'Optional text.',
        example: 'Morning collection; excellent shell thickness.',
      },
      {
        name: 'status',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'APPROVED',
        allowedValues: ['APPROVED', 'PENDING', 'VOIDED'],
        description: 'Record approval status.',
        validationRules: 'Must be "APPROVED", "PENDING", or "VOIDED".',
        example: 'APPROVED',
      },
    ],
    indexes: [
      { name: 'idx_prod_batch', columns: ['batch_id'] },
      { name: 'idx_prod_date', columns: ['transaction_date'] },
    ],
  },

  {
    tableName: 'mortality_records',
    displayName: 'Flock Mortality Records',
    purpose: 'Mortality and culling logs per flock, detailing time of day, cause, and symptoms.',
    order: 8,
    columns: [
      {
        name: 'id',
        type: 'TEXT',
        isPrimaryKey: true,
        isRequired: true,
        description: 'Unique mortality entry identifier.',
        validationRules: 'Required unique non-empty text.',
        example: 'mort-2026-01-10-pen1',
      },
      {
        name: 'transaction_date',
        type: 'TEXT',
        isRequired: true,
        description: 'Date of mortality occurrence in YYYY-MM-DD format.',
        validationRules: 'Required ISO date format YYYY-MM-DD.',
        example: '2026-01-10',
      },
      {
        name: 'time_of_day',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'morning',
        allowedValues: ['morning', 'afternoon', 'night'],
        description: 'Inspection round when mortality was discovered.',
        validationRules: 'Must be "morning", "afternoon", or "night".',
        example: 'morning',
      },
      {
        name: 'batch_id',
        type: 'TEXT',
        isRequired: true,
        isForeignKey: true,
        foreignTable: 'batches',
        foreignColumn: 'id',
        description: 'Identifier of the affected flock batch.',
        validationRules: 'Must reference a valid batch in the batches table.',
        example: 'batch-layer-2026-01',
      },
      {
        name: 'pen_id',
        type: 'TEXT',
        isRequired: true,
        isForeignKey: true,
        foreignTable: 'pens',
        foreignColumn: 'id',
        description: 'Identifier of the pen.',
        validationRules: 'Must reference a valid pen in the pens table.',
        example: 'pen-house-1',
      },
      {
        name: 'mortality_count',
        type: 'INTEGER',
        isRequired: true,
        description: 'Number of dead or culled birds removed.',
        validationRules: 'Integer >= 1.',
        example: '2',
      },
      {
        name: 'reason_category',
        type: 'TEXT',
        isRequired: true,
        allowedValues: [
          'Disease / Infection',
          'Heat Stress',
          'Predator / Pest',
          'Cannibalism / Pecking',
          'Prolapse / Egg Bound',
          'Weak / Runt / Cull',
          'Sudden Death',
          'Accident / Injury',
          'Unknown',
          'Others',
        ],
        description: 'Primary cause category.',
        validationRules: 'Must match one of the standard farm reason categories.',
        example: 'Heat Stress',
      },
      {
        name: 'reason_detail',
        type: 'TEXT',
        isRequired: false,
        description: 'Specific post-mortem observations, symptoms, or autopsy notes.',
        validationRules: 'Required if reason_category is "Others", otherwise optional text.',
        example: 'High ambient temperature in late afternoon; water pressure was restored.',
      },
      {
        name: 'remarks',
        type: 'TEXT',
        isRequired: false,
        description: 'Disposal method or actions taken.',
        validationRules: 'Optional text.',
        example: 'Disposed safely in deep compost pit.',
      },
    ],
    indexes: [
      { name: 'idx_mort_batch', columns: ['batch_id'] },
      { name: 'idx_mort_date', columns: ['transaction_date'] },
    ],
  },

  {
    tableName: 'feed_purchases',
    displayName: 'Feed Purchases & Stock Receipts',
    purpose: 'Purchases of commercial feeds into farm inventory with cost and supplier references.',
    order: 9,
    columns: [
      {
        name: 'id',
        type: 'TEXT',
        isPrimaryKey: true,
        isRequired: true,
        description: 'Unique feed purchase record identifier.',
        validationRules: 'Required unique non-empty text.',
        example: 'feed-purch-20260105',
      },
      {
        name: 'transaction_date',
        type: 'TEXT',
        isRequired: true,
        description: 'Date purchased or delivered in YYYY-MM-DD format.',
        validationRules: 'Required ISO date format YYYY-MM-DD.',
        example: '2026-01-05',
      },
      {
        name: 'feed_item_id',
        type: 'TEXT',
        isRequired: true,
        isForeignKey: true,
        foreignTable: 'feed_items',
        foreignColumn: 'id',
        description: 'Identifier of the feed item purchased.',
        validationRules: 'Must reference a valid feed item in feed_items.',
        example: 'feed-layers-mash-topfeed',
      },
      {
        name: 'entered_quantity',
        type: 'REAL',
        isRequired: true,
        description: 'Purchased quantity in the selected unit.',
        validationRules: 'Numeric value > 0.',
        example: '100',
      },
      {
        name: 'entered_unit',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'bags',
        allowedValues: ['bags', 'kg'],
        description: 'Unit of measure used during entry.',
        validationRules: 'Must be "bags" or "kg".',
        example: 'bags',
      },
      {
        name: 'bag_weight_kg',
        type: 'REAL',
        isRequired: false,
        defaultValue: 25.0,
        description: 'Weight of one bag in kilograms (kg).',
        validationRules: 'Numeric value > 0.',
        example: '25.0',
      },
      {
        name: 'unit_purchase_price_ngn',
        type: 'REAL',
        isRequired: true,
        description: 'Unit price per bag or kg in farm currency.',
        validationRules: 'Numeric value >= 0.',
        example: '14500.0',
      },
      {
        name: 'total_cost_ngn',
        type: 'REAL',
        isRequired: true,
        description: 'Total cost (quantity * unit_purchase_price_ngn).',
        validationRules: 'Numeric value >= 0.',
        example: '1450000.0',
      },
      {
        name: 'supplier',
        type: 'TEXT',
        isRequired: false,
        description: 'Supplier or mill distributor name.',
        validationRules: 'Optional text.',
        example: 'Chiwetalu Feed Distributors',
      },
      {
        name: 'reference',
        type: 'TEXT',
        isRequired: false,
        description: 'Waybill number, invoice number, or receipt code.',
        validationRules: 'Optional text.',
        example: 'WB-99482',
      },
      {
        name: 'remarks',
        type: 'TEXT',
        isRequired: false,
        description: 'Batch manufacture date, lot number, or storage bay.',
        validationRules: 'Optional text.',
        example: 'Stored in Feed Bay 1; lot #26-A.',
      },
    ],
    indexes: [{ name: 'idx_feed_purch_date', columns: ['transaction_date'] }],
  },

  {
    tableName: 'feed_consumption',
    displayName: 'Feed Consumption Logs',
    purpose: 'Daily quantity of feed consumed by each flock.',
    order: 10,
    columns: [
      {
        name: 'id',
        type: 'TEXT',
        isPrimaryKey: true,
        isRequired: true,
        description: 'Unique feed consumption record identifier.',
        validationRules: 'Required unique non-empty text.',
        example: 'feed-cons-2026-01-10-pen1',
      },
      {
        name: 'transaction_date',
        type: 'TEXT',
        isRequired: true,
        description: 'Date fed in YYYY-MM-DD format.',
        validationRules: 'Required ISO date format YYYY-MM-DD.',
        example: '2026-01-10',
      },
      {
        name: 'transaction_time',
        type: 'TEXT',
        isRequired: false,
        description: 'Feeding time in HH:mm format.',
        validationRules: 'Format HH:mm.',
        example: '08:00',
      },
      {
        name: 'batch_id',
        type: 'TEXT',
        isRequired: true,
        isForeignKey: true,
        foreignTable: 'batches',
        foreignColumn: 'id',
        description: 'Identifier of the flock fed.',
        validationRules: 'Must reference a valid batch in batches table.',
        example: 'batch-layer-2026-01',
      },
      {
        name: 'pen_id',
        type: 'TEXT',
        isRequired: true,
        isForeignKey: true,
        foreignTable: 'pens',
        foreignColumn: 'id',
        description: 'Identifier of the housing pen.',
        validationRules: 'Must reference a valid pen in pens table.',
        example: 'pen-house-1',
      },
      {
        name: 'feed_item_id',
        type: 'TEXT',
        isRequired: true,
        isForeignKey: true,
        foreignTable: 'feed_items',
        foreignColumn: 'id',
        description: 'Identifier of the feed item fed.',
        validationRules: 'Must reference a valid item in feed_items table.',
        example: 'feed-layers-mash-topfeed',
      },
      {
        name: 'entered_quantity',
        type: 'REAL',
        isRequired: true,
        description: 'Quantity fed in the chosen unit.',
        validationRules: 'Numeric value > 0.',
        example: '5.0',
      },
      {
        name: 'entered_unit',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'bags',
        allowedValues: ['bags', 'kg'],
        description: 'Unit of measure.',
        validationRules: 'Must be "bags" or "kg".',
        example: 'bags',
      },
      {
        name: 'bag_weight_kg',
        type: 'REAL',
        isRequired: false,
        defaultValue: 25.0,
        description: 'Weight of one bag in kg.',
        validationRules: 'Numeric value > 0.',
        example: '25.0',
      },
      {
        name: 'total_cost_ngn',
        type: 'REAL',
        isRequired: false,
        defaultValue: 0,
        description: 'Monetary value of feed consumed.',
        validationRules: 'Numeric value >= 0.',
        example: '72500.0',
      },
      {
        name: 'remarks',
        type: 'TEXT',
        isRequired: false,
        description: 'Feeding appetite observations or feeder adjustments.',
        validationRules: 'Optional text.',
        example: 'Morning feed 3 bags, afternoon top-up 2 bags. Cleaned water troughs.',
      },
    ],
    indexes: [
      { name: 'idx_feed_cons_batch', columns: ['batch_id'] },
      { name: 'idx_feed_cons_date', columns: ['transaction_date'] },
    ],
  },

  {
    tableName: 'medication_records',
    displayName: 'Medication & Health Treatments',
    purpose: 'Health administrations including vaccines, antibiotics, dewormers, and vitamins.',
    order: 11,
    columns: [
      {
        name: 'id',
        type: 'TEXT',
        isPrimaryKey: true,
        isRequired: true,
        description: 'Unique health record identifier.',
        validationRules: 'Required unique non-empty text.',
        example: 'med-2026-01-10-pen1',
      },
      {
        name: 'transaction_date',
        type: 'TEXT',
        isRequired: true,
        description: 'Administration date in YYYY-MM-DD format.',
        validationRules: 'Required ISO date format YYYY-MM-DD.',
        example: '2026-01-10',
      },
      {
        name: 'time_of_day',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'morning',
        allowedValues: ['morning', 'afternoon', 'night'],
        description: 'Inspection round when administered.',
        validationRules: 'Must be "morning", "afternoon", or "night".',
        example: 'morning',
      },
      {
        name: 'transaction_time',
        type: 'TEXT',
        isRequired: false,
        description: 'Time of administration in HH:mm format.',
        validationRules: 'Format HH:mm.',
        example: '08:30',
      },
      {
        name: 'batch_id',
        type: 'TEXT',
        isRequired: true,
        isForeignKey: true,
        foreignTable: 'batches',
        foreignColumn: 'id',
        description: 'Identifier of the treated flock batch.',
        validationRules: 'Must reference a valid batch in batches table.',
        example: 'batch-layer-2026-01',
      },
      {
        name: 'pen_id',
        type: 'TEXT',
        isRequired: true,
        isForeignKey: true,
        foreignTable: 'pens',
        foreignColumn: 'id',
        description: 'Identifier of the pen.',
        validationRules: 'Must reference a valid pen in pens table.',
        example: 'pen-house-1',
      },
      {
        name: 'treatment_type',
        type: 'TEXT',
        isRequired: true,
        allowedValues: ['medication', 'vaccination', 'vitamin', 'deworming', 'other'],
        description: 'Category of health intervention.',
        validationRules: 'Must be "medication", "vaccination", "vitamin", "deworming", or "other".',
        example: 'vaccination',
      },
      {
        name: 'medication_name',
        type: 'TEXT',
        isRequired: true,
        description: 'Commercial or active drug/vaccine name.',
        validationRules: 'Required text.',
        example: 'Lasota Newcastle Vaccine',
      },
      {
        name: 'dosage',
        type: 'TEXT',
        isRequired: true,
        description: 'Administered dosage or concentration.',
        validationRules: 'Required non-empty text.',
        example: '2000 doses in 40 liters skim-milk stabilized water',
      },
      {
        name: 'administration_route',
        type: 'TEXT',
        isRequired: true,
        description: 'Route of administration.',
        validationRules: 'Required text. e.g. Drinking Water, Eye Drop, Subcutaneous, Spray.',
        example: 'Drinking Water',
      },
      {
        name: 'remarks',
        type: 'TEXT',
        isRequired: false,
        description: 'Vaccine lot #, expiry, vet supervision, withdrawal period.',
        validationRules: 'Optional text.',
        example: 'Vaccine lot #L-9042, expiry Dec 2027. Administered under vet supervision.',
      },
    ],
    indexes: [
      { name: 'idx_med_batch', columns: ['batch_id'] },
      { name: 'idx_med_date', columns: ['transaction_date'] },
    ],
  },

  {
    tableName: 'environment_records',
    displayName: 'Environmental & Bird Weight Logs',
    purpose: 'Periodic flock sample weighing, pen ambient temperatures, and humidity monitoring.',
    order: 12,
    columns: [
      {
        name: 'id',
        type: 'TEXT',
        isPrimaryKey: true,
        isRequired: true,
        description: 'Unique metric entry identifier.',
        validationRules: 'Required unique non-empty text.',
        example: 'env-2026-01-10-pen1',
      },
      {
        name: 'transaction_date',
        type: 'TEXT',
        isRequired: true,
        description: 'Sampling date in YYYY-MM-DD format.',
        validationRules: 'Required ISO date format YYYY-MM-DD.',
        example: '2026-01-10',
      },
      {
        name: 'time_of_day',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'morning',
        allowedValues: ['morning', 'afternoon', 'night'],
        description: 'Observation period.',
        validationRules: 'Must be "morning", "afternoon", or "night".',
        example: 'morning',
      },
      {
        name: 'transaction_time',
        type: 'TEXT',
        isRequired: false,
        description: 'Observation time in HH:mm format.',
        validationRules: 'Format HH:mm.',
        example: '07:30',
      },
      {
        name: 'batch_id',
        type: 'TEXT',
        isRequired: true,
        isForeignKey: true,
        foreignTable: 'batches',
        foreignColumn: 'id',
        description: 'Identifier of the sampled flock batch.',
        validationRules: 'Must reference a valid batch in batches table.',
        example: 'batch-layer-2026-01',
      },
      {
        name: 'pen_id',
        type: 'TEXT',
        isRequired: true,
        isForeignKey: true,
        foreignTable: 'pens',
        foreignColumn: 'id',
        description: 'Identifier of the pen.',
        validationRules: 'Must reference a valid pen in pens table.',
        example: 'pen-house-1',
      },
      {
        name: 'average_weight_grams',
        type: 'REAL',
        isRequired: false,
        description: 'Average body weight of sampled birds in grams.',
        validationRules: 'Numeric value > 0 if provided.',
        example: '1850.5',
      },
      {
        name: 'sample_size',
        type: 'INTEGER',
        isRequired: false,
        defaultValue: 0,
        description: 'Number of birds weighed in the sample.',
        validationRules: 'Integer >= 0.',
        example: '50',
      },
      {
        name: 'temperature_c',
        type: 'REAL',
        isRequired: false,
        description: 'Pen temperature in degrees Celsius (°C).',
        validationRules: 'Numeric value (typically 15 to 45).',
        example: '27.4',
      },
      {
        name: 'humidity_pct',
        type: 'REAL',
        isRequired: false,
        description: 'Relative humidity percentage (%).',
        validationRules: 'Numeric value 0 to 100.',
        example: '62.0',
      },
      {
        name: 'remarks',
        type: 'TEXT',
        isRequired: false,
        description: 'Litter condition, ammonia smell observations, fan speeds.',
        validationRules: 'Optional text.',
        example: 'Weekly sample weighing. Flock uniformity at 88%. Litter is dry.',
      },
    ],
    indexes: [
      { name: 'idx_env_batch', columns: ['batch_id'] },
      { name: 'idx_env_date', columns: ['transaction_date'] },
    ],
  },

  {
    tableName: 'egg_sales',
    displayName: 'Egg Sales Transactions',
    purpose: 'Direct sales of commercial eggs, crates sold, amounts received, and payment status.',
    order: 13,
    columns: [
      {
        name: 'id',
        type: 'TEXT',
        isPrimaryKey: true,
        isRequired: true,
        description: 'Unique egg sale identifier.',
        validationRules: 'Required unique non-empty text.',
        example: 'sale-2026-01-11-001',
      },
      {
        name: 'transaction_date',
        type: 'TEXT',
        isRequired: true,
        description: 'Date of sale in YYYY-MM-DD format.',
        validationRules: 'Required ISO date format YYYY-MM-DD.',
        example: '2026-01-11',
      },
      {
        name: 'transaction_time',
        type: 'TEXT',
        isRequired: false,
        description: 'Time of sale in HH:mm format.',
        validationRules: 'Format HH:mm.',
        example: '11:15',
      },
      {
        name: 'customer_name',
        type: 'TEXT',
        isRequired: true,
        description: 'Customer or buyer name.',
        validationRules: 'Required text.',
        example: 'Hajiya Amina Wholesale',
      },
      {
        name: 'egg_category',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'Table Eggs',
        description: 'Product category (Table Eggs, Cracked Eggs, Jumbo, Medium).',
        validationRules: 'Text up to 50 characters.',
        example: 'Table Eggs',
      },
      {
        name: 'sales_unit_id',
        type: 'TEXT',
        isRequired: false,
        isForeignKey: true,
        foreignTable: 'sales_units',
        foreignColumn: 'id',
        description: 'Identifier of the sales unit packaging.',
        validationRules: 'Optional foreign key to sales_units.',
        example: 'unit-crate-30',
      },
      {
        name: 'quantity',
        type: 'REAL',
        isRequired: true,
        description: 'Number of units sold (e.g. 50 crates).',
        validationRules: 'Numeric value > 0.',
        example: '50.0',
      },
      {
        name: 'total_eggs_equivalent',
        type: 'INTEGER',
        isRequired: false,
        defaultValue: 0,
        description: 'Total individual eggs represented (quantity * egg_count_per_unit).',
        validationRules: 'Integer >= 1. Automatically computed if 0.',
        example: '1500',
      },
      {
        name: 'unit_price_ngn',
        type: 'REAL',
        isRequired: true,
        description: 'Actual agreed price per unit.',
        validationRules: 'Numeric value >= 0.',
        example: '4500.0',
      },
      {
        name: 'total_amount_ngn',
        type: 'REAL',
        isRequired: true,
        description: 'Total transaction amount (quantity * unit_price_ngn).',
        validationRules: 'Numeric value >= 0.',
        example: '225000.0',
      },
      {
        name: 'payment_status',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'paid',
        allowedValues: ['paid', 'pending', 'partial'],
        description: 'Payment status.',
        validationRules: 'Must be "paid", "pending", or "partial".',
        example: 'paid',
      },
      {
        name: 'received_amount_ngn',
        type: 'REAL',
        isRequired: false,
        defaultValue: 0,
        description: 'Amount paid by customer.',
        validationRules: 'Numeric value >= 0.',
        example: '225000.0',
      },
      {
        name: 'balance_due_ngn',
        type: 'REAL',
        isRequired: false,
        defaultValue: 0,
        description: 'Outstanding credit balance.',
        validationRules: 'Numeric value >= 0.',
        example: '0.0',
      },
      {
        name: 'batch_id',
        type: 'TEXT',
        isRequired: false,
        isForeignKey: true,
        foreignTable: 'batches',
        foreignColumn: 'id',
        description: 'Optional producing batch (for pen-specific revenue tracking).',
        validationRules: 'Optional foreign key to batches.',
        example: 'batch-layer-2026-01',
      },
      {
        name: 'remarks',
        type: 'TEXT',
        isRequired: false,
        description: 'Bank transfer reference, discount reason, or dispatch notes.',
        validationRules: 'Optional text.',
        example: 'Bank transfer confirmed. Loaded on customer truck #KD-442-A.',
      },
    ],
    indexes: [{ name: 'idx_sales_date', columns: ['transaction_date'] }],
  },

  {
    tableName: 'farm_purchases',
    displayName: 'Operational Expenses & Farm Purchases',
    purpose: 'General operating expenses including vet visits, bedding, vaccines, packaging, and repairs.',
    order: 14,
    columns: [
      {
        name: 'id',
        type: 'TEXT',
        isPrimaryKey: true,
        isRequired: true,
        description: 'Unique expense identifier.',
        validationRules: 'Required unique non-empty text.',
        example: 'purch-2026-01-08-01',
      },
      {
        name: 'transaction_date',
        type: 'TEXT',
        isRequired: true,
        description: 'Date incurred in YYYY-MM-DD format.',
        validationRules: 'Required ISO date format YYYY-MM-DD.',
        example: '2026-01-08',
      },
      {
        name: 'category',
        type: 'TEXT',
        isRequired: true,
        allowedValues: [
          'medication',
          'vaccines_vet',
          'supplements',
          'chicks_stock',
          'litter_bedding',
          'packaging',
          'utilities_fuel',
          'equipment_repairs',
          'labor',
          'other',
        ],
        description: 'Expense category classification.',
        validationRules: 'Must match one of the standard farm expense categories.',
        example: 'litter_bedding',
      },
      {
        name: 'item_name',
        type: 'TEXT',
        isRequired: true,
        description: 'Name of item or service purchased.',
        validationRules: 'Required text.',
        example: 'Wood shavings / sawdust bedding bags',
      },
      {
        name: 'quantity',
        type: 'REAL',
        isRequired: true,
        description: 'Quantity purchased.',
        validationRules: 'Numeric value > 0.',
        example: '40.0',
      },
      {
        name: 'unit',
        type: 'TEXT',
        isRequired: true,
        description: 'Unit of measurement (bags, liters, doses, units, hours).',
        validationRules: 'Required text.',
        example: 'bags',
      },
      {
        name: 'unit_price_ngn',
        type: 'REAL',
        isRequired: true,
        description: 'Price per unit.',
        validationRules: 'Numeric value >= 0.',
        example: '1200.0',
      },
      {
        name: 'total_cost_ngn',
        type: 'REAL',
        isRequired: true,
        description: 'Total expense amount (quantity * unit_price_ngn).',
        validationRules: 'Numeric value >= 0.',
        example: '48000.0',
      },
      {
        name: 'supplier',
        type: 'TEXT',
        isRequired: false,
        description: 'Supplier or vendor name.',
        validationRules: 'Optional text.',
        example: 'Timber Sawmill Cooperative',
      },
      {
        name: 'reference',
        type: 'TEXT',
        isRequired: false,
        description: 'Invoice or payment receipt reference.',
        validationRules: 'Optional text.',
        example: 'REC-3301',
      },
      {
        name: 'batch_id',
        type: 'TEXT',
        isRequired: false,
        isForeignKey: true,
        foreignTable: 'batches',
        foreignColumn: 'id',
        description: 'Optional batch to allocate this direct expense to.',
        validationRules: 'Optional foreign key to batches.',
        example: 'batch-layer-2026-01',
      },
      {
        name: 'remarks',
        type: 'TEXT',
        isRequired: false,
        description: 'Expense justification or usage details.',
        validationRules: 'Optional text.',
        example: 'Bedding replacement for brooding pens.',
      },
    ],
    indexes: [{ name: 'idx_purch_date', columns: ['transaction_date'] }],
  },

  {
    tableName: 'care_plans',
    displayName: 'Flock Care Plans & Schedules',
    purpose: 'Templates for automated flock vaccination, medication, and management milestones.',
    order: 15,
    columns: [
      {
        name: 'id',
        type: 'TEXT',
        isPrimaryKey: true,
        isRequired: true,
        description: 'Unique care plan identifier.',
        validationRules: 'Required unique non-empty text.',
        example: 'plan-commercial-layer-standard',
      },
      {
        name: 'name',
        type: 'TEXT',
        isRequired: true,
        description: 'Care plan display name.',
        validationRules: 'Required text up to 100 characters.',
        example: 'Standard Commercial Layer Vaccination & Deworming Plan',
      },
      {
        name: 'description',
        type: 'TEXT',
        isRequired: false,
        description: 'Summary of protocols covered in this plan.',
        validationRules: 'Optional text.',
        example: 'Full routine schedule from day-old through 72 weeks of lay.',
      },
      {
        name: 'plan_type',
        type: 'TEXT',
        isRequired: true,
        allowedValues: ['medication', 'vaccination', 'activity'],
        description: 'Primary nature of the plan.',
        validationRules: 'Must be "medication", "vaccination", or "activity".',
        example: 'vaccination',
      },
      {
        name: 'animal_type',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'Chicken',
        description: 'Target animal species.',
        validationRules: 'Defaults to "Chicken".',
        example: 'Chicken',
      },
      {
        name: 'production_type',
        type: 'TEXT',
        isRequired: false,
        description: 'Production type (Layer, Broiler, Breeder).',
        validationRules: 'Optional text.',
        example: 'Layer',
      },
      {
        name: 'production_stage',
        type: 'TEXT',
        isRequired: false,
        description: 'Production stage.',
        validationRules: 'Optional text.',
        example: 'Point of Lay',
      },
      {
        name: 'scheduling_reference',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'placement',
        allowedValues: ['placement', 'hatch', 'custom'],
        description: 'Reference timeline from which activity offsets are calculated.',
        validationRules: 'Must be "placement", "hatch", or "custom".',
        example: 'placement',
      },
      {
        name: 'status',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'active',
        allowedValues: ['active', 'inactive'],
        description: 'Plan availability status.',
        validationRules: 'Must be "active" or "inactive".',
        example: 'active',
      },
    ],
  },

  {
    tableName: 'care_plan_items',
    displayName: 'Care Plan Activities & Milestones',
    purpose: 'Individual scheduled interventions (vaccines, dewormers, vitamins) belonging to a care plan.',
    order: 16,
    columns: [
      {
        name: 'id',
        type: 'TEXT',
        isPrimaryKey: true,
        isRequired: true,
        description: 'Unique item identifier.',
        validationRules: 'Required unique non-empty text.',
        example: 'cpi-lasota-day21',
      },
      {
        name: 'care_plan_id',
        type: 'TEXT',
        isRequired: true,
        isForeignKey: true,
        foreignTable: 'care_plans',
        foreignColumn: 'id',
        description: 'Identifier of the parent care plan.',
        validationRules: 'Must reference a valid care plan in care_plans table.',
        example: 'plan-commercial-layer-standard',
      },
      {
        name: 'title',
        type: 'TEXT',
        isRequired: true,
        description: 'Short activity title.',
        validationRules: 'Required text up to 140 characters.',
        example: 'Newcastle Lasota Booster',
      },
      {
        name: 'reminder_type',
        type: 'TEXT',
        isRequired: true,
        allowedValues: [
          'vaccination',
          'medication',
          'milestone',
          'feeding',
          'maintenance',
          'inspection',
          'cleaning',
          'water_management',
          'animal_management',
          'biosecurity',
          'monitoring',
          'general',
        ],
        description: 'Activity classification.',
        validationRules: 'Must match one of the allowed reminder types.',
        example: 'vaccination',
      },
      {
        name: 'dosage_or_action',
        type: 'TEXT',
        isRequired: false,
        description: 'Prescribed dosage, route, or action.',
        validationRules: 'Optional text up to 140 characters.',
        example: '1 dose per bird via drinking water',
      },
      {
        name: 'notes',
        type: 'TEXT',
        isRequired: false,
        description: 'Preparation guidelines or instructions.',
        validationRules: 'Optional text.',
        example: 'Deprive birds of water for 1.5 hours prior to administration.',
      },
      {
        name: 'offset_days',
        type: 'INTEGER',
        isRequired: true,
        defaultValue: 0,
        description: 'Number of days after placement (or hatch) for the first occurrence (0 = placement day).',
        validationRules: 'Integer >= 0.',
        example: '21',
      },
      {
        name: 'interval_unit',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'once',
        allowedValues: ['once', 'hour', 'day', 'week', 'month'],
        description: 'Recurrence frequency unit.',
        validationRules: 'Must be "once", "hour", "day", "week", or "month".',
        example: 'once',
      },
      {
        name: 'interval_value',
        type: 'INTEGER',
        isRequired: false,
        defaultValue: 1,
        description: 'Recurrence interval count (ignored if interval_unit is "once").',
        validationRules: 'Integer >= 1.',
        example: '1',
      },
      {
        name: 'sort_order',
        type: 'INTEGER',
        isRequired: false,
        defaultValue: 0,
        description: 'Display order in timeline.',
        validationRules: 'Integer.',
        example: '1',
      },
    ],
    indexes: [{ name: 'idx_cpi_plan', columns: ['care_plan_id'] }],
  },

  {
    tableName: 'farm_reminders',
    displayName: 'Due Reminders & Action Milestones',
    purpose: 'Active reminders and due tasks generated from care plans or created manually for pens/batches.',
    order: 17,
    columns: [
      {
        name: 'id',
        type: 'TEXT',
        isPrimaryKey: true,
        isRequired: true,
        description: 'Unique reminder identifier.',
        validationRules: 'Required unique non-empty text.',
        example: 'rem-2026-01-26-lasota',
      },
      {
        name: 'batch_id',
        type: 'TEXT',
        isRequired: true,
        isForeignKey: true,
        foreignTable: 'batches',
        foreignColumn: 'id',
        description: 'Identifier of the targeted flock batch.',
        validationRules: 'Must reference a valid batch in batches table.',
        example: 'batch-layer-2026-01',
      },
      {
        name: 'pen_id',
        type: 'TEXT',
        isRequired: true,
        isForeignKey: true,
        foreignTable: 'pens',
        foreignColumn: 'id',
        description: 'Identifier of the targeted housing pen.',
        validationRules: 'Must reference a valid pen in pens table.',
        example: 'pen-house-1',
      },
      {
        name: 'milestone_key',
        type: 'TEXT',
        isRequired: false,
        description: 'Deduplication key for recurring care items.',
        validationRules: 'Optional text.',
        example: 'milestone_deworming_w30',
      },
      {
        name: 'reminder_type',
        type: 'TEXT',
        isRequired: true,
        allowedValues: [
          'vaccination',
          'medication',
          'milestone',
          'feeding',
          'maintenance',
          'inspection',
          'cleaning',
          'water_management',
          'animal_management',
          'biosecurity',
          'monitoring',
          'general',
        ],
        description: 'Activity classification.',
        validationRules: 'Must match one of the allowed reminder types.',
        example: 'vaccination',
      },
      {
        name: 'title',
        type: 'TEXT',
        isRequired: true,
        description: 'Action title.',
        validationRules: 'Required text.',
        example: 'Gumboro Booster Vaccination',
      },
      {
        name: 'due_date',
        type: 'TEXT',
        isRequired: true,
        description: 'Due date in YYYY-MM-DD format.',
        validationRules: 'Required ISO date format YYYY-MM-DD.',
        example: '2026-01-26',
      },
      {
        name: 'target_age_days',
        type: 'INTEGER',
        isRequired: false,
        description: 'Expected age in days of the flock on due date.',
        validationRules: 'Optional integer >= 0.',
        example: '133',
      },
      {
        name: 'dosage_or_action',
        type: 'TEXT',
        isRequired: false,
        description: 'Prescribed dosage or instruction.',
        validationRules: 'Optional text.',
        example: 'In drinking water with skimmed milk stabilizer.',
      },
      {
        name: 'notes',
        type: 'TEXT',
        isRequired: false,
        description: 'Special operational notes.',
        validationRules: 'Optional text.',
        example: 'Check ambient temperatures before opening vaccines.',
      },
      {
        name: 'status',
        type: 'TEXT',
        isRequired: false,
        defaultValue: 'pending',
        allowedValues: ['pending', 'in_progress', 'completed', 'dismissed', 'skipped', 'cancelled'],
        description: 'Task resolution status.',
        validationRules: 'Must be "pending", "in_progress", "completed", "dismissed", "skipped", or "cancelled".',
        example: 'pending',
      },
    ],
    indexes: [
      { name: 'idx_rem_batch', columns: ['batch_id'] },
      { name: 'idx_rem_date', columns: ['due_date'] },
    ],
  },
];

/**
 * Generate DDL for creating all tables, constraints, and indexes in SQLite.
 */
export function generateSchemaSql(): string {
  const statements: string[] = [];

  // Metadata table
  statements.push(`
CREATE TABLE IF NOT EXISTS _template_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);`);

  for (const table of TABLE_DEFINITIONS) {
    const colDefs: string[] = [];
    const foreignKeys: string[] = [];

    for (const col of table.columns) {
      let def = `  ${col.name} ${col.type}`;
      if (col.isPrimaryKey) {
        def += ' PRIMARY KEY';
      } else if (col.isRequired) {
        def += ' NOT NULL';
      }
      if (col.defaultValue !== undefined && col.defaultValue !== null) {
        if (typeof col.defaultValue === 'string') {
          def += ` DEFAULT '${col.defaultValue.replace(/'/g, "''")}'`;
        } else {
          def += ` DEFAULT ${col.defaultValue}`;
        }
      }
      colDefs.push(def);

      if (col.isForeignKey && col.foreignTable && col.foreignColumn) {
        foreignKeys.push(
          `  FOREIGN KEY (${col.name}) REFERENCES ${col.foreignTable}(${col.foreignColumn}) ON UPDATE CASCADE ON DELETE RESTRICT`
        );
      }
    }

    const allClauses = [...colDefs, ...foreignKeys].join(',\n');
    statements.push(`CREATE TABLE IF NOT EXISTS ${table.tableName} (\n${allClauses}\n);`);

    if (table.indexes) {
      for (const idx of table.indexes) {
        statements.push(
          `CREATE INDEX IF NOT EXISTS ${idx.name} ON ${table.tableName} (${idx.columns.join(', ')});`
        );
      }
    }
  }

  return statements.join('\n\n');
}

/**
 * Generate documentation text for a single table.
 */
export function generateTableDocumentation(table: TableDefinition): string {
  const lines: string[] = [];
  lines.push(`================================================================================`);
  lines.push(`TABLE SPECIFICATION: ${table.tableName.toUpperCase()}`);
  lines.push(`Display Name: ${table.displayName}`);
  lines.push(`Suggested Population Order: Stage ${table.order}`);
  lines.push(`================================================================================`);
  lines.push('');
  lines.push(`1. PURPOSE:`);
  lines.push(`   ${table.purpose}`);
  lines.push('');
  lines.push(`2. COLUMNS & DATA SPECIFICATIONS:`);
  lines.push('');

  for (const col of table.columns) {
    lines.push(`--------------------------------------------------------------------------------`);
    lines.push(`Column: ${col.name}`);
    lines.push(`--------------------------------------------------------------------------------`);
    lines.push(`- Description:       ${col.description}`);
    lines.push(`- SQLite Data Type:  ${col.type}`);
    lines.push(`- Compulsory:        ${col.isRequired ? 'REQUIRED (Must be populated before import)' : 'OPTIONAL (Can remain empty or NULL)'}`);
    lines.push(`- Key Type:          ${col.isPrimaryKey ? 'PRIMARY KEY (Unique record identifier)' : col.isForeignKey ? `FOREIGN KEY (References ${col.foreignTable}.${col.foreignColumn})` : 'Attribute'}`);
    if (col.defaultValue !== undefined && col.defaultValue !== null) {
      lines.push(`- Default Value:     ${col.defaultValue}`);
    }
    if (col.allowedValues && col.allowedValues.length > 0) {
      lines.push(`- Allowed Values:    ${col.allowedValues.map((v) => `"${v}"`).join(' | ')}`);
    }
    lines.push(`- Validation Rules:  ${col.validationRules}`);
    lines.push(`- Example Valid:     ${col.example}`);
    lines.push('');
  }

  lines.push(`3. RELATIONSHIPS & DEPENDENCIES:`);
  const foreignCols = table.columns.filter((c) => c.isForeignKey);
  if (foreignCols.length === 0) {
    lines.push(`   This table has no foreign key dependencies. It can be populated independently.`);
  } else {
    lines.push(`   This table depends on related records in other tables:`);
    for (const c of foreignCols) {
      lines.push(`   - Column "${c.name}" must contain an ID that already exists in table "${c.foreignTable}" (column "${c.foreignColumn}").`);
    }
    lines.push(`   Ensure parent records are imported or defined before populating this table.`);
  }
  lines.push('');

  lines.push(`4. BEST PRACTICES FOR BULK DATA ENTRY:`);
  lines.push(`   - Use ISO date format "YYYY-MM-DD" for all date columns (e.g. 2026-01-15).`);
  lines.push(`   - Use 24-hour time format "HH:mm" for time columns (e.g. 08:30 or 16:45).`);
  lines.push(`   - Do not enter negative numbers for counts, crates, pieces, prices, or weights.`);
  lines.push(`   - Do not modify column names or table names in the SQLite database.`);
  lines.push(`   - You can edit this SQLite database using DB Browser for SQLite, SQLiteStudio, or Python.`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate README.txt content for the template package.
 */
export function generateReadmeDocumentation(): string {
  const lines: string[] = [];
  lines.push(`================================================================================`);
  lines.push(`BABAGIWA FARM MANAGEMENT — DATA IMPORT & EXPORT PACKAGE`);
  lines.push(`================================================================================`);
  lines.push(`Template Version:    ${TEMPLATE_VERSION}`);
  lines.push(`Schema Version:      ${SCHEMA_VERSION}`);
  lines.push(`Application:         ${APPLICATION_NAME}`);
  lines.push(`Generated:           ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`ABOUT THIS TEMPLATE:`);
  lines.push(`--------------------------------------------------------------------------------`);
  lines.push(`This package provides a blank portable SQLite database (Farm_Data_Template.db)`);
  lines.push(`and comprehensive column-level documentation for populating your farm records`);
  lines.push(`in bulk.`);
  lines.push('');
  lines.push(`It is designed to make it effortless to migrate historical records from spreadsheets,`);
  lines.push(`logbooks, or legacy software into Babagiwa Farm Management without tedious manual`);
  lines.push(`single-record entry.`);
  lines.push('');
  lines.push(`RECOMMENDED SOFTWARE TOOLS:`);
  lines.push(`--------------------------------------------------------------------------------`);
  lines.push(`You can open and populate "Farm_Data_Template.db" with any standard SQLite tool:`);
  lines.push(`  1. DB Browser for SQLite (Free, Windows/Mac/Linux): https://sqlitebrowser.org/`);
  lines.push(`  2. SQLiteStudio (Free & Open Source): https://sqlitestudio.pl/`);
  lines.push(`  3. DBeaver Community (Free multi-platform DB client): https://dbeaver.io/`);
  lines.push(`  4. Python scripts using built-in 'sqlite3' and 'pandas' libraries.`);
  lines.push(`  5. Excel / Power BI using SQLite ODBC / connectors.`);
  lines.push('');
  lines.push(`SUGGESTED POPULATION ORDER (REFERENTIAL INTEGRITY):`);
  lines.push(`--------------------------------------------------------------------------------`);
  lines.push(`Because tables reference one another through Foreign Keys, populate tables in`);
  lines.push(`this recommended chronological order:`);
  lines.push('');

  const sortedTables = [...TABLE_DEFINITIONS].sort((a, b) => a.order - b.order);
  for (const t of sortedTables) {
    lines.push(`  Stage ${t.order.toString().padStart(2, ' ')}: ${t.tableName.padEnd(22, ' ')} - ${t.displayName}`);
  }

  lines.push('');
  lines.push(`KEY VALIDATION RULES TO OBSERVE:`);
  lines.push(`--------------------------------------------------------------------------------`);
  lines.push(`1. DATE FORMATS: Must strictly use ISO format "YYYY-MM-DD" (e.g. 2026-03-25).`);
  lines.push(`2. TIME FORMATS: Use 24-hour format "HH:mm" (e.g. 08:30, 14:15).`);
  lines.push(`3. PRIMARY KEYS: Column "id" in every table must be unique. You can use`);
  lines.push(`   descriptive codes like "pen-01", "batch-2026-01", or UUIDs.`);
  lines.push(`4. FOREIGN KEYS: When entering records in child tables (e.g. egg_production),`);
  lines.push(`   the "batch_id" and "pen_id" values MUST match an existing "id" in "batches"`);
  lines.push(`   and "pens".`);
  lines.push(`5. CATEGORIES & STATUS: Strictly use the allowed values listed in each table's`);
  lines.push(`   documentation file (e.g. status: "active" | "inactive").`);
  lines.push(`6. NUMERICAL QUANTITIES: Quantities, counts, and prices must not be negative.`);
  lines.push('');
  lines.push(`IMPORTING INTO THE APPLICATION:`);
  lines.push(`--------------------------------------------------------------------------------`);
  lines.push(`1. Open Babagiwa Farm Management application.`);
  lines.push(`2. Navigate to: Farm Management -> Data Import & Export.`);
  lines.push(`3. Under "Import Farm Data", select your completed SQLite (.db) file.`);
  lines.push(`4. The system will automatically perform structural and record-level validation.`);
  lines.push(`5. Review the comprehensive Validation Report.`);
  lines.push(`6. Confirm import. The records will be safely staged and inserted into your`);
  lines.push(`   farm account.`);
  lines.push('');
  lines.push(`DOCUMENTATION FILES INCLUDED IN THIS PACKAGE:`);
  lines.push(`--------------------------------------------------------------------------------`);
  for (const t of sortedTables) {
    lines.push(`  - Documentation/${t.tableName}.txt`);
  }
  lines.push('');
  lines.push(`================================================================================`);

  return lines.join('\n');
}
