// db.js - SQLite database initialization and data access layer for Pharmacy Expiry Tracking
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = path.join(__dirname, 'pharmacy_inventory.db');
const db = new DatabaseSync(DB_PATH);

// Initialize Tables
function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drugs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ndc TEXT NOT NULL,
      name TEXT NOT NULL,
      generic_name TEXT NOT NULL,
      dosage_form TEXT NOT NULL,
      strength TEXT NOT NULL,
      batch_number TEXT NOT NULL UNIQUE,
      expiry_date TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost REAL NOT NULL,
      retail_price REAL NOT NULL,
      shelf_location TEXT NOT NULL,
      storage_condition TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drug_id INTEGER,
      drug_name TEXT NOT NULL,
      batch_number TEXT NOT NULL,
      action TEXT NOT NULL,
      quantity_change INTEGER DEFAULT 0,
      details TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Default settings
  const checkSetting = db.prepare('SELECT value FROM system_settings WHERE key = ?');
  if (!checkSetting.get('time_offset_ms')) {
    db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)').run('time_offset_ms', '0');
  }
  if (!checkSetting.get('critical_days_threshold')) {
    db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)').run('critical_days_threshold', '30');
  }
  if (!checkSetting.get('warning_days_threshold')) {
    db.prepare('INSERT INTO system_settings (key, value) VALUES (?, ?)').run('warning_days_threshold', '90');
  }

  // Check if sample drugs exist; if empty, seed with realistic retail pharmacy dataset
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM drugs');
  const result = countStmt.get();
  if (result.count === 0) {
    seedInitialDrugs();
  }
}

// Seed realistic retail pharmacy drugs relative to 2026-11-04
function seedInitialDrugs() {
  console.log('Seeding initial pharmacy inventory with realistic batches...');

  const insertDrug = db.prepare(`
    INSERT INTO drugs (
      ndc, name, generic_name, dosage_form, strength,
      batch_number, expiry_date, quantity, unit_cost, retail_price,
      shelf_location, storage_condition, category, status, notes
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    )
  `);

  const initialDrugs = [
    // 1. ALREADY EXPIRED (Must be quarantined immediately!)
    {
      ndc: '00069-3150-14',
      name: 'Zithromax (Azithromycin)',
      generic_name: 'Azithromycin',
      dosage_form: 'Tablet',
      strength: '250 mg',
      batch_number: 'AZM-9021',
      expiry_date: '2026-10-14T23:59:59', // Expired 21 days ago
      quantity: 18,
      unit_cost: 4.50,
      retail_price: 18.99,
      shelf_location: 'Aisle 2 - Shelf A1',
      storage_condition: 'Room Temp (20-25°C)',
      category: 'Antibiotics',
      status: 'active',
      notes: 'Expired 3 weeks ago! Immediate shelf pull required.'
    },
    {
      ndc: '00007-4401-20',
      name: 'Augmentin Suspension',
      generic_name: 'Amoxicillin / Clavulanate Potassium',
      dosage_form: 'Oral Powder for Suspension',
      strength: '250 mg / 62.5 mg per 5 mL',
      batch_number: 'AUG-8812',
      expiry_date: '2026-11-01T23:59:59', // Expired 3 days ago
      quantity: 12,
      unit_cost: 8.20,
      retail_price: 32.50,
      shelf_location: 'Fridge 1 - Middle Rack',
      storage_condition: 'Refrigerated (2-8°C)',
      category: 'Antibiotics',
      status: 'active',
      notes: 'Expired earlier this week. Reconstituted suspensions degrade rapidly.'
    },
    {
      ndc: '68180-478-01',
      name: 'Cephalexin',
      generic_name: 'Cephalexin Monohydrate',
      dosage_form: 'Capsule',
      strength: '500 mg',
      batch_number: 'CPH-3329',
      expiry_date: '2026-09-28T23:59:59', // Expired over 1 month ago
      quantity: 45,
      unit_cost: 0.85,
      retail_price: 5.20,
      shelf_location: 'Aisle 2 - Shelf B3',
      storage_condition: 'Room Temp (20-25°C)',
      category: 'Antibiotics',
      status: 'active',
      notes: 'High risk - overdue for manufacturer return/credit.'
    },

    // 2. CRITICAL - EXPIRING WITHIN 30 DAYS (FEFO urgent or supplier return)
    {
      ndc: '00024-5840-05',
      name: 'Lantus SoloStar (Insulin Glargine)',
      generic_name: 'Insulin Glargine',
      dosage_form: 'Subcutaneous Solution Pen',
      strength: '100 Units/mL (3 mL)',
      batch_number: 'LAN-7740',
      expiry_date: '2026-11-18T23:59:59', // In 14 days
      quantity: 10,
      unit_cost: 45.00,
      retail_price: 115.00,
      shelf_location: 'Fridge 1 - Top Rack',
      storage_condition: 'Refrigerated (2-8°C)',
      category: 'Endocrine & Diabetes',
      status: 'active',
      notes: 'Critical high-cost item! Prioritize immediate FEFO dispensing.'
    },
    {
      ndc: '00173-0682-20',
      name: 'Ventolin HFA (Albuterol)',
      generic_name: 'Albuterol Sulfate',
      dosage_form: 'Inhalation Aerosol',
      strength: '90 mcg/actuation (8.5 g)',
      batch_number: 'VNT-4122',
      expiry_date: '2026-11-26T23:59:59', // In 22 days
      quantity: 24,
      unit_cost: 14.50,
      retail_price: 42.00,
      shelf_location: 'Aisle 4 - Shelf C2',
      storage_condition: 'Room Temp (20-25°C)',
      category: 'Respiratory',
      status: 'active',
      notes: 'Expiring in under 4 weeks. High demand item.'
    },
    {
      ndc: '68382-028-10',
      name: 'Metformin HCl ER',
      generic_name: 'Metformin Hydrochloride Extended Release',
      dosage_form: 'Tablet ER',
      strength: '500 mg',
      batch_number: 'MET-5541',
      expiry_date: '2026-12-02T23:59:59', // In 28 days
      quantity: 120,
      unit_cost: 0.12,
      retail_price: 0.45,
      shelf_location: 'Aisle 1 - Shelf D1',
      storage_condition: 'Room Temp (20-25°C)',
      category: 'Endocrine & Diabetes',
      status: 'active',
      notes: 'Nearest expiring batch for Metformin.'
    },

    // 3. WARNING - EXPIRING IN 30 TO 90 DAYS (Vigilance, stop new purchase orders)
    {
      ndc: '00071-0155-23',
      name: 'Lipitor (Atorvastatin)',
      generic_name: 'Atorvastatin Calcium',
      dosage_form: 'Tablet',
      strength: '20 mg',
      batch_number: 'LIP-9901',
      expiry_date: '2026-12-22T23:59:59', // In 48 days
      quantity: 90,
      unit_cost: 0.35,
      retail_price: 1.25,
      shelf_location: 'Aisle 1 - Shelf B2',
      storage_condition: 'Room Temp (20-25°C)',
      category: 'Cardiovascular',
      status: 'active',
      notes: 'Dispense first before newer Jan 2028 batch.'
    },
    {
      ndc: '49502-500-02',
      name: 'EpiPen 2-Pak (Epinephrine)',
      generic_name: 'Epinephrine Auto-Injector',
      dosage_form: 'Auto-Injector',
      strength: '0.3 mg',
      batch_number: 'EPI-6218',
      expiry_date: '2027-01-15T23:59:59', // In 72 days
      quantity: 6,
      unit_cost: 95.00,
      retail_price: 240.00,
      shelf_location: 'Aisle 5 - Emergency Shelf E1',
      storage_condition: 'Room Temp (20-25°C, Protect from Light)',
      category: 'Emergency & Allergy',
      status: 'active',
      notes: 'Short shelf-life emergency product. Watch expiration carefully.'
    },
    {
      ndc: '00006-0740-54',
      name: 'Prinivil (Lisinopril)',
      generic_name: 'Lisinopril',
      dosage_form: 'Tablet',
      strength: '10 mg',
      batch_number: 'LIS-3814',
      expiry_date: '2027-01-28T23:59:59', // In 85 days
      quantity: 150,
      unit_cost: 0.18,
      retail_price: 0.65,
      shelf_location: 'Aisle 1 - Shelf C3',
      storage_condition: 'Room Temp (20-25°C)',
      category: 'Cardiovascular',
      status: 'active',
      notes: 'Batch expiring early next quarter.'
    },

    // 4. SAFE INVENTORY (> 90 DAYS / Long Expiry)
    {
      ndc: '00007-4401-20',
      name: 'Augmentin Suspension',
      generic_name: 'Amoxicillin / Clavulanate Potassium',
      dosage_form: 'Oral Powder for Suspension',
      strength: '250 mg / 62.5 mg per 5 mL',
      batch_number: 'AUG-9104',
      expiry_date: '2027-08-30T23:59:59', // Fresh batch
      quantity: 50,
      unit_cost: 8.20,
      retail_price: 32.50,
      shelf_location: 'Fridge 1 - Middle Rack',
      storage_condition: 'Refrigerated (2-8°C)',
      category: 'Antibiotics',
      status: 'active',
      notes: 'Fresh stock received last month.'
    },
    {
      ndc: '00024-5840-05',
      name: 'Lantus SoloStar (Insulin Glargine)',
      generic_name: 'Insulin Glargine',
      dosage_form: 'Subcutaneous Solution Pen',
      strength: '100 Units/mL (3 mL)',
      batch_number: 'LAN-8302',
      expiry_date: '2027-10-15T23:59:59', // Fresh batch
      quantity: 40,
      unit_cost: 45.00,
      retail_price: 115.00,
      shelf_location: 'Fridge 1 - Top Rack',
      storage_condition: 'Refrigerated (2-8°C)',
      category: 'Endocrine & Diabetes',
      status: 'active',
      notes: 'New delivery batch.'
    },
    {
      ndc: '00071-0155-23',
      name: 'Lipitor (Atorvastatin)',
      generic_name: 'Atorvastatin Calcium',
      dosage_form: 'Tablet',
      strength: '20 mg',
      batch_number: 'LIP-0498',
      expiry_date: '2028-04-30T23:59:59', // 1.5 years out
      quantity: 300,
      unit_cost: 0.35,
      retail_price: 1.25,
      shelf_location: 'Aisle 1 - Shelf B2',
      storage_condition: 'Room Temp (20-25°C)',
      category: 'Cardiovascular',
      status: 'active',
      notes: 'Surplus back stock.'
    },
    {
      ndc: '00069-4200-30',
      name: 'Zoloft (Sertraline)',
      generic_name: 'Sertraline Hydrochloride',
      dosage_form: 'Tablet',
      strength: '50 mg',
      batch_number: 'ZOL-1922',
      expiry_date: '2027-11-20T23:59:59',
      quantity: 180,
      unit_cost: 0.42,
      retail_price: 1.40,
      shelf_location: 'Aisle 3 - Shelf D4',
      storage_condition: 'Room Temp (20-25°C)',
      category: 'Psychiatry & Neurology',
      status: 'active',
      notes: 'Standard healthy inventory.'
    },
    {
      ndc: '50580-496-01',
      name: 'Tylenol Extra Strength',
      generic_name: 'Acetaminophen',
      dosage_form: 'Caplet',
      strength: '500 mg',
      batch_number: 'TYL-7719',
      expiry_date: '2028-06-30T23:59:59',
      quantity: 250,
      unit_cost: 0.08,
      retail_price: 0.30,
      shelf_location: 'OTC Front Section - Bay 1',
      storage_condition: 'Room Temp (20-25°C)',
      category: 'Analgesics & OTC',
      status: 'active',
      notes: 'High volume OTC staple.'
    },

    // 5. SAMPLE QUARANTINED ITEM (Shows the segregated quarantine area)
    {
      ndc: '00781-2613-05',
      name: 'Doxycycline Hyclate',
      generic_name: 'Doxycycline Hyclate',
      dosage_form: 'Capsule',
      strength: '100 mg',
      batch_number: 'DOX-1102',
      expiry_date: '2026-08-15T23:59:59',
      quantity: 30,
      unit_cost: 1.10,
      retail_price: 4.80,
      shelf_location: 'QUARANTINE BIN #4 - HazMat Storage',
      storage_condition: 'Room Temp (20-25°C)',
      category: 'Antibiotics',
      status: 'quarantined',
      notes: 'Pulled from shelves on 2026-08-16. Awaiting hazardous pharmaceutical waste pickup.'
    }
  ];

  for (const d of initialDrugs) {
    insertDrug.run(
      d.ndc, d.name, d.generic_name, d.dosage_form, d.strength,
      d.batch_number, d.expiry_date, d.quantity, d.unit_cost, d.retail_price,
      d.shelf_location, d.storage_condition, d.category, d.status, d.notes
    );
  }

  // Insert initial audit logs
  const insertAudit = db.prepare(`
    INSERT INTO audit_logs (drug_id, drug_name, batch_number, action, quantity_change, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertAudit.run(1, 'Zithromax (Azithromycin)', 'AZM-9021', 'SYSTEM_AUDIT', 0, 'Initial inventory scan flagged batch as EXPIRED on 2026-10-14');
  insertAudit.run(2, 'Augmentin Suspension', 'AUG-8812', 'SYSTEM_AUDIT', 0, 'Initial inventory scan flagged batch as EXPIRED on 2026-11-01');
  insertAudit.run(4, 'Lantus SoloStar (Insulin Glargine)', 'LAN-7740', 'ALERT_CRITICAL', 0, '14 days remaining until expiry. Tagged for FEFO dispensing priority.');

  console.log('Pharmacy database seeded successfully.');
}

// Time offset management
function getTimeOffset() {
  const row = db.prepare("SELECT value FROM system_settings WHERE key = 'time_offset_ms'").get();
  return row ? parseInt(row.value, 10) : 0;
}

function setTimeOffset(offsetMs) {
  db.prepare("UPDATE system_settings SET value = ? WHERE key = 'time_offset_ms'").run(offsetMs.toString());
}

function getEffectiveTime() {
  return new Date(Date.now() + getTimeOffset());
}

// Threshold settings
function getThresholds() {
  const crit = db.prepare("SELECT value FROM system_settings WHERE key = 'critical_days_threshold'").get();
  const warn = db.prepare("SELECT value FROM system_settings WHERE key = 'warning_days_threshold'").get();
  return {
    criticalDays: crit ? parseInt(crit.value, 10) : 30,
    warningDays: warn ? parseInt(warn.value, 10) : 90
  };
}

// Calculate real-time expiration metadata for a drug
function calculateExpiryDetails(drug, effectiveNow, thresholds) {
  const expiryTime = new Date(drug.expiry_date).getTime();
  const nowTime = effectiveNow.getTime();
  const diffMs = expiryTime - nowTime;

  const isExpired = diffMs <= 0;
  const totalSeconds = Math.floor(Math.abs(diffMs) / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let statusLevel = 'safe';
  let badgeColor = 'emerald';
  let statusText = 'Good';

  if (drug.status === 'quarantined') {
    statusLevel = 'quarantined';
    badgeColor = 'purple';
    statusText = 'Quarantined';
  } else if (drug.status === 'disposed') {
    statusLevel = 'disposed';
    badgeColor = 'zinc';
    statusText = 'Disposed';
  } else if (isExpired) {
    statusLevel = 'expired';
    badgeColor = 'rose';
    statusText = 'EXPIRED';
  } else if (days <= thresholds.criticalDays) {
    statusLevel = 'critical';
    badgeColor = 'red';
    statusText = 'Critical (< ' + thresholds.criticalDays + 'd)';
  } else if (days <= thresholds.warningDays) {
    statusLevel = 'warning';
    badgeColor = 'amber';
    statusText = 'Expiring Soon (' + days + 'd)';
  }

  return {
    ...drug,
    effective_now: effectiveNow.toISOString(),
    is_expired: isExpired,
    diff_ms: diffMs,
    days_remaining: isExpired ? -days : days,
    hours_remaining: hours,
    minutes_remaining: minutes,
    seconds_remaining: seconds,
    status_level: statusLevel,
    badge_color: badgeColor,
    status_text: statusText,
    inventory_value: +(drug.quantity * drug.unit_cost).toFixed(2),
    retail_value: +(drug.quantity * drug.retail_price).toFixed(2)
  };
}

// Get all drugs with real-time expiration calculations
function getAllDrugs(filters = {}) {
  const effectiveNow = getEffectiveTime();
  const thresholds = getThresholds();

  let query = 'SELECT * FROM drugs WHERE 1=1';
  const params = [];

  if (filters.status && filters.status !== 'all') {
    query += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters.category && filters.category !== 'all') {
    query += ' AND category = ?';
    params.push(filters.category);
  }
  if (filters.search) {
    query += ' AND (name LIKE ? OR generic_name LIKE ? OR batch_number LIKE ? OR ndc LIKE ? OR shelf_location LIKE ?)';
    const term = `%${filters.search}%`;
    params.push(term, term, term, term, term);
  }

  query += ' ORDER BY expiry_date ASC';

  const rows = db.prepare(query).all(...params);
  let evaluated = rows.map(r => calculateExpiryDetails(r, effectiveNow, thresholds));

  // Filter by expiry category if specified
  if (filters.expiryStatus) {
    if (filters.expiryStatus === 'expired') {
      evaluated = evaluated.filter(d => d.status === 'active' && d.is_expired);
    } else if (filters.expiryStatus === 'critical') {
      evaluated = evaluated.filter(d => d.status === 'active' && !d.is_expired && d.days_remaining <= thresholds.criticalDays);
    } else if (filters.expiryStatus === 'warning') {
      evaluated = evaluated.filter(d => d.status === 'active' && !d.is_expired && d.days_remaining > thresholds.criticalDays && d.days_remaining <= thresholds.warningDays);
    } else if (filters.expiryStatus === 'safe') {
      evaluated = evaluated.filter(d => d.status === 'active' && !d.is_expired && d.days_remaining > thresholds.warningDays);
    } else if (filters.expiryStatus === 'quarantined') {
      evaluated = evaluated.filter(d => d.status === 'quarantined');
    }
  }

  // Tag FEFO recommendations: for each unique drug name, mark the oldest active non-expired batch
  const fefoMap = new Set();
  evaluated.forEach(item => {
    if (item.status === 'active' && !item.is_expired && !fefoMap.has(item.name)) {
      item.is_fefo_first = true;
      fefoMap.add(item.name);
    } else {
      item.is_fefo_first = false;
    }
  });

  return evaluated;
}

// Get single drug
function getDrugById(id) {
  const drug = db.prepare('SELECT * FROM drugs WHERE id = ?').get(id);
  if (!drug) return null;
  const effectiveNow = getEffectiveTime();
  const thresholds = getThresholds();
  return calculateExpiryDetails(drug, effectiveNow, thresholds);
}

// Add new drug batch
function addDrug(drugData) {
  const insert = db.prepare(`
    INSERT INTO drugs (
      ndc, name, generic_name, dosage_form, strength,
      batch_number, expiry_date, quantity, unit_cost, retail_price,
      shelf_location, storage_condition, category, status, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `);

  const result = insert.run(
    drugData.ndc,
    drugData.name,
    drugData.generic_name || drugData.name,
    drugData.dosage_form || 'Tablet',
    drugData.strength || '',
    drugData.batch_number,
    drugData.expiry_date,
    parseInt(drugData.quantity, 10),
    parseFloat(drugData.unit_cost || 0),
    parseFloat(drugData.retail_price || 0),
    drugData.shelf_location || 'Aisle 1 - General',
    drugData.storage_condition || 'Room Temp (20-25°C)',
    drugData.category || 'General',
    drugData.notes || ''
  );

  const newId = result.lastInsertRowid;

  // Log to audit
  db.prepare(`
    INSERT INTO audit_logs (drug_id, drug_name, batch_number, action, quantity_change, details)
    VALUES (?, ?, ?, 'STOCK_ADDED', ?, ?)
  `).run(
    newId,
    drugData.name,
    drugData.batch_number,
    parseInt(drugData.quantity, 10),
    `Received new batch with expiry date ${drugData.expiry_date} at location ${drugData.shelf_location}`
  );

  return getDrugById(newId);
}

// Update drug
function updateDrug(id, updateData) {
  const current = getDrugById(id);
  if (!current) throw new Error('Drug not found');

  const update = db.prepare(`
    UPDATE drugs SET
      name = ?, generic_name = ?, dosage_form = ?, strength = ?,
      shelf_location = ?, storage_condition = ?, category = ?,
      notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  update.run(
    updateData.name || current.name,
    updateData.generic_name || current.generic_name,
    updateData.dosage_form || current.dosage_form,
    updateData.strength || current.strength,
    updateData.shelf_location || current.shelf_location,
    updateData.storage_condition || current.storage_condition,
    updateData.category || current.category,
    updateData.notes !== undefined ? updateData.notes : current.notes,
    id
  );

  db.prepare(`
    INSERT INTO audit_logs (drug_id, drug_name, batch_number, action, details)
    VALUES (?, ?, ?, 'UPDATED', ?)
  `).run(id, current.name, current.batch_number, 'Updated batch metadata and shelf location');

  return getDrugById(id);
}

// Dispense drug with critical safety guard
function dispenseDrug(id, quantityToDispense) {
  const drug = getDrugById(id);
  if (!drug) throw new Error('Drug not found');

  const qty = parseInt(quantityToDispense, 10);
  if (isNaN(qty) || qty <= 0) {
    throw new Error('Invalid dispensing quantity');
  }

  // CRITICAL SAFETY CHECK: Disallow dispensing expired drugs!
  if (drug.is_expired) {
    // Record safety violation block in audit trail
    db.prepare(`
      INSERT INTO audit_logs (drug_id, drug_name, batch_number, action, quantity_change, details)
      VALUES (?, ?, ?, 'DISPENSE_BLOCKED', ?, ?)
    `).run(
      id, drug.name, drug.batch_number, 0,
      `PATIENT SAFETY LOCK: Attempted to dispense ${qty} units of EXPIRED drug batch ${drug.batch_number} (Expired on ${drug.expiry_date}). System blocked transaction!`
    );

    const error = new Error(`PATIENT SAFETY VIOLATION: Batch ${drug.batch_number} is EXPIRED since ${drug.expiry_date.slice(0, 10)}. Retail pharmacy regulations prohibit dispensing expired stock.`);
    error.status = 403;
    error.isExpiredSafetyBlock = true;
    error.drug = drug;
    throw error;
  }

  if (drug.status !== 'active') {
    throw new Error(`Cannot dispense drug with status '${drug.status}'. Item is not in active inventory.`);
  }

  if (drug.quantity < qty) {
    throw new Error(`Insufficient stock: requested ${qty}, available ${drug.quantity}`);
  }

  const remaining = drug.quantity - qty;
  db.prepare("UPDATE drugs SET quantity = ?, updated_at = datetime('now') WHERE id = ?").run(remaining, id);

  db.prepare(`
    INSERT INTO audit_logs (drug_id, drug_name, batch_number, action, quantity_change, details)
    VALUES (?, ?, ?, 'DISPENSED', ?, ?)
  `).run(
    id, drug.name, drug.batch_number, -qty,
    `Dispensed ${qty} units (${remaining} remaining in stock). Batch expiry: ${drug.expiry_date.slice(0, 10)}.`
  );

  return getDrugById(id);
}

// Move drug to quarantine (quarantines expired or recalled batches)
function quarantineDrug(id, reason = 'Expired / Quarantined for disposal or vendor return') {
  const drug = getDrugById(id);
  if (!drug) throw new Error('Drug not found');

  db.prepare(`
    UPDATE drugs SET
      status = 'quarantined',
      shelf_location = 'QUARANTINE BIN - Segregated Storage',
      notes = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(`Quarantined: ${reason}`, id);

  db.prepare(`
    INSERT INTO audit_logs (drug_id, drug_name, batch_number, action, details)
    VALUES (?, ?, ?, 'QUARANTINED', ?)
  `).run(
    id, drug.name, drug.batch_number,
    `Batch quarantined. Reason: ${reason}. Moved from ${drug.shelf_location} to Segregated Quarantine Bin.`
  );

  return getDrugById(id);
}

// Quarantine ALL active expired batches in 1 click
function quarantineAllExpired() {
  const drugs = getAllDrugs({ status: 'active' });
  const expiredDrugs = drugs.filter(d => d.is_expired);

  const results = [];
  for (const d of expiredDrugs) {
    quarantineDrug(d.id, 'Automated real-time safety pull: Expired batch removed from active dispensing shelf');
    results.push(d);
  }

  return results;
}

// Mark drug as disposed
function disposeDrug(id, disposalMethod = 'Hazardous Pharmaceutical Incineration') {
  const drug = getDrugById(id);
  if (!drug) throw new Error('Drug not found');

  db.prepare(`
    UPDATE drugs SET
      status = 'disposed',
      quantity = 0,
      notes = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(`Disposed on ${new Date().toISOString()}: ${disposalMethod}`, id);

  db.prepare(`
    INSERT INTO audit_logs (drug_id, drug_name, batch_number, action, quantity_change, details)
    VALUES (?, ?, ?, 'DISPOSED', ?, ?)
  `).run(
    id, drug.name, drug.batch_number, -drug.quantity,
    `Disposed ${drug.quantity} units via ${disposalMethod}. Regulatory compliance manifest completed.`
  );

  return getDrugById(id);
}

// Get comprehensive real-time KPI statistics
function getStatistics() {
  const effectiveNow = getEffectiveTime();
  const thresholds = getThresholds();
  const allDrugs = db.prepare('SELECT * FROM drugs').all();
  const evaluated = allDrugs.map(d => calculateExpiryDetails(d, effectiveNow, thresholds));

  const activeDrugs = evaluated.filter(d => d.status === 'active');
  const quarantinedDrugs = evaluated.filter(d => d.status === 'quarantined');
  const disposedDrugs = evaluated.filter(d => d.status === 'disposed');

  const expiredActive = activeDrugs.filter(d => d.is_expired);
  const criticalActive = activeDrugs.filter(d => !d.is_expired && d.days_remaining <= thresholds.criticalDays);
  const warningActive = activeDrugs.filter(d => !d.is_expired && d.days_remaining > thresholds.criticalDays && d.days_remaining <= thresholds.warningDays);
  const safeActive = activeDrugs.filter(d => !d.is_expired && d.days_remaining > thresholds.warningDays);

  const totalInventoryCost = activeDrugs.reduce((acc, d) => acc + (d.quantity * d.unit_cost), 0);
  const totalInventoryRetail = activeDrugs.reduce((acc, d) => acc + (d.quantity * d.retail_price), 0);
  const expiredCostLoss = expiredActive.reduce((acc, d) => acc + (d.quantity * d.unit_cost), 0);
  const criticalCostRisk = criticalActive.reduce((acc, d) => acc + (d.quantity * d.unit_cost), 0);
  const warningCostRisk = warningActive.reduce((acc, d) => acc + (d.quantity * d.unit_cost), 0);

  // Group by storage condition
  const storageBreakdown = {};
  activeDrugs.forEach(d => {
    const sc = d.storage_condition.split(' ')[0] || 'Room';
    storageBreakdown[sc] = (storageBreakdown[sc] || 0) + d.quantity;
  });

  // Group by category
  const categoryBreakdown = {};
  activeDrugs.forEach(d => {
    categoryBreakdown[d.category] = (categoryBreakdown[d.category] || 0) + 1;
  });

  return {
    effective_time: effectiveNow.toISOString(),
    time_offset_ms: getTimeOffset(),
    thresholds,
    counts: {
      total_batches: evaluated.length,
      active_batches: activeDrugs.length,
      quarantined_batches: quarantinedDrugs.length,
      disposed_batches: disposedDrugs.length,
      expired_active_on_shelf: expiredActive.length,
      critical_active: criticalActive.length,
      warning_active: warningActive.length,
      safe_active: safeActive.length,
    },
    units: {
      total_active_units: activeDrugs.reduce((a, b) => a + b.quantity, 0),
      expired_units_on_shelf: expiredActive.reduce((a, b) => a + b.quantity, 0),
      critical_units: criticalActive.reduce((a, b) => a + b.quantity, 0),
      warning_units: warningActive.reduce((a, b) => a + b.quantity, 0),
      safe_units: safeActive.reduce((a, b) => a + b.quantity, 0),
      quarantined_units: quarantinedDrugs.reduce((a, b) => a + b.quantity, 0)
    },
    financials: {
      total_cost_value: +totalInventoryCost.toFixed(2),
      total_retail_value: +totalInventoryRetail.toFixed(2),
      expired_loss_value: +expiredCostLoss.toFixed(2),
      critical_risk_value: +criticalCostRisk.toFixed(2),
      warning_risk_value: +warningCostRisk.toFixed(2),
      total_risk_value: +(expiredCostLoss + criticalCostRisk).toFixed(2)
    },
    storageBreakdown,
    categoryBreakdown
  };
}

// Get recent audit logs
function getAuditLogs(limit = 50) {
  return db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit);
}

module.exports = {
  initDatabase,
  getAllDrugs,
  getDrugById,
  addDrug,
  updateDrug,
  dispenseDrug,
  quarantineDrug,
  quarantineAllExpired,
  disposeDrug,
  getStatistics,
  getAuditLogs,
  getTimeOffset,
  setTimeOffset,
  getEffectiveTime
};
