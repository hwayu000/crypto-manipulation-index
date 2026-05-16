const TOP_LEVELS = 20;

// Timeframe windows in ms
const WINDOWS = { '5m': 5*60*1000, '1h': 60*60*1000, '1d': 24*60*60*1000 };
const WARMUP_SAMPLES = 20;

class OrderBook {
  constructor(symbol) {
    this.symbol = symbol;
    this.bids = new Map();
    this.asks = new Map();
    this.lastUpdateId = 0;

    // Per-timeframe event windows
    this._holes  = []; // timestamps of hole collapse events
    this._bettis = []; // timestamps of betti jump events

    // Max persistence
    this.maxPersistenceScore = 0;
    this.largeOrders = new Map();

    // Adaptive baselines — stored per timeframe
    this._baseline = { '5m': null, '1h': null, '1d': null };
    this._history = { hole: [], betti: [], persist: [] }; // raw values per snapshot
    this._sampleCount = 0;

    this._prevBidLevels = 0;
    this._prevAskLevels = 0;
    this._prevTopAsk = Infinity;
  }

  applyUpdate(update) {
    if (update.U <= this.lastUpdateId) return;
    for (const [p, q] of update.b) {
      const pf = parseFloat(p), qf = parseFloat(q);
      qf === 0 ? this.bids.delete(pf) : this.bids.set(pf, qf);
    }
    for (const [p, q] of update.a) {
      const pf = parseFloat(p), qf = parseFloat(q);
      qf === 0 ? this.asks.delete(pf) : this.asks.set(pf, qf);
    }
    this.lastUpdateId = update.u;
    this._detect();
  }

  applySnapshot(snap) {
    this.bids.clear(); this.asks.clear();
    for (const [p, q] of snap.bids) this.bids.set(parseFloat(p), parseFloat(q));
    for (const [p, q] of snap.asks) this.asks.set(parseFloat(p), parseFloat(q));
    this.lastUpdateId = snap.lastUpdateId;
  }

  _sortedBids() { return [...this.bids.entries()].sort((a,b)=>b[0]-a[0]).slice(0,TOP_LEVELS); }
  _sortedAsks() { return [...this.asks.entries()].sort((a,b)=>a[0]-b[0]).slice(0,TOP_LEVELS); }

  _detect() {
    const now = Date.now();
    const bids = this._sortedBids(), asks = this._sortedAsks();
    if (!bids.length || !asks.length) return;

    const topAsk = asks[0][0];
    if (this._prevTopAsk !== Infinity && topAsk < this._prevTopAsk * 0.9985)
      this._holes.push(now);

    const delta = Math.abs(bids.length - this._prevBidLevels) + Math.abs(asks.length - this._prevAskLevels);
    if (delta >= 5) this._bettis.push(now);

    // Max persistence
    const avgB = bids.reduce((s,[,q])=>s+q,0)/(bids.length||1);
    const avgA = asks.reduce((s,[,q])=>s+q,0)/(asks.length||1);
    let persist = 0;
    for (const [price, qty] of [...bids, ...asks]) {
      const avg = bids.some(([p])=>p===price) ? avgB : avgA;
      if (qty > avg * 5) {
        if (!this.largeOrders.has(price)) this.largeOrders.set(price, { firstSeen: now, lastSeen: now });
        else { const lo = this.largeOrders.get(price); lo.lastSeen = now; persist = Math.max(persist, (now - lo.firstSeen)/1000); }
      } else this.largeOrders.delete(price);
    }
    this.maxPersistenceScore = persist;

    this._prevBidLevels = bids.length;
    this._prevAskLevels = asks.length;
    this._prevTopAsk = topAsk;
  }

  _prune(arr, windowMs) {
    const cutoff = Date.now() - windowMs;
    while (arr.length && arr[0] < cutoff) arr.shift();
  }

  // Count events in a given window
  _count(arr, windowMs) {
    const cutoff = Date.now() - windowMs;
    return arr.filter(t => t > cutoff).length;
  }

  // Rate: events per day equivalent for the given window
  _rate(arr, windowMs) {
    return this._count(arr, windowMs) * (86400000 / windowMs);
  }

  recordSample() {
    // Prune to max window
    this._prune(this._holes, WINDOWS['1d']);
    this._prune(this._bettis, WINDOWS['1d']);

    // Record current 1h rates into history for baseline learning
    const holeRate = this._rate(this._holes, WINDOWS['1h']);
    const bettiRate = this._rate(this._bettis, WINDOWS['1h']);
    const persist = this.maxPersistenceScore;

    this._history.hole.push(holeRate);
    this._history.betti.push(bettiRate);
    this._history.persist.push(persist);
    if (this._history.hole.length > 120) { this._history.hole.shift(); this._history.betti.shift(); this._history.persist.shift(); }

    this._sampleCount++;
  }

  _p25(arr) {
    if (!arr.length) return null;
    const s = [...arr].sort((a,b)=>a-b);
    return Math.max(s[Math.floor(s.length * 0.25)], 0.1);
  }

  isWarmedUp() { return this._sampleCount >= WARMUP_SAMPLES; }
  getWarmup() { return { current: Math.min(this._sampleCount, WARMUP_SAMPLES), total: WARMUP_SAMPLES }; }

  // Compute index for a given timeframe
  _indexForWindow(tf) {
    if (!this.isWarmedUp()) return null;
    const wms = WINDOWS[tf];
    const hNow = this._rate(this._holes, wms);
    const bNow = this._rate(this._bettis, wms);
    const pNow = this.maxPersistenceScore;

    const hBase = this._p25(this._history.hole) ?? 1;
    const bBase = this._p25(this._history.betti) ?? 1;
    const pBase = this._p25(this._history.persist) ?? 1;

    const hScore = Math.min(100, Math.max(0, ((hNow/hBase) - 1) * 50));
    const bScore = Math.min(100, Math.max(0, ((bNow/bBase) - 1) * 50));
    const pScore = Math.min(100, Math.max(0, ((pNow/pBase) - 1) * 33));

    return Math.round(hScore*0.45 + bScore*0.30 + pScore*0.25);
  }

  getSnapshot(tf = '1h') {
    this.recordSample();
    const wms = WINDOWS[tf] ?? WINDOWS['1h'];
    const hVal = this._rate(this._holes, wms);
    const bVal = this._rate(this._bettis, wms);
    const pVal = this.maxPersistenceScore;
    const idx = this._indexForWindow(tf);
    const level = idx === null ? null : idx > 55 ? 'Extreme' : idx > 40 ? 'High' : idx > 28 ? 'Moderate' : 'Natural';

    const bids = this._sortedBids();
    const asks = this._sortedAsks();

    return {
      symbol: this.symbol,
      timestamp: Date.now(),
      tf,
      topBid: bids[0]?.[0] ?? null,
      topAsk: asks[0]?.[0] ?? null,
      warmedUp: this.isWarmedUp(),
      warmup: this.getWarmup(),
      metrics: {
        holeCollapse: { value: Math.round(hVal), baseline: this._p25(this._history.hole) },
        bettiJump:    { value: Math.round(bVal), baseline: this._p25(this._history.betti) },
        maxPersistence: { value: Math.round(pVal), baseline: this._p25(this._history.persist) },
      },
      manipulationIndex: idx,
      manipulationLevel: level,
      // Pre-compute all timeframes for the client
      allTf: {
        '5m': this._indexForWindow('5m'),
        '1h': this._indexForWindow('1h'),
        '1d': this._indexForWindow('1d'),
      },
    };
  }
}

module.exports = OrderBook;
