/**
 * Alert Engine
 * Checks manipulation index thresholds and fires notifications
 */

const https = require('https');

class AlertEngine {
  constructor(config = {}) {
    this.config = {
      extremeThreshold: config.extremeThreshold ?? 55,
      highThreshold: config.highThreshold ?? 40,
      cooldownMs: config.cooldownMs ?? 5 * 60 * 1000, // 5 min between same-symbol alerts
      telegramToken: config.telegramToken ?? '',
      telegramChatId: config.telegramChatId ?? '',
    };

    this._lastAlertTime = new Map(); // symbol -> timestamp
    this._listeners = []; // in-process listeners (for web push)
  }

  /**
   * Register an in-process alert listener (e.g. to push via socket.io)
   */
  onAlert(fn) {
    this._listeners.push(fn);
  }

  /**
   * Check a snapshot and fire alerts if thresholds exceeded
   * @param {Object} snapshot - from OrderBook.getSnapshot()
   */
  check(snapshot) {
    const { symbol, manipulationIndex, manipulationLevel, metrics } = snapshot;
    const now = Date.now();

    const lastAlert = this._lastAlertTime.get(symbol) ?? 0;
    if (now - lastAlert < this.config.cooldownMs) return; // cooldown

    const isExtreme = manipulationIndex > this.config.extremeThreshold;
    const isHigh = manipulationIndex > this.config.highThreshold;

    if (!isHigh && !isExtreme) return;

    const alert = {
      symbol,
      level: manipulationLevel,
      index: manipulationIndex,
      metrics,
      timestamp: now,
      message: this._buildMessage(symbol, manipulationIndex, manipulationLevel, metrics),
    };

    this._lastAlertTime.set(symbol, now);
    this._dispatch(alert);
  }

  _buildMessage(symbol, index, level, metrics) {
    const flag = level === 'Extreme' ? '🔴' : '🟠';
    return [
      `${flag} [${level}] ${symbol} Manipulation Index: ${index}`,
      `  Hole Collapse: ${metrics.holeCollapse.value}/day (normal: ${metrics.holeCollapse.normalRange})`,
      `  Betti Jump: ${metrics.bettiJump.value}/day`,
      `  Max Persistence: ${metrics.maxPersistence.value} (avg: ${metrics.maxPersistence.avgValue})`,
    ].join('\n');
  }

  _dispatch(alert) {
    console.log('\n' + alert.message + '\n');

    // In-process listeners (socket.io etc.)
    for (const fn of this._listeners) {
      try { fn(alert); } catch (_) {}
    }

    // Telegram (optional)
    if (this.config.telegramToken && this.config.telegramChatId) {
      this._sendTelegram(alert.message).catch(e => console.error('[Telegram]', e.message));
    }
  }

  _sendTelegram(text) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ chat_id: this.config.telegramChatId, text });
      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${this.config.telegramToken}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

module.exports = AlertEngine;
