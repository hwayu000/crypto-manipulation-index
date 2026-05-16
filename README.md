# Crypto Manipulation Index
### 加密市場操縱指數 | Real-Time Order Book Manipulation Detection

> Detect algorithmic market manipulation in real-time using Binance order book data.
> 利用幣安訂單簿數據，實時偵測加密市場的算法操控行為。

![Dashboard Preview](https://img.shields.io/badge/status-live-brightgreen) ![Node](https://img.shields.io/badge/node-%3E%3D18-blue) ![License](https://img.shields.io/badge/license-MIT-green)

---

## What is this? | 這是什麼？

A self-hosted dashboard that monitors **three structural signals** from Binance order books to compute a **Composite Manipulation Index (0–100)**. When the index exceeds configurable thresholds, alerts fire — optionally pushed to Telegram.

這是一個自架儀表板，透過分析幣安訂單簿的**三個結構性信號**，計算出**綜合操縱指數（0–100）**。當指數超過設定閾值時，自動觸發警報，可選擇推送至 Telegram。

---

## Three Signals | 三大信號

| Signal | 信號 | Description | 說明 |
|--------|------|-------------|------|
| **Hole Collapse** | 空洞坍塌 | Frequency at which short-side resistance walls are forcibly pierced | 空頭防線被「暴力穿越」的頻率 |
| **Betti Jump** | 拓撲重構 | Topological structure changes from high-frequency quote stuffing | 高頻掛撤單引發的訂單簿結構突變 |
| **Max Persistence** | 流動性集中度 | Duration large orders stay to act as artificial price anchors | 超大單停留時間，形成人造價格磁鐵 |

**Index Levels | 指數等級：**
| Score | Level | 等級 |
|-------|-------|------|
| < 28 | Natural | 自然狀態 |
| 28–40 | Moderate | 中度操控 |
| 40–55 | High | 高操控 |
| > 55 | **Extreme** | **極高操控** |

---

## Features | 功能

- **Real-time order book** via Binance WebSocket (100ms updates) | 幣安 WebSocket 實時訂單簿
- **Auto-detect top gainers** (暴漲妖幣) refreshed every minute | 自動偵測 24h 漲幅排名
- **TradingView chart** embedded — switches with selected symbol | TradingView 嵌入圖表，跟隨選幣切換
- **Configurable alert thresholds** directly from the dashboard UI | 儀表板直接調整警報閾值
- **Telegram push notifications** (optional) | 可選 Telegram 推播
- **Multi-symbol tracking** with per-symbol index display | 多幣追蹤，每幣獨立顯示指數
- **Zero API key required** — public Binance data only | 無需 API Key，僅用幣安公開數據

---

## Quick Start | 快速開始

### Requirements | 環境需求
- Node.js ≥ 18
- Internet access to Binance public API

### Install & Run | 安裝與啟動

```bash
# Clone the repo | 克隆專案
git clone https://github.com/YOUR_USERNAME/crypto-manipulation-index.git
cd crypto-manipulation-index

# Install dependencies | 安裝依賴
npm install

# Copy environment config | 複製環境設定
cp .env.example .env

# Start the web dashboard | 啟動網頁儀表板
node src/index.js --server
```

Open **http://localhost:3000** in your browser.

---

## Configuration | 設定

Copy `.env.example` to `.env` and edit:

```env
PORT=3000                           # Dashboard port | 儀表板埠號

# Alert thresholds | 警報閾值 (also adjustable live in UI)
MANIPULATION_EXTREME_THRESHOLD=55
MANIPULATION_HIGH_THRESHOLD=40

# Cooldown between same-symbol alerts (ms) | 同幣警報冷卻時間
# Alert cooldown | 警報冷卻

# Telegram push (optional) | Telegram 推播（選填）
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### Alert Threshold UI | 即時調整閾值

In the dashboard sidebar → **Alert Thresholds** panel:
- **Extreme threshold** — drag to set the "Extreme" level cutoff
- **High threshold** — drag to set the "High" level cutoff  
- **Cooldown** — minutes between repeated alerts for the same symbol
- Click **Apply Configuration** to push changes live (no restart needed)

---

## Dashboard Layout | 儀表板佈局

```
┌─────────────────────────────────────────────────────────────┐
│  TOP BAR: Logo | Live status | Active symbol badge          │
├──────────────┬──────────────────────────────────────────────┤
│  SIDEBAR     │  MAIN: TradingView Chart                     │
│  ─ Add sym   │  (switches when you select a symbol)         │
│  ─ Top Gains │                                              │
│  ─ Tracking  │                                              │
│  ─ Thresholds│                                              │
├──────────────┴──────────────────────────────────────────────┤
│  BOTTOM: Index Score │ Hole / Betti / Persistence │ Alerts  │
└─────────────────────────────────────────────────────────────┘
```

---

## CLI Mode | 命令列模式

Run without the web server for quick terminal testing:

```bash
# Monitor specific symbols | 監控特定幣種
node src/index.js BTCUSDT SOLUSDT

# Default (auto top-gainers) | 預設（自動抓漲幅榜）
node src/index.js
```

---

## API Endpoints | API 介面

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/status` | All symbols, snapshots, top gainers |
| `GET` | `/api/gainers` | Current top 24h gainers list |
| `POST` | `/api/symbols` | `{ symbols: ["BTCUSDT"] }` — update tracked list |

### WebSocket Events | WebSocket 事件

```js
// Client → Server
socket.emit('setSymbols', ['BTCUSDT', 'SOLUSDT'])
socket.emit('updateConfig', { extremeThreshold: 60, highThreshold: 45, cooldownMs: 300000 })

// Server → Client
socket.on('snapshot', snap => ...)   // every 2s per symbol
socket.on('alert', alert => ...)     // when threshold crossed
socket.on('symbolsUpdated', syms => ...)
```

---

## Telegram Alerts Setup | Telegram 警報設定

1. Create a bot via [@BotFather](https://t.me/BotFather) → get `BOT_TOKEN`
2. Send a message to your bot, then get your `CHAT_ID`:  
   `https://api.telegram.org/bot<BOT_TOKEN>/getUpdates`
3. Set both in `.env`

Alert message format:
```
🔴 [Extreme] SOLUSDT Manipulation Index: 68
  Hole Collapse: 3200/day (normal: 2000)
  Betti Jump: 180/day
  Max Persistence: 240 (avg: 160)
```

---

## Disclaimer | 免責聲明

This tool is for **educational and research purposes only**. The manipulation signals are heuristic approximations, not financial advice. Always do your own research before trading.

本工具僅供**學習與研究用途**，操縱信號為啟發式近似，不構成投資建議。交易前請自行判斷。

---

## License | 授權

MIT © 2025
