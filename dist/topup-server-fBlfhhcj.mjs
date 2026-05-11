import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import { a as getBalanceUsdc, n as USDC_ADDRESS, r as buildTopupInfo, t as BASE_CHAIN_HEX } from "./tools-BExi-2XO.mjs";
import { createServer } from "node:http";
//#region src/wallet/topup-server.ts
var topup_server_exports = /* @__PURE__ */ __exportAll({
	generateTopupPage: () => generateTopupPage,
	startTopupServer: () => startTopupServer,
	stopTopupServer: () => stopTopupServer
});
let activeServer = null;
function send(res, status, body, contentType) {
	res.writeHead(status, {
		"content-type": contentType,
		"cache-control": "no-store",
		"access-control-allow-origin": "*"
	});
	res.end(body);
}
function sendJson(res, status, body) {
	send(res, status, JSON.stringify(body, null, 2) + "\n", "application/json; charset=utf-8");
}
function escapeHtml(value) {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#39;");
}
function generateTopupPage(walletAddress) {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chain Insights - Fund Wallet</title>
<script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"><\/script>
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
    letter-spacing: 0;
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
    min-height: 208px;
    margin-bottom: 24px;
  }
  .qr-container canvas,
  .qr-container img,
  .qr-container svg {
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
    font-family: "SF Mono", "Fira Code", ui-monospace, monospace;
    font-size: 12px;
    color: #f2dda6;
    word-break: break-all;
    flex: 1;
  }
  .copy-btn {
    width: 34px;
    height: 34px;
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
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
    gap: 12px;
    padding: 12px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    margin-bottom: 16px;
  }
  .balance-label { color: rgba(255, 255, 255, 0.5); font-size: 14px; }
  .balance-value {
    font-size: 20px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    text-align: right;
  }
  .balance-value .currency {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.5);
    font-weight: 400;
    margin-left: 4px;
  }
  .metamask-btn {
    width: 100%;
    min-height: 48px;
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
  .metamask-btn svg { width: 22px; height: 22px; flex: 0 0 auto; }
  .amount-input {
    width: 100%;
    min-height: 44px;
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
    overflow-wrap: anywhere;
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
  @media (max-width: 520px) {
    body { align-items: flex-start; }
    .container { padding: 16px; }
    .card { padding: 24px 16px; }
    .balance-row { align-items: flex-start; flex-direction: column; }
    .balance-value { text-align: left; }
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
    <div class="qr-container" id="qr" aria-label="Wallet address QR code"></div>

    <div class="address-box">
      <code id="address">${escapeHtml(walletAddress)}</code>
      <button class="copy-btn" onclick="copyAddress()" id="copyBtn" title="Copy address" type="button">&#x2398;</button>
    </div>

    <div class="network-badge">
      <span class="dot"></span>
      Base Network &middot; USDC
    </div>

    <div class="balance-row">
      <span class="balance-label">Current balance</span>
      <span class="balance-value" id="balance">--<span class="currency">USDC</span></span>
    </div>

    <label class="amount-label" for="amount">Amount (USDC)</label>
    <input type="number" class="amount-input" id="amount" value="1" min="0.01" step="0.01" placeholder="1.00">

    <button class="metamask-btn" id="sendBtn" onclick="sendWithMetaMask()" type="button">
      <svg viewBox="0 0 35 33" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M32.96 1L19.7 10.89l2.45-5.81L32.96 1z" fill="#E17726"/>
        <path d="M2.66 1l13.11 9.98-2.3-5.9L2.66 1zM28.23 23.53l-3.52 5.39 7.53 2.07 2.16-7.33-6.17-.13zM.98 23.66l2.15 7.33 7.52-2.07-3.52-5.39-6.15.13z" fill="#E27625"/>
        <path d="M10.28 14.51l-2.1 3.18 7.49.34-.26-8.07-5.13 4.55zM25.34 14.51l-5.2-4.64-.17 8.16 7.48-.34-2.11-3.18zM10.65 28.92l4.5-2.19-3.89-3.03-.61 5.22zM20.47 26.73l4.5 2.19-.62-5.22-3.88 3.03z" fill="#E27625"/>
        <path d="M24.97 28.92l-4.5-2.19.36 2.94-.04 1.24 4.18-1.99zM10.65 28.92l4.18 1.99-.03-1.24.35-2.94-4.5 2.19z" fill="#D5BFB2"/>
        <path d="M14.91 21.84l-3.75-1.1 2.65-1.22 1.1 2.32zM20.71 21.84l1.1-2.32 2.66 1.22-3.76 1.1z" fill="#233447"/>
        <path d="M10.65 28.92l.64-5.39-4.16.13 3.52 5.26zM24.33 23.53l.64 5.39 3.52-5.26-4.16-.13zM27.45 17.69l-7.48.34.7 3.81 1.1-2.32 2.66 1.22 3.02-3.05zM11.16 20.74l2.65-1.22 1.1 2.32.7-3.81-7.49-.34 3.04 3.05z" fill="#CC6228"/>
        <path d="M8.12 17.69l3.15 6.13-.11-3.08-3.04-3.05zM24.43 20.74l-.12 3.08 3.14-6.13-3.02 3.05zM15.61 18.03l-.7 3.81.87 4.52.2-5.96-.37-2.37zM19.97 18.03l-.36 2.36.18 5.97.88-4.52-.7-3.81z" fill="#E27525"/>
        <path d="M20.67 21.84l-.88 4.52.63.44 3.88-3.03.12-3.08-3.75 1.15zM11.16 20.74l.11 3.03 3.89 3.03.63-.44-.88-4.52-3.75-1.1z" fill="#F5841F"/>
        <path d="M20.75 30.91l.04-1.24-.34-.29h-5.28l-.33.29.03 1.24-4.18-1.99 1.46 1.2 2.96 2.04h5.36l2.97-2.04 1.46-1.2-4.15 1.99z" fill="#C0AC9D"/>
        <path d="M20.47 26.73l-.63-.44h-3.67l-.63.44-.35 2.94.33-.29h5.28l.34.29-.67-2.94z" fill="#161616"/>
        <path d="M33.52 11.35l1.12-5.44L32.96 1l-12.5 9.26 4.81 4.07 6.79 1.98 1.5-1.75-.65-.47 1.04-.94-.8-.62 1.04-.79-.68-.52zM.98 5.91l1.13 5.44-.72.53 1.04.79-.8.62 1.04.94-.65.47 1.49 1.75 6.8-1.98 4.8-4.07L2.66 1 .98 5.91z" fill="#763E1A"/>
        <path d="M32.06 16.87l-6.79-1.98 2.06 3.18-3.14 6.13 4.14-.05h6.17l-2.44-7.28zM10.28 14.89l-6.8 1.98-2.27 7.28h6.17l4.13.05-3.14-6.13 1.91-3.18zM19.97 18.03l.43-7.51 1.97-5.32h-8.74l1.96 5.32.44 7.51.16 2.38.02 5.95h3.67l.01-5.95.08-2.38z" fill="#F5841F"/>
      </svg>
      Send with MetaMask
    </button>

    <div class="status" id="status" role="status" aria-live="polite"></div>
  </div>

  <p class="info">
    Each tool call costs $0.01 - $0.05 USDC<br>
    $1.00 is enough for ~100 standard calls
  </p>
</div>

<script>
const WALLET = ${JSON.stringify(walletAddress)};
const USDC = ${JSON.stringify(USDC_ADDRESS)};
const CHAIN_ID = ${JSON.stringify(BASE_CHAIN_HEX)};

(function() {
  var qr = qrcode(0, 'M');
  qr.addData(WALLET);
  qr.make();
  document.getElementById('qr').innerHTML = qr.createSvgTag(5, 0);
  var svg = document.querySelector('#qr svg');
  if (svg) {
    svg.style.borderRadius = '12px';
    svg.style.background = '#fff';
    svg.style.padding = '12px';
  }
})();

function copyAddress() {
  var ok = false;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(WALLET).then(function() { ok = true; }).catch(function() {});
  }
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

async function fetchBalance() {
  try {
    var resp = await fetch('/api/balance', { cache: 'no-store' });
    var json = await resp.json();
    if (json.balance_usdc === 'unknown') {
      document.getElementById('balance').innerHTML = '--<span class="currency">USDC</span>';
      return;
    }
    var balance = Number(json.balance_usdc || 0).toFixed(2);
    document.getElementById('balance').innerHTML = balance + '<span class="currency">USDC</span>';
  } catch(e) {
    document.getElementById('balance').innerHTML = '--<span class="currency">USDC</span>';
  }
}
fetchBalance();
setInterval(fetchBalance, 15000);

function setStatus(msg, type) {
  var el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status ' + type;
}

async function sendWithMetaMask() {
  if (!window.ethereum) {
    setStatus('MetaMask not found. Install it or send USDC manually to the address above.', 'error');
    return;
  }

  var btn = document.getElementById('sendBtn');
  btn.disabled = true;

  try {
    var accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });

    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID }] });
    } catch (switchErr) {
      if (switchErr.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: CHAIN_ID,
            chainName: 'Base',
            nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
            rpcUrls: ['https://mainnet.base.org'],
            blockExplorerUrls: ['https://basescan.org']
          }]
        });
      } else {
        throw switchErr;
      }
    }

    var amount = parseFloat(document.getElementById('amount').value);
    if (isNaN(amount) || amount <= 0) {
      setStatus('Enter a valid amount', 'error');
      btn.disabled = false;
      return;
    }

    var rawAmount = BigInt(Math.round(amount * 1e6));
    var amountHex = rawAmount.toString(16).padStart(64, '0');
    var toHex = '000000000000000000000000' + WALLET.slice(2).toLowerCase();
    var data = '0xa9059cbb' + toHex + amountHex;

    setStatus('Confirm the transaction in MetaMask...', 'pending');
    var txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{ from: accounts[0], to: USDC, data: data }]
    });

    setStatus('Transaction sent! ' + txHash.slice(0, 10) + '...', 'success');
    setTimeout(fetchBalance, 5000);
  } catch (err) {
    if (err.code === 4001) {
      setStatus('Transaction cancelled', 'error');
    } else {
      setStatus('Error: ' + (err.message || err), 'error');
    }
  }

  btn.disabled = false;
}
<\/script>
</body>
</html>`;
}
function resolveAddress(account) {
	return typeof account === "string" ? account : account.address;
}
async function handleRequest(req, res, address, url) {
	const parsedUrl = new URL(req.url ?? "/", url);
	if (parsedUrl.pathname === "/") {
		send(res, 200, generateTopupPage(address), "text/html; charset=utf-8");
		return;
	}
	if (parsedUrl.pathname === "/api/wallet") {
		sendJson(res, 200, { address });
		return;
	}
	if (parsedUrl.pathname === "/api/balance") {
		sendJson(res, 200, { balance_usdc: await getBalanceUsdc(address) });
		return;
	}
	if (parsedUrl.pathname === "/api/topup") {
		sendJson(res, 200, buildTopupInfo(address, url));
		return;
	}
	sendJson(res, 404, { error: "Not found" });
}
async function startTopupServer(account, options = {}) {
	const address = resolveAddress(account);
	if (activeServer && activeServer.address.toLowerCase() === address.toLowerCase()) return activeServer.url;
	if (activeServer) {
		await new Promise((resolve) => activeServer?.server.close(() => resolve()));
		activeServer = null;
	}
	const server = createServer((req, res) => {
		handleRequest(req, res, address, activeServer?.url ?? "http://localhost");
	});
	const url = await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port ?? 0, "127.0.0.1", () => {
			const addressInfo = server.address();
			if (!addressInfo || typeof addressInfo === "string") {
				reject(/* @__PURE__ */ new Error("Failed to start topup server"));
				return;
			}
			resolve(`http://localhost:${addressInfo.port}`);
		});
	});
	activeServer = {
		address,
		server,
		url
	};
	process.stderr.write(`[chain-insights] Topup server running at ${url}\n`);
	return url;
}
async function stopTopupServer() {
	if (!activeServer) return;
	const server = activeServer.server;
	activeServer = null;
	await new Promise((resolve) => server.close(() => resolve()));
}
//#endregion
export { topup_server_exports as i, startTopupServer as n, stopTopupServer as r, generateTopupPage as t };

//# sourceMappingURL=topup-server-fBlfhhcj.mjs.map