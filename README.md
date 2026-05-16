# CMI — Crypto Manipulation Index
### 加密市場操縱指數 | Real-Time Order Book Manipulation Detection

[![License: MIT](https://img.shields.io/badge/License-MIT-white.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-blue)](https://nodejs.org)
[![Binance Futures](https://img.shields.io/badge/data-Binance%20Futures-F0B90B)](https://fapi.binance.com)
[![Stars](https://img.shields.io/github/stars/hwayu000/crypto-manipulation-index?style=social)](https://github.com/hwayu000/crypto-manipulation-index/stargazers)

> **Free & open-source.** Self-host in 2 minutes. No API key required.
> 
> **免費開源。** 2 分鐘自架。不需要任何 API Key。

---

![Dashboard](https://raw.githubusercontent.com/hwayu000/crypto-manipulation-index/main/docs/preview.png)

---

## What is this? | 這是什麼？

A self-hosted real-time dashboard that monitors **Binance perpetual futures** order books and detects algorithmic market manipulation through three structural signals, combined into a single **Manipulation Index (0–100)**.

這是一個自架的實時儀表板，監控**幣安永續合約**訂單簿，透過三個結構性信號偵測算法市場操控行為，綜合成單一**操縱指數（0–100）**。

---

## Three Signals | 三大信號

| Signal | 信號 | What it detects | 偵測什麼 |
|--------|------|-----------------|---------|
| **Hole Collapse** | 空洞坍塌 | Short-side resistance walls forcibly pierced | 空頭防線被暴力穿越的頻率 |
| **Betti Jump** | 拓撲重構 | Topology changes from HFT quote stuffing | 高頻掛撤單引發的訂單簿結構突變 |
| **Max Persistence** | 流動性集中度 | Large order lock duration (artificial price anchor) | 超大單停留時間，人造價格磁鐵效應 |

**Index Levels | 指數等級**

| Score | Level | 等級 |
|-------|-------|------|
| 0–28 | Natural | 自然狀態 |
| 28–40 | Moderate | 中度操控 |
| 40–55 | High | 高操控 |
| **> 55** | **Extreme** | **極高操控** |

> Each symbol learns its **own adaptive baseline** — the index measures deviation from that symbol's normal behaviour, not a fixed global threshold.
>
> 每個幣種都有**自適應基準線**，指數衡量的是偏離自身正常狀態的程度，而非固定全局閾值。

---

## Features | 功能

- 📡 **Real-time** Binance Futures WebSocket (100ms order book updates)
- 🔍 **Search** all 530+ active USDT perpetual contracts
- 📊 **TradingView chart** embedded — syncs with selected symbol
- 🚨 **Configurable alerts** — thresholds adjustable live from the dashboard
- 🔔 **Push notifications** — Telegram & LINE Notify support
- 🌐 **Bilingual UI** — English / 繁體中文 toggle
- 📱 **Responsive** — works on mobile & desktop
- 🐳 **Docker ready** — one-command deploy to Railway / Render / Fly.io
- 🔑 **Zero API key required** — uses Binance public data only

---

## Quick Start | 快速開始

### Requirements | 環境需求
- **Node.js ≥ 18**
- Internet access to Binance

```bash
# 1. Clone
git clone https://github.com/hwayu000/crypto-manipulation-index.git
cd crypto-manipulation-index

# 2. Install
npm install

# 3. Run dashboard
node src/index.js --server
```

Open **http://localhost:3000** 🎉

### CLI mode (no browser)
```bash
node src/index.js BTCUSDT SOLUSDT
```

---

## Deploy to Cloud | 雲端部署

### Railway (recommended | 推薦)
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/hwayu000/crypto-manipulation-index)

1. Click the button above
2. Connect your GitHub account
3. Done — public URL in ~2 minutes

### Render
1. New Web Service → connect this repo
2. Build: `npm ci --omit=dev`
3. Start: `node src/index.js --server`

### Docker
```bash
docker build -t cmi .
docker run -p 3000:3000 cmi
```

---

## Configuration | 設定

Copy `.env.example` to `.env`:

```env
PORT=3000

# Alert thresholds (also adjustable live in UI)
MANIPULATION_EXTREME_THRESHOLD=55
MANIPULATION_HIGH_THRESHOLD=40

# Telegram push notifications (optional)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# LINE Notify (optional)
LINE_NOTIFY_TOKEN=
```

### Notifications Setup | 通知設定

Click **Notifications** in the top-right → fill in tokens → **Send Test** to verify → **Save**.

**Telegram:** Get bot token from [@BotFather](https://t.me/BotFather) → `/newbot`

**LINE Notify:** Get token at [notify-bot.line.me](https://notify-bot.line.me/my/) → Generate token

---

## API | 介面

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | All snapshots + top gainers |
| `GET` | `/api/gainers` | Top 24h gainers (futures) |
| `GET` | `/api/search?q=BTC` | Search futures symbols |
| `POST` | `/api/symbols` | `{ symbols: ["BTCUSDT"] }` |
| `GET` | `/api/notify` | Notification config (masked) |
| `POST` | `/api/notify` | Save notification config |
| `POST` | `/api/notify/test` | `{ channel: "telegram" \| "line" }` |

### WebSocket Events

```js
// Server → Client (every 3s per symbol)
socket.on('snapshot', snap => { /* snap.manipulationIndex, snap.metrics, snap.allTf */ })
socket.on('alert', alert => { /* alert.symbol, alert.level, alert.index */ })

// Client → Server
socket.emit('setSymbols', ['BTCUSDT', 'SOLUSDT'])
socket.emit('updateConfig', { extremeThreshold: 60, highThreshold: 45, cooldownMs: 300000 })
```

---

## How it Works | 原理

```
Binance Futures WebSocket
        │
        ▼
  Order Book (depth@100ms)
        │
        ├─► Hole Collapse detector   ─┐
        ├─► Betti Jump detector       ├─► Adaptive baseline (per symbol)
        └─► Max Persistence tracker  ─┘         │
                                                 ▼
                                    Composite Index (0–100)
                                                 │
                                    Alert Engine → Telegram / LINE
```

Each signal uses a **rolling 1-hour window** scaled to events/day. The baseline is the **25th percentile** of observed values — meaning the index spikes only when the current value is significantly above what's *normal for that specific coin*.

每個信號使用**滾動 1 小時窗口**換算成每日頻率。基準線為觀測值的 **25 百分位數**，只有當前值顯著高於該幣種自身正常水準時，指數才會飆升。

---

## Contributing & Remixing | 貢獻與魔改

**This project is built to be hacked.** Fork it, remix it, make it yours.

**這個專案就是要讓人魔改的。** Fork 去、改掉、變成你自己的東西。

We genuinely want to see what you build with this — whether it's a completely different UI skin, a new signal detector, a mobile app wrapper, or something we haven't imagined. **Every creative direction is welcome.**

我們真的很想看看你用這個做出什麼 —— 不管是全新的介面風格、新的信號偵測器、手機 App 封裝，還是我們沒想到的東西。**所有創意方向都歡迎。**

```bash
# Fork → clone your fork
git clone https://github.com/YOUR_USERNAME/crypto-manipulation-index.git

# Create a branch and go wild
git checkout -b feature/your-wild-idea
```

### Ideas to spark your imagination | 激發靈感的方向

- 🧠 **New signal detectors** — spoofing patterns, iceberg order detection, wash trading signatures
- 📱 **Native mobile app** — wrap it in React Native or Capacitor
- 🎨 **New UI themes** — light mode, neon, terminal green, anything
- 📈 **Historical storage** — SQLite + trend charts showing manipulation over time
- 🤖 **AI layer** — feed the signals into an LLM for natural language alerts
- 🔔 **More channels** — Discord webhooks, Email, push notifications
- 🌍 **More exchanges** — OKX, Bybit, dYdX order book support
- 📊 **Correlation view** — show manipulation across multiple symbols simultaneously
- 🏆 **Leaderboard** — rank coins by manipulation intensity in real-time

**No contribution is too small.** Fixed a typo? Improved a label? That counts too.

**沒有太小的貢獻。** 修了個錯字？改了個標籤文字？都算。

If you build something cool on top of this, open an Issue or PR and show us — we'll feature it here.

如果你用這個做出了什麼酷東西，開個 Issue 或 PR 讓我們看看 —— 我們會把它放在這裡展示。

---

## Disclaimer | 免責聲明

This tool is for **educational and research purposes only**. The manipulation signals are heuristic approximations based on order book microstructure — they are **not financial advice**. Always do your own research before trading.

本工具僅供**學習與研究用途**。操縱信號為基於訂單簿微觀結構的啟發式近似，**不構成投資建議**。交易前請自行判斷。

---

## License | 授權

[MIT](LICENSE) © 2025 [Ashdata](https://github.com/hwayu000)

---

<div align="center">
  <b>If this helps you, give it a ⭐</b><br>
  <b>如果對你有幫助，請給個 ⭐</b>
</div>
