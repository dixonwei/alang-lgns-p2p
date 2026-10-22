'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec, execFile } = require('child_process');
const { ethers } = require('./vendor/ethers.umd.min.js');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const PASSWORD_FILE = path.join(DATA_DIR, 'admin-password.txt');
const PORT = Number(process.env.PORT || 8170);
const HOST = process.env.HOST || '127.0.0.1';
const FEE_BPS = 300;
const MIN_ORDER = 10;
const MAX_ORDER = 10000;
const MAX_EXPIRY_MINUTES = 1440;
const MIN_SELLER_RATIO = 0.000001;
const MAX_SELLER_RATIO = 10000;
const sessions = new Set();

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome SxS\\Application\\chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean);
  return candidates.find(candidate => { try { return fs.existsSync(candidate); } catch (_) { return false; } });
}

function openBrowser(url) {
  const chrome = findChrome();
  if (chrome) {
    execFile(chrome, [url], { windowsHide: true }, () => {});
    return;
  }
  exec(`start "" "${url}"`, { windowsHide: true });
}
function nowIso() { return new Date().toISOString(); }
function randomId(prefix) { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function round6(n) { return Math.round((Number(n) + Number.EPSILON) * 1e6) / 1e6; }
function safeNumber(n, fallback = 0) { const v = Number(n); return Number.isFinite(v) ? v : fallback; }

function defaultStore() {
  return {
    config: { feeBps: FEE_BPS, updatedAt: nowIso(), version: 1 },
    orders: []
  };
}
function ensureFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) writeStore(defaultStore());
  if (!fs.existsSync(PASSWORD_FILE)) {
    const pwd = 'ALANG-' + crypto.randomBytes(15).toString('base64url');
    fs.writeFileSync(PASSWORD_FILE, pwd + '\r\n', 'utf8');
    console.log(`\n管理员初始密码已生成：${pwd}\n文件：${PASSWORD_FILE}\n`);
  }
}

function readStore() {
  ensureFiles();
  try {
    const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    data.config = Object.assign({ feeBps: FEE_BPS, updatedAt: nowIso(), version: 1 }, data.config || {});
    data.config.feeBps = FEE_BPS;
    data.orders = Array.isArray(data.orders) ? data.orders : [];
    return data;
  } catch (err) {
    console.error('store.json 读取失败，已备份并使用默认数据。', err.message);
    try { fs.copyFileSync(STORE_FILE, STORE_FILE + '.broken-' + Date.now()); } catch (_) {}
    const fresh = defaultStore();
    writeStore(fresh);
    return fresh;
  }
}

function writeStore(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STORE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, STORE_FILE);
}

function expireOrders(store) {
  const now = Date.now();
  let changed = false;
  for (const order of store.orders) {
    if (order.status === 'open' && new Date(order.expiresAt).getTime() <= now) {
      order.status = 'expired';
      order.updatedAt = nowIso();
      changed = true;
    }
  }
  if (changed) writeStore(store);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end(text);
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function isAdmin(req) {
  const token = parseCookies(req).alang_admin;
  return Boolean(token && sessions.has(token));
}

function passwordOk(input) {
  const expected = fs.readFileSync(PASSWORD_FILE, 'utf8').trim();
  const a = crypto.createHash('sha256').update(String(input || '')).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function bodyJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 64 * 1024) {
        reject(new Error('请求内容过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (_) { reject(new Error('JSON 格式错误')); }
    });
    req.on('error', reject);
  });
}

function walletOk(wallet) { return /^0x[a-fA-F0-9]{40}$/.test(String(wallet || '')); }
function signatureOk(sig) { return typeof sig === 'string' && sig.length > 20; }
function sideLabel(side) { return side === 'anubisToPolygon' ? 'ANUBIS LGNS → POLYGON LGNS' : 'POLYGON LGNS → ANUBIS LGNS'; }
function verifyWalletSignature(message, signature, wallet) {
  try {
    return ethers.verifyMessage(message, signature).toLowerCase() === String(wallet).toLowerCase();
  } catch (_) {
    return false;
  }
}
function createOrderMessage(order) {
  return [
    '阿郎老师 LGNS 双链互助交换订单',
    `方向：${sideLabel(order.side)}`,
    `卖出：${order.sourceAmount} LGNS`,
    `锁定比例：${ratioDisplay(order.side, order.ratio)}`,
    `成交毛额：${order.targetAmount}`,
    `平台服务费：${order.feeAmount}（3%）`,
    `预计到手：${order.sellerReceives}`,
    `有效期：${order.expiryMinutes} 分钟`,
    `钱包：${order.wallet}`
  ].join('\n');
}
function acceptOrderMessage(order, takerWallet) {
  return [
    '阿郎老师 LGNS 双链互助交换接单确认',
    `订单号：${order.id}`,
    `方向：${sideLabel(order.side)}`,
    `卖方：${order.sellerWallet}`,
    `卖出：${order.sourceAmount} LGNS`,
    `买方应付毛额：${order.targetAmount}`,
    `锁定比例：${ratioDisplay(order.side, order.ratioLocked)}`,
    `接单钱包：${takerWallet}`,
    '当前阶段：仅撮合，不发生链上转账'
  ].join('\n');
}

function amountForSellerRatio(sourceAmount, sellerRatio) {
  return round6(sourceAmount * sellerRatio);
}

function ratioDisplay(side, ratio) {
  const source = side === 'anubisToPolygon' ? 'ANUBIS' : 'POLYGON';
  const target = side === 'anubisToPolygon' ? 'POLYGON' : 'ANUBIS';
  return `1 ${source} = ${Number(ratio).toFixed(6)} ${target}`;
}
function publicOrder(o) {
  return {
    id: o.id,
    side: o.side,
    sellerWallet: o.sellerWallet,
    takerWallet: o.takerWallet || null,
    sourceAmount: o.sourceAmount,
    targetAmount: o.targetAmount,
    feeAmount: o.feeAmount,
    sellerReceives: o.sellerReceives,
    ratioLocked: o.ratioLocked,
    feeBpsLocked: o.feeBpsLocked,
    createdAt: o.createdAt,
    expiresAt: o.expiresAt,
    status: o.status,
    acceptedAt: o.acceptedAt || null,
    note: o.note || ''
  };
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8'
  })[ext] || 'application/octet-stream';
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/admin' || rel === '/admin/') rel = '/admin.html';
  const file = path.resolve(ROOT, '.' + rel);
  if (!file.startsWith(ROOT + path.sep)) return sendText(res, 403, 'Forbidden');
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return sendText(res, 404, 'Not Found');
    res.writeHead(200, {
      'Content-Type': contentType(file),
      'Cache-Control': file.endsWith('.html') ? 'no-cache' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin'
    });
    fs.createReadStream(file).pipe(res);
  });
}

async function handleApi(req, res, pathname) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, time: nowIso(), service: '阿郎老师 LGNS 双链互助交换站' });
  }

  if (req.method === 'GET' && pathname === '/api/config') {
    const store = readStore();
    return sendJson(res, 200, {
      ok: true,
      feeBps: FEE_BPS,
      feePercent: FEE_BPS / 100,
      minOrder: MIN_ORDER,
      maxOrder: MAX_ORDER,
      maxExpiryMinutes: MAX_EXPIRY_MINUTES,
      minSellerRatio: MIN_SELLER_RATIO,
      maxSellerRatio: MAX_SELLER_RATIO,
      pricingMode: 'seller',
      updatedAt: store.config.updatedAt,
      settlementMode: 'matching-only',
      notice: '当前首版为撮合与签名原型，HTLC 合约尚未接入，请勿在平台外提前转账。'
    });
  }

  if (req.method === 'GET' && pathname === '/api/orders') {
    const store = readStore();
    expireOrders(store);
    const side = url.searchParams.get('side');
    const orders = store.orders
      .filter(o => !side || o.side === side)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 100)
      .map(publicOrder);
    return sendJson(res, 200, { ok: true, orders });
  }


  if (req.method === 'POST' && pathname === '/api/orders') {
    try {
      const body = await bodyJson(req);
      if (!walletOk(body.wallet)) return sendJson(res, 400, { ok: false, error: '钱包地址格式错误' });
      if (!signatureOk(body.signature)) return sendJson(res, 400, { ok: false, error: '缺少钱包签名' });
      const sourceAmount = safeNumber(body.sourceAmount, 0);
      if (sourceAmount < MIN_ORDER || sourceAmount > MAX_ORDER) return sendJson(res, 400, { ok: false, error: `卖出数量需在 ${MIN_ORDER}–${MAX_ORDER} LGNS 之间` });
      const expiryMinutes = Math.round(safeNumber(body.expiryMinutes, 30));
      if (expiryMinutes < 5 || expiryMinutes > MAX_EXPIRY_MINUTES) return sendJson(res, 400, { ok: false, error: '订单有效期需在 5 分钟–24 小时之间' });
      const side = body.side === 'polygonToAnubis' ? 'polygonToAnubis' : 'anubisToPolygon';
      const ratio = round6(Number(body.sellerRatio));
      if (!Number.isFinite(ratio) || ratio < MIN_SELLER_RATIO || ratio > MAX_SELLER_RATIO) {
        return sendJson(res, 400, { ok: false, error: `卖出方比例需在 ${MIN_SELLER_RATIO}–${MAX_SELLER_RATIO} 之间` });
      }
      const store = readStore();
      const roundedSourceAmount = round6(sourceAmount);
      const targetAmount = amountForSellerRatio(roundedSourceAmount, ratio);
      const feeAmount = round6(targetAmount * FEE_BPS / 10000);
      const sellerReceives = round6(targetAmount - feeAmount);
      const signedMessage = createOrderMessage({
        side,
        sourceAmount: roundedSourceAmount,
        ratio,
        targetAmount,
        feeAmount,
        sellerReceives,
        expiryMinutes,
        wallet: body.wallet
      });
      if (!verifyWalletSignature(signedMessage, body.signature, body.wallet)) {
        return sendJson(res, 401, { ok: false, error: '钱包签名校验失败，请重新签名' });
      }
      const order = {
        id: randomId('ALG'),
        side,
        sellerWallet: body.wallet,
        sellerSignature: body.signature,
        sourceAmount: roundedSourceAmount,
        targetAmount,
        feeAmount,
        sellerReceives,
        ratioLocked: ratio,
        feeBpsLocked: FEE_BPS,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        expiresAt: new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString(),
        expiryMinutes,
        status: 'open',
        takerWallet: null,
        takerSignature: null,
        acceptedAt: null,
        note: String(body.note || '').slice(0, 160)
      };
      store.orders.push(order);
      writeStore(store);
      return sendJson(res, 201, { ok: true, order: publicOrder(order) });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  }

  const acceptMatch = pathname.match(/^\/api\/orders\/([^/]+)\/accept$/);
  if (req.method === 'POST' && acceptMatch) {
    try {
      const body = await bodyJson(req);
      if (!walletOk(body.wallet)) return sendJson(res, 400, { ok: false, error: '接单钱包地址格式错误' });
      if (!signatureOk(body.signature)) return sendJson(res, 400, { ok: false, error: '缺少接单钱包签名' });
      const store = readStore();
      expireOrders(store);
      const order = store.orders.find(o => o.id === acceptMatch[1]);
      if (!order) return sendJson(res, 404, { ok: false, error: '订单不存在' });
      if (order.status !== 'open') return sendJson(res, 409, { ok: false, error: '订单当前不可接单' });
      if (order.sellerWallet.toLowerCase() === String(body.wallet).toLowerCase()) return sendJson(res, 400, { ok: false, error: '不能接自己的订单' });
      const signedMessage = acceptOrderMessage(order, body.wallet);
      if (!verifyWalletSignature(signedMessage, body.signature, body.wallet)) {
        return sendJson(res, 401, { ok: false, error: '接单钱包签名校验失败，请重新签名' });
      }
      order.status = 'matched';
      order.takerWallet = body.wallet;
      order.takerSignature = body.signature;
      order.acceptedAt = nowIso();
      order.updatedAt = nowIso();
      writeStore(store);
      return sendJson(res, 200, { ok: true, order: publicOrder(order), message: '已签名接单，等待双方完成链上锁仓。' });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/admin/login') {
    try {
      const body = await bodyJson(req);
      if (!passwordOk(body.password)) return sendJson(res, 401, { ok: false, error: '管理员密码错误' });
      const token = crypto.randomBytes(24).toString('hex');
      sessions.add(token);
      res.setHeader('Set-Cookie', `alang_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/admin/logout') {
    const token = parseCookies(req).alang_admin;
    if (token) sessions.delete(token);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/admin/state') {
    if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: '请先登录管理员' });
    const store = readStore();
    expireOrders(store);
    return sendJson(res, 200, { ok: true, config: { feeBps: FEE_BPS, pricingMode: 'seller', minOrder: MIN_ORDER, maxOrder: MAX_ORDER, maxExpiryMinutes: MAX_EXPIRY_MINUTES, minSellerRatio: MIN_SELLER_RATIO, maxSellerRatio: MAX_SELLER_RATIO }, orders: store.orders.slice().reverse().map(publicOrder) });
  }

  if (req.method === 'POST' && pathname === '/api/admin/rate') {
    return sendJson(res, 403, { ok: false, error: '兑换比例由卖出方在每笔订单中自行设置，平台后台不能修改' });
  }
  const cancelMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/cancel$/);
  if (req.method === 'POST' && cancelMatch) {
    if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: '请先登录管理员' });
    const store = readStore();
    const order = store.orders.find(o => o.id === cancelMatch[1]);
    if (!order) return sendJson(res, 404, { ok: false, error: '订单不存在' });
    if (order.status === 'matched') return sendJson(res, 409, { ok: false, error: '已接单订单不能直接取消' });
    order.status = 'cancelled';
    order.updatedAt = nowIso();
    writeStore(store);
    return sendJson(res, 200, { ok: true, order: publicOrder(order) });
  }

  return sendJson(res, 404, { ok: false, error: '接口不存在' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname).catch(err => {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: '服务器内部错误' });
      else res.end();
    });
    return;
  }
  serveStatic(req, res, pathname);
});

ensureFiles();
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n端口 ${PORT} 已被占用。请关闭之前打开的网站命令窗口后再启动。\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/`;
  console.log('==============================================');
  console.log('  阿郎老师 LGNS 双链互助交换站');
  console.log(`  ${url}`);
  console.log('  按 Ctrl+C 可停止服务');
  console.log('==============================================');
  if (process.env.NO_OPEN !== '1') {
    setTimeout(() => openBrowser(url), 600);
  }
});

process.on('SIGINT', () => {
  console.log('\n服务已停止。');
  server.close(() => process.exit(0));
});