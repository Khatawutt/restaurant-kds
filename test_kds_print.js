const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const elements = new Map();
const listeners = {};
let printCalls = 0;
let fetchCalls = 0;
let confirmCalls = 0;
let confirmResult = true;
let promptCalls = 0;
let promptResult = 'secret-token';
let nextPostResponse = null;
let nextSummary = null;
const storage = new Map();
const requests = [];

function makeElement() {
  const classes = new Set();
  return {
    innerHTML: '',
    innerText: '',
    textContent: '',
    className: '',
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); }
    }
  };
}

const body = makeElement();
class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.destination = {};
  }
  createOscillator() {
    return {
      frequency: { setValueAtTime() {} },
      connect() {},
      start() {},
      stop() {}
    };
  }
  createGain() {
    return {
      gain: {
        setValueAtTime() {},
        exponentialRampToValueAtTime() {}
      },
      connect() {}
    };
  }
  resume() {}
}
const document = {
  body,
  title: 'KDS Kitchen Display System',
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  }
};
const window = {
  location: { href: 'https://kds.example/' },
  AudioContext: MockAudioContext,
  print() { printCalls += 1; },
  confirm() { confirmCalls += 1; return confirmResult; },
  prompt() { promptCalls += 1; return promptResult; },
  addEventListener(name, callback) { listeners[name] = callback; }
};
const context = vm.createContext({
  document,
  window,
  console,
  URL,
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  },
  fetch: async (url, options = {}) => {
    fetchCalls += 1;
    requests.push({ url, options });
    let body;
    if (options.method === 'POST') {
      body = nextPostResponse || { status: 'success' };
      nextPostResponse = null;
    } else if (String(url).includes('getDailySalesSummary')) {
      body = { status: 'success', summary: nextSummary };
    } else {
      body = { status: 'success', orders: [] };
    }
    return { ok: true, text: async () => JSON.stringify(body) };
  },
  setInterval() {}
});

vm.runInContext(inlineScript, context);

async function run() {
  await new Promise(resolve => setTimeout(resolve, 0));
  context.previousOrderCount = 1;
  const order = {
    orderId: 'MN26-01-101',
    room: '101',
    name: 'Guest',
    timestamp: '18:03',
    status: 'Pending',
    payment: 'Alipay (pay at room)',
    items: [{ name: 'Tea <script>', quantity: 2 }, { name: 'Coffee', quantity: 1 }],
    menu: 'Tea <script> (x2)\nCoffee (x1)',
    rowIndex: 2
  };

  assert(context.safeSlipUrl('https://drive.google.com/file/d/test'), 'Google Drive slip URLs are allowed');
  assert.strictEqual(context.safeSlipUrl('javascript:alert(1)'), '', 'unsafe slip URLs are rejected');

  context.renderOrders([order]);
  const cards = document.getElementById('orders-container').innerHTML;
  assert(cards.includes('พิมพ์ Bar'), 'KDS card exposes a manual Bar print button');
  assert(cards.includes('&lt;script&gt;'), 'order text is escaped in the KDS card');
  assert.strictEqual((cards.match(/menu-item-row/g) || []).length, 2, 'each item is rendered in its own row');
  assert(cards.indexOf('Tea &lt;script&gt;') < cards.indexOf('×2'), 'quantity follows the item name');
  assert(cards.includes('Alipay: ชำระที่ห้อง'), 'Alipay is not shown as a missing-slip order');
  assert(!cards.includes('ไม่มีสลิป'), 'Alipay does not show the missing-slip badge');

  context.printOrder(0);
  const ticket = document.getElementById('print-ticket').innerHTML;
  assert.strictEqual(printCalls, 1, 'manual print calls window.print once');
  assert(body.classList.contains('printing-order'), 'print mode is limited to the selected ticket');
  assert(ticket.includes('BAR ORDER COPY'), 'ticket is marked as a Bar copy');
  assert(ticket.includes('ห้อง/โต๊ะ</span><strong>101'), 'ticket includes room');
  assert(ticket.includes('Tea &lt;script&gt;'), 'ticket escapes item names');
  assert(ticket.includes('×2'), 'ticket includes item quantity');
  assert(ticket.includes('Coffee'), 'ticket includes every order item');
  assert.strictEqual(fetchCalls, 1, 'printing does not send another order to the API');

  listeners.afterprint();
  assert(!body.classList.contains('printing-order'), 'print mode is cleared after the dialog closes');
  assert.strictEqual(document.title, 'KDS Kitchen Display System', 'page title is restored after printing');
  assert.strictEqual(document.getElementById('print-ticket').innerHTML, '', 'ticket content is cleared after printing');

  context.renderOrders([{
    orderId: 'NEW-QR',
    room: '103',
    payment: 'Thai QR (PromptPay - slip attached)',
    menu: 'Soup (x1)',
    status: 'Pending'
  }]);
  assert(!document.getElementById('orders-container').innerHTML.includes('ไม่มีสลิป'), 'new API without a slip field does not falsely show a missing-slip warning');

  context.renderOrders([{
    orderId: 'OLD-1',
    room: '102',
    timestamp: '17:00',
    menu: 'Coffee (x1) [no sugar, oat milk], Tea (x2)',
    slip: '',
    status: 'Pending'
  }]);
  assert(document.getElementById('orders-container').innerHTML.includes('ไม่มีสลิป'), 'legacy API still warns when its slip field is empty');
  assert.strictEqual((document.getElementById('orders-container').innerHTML.match(/menu-item-row/g) || []).length, 2, 'legacy comma-separated menu text is split into rows');
  context.printOrder(0);
  assert(document.getElementById('print-ticket').innerHTML.includes('Coffee [no sugar, oat milk]'), 'legacy item notes stay together when split');
  assert(document.getElementById('print-ticket').innerHTML.includes('×2'), 'legacy item quantity prints separately');
  assert.strictEqual(printCalls, 2, 'each explicit click prints one ticket');

  context.renderOrders([{
    orderId: 'NEW-1',
    room: '104',
    menu: 'Soup (x1)',
    status: 'Pending',
    canCancel: false
  }]);
  assert(!document.getElementById('orders-container').innerHTML.includes('ยกเลิกเมนู'), 'orders not marked overdue cannot be cancelled');

  context.renderOrders([{
    orderId: 'OLD-OVERDUE',
    room: '105',
    menu: 'Soup (x1)',
    status: 'Pending',
    rowIndex: 12,
    canCancel: true,
    cancelReasonOptions: ['เกินกำหนดเวลาชำระเงิน']
  }]);
  assert(document.getElementById('orders-container').innerHTML.includes('ยกเลิกเมนู'), 'overdue pending orders expose the cancel action');
  confirmResult = false;
  const postCountBeforeDecline = requests.filter(request => request.options.method === 'POST').length;
  await context.cancelOrder(0);
  assert.strictEqual(confirmCalls, 1, 'cancellation requires confirmation');
  assert.strictEqual(requests.filter(request => request.options.method === 'POST').length, postCountBeforeDecline, 'declining confirmation sends no update');

  confirmResult = true;
  await context.cancelOrder(0);
  const cancelRequest = requests.findLast(request => request.options.method === 'POST');
  const cancelPayload = JSON.parse(cancelRequest.options.body);
  assert.strictEqual(cancelPayload.orderId, 'OLD-OVERDUE', 'cancellation targets the whole order');
  assert.strictEqual(cancelPayload.rowIndex, 12, 'row index is retained for legacy backends');
  assert.strictEqual(cancelPayload.status, 'Cancelled', 'cancellation updates the order status');
  assert.strictEqual(cancelPayload.reason, 'เกินกำหนดเวลาชำระเงิน', 'cancellation uses the backend-provided reason');
  assert(!document.getElementById('orders-container').innerHTML.includes('OLD-OVERDUE'), 'cancelled order disappears after refresh');

  context.renderOrders([
    { orderId: 'CANCELLED-1', room: '106', menu: 'Tea', status: 'Cancelled' },
    { orderId: 'DONE-1', room: '107', menu: 'Coffee', status: 'Completed' }
  ]);
  assert.strictEqual(document.getElementById('order-count').innerText, '0', 'completed and cancelled orders are removed from the active queue');

  const parsed = context.parseOrderTime('20/9/2026, 13:42:09');
  assert(parsed && parsed.getFullYear() === 2026 && parsed.getMonth() === 8 && parsed.getDate() === 20 && parsed.getHours() === 13, 'sheet timestamps are parsed');
  assert.strictEqual(context.parseOrderTime('26/11/2569, 9:05:00').getFullYear(), 2026, 'Buddhist-era years are converted');
  assert.strictEqual(context.parseOrderTime('-'), null, 'unparseable timestamps are ignored');
  const placed = new Date(Date.now() - 25 * 60000);
  const sheetTime = `${placed.getDate()}/${placed.getMonth() + 1}/${placed.getFullYear()}, ${placed.getHours()}:${String(placed.getMinutes()).padStart(2, '0')}:00`;
  context.renderOrders([{ orderId: 'LATE-1', room: '201', timestamp: sheetTime, menu: 'Soup (x1)', status: 'Pending' }]);
  assert(document.getElementById('orders-container').innerHTML.includes('level-late'), 'orders waiting 20+ minutes are flagged late');
  assert.strictEqual(document.getElementById('late-count').innerText, '1', 'late orders are counted in the header');

  context.renderOrders([{ orderId: 'OLDFMT', room: '101', menu: 'ปีกไก่ x 1, เฟรนช์ฟรายส์ (French Fries) x 2', status: 'Pending' }]);
  const oldFmt = document.getElementById('orders-container').innerHTML;
  assert.strictEqual((oldFmt.match(/menu-item-row/g) || []).length, 2, 'legacy "x 1" menu text is split into rows');
  assert(oldFmt.includes('item-en">French Fries'), 'English name is shown as a subtitle');
  assert(oldFmt.includes('×2'), 'legacy "x 2" quantity is shown');

  context.renderOrders([{ room: '2504 (Linda Nasse)', price: '1370', status: 'Pending',
    menu: 'โค้ก ซีโร่ (กระป๋อง)-Coke Zero (Can) (x2), Set A สปาเก็ตตี้ (Pasta Combo)-Chicken Pesto Spaghetti (Set A) (x1) [No onion, no garlic \nExtra spicy]' }]);
  const real = document.getElementById('orders-container').innerHTML;
  assert.strictEqual((real.match(/menu-item-row/g) || []).length, 2, 'notes with line breaks stay with their item');
  assert(real.includes('item-en">Coke Zero (Can)'), 'Thai-English dash names are split');
  assert(real.includes('No onion, no garlic Extra spicy'), 'multi-line note is joined');
  assert(real.includes('>2504</h2>') && real.includes('Linda Nasse'), 'room number and guest name are split');
  assert(real.includes('1,370'), 'price gets a thousands separator');

  // ---------- Single menu item cancellation ----------
  const itemOrder = {
    orderId: 'ITEM-1',
    room: '301',
    status: 'Pending',
    createdAt: new Date().toISOString(),
    rowIndex: 20,
    items: [
      { name: 'Soup', quantity: 1, rowIndex: 20, status: 'Pending', cancelReason: '' },
      { name: 'Salad', quantity: 2, rowIndex: 21, status: 'Pending', cancelReason: '' },
      { name: 'Juice', quantity: 1, rowIndex: 22, status: 'Cancelled', cancelReason: 'ลูกค้าไม่เอาแล้ว' }
    ]
  };
  context.renderOrders([itemOrder]);
  let itemHtml = document.getElementById('orders-container').innerHTML;
  assert.strictEqual((itemHtml.match(/cancelMenuItem\(/g) || []).length, 2, 'every pending item gets its own cancel button');
  assert(itemHtml.includes('is-cancelled'), 'cancelled items stay visible but struck through');
  assert(itemHtml.includes('ยกเลิก · ลูกค้าไม่เอาแล้ว'), 'cancelled item shows its reason');
  assert(itemHtml.includes('ยกเลิก 1 รายการ · ยอดยังไม่หักอัตโนมัติ'), 'card warns that the price is not reduced');
  context.printOrder(0);
  const itemTicket = document.getElementById('print-ticket').innerHTML;
  assert(!itemTicket.includes('Juice'), 'cancelled items are not printed on the Bar ticket');
  assert(itemTicket.includes('Salad'), 'active items are still printed');
  listeners.afterprint();

  context.renderOrders([{ orderId: '', room: '302', status: 'Pending', items: [{ name: 'Tea', quantity: 1, rowIndex: 30, status: 'Pending' }] }]);
  assert(!document.getElementById('orders-container').innerHTML.includes('cancelMenuItem('), 'items without an order id cannot be cancelled individually');

  context.renderOrders([itemOrder]);
  confirmResult = false;
  let postsBefore = requests.filter(request => request.options.method === 'POST').length;
  await context.cancelMenuItem(0, 1);
  assert.strictEqual(requests.filter(request => request.options.method === 'POST').length, postsBefore, 'declining item cancellation sends nothing');
  assert.strictEqual(promptCalls, 0, 'token is not requested before confirmation');

  confirmResult = true;
  await context.cancelMenuItem(0, 1);
  let itemRequest = requests.findLast(request => request.options.method === 'POST');
  let itemPayload = JSON.parse(itemRequest.options.body);
  assert.strictEqual(itemPayload.action, 'cancelItem', 'item cancellation uses the cancelItem action');
  assert.strictEqual(itemPayload.orderId, 'ITEM-1', 'item cancellation sends the order id');
  assert.strictEqual(itemPayload.rowIndex, 21, 'item cancellation targets the selected row');
  assert.strictEqual(itemPayload.token, 'secret-token', 'item cancellation sends the manager token');
  assert.strictEqual(promptCalls, 1, 'manager token is requested once');
  assert.strictEqual(storage.get('kds_action_token'), 'secret-token', 'manager token is remembered on this device');

  context.renderOrders([itemOrder]);
  nextPostResponse = { status: 'error', message: 'KDS authorization failed' };
  await context.cancelMenuItem(0, 0);
  assert.strictEqual(promptCalls, 1, 'stored token is reused');
  assert(!storage.has('kds_action_token'), 'rejected token is forgotten');
  assert(document.getElementById('connection-error').textContent.includes('รหัสผู้จัดการไม่ถูกต้อง'), 'authorization errors are shown in Thai');

  // ---------- Legacy single-row order cancellation ----------
  storage.set('kds_action_token', 'secret-token');
  const legacy = { room: '2504 (Linda Nasse)', price: '1370', status: 'Pending', rowIndex: 40,
    menu: 'Pizza (x1), Coke (x2)', items: [{ name: 'Pizza (x1), Coke (x2)', quantity: '', rowIndex: 40, status: 'Pending' }] };
  context.renderOrders([legacy]);
  const legacyHtml = document.getElementById('orders-container').innerHTML;
  assert(legacyHtml.includes('cancelLegacyOrder(0)'), 'legacy pending orders get a whole-order cancel button');
  assert.strictEqual((legacyHtml.match(/menu-item-row/g) || []).length, 2, 'legacy menu text is still split into rows');
  await context.cancelLegacyOrder(0);
  const legacyPayload = JSON.parse(requests.findLast(r => r.options.method === 'POST').options.body);
  assert.strictEqual(legacyPayload.action, 'cancelItem', 'legacy cancel uses cancelItem');
  assert.strictEqual(legacyPayload.rowIndex, 40, 'legacy cancel targets the order row');
  assert(!('orderId' in legacyPayload), 'legacy cancel sends no order id');
  context.renderOrders([Object.assign({}, legacy, { status: 'Completed' })]);
  assert(!document.getElementById('orders-container').innerHTML.includes('cancelLegacyOrder('), 'completed legacy orders cannot be cancelled');

  // ---------- Sales closing report ----------
  const todayKey = context.bangkokDateKey(new Date());
  context.renderOrders([itemOrder]);
  nextSummary = {
    date: todayKey, completedOrderCount: 5, pendingOrderCount: 1, cancelledOrderCount: 2,
    ordersWithoutAmount: 0, totalSales: 2450.5, paymentTotals: { 'Alipay (pay at room)': 1450.5, 'Pay at restaurant': 1000 },
    closed: false, closedAt: ''
  };
  await context.openSalesReport();
  let report = document.getElementById('sales-body').innerHTML;
  assert(requests.findLast(r => !r.options.method).url.includes(`action=getDailySalesSummary&date=${todayKey}`), 'report requests today in Bangkok time');
  assert(report.includes('฿2,450.5'), 'report shows total sales');
  assert(report.includes('Alipay (pay at room)') && report.includes('฿1,450.5'), 'report splits sales by payment method');
  assert(report.includes('ห้อง 301 · Juice'), 'report lists cancelled items of the day');
  assert(report.includes('ยังมีออเดอร์ค้าง 1 ออเดอร์'), 'report explains why closing is blocked');
  assert.strictEqual(document.getElementById('sales-close-btn').disabled, true, 'closing is disabled while orders are pending');

  nextSummary = Object.assign({}, nextSummary, { pendingOrderCount: 0 });
  await context.openSalesReport();
  assert.strictEqual(document.getElementById('sales-close-btn').disabled, false, 'closing is enabled once nothing is pending');

  confirmResult = false;
  postsBefore = requests.filter(request => request.options.method === 'POST').length;
  await context.confirmCloseSales();
  assert.strictEqual(requests.filter(request => request.options.method === 'POST').length, postsBefore, 'declining close sends nothing');

  confirmResult = true;
  promptResult = 'secret-token';
  nextPostResponse = { status: 'success', summary: Object.assign({}, nextSummary, { closed: true, closedAt: '2026-11-27T15:30:00.000Z' }) };
  await context.confirmCloseSales();
  const closeRequest = requests.findLast(request => request.options.method === 'POST');
  const closePayload = JSON.parse(closeRequest.options.body);
  assert.strictEqual(closePayload.action, 'closeDailySales', 'close uses the closeDailySales action');
  assert.strictEqual(closePayload.date, todayKey, 'close sends today date');
  assert.strictEqual(closePayload.token, 'secret-token', 'close sends the manager token');
  report = document.getElementById('sales-body').innerHTML;
  assert(report.includes('ปิดรอบแล้ว เวลา 22:30 น.'), 'closed time is shown in Bangkok time');
  assert.strictEqual(document.getElementById('sales-close-btn').disabled, true, 'a closed day cannot be closed again');
  assert.strictEqual(document.getElementById('close-shift-label').innerText, 'ปิดรอบแล้ว · ดูรายงาน', 'header shows the day is closed');

  const printsBefore = printCalls;
  context.printSalesReport();
  const reportTicket = document.getElementById('print-ticket').innerHTML;
  assert.strictEqual(printCalls, printsBefore + 1, 'report printing calls window.print once');
  assert(reportTicket.includes('SALES CLOSING REPORT') && reportTicket.includes('฿2,450.5'), 'printed report includes totals');
  listeners.afterprint();
  context.closeSalesModal();
  assert(document.getElementById('sales-modal').classList.contains('hidden'), 'report modal can be closed');

  assert.strictEqual(context.translateApiError('Cannot close sales while 3 order(s) are still pending'), 'ยังมีออเดอร์ค้าง 3 ออเดอร์ — กด "เสิร์ฟแล้ว" หรือยกเลิกให้ครบก่อนปิดรอบ', 'pending-close errors are translated');

  console.log('KDS print tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
