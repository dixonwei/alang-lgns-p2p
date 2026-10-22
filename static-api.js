(() => {
'use strict';

window.ALANG_STATIC_DEMO = location.protocol === 'file:' || !['127.0.0.1', 'localhost'].includes(location.hostname);
const STATIC_ORDERS_KEY = 'alang_lgns_p2p_orders_v1';
const round6 = value => Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6;
const readOrders = () => {
  try {
    const orders = JSON.parse(localStorage.getItem(STATIC_ORDERS_KEY) || '[]');
    return Array.isArray(orders) ? orders : [];
  } catch (_) { return []; }
};
const writeOrders = orders => localStorage.setItem(STATIC_ORDERS_KEY, JSON.stringify(orders));
const staticOrderId = () => 'DEMO-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(16).slice(2, 8).toUpperCase();

window.ALANG_STATIC_API = async function staticApi(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const body = options.body ? JSON.parse(options.body) : {};
  if (method === 'GET' && path === '/api/config') {
    return {
      ok: true,
      pricingMode: 'seller',
      feeBps: 300,
      feePercent: 3,
      minOrder: 10,
      maxOrder: 500,
      maxExpiryMinutes: 1440,
      minSellerRatio: 0.000001,
      maxSellerRatio: 10000,
      updatedAt: new Date().toISOString(),
      settlementMode: 'static-demo',
      notice: '公开展示版：订单只保存在当前浏览器，正式撮合需要连接后台服务。'
    };
  }
  if (method === 'GET' && path === '/api/orders') {
    const now = Date.now();
    const orders = readOrders().map(order => {
      if (order.status === 'open' && new Date(order.expiresAt).getTime() <= now) return { ...order, status: 'expired' };
      return order;
    });
    writeOrders(orders);
    return { ok: true, orders };
  }
  if (method === 'POST' && path === '/api/orders') {
    const sourceAmount = Number(body.sourceAmount);
    const ratio = Number(body.sellerRatio);
    if (!body.wallet || !body.signature) throw new Error('请先连接钱包并完成签名');
    if (!Number.isFinite(sourceAmount) || sourceAmount < 10 || sourceAmount > 500) throw new Error('卖出数量需在 10–500 LGNS 之间');
    if (!Number.isFinite(ratio) || ratio <= 0) throw new Error('请填写有效的卖出比例');
    const targetAmount = round6(sourceAmount * ratio);
    const feeAmount = round6(targetAmount * 0.03);
    const sellerReceives = round6(targetAmount - feeAmount);
    const order = {
      id: staticOrderId(),
      side: body.side === 'polygonToAnubis' ? 'polygonToAnubis' : 'anubisToPolygon',
      sellerWallet: body.wallet,
      takerWallet: null,
      sourceAmount: round6(sourceAmount),
      targetAmount,
      feeAmount,
      sellerReceives,
      ratioLocked: ratio,
      feeBpsLocked: 300,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + Math.min(Math.max(Number(body.expiryMinutes) || 30, 5), 1440) * 60000).toISOString(),
      status: 'open',
      acceptedAt: null
    };
    const orders = readOrders();
    orders.unshift(order);
    writeOrders(orders);
    return { ok: true, order };
  }
  const accept = path.match(/^\/api\/orders\/([^/]+)\/accept$/);
  if (method === 'POST' && accept) {
    if (!body.wallet || !body.signature) throw new Error('请先连接钱包并完成签名');
    const orders = readOrders();
    const order = orders.find(item => item.id === decodeURIComponent(accept[1]));
    if (!order) throw new Error('订单不存在');
    if (order.status !== 'open') throw new Error('订单当前不可接单');
    if (order.sellerWallet.toLowerCase() === String(body.wallet).toLowerCase()) throw new Error('不能接自己的订单');
    order.status = 'matched';
    order.takerWallet = body.wallet;
    order.acceptedAt = new Date().toISOString();
    writeOrders(orders);
    return { ok: true, order };
  }
  throw new Error('公开展示版暂不支持该操作');
};
})();
