/**
 * Order Book Tracker
 * Maintains a local order book snapshot + tracks manipulation signals
 */

const TOP_LEVELS = 20; // how many price levels to track per side

class OrderBook {
  constructor(symbol) {
    this.symbol = symbol;
    this.bids = new Map(); // price -> qty
    this.asks = new Map();
    this.lastUpdateId = 0;

    // Hole Collapse metrics
    this.holeCollapseCount = 0;
    this.holeCollapseWindow = []; // timestamps

    // Betti Jump metrics (topological structure changes)
    this.bettiJumpCount = 0;
    this.bettiJumpWindow = [];

    // Max Persistence metrics (large order magnetism)
    this.maxPersistenceScore = 0;
    this.largeOrders = new Map(); // price -> {qty, firstSeen, lastSeen}

    // Previous state for diff
    this._prevBidLevels = 0;
    this._prevAskLevels = 0;
    this._prevTopBid = 0;
    this._prevTopAsk = Infinity;

    this._windowMs = 60 * 60 * 1000; // 1-hour rolling window for rate calc
  }

  /**
   * Apply a depth update from WebSocket
   * @param {Object} update - Binance depthUpdate event
   */
  applyUpdate(update) {
    if (update.U <= this.lastUpdateId) return; // stale

    for (const [price, qty] of update.b) {
      const p = parseFloat(price);
      const q = parseFloat(qty);
      if (q === 0) this.bids.delete(p);
      else this.bids.set(p, q);
    }
    for (const [price, qty] of update.a) {
      const p = parseFloat(price);
      const q = parseFloat(qty);
      if (q === 0) this.asks.delete(p);
      else this.asks.set(p, q);
    }

    this.lastUpdateId = update.u;
    this._detectSignals();
  }

  /**
   * Initialize from REST snapshot
   */
  applySnapshot(snapshot) {
    this.bids.clear();
    this.asks.clear();
    for (const [price, qty] of snapshot.bids) {
      this.bids.set(parseFloat(price), parseFloat(qty));
    }
    for (const [price, qty] of snapshot.asks) {
      this.asks.set(parseFloat(price), parseFloat(qty));
    }
    this.lastUpdateId = snapshot.lastUpdateId;
  }

  _sortedBids() {
    return [...this.bids.entries()].sort((a, b) => b[0] - a[0]).slice(0, TOP_LEVELS);
  }

  _sortedAsks() {
    return [...this.asks.entries()].sort((a, b) => a[0] - b[0]).slice(0, TOP_LEVELS);
  }

  _detectSignals() {
    const now = Date.now();
    const bids = this._sortedBids();
    const asks = this._sortedAsks();

    if (bids.length === 0 || asks.length === 0) return;

    const topBid = bids[0][0];
    const topAsk = asks[0][0];

    // === HOLE COLLAPSE ===
    // Detect when resistance walls (large ask clusters) are pierced rapidly
    // Proxy: top ask price drops significantly (wall being eaten)
    if (this._prevTopAsk !== Infinity && topAsk < this._prevTopAsk * 0.9985) {
      this.holeCollapseWindow.push(now);
    }

    // === BETTI JUMP ===
    // Structural change: number of distinct price levels changes abruptly
    const bidLevels = bids.length;
    const askLevels = asks.length;
    const levelDelta = Math.abs(bidLevels - this._prevBidLevels) + Math.abs(askLevels - this._prevAskLevels);
    if (levelDelta >= 5) {
      this.bettiJumpWindow.push(now);
    }

    // === MAX PERSISTENCE (large order tracking) ===
    const LARGE_ORDER_THRESHOLD_MULTIPLIER = 5; // 5x average qty = large
    const avgBidQty = bids.reduce((s, [, q]) => s + q, 0) / (bids.length || 1);
    const avgAskQty = asks.reduce((s, [, q]) => s + q, 0) / (asks.length || 1);

    let persistenceScore = 0;
    for (const [price, qty] of [...bids, ...asks]) {
      const avg = bids.some(([p]) => p === price) ? avgBidQty : avgAskQty;
      if (qty > avg * LARGE_ORDER_THRESHOLD_MULTIPLIER) {
        if (!this.largeOrders.has(price)) {
          this.largeOrders.set(price, { qty, firstSeen: now, lastSeen: now });
        } else {
          const lo = this.largeOrders.get(price);
          lo.lastSeen = now;
          lo.qty = qty;
          // Persistence = how long this large order has stayed (seconds)
          const persistSec = (lo.lastSeen - lo.firstSeen) / 1000;
          persistenceScore = Math.max(persistenceScore, persistSec);
        }
      } else {
        this.largeOrders.delete(price);
      }
    }
    this.maxPersistenceScore = persistenceScore;

    // Prune old window entries
    const cutoff = now - this._windowMs;
    this.holeCollapseWindow = this.holeCollapseWindow.filter(t => t > cutoff);
    this.bettiJumpWindow = this.bettiJumpWindow.filter(t => t > cutoff);

    // Update counts (events per hour, scaled to /day for display)
    this.holeCollapseCount = this.holeCollapseWindow.length * 24;
    this.bettiJumpCount = this.bettiJumpWindow.length * 24;

    this._prevBidLevels = bidLevels;
    this._prevAskLevels = askLevels;
    this._prevTopBid = topBid;
    this._prevTopAsk = topAsk;
  }

  /**
   * Compute the composite manipulation index score (0-100)
   */
  getManipulationIndex() {
    // Normalize each metric to 0-100
    const holeScore = Math.min(100, (this.holeCollapseCount / 4000) * 100);
    const bettiScore = Math.min(100, (this.bettiJumpCount / 200) * 100);
    const persistScore = Math.min(100, (this.maxPersistenceScore / 300) * 100);

    // Weighted composite
    return Math.round(holeScore * 0.45 + bettiScore * 0.30 + persistScore * 0.25);
  }

  getSnapshot() {
    const bids = this._sortedBids();
    const asks = this._sortedAsks();
    const index = this.getManipulationIndex();

    return {
      symbol: this.symbol,
      timestamp: Date.now(),
      spread: asks.length && bids.length ? asks[0][0] - bids[0][0] : null,
      topBid: bids[0]?.[0] ?? null,
      topAsk: asks[0]?.[0] ?? null,
      bids: bids.slice(0, 5),
      asks: asks.slice(0, 5),
      metrics: {
        holeCollapse: {
          value: this.holeCollapseCount,
          normalRange: 2000,
          label: 'Hole Collapse',
          labelZh: '空洞坍塌',
          unit: 'times/day',
        },
        bettiJump: {
          value: this.bettiJumpCount,
          normalRange: '80-150',
          label: 'Betti Jump',
          labelZh: '拓扑重构',
          unit: 'times/day',
        },
        maxPersistence: {
          value: Math.round(this.maxPersistenceScore),
          avgValue: 160,
          label: 'Max Persistence',
          labelZh: '流动性集中度',
          unit: 'strength',
        },
      },
      manipulationIndex: index,
      manipulationLevel: index > 55 ? 'Extreme' : index > 40 ? 'High' : index > 28 ? 'Moderate' : 'Natural',
    };
  }
}

module.exports = OrderBook;
