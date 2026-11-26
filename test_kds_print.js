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
  addEventListener(name, callback) { listeners[name] = callback; }
};
const context = vm.createContext({
  document,
  window,
  console,
  URL,
  fetch: async (url, options = {}) => {
    fetchCalls += 1;
    requests.push({ url, options });
    const body = options.method === 'POST'
      ? { status: 'success' }
      : { status: 'success', orders: [] };
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
    items: [{ name: 'Tea <script>', quantity: 2 }],
    menu: 'Tea <script> (x2)',
    rowIndex: 2
  };

  assert(context.safeSlipUrl('https://drive.google.com/file/d/test'), 'Google Drive slip URLs are allowed');
  assert.strictEqual(context.safeSlipUrl('javascript:alert(1)'), '', 'unsafe slip URLs are rejected');

  context.renderOrders([order]);
  const cards = document.getElementById('orders-container').innerHTML;
  assert(cards.includes('พิมพ์ Bar'), 'KDS card exposes a manual Bar print button');
  assert(cards.includes('&lt;script&gt;'), 'order text is escaped in the KDS card');
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
    menu: 'Coffee (x1)\nTea (x2)',
    slip: '',
    status: 'Pending'
  }]);
  assert(document.getElementById('orders-container').innerHTML.includes('ไม่มีสลิป'), 'legacy API still warns when its slip field is empty');
  context.printOrder(0);
  assert(document.getElementById('print-ticket').innerHTML.includes('Coffee (x1)<br>Tea (x2)'), 'legacy menu text prints as separate lines');
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
  assert.strictEqual(document.getElementById('order-count').innerText, 'ออเดอร์ค้าง: 0', 'completed and cancelled orders are removed from the active queue');

  console.log('KDS print tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
