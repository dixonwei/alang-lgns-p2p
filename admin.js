'use strict';

const $ = id => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function shortAddress(address) { return address ? address.slice(0, 6) + '...' + address.slice(-4) : ''; }
function formatNumber(value, max = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: max }).format(n);
}
function showToast(message, type = 'ok') {
  const toast = $('toast');
  toast.textContent = message;
  toast.className = 'toast show' + (type === 'error' ? ' error' : '');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.className = 'toast'; }, 3200);
}
async function api(path, options = {}) {
  const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options));
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const err = new Error(data.error || '请求失败');
    err.status = res.status;
    throw err;
  }
  return data;
}
function setLoginVisible(loggedIn) {
  $('loginPanel').classList.toggle('hidden', loggedIn);
  $('dashboardPanel').classList.toggle('hidden', !loggedIn);
  $('logoutButton').classList.toggle('hidden', !loggedIn);
}
function sideLabel(side) { return side === 'anubisToPolygon' ? 'ANUBIS → POLYGON' : 'POLYGON → ANUBIS'; }
function sourceShort(side) { return side === 'anubisToPolygon' ? 'ANUBIS' : 'POLYGON'; }
function targetShort(side) { return side === 'anubisToPolygon' ? 'POLYGON' : 'ANUBIS'; }
function ratioLabel(order) { return `1 ${sourceShort(order.side)} = ${Number(order.ratioLocked).toFixed(6)} ${targetShort(order.side)}`; }
function statusLabel(status) {
  return ({ open: '可接单', matched: '已接单 · 待锁仓', expired: '已过期', cancelled: '已取消', completed: '已完成' })[status] || status;
}
function renderOrders(orders) {
  const list = $('adminOrderList');
  if (!orders.length) { list.innerHTML = '<div class="empty-admin">当前还没有订单</div>'; return; }
  list.innerHTML = orders.map(order => `
    <article class="admin-order">
      <div>
        <strong>${sideLabel(order.side)} · ${formatNumber(order.sourceAmount, 6)} LGNS</strong>
        <p>${escapeHtml(order.id)} · 卖方 ${shortAddress(order.sellerWallet)} · ${ratioLabel(order)}</p>
      </div>
      <div><strong>${statusLabel(order.status)}</strong><p>买方应付 ${formatNumber(order.targetAmount, 6)} · 卖方到手 ${formatNumber(order.sellerReceives, 6)}</p></div>
      <div>${order.status === 'open' ? `<button class="button button-quiet cancel-admin-order" type="button" data-order-id="${escapeHtml(order.id)}">取消订单</button>` : ''}</div>
    </article>`).join('');
}
function renderDashboard(data) {
  const orders = data.orders || [];
  $('statPending').textContent = orders.filter(order => order.status === 'open').length;
  $('statOrders').textContent = orders.length;
  renderOrders(orders);
}
async function loadAdminState() {
  try {
    const data = await api('/api/admin/state');
    setLoginVisible(true);
    renderDashboard(data);
  } catch (err) {
    if (err.status === 401) setLoginVisible(false);
    else showToast(err.message, 'error');
  }
}
async function login(event) {
  event.preventDefault();
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('passwordInput').value }) });
    $('passwordInput').value = '';
    showToast('管理员登录成功。');
    await loadAdminState();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
async function cancelOrder(orderId) {
  if (!confirm('确认取消这笔未接单订单？')) return;
  try {
    await api(`/api/admin/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'POST', body: '{}' });
    showToast('订单已取消。');
    await loadAdminState();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
async function logout() {
  try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); } catch (_) {}
  setLoginVisible(false);
  showToast('已退出管理员后台。');
}
function bind() {
  $('loginForm').addEventListener('submit', login);
  $('refreshAdmin').addEventListener('click', loadAdminState);
  $('logoutButton').addEventListener('click', logout);
  $('adminOrderList').addEventListener('click', event => {
    const button = event.target.closest('.cancel-admin-order');
    if (button) cancelOrder(button.dataset.orderId);
  });
}
document.addEventListener('DOMContentLoaded', () => {
  bind();
  loadAdminState();
});