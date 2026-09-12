# Advisor browser bridge

Lets the advisor read the game when you play the web build at
https://steam.stellarodyssey.app in Edge or Chrome, where no DevTools port
is available. Load it once as an unpacked extension:

1. Open `edge://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** and pick this `bridge-extension` folder.
4. Log in to the game tab if you have not. A tab that was already open is
   picked up on install. The extension badge shows `on` once it has pushed
   a state to the advisor on port 8787.

After editing any file here, press the reload icon on the extension's card
in `edge://extensions`; it re-attaches to the open game tab by itself.

## Starting the advisor server from the browser

An extension cannot start a program, but the browser can start a registered
"native messaging host" for it. `native-host/` is such a host: it checks
whether the advisor server answers on port 8787 and starts it detached when
it does not. Register it once for your user account (no admin needed):

```
node bridge-extension/native-host/install.js
```

That writes `native-host/com.stellar_odyssey.advisor_launcher.json` with
this machine's paths and points Edge and Chrome to it in the registry
(HKCU). From then on the extension starts the server itself whenever it
finds it down: on browser start, when the game tab loads, and on every
30-second check. `node bridge-extension/native-host/install.js --uninstall`
removes the registration again.

The registration is tied to the extension's ID, which for an unpacked
extension is derived from its folder path. `install.js` computes that ID;
if the badge shows `id`, compare with the ID on `edge://extensions` and
rerun `install.js <that-id>`. Moving the folder changes the ID.

Once the server answers, the extension opens the advisor page
(http://localhost:8787) in a tab when the extension is loaded and when the
browser starts, unless that tab is already open. It never opens it from
the 30-second check, so a tab you closed stays closed. Clicking the
extension icon opens or focuses the advisor tab.

Badge meanings: `on` pushed OK, `tab` no game tab open, `err` the page did
not answer (not logged in, or the tab needs a reload), `srv` the advisor
server is not running and could not be started, `host` the native host is
not registered (run `install.js`), `id` it is registered for a different
extension ID.

`page.js` is generated from `lib/cdp.js` by `node bridge-extension/build.js`;
do not edit it by hand.
