// Isolated-world half of the bridge. background.js asks this script for a
// read; it relays the request to page.js (which lives in the page's own JS
// world and can see the Vue app) over window.postMessage and hands the
// answer back. A nonce ties each answer to its request.
"use strict";
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "so-advisor-read") return false;
  const nonce = Math.random().toString(36).slice(2);
  const timer = setTimeout(() => {
    window.removeEventListener("message", onMessage);
    sendResponse({ error: "page did not answer (not logged in, or page.js not injected)" });
  }, 5000);
  function onMessage(ev) {
    if (ev.source !== window || !ev.data || ev.data.__soAdvisor !== "state" || ev.data.nonce !== nonce) return;
    clearTimeout(timer);
    window.removeEventListener("message", onMessage);
    sendResponse(ev.data.state);
  }
  window.addEventListener("message", onMessage);
  // 'read2': see page.js on why the request type carries a version.
  window.postMessage({ __soAdvisor: "read2", nonce }, "*");
  return true; // sendResponse is called later
});
