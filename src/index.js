#!/usr/bin/env node
/**
 * Entry point — runs in two modes:
 *   node src/index.js           → headless CLI, prints snapshots to console
 *   node src/index.js --server  → starts web dashboard + socket.io
 */

const args = process.argv.slice(2);

if (args.includes('--server')) {
  require('./server');
} else {
  // Headless CLI mode
  const ManipulationEngine = require('./engine');

  const engine = new ManipulationEngine({
    symbols: args.filter(a => !a.startsWith('--')).map(a => a.toUpperCase()),
    topGainersCount: 5,
    snapshotIntervalMs: 5_000,
  });

  engine.onSnapshot((snap) => {
    const m = snap.metrics;
    process.stdout.write('\x1Bc'); // clear screen
    console.log(`=== Crypto Manipulation Index — ${new Date().toLocaleTimeString()} ===\n`);
    console.log(`Symbol: ${snap.symbol}  |  Top Bid: ${snap.topBid}  |  Top Ask: ${snap.topAsk}`);
    console.log(`\n  Hole Collapse:    ${m.holeCollapse.value} /day  (normal: ${m.holeCollapse.normalRange})`);
    console.log(`  Betti Jump:       ${m.bettiJump.value} /day`);
    console.log(`  Max Persistence:  ${m.maxPersistence.value} strength  (avg: ${m.maxPersistence.avgValue})`);
    console.log(`\n  ► Manipulation Index: ${snap.manipulationIndex} — [${snap.manipulationLevel}]`);
    console.log('\nPress Ctrl+C to quit.');
  });

  engine.start().then(symbols => {
    console.log('Tracking:', symbols.join(', '), '— waiting for data...');
  });

  process.on('SIGINT', () => {
    engine.stop();
    process.exit(0);
  });
}
