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

// Observed stellarium drops from the same log. `stellarium` in a history line
// is the amount HELD on the founded base; it falls when an unlock or a tier
// is bought, so only a rise between two consecutive readings counts, and each
// rise is one drop (a rise and a spend inside one interval understate that
// drop -- rare at one drop per five hours). `heldNow`, when finite, is taken
// as the newest reading so the run that first sees a drop reports it.
// Returns null until a drop has been seen.
function observedStellariumDrops(lines, nowMs, heldNow) {
  const points = [];
  for (const line of lines || []) {
    let e = null;
    try { e = JSON.parse(line); } catch (_) { continue; }
    const t = Number(new Date(e && e.capturedAt));
    const v = Number(e && e.stellarium);
    if (Number.isFinite(t) && e && e.stellarium !== null && Number.isFinite(v) && t <= nowMs) points.push({ t, v });
  }
  if (Number.isFinite(heldNow) && heldNow >= 0) points.push({ t: nowMs, v: heldNow });
  points.sort((a, b) => a.t - b.t);
  const drops = [];
  for (let i = 1; i < points.length; i++) {
    const d = points[i].v - points[i - 1].v;
    if (d > 0) drops.push({ amount: d, at: points[i].t });
  }
  if (!drops.length) return null;
  const last = drops[drops.length - 1];
  const total = drops.reduce((s, d) => s + d.amount, 0);
  return { count: drops.length, last: last.amount, lastAt: new Date(last.at).toISOString(), mean: total / drops.length };
}

module.exports = { recentIncome, observedStellariumDrops, WINDOW_DAYS, MIN_DAYS };
