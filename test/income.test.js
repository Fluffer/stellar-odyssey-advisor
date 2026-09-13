// Locks the observed-income rate derived from the history log (lib/income.js).
//
// This is the counterpart to the base card's LIFETIME average: upkeep is billed
// on lifetime credits / account age (the game's own formula, see base.test.js),
// while this is the real recent rate. It must read `lifetimeCredits` (earned),
// never `credits` (the wallet, which falls when the player spends).
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { recentIncome, observedStellariumDrops } = require("../lib/income.js");

const DAY = 86400000;
const at = (nowMs, daysAgo, lifetimeCredits, extra) =>
  JSON.stringify({ capturedAt: new Date(nowMs - daysAgo * DAY).toISOString(), lifetimeCredits, ...(extra || {}) });

describe("recentIncome", () => {
  const now = Date.UTC(2026, 8, 6, 12, 0, 0);

  test("rate is earned credits over the elapsed span", () => {
    const lines = [at(now, 4, 1000e6), at(now, 2, 1400e6)];
    const r = recentIncome(lines, now, 2000e6);
    // Oldest in-window point is 4 days back at 1000e6 -> 1000e6 earned / 4 d.
    assert.equal(r.perDay, 250e6);
    assert.equal(r.earned, 1000e6);
    assert.ok(Math.abs(r.days - 4) < 1e-9);
    assert.equal(r.since, new Date(now - 4 * DAY).toISOString());
  });

  test("only the last 7 days are used when older readings exist", () => {
    const lines = [at(now, 30, 10e6), at(now, 3, 700e6)];
    const r = recentIncome(lines, now, 1000e6);
    assert.equal(r.perDay, 100e6, "300e6 over 3 d, ignoring the 30-day-old point");
    assert.ok(Math.abs(r.days - 3) < 1e-9);
  });

  test("falls back to the oldest reading when every one predates the window", () => {
    const lines = [at(now, 20, 100e6), at(now, 10, 300e6)];
    const r = recentIncome(lines, now, 500e6);
    assert.ok(Math.abs(r.days - 20) < 1e-9, "uses the 20-day-old point rather than giving up");
    assert.equal(r.perDay, Math.floor(400e6 / 20));
  });

  test("null until the span is at least an hour", () => {
    assert.equal(recentIncome([at(now, 1 / 48, 900e6)], now, 1000e6), null, "30 min: too short");
    assert.ok(recentIncome([at(now, 1 / 12, 900e6)], now, 1000e6), "2 h: long enough");
  });

  test("null when there is nothing usable to compare against", () => {
    assert.equal(recentIncome([], now, 1000e6), null, "empty history");
    assert.equal(recentIncome(null, now, 1000e6), null, "no history at all");
    assert.equal(recentIncome([at(now, 2, 100e6)], now, 0), null, "no current lifetime figure");
    assert.equal(recentIncome([at(now, 2, 100e6)], now, NaN), null, "unusable current figure");
  });

  test("ignores lines with no lifetimeCredits, and corrupt ones", () => {
    const legacy = JSON.stringify({ capturedAt: new Date(now - 5 * DAY).toISOString(), credits: 123 });
    const lines = ["{not json", legacy, at(now, 2, 800e6)];
    const r = recentIncome(lines, now, 1000e6);
    assert.ok(Math.abs(r.days - 2) < 1e-9, "the pre-lifetimeCredits line is skipped, not used as t0");
    assert.equal(r.perDay, 100e6);
  });

  test("a counter that went backwards yields null, not a negative rate", () => {
    const r = recentIncome([at(now, 2, 5000e6)], now, 1000e6);
    assert.equal(r, null, "reset or a different account");
  });

  test("zero earned is a real zero rate, not null", () => {
    const r = recentIncome([at(now, 2, 1000e6)], now, 1000e6);
    assert.equal(r.perDay, 0);
    assert.equal(r.earned, 0);
  });

  test("readings stamped in the future are ignored", () => {
    const lines = [at(now, -1, 5e9), at(now, 2, 800e6)];
    const r = recentIncome(lines, now, 1000e6);
    assert.ok(Math.abs(r.days - 2) < 1e-9);
    assert.equal(r.perDay, 100e6);
  });
});
describe("observedStellariumDrops", () => {
  const now = Date.UTC(2026, 8, 13, 12, 0, 0);
  const H = 3600000;
  const line = (hoursAgo, stellarium) => JSON.stringify({ capturedAt: new Date(now - hoursAgo * H).toISOString(), stellarium });

  test("null before founding and while nothing has risen", () => {
    assert.equal(observedStellariumDrops([], now, NaN), null);
    assert.equal(observedStellariumDrops([line(6, null), line(3, 0)], now, 0), null);
  });

  test("each rise between consecutive readings is one drop; spends (falls) are ignored", () => {
    // 0 -> 3 (drop), 3 -> 2 (spent one on an unlock), 2 -> 6 (drop of 4), now 6.
    const lines = [line(12, 0), line(7, 3), line(6, 2), line(2, 6)];
    const r = observedStellariumDrops(lines, now, 6);
    assert.equal(r.count, 2);
    assert.equal(r.last, 4);
    assert.equal(r.mean, 3.5);
    assert.equal(r.lastAt, new Date(now - 2 * H).toISOString());
  });

  test("the current reading counts, so the run that first sees a drop reports it", () => {
    const r = observedStellariumDrops([line(5, 0)], now, 3);
    assert.equal(r.count, 1);
    assert.equal(r.last, 3);
    assert.equal(r.lastAt, new Date(now).toISOString());
  });

  test("lines without a stellarium field (pre-founding history) are skipped", () => {
    const lines = [JSON.stringify({ capturedAt: new Date(now - 9 * H).toISOString(), lifetimeCredits: 1 }), line(4, 2), line(1, 5)];
    const r = observedStellariumDrops(lines, now, 5);
    assert.equal(r.count, 1);
    assert.equal(r.last, 3);
  });
});
