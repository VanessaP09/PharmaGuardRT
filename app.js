// public/app.js - PharmaGuard Real-Time Client Logic

// Application State
const state = {
  drugs: [],
  quarantinedDrugs: [],
  stats: null,
  activeFilter: 'all',
  categoryFilter: 'all',
  searchTerm: '',
  currentTab: 'inventory',
  selectedFefoDrugName: null,
  effectiveTime: new Date('2026-11-04T11:50:33+07:00'),
  timeOffsetMs: 0,
  soundEnabled: true,
  lastSafetyDrug: null,
  audioCtx: null
};

// Web Audio API Sound Generator for Clinical Alarms & Feedback
function initAudio() {
  if (!state.audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      state.audioCtx = new AudioContext();
    }
  }
}

function playSound(type) {
  if (!state.soundEnabled) return;
  try {
    initAudio();
    if (!state.audioCtx) return;
    if (state.audioCtx.state === 'suspended') {
      state.audioCtx.resume();
    }

    const ctx = state.audioCtx;
    const now = ctx.currentTime;

    if (type === 'beep-danger') {
      // Urgent double beep for safety block / expired alert
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(880, now);
      osc1.frequency.setValueAtTime(440, now + 0.15);
      gain1.gain.setValueAtTime(0.25, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.35);
    } else if (type === 'chime-success') {
      // Pleasant clinical confirmation chime
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880, now + 0.1); // A5
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === 'click') {
      // Subtle UI click
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(400, now);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
    }
  } catch (err) {
    console.warn('Audio playback error:', err);
  }
}

// Format date into human-readable pharmacy format
function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Compute live remaining countdown string
function getCountdownDetails(expiryIso, nowTime) {
  const expiryTime = new Date(expiryIso).getTime();
  const diffMs = expiryTime - nowTime.getTime();

  const isExpired = diffMs <= 0;
  const totalSeconds = Math.floor(Math.abs(diffMs) / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let countdownText = '';
  if (isExpired) {
    countdownText = `EXPIRED ${days}d ${hours}h ${minutes}m ago`;
  } else if (days === 0) {
    countdownText = `Expires TODAY (${hours}h ${minutes}m ${seconds}s)`;
  } else if (days < 30) {
    countdownText = `Expires in ${days}d ${hours}h ${minutes}m ${seconds}s`;
  } else {
    countdownText = `Expires in ${days} days`;
  }

  return { isExpired, days, hours, minutes, seconds, countdownText, diffMs };
}

// Toast notification helper
function showToast(title, message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `p-3.5 rounded-xl shadow-lg border text-xs max-w-sm flex items-start space-x-2.5 transition transform translate-y-2 opacity-0 pointer-events-auto`;

  if (type === 'danger') {
    toast.className += ' bg-rose-900 text-white border-rose-700';
    toast.innerHTML = `<i class="ph-bold ph-warning-octagon text-lg text-rose-300 shrink-0"></i><div><div class="font-bold">${title}</div><div>${message}</div></div>`;
  } else if (type === 'success') {
    toast.className += ' bg-slate-900 text-white border-slate-700';
    toast.innerHTML = `<i class="ph-bold ph-check-circle text-lg text-emerald-400 shrink-0"></i><div><div class="font-bold">${title}</div><div>${message}</div></div>`;
  } else if (type === 'warning') {
    toast.className += ' bg-amber-900 text-white border-amber-700';
    toast.innerHTML = `<i class="ph-bold ph-warning text-lg text-amber-300 shrink-0"></i><div><div class="font-bold">${title}</div><div>${message}</div></div>`;
  } else {
    toast.className += ' bg-slate-800 text-white border-slate-700';
    toast.innerHTML = `<i class="ph-bold ph-info text-lg text-blue-400 shrink-0"></i><div><div class="font-bold">${title}</div><div>${message}</div></div>`;
  }

  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

// Connect to Real-Time Server-Sent Events (SSE)
function initSSE() {
  const sseStatus = document.getElementById('sse-status');
  const eventSource = new EventSource('/api/events');

  eventSource.onopen = () => {
    sseStatus.textContent = 'CONNECTED';
    sseStatus.className = 'text-emerald-400 font-semibold font-mono';
  };

  eventSource.onerror = () => {
    sseStatus.textContent = 'RECONNECTING';
    sseStatus.className = 'text-amber-400 font-semibold font-mono';
  };

  // Heartbeat pulse with sync time
  eventSource.addEventListener('pulse', (e) => {
    const data = JSON.parse(e.data);
    state.effectiveTime = new Date(data.time);
    updateStatsCards(data.counts);
  });

  // Initial event
  eventSource.addEventListener('init', (e) => {
    const data = JSON.parse(e.data);
    state.effectiveTime = new Date(data.time);
    if (data.stats) updateStats(data.stats);
  });

  // Drug added
  eventSource.addEventListener('drug_added', (e) => {
    const data = JSON.parse(e.data);
    showToast('Batch Received', `Added ${data.drug.name} (Batch: ${data.drug.batch_number})`, 'success');
    playSound('chime-success');
    loadDrugs();
    loadStats();
  });

  // Drug dispensed
  eventSource.addEventListener('drug_dispensed', (e) => {
    const data = JSON.parse(e.data);
    showToast('Dispensed Safely', `Dispensed ${data.quantity} units of ${data.drug.name} (FEFO Verified)`, 'success');
    playSound('chime-success');
    loadDrugs();
    loadStats();
    if (state.currentTab === 'audit') loadAuditLogs();
  });

  // Drug quarantined
  eventSource.addEventListener('drug_quarantined', (e) => {
    const data = JSON.parse(e.data);
    showToast('Batch Quarantined', `${data.drug.name} moved to segregated quarantine`, 'warning');
    loadDrugs();
    loadQuarantinedDrugs();
    loadStats();
  });

  // Mass quarantine
  eventSource.addEventListener('mass_quarantine', (e) => {
    const data = JSON.parse(e.data);
    showToast('Safety Pull Completed', `Quarantined ${data.quarantined_count} expired batches from shelves`, 'success');
    playSound('chime-success');
    loadDrugs();
    loadQuarantinedDrugs();
    loadStats();
  });

  // Time shifted
  eventSource.addEventListener('time_shifted', (e) => {
    const data = JSON.parse(e.data);
    state.effectiveTime = new Date(data.effective_time);
    state.timeOffsetMs = data.offset_ms;
    showToast('Time Machine Shift', `Pharmacy clock adjusted to ${state.effectiveTime.toLocaleDateString()}`, 'info');
    loadDrugs();
    loadStats();
  });

  // Patient safety block alert
  eventSource.addEventListener('safety_alert', (e) => {
    const data = JSON.parse(e.data);
    playSound('beep-danger');
    triggerSafetyBlockModal(data.drug, data.message);
  });
}

// Load inventory list from server
async function loadDrugs() {
  try {
    const params = new URLSearchParams();
    if (state.activeFilter !== 'all') {
      params.append('expiryStatus', state.activeFilter);
    }
    if (state.categoryFilter !== 'all') {
      params.append('category', state.categoryFilter);
    }
    if (state.searchTerm) {
      params.append('search', state.searchTerm);
    }

    const res = await fetch(`/api/drugs?${params.toString()}`);
    const data = await res.json();
    if (data.success) {
      state.drugs = data.drugs;
      renderInventoryTable();
      renderFefoList();
    }
  } catch (err) {
    console.error('Error loading inventory:', err);
  }
}

// Load Quarantined Drugs
async function loadQuarantinedDrugs() {
  try {
    const res = await fetch('/api/drugs?status=quarantined');
    const data = await res.json();
    if (data.success) {
      state.quarantinedDrugs = data.drugs;
      renderQuarantineTable();
      const badge = document.getElementById('quarantine-badge-count');
      if (data.drugs.length > 0) {
        badge.textContent = data.drugs.length;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
  } catch (err) {
    console.error('Error loading quarantined inventory:', err);
  }
}

// Load real-time KPI statistics
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    if (data.success) {
      updateStats(data.stats);
    }
  } catch (err) {
    console.error('Error loading statistics:', err);
  }
}

// Update DOM with statistics
function updateStats(stats) {
  state.stats = stats;
  updateStatsCards(stats.counts);

  // Financial values
  document.getElementById('kpi-expired-loss').textContent = stats.financials.expired_loss_value.toFixed(2);
  document.getElementById('kpi-risk-value').textContent = stats.financials.total_risk_value.toFixed(2);
  document.getElementById('kpi-total-val').textContent = stats.financials.total_cost_value.toFixed(0);

  // Units
  document.getElementById('kpi-expired-units').textContent = stats.units.expired_units_on_shelf;
  document.getElementById('kpi-critical-units').textContent = stats.units.critical_units;
  document.getElementById('kpi-warning-units').textContent = stats.units.warning_units;
  document.getElementById('kpi-safe-units').textContent = stats.units.safe_units;

  // Emergency banner check
  const banner = document.getElementById('urgent-expired-banner');
  const bannerCount = document.getElementById('banner-expired-count');
  if (stats.counts.expired_active_on_shelf > 0) {
    bannerCount.textContent = `${stats.counts.expired_active_on_shelf} Batches EXPIRED`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function updateStatsCards(counts) {
  if (!counts) return;
  document.getElementById('kpi-expired-count').textContent = counts.expired_active_on_shelf || 0;
  document.getElementById('kpi-critical-count').textContent = counts.critical_active || 0;
  document.getElementById('kpi-warning-count').textContent = counts.warning_active || 0;
  document.getElementById('kpi-safe-count').textContent = counts.safe_active || 0;
}

// Render main inventory table
function renderInventoryTable() {
  const tbody = document.getElementById('inventory-tbody');
  const shownCount = document.getElementById('inventory-shown-count');
  tbody.innerHTML = '';

  const activeDrugs = state.drugs.filter(d => d.status === 'active');
  shownCount.textContent = activeDrugs.length;

  if (activeDrugs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-12 text-center text-slate-400">
          <i class="ph ph-magnifying-glass text-3xl mb-1 text-slate-300"></i>
          <div>No active batches match your current filter.</div>
        </td>
      </tr>
    `;
    return;
  }

  activeDrugs.forEach(drug => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50/80 transition group';

    // Status styling & live countdown
    const countdown = getCountdownDetails(drug.expiry_date, state.effectiveTime);

    let statusBadgeHtml = '';
    let rowBorderClass = '';

    if (countdown.isExpired) {
      statusBadgeHtml = `
        <span class="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-300 badge-expired-pulse">
          <i class="ph-bold ph-skull"></i>
          <span class="countdown-ticker" data-expiry="${drug.expiry_date}">${countdown.countdownText}</span>
        </span>
      `;
      rowBorderClass = 'bg-rose-50/40';
    } else if (countdown.days <= 30) {
      statusBadgeHtml = `
        <span class="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-100 text-red-800 border border-red-300">
          <i class="ph-bold ph-clock-countdown"></i>
          <span class="countdown-ticker" data-expiry="${drug.expiry_date}">${countdown.countdownText}</span>
        </span>
      `;
    } else if (countdown.days <= 90) {
      statusBadgeHtml = `
        <span class="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-300">
          <i class="ph-bold ph-hourglass-medium"></i>
          <span class="countdown-ticker" data-expiry="${drug.expiry_date}">${countdown.countdownText}</span>
        </span>
      `;
    } else {
      statusBadgeHtml = `
        <span class="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-800 border border-emerald-300">
          <i class="ph-bold ph-shield-check"></i>
          <span class="countdown-ticker" data-expiry="${drug.expiry_date}">${countdown.countdownText}</span>
        </span>
      `;
    }

    // FEFO flag badge
    let fefoPill = '';
    if (drug.is_fefo_first) {
      fefoPill = `<span class="ml-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-blue-100 text-blue-700 border border-blue-200">FEFO 1st</span>`;
    }

    tr.className += ' ' + rowBorderClass;

    tr.innerHTML = `
      <td class="py-3 px-4">
        <div class="font-bold text-slate-900 flex items-center">
          <span>${drug.name}</span>
          ${fefoPill}
        </div>
        <div class="text-[11px] text-slate-500">${drug.generic_name} • <span class="font-medium text-slate-600">${drug.dosage_form} ${drug.strength}</span></div>
      </td>
      <td class="py-3 px-3">
        <div class="font-mono font-semibold text-slate-800 text-[11px]">${drug.batch_number}</div>
        <div class="font-mono text-[10px] text-slate-400">NDC: ${drug.ndc}</div>
      </td>
      <td class="py-3 px-3">
        <div class="font-medium text-slate-800 flex items-center space-x-1">
          <i class="ph-bold ph-map-pin text-blue-500 text-xs"></i>
          <span>${drug.shelf_location}</span>
        </div>
        <div class="text-[10px] text-slate-500">${drug.storage_condition}</div>
      </td>
      <td class="py-3 px-3">
        <div class="font-mono font-medium text-slate-800">${drug.expiry_date.slice(0, 10)}</div>
        <div class="text-[10px] text-slate-400">${drug.expiry_date.slice(11, 16) || '23:59'}</div>
      </td>
      <td class="py-3 px-4">
        ${statusBadgeHtml}
      </td>
      <td class="py-3 px-3 text-right">
        <div class="font-mono font-bold text-slate-800 text-sm">${drug.quantity}</div>
        <div class="text-[10px] text-slate-400">$${(drug.quantity * drug.retail_price).toFixed(2)}</div>
      </td>
      <td class="py-3 px-4 text-center">
        <div class="flex items-center justify-center space-x-1.5">
          ${
            countdown.isExpired
              ? `<button onclick="quarantineSingleDrug(${drug.id}, '${drug.name}', '${drug.batch_number}')" class="px-2.5 py-1 rounded-md bg-purple-700 hover:bg-purple-600 text-white font-bold text-[11px] flex items-center space-x-1 shadow-sm transition">
                  <i class="ph-bold ph-shield-warning"></i>
                  <span>Quarantine</span>
                </button>`
              : `<button onclick="quickDispense(${drug.id}, '${drug.name}', '${drug.batch_number}', ${countdown.isExpired})" class="px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-semibold text-[11px] flex items-center space-x-1 shadow-sm transition">
                  <i class="ph-bold ph-prescription"></i>
                  <span>Dispense</span>
                </button>
                <button onclick="quarantineSingleDrug(${drug.id}, '${drug.name}', '${drug.batch_number}')" title="Move to Quarantine" class="p-1 text-slate-400 hover:text-purple-600 rounded transition">
                  <i class="ph-bold ph-shield-warning text-sm"></i>
                </button>`
          }
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Render FEFO terminal medication list
function renderFefoList() {
  const container = document.getElementById('fefo-drug-list');
  const term = (document.getElementById('fefo-search-input')?.value || '').toLowerCase();
  container.innerHTML = '';

  // Group unique drug names
  const grouped = {};
  state.drugs.forEach(d => {
    if (d.status !== 'active') return;
    if (!grouped[d.name]) {
      grouped[d.name] = {
        name: d.name,
        generic: d.generic_name,
        form: d.dosage_form,
        strength: d.strength,
        batches: []
      };
    }
    grouped[d.name].batches.push(d);
  });

  const names = Object.keys(grouped).filter(name => {
    if (!term) return true;
    const g = grouped[name];
    return name.toLowerCase().includes(term) || g.generic.toLowerCase().includes(term);
  });

  if (names.length === 0) {
    container.innerHTML = `<div class="py-6 text-center text-xs text-slate-400">No matching drugs found</div>`;
    return;
  }

  names.forEach(name => {
    const item = grouped[name];
    const hasExpiredBatch = item.batches.some(b => b.is_expired);
    const div = document.createElement('div');
    div.className = `p-2.5 rounded-lg border text-left cursor-pointer transition flex items-center justify-between ${
      state.selectedFefoDrugName === name
        ? 'border-blue-500 bg-blue-50/50'
        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
    }`;

    div.onclick = () => {
      state.selectedFefoDrugName = name;
      playSound('click');
      renderFefoList();
      renderFefoDetails(name);
    };

    div.innerHTML = `
      <div>
        <div class="font-bold text-xs text-slate-900">${item.name}</div>
        <div class="text-[10px] text-slate-500">${item.batches.length} batch(es) in stock</div>
      </div>
      <div>
        ${hasExpiredBatch ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-100 text-rose-700">Has Expired</span>` : `<span class="px-1.5 py-0.5 rounded text-[9px] font-medium bg-emerald-100 text-emerald-700">Safe Batches</span>`}
      </div>
    `;

    container.appendChild(div);
  });

  // If none selected yet, select first
  if (!state.selectedFefoDrugName && names.length > 0) {
    state.selectedFefoDrugName = names[0];
    renderFefoDetails(names[0]);
  }
}

// Render FEFO detailed batch card with recommended First Expired, First Out batch
function renderFefoDetails(drugName) {
  const container = document.getElementById('fefo-details-container');
  const batches = state.drugs.filter(d => d.name === drugName && d.status === 'active');

  if (batches.length === 0) {
    container.innerHTML = `<div class="py-8 text-center text-slate-400">No active stock for ${drugName}</div>`;
    return;
  }

  // Sort batches by expiry date ascending
  batches.sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));

  // Determine FEFO recommendation (first non-expired active batch)
  const fefoBatch = batches.find(b => !b.is_expired);

  let batchesHtml = '';
  batches.forEach(b => {
    const countdown = getCountdownDetails(b.expiry_date, state.effectiveTime);
    const isRecommended = fefoBatch && fefoBatch.id === b.id;

    batchesHtml += `
      <div class="p-4 rounded-xl border transition ${
        b.is_expired
          ? 'border-rose-300 bg-rose-50/60'
          : isRecommended
          ? 'border-2 border-emerald-500 bg-emerald-50/40 shadow-sm'
          : 'border-slate-200 bg-white'
      }">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
          <div class="flex items-center space-x-2">
            <span class="font-mono font-bold text-sm text-slate-900">${b.batch_number}</span>
            ${
              isRecommended
                ? `<span class="bg-emerald-600 text-white font-extrabold text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center space-x-1">
                    <i class="ph-bold ph-star"></i>
                    <span>RECOMMENDED (FEFO #1)</span>
                  </span>`
                : ''
            }
            ${
              b.is_expired
                ? `<span class="bg-rose-600 text-white font-extrabold text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center space-x-1">
                    <i class="ph-bold ph-prohibit"></i>
                    <span>DO NOT DISPENSE - EXPIRED</span>
                  </span>`
                : ''
            }
          </div>
          <div class="text-xs font-mono font-bold ${b.is_expired ? 'text-rose-600' : 'text-slate-700'}">
            ${countdown.countdownText}
          </div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-slate-600 mb-3 bg-white/70 p-2.5 rounded-lg border border-slate-100">
          <div>
            <span class="text-[10px] text-slate-400 block uppercase">Shelf Location</span>
            <span class="font-bold text-slate-800">${b.shelf_location}</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-400 block uppercase">Expiration Date</span>
            <span class="font-mono font-semibold text-slate-800">${b.expiry_date.slice(0, 10)}</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-400 block uppercase">Quantity In Stock</span>
            <span class="font-mono font-bold text-slate-800">${b.quantity} units</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-400 block uppercase">Storage</span>
            <span class="text-slate-800 text-[11px]">${b.storage_condition}</span>
          </div>
        </div>

        <div class="flex items-center justify-between pt-1">
          <div class="text-[11px] text-slate-500">
            ${b.is_expired ? '<span class="text-rose-600 font-semibold">⚠️ Safety lock active: Dispensing blocked</span>' : isRecommended ? '<span class="text-emerald-700 font-semibold">Dispense this batch first to avoid inventory obsolescence</span>' : 'Hold as backup stock'}
          </div>
          <div class="flex items-center space-x-2">
            ${
              b.is_expired
                ? `<button onclick="quarantineSingleDrug(${b.id}, '${b.name}', '${b.batch_number}')" class="px-3.5 py-1.5 rounded-lg bg-purple-700 hover:bg-purple-600 text-white font-bold text-xs flex items-center space-x-1">
                    <i class="ph-bold ph-shield-warning"></i>
                    <span>Quarantine Batch</span>
                  </button>
                  <button onclick="attemptExpiredDispense(${b.id}, '${b.name}', '${b.batch_number}', '${b.expiry_date}')" class="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-400 font-bold text-xs cursor-not-allowed">
                    Dispense (Blocked)
                  </button>`
                : `<button onclick="executeDispensePrompt(${b.id}, '${b.name}', '${b.batch_number}', ${b.quantity})" class="px-4 py-1.5 rounded-lg ${isRecommended ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-blue-600 hover:bg-blue-500'} text-white font-bold text-xs shadow transition flex items-center space-x-1.5">
                    <i class="ph-bold ph-check"></i>
                    <span>Dispense ${isRecommended ? 'FEFO Stock' : 'Batch'}</span>
                  </button>`
            }
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = `
    <div class="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
      <div>
        <h3 class="font-extrabold text-base text-slate-900">${drugName}</h3>
        <p class="text-xs text-slate-500">${batches[0].generic_name} • ${batches[0].dosage_form} ${batches[0].strength}</p>
      </div>
      <div class="text-right">
        <span class="text-xs text-slate-500">Total Active Units:</span>
        <span class="font-mono font-extrabold text-sm text-slate-900 ml-1">${batches.reduce((a, b) => a + b.quantity, 0)}</span>
      </div>
    </div>
    <div class="space-y-3">
      ${batchesHtml}
    </div>
  `;
}

// Prompt and execute dispense
async function executeDispensePrompt(drugId, drugName, batchNumber, currentQty) {
  const qtyStr = prompt(`Enter quantity of ${drugName} (Batch: ${batchNumber}) to dispense:`, '1');
  if (!qtyStr) return;
  const qty = parseInt(qtyStr, 10);
  if (isNaN(qty) || qty <= 0) {
    alert('Please enter a valid positive quantity.');
    return;
  }
  if (qty > currentQty) {
    alert(`Cannot dispense ${qty} units. Only ${currentQty} units available.`);
    return;
  }

  try {
    const res = await fetch(`/api/drugs/${drugId}/dispense`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: qty })
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.safety_lock) {
        triggerSafetyBlockModal(data.drug, data.error);
        return;
      }
      throw new Error(data.error || 'Dispense failed');
    }
  } catch (err) {
    alert(err.message);
  }
}

// Quick dispense helper for table row
function quickDispense(drugId, drugName, batchNumber, isExpired) {
  if (isExpired) {
    attemptExpiredDispense(drugId, drugName, batchNumber, '');
    return;
  }
  executeDispensePrompt(drugId, drugName, batchNumber, 9999);
}

// Safety lock trigger for expired dispense
function attemptExpiredDispense(drugId, drugName, batchNumber, expiryDate) {
  state.lastSafetyDrug = { id: drugId, name: drugName, batch_number: batchNumber, expiry_date: expiryDate };
  playSound('beep-danger');
  triggerSafetyBlockModal(state.lastSafetyDrug, `Drug batch ${batchNumber} is EXPIRED. Regulatory statutes strictly forbid dispensing expired stock.`);
}

function triggerSafetyBlockModal(drug, message) {
  state.lastSafetyDrug = drug;
  document.getElementById('safety-block-drug-title').textContent = `${drug.name} (Batch: ${drug.batch_number})`;
  document.getElementById('safety-block-message').textContent = message;
  document.getElementById('modal-safety-block').classList.remove('hidden');
}

// Quarantine single drug
async function quarantineSingleDrug(drugId, drugName, batchNumber) {
  const reason = prompt(`Reason for quarantining ${drugName} (Batch: ${batchNumber}):`, 'Expired stock pulled from shelf');
  if (reason === null) return;

  try {
    const res = await fetch(`/api/drugs/${drugId}/quarantine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Quarantine failed');
  } catch (err) {
    alert(err.message);
  }
}

// 1-Click Mass Quarantine All Expired Active Batches
async function quarantineAllExpired() {
  if (!confirm('Are you sure you want to pull ALL expired drug batches from dispensing shelves and move them to the quarantine bin?')) {
    return;
  }

  try {
    const res = await fetch('/api/drugs/quarantine-all-expired', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed mass quarantine');
  } catch (err) {
    alert(err.message);
  }
}

// Render Quarantine Table
function renderQuarantineTable() {
  const tbody = document.getElementById('quarantine-tbody');
  tbody.innerHTML = '';

  if (state.quarantinedDrugs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="py-12 text-center text-slate-400">
          <i class="ph ph-shield-check text-3xl mb-1 text-purple-400"></i>
          <div>Quarantine storage bin is currently clean and empty.</div>
        </td>
      </tr>
    `;
    return;
  }

  state.quarantinedDrugs.forEach(drug => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 transition';
    tr.innerHTML = `
      <td class="py-3 px-4 font-bold text-slate-900">${drug.name}</td>
      <td class="py-3 px-3 font-mono font-medium">${drug.batch_number}</td>
      <td class="py-3 px-3 font-mono text-rose-600 font-bold">${drug.expiry_date.slice(0, 10)}</td>
      <td class="py-3 px-3 font-medium text-purple-900">${drug.shelf_location}</td>
      <td class="py-3 px-3 font-mono font-bold">${drug.quantity} units</td>
      <td class="py-3 px-3 text-slate-600 text-[11px] max-w-xs truncate">${drug.notes || 'Quarantined for disposal'}</td>
      <td class="py-3 px-4 text-center">
        <button onclick="disposeDrug(${drug.id}, '${drug.name}', '${drug.batch_number}')" class="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-white font-semibold text-[11px] flex items-center space-x-1 mx-auto transition">
          <i class="ph-bold ph-trash"></i>
          <span>Dispose (Incinerate)</span>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Dispose drug from quarantine
async function disposeDrug(drugId, drugName, batchNumber) {
  const method = prompt(`Confirm disposal method for ${drugName} (Batch: ${batchNumber}):`, 'Medical waste incineration manifest #MW-882');
  if (!method) return;

  try {
    const res = await fetch(`/api/drugs/${drugId}/dispose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Disposal failed');
    showToast('Drug Disposed', `${drugName} manifested for incineration`, 'success');
  } catch (err) {
    alert(err.message);
  }
}

// Load and render regulatory audit logs
async function loadAuditLogs() {
  try {
    const res = await fetch('/api/audit?limit=60');
    const data = await res.json();
    if (data.success) {
      const tbody = document.getElementById('audit-tbody');
      tbody.innerHTML = '';

      data.logs.forEach(log => {
        const tr = document.createElement('tr');
        let badgeColor = 'bg-slate-100 text-slate-700';
        if (log.action === 'DISPENSE_BLOCKED') badgeColor = 'bg-rose-100 text-rose-800 font-bold border border-rose-300';
        else if (log.action === 'DISPENSED') badgeColor = 'bg-emerald-100 text-emerald-800';
        else if (log.action === 'QUARANTINED') badgeColor = 'bg-purple-100 text-purple-800';
        else if (log.action === 'STOCK_ADDED') badgeColor = 'bg-blue-100 text-blue-800';
        else if (log.action === 'DISPOSED') badgeColor = 'bg-zinc-200 text-zinc-800';

        tr.innerHTML = `
          <td class="py-2.5 px-3 text-slate-500">${formatDate(log.created_at)}</td>
          <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded text-[10px] ${badgeColor}">${log.action}</span></td>
          <td class="py-2.5 px-3 font-sans font-bold text-slate-800">${log.drug_name}</td>
          <td class="py-2.5 px-3">${log.batch_number}</td>
          <td class="py-2.5 px-3 ${log.quantity_change < 0 ? 'text-red-600' : log.quantity_change > 0 ? 'text-emerald-600' : 'text-slate-400'}">${log.quantity_change !== 0 ? log.quantity_change : '—'}</td>
          <td class="py-2.5 px-4 font-sans text-slate-600 text-xs">${log.details}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (err) {
    console.error('Error loading audit:', err);
  }
}

// Export Audit CSV for Regulatory Compliance
function exportAuditReport() {
  window.location.href = '/api/export';
}

// Time shift & simulation
async function shiftTime(days) {
  try {
    const res = await fetch('/api/time/shift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days })
    });
    await res.json();
    closeAllModals();
  } catch (err) {
    alert(err.message);
  }
}

async function resetTime() {
  try {
    const res = await fetch('/api/time/shift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset: true })
    });
    await res.json();
    closeAllModals();
  } catch (err) {
    alert(err.message);
  }
}

// Filter pill click
function filterByExpiry(filterKey) {
  state.activeFilter = filterKey;
  document.querySelectorAll('.filter-pill').forEach(pill => {
    if (pill.dataset.filter === filterKey) {
      pill.classList.add('active-pill');
    } else {
      pill.classList.remove('active-pill');
    }
  });

  // Switch to inventory tab if not there
  switchTab('inventory');
  loadDrugs();
}

// Tab navigation switcher
function switchTab(tabId) {
  state.currentTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.tab === tabId) {
      btn.className = 'tab-btn active-tab flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-semibold transition';
    } else {
      btn.className = 'tab-btn inactive-tab flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-semibold transition';
    }
  });

  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.add('hidden');
    pane.classList.remove('block');
  });

  const targetPane = document.getElementById(`tab-${tabId}-content`);
  if (targetPane) {
    targetPane.classList.remove('hidden');
    targetPane.classList.add('block');
  }

  if (tabId === 'quarantine') loadQuarantinedDrugs();
  if (tabId === 'audit') loadAuditLogs();
  if (tabId === 'fefo') renderFefoList();
}

// Close all open modals
function closeAllModals() {
  document.querySelectorAll('[id^="modal-"]').forEach(modal => modal.classList.add('hidden'));
}

// Sample presets for quick batch receipt
function prefillForm(preset) {
  const now = state.effectiveTime;
  const formatDateForInput = (date) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  if (preset === 'amox') {
    document.getElementById('add-name').value = 'Amoxicillin Trihydrate';
    document.getElementById('add-generic').value = 'Amoxicillin';
    document.getElementById('add-ndc').value = '00781-2024-05';
    document.getElementById('add-batch').value = 'AMX-' + Math.floor(1000 + Math.random() * 9000);
    document.getElementById('add-form').value = 'Capsule';
    document.getElementById('add-strength').value = '500 mg';
    const exp = new Date(now.getTime() + 180 * 86400000); // 6 months
    document.getElementById('add-expiry').value = formatDateForInput(exp);
    document.getElementById('add-quantity').value = '100';
    document.getElementById('add-location').value = 'Aisle 2 - Shelf B1';
    document.getElementById('add-storage').value = 'Room Temp (20-25°C)';
    document.getElementById('add-category').value = 'Antibiotics';
  } else if (preset === 'insulin') {
    document.getElementById('add-name').value = 'Novolog FlexPen';
    document.getElementById('add-generic').value = 'Insulin Aspart';
    document.getElementById('add-ndc').value = '00169-6339-10';
    document.getElementById('add-batch').value = 'NOV-' + Math.floor(1000 + Math.random() * 9000);
    document.getElementById('add-form').value = 'Subcutaneous Pen';
    document.getElementById('add-strength').value = '100 U/mL';
    const exp = new Date(now.getTime() + 60 * 86400000); // 60 days
    document.getElementById('add-expiry').value = formatDateForInput(exp);
    document.getElementById('add-quantity').value = '25';
    document.getElementById('add-location').value = 'Fridge 1 - Cold Rack 2';
    document.getElementById('add-storage').value = 'Refrigerated (2-8°C)';
    document.getElementById('add-category').value = 'Endocrine & Diabetes';
  } else if (preset === 'albuterol') {
    document.getElementById('add-name').value = 'ProAir RespiClick';
    document.getElementById('add-generic').value = 'Albuterol Sulfate';
    document.getElementById('add-ndc').value = '59310-580-20';
    document.getElementById('add-batch').value = 'PRO-' + Math.floor(1000 + Math.random() * 9000);
    document.getElementById('add-form').value = 'Dry Powder Inhaler';
    document.getElementById('add-strength').value = '90 mcg';
    const exp = new Date(now.getTime() + 365 * 86400000); // 1 year
    document.getElementById('add-expiry').value = formatDateForInput(exp);
    document.getElementById('add-quantity').value = '30';
    document.getElementById('add-location').value = 'Aisle 4 - Shelf C1';
    document.getElementById('add-storage').value = 'Room Temp (20-25°C)';
    document.getElementById('add-category').value = 'Respiratory';
  } else if (preset === 'expiring_soon') {
    document.getElementById('add-name').value = 'Tamiflu (Short Dated Stock)';
    document.getElementById('add-generic').value = 'Oseltamivir Phosphate';
    document.getElementById('add-ndc').value = '00004-0800-85';
    document.getElementById('add-batch').value = 'TFL-' + Math.floor(1000 + Math.random() * 9000);
    document.getElementById('add-form').value = 'Capsule';
    document.getElementById('add-strength').value = '75 mg';
    const exp = new Date(now.getTime() + 15 * 86400000); // in 15 days
    document.getElementById('add-expiry').value = formatDateForInput(exp);
    document.getElementById('add-quantity').value = '15';
    document.getElementById('add-location').value = 'Aisle 2 - Shelf D2';
    document.getElementById('add-storage').value = 'Room Temp (20-25°C)';
    document.getElementById('add-category').value = 'Antibiotics';
  }
}

// Setup Event Listeners
function setupEventListeners() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      playSound('click');
      switchTab(btn.dataset.tab);
    });
  });

  // Filter pills
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      playSound('click');
      filterByExpiry(pill.dataset.filter);
    });
  });

  // Category filter
  document.getElementById('category-filter')?.addEventListener('change', (e) => {
    state.categoryFilter = e.target.value;
    loadDrugs();
  });

  // Inventory search input
  let searchDebounce;
  document.getElementById('inventory-search')?.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.searchTerm = e.target.value.trim();
      loadDrugs();
    }, 200);
  });

  // FEFO search input
  document.getElementById('fefo-search-input')?.addEventListener('input', () => {
    renderFefoList();
  });

  // Sound toggle button
  document.getElementById('sound-toggle-btn')?.addEventListener('click', function() {
    state.soundEnabled = !state.soundEnabled;
    this.innerHTML = state.soundEnabled ? '<i class="ph ph-speaker-high text-lg"></i>' : '<i class="ph ph-speaker-slash text-lg text-slate-500"></i>';
    showToast('Audio Alerts', state.soundEnabled ? 'Sound enabled' : 'Sound muted', 'info');
  });

  // Modal open buttons
  document.getElementById('btn-open-add-drug')?.addEventListener('click', () => {
    playSound('click');
    document.getElementById('modal-add-drug').classList.remove('hidden');
    prefillForm('amox'); // Set default
  });

  document.getElementById('time-warp-trigger')?.addEventListener('click', () => {
    playSound('click');
    document.getElementById('modal-clock-display').textContent = state.effectiveTime.toISOString().slice(0, 19).replace('T', ' ');
    document.getElementById('modal-time-machine').classList.remove('hidden');
  });

  // 1-Click Mass Quarantine Expired Button
  document.getElementById('btn-quarantine-all-expired')?.addEventListener('click', () => {
    quarantineAllExpired();
  });

  // Quarantine from safety modal
  document.getElementById('btn-quarantine-from-safety')?.addEventListener('click', () => {
    if (state.lastSafetyDrug) {
      closeAllModals();
      quarantineSingleDrug(state.lastSafetyDrug.id, state.lastSafetyDrug.name, state.lastSafetyDrug.batch_number);
    }
  });

  // Modal close buttons
  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', closeAllModals);
  });

  // Close modals on Escape key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });

  // Add Drug Form submit
  document.getElementById('form-add-drug')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('add-name').value.trim(),
      generic_name: document.getElementById('add-generic').value.trim(),
      ndc: document.getElementById('add-ndc').value.trim(),
      batch_number: document.getElementById('add-batch').value.trim(),
      dosage_form: document.getElementById('add-form').value.trim(),
      strength: document.getElementById('add-strength').value.trim(),
      expiry_date: document.getElementById('add-expiry').value,
      quantity: parseInt(document.getElementById('add-quantity').value, 10),
      shelf_location: document.getElementById('add-location').value.trim(),
      storage_condition: document.getElementById('add-storage').value,
      category: document.getElementById('add-category').value
    };

    try {
      const res = await fetch('/api/drugs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add batch');

      closeAllModals();
      document.getElementById('form-add-drug').reset();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });
}

// Live Real-Time 1-Second Digital Clock & Countdown Ticker
function startLiveSecondTicker() {
  setInterval(() => {
    // Advance simulated clock by 1 second
    state.effectiveTime = new Date(state.effectiveTime.getTime() + 1000);

    // Update top digital clock
    const clockEl = document.getElementById('live-clock');
    if (clockEl) {
      const pad = (n) => String(n).padStart(2, '0');
      const y = state.effectiveTime.getFullYear();
      const m = pad(state.effectiveTime.getMonth() + 1);
      const d = pad(state.effectiveTime.getDate());
      const hh = pad(state.effectiveTime.getHours());
      const mm = pad(state.effectiveTime.getMinutes());
      const ss = pad(state.effectiveTime.getSeconds());
      clockEl.textContent = `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
    }

    // Update countdown tickers on visible table rows in real-time
    document.querySelectorAll('.countdown-ticker').forEach(el => {
      const expiry = el.dataset.expiry;
      if (expiry) {
        const details = getCountdownDetails(expiry, state.effectiveTime);
        el.textContent = details.countdownText;
      }
    });
  }, 1000);
}

// Initial Bootstrapping
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  initSSE();
  startLiveSecondTicker();
  loadDrugs();
  loadStats();
  loadQuarantinedDrugs();
});
