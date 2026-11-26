# Restaurant KDS

Kitchen display for in-room dining orders.

## Bar printer

- Select **พิมพ์ Bar** on an order card to print one copy of that order.
- In the browser print dialog, select the Bar printer installed on the KDS computer.
- Printing is manual; the 5-second order refresh does not print duplicate tickets.
- Paper size and margins follow the printer driver settings on the KDS computer.
- **ยกเลิกเมนู** appears only when the order API marks a pending order as older than one hour. It asks for confirmation, records the API-provided cancellation reason, then removes the cancelled order from the active queue.
- **ยกเลิกรายการ** appears beside each pending item when the API provides its sheet row index. It confirms the customer no longer wants the item, records **ลูกค้าไม่เอาแล้ว** against that item only, and does not recalculate the order's total or issue a refund automatically.
- Order items are shown one per row with the quantity aligned at the right; legacy comma-separated menu text is split into item rows when it includes quantities.

## Daily sales close

- **สรุปยอดวันนี้** totals orders marked Completed, excluding fully cancelled orders, and groups totals by payment method using Bangkok time.
- **ปิดรอบวันนี้** saves an immutable daily snapshot to the `Daily Sales Closing` sheet. Closing is blocked while today's orders are pending or a completed order has no valid price; after closing, new orders for that day are rejected.
- Sales totals use the order-level price already stored in the sheet. Cancelling one item in KDS does not automatically change the bill or issue a refund.

Before using item cancellation or daily close, set a private `KDS_ACTION_TOKEN` in the Apps Script project's Script Properties, then deploy the updated `apps-script/OrderSystem.gs` from `Khatawutt/in-room-express-grab-go` as a new version of the existing web app. Enter that token when the KDS prompts before either change. Do not put it in the public KDS page or repository. These actions will not work until the Apps Script deployment is updated.

Run the local KDS checks with `node test_kds_print.js`.
