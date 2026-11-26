# Smerp behaviour reference

This describes the current application's rules. For step-by-step use, see the [workshop guide](../README.md).

## Records

| Record | Contains |
| --- | --- |
| Supplier | Name, contact details and delivery time in business days. |
| Material | Unit, supplier, purchase-pack quantity/price, stock, optional warning level and barcodes. |
| Product | Name, minutes per unit, material recipe, finished stock and optional warning level. |
| Order | Customer details, optional requested date, product quantities, agreed prices, status and saved confirmation details. |
| Stock movement | Time, item, signed quantity, unit and reason. |
| Settings | Workshop title/subtitle, currency and hourly rate. |
| Work schedule | Hours for each day of the week and individual dates off. |

Materials support fractional quantities. Finished products and ordered quantities use whole numbers. Referenced suppliers, materials and products cannot be deleted while those references remain.

## Prices

- Material cost is the quantity used multiplied by the purchase-pack price divided by its quantity.
- Labour cost is minutes per unit multiplied by the hourly rate divided by 60.
- Minimum selling price is the combined cost, rounded upward once to the next cent. Exact fractional costs must not introduce an extra cent.
- Selling prices are entered on order lines. Profit, tax, postage and other overhead are not added automatically.
- Confirmation saves the recipe, production time, material prices, hourly rate and currency. Subsequent edits to products or settings do not alter the confirmed order's saved costs.
- Purchase suggestions use current purchase prices. Changing the currency label does not convert amounts.

## Order lifecycle

| Status | Behaviour |
| --- | --- |
| Pending | Editable estimate; reserves no stock. |
| Confirmed | Saves the agreed details and reserves available finished products and materials. |
| In progress | At least one production batch has been recorded for the order. |
| Completed | The entire order has been handed over and its finished items deducted from stock. |
| Cancelled | Unused reservations are released; past physical stock changes remain. |

Existing available finished goods are used before calculating what remains to be made. A production batch consumes the order's saved recipe, increases finished stock and reserves the units for that order. Partial batches are allowed; quantities above the outstanding amount are rejected.

Finished stock added after confirmation can fulfil an order through **Complete and hand over**. The action uses stock for the selected order and requires enough available units for all its outstanding lines.

Deleting an order releases its reservations and removes the order. It does not undo production, return handed-over products or erase stock movements.

## Materials and reservations

An individual order's material sufficiency uses physical stock with that order considered in isolation. **Overview → Materials → Total** combines all open orders and counts shared stock once. With 10 m and two orders needing 6 m each, each isolated result is sufficient and the combined result is 2 m short.

The combined view excludes finished units used to fulfil the orders and units already produced. It retains different cut quantities alongside the total requirement. Completed and cancelled orders are excluded.

Reservations protect confirmed work. Production for one order cannot consume materials held for another; general-stock production can use only unreserved material. Confirmed orders allocate materials in confirmation order. Displayed isolated sufficiency does not override these protections.

Inventory distinguishes physical **On shelf**, **Reserved**, and **Available** stock. Low-stock warnings use available quantities. A count correction replaces the physical total and cannot reduce stock below reservations. Receiving adds stock; production consumes recipes and adds finished goods; handover deducts finished goods.

## Purchasing and scheduling

Missing materials round up to whole supplier purchase packs. Arrival assumes an order is placed today and counts the supplier's Monday–Friday lead time. Smerp suggests purchases; it does not place them.

Completion uses the remaining production minutes, material arrival, daily working hours, dates off and confirmed workload. Confirmed orders share a calendar in confirmation order. Each pending order gets a separate estimate after that committed work. The full configured capacity for today is available to the estimate; time already elapsed today is not deducted.

Finished goods needing no production can be ready without scheduled working hours. An order requiring work cannot receive a completion estimate when all daily hours are zero. Current dates come from the host computer's system clock and local time zone.

## Receiving and barcodes

A delivery can contain several existing or newly created materials. Quantities and barcode assignments are staged together; no stock changes until **Save received materials** succeeds. An invalid row rejects the entire delivery. Retrying a successfully saved delivery does not receive it twice.

Materials can have several EAN-13, EAN-8, UPC-A, UPC-E or QR codes. Numeric codes require valid lengths and check digits; equivalent UPC/EAN representations identify the same supply. A barcode can belong to only one material. QR contents are literal identifiers, not links to open.

Camera scanning and manual entry use the same delivery workflow. Repeated frames are suppressed; the user starts scanning again to deliberately enter the same code twice.

## Saving and recovery

Changes are validated and saved before becoming visible. Failed writes, invalid actions and invalid restore files leave saved data intact. An older form cannot overwrite newer changes; its user must review the latest values.

Backups contain the complete workshop. Restore validates and previews the file before an explicit full replacement. A damaged working file opens recovery, offers its original contents for download and accepts a valid replacement backup. Workshop files and backups are limited to 10 MB.

## Code and checks

- [workshop.go](../workshop.go): records, validation and costing.
- [inventory.go](../inventory.go): stock operations and order transitions.
- [estimates.go](../estimates.go): material summaries, purchasing and scheduling.
- [persistence.go](../persistence.go): saving, backup validation and recovery.
- [web.go](../web.go), [forms.go](../forms.go), [view.go](../view.go) and [templates](../templates/): interface and request handling.
- [workshop_test.go](../workshop_test.go), [web_test.go](../web_test.go) and [window_test.go](../window_test.go): behavioural and interface checks.
