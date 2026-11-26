# Restaurant KDS

Kitchen display for in-room dining orders.

## Bar printer

- Select **พิมพ์ Bar** on an order card to print one copy of that order.
- In the browser print dialog, select the Bar printer installed on the KDS computer.
- Printing is manual; the 5-second order refresh does not print duplicate tickets.
- Paper size and margins follow the printer driver settings on the KDS computer.
- **ยกเลิกเมนู** appears only when the order API marks a pending order as older than one hour. It asks for confirmation, records the API-provided cancellation reason, then removes the cancelled order from the active queue.

Run the local print behavior checks with `node test_kds_print.js`.
