# Smerp

Smerp (Small Manufacturing ERP) is a lightweight ERP for small workshops. It connects suppliers, material and finished-goods inventory, product recipes and costs, customer orders, and production scheduling. Use it from a phone or desktop browser.

TypeScript, Node.js, Hono, server-rendered HTML, Alpine.js, and modern CSS. Data lives in one JSON file on the host. No database or external services are needed to run it.

## Run

Choose a computer you own to run Smerp. This computer is the server, even when you use Smerp from your phone. Running it on your computer needs no hosting subscription. **The computer must be powered on, awake, and connected to the network for your phone to reach it.** A Cloudflare Tunnel still needs that computer running and connected to the internet.

### Set up with an AI assistant

If you want help, open an assistant on the computer that will run Smerp, share the link to this repository, and give it this prompt.

> Install Smerp on this computer using this repository’s README.

For the assistant doing the setup, identify the host OS, install and test the app, and configure it to start automatically after a reboot. Ask whether the owner needs phone access on workshop Wi-Fi, away from the workshop, or both. Configure and verify the applicable access below. Give the owner the exact URL to bookmark and explain when the host computer must be on and awake.

### Install and test on the host

Clone or download this repository into a permanent folder on the host computer. Install [Node.js 24 or newer](https://nodejs.org/en/download). Open a terminal in the folder containing `package.json` and run these commands.

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:3210** on the host. This address opens the app from that computer. Open `/health` at the same address to check that the server can read its data. When the check passes, stop the foreground process with **Ctrl+C** and start it as a background service. For development, use `npm run dev`.

The first run starts with an empty workshop. Follow [Your first order](#your-first-order) to set it up, or use [Backup and restore](#backup-and-restore) to bring in existing data.

Use the sun/moon button in the top bar to switch between Catppuccin Latte (light) and Mocha (dark). The initial theme follows your device; your selection is remembered in this browser.

In **Settings**, set the **Title** and **Subtitle** shown on the app. They default to **Workspace** and **Production planning**. Leave **Subtitle** blank to hide it. The title also appears in browser tabs.

### Start automatically after reboot

Set up one background process to run `node dist/server.js` from the repository folder, with `--config config.local.json` if using that file. Use the absolute path to the Node executable in the service configuration. Run it under an account that can write to the data directory. Enable startup at boot and restart on failure, then start it now. Smerp should keep running after the terminal and browser close.

- **Windows** — Use a Task Scheduler task triggered **At startup**. Set **Start in** to the repository folder, run the task whether or not the user is signed in, and configure restart on failure. Disable the execution time limit for this long-running task. [Microsoft Task Scheduler](https://learn.microsoft.com/en-us/windows/win32/taskschd/starting-an-executable-on-system-boot) · [Task settings](https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings)
- **macOS** — Use a `launchd` LaunchDaemon with `RunAtLoad` and `KeepAlive`. Set `WorkingDirectory` to the repository and run it as the data-owning user. A LaunchAgent starts at sign-in, so tell the owner if their setup requires signing in after each reboot. [Apple launchd guide](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)
- **Linux** — Use a `systemd` service with `WorkingDirectory`, `User`, and `Restart=on-failure`. Enable it at boot and start it with `systemctl enable --now`. [systemd service options](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)

Verify that Smerp opens while the background service is running and that it comes back after reboot. On a laptop, check the sleep settings if the owner expects their phone to connect with the lid closed.

### Open it on a phone

Anyone who can reach Smerp directly can view or edit workshop records. Limit direct access to a trusted network and put a sign-in gate in front of the public HTTPS address.

**On workshop Wi-Fi.** Set `host` to `0.0.0.0` and `origin` to the host computer's local address, such as `http://192.168.1.20:3210`. Use the computer's actual local IP and the configured port. On the host's firewall, allow inbound TCP to that port from the trusted local subnet. Restart the service and open the exact `origin` address on a phone connected to the same Wi-Fi. Bookmark that address on both devices. This setup needs only the local network. Phone camera scanning requires HTTPS, and manual barcode entry works over local HTTP.

**Away from the workshop.** Set up a Cloudflare Tunnel using the workshop owner's own Cloudflare account and a domain on Cloudflare. Domain registration can cost money if the owner needs to register one. Keep the native Node server listening on `127.0.0.1` and point the tunnel to `http://127.0.0.1:3210`. Set Smerp's `origin` to the public HTTPS URL and preserve its public hostname in the request's `Host` header. Configure the tunnel to start automatically as well. Before publishing the route, create a Cloudflare Access policy for the approved users and enable **Protect with Access**. A tunnel uses outbound connections from the host, so this setup needs no inbound router port forwarding. [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/) · [Cloudflare Access setup](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)

Smerp accepts one configured browser address. With a tunnel, use that HTTPS URL on workshop Wi-Fi and away. Test remote access on the phone with Wi-Fi off, using mobile data, and check that the sign-in prompt appears before the workshop opens. If the tunnel or internet connection goes down, that HTTPS URL is unavailable.

## Configuration and access

Edit `config.json`, or pass a separate file:

```sh
npm start -- --config config.local.json
```

- `host` and `port`: where Node listens. The default is this computer only.
- `origin`: the browser address as scheme, hostname or IP, and port if needed. Omit any path or trailing slash. Forms check this address to prevent requests from other sites.
- `timeZone`: the workshop's time zone, used for today's date.
- `dataFile`: the JSON file, relative to this directory. It is created on the first save.

When upgrading a standalone installation from an earlier release, move the existing JSON file to `data/smerp.json` before starting with the new default config.

Run one Node process per data file. It serializes writes, validates changes, and atomically replaces the file. Forms detect changes made on another phone or computer before saving, so stale pages cannot silently overwrite newer data.

## Shared access with Docker

This is the Docker option for [phone access through a tunnel](#open-it-on-a-phone). This setup requires Docker Compose and a hostname in the workshop owner's Cloudflare account. Create an Access policy for the workshop users and enable **Protect with Access** on the tunnel before publishing the route. [Cloudflare setup guide](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)

1. Copy `config.docker.example.json` to `config.docker.json`. Set `origin` to your site's HTTPS address and `timeZone` to your workshop's time zone.
2. Configure the Cloudflare Tunnel to route that hostname to `http://app:3210`. Save the tunnel token to `.cloudflared-token` in the same directory as `compose.yaml`. Restrict the file to owner access (`0600` on Linux) and ensure it is readable inside the tunnel container, which runs as UID `1000`. The deployment config and token stay local.
3. Start the app and check the containers.

   ```sh
   docker compose up -d --build --wait
   docker compose ps
   ```

Open the configured HTTPS address in a private browser window and verify that it asks you to sign in. If the site fails to load, check `docker compose logs app tunnel`.

The app and tunnel run as separate non-root containers with read-only filesystems and automatic restart enabled. The app uses an internal Docker network, and the tunnel has a separate network for its outbound Cloudflare connection. Neither container publishes a host port.

Set Docker itself to start automatically. If using Docker Desktop, enable **Start Docker Desktop when you sign in** and tell the owner they must sign in after a reboot. A container restart policy takes effect once Docker is running. [Docker Desktop settings](https://docs.docker.com/desktop/settings-and-maintenance/settings/)

Workshop data is stored at `/data/smerp.json` in the persistent Docker volume **`smerp-test_data`**. Recreating containers or rebooting keeps that data. The Docker deployment and local development use separate data files. Export backups from Settings as usual. Do not remove the Docker volume when updating the app.

If an existing deployment uses a different Compose project name, export a backup before the switch. Stop the previous project, start the new project, and restore the backup before entering new records.

The app image contains application code and dependencies. Workshop data stays in the volume, and the tunnel reads its token from the mounted file.

## Your first order

Try this example in an empty workshop to see how pricing, production, and inventory fit together for an order of two T-shirts.

1. In **Settings**, set the currency to EUR and the hourly rate to 18. In **Work schedule**, set your available hours, such as four hours each weekday.
2. In **Suppliers**, add a supplier with a two-business-day lead time. In **Materials**, add jersey fabric at EUR 60 per 10 m roll and sewing thread at EUR 4 per 200 m spool. Set the measurement unit to `m` and choose that supplier for both materials.
3. In **Products**, add a T-shirt that takes 15 minutes to make and uses 1.25 m of fabric and 50 m of thread. The minimum selling price is EUR 13.00 per T-shirt, including your time.
4. In **Inventory**, use **Correct count** on each material to enter the total on the shelf. For this order, start with 10 m of fabric and 200 m of thread. Enter `Opening stock` as the reason.
5. Go to **Orders → New order**. Enter a customer name, add two T-shirts at EUR 22 each, and save. Check the estimated ready date and any materials needed. When the customer accepts, choose **Confirm and reserve stock**.
6. Once you've made the two T-shirts, use **Record production** next to the product on the order. This deducts 2.5 m of fabric and 100 m of thread and reserves the finished T-shirts. At pickup, choose **Complete and hand over** to remove the two shirts from stock.

## How orders work

- Pending orders are estimates and reserve nothing. Confirming freezes the recipe, costs, hourly pay, and agreed prices, and reserves available stock. Finished products already in stock are used first.
- The overview's Materials tabs combine remaining requirements for all open orders, including pending estimates. Cut lengths stay separate, and shared stock is counted once. The per-order view gives confirmed orders priority, then pending orders by requested date; this preview does not reserve pending stock.
- Record each batch on the order page. This consumes its materials and reserves the finished products. Complete the order at handover to remove those products from inventory.
- Cancelling releases unused reservations. Materials already used stay consumed, and products already made stay in inventory.
- Deleting permanently removes the order after confirmation and releases unused reservations. Physical stock and stock history are kept unchanged, including completed deliveries.
- Purchase suggestions round shortages up to whole supplier packs. Arrival assumes purchasing today, using the supplier's Monday–Friday lead time. It is an estimate; receipts are recorded manually.
- Completion estimates use remaining work, confirmed orders, daily working hours, and days off. They assume the full configured hours are available today. Pending orders are separate previews after confirmed work.
- Minimum selling prices cover materials plus your hourly pay, rounded up to the next cent. They do not add profit, tax, postage, or other overhead. Changing the currency changes the label; it does not convert amounts.

## Receiving materials

Open **Inventory → Received materials → Scan barcode** and allow camera access. After each scan, enter the quantity in the material's unit (for example, metres) and press **Add to delivery**. Once you've entered all items, check the delivery list and press **Save received materials**. Stock and barcode assignments are saved together. Repeated frames and retried saves do not add duplicate stock. Press **Scan barcode** again to deliberately scan the same code twice.

Unknown codes offer **Assign to existing material** or **Add new material**. Each material can have several codes; manage them in its edit form too. Supported formats are EAN-13, EAN-8, UPC-A, UPC-E and QR. EAN/UPC check digits are validated, and codes are never generated. QR contents are treated as identifiers, never opened as links.

Camera scanning needs HTTPS (or localhost) and browser camera permission. Manual barcode entry and choosing a material without a barcode are available. Scanning uses the browser’s camera on phones and desktops; it does not require an Android installation. Barcodes are included in JSON backups, and older backups remain supported.

## Backup and restore

In **Settings → Backup and restore**, download a JSON backup and keep it somewhere outside the hosting device. It contains all workshop data, including inventory, orders, settings, and work schedule.

To move hosts or recover data, start Smerp on the new host and select the backup. The app validates it and shows a summary before asking to replace the current data. Invalid files leave existing data untouched. Web backups from earlier releases can be restored directly.

To import an older Android backup, make a copy of the JSON file and set its top-level `format` field to `smerp-backup`. Then select the copy in **Restore a backup**.

## Checks

```sh
npm run check
npm test
npm run build
```

Tests cover cost calculations, reservations, production, cancellation, scheduling, concurrent saves, validation, and backup recovery. Browser checks cover the management forms, live previews, order handover, legacy backup imports, invalid backups, stale forms, and mobile layouts.
