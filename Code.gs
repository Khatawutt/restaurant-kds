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