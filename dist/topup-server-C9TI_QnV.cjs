const require_chunk = require("./chunk-CZWwpsFl.cjs");
const require_tools = require("./tools-DrbPv7M1.cjs");
let node_http = require("node:http");
//#region src/wallet/topup-server.ts
var topup_server_exports = /* @__PURE__ */ require_chunk.__exportAll({
	generateTopupPage: () => generateTopupPage,
	startTopupServer: () => startTopupServer,
	stopTopupServer: () => stopTopupServer
});
let activeServer = null;
function send(res, status, body, contentType) {
	res.writeHead(status, {
		"content-type": contentType,
		"cache-control": "no-store"
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
  <title>Chain Insights Wallet Top-Up</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --panel: #ffffff;
      --text: #111827;
      --muted: #5f6774;
      --line: #d9dde5;
      --accent: #176b87;
      --accent-strong: #0f5066;
      --danger: #a23d3d;
      --ok: #21734f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    main {
      width: min(760px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 40px 0;
    }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 20px;
    }
    h1 {
      margin: 0;
      font-size: clamp(1.6rem, 4vw, 2.1rem);
      line-height: 1.12;
      letter-spacing: 0;
    }
    .status-pill {
      flex: 0 0 auto;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 8px 12px;
      background: var(--panel);
      color: var(--muted);
      font-size: 0.9rem;
      white-space: nowrap;
    }
    section {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      padding: 20px;
      margin-bottom: 16px;
    }
    .label {
      display: block;
      margin-bottom: 8px;
      color: var(--muted);
      font-size: 0.92rem;
      font-weight: 650;
    }
    .address {
      width: 100%;
      min-height: 44px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fbfcfe;
      padding: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      overflow-wrap: anywhere;
    }
    .metric {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      border-top: 1px solid var(--line);
      padding-top: 14px;
      margin-top: 14px;
    }
    .metric strong { font-size: 1.25rem; }
    .controls {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: end;
    }
    input {
      width: 100%;
      min-height: 44px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px 12px;
      font: inherit;
    }
    button {
      min-height: 44px;
      border: 1px solid var(--accent);
      border-radius: 6px;
      background: var(--accent);
      color: #ffffff;
      font: inherit;
      font-weight: 700;
      padding: 0 16px;
      cursor: pointer;
    }
    button.secondary {
      background: #ffffff;
      color: var(--accent);
    }
    button:hover { border-color: var(--accent-strong); background: var(--accent-strong); }
    button.secondary:hover { background: #eef7fa; color: var(--accent-strong); }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 12px;
    }
    .message {
      min-height: 22px;
      margin-top: 12px;
      color: var(--muted);
      overflow-wrap: anywhere;
    }
    .message.error { color: var(--danger); }
    .message.ok { color: var(--ok); }
    @media (max-width: 560px) {
      main { width: min(100vw - 24px, 760px); padding: 20px 0; }
      header { display: block; }
      .status-pill { display: inline-block; margin-top: 12px; }
      .controls { grid-template-columns: 1fr; }
      button { width: 100%; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Chain Insights Wallet Top-Up</h1>
      </div>
      <div class="status-pill">Base Network - USDC</div>
    </header>

    <section aria-labelledby="wallet-heading">
      <span class="label" id="wallet-heading">Payment wallet</span>
      <div class="address" id="walletAddress">${escapeHtml(walletAddress)}</div>
      <div class="row">
        <button type="button" class="secondary" id="copyAddress">Copy address</button>
        <button type="button" class="secondary" id="refreshBalance">Refresh balance</button>
      </div>
      <div class="metric">
        <span>Current balance</span>
        <strong id="balance">Loading...</strong>
      </div>
    </section>

    <section aria-labelledby="send-heading">
      <span class="label" id="send-heading">Send USDC from MetaMask</span>
      <div class="controls">
        <label>
          <span class="label">Amount</span>
          <input id="amount" inputmode="decimal" autocomplete="off" placeholder="25.00" value="10">
        </label>
        <button type="button" id="sendButton">Send with MetaMask</button>
      </div>
      <div class="message" id="message" role="status" aria-live="polite"></div>
    </section>
  </main>

  <script>
    const recipient = ${JSON.stringify(walletAddress)};
    const usdcAddress = ${JSON.stringify(require_tools.USDC_ADDRESS)};
    const baseChainId = ${JSON.stringify(require_tools.BASE_CHAIN_HEX)};
    const balanceEl = document.getElementById('balance');
    const messageEl = document.getElementById('message');
    const amountEl = document.getElementById('amount');

    function setMessage(text, kind = '') {
      messageEl.textContent = text;
      messageEl.className = kind ? 'message ' + kind : 'message';
    }

    async function refreshBalance() {
      try {
        const response = await fetch('/api/balance', { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Balance request failed');
        balanceEl.textContent = payload.balance_usdc + ' USDC';
      } catch (error) {
        balanceEl.textContent = 'Unavailable';
        setMessage(error.message || String(error), 'error');
      }
    }

    function parseUsdcAmount(input) {
      const value = input.trim();
      if (!/^\\d+(\\.\\d{0,6})?$/.test(value)) {
        throw new Error('Enter a USDC amount with up to 6 decimal places.');
      }
      const parts = value.split('.');
      const whole = parts[0] || '0';
      const fraction = (parts[1] || '').padEnd(6, '0').slice(0, 6);
      return BigInt(whole) * 1000000n + BigInt(fraction);
    }

    function encodeTransfer(to, amount) {
      const normalized = to.toLowerCase().replace(/^0x/, '');
      return '0xa9059cbb' + normalized.padStart(64, '0') + amount.toString(16).padStart(64, '0');
    }

    async function ensureBaseNetwork() {
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: baseChainId }],
        });
      } catch (error) {
        if (error && error.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: baseChainId,
              chainName: 'Base',
              nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
              rpcUrls: ['https://mainnet.base.org'],
              blockExplorerUrls: ['https://basescan.org'],
            }],
          });
          return;
        }
        throw error;
      }
    }

    async function sendUsdc() {
      if (!window.ethereum) {
        setMessage('MetaMask is not available in this browser.', 'error');
        return;
      }
      try {
        setMessage('Preparing MetaMask transaction...');
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        await ensureBaseNetwork();
        const amount = parseUsdcAmount(amountEl.value);
        const txHash = await window.ethereum.request({
          method: 'eth_sendTransaction',
          params: [{
            from: accounts[0],
            to: usdcAddress,
            value: '0x0',
            data: encodeTransfer(recipient, amount),
          }],
        });
        setMessage('Transaction submitted: ' + txHash, 'ok');
        setTimeout(refreshBalance, 8000);
      } catch (error) {
        setMessage(error.message || String(error), 'error');
      }
    }

    document.getElementById('copyAddress').addEventListener('click', async () => {
      await navigator.clipboard.writeText(recipient);
      setMessage('Wallet address copied.', 'ok');
    });
    document.getElementById('refreshBalance').addEventListener('click', refreshBalance);
    document.getElementById('sendButton').addEventListener('click', sendUsdc);
    refreshBalance();
    setInterval(refreshBalance, 15000);
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
		sendJson(res, 200, require_tools.buildTopupInfo(address, url));
		return;
	}
	if (parsedUrl.pathname === "/api/balance") {
		try {
			sendJson(res, 200, {
				wallet_address: address,
				network: "Base",
				token: "USDC",
				balance_usdc: await require_tools.getBalanceUsdc(address)
			});
		} catch (err) {
			sendJson(res, 502, {
				wallet_address: address,
				error: err.message
			});
		}
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
	const server = (0, node_http.createServer)((req, res) => {
		handleRequest(req, res, address, activeServer?.url ?? "http://127.0.0.1");
	});
	const url = await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port ?? 0, "127.0.0.1", () => {
			const addressInfo = server.address();
			if (!addressInfo || typeof addressInfo === "string") {
				reject(/* @__PURE__ */ new Error("Top-up server did not bind to a TCP port"));
				return;
			}
			resolve(`http://127.0.0.1:${addressInfo.port}`);
		});
	});
	activeServer = {
		address,
		server,
		url
	};
	return url;
}
async function stopTopupServer() {
	if (!activeServer) return;
	const server = activeServer.server;
	activeServer = null;
	await new Promise((resolve) => server.close(() => resolve()));
}
//#endregion
Object.defineProperty(exports, "generateTopupPage", {
	enumerable: true,
	get: function() {
		return generateTopupPage;
	}
});
Object.defineProperty(exports, "startTopupServer", {
	enumerable: true,
	get: function() {
		return startTopupServer;
	}
});
Object.defineProperty(exports, "stopTopupServer", {
	enumerable: true,
	get: function() {
		return stopTopupServer;
	}
});
Object.defineProperty(exports, "topup_server_exports", {
	enumerable: true,
	get: function() {
		return topup_server_exports;
	}
});
