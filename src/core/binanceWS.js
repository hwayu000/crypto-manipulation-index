/**
 * Binance WebSocket Manager
 * Handles connections, subscriptions, and reconnection logic
 */

const WebSocket = require('ws');
const https = require('https');

const WS_BASE = 'wss://stream.binance.com:9443/ws';
const REST_BASE = 'https://api.binance.com';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

/**
 * Fetch top N gainers from Binance (USDT pairs, sorted by 24h % change)
 */
async function fetchTopGainers(n = 20) {
  const tickers = await httpsGet(`${REST_BASE}/api/v3/ticker/24hr`);
  return tickers
    .filter(t => t.symbol.endsWith('USDT') && parseFloat(t.volume) > 100000)
    .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
    .slice(0, n)
    .map(t => ({
      symbol: t.symbol,
      changePercent: parseFloat(t.priceChangePercent).toFixed(2),
      price: parseFloat(t.lastPrice),
      volume: parseFloat(t.quoteVolume).toFixed(0),
    }));
}

/**
 * Fetch order book snapshot for a symbol
 */
async function fetchOrderBookSnapshot(symbol, limit = 100) {
  return httpsGet(`${REST_BASE}/api/v3/depth?symbol=${symbol}&limit=${limit}`);
}

/**
 * Create a WebSocket connection subscribing to depth streams for given symbols
 * @param {string[]} symbols - e.g. ['BTCUSDT', 'ETHUSDT']
 * @param {Function} onUpdate - callback(symbol, updateEvent)
 * @param {Function} onError - callback(err)
 * @returns {{ close: Function }}
 */
function subscribeDepth(symbols, onUpdate, onError) {
  const streams = symbols.map(s => `${s.toLowerCase()}@depth@100ms`).join('/');
  const url = `${WS_BASE}/${streams}`;

  let ws;
  let pingInterval;
  let reconnectTimer;
  let closed = false;

  function connect() {
    ws = new WebSocket(url);

    ws.on('open', () => {
      console.log(`[WS] Connected: ${symbols.join(', ')}`);
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      }, 15000);
    });

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw);
        // Combined stream wraps in { stream, data }
        const event = data.data ?? data;
        const symbol = event.s;
        if (symbol) onUpdate(symbol, event);
      } catch (e) {
        // ignore parse errors
      }
    });

    ws.on('pong', () => {}); // keep-alive acknowledged

    ws.on('close', () => {
      clearInterval(pingInterval);
      if (!closed) {
        console.log('[WS] Disconnected, reconnecting in 3s...');
        reconnectTimer = setTimeout(connect, 3000);
      }
    });

    ws.on('error', (err) => {
      console.error('[WS] Error:', err.message);
      if (onError) onError(err);
      ws.terminate();
    });
  }

  connect();

  return {
    close() {
      closed = true;
      clearInterval(pingInterval);
      clearTimeout(reconnectTimer);
      ws?.terminate();
    },
  };
}

/**
 * Subscribe to mini ticker for all symbols (price + volume updates)
 * @param {string[]} symbols
 * @param {Function} onTick - callback(symbol, tickerData)
 */
function subscribeTicker(symbols, onTick) {
  const streams = symbols.map(s => `${s.toLowerCase()}@miniTicker`).join('/');
  const url = `${WS_BASE}/${streams}`;

  let closed = false;

  function connect() {
    const ws = new WebSocket(url);

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw);
        const event = data.data ?? data;
        if (event.e === '24hrMiniTicker') {
          onTick(event.s, {
            price: parseFloat(event.c),
            open: parseFloat(event.o),
            high: parseFloat(event.h),
            low: parseFloat(event.l),
            volume: parseFloat(event.v),
            quoteVolume: parseFloat(event.q),
          });
        }
      } catch (_) {}
    });

    ws.on('close', () => {
      if (!closed) setTimeout(connect, 3000);
    });

    ws.on('error', (err) => {
      console.error('[Ticker WS]', err.message);
      ws.terminate();
    });

    return ws;
  }

  const ws = connect();
  return { close: () => { closed = true; ws?.terminate(); } };
}

module.exports = { fetchTopGainers, fetchOrderBookSnapshot, subscribeDepth, subscribeTicker };
