# Restaurant KDS

Kitchen display for in-room dining orders.

## Bar printer

- Select **พิมพ์ Bar** on an order card to print one copy of that order.
- In the browser print dialog, select the Bar printer installed on the KDS computer.
- Printing is manual; the 5-second order refresh does not print duplicate tickets.
- Paper size and margins follow the printer driver settings on the KDS computer.
- **ยกเลิกเมนู** appears only when the order API marks a pending order as older than one hour. It asks for confirmation, records the API-provided cancellation reason, then removes the cancelled order from the active queue.
- Order items are shown one per row with the quantity aligned at the right; legacy comma-separated menu text is split into item rows when it includes quantities.

Run the local print behavior checks with `node test_kds_print.js`.

## Display

- MANA Ratchayothin night theme (Taviraj / Noto Sans Thai, champagne gold on dark brown).
- Each card shows a live wait timer from the order time; the top edge turns green (under 10 min), amber (10–20 min) or red (over 20 min). Thresholds are `WARN_MINUTES` / `LATE_MINUTES` in `index.html`.
- Item notes in `[brackets]` show as a gold sub-line; quantities over 1 are highlighted.
- The header shows the clock, open-order count and longest wait; **เต็มจอ** switches to full screen for the kitchen tablet.
