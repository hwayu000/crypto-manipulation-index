const WebSocket = require('ws');
const https = require('https');

const SPOT_REST = 'https://api.binance.com';
const FUTURES_REST = 'https://fapi.binance.com';
const FUTURES_WS = 'wss://fstream.binance.com/stream';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// Fetch all active USDT-margined perpetual futures symbols
async function fetchFuturesSymbols() {
  const info = await httpsGet(`${FUTURES_REST}/fapi/v1/exchangeInfo`);
  return info.symbols
    .filter(s => s.contractType === 'PERPETUAL' && s.status === 'TRADING' && s.quoteAsset === 'USDT')
    .map(s => s.symbol)
    .sort();
}

// Fetch top N gainers from futures 24h ticker
async function fetchTopGainers(n = 20) {
  const tickers = await httpsGet(`${FUTURES_REST}/fapi/v1/ticker/24hr`);
  return tickers
    .filter(t => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 1_000_000)
    .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
    .slice(0, n)
    .map(t => ({
      symbol: t.symbol,
      changePercent: parseFloat(t.priceChangePercent).toFixed(2),
      price: parseFloat(t.lastPrice),
      volume: parseFloat(t.quoteVolume).toFixed(0),
    }));
}

// Fetch futures order book snapshot
async function fetchOrderBookSnapshot(symbol, limit = 100) {
  return httpsGet(`${FUTURES_REST}/fapi/v1/depth?symbol=${symbol}&limit=${limit}`);
}

// Subscribe to futures depth streams via combined stream
function subscribeDepth(symbols, onUpdate) {
  const streams = symbols.map(s => `${s.toLowerCase()}@depth@100ms`).join('/');
  const url = `${FUTURES_WS}?streams=${streams}`;
  let closed = false, pingTimer, ws;

  function connect() {
    ws = new WebSocket(url);
    ws.on('open', () => {
      console.log(`[FuturesWS] Connected: ${symbols.length} symbols`);
      pingTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.ping(); }, 20000);
    });
    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        const evt = msg.data ?? msg;
        if (evt.e === 'depthUpdate' && evt.s) onUpdate(evt.s, evt);
      } catch (_) {}
    });
    ws.on('close', () => {
      clearInterval(pingTimer);
      if (!closed) setTimeout(connect, 3000);
    });
    ws.on('error', err => { console.error('[FuturesWS]', err.message); ws.terminate(); });
  }

  connect();
  return { close() { closed = true; clearInterval(pingTimer); ws?.terminate(); } };
}

// Subscribe to futures mini ticker
function subscribeTicker(symbols, onTick) {
  const streams = symbols.map(s => `${s.toLowerCase()}@miniTicker`).join('/');
  const url = `${FUTURES_WS}?streams=${streams}`;
  let closed = false;

  function connect() {
    const ws = new WebSocket(url);
    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        const e = msg.data ?? msg;
        if (e.e === '24hrMiniTicker') {
          onTick(e.s, { price: parseFloat(e.c), open: parseFloat(e.o), high: parseFloat(e.h), low: parseFloat(e.l), volume: parseFloat(e.v), quoteVolume: parseFloat(e.q) });
        }
      } catch (_) {}
    });
    ws.on('close', () => { if (!closed) setTimeout(connect, 3000); });
    ws.on('error', err => { console.error('[TickerWS]', err.message); ws.terminate(); });
  }
  connect();
  return { close() { closed = true; } };
}

module.exports = { fetchFuturesSymbols, fetchTopGainers, fetchOrderBookSnapshot, subscribeDepth, subscribeTicker };
