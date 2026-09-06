// Observed income rate from the history log.
//
// The base upkeep card is billed on a LIFETIME average -- every credit the
// account ever earned divided by its age -- because that is what the game's
// own BaseModuleCard does. That average is deliberately not touched. This
// module computes the separate, honest thing: how fast lifetime credits have
// actually grown recently, so the two can be shown side by side.
//
// It reads `lifetimeCredits` (statistics: credits EARNED), never `credits`,
// which is the spendable wallet and falls whenever the player buys something.

const WINDOW_DAYS = 7;
const MIN_DAYS = 1 / 24; // an hour: shorter spans extrapolate rounding noise

// lines: raw history.jsonl lines. Returns null until there is a usable pair.
function recentIncome(lines, nowMs, lifetimeNow) {
  if (!Number.isFinite(lifetimeNow) || lifetimeNow <= 0) return null;
  const points = [];
  for (const line of lines || []) {
    let e = null;
    try { e = JSON.parse(line); } catch (_) { continue; }
    const t = Number(new Date(e && e.capturedAt));
    const v = Number(e && e.lifetimeCredits);
    if (Number.isFinite(t) && Number.isFinite(v) && v > 0 && t <= nowMs) points.push({ t, v });
  }
  if (!points.length) return null;
  points.sort((a, b) => a.t - b.t);
  const cutoff = nowMs - WINDOW_DAYS * 86400000;
  // Oldest reading still inside the window; if every reading is older than the
  // window, fall back to the oldest one rather than reporting nothing.
  const first = points.find(p => p.t >= cutoff) || points[0];
  const days = (nowMs - first.t) / 86400000;
  if (days < MIN_DAYS) return null;
  const earned = lifetimeNow - first.v;
  // Negative means the counter went backwards (a reset, or a different
  // account): not a rate worth reporting.
  if (!(earned >= 0)) return null;
  return { perDay: Math.floor(earned / days), days, since: new Date(first.t).toISOString(), earned };
}

module.exports = { recentIncome, WINDOW_DAYS, MIN_DAYS };
