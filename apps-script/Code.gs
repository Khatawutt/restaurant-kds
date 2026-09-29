// Apps Script กลางของระบบ In-Room Dining
// - หน้าสั่งอาหาร (in-room-express-grab-go) → POST ออเดอร์ใหม่
// - หน้าจอครัว (restaurant-kds)            → GET ?action=getOrders / POST action=updateStatus
// วิธีติดตั้ง: Apps Script → วางไฟล์นี้แทนโค้ดเดิม → บันทึก
// แล้ว Deploy → Manage deployments → Edit → Version: New version → Deploy (URL เดิมไม่เปลี่ยน)

const SPREADSHEET_ID = '1cqtqFcxvCM_l6aZpkscfP76ndsg5RyM7Qv92-Qmb_EU'; // ไฟล์ Sheets ออเดอร์
const SHEET_GID = 1306309405; // แท็บเก็บออเดอร์ (gid จากลิงก์ Sheets)
const HEADERS = ['Timestamp', 'Room', 'Menu', 'Price', 'Status', 'OrderID', 'Slip', 'Payment'];
const SLIP_FOLDER_NAME = 'MANA In-Room Slips'; // โฟลเดอร์ใน Google Drive ที่เก็บรูปสลิป (สร้างให้อัตโนมัติ)

function getSheet() {
  // เปิดด้วย ID เพื่อให้ทำงานได้ทั้งกรณีสร้างสคริปต์จากใน Sheets และสร้างแยกที่ script.google.com
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheets().find(s => s.getSheetId() === SHEET_GID) || ss.getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  // ชีตเดิมมีแค่ 5 คอลัมน์ → เติมหัวคอลัมน์ OrderID / Slip / Payment ให้ครั้งแรก
  else if (!sheet.getRange(1, HEADERS.length).getValue()) sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  return sheet;
}

// เก็บรูปสลิปลง Drive แล้วคืนลิงก์ — ไฟล์เป็นส่วนตัว เปิดได้เฉพาะบัญชี Google เจ้าของ Drive
// (ไม่เปิดแชร์สาธารณะ เพราะสลิปมีข้อมูลบัญชีของแขก และ URL ระบบนี้อยู่ในหน้าเว็บสาธารณะ)
function saveSlip(slip, orderId) {
  if (!slip || !slip.data) return '';
  const folders = DriveApp.getFoldersByName(SLIP_FOLDER_NAME);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(SLIP_FOLDER_NAME);
  const blob = Utilities.newBlob(Utilities.base64Decode(slip.data), slip.mime || 'image/jpeg', (orderId || 'slip-' + Date.now()) + '.jpg');
  return folder.createFile(blob).getUrl();
}

function doGet(e) {
  try {
    if (e && e.parameter && e.parameter.action === 'getOrders') {
      const rows = getSheet().getDataRange().getDisplayValues().slice(1);
      const orders = rows.map((r, i) => ({
        timestamp: r[0], room: r[1], menu: r[2], price: r[3], status: r[4],
        orderId: r[5] || '', slip: r[6] || '', payment: r[7] || '',
        rowIndex: i + 2
      })).filter(o => o.menu);
      return json({ status: 'success', orders });
    }
    // เปิด URL /exec ในเบราว์เซอร์เพื่อเช็กว่าสคริปต์ทำงานและเจอแท็บถูกต้อง
    return json({ status: 'success', message: 'KDS backend OK', sheet: getSheet().getName() });
  } catch (err) {
    return json({ status: 'error', message: String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    if (!e || !e.postData) return json({ status: 'error', message: 'no data' });
    const data = JSON.parse(e.postData.contents);
    const sheet = getSheet();
    if (data.action === 'updateStatus') {
      sheet.getRange(data.rowIndex, 5).setValue(data.status);
    } else {
      const slipUrl = saveSlip(data.slip, data.orderId);
      sheet.appendRow([new Date(), data.room, data.menu, data.price, 'Pending',
        data.orderId || '', slipUrl, data.payment || '']);
      return json({ status: 'success', orderId: data.orderId || '', slip: slipUrl ? 'saved' : 'none' });
    }
    return json({ status: 'success' });
  } catch (err) {
    // ส่ง error กลับเป็น JSON เพื่อให้หน้าเว็บแสดงสาเหตุได้ แทนที่จะขึ้น Failed to fetch
    return json({ status: 'error', message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// รันฟังก์ชันนี้ 1 ครั้งจากในหน้า Apps Script (เลือก testSetup แล้วกด ▶ Run)
// เพื่อกดอนุญาตสิทธิ์ และเช็กว่าเขียนลง Sheets ได้จริง
function testSetup() {
  const sheet = getSheet();
  sheet.appendRow([new Date(), 'TEST', 'ทดสอบระบบ (ลบแถวนี้ได้)', 0, 'Completed']);
  // ทดสอบสิทธิ์ Google Drive สำหรับเก็บสลิป (จะมีหน้าต่างขออนุญาต Drive เพิ่ม — กดอนุญาต)
  const it = DriveApp.getFoldersByName(SLIP_FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(SLIP_FOLDER_NAME);
  Logger.log('OK: เขียนลงแท็บ ' + sheet.getName() + ' | โฟลเดอร์สลิป: ' + folder.getUrl());
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
