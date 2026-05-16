const OrderBook = require('./core/orderbook');
const { fetchFuturesSymbols, fetchTopGainers, fetchOrderBookSnapshot, subscribeDepth, subscribeTicker } = require('./core/binanceWS');
const AlertEngine = require('./core/alertEngine');

class ManipulationEngine {
  constructor(config = {}) {
    this.config = {
      symbols: config.symbols ?? [],
      topGainersCount: config.topGainersCount ?? 10,
      topGainersRefreshMs: config.topGainersRefreshMs ?? 60_000,
      snapshotIntervalMs: config.snapshotIntervalMs ?? 3_000,
      alertConfig: config.alertConfig ?? {},
    };
    this.orderBooks = new Map();
    this.tickers = new Map();
    this.topGainers = [];
    this.futuresSymbols = []; // full list of valid futures symbols
    this.alertEngine = new AlertEngine(this.config.alertConfig);
    this._wsDepth = null;
    this._wsTicker = null;
    this._snapshotTimer = null;
    this._gainersTimer = null;
    this._snapListeners = [];
    this._activeTf = '1h'; // default timeframe
  }

  onSnapshot(fn) { this._snapListeners.push(fn); }
  onAlert(fn) { this.alertEngine.onAlert(fn); }

  setTimeframe(tf) { this._activeTf = tf; }

  async start() {
    console.log('[Engine] Starting…');
    // Load full futures symbol list for search
    try {
      this.futuresSymbols = await fetchFuturesSymbols();
      console.log(`[Engine] Loaded ${this.futuresSymbols.length} futures symbols`);
    } catch (e) {
      console.warn('[Engine] Could not load futures symbols:', e.message);
    }
    const symbols = await this._resolveSymbols();
    await this._subscribe(symbols);
    this._startSnapshotLoop();
    if (!this.config.symbols.length)
      this._gainersTimer = setInterval(() => this._refreshGainers(), this.config.topGainersRefreshMs);
    console.log(`[Engine] Tracking: ${symbols.join(', ')}`);
    return symbols;
  }

  async updateSymbols(newSymbols) {
    this._wsDepth?.close(); this._wsTicker?.close();
    // Keep existing orderbooks to preserve warmup data
    const toAdd = newSymbols.filter(s => !this.orderBooks.has(s));
    const toRemove = [...this.orderBooks.keys()].filter(s => !newSymbols.includes(s));
    for (const s of toRemove) { this.orderBooks.delete(s); this.tickers.delete(s); }
    await this._subscribe(newSymbols, toAdd);
  }

  stop() {
    this._wsDepth?.close(); this._wsTicker?.close();
    clearInterval(this._snapshotTimer); clearInterval(this._gainersTimer);
  }

  getSnapshots(tf) {
    const activeTf = tf ?? this._activeTf;
    return [...this.orderBooks.values()].map(ob => {
      const snap = ob.getSnapshot(activeTf);
      snap.ticker = this.tickers.get(ob.symbol) ?? null;
      return snap;
    });
  }

  getTopGainers() { return this.topGainers; }
  getFuturesSymbols() { return this.futuresSymbols; }

  searchSymbols(query) {
    const q = query.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!q) return [];
    return this.futuresSymbols.filter(s => s.includes(q)).slice(0, 20);
  }

  async _resolveSymbols() {
    if (this.config.symbols.length) return this.config.symbols;
    return this._refreshGainers();
  }

  async _refreshGainers() {
    try {
      this.topGainers = await fetchTopGainers(this.config.topGainersCount);
      return this.topGainers.map(g => g.symbol);
    } catch (e) {
      console.error('[Engine] Gainers fetch failed:', e.message);
      return this.config.symbols.length ? this.config.symbols : ['BTCUSDT', 'ETHUSDT'];
    }
  }

  async _subscribe(allSymbols, onlyFetch = null) {
    const toFetch = onlyFetch ?? allSymbols;
    for (const sym of toFetch) {
      if (!this.orderBooks.has(sym)) {
        const ob = new OrderBook(sym);
        try { ob.applySnapshot(await fetchOrderBookSnapshot(sym)); } catch (_) {}
        this.orderBooks.set(sym, ob);
      }
    }
    if (!allSymbols.length) return;
    this._wsDepth = subscribeDepth(allSymbols, (sym, evt) => this.orderBooks.get(sym)?.applyUpdate(evt));
    this._wsTicker = subscribeTicker(allSymbols, (sym, tick) => this.tickers.set(sym, tick));
  }

  _startSnapshotLoop() {
    this._snapshotTimer = setInterval(() => {
      for (const [sym, ob] of this.orderBooks) {
        const snap = ob.getSnapshot(this._activeTf);
        snap.ticker = this.tickers.get(sym) ?? null;
        this.alertEngine.check(snap);
        for (const fn of this._snapListeners) { try { fn(snap); } catch (_) {} }
      }
    }, this.config.snapshotIntervalMs);
  }
}

module.exports = ManipulationEngine;
