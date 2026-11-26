# Smerp behaviour map

Status: working draft, started 2026-11-26. This is a specification exercise for a new Go backend. No application implementation has started.

## 1. How to read this map

- **Confirmed** means explicitly decided with the owner in this discussion.
- **Observed** means found in the current source or its tests. It is evidence of existing behaviour, not automatic approval of every detail for the new application.
- **Open** means the expected behaviour still needs an answer. Do not choose an answer while implementing.
- When a confirmed decision differs from observed behaviour, the difference is stated explicitly.

The map describes user actions, results, calculations, and the interface contract. It does not prescribe Go packages, libraries, file layout, or a translation of the TypeScript implementation.

Evidence comes from source and test inspection. The running application has not been exercised for this mapping pass, and the tests have been read rather than run. Examples below use synthetic quantities, not workshop records.

## 2. Confirmed direction

| ID | Decision |
| --- | --- |
| D01 | Build a new backend in Go from an agreed behaviour specification. Do not mechanically translate or migrate the JS/TS files into Go. |
| D02 | Keep the existing HTML/CSS/JavaScript frontend, appearance, navigation, and interactions. No UI redesign. |
| D03 | One person manages the application. Multiuser operation and concurrency features are not requirements. |
| D04 | Store workshop data in a single local JSON file. No SQLite or separate database service. |
| D05 | Current platform targets are Windows, macOS, and Linux. |
| D06 | An independently running Android installation is an eventual possibility, outside the current implementation scope. |
| D07 | Map behaviour and resolve expectations before building the Go application. Ask the owner when the intended result is unclear. |
| D08 | Individual order views evaluate material sufficiency for that order in isolation. The aggregate view evaluates all orders together and exposes combined shortages. |
| D09 | Confirming an order reserves its available materials for that order. Production for another order cannot consume those reserved materials. |
| D10 | Finished products added to stock after order confirmation can be used to fulfil that order without recording additional production. |
| D11 | Do not implement backward compatibility or data migrations. Supporting existing Node working files, earlier backups, and legacy formats is not required. |
| D12 | Support both browser mode and a dedicated application window on Windows, macOS, and Linux. Both use the same Go backend, HTML/CSS/JavaScript interface, and workshop data. |
| D13 | Browser mode must allow access from other devices, not only the computer running Smerp. This remains a single-user application. |
| D14 | Block saving an older form when it would overwrite a newer saved change. Single-user use from multiple devices must not silently lose newer data. |
| D15 | Use the backend host's system clock and local time zone for current dates and scheduling. Do not add a separate workshop time-zone setting or hardcode a region. |

### D08: individual and aggregate material views

The owner clarified that these views answer different questions:

- **Individual:** do we have enough material for this order by itself?
- **Aggregate:** do we have enough material for all these orders together?

Confirmed examples:

| Stock | Orders | Individual results | Aggregate result |
| --- | --- | --- | --- |
| 10 m fabric | A needs 3 m; B needs 20 m | A can be completed; B cannot. | Combined requirement is 23 m, so the combined shortage is 13 m. |
| 10 m fabric | A needs 6 m; B needs 6 m | Both individually have sufficient fabric. | Combined requirement is 12 m, so 2 m is missing. |

This decision describes displayed material sufficiency. D09 separately governs actual reservations and permission to use those materials for another order.

### D09: material reservations

The owner confirmed that an order's available materials are reserved when it is confirmed, preventing another order from consuming them.

Keep the two rules distinct: an individual view can show that physical stock is sufficient for an order in isolation (D08), while production cannot use materials reserved for a different order (D09). This confirmation does not decide any additional allocation-priority or reassignment rules.

### D10: finished stock added after confirmation

Confirmed example: an order for four shirts is confirmed when there are no finished shirts in stock. Four finished shirts are later added to inventory separately from that order. Those shirts can fulfil the order; the application must not require another four to be made.

The requirement is to let available finished stock fulfil an existing order. Automatic distribution of new stock across orders and a new priority mechanism have not been requested; do not introduce them as requirements.

### D11: no backward compatibility or migrations

The owner explicitly ruled out backward-compatibility and migration work. Do not add legacy readers, conversion tools, migration steps, or fallback fields to support old data. The Go application still needs its own backup/restore behaviour; its data representation is not dictated by the old files. Keeping the agreed frontend is a separate requirement under D02.

### D12: browser and application-window modes

The owner chose both launch/display modes for the current desktop scope:

- Browser mode opens the interface in the user's normal web browser.
- Application-window mode opens the same interface in a dedicated window using a system WebView.

Use shared business logic, interface, and workshop data rather than two separate applications. This decision does not select a window toolkit, installer, default launch mode, or process lifetime. D13 confirms access from other devices.

### D13: browser access from other devices

The owner confirmed that other devices must be able to access the running application through a browser. The desktop host runs the Go backend and holds the JSON data; those devices use its interface. This does not change the single-user requirement or bring independent Android installation into the current scope.

The specific network configuration, including whether/how to provide access beyond the local network, has not been selected by this answer.

### D14: protect newer changes from older forms

Confirmed example: a record's edit form remains open on the computer, then the owner changes that record from a phone. Saving the older computer form must be blocked rather than overwriting the newer change.

This confirms the stale-save protection outcome. The existing frontend's review/error behaviour remains the reference; the Go implementation's revision-token or change-detection mechanism has not been prescribed.

### D15: system time

The owner specified system time, whatever it is. The computer running the Go backend supplies the clock and local time zone used to determine today, date-stamp actions and backups, and calculate schedules. A browser on another device uses the backend's results. The old configured workshop time zone and fixed Europe/Athens fallback are not requirements for the new application.

## 3. Application purpose and records

Observed purpose: manage a small workshop's supplies, product recipes, customer orders, inventory, costs, and production estimates.

### Records and relationships

| Record | Information currently stored | Relationships and meaning |
| --- | --- | --- |
| Workshop settings | Title, subtitle, hourly rate, currency | Used in page branding and current product costing. |
| Work schedule | Seven daily working-hour values, dates off | Monday through Sunday; used to estimate completion. |
| Supplier | ID, name, contact details, delivery lead days | One supplier can supply several materials. |
| Material | ID, name, measurement unit, purchase-pack quantity and price, supplier, physical stock, optional warning threshold, barcodes | Each material currently has one supplier. Quantities can be fractional. |
| Product | ID, name, minutes per unit, recipe, physical stock, optional warning threshold | Recipe lists materials and quantities per finished unit. Finished units are whole numbers. |
| Order | ID, customer name/contact, requested date, creation date, status, confirmation timestamp, saved currency, lines | Customer details are stored on the order; there is no separate customer directory. |
| Order line | Product, ordered count, agreed unit price, optional saved quote, units reserved from stock, units produced | One line per product in an order. |
| Saved quote | Product name, minutes, hourly rate, recipe quantities, material pack quantities and prices | Captures costing and recipe information when an order is confirmed. Material IDs still reference material records. |
| Stock movement | ID, timestamp, item name, signed quantity, unit, reason | Records physical inventory changes, not reservations. No separate movement-editing interface. |
| Data envelope | Format, version, settings, schedule, suppliers, materials, products, orders, movements | Current working data and backups use the same record structure. |

Evidence: [model.ts](src/model.ts), especially the record definitions, `quote`, and `normalize`.

### Existing defaults — observed

- Empty supplier, material, product, order, and movement lists.
- Title `Workspace`; subtitle `Production planning`; hourly rate `15`; currency `EUR`.
- Four working hours Monday–Friday; zero Saturday/Sunday; no dates off.
- Local configuration: `127.0.0.1:3210`, workshop time zone `Europe/Athens`, data path `data/smerp.json`.
- A missing working file represents an empty workshop; the file is created on the first successful save.

These are the current defaults, not newly selected installation defaults for the Go application.

## 4. Screens and navigation — observed

| Screen | What the user sees and does |
| --- | --- |
| Overview | Materials in Total and Per order tabs; setup guidance; open-order counts; remaining committed work; blocked, late, and ready counts; orders to finish; low-stock warnings. |
| Suppliers | Contacts, business-day delivery times, material counts; add/edit/delete. |
| Materials | Available stock, unit cost, purchase packs, supplier/lead time, thresholds; add/edit/delete; link to receiving. |
| Products | Recipes, available finished units, material/labour costs, minimum prices, thresholds; add/edit/delete. |
| Orders | Open orders first, then closed orders; requested dates, estimates, shortages, value, next action. |
| Order detail | Customer/contact, status, prices, production counts, material needs, purchases, arrival/completion estimates, permitted actions. |
| Inventory | Physical, reserved, and available stock; receive, correct count, produce; latest 30 stock movements. |
| Received materials | Camera/manual barcode lookup or material selection; staged delivery rows; quantity review; one save for the delivery. |
| Work schedule | Daily working hours and dates off. |
| Settings dialog | Workshop title/subtitle, hourly rate, currency, backup download and restore. |
| Recovery page | Error about unreadable data; download existing file; restore a valid backup. |

UI behaviours to retain under D02 include the existing light/dark themes, responsive layouts, navigation, accessible labels, tab keyboard handling, dialogs, form fields, and validation feedback. Theme choice is stored in the browser, separately from workshop data; initial choice follows the device when no saved choice exists.

Current list ordering:

- Suppliers and products: alphabetical by name.
- Materials: low stock first, then alphabetical.
- Orders: open before closed, then requested date, then newest creation date.
- Overview orders: open orders by requested date.
- Inventory: stored item order; stock history shows the latest 30 entries newest first.

Evidence: [views.ts](src/views.ts), [editors.ts](src/editors.ts), [receiving-view.ts](src/receiving-view.ts), [client.ts](src/client.ts), [style.css](public/style.css), [theme.js](public/theme.js).

## 5. Setup and record maintenance — observed

### Suppliers

- Add/edit a name, optional contact text, and delivery lead time in business days.
- Lead time is a whole number from 0 to 365; the add form defaults to 5.
- Editing preserves the supplier ID and material links.
- A supplier referenced by a material cannot be deleted.

### Materials

- Creating a material requires an existing supplier.
- Enter name, free-text measurement unit, supplier, quantity per purchase pack, price per pack, optional stock threshold, and zero or more barcodes.
- Purchase quantity must be greater than zero; price can be zero.
- A new material starts with zero stock. Its editor does not set stock; inventory actions do.
- Editing preserves stock. Changing the unit changes its label; quantities are not converted.
- Blank threshold disables warnings. Warnings use available stock and trigger strictly below the threshold.
- Multiple barcodes can belong to one material; the same barcode identity cannot belong to different materials.
- Deletion requires zero stock and no references from product recipes or saved order recipes.

### Products

- Creating a product requires existing materials.
- Enter name, minutes per unit, one or more recipe materials with positive quantities, and an optional whole-unit stock threshold.
- A recipe cannot list the same material twice.
- Minutes may be fractional or zero. A new product starts with zero finished stock.
- Editing preserves stock and existing saved order quotes.
- The editor previews material cost, labour cost, and minimum selling price without saving.
- Deletion requires zero stock and no references from any order, including closed orders.

### Shared record rules

- Names are unique ignoring case within suppliers, within materials, and within products.
- Existing records retain their IDs when edited.
- Forms for materials/products/orders show prerequisite guidance when suppliers/materials/products are missing.
- Invalid saves do not persist partial changes; management editors retain submitted values alongside the error.

Evidence: [forms.ts](src/forms.ts), [model.ts](src/model.ts), [operations.ts](src/operations.ts), [editors.ts](src/editors.ts).

## 6. Order lifecycle — observed

| Starting state | Action | Resulting state | Effect |
| --- | --- | --- | --- |
| No order | Save a new order | Pending | Save the estimate; reserve and consume nothing. |
| Pending | Edit/save | Pending | Replace its editable details/lines; retain creation date. |
| Pending | Confirm and reserve stock | Confirmed | Save quote/currency/confirmation time; reserve available finished units and allocate materials. |
| Confirmed or In progress | Record a production batch | In progress | Consume recipe materials; add/reserve finished units for that order. |
| Confirmed or In progress, all units ready | Complete and hand over | Completed | Remove all ordered finished units from physical stock. |
| Pending, Confirmed, or In progress | Cancel | Cancelled | Retain order/history; release reservations without undoing physical movements. |
| Any existing order state | Delete after confirmation dialog | Removed | Remove the order; release reservations; leave physical inventory and movement history unchanged. |

Closed orders cannot be confirmed, produced for, completed again, or cancelled again. There is no reopen/undo workflow. Producing the final unit does not automatically complete the order: handover is a separate action.

### Creating and previewing an order

- Enter customer name, optional contact, optional requested completion date, and one or more product lines.
- Each line has a whole positive quantity and an agreed unit selling price; each product appears once.
- The product selector supplies the current minimum price as an initial suggestion. A lower agreed price is allowed and produces a warning.
- Editing a pending order recalculates its estimate using current recipes and costs.
- Live previews can calculate before the customer name is entered and do not save an order, consume materials, or reserve stock.
- Requested completion date is compared with the estimate for a late warning. It does not currently drive confirmed production priority.

### Confirmation and saved information

- A confirmed order cannot be edited through the existing order editor.
- Confirmation snapshots product name, recipe, per-unit production time, hourly rate, material pack quantities/prices, and currency. The agreed selling prices remain those entered on the order.
- Subsequent product/cost/settings edits do not rewrite those saved quote values.
- Current supplier details and current material purchase-pack prices are still used for new purchase suggestions.
- Current confirmation chooses finished units from the unreserved stock available at that time. Confirmation is allowed even when materials are missing.
- Reservations do not create stock movements and do not deduct physical stock.

Evidence: [operations.ts](src/operations.ts), [forms.ts](src/forms.ts), [model.ts](src/model.ts), [app.ts](src/app.ts), [business.test.ts](test/business.test.ts), [web.test.ts](test/web.test.ts).

## 7. Stock, production, and material sufficiency

### Physical stock and reservations — observed

- Physical stock means what is on the shelf, including units reserved for orders.
- Finished-stock reservations are the units taken from stock at confirmation plus units subsequently produced for active orders.
- Available finished stock equals physical stock minus those reservations.
- Remaining units on an active order line equal ordered minus reserved-from-stock minus produced.
- Material requirements come from remaining units multiplied by the order's recipe quantities.
- Current active-order material allocations are calculated from stock in confirmation-time order. They are recalculated after relevant changes rather than stored as separate allocation records.
- Cancelling or deleting an active order makes its formerly reserved stock available again.
- Low-stock warnings use availability after active-order reservations; pending estimates do not create real reservations.

### Production — observed

- Production for an order requires an active order and a matching product line.
- The batch is a positive whole number and cannot exceed the line's remaining units.
- Check every required material before consuming any of it.
- Order production uses its saved recipe; production for general stock uses the current product recipe.
- Consume materials, record negative material movements, add finished units, and record a positive finished-product movement.
- For an order batch, increase that line's produced count and set the order to In progress.
- Current production for an order is restricted to material allocated to that order. General-stock production cannot consume materials reserved for active orders.
- Production requires actual material stock; expected purchases cannot be consumed.

### Receipts and physical counts — observed

- Receive adds a positive quantity to physical stock and records the increase with a reason.
- Correct count sets the new total physical stock, including reserved units; record the difference with a reason.
- Material quantities may be fractional; finished-product quantities must be whole.
- Corrections cannot reduce stock below existing active-order reservations.
- Receiving finished products directly does not consume recipe materials.
- Receiving additional finished products does not currently assign them automatically to already-confirmed order lines. Those lines retain their original from-stock count. D10 changes the required outcome: later finished stock must be usable to fulfil an existing order without recording more production. This does not require automatic distribution across orders.

### Individual versus aggregate views — confirmed target, with differences to resolve

Apply D08: individual orders show their own material sufficiency; the aggregate shows combined sufficiency.

Current code differs across displays:

| Current display | Observed calculation | Relationship to D08 |
| --- | --- | --- |
| Pending order detail/live preview | Separate what-if estimate after confirmed work; does not deduct other pending orders' requirements. | Isolation from other pending orders matches D08. The sufficiency display must also follow D08 independently of D09's production restrictions. |
| Active order detail | Shows stock after earlier active-order allocations. | Can show less than physical stock. D08 requires isolated displayed sufficiency; D09 still prevents consuming another order's reserved materials. |
| Overview Materials / Total | Combines remaining requirements across open orders, counts shared stock once. | Combined-shortage purpose matches D08. |
| Overview Materials / Per order | Processes active orders first, then pending by requested date, reducing stock as each order is considered. | Sequential shortage display needs reconciliation with the confirmed isolated per-order requirement. |

Displayed material sufficiency follows D08; actual protection of reserved materials follows D09. Do not use the isolated display as permission to consume another order's reservation.

### Aggregate material display — observed details

- Include Pending, Confirmed, and In progress orders; exclude Completed and Cancelled.
- Exclude finished units already used to cover an order and units already produced for it.
- Retain distinct recipe quantities as cut sizes with counts; sum them for the material total.
- For length units `m`, `cm`, and `mm`, show a cut list. Sub-metre lengths expressed in metres display as centimetres.
- Total balance is physical material stock minus the combined material requirement; zero is sufficient.
- The existing calculation uses recipe quantities directly. It does not model roll lengths, offcuts, cutting waste, or optimise how pieces are cut.

Evidence: [planning.ts](src/planning.ts), [operations.ts](src/operations.ts), [model.ts](src/model.ts), [views.ts](src/views.ts), [business.test.ts](test/business.test.ts).

## 8. Costs, quantities, and formatting — observed

| Calculation | Existing rule |
| --- | --- |
| Material unit cost | Purchase-pack price / purchase-pack quantity. |
| Product material cost | Sum of ingredient quantity × pack price / pack quantity. |
| Product labour cost | Minutes per unit × hourly rate / 60. |
| Minimum unit selling price | Material cost + labour cost, rounded upward to the next cent. |
| Order minimum total | Sum of each rounded minimum unit price × ordered quantity. |
| Order selling total | Sum of agreed line unit price × ordered quantity. |
| Work remaining | Sum of saved/current minutes per unit × remaining units. |
| Required purchase packs | Ceiling of material shortage / current pack quantity. |
| Purchase quantity | Required packs × current pack quantity. |
| Purchase cost | Required packs × current pack price. |

- Minimum prices cover materials and hourly pay. No profit margin, tax, shipping, or overhead is added.
- Prices and material quantities accept up to six decimal places, including decimal-comma input. Most are nonnegative and capped at 1,000,000,000; fields requiring positive values reject zero.
- Order and batch counts are whole numbers, normally capped at 1,000,000. Finished physical stock is capped at 1,000,000,000. Product warning thresholds currently use the default 1,000,000 integer cap.
- Working hours are between 0 and 24 for each of seven days.
- The current decimal engine uses 34 significant digits and half-up rounding, with explicit upward rounding for minimum prices. This records the current numerical behaviour; the Go number representation has not been chosen.
- Money displays a currency code and two fractional digits. Material-list unit costs use up to four fractional digits. Durations round upward to whole minutes and display hours/minutes when applicable.
- Changing currency changes labels and future saved currency values; it performs no exchange conversion. Confirmed order quotes keep their saved currency.
- Current text validation trims ordinary fields and generally limits validated text to 4,000 characters. QR identifiers preserve their literal content.

Evidence: [model.ts](src/model.ts), [planning.ts](src/planning.ts), [views.ts](src/views.ts), [forms.ts](src/forms.ts).

## 9. Purchases and production estimates — observed

1. For each material, calculate the quantity needed for unmade units and the currently allocated quantity in stock.
2. Shortage is requirement minus allocation. Suggest enough whole purchase packs to cover the shortage.
3. Assume missing materials are purchased today. Estimate arrival using the supplier's Monday–Friday lead days; zero lead days means today.
4. Supplier lead time ignores the workshop's days off. There is no purchase-order record or tracked expected delivery date.
5. The order's material-ready date is the latest required material arrival.
6. Estimate production from that date using daily working hours, dates off, and remaining production minutes.
7. Active orders share a daily capacity calendar, processed in confirmation-time order. Earlier scheduling does not prevent later orders using earlier free capacity while the earlier order waits for materials.
8. Pending order completion estimates are currently separate previews after confirmed work; pending estimates do not consume each other's calendar capacity.
9. Today's entire configured capacity is available; elapsed hours today are not subtracted.
10. Zero remaining work means ready today, including when the schedule has no working hours. Otherwise missing capacity produces an explanation rather than an invented date.
11. Planning currently searches at most 3,660 days; exceeding that window produces an explanation.

Updating stock, recipes for pending orders, suppliers, working hours, or dates off can change estimates. Estimates are derived views, not promises stored as fixed completion dates.

The current application uses a configured workshop time zone for request-level today, while some stock/production helpers fall back to `Europe/Athens`. D15 supersedes both approaches for the Go backend: use the backend host's system clock and local time zone consistently.

Evidence: [planning.ts](src/planning.ts), [model.ts](src/model.ts), [app.ts](src/app.ts), [operations.ts](src/operations.ts).

## 10. Barcode receiving — observed

1. Open Received materials.
2. Scan a barcode, enter one manually, or choose a material without a barcode.
3. For a known code, select its material automatically. For an unknown code, assign it to an existing material or enter a new material and select an existing supplier.
4. Enter quantity in the material's measurement unit, not number of purchase packs.
5. Add the row to the delivery. This stages it in the browser; it does not yet change workshop data.
6. Review/edit quantities or remove rows, then save the delivery once.
7. Save material creation, barcode assignments, stock increases, and one movement per row together. Any invalid row leaves the stored delivery unapplied.
8. On success, return to Inventory with a confirmation notice. On failure, retain the staged delivery for correction/retry.

Additional rules:

- Supported formats: EAN-13, EAN-8, UPC-A, UPC-E, and QR.
- Validate EAN/UPC lengths and check digits; preserve leading zeros and recognise equivalent UPC/EAN identities.
- QR content is a literal identifier, separate from numeric barcode identities, and is never opened as a URL.
- Multiple codes can identify one material. The application does not generate barcodes.
- Repeated camera frames do not stage repeated receipts. Press Scan barcode again to deliberately accept the same code again.
- A receipt identifier prevents a retried successful delivery from increasing stock again, including a retry after a lost response.
- A delivery currently contains 1–500 rows; quantities must be positive.
- The scanner module/WASM loads when requested. Decoding runs in the browser; camera use requires browser permission and a supported secure context.
- Stop/release the camera when requested, when saving, when the page hides, or when leaving the screen. Manual entry remains available if the camera fails.
- Leaving with an unsaved delivery triggers a browser warning. The staged delivery is not persisted across reloads.

Evidence: [receiving.ts](src/receiving.ts), [receiving-view.ts](src/receiving-view.ts), [barcodes.ts](src/barcodes.ts), [scanner.ts](src/scanner.ts), [client.ts](src/client.ts), barcode/scanner/web tests.

## 11. Settings, persistence, backup, and recovery — observed

### Settings and schedule

- Settings are accessible in a shared dialog; title is required, subtitle may be blank, hourly rate may be zero, currency must be recognised.
- Save settings and return to the originating page; invalid settings reopen the dialog with entered values and an error.
- Save all seven daily capacities and dates off together. Dates off are deduplicated and sorted on save.

### Working file

- Current working data is a JSON envelope with `format: "smerp-backup"` and `version: 1`.
- Validate records, references, names, quantities, barcode ownership, order states, and stock/reservation consistency before committing a change.
- Write a temporary file, flush it, and rename it over the working file. Invalid changes do not replace the original.
- Current saves are immediate per successful action; no explicit Save all or Save on exit workflow exists.
- Current size cap is 10 MiB for stored/exportable data. Whether this cap should remain is not yet a new product decision.
- Current reads reload/validate the entire file; current writes serialize/validate the entire dataset. These are implementation details, not requirements for the Go backend.
- An in-memory working dataset was discussed as an implementation option, not selected as a required storage architecture.

### Backups

- Download all workshop data, including settings, schedule, order snapshots, barcodes, and movement history.
- Filename is `smerp-backup-YYYY-MM-DD.json`, using the workshop date in the current application. In the Go backend, D15 requires the date to come from the backend host's system time.
- Restore uploads a nonempty JSON file no larger than 10 MiB, validates it, and previews record counts without changing current data.
- The user confirms full replacement through the existing dialog. Restore replaces everything; it does not merge records.
- Reject unsupported versions, malformed records, duplicate identities, broken references, and impossible inventory/order relationships without partially importing.
- Existing imports recognise current and earlier web backup format names. Missing older barcode lists become empty; missing old workshop branding fields receive existing defaults.
- Older Android-format data can currently be imported after changing its format label as described in the README; numeric source precision is preserved when reading decimal literals.
- The preceding legacy import behaviours are historical observations only. D11 explicitly excludes implementing backward compatibility or migrations in the Go application; old working files and backups do not dictate its data format.

### Recovery

- An unreadable/invalid working file remains unchanged; show the existing recovery screen.
- Allow downloading the original file even when it cannot be parsed.
- Allow explicitly replacing it with a valid backup. Do not silently overwrite damaged data with a new empty workshop.

Evidence: [store.ts](src/store.ts), [model.ts](src/model.ts), [app.ts](src/app.ts), [client.ts](src/client.ts), [web.test.ts](test/web.test.ts), [README.md](README.md).

## 12. Frontend/backend contract — observed baseline for retaining the UI

D02 requires preserving the frontend. The current backend generates the page markup as well as handling requests; the interface is not a standalone static frontend. The new implementation must supply the same interface and browser-visible contracts without treating the existing TypeScript template functions as a Go design.

### Pages and actions

`section` below means `suppliers`, `materials`, `products`, or `orders`.

| Method | Path | Current result |
| --- | --- | --- |
| GET | `/` | Overview; `?restored=1` adds the restore notice. |
| GET | `/{section}` | List page. |
| GET | `/{section}/new` | New-record editor or prerequisite guidance. |
| GET | `/{section}/{id}/edit` | Existing-record editor; orders must be Pending. |
| POST | `/{section}/save` | Validate/save; redirect to list, or order detail for an order. |
| POST | `/{section}/{id}/delete` | Validate/delete; redirect to that section's list. |
| GET | `/orders/{id}` | Order detail. |
| POST | `/orders/{id}/confirm` | Confirm/reserve; redirect to the order detail. |
| POST | `/orders/{id}/cancel` | Cancel; redirect to the order detail. |
| POST | `/orders/{id}/complete` | Hand over; redirect to the order detail. |
| GET | `/inventory` | Inventory; `?received=1` adds the delivery notice. |
| GET | `/inventory/receive` | Staged material delivery screen. |
| GET | `/inventory/edit` | Editor selected by `kind`, `id`, `mode`, and optional `orderId` query values. |
| POST | `/inventory/save` | Apply receive/count/produce; redirect to order detail if `orderId` is supplied, otherwise Inventory. |
| GET / POST | `/schedule` | Show/save work schedule; success redirects to `?saved=1`. |
| POST | `/settings` | Save settings; redirect to a validated `returnTo` page. |
| GET | `/backup` | Download full JSON or original damaged file. |
| POST | `/restore` | Confirmed full replacement; redirect to `/?restored=1`. |
| GET | `/assets/*` | Existing CSS, theme/main/scanner JavaScript, icon, and scanner WASM. |
| GET | `/health` | JSON `{ "ok": true }` when stored data can be read. |

### Form fields

Existing mutation forms carry `revision`; entity editors also carry `id`. D14 confirms that older forms must not overwrite newer saved changes; the retained frontend already supplies a revision field for this purpose.

| Form | Fields in addition to those shared fields |
| --- | --- |
| Supplier | `name`, `contact`, `leadDays` |
| Material | `name`, `unit`, `supplierId`, `packQuantity`, `packPrice`, `threshold`, `barcodesEdited`; paired repeated `barcodeFormat` / `barcodeValue` |
| Product | `name`, `minutes`, `threshold`; paired repeated `recipeMaterial` / `recipeQuantity` |
| Order | `customer`, `contact`, `requestedDate`; aligned repeated `lineProduct` / `lineQuantity` / `linePrice` |
| Stock | `kind` (`material`/`product`), `id`, `mode` (`receive`/`count`/`produce`), `orderId`, `quantity`, `reason` for receive/count |
| Schedule | Seven repeated `hours`, repeated `daysOff`, optional `newDayOff` |
| Settings | `title`, `subtitle`, `hourlyRate`, `currency`, `returnTo` |
| Restore | Multipart file `backup`, `revision`, and `confirmRestore=replace` for actual replacement |

### Browser-requested JSON endpoints

| Method/path | Request | Successful response |
| --- | --- | --- |
| GET `/api/revision` | No body | `{ revision }` |
| POST `/api/product-preview` | Product form data | Display strings `{ materials, labour, minimum }` |
| POST `/api/order-preview` | Order form data | Display strings `{ minimum, work, purchases, completion, warning }` |
| POST `/api/restore-preview` | Multipart backup and revision | `{ summary }`, a human-readable count summary |
| POST `/api/materials/receive` | JSON `{ revision, receiptId, rows }` | `{ ok: true }` |

A receipt row has `materialId`, `quantity`, `code` (null or `{ format, value }`), and optional `newMaterial` with `name`, `unit`, `supplierId`, `packQuantity`, and `packPrice`. The browser also sends presentation fields such as row key/name/unit; these are not trusted record definitions.

### Page bootstrap and interaction

- Pages include JSON in the element `page-data`, read by the existing browser script.
- Shared values are `revision` and `openSettings`.
- Product editing supplies material choices, recipe rows with keys/material IDs/quantities/units, and an optional initial cost preview.
- Order editing supplies product choices with minimum/available values and keyed order rows.
- Material editing supplies barcodes; schedule editing supplies dates off.
- Receiving supplies materials with barcodes and supplier IDs.
- Live product/order previews run on initialisation and input/change; typing is debounced by 250 ms. Older responses cannot overwrite a newer preview.
- Receiving success navigates to `/inventory?received=1`. Failed receiving retains rows. The existing conflict response can refresh the available material list.
- The browser currently checks revision on window focus/page visibility and offers Refresh when it changes. Its wording mentions another device. This is part of the frontend retained under D02; D14 additionally confirms stale-save protection.

### Errors and request handling

- Successful ordinary form actions use HTTP 303 redirects; previews/receipt successes use JSON and HTTP 200.
- Validation/business errors generally use HTTP 422; stale revision errors currently use 409; unknown pages use 404.
- API errors have `{ error }`; current conflicts add `revision`, and receipt conflicts also include material IDs/names/units/barcodes.
- Invalid management forms retain entered values; stock/order-action errors return the relevant review screen with an error.
- Current HTTP mode checks configured Host, rejects explicit foreign-origin/cross-site mutations, escapes user text in HTML, and supplies security headers compatible with the scanner WASM.
- Wrong Host returns 400, forbidden cross-site requests 403, oversized request bodies 413. Dynamic pages use `no-store`; asset responses use `no-cache`.
- No built-in accounts or login exist. D13 confirms browser access from other devices. Optional external access control/tunnelling is deployment-specific; its implementation has not been selected.

Evidence: [app.ts](src/app.ts), [server.ts](src/server.ts), [client.ts](src/client.ts), [views.ts](src/views.ts), [editors.ts](src/editors.ts), [receiving-view.ts](src/receiving-view.ts).

## 13. Behaviour examples for later verification

These are reference cases for agreeing on the specification, not a new test implementation.

| Case | Expected result or current evidence |
| --- | --- |
| Isolated versus combined sufficiency | Confirmed D08: 10 m stock, two 6 m orders; each individually sufficient, aggregate short by 2 m. |
| Different requirements | Confirmed D08: 10 m stock, orders needing 3 m and 20 m; only the first is individually feasible. |
| Reserved materials | Confirmed D09: materials reserved for a confirmed order cannot be consumed to produce another order, even when that other order's isolated sufficiency display is positive. |
| Unit costing | Existing synthetic fixture: four fasteners at 10 per 100 plus 0.3 m sheet at 40 per 30 m costs 0.80; five minutes at 18/hour costs 1.50; minimum is 2.30. |
| Upward price rounding | Existing fixture with hourly rate 18.01 produces a minimum unit price of 2.31, rather than rounding down to 2.30. |
| Existing finished stock | Existing workflow: four ordered, two on shelf; confirmation reserves two; producing two consumes only two units' recipes; handover removes four finished units. |
| Finished stock added later | Confirmed D10: confirm an order for four shirts with zero finished stock, then add four finished shirts to inventory. Those shirts can fulfil the order without requiring another production batch. |
| Partial production then cancel | Existing rule: retain consumed materials and finished units already produced; release reservations. |
| Delete a delivered order | Existing rule: remove order without putting delivered units back on the shelf or removing movement history. |
| Changed recipe after confirmation | Existing rule: current product costing changes, confirmed order costing/production recipe does not. |
| Changed purchase price | Existing rule: saved order cost remains frozen, but purchase suggestions use the current price. |
| Retried delivery | Existing rule: the same successful receipt identifier does not increase stock twice. |
| Invalid row in a delivery | Existing rule: reject the whole delivery without saving earlier rows or barcode assignments. |
| Backup round trip | Existing rule: export/restore retains records, decimals, saved quotes, schedule, barcodes, and movements. |
| Damaged working file | Existing rule: retain it, offer its original download, and require explicit replacement with valid data. |
| System time | Confirmed D15: derive today and scheduling dates from the backend host's system clock and local time zone, without a separate workshop zone or fixed regional fallback. |

Existing tests provide additional examples in [business.test.ts](test/business.test.ts), [web.test.ts](test/web.test.ts), [barcodes.test.ts](test/barcodes.test.ts), and [scanner.test.ts](test/scanner.test.ts). Their implementation-specific assertions are not automatically requirements for the new backend.

## 14. Questions and undecided scope

D08–D15 record the clarifications resolved during mapping. Every question in the current list has been answered. The questions remain below for traceability; technical implementation choices are listed separately.

| ID | Question | Why it matters | Status |
| --- | --- | --- | --- |
| Q01 | When an order is confirmed, should its available materials be reserved for it, so they cannot be used to produce another order? | Displayed sufficiency and permission to consume stock are separate rules. | Answered: yes — D09 |
| Q02 | Should finished products received or made for general stock after confirmation be usable to fulfil an existing order without recording production again? | Existing lines keep their original from-stock assignment; the new backend must support the confirmed outcome. | Answered: yes — D10 |
| Q03 | Should saving an older form be blocked if it would overwrite a newer change made from another device? | The retained browser code sends revisions and expects the revision endpoint. | Answered: yes — D14 |
| Q04 | Must existing working JSON files and current/earlier backups open directly in the Go app without manual conversion? | Determines whether legacy-data support is in scope. | Answered: no — D11; no backward compatibility or migrations |
| Q05 | Should desktop use open the normal browser or a dedicated application window? | Determines which launch/display modes are in scope. | Answered: both — D12 |
| Q06 | Should all dates and estimates consistently use the configured workshop time zone? | Determines the source of current dates and scheduling time. | Answered: use system time instead — D15 |
| Q08 | Should browser mode allow access from other devices, or only from the computer running Smerp? | Establishes whether the browser interface is host-only. | Answered: other devices as well — D13 |

Other implementation choices remain deliberately undecided: desktop window toolkit, installation/startup method, default launch mode and process lifetime, data/config file locations, number representation, internal record/index design, and persistence implementation. D12 establishes both display modes; it does not select their implementation.

## 15. Mapping status

- Initial source-based map covers records, screens, maintenance, orders, inventory, costing, planning, receiving, settings, persistence, recovery, and the existing browser contract.
- D08 records isolated versus aggregate sufficiency; D09 confirms protection of materials reserved for an order; D10 allows later finished stock to fulfil an existing order. Differences from current code are explicitly identified.
- D11 excludes backward compatibility and data migrations; observations about legacy imports are not requirements for the Go application.
- D12 includes both browser and dedicated-window modes in the current desktop scope.
- D13 includes browser access from other devices while retaining single-user operation.
- D14 confirms that older forms must not overwrite newer saved changes.
- D15 specifies the backend host's system clock and local time zone instead of a configured workshop time zone.
- The current clarification list is answered. The source-based map remains a draft for review; this does not authorise starting the Go implementation.
- A later behavioural verification pass will need to check the existing rendered screens and interactions, then the Go implementation against the agreed specification. This pass has not been performed.
- No Go code, dependency changes, application changes, data migrations, or deployment work are part of this document creation.
