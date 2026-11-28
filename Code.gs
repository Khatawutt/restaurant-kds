/**
 * Restaurant KDS - Apps Script Backend
 * OrderSystem.gs - Monthly Sales Report & Closing
 * 
 * Deploy as Web App:
 *   - Execute as: Me
 *   - Who has access: Anyone
 */

const SHEET_ID = '1cqtqFcxvCM_l6aZpkscfP76ndsg5RyM7Qv92-Qmb_EU';
const SHEET_GID = '1306309405';
const KDS_ACTION_TOKEN_PROP = 'KDS_ACTION_TOKEN';
const SLIP_FOLDER_NAME = 'MANA In-Room Slips';
const SLIP_MAX_BYTES = 5 * 1024 * 1024;
const SLIP_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const CANCEL_REASON_OPTIONS = ['เกินกำหนดเวลาชำระเงิน'];
const PAYMENT_TIMEOUT_MS = 60 * 60 * 1000;
const DAILY_SALES_TIMEZONE = 'Asia/Bangkok';
const KDS_ITEM_CANCEL_REASON = 'ลูกค้าไม่เอาแล้ว';

function doGet(e) {
  const action = e.parameter.action;
  try {
    switch (action) {
      case 'getOrders':
        return handleGetOrders();
      case 'getDailySalesSummary':
        return handleGetDailySalesSummary(e.parameter.date);
      case 'getMonthlySalesSummary':
        return handleGetMonthlySalesSummary(parseInt(e.parameter.year), parseInt(e.parameter.month));
      default:
        return json({ status: 'error', message: 'unknown action: ' + action });
    }
  } catch (error) {
    return json({ status: 'error', message: error.toString() });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    switch (action) {
      case 'uploadOrder':
        return handleAppendOrder(data);
      case 'updateStatus':
        return handleUpdateStatus(data);
      case 'closeDailySales':
        return handleCloseDailySales(data);
      case 'closeMonthlySales':
        return handleCloseMonthlySales(data);
      case 'cancelItem':
        return handleCancelItem(data);
      default:
        return json({ status: 'error', message: 'unknown action: ' + action });
    }
  } catch (error) {
    return json({ status: 'error', message: error.toString() });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  return ss.getSheetByName('Orders') || ss.getSheets()[0];
}

function validateToken(token) {
  const props = PropertiesService.getScriptProperties();
  const expected = props.getProperty(KDS_ACTION_TOKEN_PROP);
  if (!expected) throw new Error('KDS_ACTION_TOKEN is not configured');
  if (token !== expected) throw new Error('KDS authorization failed');
  return true;
}

function parseOrderDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    let year = Number(m[3]);
    if (year > 2400) year -= 543;
    return new Date(year, Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return new Date(text);
  return null;
}

function bangkokDateKey(date) {
  const d = new Date(date.getTime() + 7 * 3600000);
  return d.toISOString().slice(0, 10);
}

function bangkokMonthKey(date) {
  const d = new Date(date.getTime() + 7 * 3600000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

function handleGetOrders() {
  const sheet = getSheet();
  const rows = sheet.getDataRange().getDisplayValues();
  if (rows.length <= 1) return json({ status: 'success', orders: [] });
  const headers = rows[0];
  const orders = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const order = {};
    for (let j = 0; j < headers.length; j++) order[headers[j]] = row[j] || '';
    order.rowIndex = i + 1;
    orders.push(order);
  }
  return json({ status: 'success', orders: orders });
}

function handleGetDailySalesSummary(dateKey) {
  const sheet = getSheet();
  const rows = sheet.getDataRange().getDisplayValues();
  if (rows.length <= 1) {
    return json({ status: 'success', summary: emptyDailySummary(dateKey) });
  }
  const headers = rows[0];
  const now = new Date();
  const targetDate = dateKey || bangkokDateKey(now);
  let totalSales = 0, completedCount = 0, cancelledCount = 0, pendingCount = 0, ordersWithoutAmount = 0;
  const paymentTotals = {};
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const order = {};
    for (let j = 0; j < headers.length; j++) order[headers[j]] = row[j] || '';
    const created = parseOrderDate(order.Timestamp || order.time || order.createdAt);
    if (!created) continue;
    if (bangkokDateKey(created) !== targetDate) continue;
    const status = String(order.Status || order.status || '').trim().toLowerCase();
    const amount = parseAmount(order.Price || order.price || order.amount || '0');
    if (status === 'completed') {
      completedCount++; totalSales += amount;
      const payment = String(order.Payment || order.payment || 'อื่นๆ').trim();
      paymentTotals[payment] = (paymentTotals[payment] || 0) + amount;
      if (!amount || amount <= 0) ordersWithoutAmount++;
    } else if (status === 'cancelled') {
      cancelledCount++;
    } else {
      pendingCount++;
    }
  }
  const props = PropertiesService.getScriptProperties();
  const closedKey = 'daily_closed_' + targetDate;
  const closedAt = props.getProperty(closedKey);
  const summary = {
    date: targetDate, totalSales: totalSales, completedOrderCount: completedCount,
    cancelledOrderCount: cancelledCount, pendingOrderCount: pendingCount,
    ordersWithoutAmount: ordersWithoutAmount, paymentTotals: paymentTotals,
    closed: !!closedAt, closedAt: closedAt || null
  };
  return json({ status: 'success', summary: summary });
}

function handleGetMonthlySalesSummary(year, month) {
  if (!year || !month) return json({ status: 'error', message: 'year and month required' });
  const sheet = getSheet();
  const rows = sheet.getDataRange().getDisplayValues();
  if (rows.length <= 1) {
    return json({ status: 'success', summary: emptyMonthlySummary(year, month) });
  }
  const headers = rows[0];
  const targetMonthKey = year + '-' + String(month).padStart(2, '0');
  let totalSales = 0, completedCount = 0, cancelledCount = 0, pendingCount = 0, ordersWithoutAmount = 0;
  const paymentTotals = {};
  const dailyBreakdown = {};
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const order = {};
    for (let j = 0; j < headers.length; j++) order[headers[j]] = row[j] || '';
    const created = parseOrderDate(order.Timestamp || order.time || order.createdAt);
    if (!created) continue;
    const createdBangkok = new Date(created.getTime() + 7 * 3600000);
    const createdKey = createdBangkok.getUTCFullYear() + '-' + String(createdBangkok.getUTCMonth() + 1).padStart(2, '0');
    if (createdKey !== targetMonthKey) continue;
    const status = String(order.Status || order.status || '').trim().toLowerCase();
    const amount = parseAmount(order.Price || order.price || order.amount || '0');
    const day = String(createdBangkok.getUTCDate()).padStart(2, '0');
    if (!dailyBreakdown[day]) dailyBreakdown[day] = { total: 0, completed: 0 };
    if (status === 'completed') {
      completedCount++; totalSales += amount;
      dailyBreakdown[day].total += amount; dailyBreakdown[day].completed += 1;
      const payment = String(order.Payment || order.payment || 'อื่นๆ').trim();
      paymentTotals[payment] = (paymentTotals[payment] || 0) + amount;
      if (!amount || amount <= 0) ordersWithoutAmount++;
    } else if (status === 'cancelled') {
      cancelledCount++;
    } else {
      pendingCount++;
    }
  }
  const dailyArray = Object.keys(dailyBreakdown).sort().map(day => ({
    day: day, total: dailyBreakdown[day].total, completed: dailyBreakdown[day].completed
  }));
  const props = PropertiesService.getScriptProperties();
  const closedKey = 'monthly_closed_' + targetMonthKey;
  const closedAt = props.getProperty(closedKey);
  const summary = {
    year: year, month: month, totalSales: totalSales, completedOrderCount: completedCount,
    cancelledOrderCount: cancelledCount, pendingOrderCount: pendingCount,
    ordersWithoutAmount: ordersWithoutAmount, paymentTotals: paymentTotals,
    dailyBreakdown: dailyArray, closed: !!closedAt, closedAt: closedAt || null
  };
  return json({ status: 'success', summary: summary });
}

function handleCloseDailySales(data) {
  validateToken(data.token);
  const dateKey = data.date;
  if (!dateKey) return json({ status: 'error', message: 'date required' });
  const sheet = getSheet();
  const rows = sheet.getDataRange().getDisplayValues();
  const headers = rows[0];
  let pendingCount = 0, ordersWithoutAmount = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const order = {};
    for (let j = 0; j < headers.length; j++) order[headers[j]] = row[j] || '';
    const created = parseOrderDate(order.Timestamp || order.time || order.createdAt);
    if (!created) continue;
    if (bangkokDateKey(created) !== dateKey) continue;
    const status = String(order.Status || order.status || '').trim().toLowerCase();
    const amount = parseAmount(order.Price || order.price || order.amount || '0');
    if (status === 'completed' && (!amount || amount <= 0)) ordersWithoutAmount++;
    else if (status !== 'completed' && status !== 'cancelled') pendingCount++;
  }
  if (pendingCount > 0) {
    return json({ status: 'error', message: 'Cannot close sales while ' + pendingCount + ' order(s) are pending' });
  }
  if (ordersWithoutAmount > 0) {
    return json({ status: 'error', message: ordersWithoutAmount + ' completed order(s) have no valid price' });
  }
  const props = PropertiesService.getScriptProperties();
  props.setProperty('daily_closed_' + dateKey, new Date().toISOString());
  const result = handleGetDailySalesSummary(dateKey);
  return json({ status: 'success', summary: JSON.parse(result.getContent()).summary });
}

function handleCloseMonthlySales(data) {
  validateToken(data.token);
  const year = parseInt(data.year);
  const month = parseInt(data.month);
  if (!year || !month) return json({ status: 'error', message: 'year and month required' });
  const targetMonthKey = year + '-' + String(month).padStart(2, '0');
  const sheet = getSheet();
  const rows = sheet.getDataRange().getDisplayValues();
  const headers = rows[0];
  let pendingCount = 0, ordersWithoutAmount = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const order = {};
    for (let j = 0; j < headers.length; j++) order[headers[j]] = row[j] || '';
    const created = parseOrderDate(order.Timestamp || order.time || order.createdAt);
    if (!created) continue;
    const createdBangkok = new Date(created.getTime() + 7 * 3600000);
    const createdKey = createdBangkok.getUTCFullYear() + '-' + String(createdBangkok.getUTCMonth() + 1).padStart(2, '0');
    if (createdKey !== targetMonthKey) continue;
    const status = String(order.Status || order.status || '').trim().toLowerCase();
    const amount = parseAmount(order.Price || order.price || order.amount || '0');
    if (status === 'completed' && (!amount || amount <= 0)) ordersWithoutAmount++;
    else if (status !== 'completed' && status !== 'cancelled') pendingCount++;
  }
  if (pendingCount > 0) {
    return json({ status: 'error', message: 'Cannot close sales while ' + pendingCount + ' order(s) are pending' });
  }
  if (ordersWithoutAmount > 0) {
    return json({ status: 'error', message: ordersWithoutAmount + ' completed order(s) have no valid price' });
  }
  const props = PropertiesService.getScriptProperties();
  props.setProperty('monthly_closed_' + targetMonthKey, new Date().toISOString());
  const result = handleGetMonthlySalesSummary(year, month);
  return json({ status: 'success', summary: JSON.parse(result.getContent()).summary });
}

function handleCancelItem(data) {
  validateToken(data.token);
  const rowIndex = parseInt(data.rowIndex);
  if (!rowIndex || rowIndex < 2) return json({ status: 'error', message: 'invalid rowIndex' });
  const sheet = getSheet();
  sheet.getRange(rowIndex, getColumnIndex(sheet, 'Status')).setValue('Cancelled');
  sheet.getRange(rowIndex, getColumnIndex(sheet, 'CancelReason')).setValue(data.reason || 'ลูกค้าไม่เอาแล้ว');
  return json({ status: 'success' });
}

function handleUpdateStatus(data) {
  validateToken(data.token);
  const rowIndex = data.rowIndex ? parseInt(data.rowIndex) : null;
  const orderId = data.orderId ? String(data.orderId) : null;
  const newStatus = data.status;
  const reason = data.reason || '';
  if (!newStatus) return json({ status: 'error', message: 'status required' });
  const sheet = getSheet();
  const rows = sheet.getDataRange().getDisplayValues();
  const headers = rows[0];
  const statusCol = getColumnIndex(sheet, 'Status');
  const reasonCol = getColumnIndex(sheet, 'CancelReason');
  let targetRow = null;
  if (rowIndex) {
    targetRow = rowIndex;
  } else if (orderId) {
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const order = {};
      for (let j = 0; j < headers.length; j++) order[headers[j]] = row[j] || '';
      if (String(order.OrderID || order.orderId || '') === orderId) {
        targetRow = i + 1; break;
      }
    }
  }
  if (!targetRow) return json({ status: 'error', message: 'order not found' });
  sheet.getRange(targetRow, statusCol).setValue(newStatus);
  if (reason && newStatus.toLowerCase() === 'cancelled') {
    sheet.getRange(targetRow, reasonCol).setValue(reason);
  }
  return json({ status: 'success' });
}

function parseAmount(value) {
  if (value == null || value === '') return 0;
  const text = String(value).replace(/,/g, '').replace(/฿/g, '').trim();
  const n = Number(text);
  return isNaN(n) ? 0 : n;
}

function getColumnIndex(sheet, headerName) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === headerName) return i + 1;
  }
  const newCol = headers.length + 1;
  sheet.getRange(1, newCol).setValue(headerName);
  return newCol;
}

function emptyDailySummary(dateKey) {
  return {
    date: dateKey, totalSales: 0, completedOrderCount: 0, cancelledOrderCount: 0,
    pendingOrderCount: 0, ordersWithoutAmount: 0, paymentTotals: {},
    closed: false, closedAt: null
  };
}

function emptyMonthlySummary(year, month) {
  return {
    year: year, month: month, totalSales: 0, completedOrderCount: 0,
    cancelledOrderCount: 0, pendingOrderCount: 0, ordersWithoutAmount: 0,
    paymentTotals: {}, dailyBreakdown: [], closed: false, closedAt: null
  };
}

/* ========== Order Creation & Slip Upload ========== */

function handleAppendOrder(data) {
  const sheet = getSheet();
  const props = PropertiesService.getScriptProperties();
  const closedKey = 'daily_closed_' + bangkokDateKey(new Date());
  if (props.getProperty(closedKey)) {
    throw new Error('Sales for today are closed; new orders are not being accepted');
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colMap = {};
  headers.forEach((h, i) => { colMap[String(h).trim()] = i + 1; });

  const orderId = String(data.orderId || Utilities.getUuid());
  const room = String(data.roomNumber || data.room || '').trim();
  const name = String(data.name || '').trim();
  if (!room) throw new Error('Room is required');

  const slipUrl = saveSlip_(data.slip, orderId);
  const now = new Date();
  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();

  const items = [];
  if (Array.isArray(data.items) && data.items.length) {
    data.items.forEach(item => {
      const n = String(item && (item.name || item.menu) || '').trim();
      const q = Number(item && (item.quantity == null ? item.qty : item.quantity));
      if (!n || !Number.isInteger(q) || q < 1) {
        throw new Error('Each item needs a name and a positive whole-number quantity');
      }
      items.push({ name: n, quantity: q });
    });
  } else {
    const menu = String(data.menu || '').trim();
    if (!menu) throw new Error('Order menu is required');
    items.push({ name: menu, quantity: '' });
  }

  items.forEach((item, index) => {
    const row = new Array(sheet.getLastColumn()).fill('');
    if (colMap['Timestamp'] != null) row[colMap['Timestamp'] - 1] = now;
    if (colMap['เวลา'] != null) row[colMap['เวลา'] - 1] = Utilities.formatDate(now, tz, 'HH:mm');
    if (colMap['Room'] != null) row[colMap['Room'] - 1] = room;
    if (colMap['ชื่อ'] != null) row[colMap['ชื่อ'] - 1] = name;
    if (colMap['Menu Details'] != null) row[colMap['Menu Details'] - 1] = item.name;
    if (colMap['จำนวน'] != null) row[colMap['จำนวน'] - 1] = item.quantity;
    if (colMap['Price'] != null) row[colMap['Price'] - 1] = index === 0 ? (data.price == null ? '' : data.price) : '';
    if (colMap['Status'] != null) row[colMap['Status'] - 1] = 'Pending';
    if (colMap['Payment'] != null) row[colMap['Payment'] - 1] = String(data.payment || data.paymentMethod || '');
    if (colMap['Order ID'] != null) row[colMap['Order ID'] - 1] = orderId;
    if (colMap['Cancel Reason'] != null) row[colMap['Cancel Reason'] - 1] = '';
    if (colMap['Slip'] != null) row[colMap['Slip'] - 1] = index === 0 ? slipUrl : '';
    sheet.appendRow(row);
  });
  return json({ status: 'success', orderId: orderId, slip: slipUrl ? 'saved' : 'none' });
}

function saveSlip_(slip, orderId) {
  if (!slip || !slip.data) return '';
  const mime = String(slip.mime || 'image/jpeg').toLowerCase();
  if (SLIP_MIME_TYPES.indexOf(mime) < 0) throw new Error('Slip must be a JPEG, PNG or WebP image');
  const bytes = Utilities.base64Decode(String(slip.data).replace(/^data:[^,]*,/, ''));
  if (!bytes || !bytes.length) throw new Error('Slip image is empty');
  if (bytes.length > SLIP_MAX_BYTES) throw new Error('Slip image is larger than 5 MB');
  const ext = mime === 'image/png' ? '.png' : (mime === 'image/webp' ? '.webp' : '.jpg');
  const safeId = String(orderId || 'slip-' + Date.now()).replace(/[^\w.-]/g, '_');
  const blob = Utilities.newBlob(bytes, mime, safeId + ext);
  const folders = DriveApp.getFoldersByName(SLIP_FOLDER_NAME);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(SLIP_FOLDER_NAME);
  return folder.createFile(blob).getUrl();
}