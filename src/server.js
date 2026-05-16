/**
 * Express + Socket.IO server
 * Serves the dashboard and streams real-time data to browser clients
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const ManipulationEngine = require('./engine');

const PORT = parseInt(process.env.PORT ?? '3000', 10);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// --- Engine setup ---
const engine = new ManipulationEngine({
  symbols: [],           // empty = auto top gainers
  topGainersCount: 10,
  topGainersRefreshMs: 60_000,
  snapshotIntervalMs: 2_000,
  alertConfig: {
    extremeThreshold: 55,
    highThreshold: 40,
    cooldownMs: 5 * 60 * 1000,
    telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',
  },
});

// Forward snapshots to all connected browsers
engine.onSnapshot((snap) => {
  io.emit('snapshot', snap);
});

// Forward alerts to browsers
engine.onAlert((alert) => {
  io.emit('alert', alert);
});

// --- REST API ---

// GET /api/status
app.get('/api/status', (req, res) => {
  res.json({
    symbols: [...engine.orderBooks.keys()],
    topGainers: engine.getTopGainers(),
    snapshots: engine.getSnapshots(),
  });
});

// POST /api/symbols  { symbols: ['BTCUSDT', 'SOLUSDT'] }
app.post('/api/symbols', async (req, res) => {
  const { symbols } = req.body;
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return res.status(400).json({ error: 'symbols must be a non-empty array' });
  }
  const cleaned = symbols.map(s => s.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  await engine.updateSymbols(cleaned);
  res.json({ ok: true, symbols: cleaned });
});

// GET /api/gainers
app.get('/api/gainers', (req, res) => {
  res.json(engine.getTopGainers());
});

// --- Socket.IO ---
io.on('connection', (socket) => {
  console.log('[WS Client] Connected:', socket.id);

  // Send current state immediately
  socket.emit('status', {
    symbols: [...engine.orderBooks.keys()],
    topGainers: engine.getTopGainers(),
    snapshots: engine.getSnapshots(),
  });

  socket.on('setSymbols', async (symbols) => {
    if (!Array.isArray(symbols)) return;
    const cleaned = symbols.map(s => s.toUpperCase().replace(/[^A-Z0-9]/g, ''));
    await engine.updateSymbols(cleaned);
    io.emit('symbolsUpdated', cleaned);
  });

  socket.on('updateConfig', (cfg) => {
    if (cfg.extremeThreshold) engine.alertEngine.config.extremeThreshold = cfg.extremeThreshold;
    if (cfg.highThreshold) engine.alertEngine.config.highThreshold = cfg.highThreshold;
    if (cfg.cooldownMs) engine.alertEngine.config.cooldownMs = cfg.cooldownMs;
    socket.emit('configUpdated', engine.alertEngine.config);
    console.log('[Config] Updated by client:', cfg);
  });

  socket.on('disconnect', () => {
    console.log('[WS Client] Disconnected:', socket.id);
  });
});

// --- Start ---
async function main() {
  const symbols = await engine.start();
  server.listen(PORT, () => {
    console.log(`\n[Server] Dashboard: http://localhost:${PORT}`);
    console.log(`[Server] Tracking: ${symbols.join(', ')}\n`);
  });
}

main().catch(console.error);
