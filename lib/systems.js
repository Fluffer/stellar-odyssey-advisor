// Star systems: coordinates and distances.
//
// The nine starter systems are a constant in the game client (index bundle,
// `starterSystems`): a 3x3 grid at x, y in {875, 3500, 6125}, all at z = 1.
// The game measures "light years to the nearest starter system" in the
// x/y plane only (sqrt(dx^2 + dy^2), same bundle), and that distance is the
// uncapped part of a system's cosmic dust value (see the Exploring wiki
// page), so it is the number that says what a discovery there is worth.
"use strict";

const STARTER_SYSTEMS = [
  { name: "Aldebaran", star: "K type", x: 875, y: 6125, z: 1 },
  { name: "Sirius", star: "A type", x: 875, y: 3500, z: 1 },
  { name: "Therion", star: "Black Hole", x: 875, y: 875, z: 1 },
  { name: "Nyxar", star: "O type", x: 3500, y: 6125, z: 1 },
  { name: "Sun", star: "G type", x: 3500, y: 3500, z: 1 },
  { name: "Vega", star: "A type", x: 3500, y: 875, z: 1 },
  { name: "Antares", star: "M type", x: 6125, y: 6125, z: 1 },
  { name: "Rigel", star: "B type", x: 6125, y: 3500, z: 1 },
  { name: "Polaris", star: "F type", x: 6125, y: 875, z: 1 },
];

function hasCoords(s) {
  return !!s && Number.isFinite(Number(s.x)) && Number.isFinite(Number(s.y));
}

// Plane distance, the game's own measure for the starter distance.
function distance(a, b) {
  if (!hasCoords(a) || !hasCoords(b)) return null;
  return Math.sqrt(Math.pow(Number(a.x) - Number(b.x), 2) + Math.pow(Number(a.y) - Number(b.y), 2));
}

function nearestStarter(s) {
  if (!hasCoords(s)) return null;
  let best = null;
  for (const st of STARTER_SYSTEMS) {
    const d = distance(s, st);
    if (best === null || d < best.distance) best = { name: st.name, distance: d };
  }
  return best;
}

// The coordinate and distance facts the GUI shows next to a system name.
function describe(s, current) {
  const coords = hasCoords(s) ? { x: Number(s.x), y: Number(s.y), z: s.z === undefined || s.z === null ? null : Number(s.z) } : null;
  const near = nearestStarter(s);
  return {
    coords,
    fromCurrent: (current && s !== current) ? distance(s, current) : (current && s === current ? 0 : null),
    nearestStarter: near ? near.name : null,
    starterDistance: near ? near.distance : null,
    isStarter: !!(near && near.distance === 0),
  };
}

module.exports = { STARTER_SYSTEMS, distance, nearestStarter, describe, hasCoords };
