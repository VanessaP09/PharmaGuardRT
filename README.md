# PharmaGuard™ - Real-Time Drug Expiry & Safety Management System

A high-performance, real-time drug expiration monitoring and FEFO (First Expired, First Out) dispensing system designed specifically for **retail pharmacies**.

---

## 🌟 Key Features

### 1. Real-Time Expiration Engine
- **Continuous Second-by-Second Evaluation**: Computes real-time remaining countdowns (`Expires in 14d 6h 32m 10s` or `EXPIRED 21d 4h ago`) without manual page refreshes.
- **Dynamic Risk Categorization**:
  - 🛑 **EXPIRED**: Expiration timestamp has passed. Active shelf-pull alerts triggered.
  - 🚨 **CRITICAL (< 30 Days)**: High risk of inventory loss; urgent priority for FEFO dispensing or supplier credit return (RMA).
  - ⚠️ **EXPIRING SOON (30–90 Days)**: Medium risk; re-orders frozen to prevent surplus accumulation.
  - 🛡️ **SAFE (> 90 Days)**: Standard healthy inventory.
- **Server-Sent Events (SSE) Live Broadcast**: All open pharmacy stations receive instantaneous updates when drugs are received, dispensed, or quarantined.

### 2. FEFO Dispensing & Safety Dispense Guard
- **Automated FEFO Priority**: When a pharmacist enters or scans a medication, the system recommends the batch with the nearest valid expiration date and directs the operator to the exact shelf location (e.g. `Fridge 1 - Top Rack` or `Aisle 2 - Shelf B3`).
- **Patient Safety Lock (Dispensing Guard)**: Disallows dispensing expired batches. If an operator attempts to dispense an expired drug, the transaction is **blocked**, an audible alarm sounds, and a regulatory violation event is logged in the immutable audit trail.

### 3. Retail Shelf-Pull & Segregated Quarantine Area
- **1-Click Mass Quarantine**: Quickly transfers all expired batches from active dispensing shelves into segregated quarantine storage.
- **Medical Incineration & Disposal Workflow**: Facilitates hazardous pharmaceutical waste manifestation and DEA/State Pharmacy Board compliance logs.

### 4. Regulatory Audit Trail & Compliance Export
- **Immutable Ledger**: Logs every stock addition, dispense, quarantine, safety violation attempt, and disposal with UTC timestamps.
- **1-Click Audit Export**: Generates compliant CSV audit reports ready for health authorities and state pharmacy inspectors.

### 5. Time Machine & Expiry Simulation
- Allows pharmacy quality assurance teams and auditors to simulate future dates (`+7 Days`, `+30 Days`, `+60 Days`, `+1 Year`) to test automated threshold alerts and quarantine triggers.

---

## 📂 Project Architecture

```
pharma-expiry-system/
├── server.js               # Node.js HTTP & SSE Server (zero external dependencies)
├── db.js                   # SQLite database (node:sqlite) with data access & expiry engine
├── pharmacy_inventory.db   # Persistent SQLite database
├── start.bat               # Windows 1-click startup launcher
├── public/
│   ├── index.html          # Clinical pharmacy UI dashboard
│   ├── app.js              # Real-time reactive client, live clock, SSE listener & Audio synthesis
│   └── style.css           # Custom clinical alerts and pulse animation styles
└── README.md               # System documentation & manual
```

---

## 🚀 How to Run

1. Open PowerShell or Command Prompt in this folder:
   ```powershell
   cd C:\Users\User\.gemini\antigravity\scratch\pharma-expiry-system
   ```
2. Start the server using `agy-node` or `node`:
   ```powershell
   agy-node server.js
   ```
   Or simply double-click `start.bat`.
3. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

---

## 📋 Pre-loaded Sample Inventory

The system comes pre-seeded with realistic retail pharmacy stock:
- **Expired Stock**: *Zithromax 250mg* (Aisle 2), *Augmentin Suspension* (Fridge 1), *Cephalexin 500mg* (Aisle 2).
- **Critical Stock (< 30d)**: *Lantus SoloStar Insulin* (Fridge 1, 14d left), *Ventolin Inhaler* (Aisle 4, 22d left), *Metformin ER* (Aisle 1, 28d left).
- **Warning Stock (30–90d)**: *Lipitor 20mg*, *EpiPen 2-Pak*, *Lisinopril 10mg*.
- **Safe Stock**: *Augmentin Suspension (Fresh Batch)*, *Lantus Insulin (Fresh Batch)*, *Zoloft 50mg*, *Tylenol 500mg*.
- **Quarantined Area**: *Doxycycline Hyclate 100mg* in Quarantine Bin #4.
