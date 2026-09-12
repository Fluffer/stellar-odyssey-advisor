const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const { Bridge } = require("../lib/bridge.js");
const build = require("../bridge-extension/build.js");

describe("browser bridge", () => {
  test("page.js is generated from the current READ_ALL", () => {
    const onDisk = fs.readFileSync(build.OUT, "utf8").replace(/\r\n/g, "\n");
    assert.equal(onDisk, build.render(), "run `node bridge-extension/build.js` after editing READ_ALL");
  });

  test("nothing attached: requestFresh resolves null at once, freshest is null", async () => {
    const b = new Bridge();
    assert.equal(b.attached(), false);
    assert.equal(await b.requestFresh(50), null);
    assert.equal(b.freshest(1e9), null);
  });

  test("push parses a JSON string, rejects page errors, and feeds a waiting requestFresh", async () => {
    const b = new Bridge();
    b.lastPollAt = Date.now(); // a poller has been by, so we count as attached
    assert.throws(() => b.push({ error: "no vue app" }), /page reported: no vue app/);
    assert.throws(() => b.push("42"), /not an object/);
    assert.throws(() => b.push({ craft: {} }), /not logged in/);
    const p = b.requestFresh(1000);
    const got = b.push(JSON.stringify({ player: { level: 1 }, craft: { crafting_level: 7 } }), { url: "https://x/" });
    const fresh = await p;
    assert.equal(fresh, got);
    assert.equal(fresh.state.craft.crafting_level, 7);
    assert.equal(fresh.url, "https://x/");
    assert.equal(b.freshest(1000).state.craft.crafting_level, 7);
    assert.equal(b.freshest(-1), null);
  });

  test("a waiting poller is woken with read:true by requestFresh, else read:false after the hold", async () => {
    const b = new Bridge({ pollHoldMs: 30 });
    const idle = await b.waitForPoll();
    assert.deepEqual(idle, { read: false });
    const poll = b.waitForPoll();
    const fresh = b.requestFresh(200);
    assert.deepEqual(await poll, { read: true });
    b.push({ player: {}, ok: 1 });
    assert.equal((await fresh).state.ok, 1);
  });

  test("requestFresh gives up after its timeout when no push arrives", async () => {
    const b = new Bridge();
    b.lastPollAt = Date.now();
    assert.equal(await b.requestFresh(20), null);
    assert.equal(b.pushWaiters.length, 0, "the timed-out waiter is removed");
  });

  test("the analyze worker takes a pushed state instead of reading DevTools", async () => {
    const { Worker } = require("node:worker_threads");
    const path = require("path");
    const w = new Worker(path.join(__dirname, "..", "lib", "analyze-worker.js"));
    const reply = await new Promise((resolve) => {
      w.once("message", resolve);
      w.postMessage({ id: 1, state: { player: {} } });
    });
    await w.terminate();
    assert.equal(reply.id, 1);
    // A bare state is not analyzable, but the failure must come from the
    // analysis, never from a DevTools hunt for the Steam client.
    assert.ok(!/game not found/.test(reply.error || ""), reply.error);
  });

  test("status reports attachment and ages", () => {
    const b = new Bridge();
    b.push({ player: {}, a: 1 });
    const st = b.status();
    assert.equal(st.attached, true);
    assert.equal(st.pushes, 1);
    assert.ok(st.lastPushAgeMs >= 0);
    assert.equal(st.lastPollAgeMs, null);
  });
});

describe("native messaging host", () => {
  const { spawn } = require("node:child_process");
  const path = require("path");
  const launcher = path.join(__dirname, "..", "bridge-extension", "native-host", "launcher.js");
  const { unpackedExtensionId, HOST_NAME } = require("../bridge-extension/native-host/install.js");

  function frame(obj) {
    const body = Buffer.from(JSON.stringify(obj));
    const head = Buffer.alloc(4); head.writeUInt32LE(body.length, 0);
    return Buffer.concat([head, body]);
  }

  test("answers a length-prefixed status message with one length-prefixed reply", async () => {
    const child = spawn(process.execPath, [launcher], { stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    child.stdout.on("data", (c) => out.push(c));
    child.stdin.end(frame({ cmd: "status", port: 1 })); // nothing listens on port 1
    const code = await new Promise((r) => child.on("exit", r));
    assert.equal(code, 0);
    const buf = Buffer.concat(out);
    const len = buf.readUInt32LE(0);
    assert.equal(buf.length, 4 + len, "exactly one framed reply, nothing else on stdout");
    const reply = JSON.parse(buf.slice(4).toString("utf8"));
    assert.deepEqual(reply, { ok: true, running: false, port: 1 });
  });

  test("unpacked extension id: 32 chars of a-p, case-insensitive on Windows, path-sensitive", () => {
    const a = unpackedExtensionId("bridge-extension");
    assert.match(a, /^[a-p]{32}$/);
    if (process.platform === "win32") {
      // the drive letter is case-insensitive, the rest of the path is not
      const abs = require("path").resolve("bridge-extension");
      assert.equal(unpackedExtensionId(abs[0].toLowerCase() + abs.slice(1)), a);
      assert.notEqual(unpackedExtensionId(abs.toUpperCase()), a);
    }
    assert.notEqual(unpackedExtensionId("bridge-extension2"), a);
    assert.equal(HOST_NAME, "com.stellar_odyssey.advisor_launcher");
  });
});
