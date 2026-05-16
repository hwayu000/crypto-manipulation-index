const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const ManipulationEngine = require('./engine');

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const notifyConfig = {
  telegram: { token: process.env.TELEGRAM_BOT_TOKEN ?? '', chatId: process.env.TELEGRAM_CHAT_ID ?? '', enabled: false },
  line: { token: process.env.LINE_NOTIFY_TOKEN ?? '', enabled: false },
};

const engine = new ManipulationEngine({
  symbols: [], topGainersCount: 10,
  topGainersRefreshMs: 60_000, snapshotIntervalMs: 3_000,
  alertConfig: { extremeThreshold: 55, highThreshold: 40, cooldownMs: 5*60*1000,
    telegramToken: notifyConfig.telegram.token, telegramChatId: notifyConfig.telegram.chatId },
});

engine.onSnapshot(snap => io.emit('snapshot', snap));
engine.onAlert(alert => {
  io.emit('alert', alert);
  if (notifyConfig.line.enabled && notifyConfig.line.token) sendLine(notifyConfig.line.token, alert.message);
});

// ── Notify helpers ──
function sendTelegram(token, chatId, text) {
  return new Promise((res, rej) => {
    const body = JSON.stringify({ chat_id: chatId, text });
    const req = https.request({ hostname: 'api.telegram.org', path: `/bot${token}/sendMessage`,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }},
      r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{res(JSON.parse(d));}catch{res({ok:false});} }); });
    req.on('error', rej); req.write(body); req.end();
  });
}
function sendLine(token, text) {
  return new Promise((res, rej) => {
    const body = `message=${encodeURIComponent(text)}`;
    const req = https.request({ hostname: 'notify-api.line.me', path: '/api/notify', method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }},
      r => { res({ status: r.statusCode }); r.resume(); });
    req.on('error', rej); req.write(body); req.end();
  });
}

// ── REST ──
app.get('/api/status', (req, res) => res.json({
  symbols: [...engine.orderBooks.keys()],
  topGainers: engine.getTopGainers(),
  snapshots: engine.getSnapshots(),
  futuresCount: engine.getFuturesSymbols().length,
}));

app.get('/api/gainers', (req, res) => res.json(engine.getTopGainers()));

// Search futures symbols
app.get('/api/search', (req, res) => {
  const q = (req.query.q ?? '').trim();
  res.json(engine.searchSymbols(q));
});

app.post('/api/symbols', async (req, res) => {
  const { symbols } = req.body;
  if (!Array.isArray(symbols) || !symbols.length) return res.status(400).json({ error: 'invalid' });
  const valid = symbols.map(s => s.toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .filter(s => engine.getFuturesSymbols().includes(s) || s.endsWith('USDT'));
  await engine.updateSymbols(valid);
  res.json({ ok: true, symbols: valid });
});

app.get('/api/notify', (req, res) => res.json({
  telegram: { token: notifyConfig.telegram.token ? '••••'+notifyConfig.telegram.token.slice(-4) : '', chatId: notifyConfig.telegram.chatId, enabled: notifyConfig.telegram.enabled, configured: !!(notifyConfig.telegram.token && notifyConfig.telegram.chatId) },
  line: { token: notifyConfig.line.token ? '••••'+notifyConfig.line.token.slice(-4) : '', enabled: notifyConfig.line.enabled, configured: !!notifyConfig.line.token },
}));

app.post('/api/notify', (req, res) => {
  const { telegram, line } = req.body;
  if (telegram) {
    if (telegram.token && !telegram.token.startsWith('••••')) notifyConfig.telegram.token = telegram.token.trim();
    if (telegram.chatId !== undefined) notifyConfig.telegram.chatId = String(telegram.chatId).trim();
    if (telegram.enabled !== undefined) notifyConfig.telegram.enabled = !!telegram.enabled;
    engine.alertEngine.config.telegramToken = notifyConfig.telegram.enabled ? notifyConfig.telegram.token : '';
    engine.alertEngine.config.telegramChatId = notifyConfig.telegram.chatId;
  }
  if (line) {
    if (line.token && !line.token.startsWith('••••')) notifyConfig.line.token = line.token.trim();
    if (line.enabled !== undefined) notifyConfig.line.enabled = !!line.enabled;
  }
  res.json({ ok: true });
});

app.post('/api/notify/test', async (req, res) => {
  const { channel } = req.body;
  const msg = '🔔 [Ashdata CMI] Test — connection successful!';
  try {
    if (channel === 'telegram') {
      const { token, chatId } = notifyConfig.telegram;
      if (!token || !chatId) return res.json({ ok: false, error: 'Token and Chat ID required' });
      const r = await sendTelegram(token, chatId, msg);
      return res.json({ ok: r.ok === true, detail: r.description ?? '' });
    }
    if (channel === 'line') {
      const { token } = notifyConfig.line;
      if (!token) return res.json({ ok: false, error: 'LINE Notify token required' });
      const r = await sendLine(token, msg);
      return res.json({ ok: r.status === 200, status: r.status });
    }
    res.status(400).json({ error: 'unknown channel' });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

// ── Socket.IO ──
io.on('connection', socket => {
  socket.emit('status', {
    symbols: [...engine.orderBooks.keys()],
    topGainers: engine.getTopGainers(),
    snapshots: engine.getSnapshots(),
  });

  socket.on('setSymbols', async symbols => {
    if (!Array.isArray(symbols)) return;
    const valid = symbols.map(s => s.toUpperCase().replace(/[^A-Z0-9]/g, ''))
      .filter(s => engine.getFuturesSymbols().includes(s) || s.endsWith('USDT'));
    await engine.updateSymbols(valid);
    io.emit('symbolsUpdated', [...engine.orderBooks.keys()]);
  });

  socket.on('setTimeframe', tf => {
    if (['5m','1h','1d'].includes(tf)) engine.setTimeframe(tf);
  });

  socket.on('updateConfig', cfg => {
    if (cfg.extremeThreshold) engine.alertEngine.config.extremeThreshold = +cfg.extremeThreshold;
    if (cfg.highThreshold) engine.alertEngine.config.highThreshold = +cfg.highThreshold;
    if (cfg.cooldownMs) engine.alertEngine.config.cooldownMs = +cfg.cooldownMs;
  });

  socket.on('disconnect', () => {});
});

async function main() {
  const symbols = await engine.start();
  server.listen(PORT, () => {
    console.log(`\n[Server] http://localhost:${PORT}`);
    console.log(`[Server] Tracking: ${symbols.join(', ')}\n`);
  });
}
main().catch(console.error);
