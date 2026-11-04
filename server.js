// server.js - Real-Time Pharmacy Expiry Tracking System
const http = require('node:http');
const url = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const db = require('./db.js');

// Initialize database
db.initDatabase();

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// MIME types for static assets
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Connected SSE clients for real-time broadcasts
const sseClients = new Set();

function broadcast(eventType, data) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

// Background ticker: every 5 seconds, broadcast real-time sync pulse with current time and stats
setInterval(() => {
  if (sseClients.size > 0) {
    const stats = db.getStatistics();
    broadcast('pulse', {
      time: db.getEffectiveTime().toISOString(),
      counts: stats.counts,
      activeClients: sseClients.size
    });
  }
}, 5000);

// Helper to parse JSON body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      // Guard against huge payload
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Helper to send JSON responses
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  res.end(JSON.stringify(data));
}

// Helper to send errors
function sendError(res, statusCode, message, extra = {}) {
  sendJson(res, statusCode, { error: message, success: false, ...extra });
}

// Main HTTP request router
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    });
    return res.end();
  }

  try {
    // ----------------------------------------------------
    // REAL-TIME SERVER-SENT EVENTS (SSE) STREAM
    // ----------------------------------------------------
    if (pathname === '/api/events' && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      res.write(': connected\n\n');
      sseClients.add(res);

      // Send initial state immediately
      const initialStats = db.getStatistics();
      res.write(`event: init\ndata: ${JSON.stringify({
        time: db.getEffectiveTime().toISOString(),
        stats: initialStats
      })}\n\n`);

      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    // ----------------------------------------------------
    // API: GET DRUGS (with real-time expiry countdowns)
    // ----------------------------------------------------
    if (pathname === '/api/drugs' && method === 'GET') {
      const filters = {
        status: parsedUrl.query.status || 'all',
        expiryStatus: parsedUrl.query.expiryStatus || null,
        category: parsedUrl.query.category || 'all',
        search: parsedUrl.query.search || ''
      };
      const drugs = db.getAllDrugs(filters);
      return sendJson(res, 200, {
        success: true,
        effective_time: db.getEffectiveTime().toISOString(),
        count: drugs.length,
        drugs
      });
    }

    // ----------------------------------------------------
    // API: GET SINGLE DRUG
    // ----------------------------------------------------
    if (pathname.startsWith('/api/drugs/') && method === 'GET' && !pathname.includes('quarantine-all-expired')) {
      const id = parseInt(pathname.split('/')[3], 10);
      const drug = db.getDrugById(id);
      if (!drug) return sendError(res, 404, 'Drug batch not found');
      return sendJson(res, 200, { success: true, drug });
    }

    // ----------------------------------------------------
    // API: ADD NEW DRUG BATCH
    // ----------------------------------------------------
    if (pathname === '/api/drugs' && method === 'POST') {
      const body = await parseJsonBody(req);
      if (!body.name || !body.batch_number || !body.expiry_date || body.quantity === undefined) {
        return sendError(res, 400, 'Missing required fields: name, batch_number, expiry_date, quantity');
      }

      try {
        const newDrug = db.addDrug(body);
        broadcast('drug_added', { drug: newDrug, stats: db.getStatistics() });
        return sendJson(res, 201, { success: true, drug: newDrug });
      } catch (err) {
        return sendError(res, 400, err.message);
      }
    }

    // ----------------------------------------------------
    // API: UPDATE DRUG BATCH
    // ----------------------------------------------------
    if (pathname.startsWith('/api/drugs/') && method === 'PUT') {
      const id = parseInt(pathname.split('/')[3], 10);
      const body = await parseJsonBody(req);
      try {
        const updated = db.updateDrug(id, body);
        broadcast('drug_updated', { drug: updated, stats: db.getStatistics() });
        return sendJson(res, 200, { success: true, drug: updated });
      } catch (err) {
        return sendError(res, 400, err.message);
      }
    }

    // ----------------------------------------------------
    // API: DISPENSE DRUG (PATIENT SAFETY GUARD INCLUDED)
    // ----------------------------------------------------
    if (pathname.match(/^\/api\/drugs\/(\d+)\/dispense$/) && method === 'POST') {
      const id = parseInt(pathname.split('/')[3], 10);
      const body = await parseJsonBody(req);
      const qty = parseInt(body.quantity || 1, 10);

      try {
        const updated = db.dispenseDrug(id, qty);
        broadcast('drug_dispensed', { drug: updated, quantity: qty, stats: db.getStatistics() });
        return sendJson(res, 200, { success: true, drug: updated, dispensed: qty });
      } catch (err) {
        if (err.isExpiredSafetyBlock) {
          // Broadcast safety alert violation event to all connected pharmacy screens
          broadcast('safety_alert', {
            type: 'DISPENSE_BLOCKED_EXPIRED',
            drug: err.drug,
            message: err.message,
            timestamp: new Date().toISOString()
          });
          return sendJson(res, 403, {
            success: false,
            safety_lock: true,
            error: err.message,
            drug: err.drug
          });
        }
        return sendError(res, 400, err.message);
      }
    }

    // ----------------------------------------------------
    // API: QUARANTINE DRUG
    // ----------------------------------------------------
    if (pathname.match(/^\/api\/drugs\/(\d+)\/quarantine$/) && method === 'POST') {
      const id = parseInt(pathname.split('/')[3], 10);
      const body = await parseJsonBody(req);
      try {
        const updated = db.quarantineDrug(id, body.reason || 'Quarantined for disposal/vendor credit');
        broadcast('drug_quarantined', { drug: updated, stats: db.getStatistics() });
        return sendJson(res, 200, { success: true, drug: updated });
      } catch (err) {
        return sendError(res, 400, err.message);
      }
    }

    // ----------------------------------------------------
    // API: QUARANTINE ALL EXPIRED (1-Click Safe Shelf Pull)
    // ----------------------------------------------------
    if (pathname === '/api/drugs/quarantine-all-expired' && method === 'POST') {
      try {
        const quarantined = db.quarantineAllExpired();
        broadcast('mass_quarantine', { quarantined_count: quarantined.length, stats: db.getStatistics() });
        return sendJson(res, 200, { success: true, quarantined_count: quarantined.length, quarantined });
      } catch (err) {
        return sendError(res, 400, err.message);
      }
    }

    // ----------------------------------------------------
    // API: DISPOSE DRUG
    // ----------------------------------------------------
    if (pathname.match(/^\/api\/drugs\/(\d+)\/dispose$/) && method === 'POST') {
      const id = parseInt(pathname.split('/')[3], 10);
      const body = await parseJsonBody(req);
      try {
        const disposed = db.disposeDrug(id, body.method || 'Incineration via certified medical waste carrier');
        broadcast('drug_disposed', { drug: disposed, stats: db.getStatistics() });
        return sendJson(res, 200, { success: true, drug: disposed });
      } catch (err) {
        return sendError(res, 400, err.message);
      }
    }

    // ----------------------------------------------------
    // API: GET REAL-TIME KPI STATS
    // ----------------------------------------------------
    if (pathname === '/api/stats' && method === 'GET') {
      const stats = db.getStatistics();
      return sendJson(res, 200, { success: true, stats });
    }

    // ----------------------------------------------------
    // API: GET AUDIT TRAIL LOGS
    // ----------------------------------------------------
    if (pathname === '/api/audit' && method === 'GET') {
      const limit = parseInt(parsedUrl.query.limit || 50, 10);
      const logs = db.getAuditLogs(limit);
      return sendJson(res, 200, { success: true, logs });
    }

    // ----------------------------------------------------
    // API: TIME MACHINE / REAL-TIME SIMULATION CONTROLS
    // ----------------------------------------------------
    if (pathname === '/api/time' && method === 'GET') {
      return sendJson(res, 200, {
        success: true,
        real_time: new Date().toISOString(),
        effective_time: db.getEffectiveTime().toISOString(),
        offset_ms: db.getTimeOffset()
      });
    }

    if (pathname === '/api/time/shift' && method === 'POST') {
      const body = await parseJsonBody(req);
      let newOffset = db.getTimeOffset();

      if (body.reset) {
        newOffset = 0;
      } else if (body.days) {
        newOffset += parseInt(body.days, 10) * 86400000;
      } else if (body.offset_ms !== undefined) {
        newOffset = parseInt(body.offset_ms, 10);
      }

      db.setTimeOffset(newOffset);
      const stats = db.getStatistics();

      broadcast('time_shifted', {
        effective_time: db.getEffectiveTime().toISOString(),
        offset_ms: newOffset,
        stats
      });

      return sendJson(res, 200, {
        success: true,
        effective_time: db.getEffectiveTime().toISOString(),
        offset_ms: newOffset,
        stats
      });
    }

    // ----------------------------------------------------
    // API: EXPORT CSV FOR REGULATORY PHARMACY AUDIT
    // ----------------------------------------------------
    if (pathname === '/api/export' && method === 'GET') {
      const drugs = db.getAllDrugs();
      let csv = 'NDC,Drug Name,Generic Name,Strength,Batch Number,Expiration Date,Remaining Days,Status,Quantity,Location,Storage,Unit Cost,Retail Price,Value At Risk\n';

      for (const d of drugs) {
        const valAtRisk = (d.is_expired || d.status_level === 'critical') ? (d.quantity * d.unit_cost).toFixed(2) : '0.00';
        csv += `"${d.ndc}","${d.name}","${d.generic_name}","${d.strength}","${d.batch_number}","${d.expiry_date}",${d.days_remaining},"${d.status_text}",${d.quantity},"${d.shelf_location}","${d.storage_condition}",${d.unit_cost.toFixed(2)},${d.retail_price.toFixed(2)},${valAtRisk}\n`;
      }

      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=UTF-8',
        'Content-Disposition': 'attachment; filename="pharmacy_expiry_audit_' + new Date().toISOString().slice(0, 10) + '.csv"'
      });
      return res.end(csv);
    }

    // ----------------------------------------------------
    // STATIC ASSETS SERVING (public/ folder)
    // ----------------------------------------------------
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

    // Prevent directory traversal
    if (!filePath.startsWith(PUBLIC_DIR)) {
      return sendError(res, 403, 'Forbidden');
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        // Fallback to index.html for SPA-style routing if needed
        filePath = path.join(PUBLIC_DIR, 'index.html');
        fs.readFile(filePath, (err2, content) => {
          if (err2) return sendError(res, 404, 'File Not Found');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
          res.end(content);
        });
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      fs.readFile(filePath, (readErr, content) => {
        if (readErr) return sendError(res, 500, 'Error reading file');
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      });
    });

  } catch (error) {
    console.error('Server error handling request:', error);
    sendError(res, 500, 'Internal Server Error: ' + error.message);
  }
});

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`💊 Real-Time Pharmacy Expiry Management System Running`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`⏰ Current Simulated Clock: ${db.getEffectiveTime().toISOString()}`);
  console.log(`=======================================================`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close(() => {
    process.exit(0);
  });
});
