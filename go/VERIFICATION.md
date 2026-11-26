# Verification

Verified on 2026-11-26 on Linux amd64, Go 1.27.4, GTK 3.24.52 and WebKitGTK 2.54.2 (4.1 API). Only synthetic workshop data was used. The existing Node application and workshop data were not changed.

## Automated checks

The following passed:

```sh
go test -race -tags webkitgtk_41 ./...
go vet -tags webkitgtk_41 ./...
./build.sh
sh -n build.sh
SMERP_WINDOW_TEST=1 GDK_BACKEND=x11 xvfb-run -a -s '-screen 0 1280x1000x24' \
  go test -tags webkitgtk_41 -run TestWindowUI -count=1 -timeout 60s -v
```

The macOS property list was also parsed and its executable/camera entries checked. This is a metadata check, not a macOS build.

| Requirement | Evidence |
| --- | --- |
| Decimal costs, input and rounding | `TestCostsAndDecimalInput`: recipe/labour totals, upward-cent rounding, decimal comma, invalid quantities. `TestMinimumPriceDoesNotRoundDivisionResidueUpACent` verifies exact fractional sums do not gain an extra cent; `TestTinyPositiveCostStillRoundsUp` preserves the upward-rounding rule for tiny positive costs. |
| Isolated order versus shared totals | `TestIsolatedAndCombinedRequirements`: two 6 m orders against 10 m stock; both isolated views sufficient, combined shortage 2 m. |
| Reservation protection | Same test confirms both orders and proves the second cannot consume the first order's reserved fabric. |
| Saved quotes, partial production and delivery | `TestSavedQuotePartialProductionAndHandover`: frozen recipe/costs, batches, completion checks, movement history retained on deletion. |
| Finished stock added later | `TestLaterFinishedStockAndCancellation` and `TestHTTPWorkflowLaterStockAndStaleForm`: stock fulfils the selected order without additional production or automatic redistribution. |
| Purchases and scheduling | `TestSchedulingAndPurchases`: whole purchase packs, supplier weekends, completion estimates, zero hours, finished goods requiring no production capacity. |
| Atomic persistence and stale forms | `TestAtomicSavesStaleFormsAndDiskFailure`: rejected mutation, stale revision and write failure do not publish changes. |
| Failed replacement cleanup | `TestFailedAtomicReplacementRemovesTemporaryFile`: a real rename failure leaves saved state intact and removes its temporary file. |
| Delivery batch validation and retry | `TestDeliveryRetryAndWholeBatchFailure` and `TestHTTPReceiptRetriesAndRequestGuards`: invalid batches do not partly commit; successful delivery retry does not receive twice. |
| Backups and recovery | `TestBackupCompletenessAndRecovery` and `TestHTTPBackupAndDamagedFileRecovery`: own-format round trip, incomplete/legacy-format rejection, explicit replacement, original damaged data retained. |
| Management forms and references | `TestCatalogReferencesSettingsAndSchedule`: catalog CRUD, protected referenced records, settings, valid/invalid currencies, days off and invalid dates. |
| Browser contract | `TestAllManagementScreens`, `TestManagementAndLivePreviews`: routes, editors, live product/order previews, multipart FormData, retained drafts and bootstrap data. |
| Request handling | `TestHTTPReceiptRetriesAndRequestGuards`: foreign origin/Host rejected and user HTML escaped. |
| System time and barcodes | `TestBarcodesAndSystemDate`: host-local date, numeric checksums, equivalent UPC identities and literal QR identifiers. |
| Real native rendering | `TestWindowUI`: actual system WebView loads the embedded interface and exercises theme changes, settings dialog, live preview and staged barcode receiving. |

## Runtime and interface checks

- Launched the compiled binary in browser mode; it opened the system browser automatically. Its executable and embedded assets run without the Node server.
- Launched the compiled binary in window mode under Xvfb/X11, checked its HTTP health, inspected the rendered window screenshot, then stopped it with SIGINT. It exited with status 0.
- In Firefox, created a supplier, material, product and order using the rendered forms. Live costing and order previews populated through the unchanged main browser bundle.
- Received 10 m of fabric through the staged barcode/manual receiving interface, confirmed an order for two shirts, recorded production, and handed it over. Final saved state: order Completed, fabric 7.5 m, finished stock 0. Movements were +10 m, -2.5 m, +2 shirts, -2 shirts.
- Compared the original and Go empty-workshop pages at the same browser dimensions: heading positions, font and background colour matched. The CSS, main browser bundle, scanner bundle and scanner WASM were copied unchanged. The small startup/theme script removes old theme-name fallback and supplies UUID generation for LAN HTTP; there is no UI redesign.
- Checked light and dark themes and a 390-pixel responsive view. Body width remained 390 pixels; desktop sidebar hid and mobile navigation displayed.
- Accessed the Go server through the host's LAN IP over ordinary HTTP. Verified that the receiving editor initialised, generated its receipt ID and staged a recognised material. This checks the non-localhost browser context; it was not a test from a separate physical phone.
- Exercised the actual scanner module and served WASM with a synthetic QR image in a canvas video stream. It decoded `smerp-synthetic-scan` and released all capture tracks after abort. Physical webcam capture was not tested.

## Platform qualifications

- **Linux:** native build, unit/HTTP/race checks, browser launch and actual WebKit window rendering/interactions verified. Xvfb needed `GDK_BACKEND=x11` because the workstation otherwise selects its Wayland session. Software-rendering warnings under Xvfb did not prevent the checks passing.
- **Windows:** implementation uses WebView2, with native build instructions and a PowerShell build entry point. A Windows host/toolchain was unavailable here; Windows compilation, permission dialogs and runtime have not been verified.
- **macOS:** implementation includes an app bundle build, permission descriptions, system confirmation prompts and native backup-download handling. A Mac/Xcode SDK was unavailable here; macOS compilation, signing and runtime have not been verified.
- Native camera/save dialogs require their real platform/OS interactions. Physical camera permission/capture and the save dialogs were not automated by the WebView smoke test. Browser backup/restore and the JSON round trip were verified separately.

No claim is made that Windows/macOS execution or physical-device camera behaviour was tested on this Linux workstation.
