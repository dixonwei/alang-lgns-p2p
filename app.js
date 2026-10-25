'use strict';

const state = {
  config: null,
  orders: [],
  filter: 'all',
  side: 'anubisToPolygon',
  wallet: null,
  provider: null,
  pendingOrder: null,
  pendingAccept: null,
  toastTimer: null,
  listenersAdded: false
};

const $ = id => document.getElementById(id);
const $$ = selector => Array.from(document.querySelectorAll(selector));
const STATIC_DEMO = window.ALANG_STATIC_DEMO !== undefined ? Boolean(window.ALANG_STATIC_DEMO) : (location.protocol === 'file:' || !['127.0.0.1', 'localhost'].includes(location.hostname));

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function shortAddress(address) {
  if (!address) return '';
  return address.slice(0, 6) + '...' + address.slice(-4);
}

function formatNumber(value, max = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: max }).format(n);
}

function round6(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6;
}

function formatFeePercent(feeBps) {
  const percent = Number(feeBps) / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

function chainName(chainId) {
  const map = { '0x89': 'Polygon', '0x1a3a': 'ANUBIS', '0x1': 'Ethereum' };
  return map[String(chainId || '').toLowerCase()] || '未识别网络';
}

function showToast(message, type = 'ok') {
  const toast = $('toast');
  toast.textContent = message;
  toast.className = 'toast show' + (type === 'error' ? ' error' : '');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3200);
}

async function api(path, options = {}) {
  if (STATIC_DEMO) return window.ALANG_STATIC_API(path, options);
  const res = await fetch(path, Object.assign({
    headers: { 'Content-Type': 'application/json' }
  }, options));
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

async function loadConfig() {
  let data;
  try {
    data = await api('/api/config');
  } catch (err) {
    if (!STATIC_DEMO) throw err;
    data = {
      pricingMode: 'seller', feeBps: 300, feePercent: 3,
      minOrder: 10, maxOrder: 10000, maxExpiryMinutes: 1440,
      minSellerRatio: 0.000001, maxSellerRatio: 10000,
      settlementMode: 'static-demo'
    };
  }
  state.config = data;
  $('heroRate').textContent = '卖方定价';
  const feeLabel = formatFeePercent(data.feeBps);
  $('heroFee').textContent = feeLabel;
  if ($('heroFeeRule')) $('heroFeeRule').textContent = feeLabel;
  if ($('feePanelTitle')) $('feePanelTitle').textContent = `平台服务费 ${feeLabel}`;
  if ($('feePanelLabel')) $('feePanelLabel').textContent = `平台服务费 ${feeLabel}`;
  if ($('quoteFeeLabel')) $('quoteFeeLabel').textContent = `平台服务费 · ${feeLabel}`;
  if ($('escrowFeeValue')) $('escrowFeeValue').textContent = feeLabel;
  $('amountRange').textContent = `单笔 ${data.minOrder}–${data.maxOrder} LGNS`;
  $('amountInput').min = data.minOrder;
  $('amountInput').max = data.maxOrder;
  $('sellerRatioInput').min = data.minSellerRatio || 0.000001;
  $('sellerRatioInput').max = data.maxSellerRatio || 10000;
  updateQuote();
}

function computeQuote(amount, ratio, feeBps) {
  const sourceAmount = Number(amount);
  const sellerRatio = Number(ratio);
  if (!Number.isFinite(sourceAmount) || sourceAmount <= 0 || !Number.isFinite(sellerRatio) || sellerRatio <= 0) {
    return { targetAmount: 0, feeAmount: 0, sellerReceives: 0 };
  }
  const targetAmount = sourceAmount * sellerRatio;
  const feeAmount = targetAmount * feeBps / 10000;
  return {
    targetAmount: round6(targetAmount),
    feeAmount: round6(feeAmount),
    sellerReceives: round6(targetAmount - feeAmount)
  };
}

function sourceShort(side) { return side === 'anubisToPolygon' ? 'ANUBIS' : 'POLYGON'; }
function targetShort(side) { return side === 'anubisToPolygon' ? 'POLYGON' : 'ANUBIS'; }
function sideRatioLabel(side, ratio) { return `1 ${sourceShort(side)} = ${Number(ratio).toFixed(6)} ${targetShort(side)}`; }

function updateQuote() {
  if (!state.config) return;
  const ratio = Number($('sellerRatioInput').value || 0);
  const feeBps = Number(state.config.feeBps || 300);
  const amount = Number($('amountInput').value || 0);
  const q = computeQuote(amount, ratio, feeBps);
  const src = sourceShort(state.side);
  const tgt = targetShort(state.side);
  $('sourceSymbol').textContent = `${src} LGNS`;
  $('targetSymbol').textContent = `${tgt} LGNS`;
  $('ratioSourceText').textContent = `1 ${src}`;
  $('ratioSuffix').textContent = tgt;
  $('receiveAmount').textContent = formatNumber(q.sellerReceives, 6);
  $('grossAmount').textContent = `${formatNumber(q.targetAmount, 6)} ${tgt}`;
  $('feeAmount').textContent = `${formatNumber(q.feeAmount, 6)} ${tgt}`;
  $('quoteRate').textContent = ratio > 0 ? sideRatioLabel(state.side, ratio) : '请填写卖出比例';
  $('createOrderButton').textContent = state.wallet ? '签名并发布交换订单' : '连接钱包后发布交换订单';
}

function selectSide(side) {
  if (side === state.side) return;
  const ratioInput = $('sellerRatioInput');
  const currentRatio = Number(ratioInput.value);
  if (Number.isFinite(currentRatio) && currentRatio > 0) {
    const flipped = round6(1 / currentRatio);
    ratioInput.value = String(flipped);
  }
  state.side = side;
  $$('.direction-button').forEach(btn => btn.classList.toggle('active', btn.dataset.side === side));
  updateQuote();
}

async function connectWallet() {
  try {
    const provider = (window.okxwallet && (window.okxwallet.ethereum || window.okxwallet)) || window.ethereum;
    if (!provider || typeof provider.request !== 'function') {
      showToast('未检测到 OKX Wallet 或其他浏览器钱包，请先安装钱包并刷新页面。', 'error');
      return null;
    }
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (!Array.isArray(accounts) || !accounts[0]) throw new Error('未获得钱包地址');
    state.provider = provider;
    state.wallet = accounts[0];
    const chainId = await provider.request({ method: 'eth_chainId' }).catch(() => '');
    const walletText = $('walletButtonText');
    walletText.textContent = shortAddress(accounts[0]);
    walletText.title = `${accounts[0]} · ${chainName(chainId)}`;
    $('walletButton').classList.add('connected');
    updateQuote();
    showToast(`钱包已连接：${chainName(chainId)} · ${shortAddress(accounts[0])}`);
    if (!state.listenersAdded) {
      state.listenersAdded = true;
      provider.on?.('accountsChanged', next => {
        if (!next || !next.length) {
          state.wallet = null;
          state.provider = null;
          $('walletButtonText').textContent = '连接钱包';
          $('walletButton').classList.remove('connected');
          updateQuote();
          renderOrders();
        } else {
          state.wallet = next[0];
          $('walletButtonText').textContent = shortAddress(next[0]);
          renderOrders();
        }
      });
      provider.on?.('chainChanged', () => {
        showToast('钱包网络已切换，请确认当前操作链。');
      });
    }
    return provider;
  } catch (err) {
    console.error(err);
    showToast(err?.message || '连接钱包失败', 'error');
    return null;
  }
}

async function signText(text) {
  const provider = state.provider || await connectWallet();
  if (!provider || !state.wallet) throw new Error('请先连接钱包');
  const hex = '0x' + Array.from(new TextEncoder().encode(text)).map(b => b.toString(16).padStart(2, '0')).join('');
  return provider.request({ method: 'personal_sign', params: [hex, state.wallet] });
}

function openModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

function closeModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  if (!$$('.modal-backdrop.open').length) document.body.classList.remove('modal-open');
}

function orderSideLabel(side) {
  return side === 'anubisToPolygon' ? 'ANUBIS LGNS → POLYGON LGNS' : 'POLYGON LGNS → ANUBIS LGNS';
}

function sideTargetShort(side) {
  return side === 'anubisToPolygon' ? 'POLYGON' : 'ANUBIS';
}

function statusInfo(status) {
  return ({
    open: ['可接单', 'status-open'],
    matched: ['已接单 · 待锁仓', 'status-matched'],
    expired: ['已过期', 'status-expired'],
    cancelled: ['已取消', 'status-cancelled'],
    completed: ['已完成', 'status-open']
  })[status] || [status || '未知', 'status-expired'];
}

function timeRemaining(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return '已到期';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const seconds = Math.floor((ms % 60000) / 1000);
  if (hours > 0) return `${hours}小时${minutes}分`;
  return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
}

async function loadOrders() {
  try {
    const data = await api('/api/orders');
    state.orders = data.orders || [];
  } catch (err) {
    if (!STATIC_DEMO) throw err;
    state.orders = [];
  }
  renderOrders();
}

function filteredOrders() {
  if (state.filter === 'all') return state.orders;
  return state.orders.filter(order => order.side === state.filter);
}

function renderOrders() {
  const list = $('orderList');
  const orders = filteredOrders();
  if (!orders.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div>
          <div class="empty-state-mark">＋</div>
          <h3>还没有符合条件的订单</h3>
          <p>你可以先在上方计算价格，连接钱包后发布第一笔交换订单。</p>
        </div>
      </div>`;
    return;
  }
  list.innerHTML = orders.map(order => {
    const [statusText, statusClass] = statusInfo(order.status);
    const canAccept = order.status === 'open';
    const ownOrder = state.wallet && order.sellerWallet.toLowerCase() === state.wallet.toLowerCase();
    const targetShort = sideTargetShort(order.side);
    return `
      <article class="order-card" data-order-id="${escapeHtml(order.id)}">
        <div>
          <div class="order-direction"><span>${orderSideLabel(order.side)}</span><b>·</b><span>${escapeHtml(order.id)}</span></div>
          <div class="order-amounts"><strong>${formatNumber(order.sourceAmount, 6)}</strong><span>${order.side === 'anubisToPolygon' ? 'ANUBIS' : 'POLYGON'} LGNS</span><b>→</b><strong>${formatNumber(order.targetAmount, 6)}</strong><span>${targetShort} LGNS</span></div>
          <div class="order-receive">卖方预计到手 <b>${formatNumber(order.sellerReceives, 6)} ${targetShort} LGNS</b> · 平台费 ${formatFeePercent(order.feeBpsLocked ?? 300)} 已扣除</div>
        </div>
        <div class="order-meta">
          <span class="order-status ${statusClass}">${statusText}</span>
          <span>卖方比例：<strong>${sideRatioLabel(order.side, order.ratioLocked)}</strong></span>
          <span>卖方：<strong>${shortAddress(order.sellerWallet)}</strong></span>
          <span>剩余：<strong class="countdown" data-expires="${escapeHtml(order.expiresAt)}">${timeRemaining(order.expiresAt)}</strong></span>
        </div>
        <div class="order-actions">
          ${canAccept ? `<button class="button button-ghost accept-order" type="button" data-order-id="${escapeHtml(order.id)}" ${ownOrder ? 'disabled' : ''}>${ownOrder ? '这是你的订单' : (state.wallet ? '签名接单' : '连接后接单')}</button>` : `<span class="order-id">${escapeHtml(statusText)}</span>`}
          <span class="order-id">${new Date(order.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
        </div>
      </article>`;
  }).join('');
}

function updateCountdowns() {
  $$('.countdown').forEach(el => { el.textContent = timeRemaining(el.dataset.expires); });
}

async function prepareCreateOrder() {
  if (!state.wallet) {
    const provider = await connectWallet();
    if (!provider) return;
  }
  if (!state.config) return showToast('配置尚未加载完成，请稍后重试。', 'error');
  const amount = Number($('amountInput').value);
  if (!Number.isFinite(amount) || amount < state.config.minOrder || amount > state.config.maxOrder) {
    return showToast(`卖出数量需在 ${state.config.minOrder}–${state.config.maxOrder} LGNS 之间。`, 'error');
  }
  const expiryMinutes = Number($('expirySelect').value || 30);
  const sellerRatio = Number($('sellerRatioInput').value || 0);
  if (!Number.isFinite(sellerRatio) || sellerRatio < Number(state.config.minSellerRatio || 0.000001) || sellerRatio > Number(state.config.maxSellerRatio || 10000)) {
    return showToast('请填写有效的卖出方兑换比例。', 'error');
  }
  const q = computeQuote(amount, sellerRatio, Number(state.config.feeBps));
  state.pendingOrder = {
    side: state.side,
    amount: round6(amount),
    expiryMinutes,
    targetAmount: q.targetAmount,
    feeAmount: q.feeAmount,
    sellerReceives: q.sellerReceives,
    ratio: round6(sellerRatio)
  };
  $('orderModalSummary').innerHTML = `
    <div><span>卖出方向</span><strong>${orderSideLabel(state.side)}</strong></div>
    <div><span>卖出数量</span><strong>${formatNumber(amount, 6)} LGNS</strong></div>
    <div><span>卖出方比例</span><strong>${sideRatioLabel(state.side, sellerRatio)}</strong></div>
    <div><span>成交毛额</span><strong>${formatNumber(q.targetAmount, 6)} ${sideTargetShort(state.side)} LGNS</strong></div>
    <div><span>平台服务费 ${formatFeePercent(state.config.feeBps)}</span><strong>${formatNumber(q.feeAmount, 6)} ${sideTargetShort(state.side)} LGNS</strong></div>
    <div><span>预计到手</span><strong>${formatNumber(q.sellerReceives, 6)} ${sideTargetShort(state.side)} LGNS</strong></div>
    <div><span>订单有效期</span><strong>${expiryMinutes >= 60 ? (expiryMinutes / 60) + ' 小时' : expiryMinutes + ' 分钟'}</strong></div>`;
  openModal('orderModal');
}

async function confirmCreateOrder() {
  if (!state.pendingOrder) return;
  const button = $('confirmCreateOrder');
  button.disabled = true;
  button.textContent = '等待钱包签名…';
  try {
    const order = state.pendingOrder;
    const message = [
      '阿郎老师 LGNS 双链互助交换订单',
      `方向：${orderSideLabel(order.side)}`,
      `卖出：${order.amount} LGNS`,
      `锁定比例：${sideRatioLabel(order.side, order.ratio)}`,
      `成交毛额：${order.targetAmount}`,
      `平台服务费：${order.feeAmount}（${formatFeePercent(state.config.feeBps)}）`,
      `预计到手：${order.sellerReceives}`,
      `有效期：${order.expiryMinutes} 分钟`,
      `钱包：${state.wallet}`
    ].join('\n');
    const signature = await signText(message);
    await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        side: order.side,
        sourceAmount: order.amount,
        sellerRatio: order.ratio,
        expiryMinutes: order.expiryMinutes,
        wallet: state.wallet,
        signature
      })
    });
    closeModal('orderModal');
    showToast('交换订单已发布，等待买方签名接单。');
    await loadOrders();
    document.getElementById('orders').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error(err);
    showToast(err?.message || '发布交换订单失败', 'error');
  } finally {
    button.disabled = false;
    button.textContent = '钱包签名并发布';
  }
}

async function prepareAcceptOrder(orderId) {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;
  if (!state.wallet) {
    const provider = await connectWallet();
    if (!provider) return;
  }
  if (order.sellerWallet.toLowerCase() === state.wallet.toLowerCase()) return showToast('不能接自己的订单。', 'error');
  state.pendingAccept = order;
  $('acceptModalSummary').innerHTML = `
    <div><span>卖出方向</span><strong>${orderSideLabel(order.side)}</strong></div>
    <div><span>卖方数量</span><strong>${formatNumber(order.sourceAmount, 6)} LGNS</strong></div>
    <div><span>买方应付毛额</span><strong>${formatNumber(order.targetAmount, 6)} ${sideTargetShort(order.side)} LGNS</strong></div>
    <div><span>卖方比例</span><strong>${sideRatioLabel(order.side, order.ratioLocked)}</strong></div>
    <div><span>接单钱包</span><strong>${shortAddress(state.wallet)}</strong></div>
    <div><span>当前阶段</span><strong>仅撮合，不会转币</strong></div>`;
  openModal('acceptModal');
}

async function confirmAcceptOrder() {
  if (!state.pendingAccept) return;
  const button = $('confirmAcceptOrder');
  button.disabled = true;
  button.textContent = '等待钱包签名…';
  try {
    const order = state.pendingAccept;
    const message = [
      '阿郎老师 LGNS 双链互助交换接单确认',
      `订单号：${order.id}`,
      `方向：${orderSideLabel(order.side)}`,
      `卖方：${order.sellerWallet}`,
      `卖出：${order.sourceAmount} LGNS`,
      `买方应付毛额：${order.targetAmount}`,
      `锁定比例：${sideRatioLabel(order.side, order.ratioLocked)}`,
      `接单钱包：${state.wallet}`,
      '当前阶段：仅撮合，不发生链上转账'
    ].join('\n');
    const signature = await signText(message);
    await api(`/api/orders/${encodeURIComponent(order.id)}/accept`, {
      method: 'POST',
      body: JSON.stringify({ wallet: state.wallet, signature })
    });
    closeModal('acceptModal');
    showToast('接单成功，订单已进入待锁仓状态。');
    await loadOrders();
  } catch (err) {
    console.error(err);
    showToast(err?.message || '接单失败', 'error');
  } finally {
    button.disabled = false;
    button.textContent = '钱包签名并接单';
  }
}

function bindEvents() {
  $('walletButton').addEventListener('click', connectWallet);
  $('amountInput').addEventListener('input', updateQuote);
  $('sellerRatioInput').addEventListener('input', updateQuote);
  $$('.direction-button').forEach(btn => btn.addEventListener('click', () => selectSide(btn.dataset.side)));
  $('createOrderButton').addEventListener('click', prepareCreateOrder);
  $('confirmCreateOrder').addEventListener('click', confirmCreateOrder);
  $('confirmAcceptOrder').addEventListener('click', confirmAcceptOrder);
  $('refreshOrders').addEventListener('click', async () => {
    try { await loadConfig(); await loadOrders(); showToast('订单已刷新。'); } catch (err) { showToast(err.message, 'error'); }
  });
  $$('.filter-tab').forEach(tab => tab.addEventListener('click', () => {
    state.filter = tab.dataset.filter;
    $$('.filter-tab').forEach(t => t.classList.toggle('active', t === tab));
    renderOrders();
  }));
  $('orderList').addEventListener('click', event => {
    const button = event.target.closest('.accept-order');
    if (button && !button.disabled) prepareAcceptOrder(button.dataset.orderId);
  });
  document.addEventListener('click', event => {
    const close = event.target.closest('[data-close-modal]');
    if (close) closeModal(close.dataset.closeModal);
    if (event.target.classList.contains('modal-backdrop')) closeModal(event.target.id);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') $$('.modal-backdrop.open').forEach(m => closeModal(m.id));
  });
}

function addStaticDemoBanner() {
  if (!STATIC_DEMO) return;
  document.querySelectorAll('a[href="./admin.html"]').forEach(link => { link.style.display = 'none'; });
  if (document.querySelector('.public-demo-banner')) return;
  const banner = document.createElement('div');
  banner.className = 'public-demo-banner';
  banner.innerHTML = '<span>公开展示版</span><p>本页已部署为可直接分享的展示网站；订单只保存在当前浏览器，正式跨用户撮合仍需连接后台服务。</p>';
  const main = document.querySelector('main');
  main.insertBefore(banner, main.firstChild);
}
async function init() {
  bindEvents();
  addStaticDemoBanner();
  try {
    await loadConfig();
    await loadOrders();
  } catch (err) {
    console.error(err);
    showToast('网站数据加载失败，请确认本地服务已启动。', 'error');
  }
  setInterval(updateCountdowns, 1000);
  setInterval(async () => {
    try { await loadConfig(); await loadOrders(); } catch (_) {}
  }, 30000);
}

document.addEventListener('DOMContentLoaded', init);