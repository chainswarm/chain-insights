import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { WalletData } from "./types.js";
import { generateQrSvg } from "./qr.js";
import { getBalanceUsdc } from "./tools.js";

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_CHAIN_ID = "0x2105"; // 8453

const __dirname = dirname(fileURLToPath(import.meta.url));

// Pre-load assets — try dist/assets first (installed), then src/assets (dev)
function loadAsset(name: string): Buffer {
  const paths = [
    join(__dirname, "assets", name),           // dist/assets/ (global install)
    join(__dirname, "..", "src", "assets", name), // src/assets/ (dev)
  ];
  for (const p of paths) {
    try { return readFileSync(p); } catch { /* try next */ }
  }
  console.error(`[chain-insights] Warning: asset ${name} not found`);
  return Buffer.alloc(0);
}

const logoPng = loadAsset("logo.png");
const bgPatternPng = loadAsset("bg-pattern.png");

let server: Server | null = null;
let serverPort: number | null = null;

export function getTopupUrl(): string | null {
  return serverPort ? `http://localhost:${serverPort}` : null;
}

export async function startTopupServer(wallet: WalletData): Promise<string> {
  if (server && serverPort) {
    return `http://localhost:${serverPort}`;
  }

  return new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      if (req.url === "/api/wallet") {
        res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ address: wallet.address }));
        return;
      }

      if (req.url === "/api/balance") {
        getBalanceUsdc(wallet).then((balance) => {
          res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          res.end(JSON.stringify({ balance_usdc: balance }));
        }).catch(() => {
          res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          res.end(JSON.stringify({ balance_usdc: "unknown" }));
        });
        return;
      }

      if (req.url === "/assets/logo.png") {
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400", "Access-Control-Allow-Origin": "*" });
        res.end(logoPng);
        return;
      }

      if (req.url === "/assets/bg-pattern.png") {
        res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400", "Access-Control-Allow-Origin": "*" });
        res.end(bgPatternPng);
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(generatePage(wallet.address));
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server!.address();
      if (addr && typeof addr === "object") {
        serverPort = addr.port;
        const url = `http://localhost:${serverPort}`;
        console.error(`[chain-insights] Topup server running at ${url}`);
        resolve(url);
      } else {
        reject(new Error("Failed to start topup server"));
      }
    });

    server.on("error", reject);
  });
}

export function generateArtifactHtml(walletAddress: string, topupUrl: string): string {
  const LOGO_B64 = "data:image/png;base64,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";

  // Generate QR code SVG server-side — standard B&W, 2x size
  const qrSvg = generateQrSvg(walletAddress, { cellSize: 8 });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif;
    background: rgba(10, 12, 17, 1) url('${topupUrl}/assets/bg-pattern.png') top left / contain no-repeat;
    color: rgba(255, 255, 255, 0.9);
    display: flex;
    justify-content: center;
    padding: 24px;
    line-height: 1.3;
  }
  .card {
    max-width: 400px;
    width: 100%;
    background: rgba(19, 19, 24, 1);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    padding: 28px 24px;
    text-align: center;
  }
  .logo { margin-bottom: 8px; }
  .logo img { height: 24px; }
  .subtitle { color: rgba(255, 255, 255, 0.5); font-size: 13px; margin-bottom: 20px; }
  .qr { margin-bottom: 16px; }
  .qr svg { border-radius: 12px; background: #fff; padding: 10px; }
  .address-wrap {
    position: relative;
    margin-bottom: 16px;
  }
  .address {
    width: 100%;
    background: rgba(10, 12, 17, 1);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    padding: 10px 14px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 11px; color: #f2dda6; word-break: break-all;
    cursor: pointer; text-align: center;
    transition: border-color 0.3s linear;
    -webkit-user-select: all; user-select: all;
    outline: none;
  }
  .address:focus { border-color: #ae9d71; }
  .address-hint {
    font-size: 10px; color: rgba(255,255,255,0.3);
    text-align: center; margin-top: 4px;
  }
  .badge {
    display: inline-flex; align-items: center; gap: 6px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 20px; padding: 5px 12px;
    font-size: 11px; color: rgba(255, 255, 255, 0.5); margin-bottom: 20px;
  }
  .badge .dot { width: 7px; height: 7px; border-radius: 50%; background: #f2dda6; }
  .balance-line {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
    margin-bottom: 20px;
    line-height: 1.4;
  }
  .balance-line .amount {
    color: #4feb69;
    font-weight: 600;
  }
  @keyframes flash { 0%{opacity:0.4} 100%{opacity:1} }
  .balance-line.flash .amount { animation: flash 1s ease-out; }
  .hint {
    margin-top: 14px; font-size: 12px;
    color: rgba(255, 255, 255, 0.3);
    line-height: 1.5;
  }
</style>
</head>
<body>
<div class="card">
  <div class="logo"><img src="${topupUrl}/assets/logo.png" alt="Chain Insights"></div>
  <p class="subtitle">Fund your wallet with USDC on Base</p>
  <div class="qr">${qrSvg}</div>
  <div class="address-wrap">
    <div class="address" id="addr" onclick="selectAndCopy()">${walletAddress}</div>
    <div class="address-hint" id="addrHint">Click to copy address</div>
  </div>
  <div class="badge"><span class="dot"></span>Base Network &middot; USDC</div>
  <p class="balance-line" id="balLine">Current balance: <span class="amount" id="bal">--</span> USDC<br>Fund your wallet to use blockchain intelligence tools.</p>
</div>
<script>
// MCP Apps protocol handshake (matches @modelcontextprotocol/ext-apps App.connect())
(function() {
  var initId = 1;

  // Listen for host messages
  window.addEventListener('message', function(event) {
    var data = event.data;
    if (!data || data.jsonrpc !== '2.0') return;

    // Initialize response
    if (data.id === initId && data.result) {
      // Send initialized notification
      window.parent.postMessage({
        jsonrpc: '2.0',
        method: 'ui/notifications/initialized',
        params: {}
      }, '*');

      // Send initial size
      var rect = document.documentElement.getBoundingClientRect();
      window.parent.postMessage({
        jsonrpc: '2.0',
        method: 'ui/notifications/size-changed',
        params: { width: Math.ceil(rect.width), height: Math.ceil(rect.height) }
      }, '*');
    }

    // Respond to pings
    if (data.method === 'ping' && data.id != null) {
      window.parent.postMessage({
        jsonrpc: '2.0',
        id: data.id,
        result: {}
      }, '*');
    }
  });

  // Send initialize request (must match App class protocol)
  window.parent.postMessage({
    jsonrpc: '2.0',
    id: initId,
    method: 'ui/initialize',
    params: {
      appInfo: { name: 'Chain Insights Topup', version: '1.0.0' },
      appCapabilities: {},
      protocolVersion: '2026-01-26'
    }
  }, '*');
})();

// Live balance polling
var lastBal = null;
function fetchBal() {
  fetch('${topupUrl}/api/balance')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var el = document.getElementById('bal');
      var line = document.getElementById('balLine');
      var val = parseFloat(d.balance_usdc || '0').toFixed(2);
      if (d.balance_usdc === 'unknown') { el.textContent = '--'; return; }
      el.textContent = val;
      if (lastBal !== null && val !== lastBal) {
        line.classList.remove('flash');
        void line.offsetWidth;
        line.classList.add('flash');
      }
      lastBal = val;
    })
    .catch(function() {});
}
fetchBal();
setInterval(fetchBal, 10000);

function selectAndCopy() {
  var addr = document.getElementById('addr');
  var hint = document.getElementById('addrHint');
  // Select the text
  var r = document.createRange();
  r.selectNodeContents(addr);
  var s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
  // Try every clipboard method available
  var copied = false;
  try { copied = document.execCommand('copy'); } catch(e) {}
  if (!copied && navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(addr.textContent).then(function() {
      hint.textContent = 'Copied!'; hint.style.color = '#4feb69';
      setTimeout(function() { hint.textContent = 'Click to copy address'; hint.style.color = ''; }, 2000);
    }).catch(function() {});
  }
  if (copied) {
    hint.textContent = 'Copied!'; hint.style.color = '#4feb69';
    setTimeout(function() { hint.textContent = 'Click to copy address'; hint.style.color = ''; }, 2000);
  } else {
    hint.textContent = 'Selected — press Ctrl+C'; hint.style.color = '#f2dda6';
    setTimeout(function() { hint.textContent = 'Click to copy address'; hint.style.color = ''; }, 3000);
  }
}
<\/script>
</body>
</html>`;
}

function generatePage(walletAddress: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chain Insights — Fund Wallet</title>
<script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif;
    background: rgba(10, 12, 17, 1);
    color: rgba(255, 255, 255, 0.9);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    line-height: 1.3;
  }

  .container {
    max-width: 480px;
    width: 100%;
    padding: 24px;
  }

  .logo {
    text-align: center;
    margin-bottom: 32px;
  }

  .logo h1 {
    font-size: 24px;
    font-weight: 600;
    color: #f2dda6;
    letter-spacing: -0.5px;
  }

  .logo p {
    color: rgba(255, 255, 255, 0.5);
    font-size: 14px;
    margin-top: 4px;
  }

  .card {
    background: rgba(19, 19, 24, 1);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    padding: 32px 24px;
  }

  .qr-container {
    display: flex;
    justify-content: center;
    margin-bottom: 24px;
  }

  .qr-container canvas, .qr-container img {
    border-radius: 12px;
    background: #fff;
    padding: 12px;
  }

  .address-box {
    background: rgba(10, 12, 17, 1);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 24px;
  }

  .address-box code {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 12px;
    color: #f2dda6;
    word-break: break-all;
    flex: 1;
  }

  .copy-btn {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    padding: 4px;
    font-size: 18px;
    transition: color 0.3s linear;
  }

  .copy-btn:hover { color: #f2dda6; }
  .copy-btn.copied { color: #4feb69; }

  .network-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 20px;
    padding: 6px 12px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    margin-bottom: 24px;
  }

  .network-badge .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #f2dda6;
  }

  .balance-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    margin-bottom: 16px;
  }

  .balance-label { color: rgba(255, 255, 255, 0.5); font-size: 14px; }

  .balance-value {
    font-size: 20px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
  }

  .balance-value .currency {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.5);
    font-weight: 400;
    margin-left: 4px;
  }

  .metamask-btn {
    width: 100%;
    padding: 14px;
    border: none;
    border-radius: 10px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    transition: all 0.2s;
    background: #f6851b;
    color: #fff;
  }

  .metamask-btn:hover { background: #e2761b; transform: translateY(-1px); }
  .metamask-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

  .metamask-btn svg { width: 22px; height: 22px; }

  .amount-input {
    width: 100%;
    padding: 12px 16px;
    background: #0a0c11;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.9);
    font-size: 16px;
    margin-bottom: 16px;
    outline: none;
    transition: border-color 0.2s;
  }

  .amount-input:focus { border-color: #f2dda6; }

  .amount-label {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
    margin-bottom: 6px;
    display: block;
  }

  .status {
    text-align: center;
    padding: 12px;
    border-radius: 8px;
    font-size: 14px;
    margin-top: 16px;
    display: none;
  }

  .status.success { display: block; background: #0a2e1a; color: #4feb69; border: 1px solid #1a4a2e; }
  .status.error { display: block; background: #2e0a0a; color: #eb4f4f; border: 1px solid #4a1a1a; }
  .status.pending { display: block; background: #1a1a0a; color: #f2dda6; border: 1px solid #4a4a1a; }

  .info {
    text-align: center;
    margin-top: 24px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.3);
    line-height: 1.6;
  }
</style>
</head>
<body>
<div class="container">
  <div class="logo">
    <h1>Chain Insights</h1>
    <p>Fund your wallet to use blockchain intelligence tools</p>
  </div>

  <div class="card">
    <div class="qr-container" id="qr"></div>

    <div class="address-box">
      <code id="address">${walletAddress}</code>
      <button class="copy-btn" onclick="copyAddress()" id="copyBtn" title="Copy address">&#x2398;</button>
    </div>

    <div class="network-badge">
      <span class="dot"></span>
      Base Network &middot; USDC
    </div>

    <div class="balance-row">
      <span class="balance-label">Current balance</span>
      <span class="balance-value" id="balance">—<span class="currency">USDC</span></span>
    </div>

    <div class="status" id="status"></div>
  </div>

  <p class="info">Send Base USDC to the wallet address above.</p>
</div>

<script>
const WALLET = '${walletAddress}';
const USDC = '${USDC_ADDRESS}';
const CHAIN_ID = '${BASE_CHAIN_ID}';

// QR code
(function() {
  var qr = qrcode(0, 'M');
  qr.addData(WALLET);
  qr.make();
  document.getElementById('qr').innerHTML = qr.createSvgTag(5, 0);
  var svg = document.querySelector('#qr svg');
  if (svg) { svg.style.borderRadius = '12px'; svg.style.background = '#fff'; svg.style.padding = '12px'; }
})();

// Copy address — fallback for sandboxed iframes where navigator.clipboard is blocked
function copyAddress() {
  var ok = false;
  // Try modern clipboard API first
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(WALLET).then(function() { ok = true; }).catch(function() {});
  }
  // Fallback: hidden textarea + execCommand
  if (!ok) {
    var ta = document.createElement('textarea');
    ta.value = WALLET;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);
  }
  var btn = document.getElementById('copyBtn');
  btn.classList.add('copied');
  btn.innerHTML = '&#x2713;';
  setTimeout(function() { btn.classList.remove('copied'); btn.innerHTML = '&#x2398;'; }, 2000);
}

// Fetch balance
async function fetchBalance() {
  try {
    var resp = await fetch('/api/balance');
    var json = await resp.json();
    if (json.balance_usdc === 'unknown') throw new Error('balance unavailable');
    var balance = Number(json.balance_usdc || 0).toFixed(2);
    document.getElementById('balance').innerHTML = balance + '<span class="currency">USDC</span>';
  } catch(e) {
    document.getElementById('balance').innerHTML = '—<span class="currency">USDC</span>';
  }
}
fetchBalance();
setInterval(fetchBalance, 15000);

</script>
</body>
</html>`;
}
