# Restaurant KDS

Kitchen display for in-room dining orders.

## Bar printer

- Select **พิมพ์ Bar** on an order card to print one copy of that order.
- In the browser print dialog, select the Bar printer installed on the KDS computer.
- Printing is manual; the 5-second order refresh does not print duplicate tickets.
- Paper size and margins follow the printer driver settings on the KDS computer.
- **ยกเลิกเมนู** appears only when the order API marks a pending order as older than one hour. It asks for confirmation, records the API-provided cancellation reason, then removes the cancelled order from the active queue.
- Order items are shown one per row with the quantity aligned at the right; legacy comma-separated menu text is split into item rows when it includes quantities.

## ยกเลิกรายการลูกค้า (รายเมนู)

- ทุกเมนูที่ยัง `Pending` มีปุ่ม **✕ ยกเลิก** ท้ายแถว → ยืนยัน → ส่ง `POST {action:"cancelItem", orderId, rowIndex, token}` และบันทึกเหตุผล `ลูกค้าไม่เอาแล้ว`
- เมนูที่ยกเลิกแล้วยังแสดงในการ์ด (ขีดฆ่า + เหตุผล) และไม่ถูกพิมพ์ในใบ Bar; ถ้ายกเลิกรายการสุดท้าย ออเดอร์จะถูกยกเลิกทั้งออเดอร์
- ราคาไม่ถูกหักอัตโนมัติ — การ์ดแสดงคำเตือน "ยอดยังไม่หักอัตโนมัติ"

## ปิดรอบการขาย - สรุปรายงาน

- ปุ่ม **ปิดรอบการขาย** บนแถบด้านบนเปิดหน้าสรุป (`GET ?action=getDailySalesSummary&date=YYYY-MM-DD` ตามเวลาไทย): ยอดขายรวม, แยกช่องทางชำระเงิน, จำนวนออเดอร์สำเร็จ/ยกเลิก/ค้าง/ไม่มีราคา และรายการที่ถูกยกเลิกของวันนั้น
- **ยืนยันปิดรอบ** กดได้เมื่อไม่มีออเดอร์ค้างและทุกออเดอร์มีราคา → `POST {action:"closeDailySales", date, token}`; หลังปิด ระบบไม่รับออเดอร์ใหม่ของวันนั้น
- **พิมพ์รายงาน** พิมพ์สรุปผ่านเครื่องพิมพ์เดียวกับใบ Bar พร้อมช่องลงชื่อผู้ปิดรอบ

## รหัสผู้จัดการ (KDS Action Token)

การยกเลิกรายเมนูและการปิดรอบต้องใช้ค่า Script Property `KDS_ACTION_TOKEN` ของ Apps Script (`OrderSystem.gs` ใน repo in-room-express-grab-go) รหัสนี้ **ไม่ถูกเก็บในซอร์ส** — เครื่อง KDS จะถามรหัสครั้งแรกแล้วจำไว้ใน localStorage ของเครื่องนั้น ถ้ารหัสผิด ระบบจะลบรหัสที่จำไว้และถามใหม่ครั้งถัดไป

Run the local print behavior checks with `node test_kds_print.js`.
