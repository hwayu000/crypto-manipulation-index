/**
 * Main Engine
 * Orchestrates: symbol selection → WebSocket subscriptions → index computation → alerts
 */

const OrderBook = require('./core/orderbook');
const { fetchTopGainers, fetchOrderBookSnapshot, subscribeDepth, subscribeTicker } = require('./core/binanceWS');
const AlertEngine = require('./core/alertEngine');

class ManipulationEngine {
  constructor(config = {}) {
    this.config = {
      symbols: config.symbols ?? [],          // manual symbol list; [] = auto top gainers
      topGainersCount: config.topGainersCount ?? 10,
      topGainersRefreshMs: config.topGainersRefreshMs ?? 60_000,
      snapshotIntervalMs: config.snapshotIntervalMs ?? 3_000,
      alertConfig: config.alertConfig ?? {},
    };

    this.orderBooks = new Map();  // symbol -> OrderBook
    this.tickers = new Map();     // symbol -> ticker data
    this.topGainers = [];

    this.alertEngine = new AlertEngine(this.config.alertConfig);
    this._wsDepth = null;
    this._wsTicker = null;
    this._snapshotTimer = null;
    this._gainersTimer = null;
    this._listeners = [];         // snapshot update listeners
  }

  onSnapshot(fn) {
    this._listeners.push(fn);
  }

  onAlert(fn) {
    this.alertEngine.onAlert(fn);
  }

  async start() {
    console.log('[Engine] Starting...');
    const symbols = await this._resolveSymbols();
    await this._subscribe(symbols);
    this._startSnapshotLoop();

    // Auto-refresh top gainers if in auto mode
    if (this.config.symbols.length === 0) {
      this._gainersTimer = setInterval(() => this._refreshGainers(), this.config.topGainersRefreshMs);
    }

    console.log(`[Engine] Tracking: ${symbols.join(', ')}`);
    return symbols;
  }

  async updateSymbols(newSymbols) {
    console.log('[Engine] Updating symbols to:', newSymbols.join(', '));
    this._wsDepth?.close();
    this._wsTicker?.close();
    this.orderBooks.clear();
    this.tickers.clear();
    await this._subscribe(newSymbols);
  }

  stop() {
    this._wsDepth?.close();
    this._wsTicker?.close();
    clearInterval(this._snapshotTimer);
    clearInterval(this._gainersTimer);
    console.log('[Engine] Stopped.');
  }

  getSnapshots() {
    return [...this.orderBooks.values()].map(ob => {
      const snap = ob.getSnapshot();
      snap.ticker = this.tickers.get(ob.symbol) ?? null;
      return snap;
    });
  }

  getTopGainers() {
    return this.topGainers;
  }

  async _resolveSymbols() {
    if (this.config.symbols.length > 0) return this.config.symbols;
    return this._refreshGainers();
  }

  async _refreshGainers() {
    try {
      this.topGainers = await fetchTopGainers(this.config.topGainersCount);
      return this.topGainers.map(g => g.symbol);
    } catch (e) {
      console.error('[Engine] Failed to fetch top gainers:', e.message);
      return this.config.symbols.length > 0 ? this.config.symbols : ['BTCUSDT', 'ETHUSDT'];
    }
  }

  async _subscribe(symbols) {
    // Initialize order books and fetch snapshots
    for (const sym of symbols) {
      if (!this.orderBooks.has(sym)) {
        const ob = new OrderBook(sym);
        try {
          const snap = await fetchOrderBookSnapshot(sym, 100);
          ob.applySnapshot(snap);
        } catch (e) {
          console.warn(`[Engine] Could not fetch snapshot for ${sym}:`, e.message);
        }
        this.orderBooks.set(sym, ob);
      }
    }

    // Subscribe depth updates
    this._wsDepth = subscribeDepth(symbols, (symbol, update) => {
      const ob = this.orderBooks.get(symbol);
      if (ob) ob.applyUpdate(update);
    });

    // Subscribe ticker
    this._wsTicker = subscribeTicker(symbols, (symbol, tick) => {
      this.tickers.set(symbol, tick);
    });
  }

  _startSnapshotLoop() {
    this._snapshotTimer = setInterval(() => {
      const snapshots = this.getSnapshots();
      for (const snap of snapshots) {
        this.alertEngine.check(snap);
        for (const fn of this._listeners) {
          try { fn(snap); } catch (_) {}
        }
      }
    }, this.config.snapshotIntervalMs);
  }
}

module.exports = ManipulationEngine;
