import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPublicClient, formatEther, formatUnits, http } from "viem";
import { base } from "viem/chains";
import { createServer } from "node:http";
//#region src/wallet/mcp-proxy/qr.ts
const SIZE = 25;
const EC_CODEWORDS = 10;
const DATA_CODEWORDS = 34;
const FORMAT_BITS = 30660;
const MODE_BYTE = 4;
function createMatrix() {
	const m = [];
	for (let i = 0; i < SIZE; i++) m[i] = new Array(SIZE).fill(-1);
	return m;
}
function addFinderPattern(matrix, row, col) {
	for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
		const mr = row + r;
		const mc = col + c;
		if (mr < 0 || mr >= SIZE || mc < 0 || mc >= SIZE) continue;
		if (r >= 0 && r <= 6 && c >= 0 && c <= 6) if (r === 0 || r === 6 || c === 0 || c === 6 || r >= 2 && r <= 4 && c >= 2 && c <= 4) matrix[mr][mc] = 1;
		else matrix[mr][mc] = 0;
		else matrix[mr][mc] = 0;
	}
}
function addAlignmentPattern(matrix, row, col) {
	for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) if (Math.abs(r) === 2 || Math.abs(c) === 2 || r === 0 && c === 0) matrix[row + r][col + c] = 1;
	else matrix[row + r][col + c] = 0;
}
function addTimingPatterns(matrix) {
	for (let i = 8; i < SIZE - 8; i++) {
		if (matrix[6][i] === -1) matrix[6][i] = i % 2 === 0 ? 1 : 0;
		if (matrix[i][6] === -1) matrix[i][6] = i % 2 === 0 ? 1 : 0;
	}
}
function addFormatInfo(matrix) {
	const bits = FORMAT_BITS;
	for (let i = 0; i <= 5; i++) matrix[8][i] = bits >> 14 - i & 1;
	matrix[8][7] = bits >> 8 & 1;
	matrix[8][8] = bits >> 7 & 1;
	matrix[7][8] = bits >> 6 & 1;
	for (let i = 0; i <= 5; i++) matrix[5 - i][8] = bits >> i & 1;
	for (let i = 0; i <= 7; i++) matrix[SIZE - 1 - i][8] = bits >> 14 - i & 1;
	for (let i = 0; i <= 7; i++) matrix[8][SIZE - 8 + i] = bits >> 7 - i & 1;
	matrix[SIZE - 8][8] = 1;
}
function encodeData(text) {
	const bytes = new TextEncoder().encode(text);
	const bits = [];
	for (let i = 3; i >= 0; i--) bits.push(MODE_BYTE >> i & 1);
	for (let i = 7; i >= 0; i--) bits.push(bytes.length >> i & 1);
	for (const b of bytes) for (let i = 7; i >= 0; i--) bits.push(b >> i & 1);
	while (bits.length < DATA_CODEWORDS * 8 && bits.length < DATA_CODEWORDS * 8) {
		bits.push(0);
		if (bits.length >= DATA_CODEWORDS * 8) break;
	}
	while (bits.length % 8 !== 0) bits.push(0);
	const padBytes = [236, 17];
	let padIdx = 0;
	while (bits.length < DATA_CODEWORDS * 8) {
		const pb = padBytes[padIdx % 2];
		for (let i = 7; i >= 0; i--) bits.push(pb >> i & 1);
		padIdx++;
	}
	const codewords = [];
	for (let i = 0; i < bits.length; i += 8) {
		let val = 0;
		for (let j = 0; j < 8; j++) val = val << 1 | (bits[i + j] || 0);
		codewords.push(val);
	}
	return codewords;
}
const GF_EXP = new Array(512).fill(0);
const GF_LOG = new Array(256).fill(0);
(function initGF() {
	let x = 1;
	for (let i = 0; i < 255; i++) {
		GF_EXP[i] = x;
		GF_LOG[x] = i;
		x <<= 1;
		if (x & 256) x ^= 285;
	}
	for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();
function gfMul(a, b) {
	if (a === 0 || b === 0) return 0;
	return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}
function rsEncode(data, ecCount) {
	let gen = [1];
	for (let i = 0; i < ecCount; i++) {
		const next = new Array(gen.length + 1).fill(0);
		for (let j = 0; j < gen.length; j++) {
			next[j] ^= gen[j];
			next[j + 1] ^= gfMul(gen[j], GF_EXP[i]);
		}
		gen = next;
	}
	const msg = [...data, ...new Array(ecCount).fill(0)];
	for (let i = 0; i < data.length; i++) {
		const coef = msg[i];
		if (coef !== 0) for (let j = 0; j < gen.length; j++) msg[i + j] ^= gfMul(gen[j], coef);
	}
	return msg.slice(data.length);
}
function placeData(matrix, dataBits) {
	let bitIdx = 0;
	let upward = true;
	for (let right = SIZE - 1; right >= 1; right -= 2) {
		if (right === 6) right = 5;
		const rows = upward ? Array.from({ length: SIZE }, (_, i) => SIZE - 1 - i) : Array.from({ length: SIZE }, (_, i) => i);
		for (const row of rows) for (let c = 0; c < 2; c++) {
			const col = right - c;
			if (matrix[row][col] !== -1) continue;
			matrix[row][col] = bitIdx < dataBits.length ? dataBits[bitIdx++] : 0;
		}
		upward = !upward;
	}
}
function applyMask0(matrix, reserved) {
	for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
		if (reserved[r][c] !== -1) continue;
		if ((r + c) % 2 === 0) matrix[r][c] ^= 1;
	}
}
function generateQrSvg(text, opts = 4) {
	const options = typeof opts === "number" ? { cellSize: opts } : opts;
	const cellSize = options.cellSize ?? 4;
	const fgColor = options.fgColor ?? "#000";
	const bgColor = options.bgColor ?? "#fff";
	const finderColor = options.finderColor ?? fgColor;
	const matrix = createMatrix();
	addFinderPattern(matrix, 0, 0);
	addFinderPattern(matrix, 0, SIZE - 7);
	addFinderPattern(matrix, SIZE - 7, 0);
	addAlignmentPattern(matrix, 18, 18);
	addTimingPatterns(matrix);
	addFormatInfo(matrix);
	const reserved = matrix.map((row) => [...row]);
	const dataCodewords = encodeData(text);
	const ecCodewords = rsEncode(dataCodewords, EC_CODEWORDS);
	const allCodewords = [...dataCodewords, ...ecCodewords];
	const dataBits = [];
	for (const cw of allCodewords) for (let i = 7; i >= 0; i--) dataBits.push(cw >> i & 1);
	placeData(matrix, dataBits);
	applyMask0(matrix, reserved);
	addFormatInfo(matrix);
	const logoW = options.logoWidth ?? 7;
	const logoH = options.logoHeight ?? 5;
	const logoStartC = Math.floor((SIZE - logoW) / 2);
	const logoStartR = Math.floor((SIZE - logoH) / 2);
	const hasLogo = !!options.logoBase64;
	const svgSize = SIZE * cellSize;
	let svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${svgSize}" height="${svgSize}" viewBox="0 0 ${svgSize} ${svgSize}">`;
	svg += `<rect width="${svgSize}" height="${svgSize}" fill="${bgColor}" rx="4"/>`;
	const isFinderModule = (r, c) => r < 7 && c < 7 || r < 7 && c >= SIZE - 7 || r >= SIZE - 7 && c < 7;
	for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
		if (hasLogo && r >= logoStartR && r < logoStartR + logoH && c >= logoStartC && c < logoStartC + logoW) continue;
		if (matrix[r][c] === 1) {
			const color = isFinderModule(r, c) ? finderColor : fgColor;
			svg += `<rect x="${c * cellSize}" y="${r * cellSize}" width="${cellSize}" height="${cellSize}" fill="${color}" rx="0.5"/>`;
		}
	}
	if (hasLogo && options.logoBase64) {
		const lx = logoStartC * cellSize;
		const ly = logoStartR * cellSize;
		const lw = logoW * cellSize;
		const lh = logoH * cellSize;
		svg += `<rect x="${lx - 1}" y="${ly - 1}" width="${lw + 2}" height="${lh + 2}" fill="${bgColor}" rx="3"/>`;
		svg += `<image x="${lx + 2}" y="${ly + 2}" width="${lw - 4}" height="${lh - 4}" href="${options.logoBase64}" xlink:href="${options.logoBase64}" preserveAspectRatio="xMidYMid meet"/>`;
	}
	svg += "</svg>";
	return svg;
}
//#endregion
//#region src/wallet/mcp-proxy/tools.ts
const USDC_ADDRESS$1 = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PUBLIC_BASE_RPC_URLS = [
	"https://mainnet.base.org",
	"https://base-rpc.publicnode.com",
	"https://base.drpc.org",
	"https://1rpc.io/base"
];
const USDC_ABI = [{
	name: "balanceOf",
	type: "function",
	stateMutability: "view",
	inputs: [{
		name: "account",
		type: "address"
	}],
	outputs: [{
		name: "",
		type: "uint256"
	}]
}];
async function getBalanceUsdc(wallet) {
	const envRpcUrl = process.env.BASE_RPC_URL;
	const rpcUrls = [...envRpcUrl ? [envRpcUrl] : [], ...PUBLIC_BASE_RPC_URLS.filter((url) => url !== envRpcUrl)];
	for (const rpcUrl of rpcUrls) try {
		return formatUnits(await createPublicClient({
			chain: base,
			transport: http(rpcUrl)
		}).readContract({
			address: USDC_ADDRESS$1,
			abi: USDC_ABI,
			functionName: "balanceOf",
			args: [wallet.address]
		}), 6);
	} catch {}
	return "unknown";
}
async function getBalanceEth(wallet) {
	const envRpcUrl = process.env.BASE_RPC_URL;
	const rpcUrls = [...envRpcUrl ? [envRpcUrl] : [], ...PUBLIC_BASE_RPC_URLS.filter((url) => url !== envRpcUrl)];
	for (const rpcUrl of rpcUrls) try {
		return formatEther(await createPublicClient({
			chain: base,
			transport: http(rpcUrl)
		}).getBalance({ address: wallet.address }));
	} catch {}
	return "unknown";
}
//#endregion
//#region src/wallet/mcp-proxy/topup-server.ts
const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_CHAIN_ID = "0x2105";
const __dirname = dirname(fileURLToPath(import.meta.url));
function loadAsset(name) {
	const paths = [join(__dirname, "assets", name), join(__dirname, "..", "src", "assets", name)];
	for (const p of paths) try {
		return readFileSync(p);
	} catch {}
	console.error(`[chain-insights] Warning: asset ${name} not found`);
	return Buffer.alloc(0);
}
const logoPng = loadAsset("logo.png");
const bgPatternPng = loadAsset("bg-pattern.png");
let server = null;
let serverPort = null;
function getTopupUrl$1() {
	return serverPort ? `http://localhost:${serverPort}` : null;
}
async function startTopupServer$1(wallet) {
	if (server && serverPort) return `http://localhost:${serverPort}`;
	return new Promise((resolve, reject) => {
		server = createServer((req, res) => {
			if (req.url === "/api/wallet") {
				res.writeHead(200, {
					"Content-Type": "application/json",
					"Access-Control-Allow-Origin": "*"
				});
				res.end(JSON.stringify({ address: wallet.address }));
				return;
			}
			if (req.url === "/api/balance") {
				Promise.all([getBalanceUsdc(wallet), getBalanceEth(wallet)]).then(([balanceUsdc, balanceEth]) => {
					res.writeHead(200, {
						"Content-Type": "application/json",
						"Access-Control-Allow-Origin": "*"
					});
					res.end(JSON.stringify({
						balance_usdc: balanceUsdc,
						balance_eth: balanceEth
					}));
				}).catch(() => {
					res.writeHead(200, {
						"Content-Type": "application/json",
						"Access-Control-Allow-Origin": "*"
					});
					res.end(JSON.stringify({
						balance_usdc: "unknown",
						balance_eth: "unknown"
					}));
				});
				return;
			}
			if (req.url === "/assets/logo.png") {
				res.writeHead(200, {
					"Content-Type": "image/png",
					"Cache-Control": "public, max-age=86400",
					"Access-Control-Allow-Origin": "*"
				});
				res.end(logoPng);
				return;
			}
			if (req.url === "/assets/bg-pattern.png") {
				res.writeHead(200, {
					"Content-Type": "image/png",
					"Cache-Control": "public, max-age=86400",
					"Access-Control-Allow-Origin": "*"
				});
				res.end(bgPatternPng);
				return;
			}
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(generatePage(wallet.address));
		});
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (addr && typeof addr === "object") {
				serverPort = addr.port;
				const url = `http://localhost:${serverPort}`;
				console.error(`[chain-insights] Topup server running at ${url}`);
				resolve(url);
			} else reject(/* @__PURE__ */ new Error("Failed to start topup server"));
		});
		server.on("error", reject);
	});
}
function generateArtifactHtml(walletAddress, topupUrl) {
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
  .balance-line .gas {
    color: #f2dda6;
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
  <div class="qr">${generateQrSvg(walletAddress, { cellSize: 8 })}</div>
  <div class="address-wrap">
    <div class="address" id="addr" onclick="selectAndCopy()">${walletAddress}</div>
    <div class="address-hint" id="addrHint">Click to copy address</div>
  </div>
  <div class="badge"><span class="dot"></span>Base Network &middot; USDC</div>
  <p class="balance-line" id="balLine">Current balance: <span class="amount" id="bal">--</span> USDC<br>Gas balance: <span class="gas" id="gas">--</span> ETH<br>Base ETH is used for one-time approval gas.</p>
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
      var gas = document.getElementById('gas');
      var line = document.getElementById('balLine');
      var val = parseFloat(d.balance_usdc || '0').toFixed(2);
      var gasVal = d.balance_eth === 'unknown' ? '--' : parseFloat(d.balance_eth || '0').toFixed(6);
      if (d.balance_usdc === 'unknown') { el.textContent = '--'; gas.textContent = gasVal; return; }
      el.textContent = val;
      gas.textContent = gasVal;
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
function generatePage(walletAddress) {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chain Insights — Fund Wallet</title>
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

  .gas-note {
    margin-top: -8px;
    margin-bottom: 16px;
    color: rgba(255,255,255,0.45);
    font-size: 12px;
    line-height: 1.4;
    text-align: left;
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
    <div class="balance-row">
      <span class="balance-label">Gas balance</span>
      <span class="balance-value" id="gasBalance">—<span class="currency">ETH</span></span>
    </div>
    <p class="gas-note">Base ETH is used for one-time approval gas.</p>

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
    var gasBalance = json.balance_eth === 'unknown' ? '—' : Number(json.balance_eth || 0).toFixed(6);
    document.getElementById('gasBalance').innerHTML = gasBalance + '<span class="currency">ETH</span>';
  } catch(e) {
    document.getElementById('balance').innerHTML = '—<span class="currency">USDC</span>';
    document.getElementById('gasBalance').innerHTML = '—<span class="currency">ETH</span>';
  }
}
fetchBalance();
setInterval(fetchBalance, 15000);

<\/script>
</body>
</html>`;
}
//#endregion
//#region src/wallet/topup-server.ts
var topup_server_exports = /* @__PURE__ */ __exportAll({
	generateArtifactHtml: () => generateArtifactHtml,
	getTopupArtifactUrl: () => getTopupArtifactUrl,
	getTopupUrl: () => getTopupUrl,
	startTopupServer: () => startTopupServer
});
const FALLBACK_PRIVATE_KEY = `0x${"0".repeat(63)}1`;
let artifactServerState = null;
function toWalletData(account) {
	if (typeof account === "string") return {
		address: account,
		privateKey: FALLBACK_PRIVATE_KEY,
		createdAt: (/* @__PURE__ */ new Date(0)).toISOString()
	};
	return {
		address: account.address,
		privateKey: account.privateKey,
		createdAt: (/* @__PURE__ */ new Date(0)).toISOString()
	};
}
function send(res, status, body, contentType) {
	res.writeHead(status, {
		"content-type": contentType,
		"cache-control": "no-store",
		"access-control-allow-origin": "*"
	});
	res.end(body);
}
async function proxyToCopiedServer(reqUrl, res, assetServerUrl) {
	const upstreamUrl = new URL(reqUrl, assetServerUrl);
	const upstream = await fetch(upstreamUrl);
	const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
	const body = Buffer.from(await upstream.arrayBuffer());
	send(res, upstream.status, body, contentType);
}
function getTopupArtifactUrl() {
	return artifactServerState?.url ?? null;
}
function getTopupUrl() {
	return getTopupArtifactUrl() ?? getTopupUrl$1();
}
async function startTopupServer(account) {
	const wallet = toWalletData(account);
	if (artifactServerState && artifactServerState.address.toLowerCase() === wallet.address.toLowerCase()) return artifactServerState.url;
	const assetServerUrl = await startTopupServer$1(wallet);
	if (artifactServerState) {
		await new Promise((resolve) => artifactServerState?.server.close(() => resolve()));
		artifactServerState = null;
	}
	const server = createServer((req, res) => {
		const reqUrl = req.url ?? "/";
		const pathname = new URL(reqUrl, "http://localhost").pathname;
		if (pathname === "/" || pathname === "/index.html") {
			const artifactUrl = artifactServerState?.url ?? assetServerUrl;
			send(res, 200, generateArtifactHtml(wallet.address, artifactUrl), "text/html; charset=utf-8");
			return;
		}
		if (pathname.startsWith("/assets/") || pathname.startsWith("/api/")) {
			proxyToCopiedServer(reqUrl, res, assetServerUrl).catch((err) => {
				send(res, 502, JSON.stringify({ error: err.message }) + "\n", "application/json; charset=utf-8");
			});
			return;
		}
		send(res, 404, JSON.stringify({ error: "Not found" }) + "\n", "application/json; charset=utf-8");
	});
	const url = await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const addressInfo = server.address();
			if (!addressInfo || typeof addressInfo === "string") {
				reject(/* @__PURE__ */ new Error("Failed to start topup artifact server"));
				return;
			}
			resolve(`http://localhost:${addressInfo.port}`);
		});
	});
	artifactServerState = {
		address: wallet.address,
		assetServerUrl,
		server,
		url
	};
	return url;
}
//#endregion
export { generateArtifactHtml as i, startTopupServer as n, topup_server_exports as r, getTopupUrl as t };

//# sourceMappingURL=topup-server-bs8DMcAn.mjs.map