// Apps Script กลางของระบบ In-Room Dining
// - หน้าสั่งอาหาร (in-room-express-grab-go) → POST ออเดอร์ใหม่
// - หน้าจอครัว (restaurant-kds)            → GET ?action=getOrders / POST action=updateStatus
// วิธีติดตั้ง: เปิด Google Sheets ออเดอร์ → ส่วนขยาย → Apps Script → วางไฟล์นี้แทนโค้ดเดิม
// แล้ว Deploy → Manage deployments → Edit → Version: New version (ห้ามกด New deployment)

const SHEET_GID = 1306309405; // แท็บเก็บออเดอร์ (gid จากลิงก์ Sheets)
const HEADERS = ['Timestamp', 'Room', 'Menu', 'Price', 'Status'];

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheets().find(s => s.getSheetId() === SHEET_GID) || ss.getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  return sheet;
}

function doGet(e) {
  if (e.parameter.action === 'getOrders') {
    const rows = getSheet().getDataRange().getDisplayValues().slice(1);
    const orders = rows.map((r, i) => ({
      timestamp: r[0], room: r[1], menu: r[2], price: r[3], status: r[4],
      rowIndex: i + 2
    })).filter(o => o.menu);
    return json({ status: 'success', orders });
  }
  return json({ status: 'error', message: 'unknown action' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = getSheet();
    if (data.action === 'updateStatus') {
      sheet.getRange(data.rowIndex, 5).setValue(data.status);
    } else {
      sheet.appendRow([new Date(), data.room, data.menu, data.price, 'Pending']);
    }
    return json({ status: 'success' });
  } finally {
    lock.releaseLock();
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
