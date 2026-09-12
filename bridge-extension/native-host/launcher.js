// Native messaging host for the bridge extension: the one thing a browser
// extension cannot do on its own is start a program, but it may talk to a
// host registered in the registry (install.js does that), and the browser
// starts the host for it. This host does exactly one job: make sure the
// advisor server is running, starting it detached when it is not.
//
// Protocol (Chrome native messaging): stdin carries a 4-byte little-endian
// length followed by that many bytes of JSON; the reply goes to stdout the
// same way. sendNativeMessage sends one message and expects one reply.
// Nothing else may ever be written to stdout.
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const ADVISOR_DIR = path.resolve(__dirname, "..", "..");
const SERVER = path.join(ADVISOR_DIR, "advisor-server.js");
const PORT = 8787;

function reachable(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/bridge/status", timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

function startServer() {
  const out = fs.openSync(path.join(ADVISOR_DIR, "advisor-server.log"), "a");
  const err = fs.openSync(path.join(ADVISOR_DIR, "advisor-server.err.log"), "a");
  const child = spawn(process.execPath, [SERVER], {
    cwd: ADVISOR_DIR,
    detached: true,
    stdio: ["ignore", out, err],
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

async function ensure(port) {
  if (await reachable(port)) return { ok: true, running: true, started: false };
  const pid = startServer();
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await reachable(port)) return { ok: true, running: true, started: true, pid };
  }
  return { ok: false, running: false, started: true, pid, error: "server did not come up within 10s; see advisor-server.err.log" };
}

async function handle(msg) {
  const port = Number(msg && msg.port) || PORT;
  if (!msg || msg.cmd === "status") return { ok: true, running: await reachable(port), port };
  if (msg.cmd === "start") return { ...(await ensure(port)), port };
  return { ok: false, error: "unknown cmd " + msg.cmd };
}

function writeMessage(obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
}

function readOneMessage(stream) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    stream.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 4) return;
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) return;
      try { resolve(JSON.parse(buf.slice(4, 4 + len).toString("utf8"))); }
      catch (e) { reject(e); }
    });
    stream.on("end", () => reject(new Error("stdin closed before a message arrived")));
    stream.on("error", reject);
  });
}

if (require.main === module) {
  readOneMessage(process.stdin)
    .then(handle)
    .then((reply) => { writeMessage(reply); process.exit(0); })
    .catch((e) => { writeMessage({ ok: false, error: e.message }); process.exit(0); });
}

module.exports = { handle, reachable, ADVISOR_DIR, SERVER, PORT };
