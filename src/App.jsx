import React, { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from "react";

// ===========================================================================
// MeetDeck — poolside coaching board for VCSL meets.
// Left (no page scroll): On deck → In the water → Previous (scrolls inside)
// → Event results (top 6 dual / top 10 champs). Right: meet sheet scrolls,
// with a Jump-to-current button. Tap any of your swimmers anywhere.
// ===========================================================================

const TEAMS = [
  { code: "OAK", name: "Oaktree" }, { code: "BDST", name: "Belwood" }, { code: "MTVD", name: "Montevideo" },
  { code: "LPAC", name: "Los Paseos" }, { code: "SCVCC", name: "Silver Creek" }, { code: "AGCC", name: "Almaden" },
];
const TEAM_NAME = Object.fromEntries(TEAMS.map((t) => [t.code, t.name]));
const TEAM_COLOR = { BDST: "#facc15", AGCC: "#22c55e", MTVD: "#ef4444", OAK: "#1e40af", LPAC: "#38bdf8", SCVCC: "#14b8a6" };
const teamColor = (t) => TEAM_COLOR[t] || "#7c93b0";
// Ultra-compact 2-letter fallback team codes, used only when even the normal
// team code (BDST, AGCC, ...) won't fit in a tight pre-start lane card.
const TEAM_MICRO = { BDST: "BD", OAK: "OT", AGCC: "AG", LPAC: "LP", MTVD: "MV", SCVCC: "SC" };
// "Last, First" → first-initial + last-initial (e.g. "Wong, Madelyn" → "MW"),
// the fallback when a lane card is too narrow for the full swimmer name.
function abbrevName(name) {
  const m = (name || "").split(",").map((s) => s.trim());
  if (m.length < 2 || !m[0] || !m[1]) return name;
  return (m[1][0] + m[0][0]).toUpperCase();
}
// "Last, First" → "First" (e.g. "Wong, Madelyn" → "Madelyn").
function firstNameOnly(name) {
  const m = (name || "").split(",").map((s) => s.trim());
  if (m.length < 2 || !m[1]) return name;
  return m[1].split(" ")[0];
}
// window.storage is a Claude-artifact-host API only — not present on the real
// GitHub Pages deploy — so fall back to localStorage there so data (season
// meets, accounts, the in-progress meet) survives a page refresh on the iPad.
const LOCAL_STORE = {
  async get(key) { try { const v = localStorage.getItem(key); return v == null ? null : { value: v }; } catch (e) { return null; } },
  async set(key, value) { try { localStorage.setItem(key, value); } catch (e) {} },
  async delete(key) { try { localStorage.removeItem(key); } catch (e) {} },
};
const STORE = (typeof window !== "undefined" && window.storage) ? window.storage
  : (typeof window !== "undefined" && window.localStorage) ? LOCAL_STORE : null;
const CUR_KEY = "meetdeck:current:v1";
const INDEX_KEY = "meetdeck:index:v1";
const TEAM_ALIASES = {
  OAK: ["oak", "oaktree"], BDST: ["bdst", "belwood", "dolphin", "dolphins", "bel"], MTVD: ["mtvd", "montevideo", "monte"],
  LPAC: ["lpac", "lospaseos", "paseos"], SCVCC: ["scvcc", "silvercreek", "silver"], AGCC: ["agcc", "almaden"],
};
function normTeam(tok) {
  if (!tok) return "UNAT";
  const t = String(tok).toLowerCase().replace(/[^a-z]/g, "");
  if (!t) return "UNAT";
  for (const [code, al] of Object.entries(TEAM_ALIASES)) {
    if (code.toLowerCase() === t) return code;
    if (al.some((a) => a === t || (a.length >= 4 && t.startsWith(a)))) return code;
  }
  return String(tok).toUpperCase();
}

const DUAL = { 1: 6, 2: 4, 3: 3, 4: 2, 5: 1 };
const CHAMPS = { 1: 11, 2: 9, 3: 8, 4: 7, 5: 6, 6: 5, 7: 4, 8: 3, 9: 2, 10: 1 };

// Broad "needs work" focus areas — kept general on purpose. Turns is age-gated
// (11+), but shows for IM at any age.
const TAG_TREE = [
  { label: "Starts", color: "#22c55e" },
  { label: "Turns", color: "#f59e0b", minAge: 11 },
  { label: "Finishes", color: "#a855f7" },
  { label: "Streamline", color: "#0ea5e9" },
  { label: "Underwaters", color: "#0ea5e9" },
  { label: "Kick", color: "#0ea5e9" },
  { label: "Stroke technique", color: "#0ea5e9" },
  { label: "Breathing", color: "#0ea5e9" },
  { label: "Body position", color: "#0ea5e9" },
  { label: "Pacing / endurance", color: "#14b8a6" },
  { label: "Race awareness", color: "#14b8a6" },
];
const IM_STROKES = ["Fly", "Back", "Breast", "Free"];
const RELAY_POSITION = ["Lead-off", "Support", "Anchor"];
const PROG_STROKES = ["Fly", "Back", "Breast", "Free", "IM"];
const TAG_COLOR = Object.fromEntries(TAG_TREE.map((t) => [t.label, t.color]));

const DQ_CODES = {
  Butterfly: [["1A","Alternating kick"],["1B","Breaststroke-type kick"],["1C","Scissors kick"],["1E","Non-simultaneous arms"],["1F","Arms underwater recovery"],["1J","One-hand touch"],["1K","No touch"],["1L","Non-simultaneous touch"],["1M","Shoulders not past vertical off wall"],["1N","Head not up by 15m"]],
  Backstroke: [["2I","No touch at turn"],["2K","Not on back off wall"],["2L","Shoulders past vertical toward breast"],["2N","Head not up by 15m"],["2P","Toes over gutter at start"],["2Q","Did not finish on back"],["2R","Submerged before turn/finish"],["2S","Delay initiating arm pull at turn"],["2T","Delay initiating turn past vertical"],["2U","Multiple strokes past vertical at turn"]],
  Breaststroke: [["3A","Alternating kick"],["3B","Non-simultaneous kick"],["3C","Downward butterfly kick"],["3D","Scissors kick"],["3E","Hands past hipline"],["3F","Non-simultaneous arms"],["3G","Arms two strokes underwater"],["3H","Arms not in horizontal plane"],["3I","Elbows recovered over water"],["3J","One-hand touch"],["3K","No touch"],["3L","Non-simultaneous touch"],["3M","Shoulders not past vertical off wall"],["3P","Head under 2+ strokes"],["3Q","Incomplete stroke cycle"]],
  Freestyle: [["4K","No touch on turn"],["4N","Head not up by 15m"]],
  IM: [["5P","Strokes out of sequence"]],
  Relay: [["61","Stroke infraction #1"],["62","Stroke infraction #2"],["63","Stroke infraction #3"],["64","Stroke infraction #4"],["66","Early take-off #2"],["67","Early take-off #3"],["68","Early take-off #4"],["6P","Changed order of swimmers"],["6Q","Not enough swimmers"]],
  Miscellaneous: [["7O","False start"],["7P","Declared false start"],["7Q","Did not finish"],["7R","Delay of meet"],["7S","Entered water w/o permission"],["7T","Interfered w/ swimmer"],["7U","Walking/springing from bottom"],["7V","Standing on bottom"],["7W","Pulling lane line"],["7X","Finish in wrong lane"],["7Y","Unsportsmanlike conduct"]],
};

const entryId = (e, h, l) => `${e}:${h}:${l}`;
const ORD = (n) => { const s = ["th","st","nd","rd"], v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); };
function toSeconds(t) { if (!t) return NaN; const m = String(t).trim().match(/^(?:(\d+):)?(\d{1,2}(?:\.\d+)?)$/); return m ? (m[1]?+m[1]:0)*60 + parseFloat(m[2]) : NaN; }
const isBest = (time, seed) => { const a = toSeconds(time), b = toSeconds(seed); return !isNaN(a) && !isNaN(b) && a < b; };
const brokeRecord = (time, rec) => { const a = toSeconds(time), b = toSeconds(rec); return !isNaN(a) && !isNaN(b) && a < b; };
const hasDq = (d) => (d.dqs || []).length > 0;
// A quick tap flags "this swimmer was DQ'd" instantly with the real reason
// still unknown (coach doesn't have the paper DQ slip yet) — vs. holding for
// 2s, which opens the full code picker right away when the reason IS known.
const PEND_DQ_CODE = "PEND";
const isPendingDq = (d) => (d.dqs || []).some((q) => q.code === PEND_DQ_CODE);
const isScratched = (d) => !!(d && d.scratched);
const isNoShow = (d) => !!(d && d.noshow);
const dqLabel = (d) => (d.dqs || []).map((q) => q.code).join(",");

function categorize(name) { const n = (name||"").toLowerCase();
  if (n.includes("medley relay")) return "Medley Relay";
  if (n.includes("free relay") || (n.includes("relay") && n.includes("free"))) return "Free Relay";
  if (n.includes("relay")) return "Medley Relay";
  if (n.includes("fly") || n.includes("butterfly")) return "Fly";
  if (n.includes("back")) return "Back";
  if (n.includes("breast")) return "Breast";
  if (/\bim\b/.test(n) || n.includes("individual medley")) return "IM";
  if (n.includes("free")) return "Free"; return "Free"; }
const CATS = ["Medley Relay", "Fly", "Back", "IM", "Breast", "Free", "Free Relay"];
const isRelayEvent = (name) => /relay/i.test(name || "");
const shortEvent = (name) => { let s = (name||"").trim(); s = s.replace(/^(girls|boys|mixed|women|men)\s+/i, ""); s = s.replace(/^(\d+\s*&\s*(under|over|u)\b|\d+\s*-\s*\d+|\d+\s*&\s*u)\s*/i, ""); s = s.replace(/\byard\s+/i, ""); return s.trim(); };
// How many taps the live race-clock stopwatch expects for this event before
// it records the final time: 100 IM = 4 (one per stroke leg), 100 free = 2
// (a 50 split + finish), 100/200 relays = 4 (one per swimmer) — everything
// else is a single tap to stop the clock and record the time.
function requiredTapsFor(name) {
  const n = (name || "").toLowerCase();
  if (isRelayEvent(n)) return 4;
  if (/\bim\b|individual medley/.test(n) && /\b100\b/.test(n)) return 4;
  if (/free/.test(n) && /\b100\b/.test(n)) return 2;
  return 1;
}

function eventList(ev, evIdx, data) { const out = []; ev.heats.forEach((ht, htIdx) => ht.lanes.forEach((l) => { const id = entryId(evIdx, htIdx, l.lane); const d = data[id] || {}; out.push({ id, l, secs: toSeconds(d.time), dq: hasDq(d), scr: isScratched(d), ns: isNoShow(d), time: d.time }); })); return out; }
// Everyone in the given age group across the whole season, ranked by Power —
// used by the popover's age-chip drill-down so "open the ranks for age
// group" shows an actual leaderboard rather than just a name list.
function ageGroupPowerRoster(seasonMeets, ageGroup) {
  return Object.values(computePower(seasonMeets || [], { ageGroup })).sort((a, b) => (b.power ?? -1) - (a.power ?? -1));
}
function rankedEvent(ev, evIdx, data, filter) { const relay = isRelayEvent(ev.name); let list = eventList(ev, evIdx, data).filter((e) => !isNaN(e.secs) && !e.dq && !e.scr && !e.ns); if (filter) list = list.filter((e) => filter.includes(e.l.team)); if (relay) list = list.filter((e) => e.l.relay === "A"); list.sort((a, b) => a.secs - b.secs); return list; }
function computePlaces(events, data, filter, mode) { if (mode === "timetrial") return {}; const map = {}; events.forEach((ev, evIdx) => rankedEvent(ev, evIdx, data, filter).forEach((e, i) => (map[e.id] = i + 1))); return map; }
// Place within a single heat (used live on the board before an event is final).
function computeHeatPlaces(ev, evIdx, htIdx, data, filter) {
  const ht = ev && ev.heats[htIdx]; if (!ht) return {};
  let list = ht.lanes.map((l) => { const id = entryId(evIdx, htIdx, l.lane), d = data[id] || {}; return { id, l, secs: toSeconds(d.time), dq: hasDq(d) }; }).filter((e) => !isNaN(e.secs) && !e.dq);
  if (filter) list = list.filter((e) => filter.includes(e.l.team));
  if (isRelayEvent(ev.name)) list = list.filter((e) => e.l.relay === "A");
  list.sort((a, b) => a.secs - b.secs); const map = {}; list.forEach((e, i) => (map[e.id] = i + 1)); return map;
}
function computeScores(events, data, mode, filter) { const table = mode === "champs" ? CHAMPS : DUAL; const pts = {}, swims = {}, imp = {}; if (mode === "timetrial") return { pts, swims, imp };
  events.forEach((ev, evIdx) => { const relay = isRelayEvent(ev.name);
    rankedEvent(ev, evIdx, data, filter).forEach((e, i) => { const p = (table[i+1] || 0) * (relay ? 2 : 1); pts[e.l.team] = (pts[e.l.team] || 0) + p; });
    eventList(ev, evIdx, data).forEach((e) => { if (isNaN(e.secs)) return; if (filter && !filter.includes(e.l.team)) return; swims[e.l.team] = (swims[e.l.team] || 0) + 1; if (!e.dq && isBest(data[e.id]?.time, e.l.seed)) imp[e.l.team] = (imp[e.l.team] || 0) + 1; }); });
  return { pts, swims, imp }; }
// An event is finished when every entered lane has a time or a DQ (and ≥1 time).
function eventFinished(ev, evIdx, data, filter) {
  let entered = 0, done = 0, timed = 0;
  eventList(ev, evIdx, data).forEach((e) => { if (filter && !filter.includes(e.l.team)) return; entered++; if (!isNaN(e.secs) || e.dq) done++; if (!isNaN(e.secs)) timed++; });
  return entered > 0 && timed > 0 && done === entered;
}

const AGE_GROUPS = ["6u", "7-8", "9-10", "11-12", "13-14", "15-18"];
function ageGroupOf(age) { if (!age || age <= 0) return null; if (age <= 6) return "6u"; if (age <= 8) return "7-8"; if (age <= 10) return "9-10"; if (age <= 12) return "11-12"; if (age <= 14) return "13-14"; return "15-18"; }
const MIXED_GROUPS = ["6u", "15-18"]; // relays here are 2 boys + 2 girls
// Gender + age group from an event name, for grouping.
function evGender(name) { const n = (name || "").toLowerCase(); if (n.startsWith("girls") || n.includes(" girls")) return "Girls"; if (n.startsWith("boys") || n.includes(" boys")) return "Boys"; return "Mixed"; }
function evAgeGroup(name) { const n = name || ""; if (/6\s*&\s*under|\b6u\b/i.test(n)) return "6u"; const m = n.match(/(\d+)\s*-\s*(\d+)/); if (m) return `${m[1]}-${m[2]}`; return "Open"; }

// Points earned by each individual swimmer (relays credited to the relay entry).
function computeSwimmerPoints(events, data, mode, filter) {
  const table = mode === "champs" ? CHAMPS : DUAL; const out = {};
  events.forEach((ev, evIdx) => { if (isRelayEvent(ev.name)) return;
    rankedEvent(ev, evIdx, data, filter).forEach((e, i) => {
      const pts = (table[i + 1] || 0); if (!pts) return;
      const key = e.l.name + "|" + e.l.team;
      (out[key] || (out[key] = { name: e.l.name, team: e.l.team, age: e.l.age, gender: evGender(ev.name), pts: 0, count: 0, events: [] }));
      if (e.l.age) out[key].age = e.l.age;
      out[key].pts += pts; out[key].count++; out[key].events.push({ ev: ev.name, place: i + 1, pts, time: e.time });
    });
  });
  return out;
}
// Best single-swim improvement (seed − final, seconds) per swimmer.
function computeImprovements(events, data, team) {
  const out = {};
  events.forEach((ev, evIdx) => { if (isRelayEvent(ev.name)) return;
    ev.heats.forEach((ht, htIdx) => ht.lanes.forEach((l) => { if (team && l.team !== team) return;
      const d = data[entryId(evIdx, htIdx, l.lane)] || {}; const fs = toSeconds(d.time), ss = toSeconds(l.seed);
      if (isNaN(fs) || isNaN(ss)) return; const drop = ss - fs; // positive = improved
      const key = l.name + "|" + l.team;
      if (!out[key] || drop > out[key].drop) out[key] = { name: l.name, team: l.team, age: l.age, gender: evGender(ev.name), drop, ev: shortEvent(ev.name), seed: l.seed, time: d.time };
    }));
  });
  return out;
}
// Per-swimmer season-so-far aggregate across individual events (this meet).
function computeLeague(events, data, mode, filter) {
  const table = mode === "champs" ? CHAMPS : DUAL; const sw = {};
  events.forEach((ev, evIdx) => { if (isRelayEvent(ev.name)) return;
    const ranked = rankedEvent(ev, evIdx, data, filter); const placeOf = {}; ranked.forEach((e, i) => (placeOf[e.id] = i + 1));
    ev.heats.forEach((ht, htIdx) => ht.lanes.forEach((l) => { const id = entryId(evIdx, htIdx, l.lane), d = data[id] || {};
      const key = l.name + "|" + l.team; (sw[key] || (sw[key] = { name: l.name, team: l.team, age: l.age, gender: evGender(ev.name), events: [], pts: 0 }));
      const place = placeOf[id], pts = place ? (table[place] || 0) : 0; sw[key].pts += pts; if (l.age) sw[key].age = l.age;
      const fs = toSeconds(d.time), ss = toSeconds(l.seed), improve = (!isNaN(fs) && !isNaN(ss)) ? ss - fs : null;
      sw[key].events.push({ ev: shortEvent(ev.name), cat: categorize(ev.name), seed: l.seed, time: d.time || "", place, pts, improve });
    }));
  });
  return sw;
}

// ---- Relay builder: season-wide roster + best-time lookups -----------------
// Every team + swimmer seen across a set of meets, with best-known age.
function seasonRoster(meets, team) {
  const seen = new Map();
  meets.forEach((m) => (m.events || []).forEach((ev) => ev.heats.forEach((ht) => ht.lanes.forEach((l) => {
    if (l.swimmers) { if (l.team === team) l.swimmers.forEach((s) => { if (!s.name) return; const prev = seen.get(s.name); if (!prev || (s.age && !prev.age)) seen.set(s.name, { name: s.name, age: s.age || (prev && prev.age) || 0, team }); }); return; }
    if (l.team === team && l.name) { const prev = seen.get(l.name); if (!prev || (l.age && !prev.age)) seen.set(l.name, { name: l.name, age: l.age || (prev && prev.age) || 0, team }); }
  }))));
  return [...seen.values()];
}
// Infer gender from any Girls/Boys-labeled event across the whole season.
function seasonGenderMap(meets) {
  const map = {};
  meets.forEach((m) => (m.events || []).forEach((ev) => { const g = evGender(ev.name); if (g === "Mixed") return;
    ev.heats.forEach((ht) => ht.lanes.forEach((l) => { if (l.swimmers) l.swimmers.forEach((s) => (map[s.name + "|" + l.team] = g)); else map[l.name + "|" + l.team] = g; })); }));
  return map;
}
// Best known time for a swimmer in a stroke category across a set of meets
// (final if swum, else seed) — the season-wide counterpart to bestStrokeSeed.
// Also checks their recorded relay-leg splits in that stroke (see
// swimmerRelaySplitBest below), since a fast split is real evidence of pace
// even when they haven't swum that stroke as an individual event.
function seasonBestStroke(meets, name, team, cat) {
  let best = Infinity;
  meets.forEach((m) => (m.events || []).forEach((ev, ei) => { if (isRelayEvent(ev.name) || categorize(ev.name) !== cat) return;
    ev.heats.forEach((ht, hi) => ht.lanes.forEach((l) => { if (l.name !== name || l.team !== team) return;
      const d = (m.data || {})[entryId(ei, hi, l.lane)] || {}; const t = toSeconds(d.time), s = toSeconds(l.seed), v = !isNaN(t) ? t : s;
      if (!isNaN(v) && v < best) best = v; })); }));
  const splitBest = swimmerRelaySplitBest(meets, name, team, cat);
  if (splitBest != null && splitBest < best) best = splitBest;
  return isFinite(best) ? best : null;
}
// A swimmer's best split time in a stroke, pulled from relay legs they've
// actually swum — free relay legs are always Free, medley legs map by
// position (MEDLEY_LEGS). Lets relay leg-time estimates (and the season-best
// lookup above) draw on real race splits, not just individual-event times.
function swimmerRelaySplitBest(meets, name, team, stroke) {
  let best = Infinity;
  meets.forEach((m) => (m.events || []).forEach((ev, ei) => { if (!isRelayEvent(ev.name)) return;
    const isMedley = /medley/i.test(ev.name);
    ev.heats.forEach((ht, hi) => ht.lanes.forEach((l) => { if (!l.swimmers || l.team !== team) return;
      l.swimmers.forEach((s, leg) => { if (s.name !== name) return;
        const legStroke = isMedley ? (MEDLEY_LEGS[leg] || "Free") : "Free";
        if (legStroke !== stroke) return;
        const d = (m.data || {})[entryId(ei, hi, l.lane)] || {}; const sp = toSeconds((d.splits || [])[leg]);
        if (!isNaN(sp) && sp < best) best = sp; }); })); }));
  return isFinite(best) ? best : null;
}
// 15-18 has no individual 50 free on the program — only 100 free — and 15-18
// relays are never swum as 100s, so estimate the 50-pace from half their 100
// free time minus a cut for the flying relay start (faster than a paced 100
// split). The cut is scaled off the swimmer's own improvement trend rather
// than a flat gender-based rate, and capped at 10% so it never over-credits
// a swimmer with little or no improvement history. Prefers an actual
// recorded relay split from a "Relay splits" entry, when there is one.
function estimate1518Free50(meets, name, team, gender) {
  const splitBestRaw = swimmerRelaySplitBest(meets, name, team, "Free");
  const splitBest = splitBestRaw != null ? splitBestRaw : Infinity;
  let hundredBest = Infinity;
  meets.forEach((m) => (m.events || []).forEach((ev, ei) => { if (isRelayEvent(ev.name) || categorize(ev.name) !== "Free" || !/\b100\b/.test(ev.name)) return;
    ev.heats.forEach((ht, hi) => ht.lanes.forEach((l) => { if (l.name !== name || l.team !== team) return;
      const d = (m.data || {})[entryId(ei, hi, l.lane)] || {}; const t = toSeconds(d.time), s = toSeconds(l.seed), v = !isNaN(t) ? t : s;
      if (!isNaN(v) && v < hundredBest) hundredBest = v; })); }));
  let estimated = Infinity;
  if (isFinite(hundredBest)) {
    const cut = Math.min(0.10, Math.max(0, swimmerImprovementStats(name, team, "Free", meets).mean));
    estimated = (hundredBest / 2) * (1 - cut);
  }
  const best = Math.min(splitBest, estimated);
  return isFinite(best) ? best : null;
}
// Best relay-leg time for a swimmer in a stroke, age-group aware (routes
// 15-18 Free through the 100-free estimate instead of a nonexistent 50 seed).
function bestLegTime(meets, name, team, stroke, ageGroup, gender) {
  if (stroke === "Free" && ageGroup === "15-18") return estimate1518Free50(meets, name, team, gender);
  return seasonBestStroke(meets, name, team, stroke);
}
const MEDLEY_LEGS = ["Back", "Breast", "Fly", "Free"];
// Core mixed-medley optimizer: 2 girls + 2 boys, Free leg always a girl (house
// rule). Searches which of Back/Breast/Fly the second girl covers, and how
// the two boys split the remaining two strokes, picking the fastest total —
// e.g. if the girl who's best at Breast is unavailable, this can shift a boy
// into Breast and slot the second girl into Back instead.
function optimalMixedMedley(roster, timeOf) {
  const girls = roster.filter((c) => c.gender === "Girls");
  const boys = roster.filter((c) => c.gender === "Boys");
  const girlsWithFree = girls.map((g) => ({ ...g, free: timeOf(g.name, "Free") })).filter((g) => g.free != null).sort((a, b) => a.free - b.free);
  if (!girlsWithFree.length || boys.length < 2) return null;
  const NONFREE = ["Back", "Breast", "Fly"];
  let bestPlan = null;
  girlsWithFree.slice(0, 5).forEach((freeGirl, fi) => {
    const remainingGirls = girlsWithFree.filter((_, i) => i !== fi);
    remainingGirls.slice(0, 5).forEach((g2) => {
      NONFREE.forEach((girlStroke) => {
        const gTime = timeOf(g2.name, girlStroke); if (gTime == null) return;
        const boyStrokes = NONFREE.filter((s) => s !== girlStroke);
        [[boyStrokes[0], boyStrokes[1]], [boyStrokes[1], boyStrokes[0]]].forEach(([sA, sB]) => {
          const boyTimesA = boys.map((b) => ({ ...b, s: timeOf(b.name, sA) })).filter((b) => b.s != null).sort((a, b) => a.s - b.s);
          boyTimesA.slice(0, 3).forEach((boyA) => {
            const boyTimesB = boys.filter((b) => b.name !== boyA.name).map((b) => ({ ...b, s: timeOf(b.name, sB) })).filter((b) => b.s != null).sort((a, b) => a.s - b.s);
            if (!boyTimesB.length) return;
            const boyB = boyTimesB[0];
            const legs = new Array(4);
            legs[MEDLEY_LEGS.indexOf("Free")] = { name: freeGirl.name, age: freeGirl.age, gender: "Girls", stroke: "Free", s: freeGirl.free };
            legs[MEDLEY_LEGS.indexOf(girlStroke)] = { name: g2.name, age: g2.age, gender: "Girls", stroke: girlStroke, s: gTime };
            legs[MEDLEY_LEGS.indexOf(sA)] = { name: boyA.name, age: boyA.age, gender: "Boys", stroke: sA, s: boyA.s };
            legs[MEDLEY_LEGS.indexOf(sB)] = { name: boyB.name, age: boyB.age, gender: "Boys", stroke: sB, s: boyB.s };
            const total = legs.reduce((a, l) => a + l.s, 0);
            if (!bestPlan || total < bestPlan.total) bestPlan = { legs, total };
          });
        });
      });
    });
  });
  return bestPlan;
}
// Single-gender medley: greedily match the fastest available (swimmer,
// stroke) pairs first, so a scratch naturally reshuffles who swims what.
function optimalMedley(roster, timeOf) {
  const candidates = [];
  roster.forEach((c) => MEDLEY_LEGS.forEach((stroke) => { const t = timeOf(c.name, stroke); if (t != null) candidates.push({ name: c.name, age: c.age, gender: c.gender, stroke, s: t }); }));
  candidates.sort((a, b) => a.s - b.s);
  const usedPeople = new Set(), usedStrokes = new Set();
  const legs = new Array(4).fill(null);
  candidates.forEach((c) => { if (usedPeople.has(c.name) || usedStrokes.has(c.stroke)) return;
    legs[MEDLEY_LEGS.indexOf(c.stroke)] = c; usedPeople.add(c.name); usedStrokes.add(c.stroke); });
  return legs.every(Boolean) ? { legs, total: legs.reduce((a, l) => a + l.s, 0) } : null;
}
function allSeasonTeams(meets) { return [...new Set(meets.flatMap((m) => (m.events || []).flatMap((ev) => ev.heats.flatMap((ht) => ht.lanes.map((l) => l.team)))))]; }

// Fastest 4-person FREE relay per team for an age group (+ gender, unless
// mixed). excludeByTeam(team) optionally returns a Set of names to leave out
// of the pool — used to keep a swimmer already locked into this team's A
// relay for the OTHER stroke type from being auto-picked into this one too.
function buildFreeRelaysSeason(meets, ageGroup, gender, excludeByTeam) {
  const genderMap = seasonGenderMap(meets);
  const mixed = MIXED_GROUPS.includes(ageGroup);
  return allSeasonTeams(meets).map((team) => {
    const excl = excludeByTeam ? excludeByTeam(team) : null;
    const roster = seasonRoster(meets, team).filter((c) => ageGroupOf(c.age) === ageGroup && (!excl || !excl.has(c.name)))
      .map((c) => ({ ...c, gender: genderMap[c.name + "|" + team] }));
    const timed = roster.filter((c) => mixed || !c.gender || c.gender === gender)
      .map((c) => ({ ...c, s: bestLegTime(meets, c.name, team, "Free", ageGroup, c.gender || gender) })).filter((c) => c.s != null);
    let picked;
    if (mixed) {
      const girls = timed.filter((x) => x.gender === "Girls").sort((a, b) => a.s - b.s).slice(0, 2);
      const boys = timed.filter((x) => x.gender === "Boys").sort((a, b) => a.s - b.s).slice(0, 2);
      picked = [...girls, ...boys];
      if (picked.length < 4) { const used = new Set(picked.map((p) => p.name)); picked = [...picked, ...timed.filter((x) => !used.has(x.name)).sort((a, b) => a.s - b.s)].slice(0, 4); }
      // Anchor (last leg) is always the fastest available boy; girls or boys
      // can fill the other legs, ordered fastest-to-slowest.
      const anchorIdx = picked.reduce((best, p, i) => (p.gender === "Boys" && (best < 0 || p.s < picked[best].s) ? i : best), -1);
      if (anchorIdx >= 0) { const anchor = picked[anchorIdx]; picked = [...picked.filter((_, i) => i !== anchorIdx).sort((a, b) => a.s - b.s), anchor]; }
      else picked.sort((a, b) => a.s - b.s);
    } else {
      picked = timed.sort((a, b) => a.s - b.s).slice(0, 4);
    }
    return { team, event: "Free", swimmers: picked, total: picked.reduce((a, b) => a + b.s, 0), full: picked.length === 4 };
  }).filter((r) => r.full).sort((a, b) => a.total - b.total);
}
// Fastest 4-person MEDLEY relay per team for an age group (+ gender, unless
// mixed). Same excludeByTeam gate as buildFreeRelaysSeason, for the reverse
// direction (locked into the Free A relay, excluded from Medley auto-pick).
function buildMedleyRelaysSeason(meets, ageGroup, gender, excludeByTeam) {
  const genderMap = seasonGenderMap(meets);
  const mixed = MIXED_GROUPS.includes(ageGroup);
  const timeOf = (meets_, team) => (name, stroke) => bestLegTime(meets_, name, team, stroke, ageGroup, genderMap[name + "|" + team]);
  return allSeasonTeams(meets).map((team) => {
    const excl = excludeByTeam ? excludeByTeam(team) : null;
    const roster = seasonRoster(meets, team).filter((c) => ageGroupOf(c.age) === ageGroup && (!excl || !excl.has(c.name)))
      .map((c) => ({ ...c, gender: genderMap[c.name + "|" + team] }));
    const of = timeOf(meets, team);
    const plan = mixed ? optimalMixedMedley(roster, of) : optimalMedley(roster.filter((c) => !c.gender || c.gender === gender), of);
    if (!plan) return { team, event: "Medley", swimmers: [], total: null, full: false };
    return { team, event: "Medley", swimmers: plan.legs, total: plan.total, full: true };
  }).filter((r) => r.full).sort((a, b) => a.total - b.total);
}
// Merge an uploaded results sheet (final times by name+event) for chosen teams.
function mergeResults(parsedEvents, targetEvents, teamsToApply, homeTeam) {
  const patch = {}; let matched = 0;
  const idx = {}; // "evnum|name" -> {evIdx, htIdx, lane, team}
  targetEvents.forEach((ev, evIdx) => ev.heats.forEach((ht, htIdx) => ht.lanes.forEach((l) => { idx[ev.num + "|" + l.name.toLowerCase()] = { evIdx, htIdx, lane: l.lane, team: l.team }; })));
  parsedEvents.forEach((ev) => ev.heats.forEach((ht) => ht.lanes.forEach((l) => {
    const hit = idx[ev.num + "|" + l.name.toLowerCase()];
    if (!hit || (teamsToApply && !teamsToApply.includes(hit.team))) return;
    const id = entryId(hit.evIdx, hit.htIdx, hit.lane);
    // DQ rows only get flagged for our own team — a pending DQ requiring the
    // coach to pick the reason via the usual DQ button, same as a live tap.
    // A DQ'd swim can still have a recorded time on the sheet (the swim
    // happened, it just didn't count) — keep that time too instead of
    // discarding it, same as a DQ entered live with a time already typed in.
    if (l.dq) { if (hit.team === homeTeam) {
      const dqTime = l.finalTime || l.seed;
      patch[id] = { ...(patch[id] || {}), ...(!isNaN(toSeconds(dqTime)) ? { time: dqTime } : {}), dqs: [{ code: PEND_DQ_CODE, reason: "Reason pending — awaiting DQ slip", group: "Pending" }] }; matched++;
    } return; }
    if (toSeconds(l.finalTime || l.seed) && !isNaN(toSeconds(l.finalTime || l.seed))) {
      patch[id] = { ...(patch[id] || {}), time: l.finalTime || l.seed }; matched++;
    }
  })));
  return { patch, matched };
}

function buildGrid(events, data, myTeam, places, records) { const rows = {}, order = [];
  const addCell = (name, cat, cell) => { if (!rows[name]) { rows[name] = {}; order.push(name); } (rows[name][cat] || (rows[name][cat] = [])).push(cell); };
  events.forEach((ev, evIdx) => { const cat = categorize(ev.name), evShort = shortEvent(ev.name), rec = records[ev.id];
    ev.heats.forEach((ht, htIdx) => ht.lanes.forEach((l) => { if (l.team !== myTeam) return; const id = entryId(evIdx, htIdx, l.lane), d = data[id] || {};
      const parts = []; if (places[id]) parts.push(ORD(places[id])); if (d.time) parts.push(d.time + (isBest(d.time, l.seed) ? " B" : "") + (brokeRecord(d.time, rec) ? " BR" : "")); if (hasDq(d)) parts.push("DQ " + dqLabel(d));
      const cm = []; if (d.tags) cm.push(...Object.keys(d.tags)); if (d.notes) cm.push(d.notes);
      const suffix = (parts.length ? ": " + parts.join(", ") : "") + (cm.length ? " — " + cm.join("; ") : "");
      if (l.swimmers && l.swimmers.length) { // relay → one cell per named swimmer, led by their split
        l.swimmers.forEach((s, si) => { const bits = [];
          if (d.splits && d.splits[si]) bits.push("split " + d.splits[si]);
          if (places[id]) bits.push(ORD(places[id]));
          if (d.time) bits.push("team " + d.time + (brokeRecord(d.time, rec) ? " BR" : ""));
          if (hasDq(d)) bits.push("DQ " + dqLabel(d));
          addCell(s.name, cat, evShort + (bits.length ? ": " + bits.join(", ") : "")); });
      } else { addCell(l.name, cat, evShort + suffix); }
    })); });
  const matrix = [["Swimmer", ...CATS]]; order.forEach((name) => matrix.push([name, ...CATS.map((c) => (rows[name][c] || []).join(" | "))])); return matrix; }
const toTSV = (m) => m.map((r) => r.map((c) => String(c).replace(/[\t\n]/g, " ")).join("\t")).join("\n");
const toCSV = (m) => m.map((r) => r.map((c) => { const s = String(c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",")).join("\n");

// ---- PDF reader: de-columns the Hy-Tek multi-column meet program ----------
async function ensurePdfjs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  return window.pdfjsLib;
}
async function pdfToText(file) {
  const lib = await ensurePdfjs();
  const buf = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: buf }).promise;
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  let out = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter((it) => it.str && it.str.trim()).map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5] }));
    if (!items.length) { out += "\n"; continue; }
    const anchors = items.filter((it) => /^(Lane|VCSL|Heat|#\d)/.test(it.s.trim())).map((it) => it.x).sort((a, b) => a - b);
    let cols = [];
    if (anchors.length) { let cur = [anchors[0]]; for (let i = 1; i < anchors.length; i++) { if (anchors[i] - cur[cur.length - 1] > 60) { cols.push(avg(cur)); cur = [anchors[i]]; } else cur.push(anchors[i]); } cols.push(avg(cur)); }
    if (!cols.length) cols = [Math.min(...items.map((i) => i.x))];
    const colOf = (it) => { let k = 0; for (let i = 0; i < cols.length; i++) if (it.x >= cols[i] - 12) k = i; return k; };
    const buck = {};
    items.forEach((it) => (buck[colOf(it)] || (buck[colOf(it)] = [])).push(it));
    Object.keys(buck).map(Number).sort((a, b) => a - b).forEach((k) => {
      const ws = buck[k].slice().sort((a, b) => b.y - a.y);
      let curY = null, row = [];
      const flush = () => { if (row.length) out += row.sort((a, b) => a.x - b.x).map((t) => t.s).join(" ").replace(/\s+/g, " ").trim() + "\n"; row = []; };
      ws.forEach((it) => { if (curY === null || Math.abs(it.y - curY) <= 3) { row.push(it); if (curY === null) curY = it.y; } else { flush(); row = [it]; curY = it.y; } });
      flush();
    });
    out += "\n";
  }
  return out;
}

const fmtT = (s) => { if (isNaN(s)) return "—"; const m = Math.floor(s / 60); const sec = s - m * 60; return m > 0 ? `${m}:${sec.toFixed(2).padStart(5, "0")}` : sec.toFixed(2); };

// Digital MM:SS clock counting up from when the race starts. `stopped`
// freezes it (heat complete) instead of hiding it, so the coach can still
// see how long the heat took; ticking is driven by our own state (not a
// live Date.now() read on every render) so it doesn't creep forward once frozen.
function RaceClockDisplay({ startedAt, stopped }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (stopped) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [stopped, startedAt]);
  const elapsedSec = Math.max(0, (now - startedAt) / 1000);
  const m = Math.floor(elapsedSec / 60), s = Math.floor(elapsedSec % 60);
  return <div className={"md-raceclock" + (stopped ? " stopped" : "")}>{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}</div>;
}

// Relay splits — floating (not full-screen). One card per relay lane, in lane
// order, with the four legs vertical, current leg highlighted, split entry.
function RelaySplitsPanel({ heat, evIdx, htIdx, scopeLane, data, homeTeam, onClose, update, get, openPop, clockActive }) {
  const relays = heat.lanes.filter((l) => l.swimmers && l.team === homeTeam && (scopeLane == null || l.lane === scopeLane)).sort((a, b) => a.lane - b.lane);
  // Running order across EVERY team in the heat (not just home), from
  // whatever's been recorded so far: a finished relay ranks on its final
  // time; an in-progress one ranks by legs completed, then by cumulative
  // split time as a tiebreak among relays on the same leg.
  const standings = useMemo(() => {
    const rankOf = (l) => { const d = get(entryId(evIdx, htIdx, l.lane)); const splits = d.splits || []; const t = toSeconds(d.time);
      if (!isNaN(t)) return { legs: 4, cum: t, done: true };
      return { legs: splits.filter(Boolean).length, cum: splits.reduce((s, x) => s + (toSeconds(x) || 0), 0), done: false }; };
    return heat.lanes.filter((l) => l.swimmers).map((l) => ({ team: l.team, ...rankOf(l) })).filter((x) => x.legs > 0)
      .sort((a, b) => b.legs - a.legs || a.cum - b.cum);
  }, [heat, data]);
  const homePlace = standings.findIndex((x) => x.team === homeTeam) + 1 || null;
  const relayTap = (id, splits) => { if (!clockActive) return;
    const leg = splits.length, elapsedSec = (Date.now() - clockActive.startedAt) / 1000;
    const prevCum = splits.reduce((s, x) => s + (toSeconds(x) || 0), 0);
    const legSec = Math.max(0, elapsedSec - prevCum);
    const ns = [...splits]; ns[leg] = fmtT(legSec);
    if (leg >= 3) update(id, { splits: ns, time: fmtT(elapsedSec) }); else update(id, { splits: ns });
  };
  // Floating, non-blocking popover pinned to the top of the meet sheet (the
  // .md-right column) — no scrim, so the meet sheet stays scrollable and
  // tappable underneath. Measured live so it tracks the actual layout
  // instead of a hardcoded pixel offset, and its own height is clamped so it
  // never runs off the bottom of the viewport.
  const [rect, setRect] = useState(null);
  useLayoutEffect(() => {
    const el = document.querySelector(".md-right");
    if (!el) return;
    const measure = () => setRect(el.getBoundingClientRect());
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  useEffect(() => { const h = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  const m = 10, vh = window.innerHeight;
  const top = rect ? rect.top + m : 60;
  const style = rect ? { left: rect.left + m, width: rect.width - m * 2, top, maxHeight: Math.max(160, vh - top - m) } : { left: "50%", transform: "translateX(-50%)", top, maxHeight: vh - top - m };
  return (
    <div className="md-splitpanel" style={style}>
      <div className="md-splithead"><span>🏊 Relay splits — {shortEvent(heat.eventName)} · H{heat.num}</span>{clockActive && <RaceClockDisplay startedAt={clockActive.startedAt} stopped={false} />}<button className="md-x sm" onClick={onClose}>✕</button></div>
      {standings.length > 0 && (
        scopeLane == null ? (
          <div className="md-splitstandings">
            {standings.slice(0, 3).map((s, i) => <span key={s.team} className={"md-standingchip" + (s.team === homeTeam ? " mine" : "")}>{ORD(i + 1)} <b style={{ color: teamColor(s.team) }}>{s.team}</b></span>)}
            {homePlace && homePlace > 3 && <span className="md-standingchip mine">{ORD(homePlace)} <b style={{ color: teamColor(homeTeam) }}>{homeTeam}</b></span>}
          </div>
        ) : (
          homePlace && <div className="md-splitstandings"><span className="md-standingchip mine">{homeTeam} currently <b>{ORD(homePlace)}</b></span></div>
        )
      )}
      <div className="md-splitgrid">
        {relays.map((l) => { const id = entryId(evIdx, htIdx, l.lane), d = get(id), splits = d.splits || [];
          return (
            <div key={l.lane} className={"md-splitcard" + (l.team === homeTeam ? " mine" : "")}>
              <div className="md-splitcardhead"><span className="md-splitlane">L{l.lane}</span><span className="md-splitteam" style={{ color: teamColor(l.team) }}>{l.team} {l.relay}</span>
                <input className="md-splittime" inputMode="decimal" placeholder="––.––" value={d.time || ""} onChange={(e) => update(id, { time: e.target.value })} /></div>
              <div className="md-legs">
                {l.swimmers.map((s, i) => (
                  <div key={i} className="md-leg">
                    <span className="md-legnum">{i + 1}</span>
                    <span className="md-legname">{s.name}{s.age ? ` (${s.age})` : ""}</span>
                    <input className="md-splitbox" inputMode="decimal" placeholder={`#${i + 1}`} value={splits[i] || ""} onChange={(e) => { const ns = splits.slice(); ns[i] = e.target.value; update(id, { splits: ns }); }} />
                    <button className="md-legnote" title="Notes / tags" onClick={(e) => openPop(id + "#" + i, e.currentTarget)}>✎</button>
                  </div>
                ))}
              </div>
              {clockActive && !d.time && <button className="md-nextleg tap" onClick={() => relayTap(id, splits)}>⏱ Tap — leg {splits.length + 1}/4</button>}
            </div>
          ); })}
        {!relays.length && <div className="md-prevempty">No {homeTeam} relay in this heat.</div>}
      </div>
    </div>
  );
}

// Import a results sheet and merge final times by name+event for chosen teams.
function ResultsModal({ onClose, events, homeTeam, onApply, onSaveNew }) {
  const [text, setText] = useState(""); const [busy, setBusy] = useState("");
  const parsed = useMemo(() => parseResults(text), [text]);
  const { patch, matched } = useMemo(() => mergeResults(parsed, events, null, homeTeam), [parsed, events, homeTeam]);
  const dqCount = useMemo(() => Object.values(patch).filter((p) => p.dqs).length, [patch]);
  const count = parsed.reduce((n, ev) => n + ev.heats[0].lanes.length, 0);
  const foundTeams = useMemo(() => { const s = new Set(); parsed.forEach((ev) => ev.heats[0].lanes.forEach((l) => s.add(l.team))); return [...s]; }, [parsed]);
  const [form, setForm] = useState(false);
  const [name, setName] = useState(""); const [mtype, setMtype] = useState("champs");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [host, setHost] = useState(""); const [away, setAway] = useState("");
  useEffect(() => { if (foundTeams.length && !host) setHost(foundTeams[0]); if (foundTeams.length > 1 && !away) setAway(foundTeams[1]); }, [foundTeams]);
  const onFile = async (e) => { const f = e.target.files?.[0]; if (!f) return;
    if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") { setBusy("Reading PDF…"); try { setText(await pdfToText(f)); setBusy(""); } catch { setBusy("Couldn't read the PDF — paste text."); } }
    else { const r = new FileReader(); r.onload = () => setText(String(r.result || "")); r.readAsText(f); } };
  const teamOpt = (t) => <option key={t} value={t}>{TEAM_NAME[t] || t}</option>;
  return (
    <div className="md-scrim" onClick={onClose}>
      <div className="md-modal md-imp" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="md-mhead"><button className="md-logo sm" onClick={onClose} aria-label="Home" title="MeetDeck — home">≈</button><div className="md-mheadtxt"><div className="md-mtitle">Import results sheet</div><div className="md-msub">Merge finals onto a loaded program, or save a whole new meet from results alone.</div></div><button className="md-x" onClick={onClose}>✕</button></div>
        <div className="md-impbar"><label className="md-filebtn">Choose file<input type="file" accept=".pdf,.txt,.csv,application/pdf,text/plain" onChange={onFile} hidden /></label><span className="md-impnote">{busy}</span></div>
        {form ? (
          <div className="md-newmeetform">
            <label className="md-mrow">Meet name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Belwood vs Oaktree — Jun 20" /></label>
            <label className="md-mrow">Meet date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="md-mrow">Meet type<select value={mtype} onChange={(e) => setMtype(e.target.value)}><option value="dual">Dual meet</option><option value="champs">Champs</option><option value="timetrial">Time trials</option></select></label>
            {mtype === "dual" && <label className="md-mrow">Home team (1st)<select value={host} onChange={(e) => setHost(e.target.value)}>{foundTeams.map(teamOpt)}</select></label>}
            {mtype === "dual" && <label className="md-mrow">Away team (2nd)<select value={away} onChange={(e) => setAway(e.target.value)}>{foundTeams.map(teamOpt)}</select></label>}
            <div className="md-newmeetnote">{count} results across {new Set(parsed.map((e) => e.num)).size} events will become this meet.</div>
          </div>
        ) : (
          <div className="md-impgrid">
            <textarea className="md-imparea" placeholder={"Paste results text…"} value={text} onChange={(e) => setText(e.target.value)} />
            <div className="md-preview"><div className="md-prevtop"><span>{parsed.length} events · {count} results · <b>{matched}</b> merge onto loaded meet{dqCount ? <> · <b className="md-impdqnote">{dqCount} DQ{dqCount > 1 ? "s" : ""}</b> found for {homeTeam}</> : null}</span></div>
              <div className="md-prevbody"><div className="md-prevempty">“Merge” fills finals onto the loaded program by event # + name. Any {homeTeam} row marked DQ on the sheet gets flagged as a pending DQ — pick the reason from the usual DQ button after merging — and keeps the time too if the sheet has one. “Save as new meet” builds and saves a fresh meet from just this results sheet.</div></div></div>
          </div>
        )}
        <div className="md-mfoot"><button className="md-cancel" onClick={form ? () => setForm(false) : onClose}>{form ? "Back" : "Cancel"}</button>
          {form
            ? <button className="md-apply" disabled={!count || !name.trim()} onClick={() => onSaveNew({ meet: resultsToMeet(parsed), name: name.trim(), date, mode: mtype, host, away })}>Save meet</button>
            : <>
              <button className="md-ghost2" disabled={!count} onClick={() => setForm(true)}>Save as new meet</button>
              <button className="md-apply" disabled={matched === 0} onClick={() => onApply(patch)}>Merge {matched} results</button>
            </>}
        </div>
      </div>
    </div>
  );
}

// Team stats: high points + most improved, grouped by age.
function StatsModal({ onClose, events, data, mode, filter, homeTeam }) {
  const pts = useMemo(() => computeSwimmerPoints(events, data, mode, filter), [events, data, mode, filter]);
  const imp = useMemo(() => computeImprovements(events, data, homeTeam), [events, data, homeTeam]);
  const ptByGrp = {}; Object.values(pts).filter((x) => x.team === homeTeam && x.pts > 0).sort((a, b) => b.pts - a.pts).forEach((x) => { const g = ageGroupOf(x.age) || "Open"; (ptByGrp[g] || (ptByGrp[g] = [])).push(x); });
  const impByGrp = {}; Object.values(imp).sort((a, b) => b.drop - a.drop).forEach((x) => { const g = ageGroupOf(x.age) || "Open"; (impByGrp[g] || (impByGrp[g] = [])).push(x); });
  const groups = AGE_GROUPS.filter((g) => ptByGrp[g] || impByGrp[g]);
  return (
    <div className="md-scrim" onClick={onClose}>
      <div className="md-modal md-imp" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="md-mhead"><button className="md-logo sm" onClick={onClose} aria-label="Home" title="MeetDeck — home">≈</button><div className="md-mheadtxt"><div className="md-mtitle">Meet stats — {homeTeam}</div><div className="md-msub">{mode === "timetrial" ? "Time trials" : mode === "champs" ? "Champs" : "Dual"} · by age group · live</div></div><button className="md-x" onClick={onClose}>✕</button></div>
        <div className="md-statwrap">
          <div className="md-statcol">
            <div className="md-stath">🏆 High points by age</div>
            {groups.some((g) => ptByGrp[g]) ? groups.map((g) => ptByGrp[g] && (<div key={g} className="md-agegrp"><div className="md-agehdr">{g}</div>
              {ptByGrp[g].map((x, i) => <div key={x.name} className="md-statrow"><span className="md-statrank">{i + 1}</span><span className="md-statname statid"><span className={"md-gpill sm " + (x.gender || "mixed").toLowerCase()}>{(x.gender || "?")[0]}</span>{x.name}{x.age ? <em className="md-statage">{x.age}</em> : null}</span><span className="md-statsub">{x.count} swim{x.count > 1 ? "s" : ""}</span><span className="md-statval gold">{x.pts}</span></div>)}
            </div>)) : <div className="md-prevempty">No points yet{mode === "timetrial" ? " (time trials don't score)" : ""}.</div>}
          </div>
          <div className="md-statcol">
            <div className="md-stath">📉 Most improved by age</div>
            {groups.some((g) => impByGrp[g]) ? groups.map((g) => impByGrp[g] && (<div key={g} className="md-agegrp"><div className="md-agehdr">{g}</div>
              {impByGrp[g].slice(0, 6).map((x) => <div key={x.name} className="md-statrow"><span className={"md-gpill " + x.gender.toLowerCase()}>{x.gender[0]}</span><span className="md-statname">{x.name}</span><span className="md-statsub">{x.ev}</span><span className="md-statval green">−{x.drop.toFixed(2)}</span></div>)}
            </div>)) : <div className="md-prevempty">No improvements yet — enter final times.</div>}
          </div>
        </div>
        <div className="md-mfoot"><button className="md-apply" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

// A swimmer's swims in one stroke category across a set of meets (progression).
function swimmerStrokeTimes(name, team, cat, meets) {
  const out = [];
  meets.forEach((m) => (m.events || []).forEach((ev, evIdx) => { if (isRelayEvent(ev.name) || categorize(ev.name) !== cat) return;
    ev.heats.forEach((ht, htIdx) => ht.lanes.forEach((l) => { if (l.name !== name || l.team !== team) return;
      const d = (m.data || {})[entryId(evIdx, htIdx, l.lane)] || {};
      out.push({ date: m.date || "", meet: m.meetName || "", ev: shortEvent(ev.name), seed: l.seed, final: d.time || "" });
    }));
  }));
  return out.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}
// The Progression display (unlike the projection math above, which wants
// every known time including seeds-only) should only show swims that
// actually happened, and never the same swim twice — which can otherwise
// happen once a live meet gets saved into the season and both copies feed
// the same progMeets list.
function completedStrokeProgression(list) {
  const seen = new Set(), out = [];
  list.forEach((t) => { if (!t.final) return;
    const key = t.ev + "|" + t.final + "|" + (t.seed || "");
    if (seen.has(key)) return; seen.add(key); out.push(t); });
  return out;
}

// Aggregate saved meets → per-swimmer season totals. Time-trial meets earn no
// points and are excluded from the improvement percentage.
function computeSeason(meets) {
  const sw = {};
  meets.forEach((m) => { const tt = m.mode === "timetrial"; const table = m.mode === "champs" ? CHAMPS : DUAL; const data = m.data || {};
    (m.events || []).forEach((ev, evIdx) => { if (isRelayEvent(ev.name)) return;
      const placeOf = {}; if (!tt) rankedEvent(ev, evIdx, data, null).forEach((e, i) => (placeOf[e.id] = i + 1));
      ev.heats.forEach((ht, htIdx) => ht.lanes.forEach((l) => { const id = entryId(evIdx, htIdx, l.lane), d = data[id] || {};
        const key = l.name + "|" + l.team; (sw[key] || (sw[key] = { name: l.name, team: l.team, age: l.age, gender: evGender(ev.name), pts: 0, swims: 0, improved: 0, meets: 0 }));
        if (l.age) sw[key].age = l.age;
        const fs = toSeconds(d.time), ss = toSeconds(l.seed);
        if (!tt) { const p = placeOf[id]; if (p) sw[key].pts += (table[p] || 0); if (!isNaN(fs)) { sw[key].swims++; if (!isNaN(ss) && fs < ss) sw[key].improved++; } }
      }));
    });
  });
  return sw;
}

// Season & league: aggregates all saved meets. High points + improvement %
// (improved swims / total swims, time trials excluded) by age group.
function SeasonModal({ onClose, homeTeam, meets }) {
  const [gender, setGender] = useState("All");
  const [grp, setGrp] = useState("All");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const list = meets || [];
  // Saved snapshots always carry an id; the live in-progress meet (merged in
  // by the caller) never does — use that to keep the "N saved meets" count
  // honest while still letting live data feed the stats below.
  const savedCount = list.filter((m) => m.id).length;
  const liveIncluded = list.length > savedCount;
  const agg = useMemo(() => computeSeason(list), [list]);
  const all = Object.values(agg).filter((s) => s.team === homeTeam);
  const match = (s) => (gender === "All" || s.gender === gender) && (grp === "All" || ageGroupOf(s.age) === grp);
  const hpByGrp = {}; all.filter(match).filter((s) => s.pts > 0).sort((a, b) => b.pts - a.pts)
    .forEach((s) => { const g = ageGroupOf(s.age) || "Open"; (hpByGrp[g] || (hpByGrp[g] = [])).push(s); });
  const impByGrp = {}; all.filter(match).filter((s) => s.swims > 0).map((s) => ({ ...s, pct: Math.round((s.improved / s.swims) * 100) })).sort((a, b) => b.pct - a.pct || b.swims - a.swims)
    .forEach((s) => { const g = ageGroupOf(s.age) || "Open"; (impByGrp[g] || (impByGrp[g] = [])).push(s); });
  const hpGroups = AGE_GROUPS.filter((g) => hpByGrp[g]);
  const groups = AGE_GROUPS.filter((g) => impByGrp[g]);
  // League standing for the banner — same source data (season-wide power +
  // dual-meet records) as the League page, so the numbers always agree.
  const standings = useMemo(() => computeStandings(list), [list]);
  const power = useMemo(() => computePower(list), [list]);
  const leagueTeams = useMemo(() => [...new Set(Object.values(power).map((s) => s.team))].sort(), [power]);
  const teamPowerOf = (t) => { const arr = Object.values(power).filter((s) => s.team === t && s.power != null); return arr.length ? Math.round(arr.reduce((a, b) => a + b.power, 0) / arr.length) : 0; };
  const stRows = useMemo(() => leagueTeams.map((t) => ({ team: t, ...(standings[t] || { w: 0, l: 0, tie: 0, pf: 0, pa: 0 }), power: teamPowerOf(t) })).sort(LEAGUE_SORTS.record), [leagueTeams, standings, power]);
  const myIdx = stRows.findIndex((r) => r.team === homeTeam);
  const myRow = myIdx >= 0 ? stRows[myIdx] : null;
  const filterOn = gender !== "All" || grp !== "All";
  return (
    <div className="md-scrim" onClick={onClose}>
      <div className="md-modal md-imp md-tsmodal" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="md-mhead"><button className="md-logo sm" onClick={onClose} aria-label="Home" title="MeetDeck — home">≈</button><div className="md-mheadtxt"><div className="md-mtitle">Team stats</div><div className="md-msub">Across {savedCount} saved meet{savedCount === 1 ? "" : "s"}{liveIncluded ? " + this meet (live)" : ""} · season</div></div><button className="md-x" onClick={onClose}>✕</button></div>
        <div className="md-tsbanner" style={{ background: `linear-gradient(135deg, ${teamColor(homeTeam)}, #0f2036)` }}>
          <div className="md-tsbannertop">
            <div className="md-tsbannerteam">{TEAM_NAME[homeTeam] || homeTeam}</div>
            <button className={"md-statsfilterbtn" + (filterOn ? " on" : "")} onClick={() => setFiltersOpen((o) => !o)}>⚙ Filters{filterOn ? " •" : ""}</button>
          </div>
          <div className="md-lgbannerstats">
            <div className="md-lgstat"><b>{myRow ? ORD(myIdx + 1) : "—"}</b><span>league rank</span></div>
            <div className="md-lgstat"><b>{myRow ? `${myRow.w}-${myRow.l}${myRow.tie ? "-" + myRow.tie : ""}` : "0-0"}</b><span>record</span></div>
            <div className="md-lgstat"><b>{myRow ? myRow.power : 0}</b><span>team power</span></div>
          </div>
        </div>
        {filtersOpen && (
          <div className="md-statsfilterpanel">
            <div className="md-cmpradiogrp"><span className="md-cmpchecklabel">Gender</span>{["All", "Girls", "Boys"].map((g) => <label key={g} className="md-cmpradio"><input type="checkbox" checked={gender === g} onChange={() => setGender(g)} />{g}</label>)}</div>
            <div className="md-cmpradiogrp"><span className="md-cmpchecklabel">Age group</span>{["All", ...AGE_GROUPS].map((g) => <label key={g} className="md-cmpradio"><input type="checkbox" checked={grp === g} onChange={() => setGrp(g)} />{g}</label>)}</div>
          </div>
        )}
        <div className="md-statwrap">
          <div className="md-statcol">
            <div className="md-stath">🏆 High points (season)</div>
            {hpGroups.length ? hpGroups.map((g) => (<div key={g} className="md-agegrp"><div className="md-agehdr">{g}</div>
              {hpByGrp[g].slice(0, 12).map((x, i) => <div key={x.name + x.team} className="md-statrow mine"><span className="md-statrank">{i + 1}</span><span className="md-statname statid"><span className={"md-gpill sm " + x.gender.toLowerCase()}>{x.gender[0]}</span>{x.name}</span><span className="md-statsub">{x.swims} swim{x.swims === 1 ? "" : "s"}</span><span className="md-statval gold">{x.pts}</span></div>)}
            </div>)) : <div className="md-prevempty">{list.length ? "No scored swims yet — enter finals then save." : "No saved meets yet — use “Save this meet to season” in Settings."}</div>}
          </div>
          <div className="md-statcol">
            <div className="md-stath">📈 Improvement % by age</div>
            {groups.length ? groups.map((g) => (<div key={g} className="md-agegrp"><div className="md-agehdr">{g}</div>
              {impByGrp[g].slice(0, 8).map((x) => <div key={x.name + x.team} className="md-statrow mine"><span className={"md-gpill " + x.gender.toLowerCase()}>{x.gender[0]}</span><span className="md-statname">{x.name}</span><span className="md-statsub">{x.improved}/{x.swims} swims</span><span className="md-statval green">{x.pct}%</span></div>)}
            </div>)) : <div className="md-prevempty">No non-time-trial swims yet.</div>}
          </div>
        </div>
        <div className="md-mfoot"><button className="md-apply" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

// League browser: every swimmer, filter by team/age/gender, tap for stats.
// Everyone entered in the meet — individual entries AND named relay legs — for
// the scratch screen. A relay leg's id is the relay entry id + "#" + leg index,
// the same addressing ActionPopover/RelaySplitsPanel already use for per-swimmer
// data on a relay (tags, notes, DQs), so scratching one just writes to that id.
function computeParticipants(events, data) {
  const sw = {};
  events.forEach((ev, ei) => ev.heats.forEach((ht, hi) => ht.lanes.forEach((l) => {
    if (l.swimmers) {
      l.swimmers.forEach((s, leg) => {
        const id = entryId(ei, hi, l.lane) + "#" + leg, key = s.name + "|" + l.team;
        (sw[key] || (sw[key] = { name: s.name, team: l.team, age: s.age, entries: [] }));
        if (s.age) sw[key].age = s.age;
        sw[key].entries.push({ id, ev: shortEvent(ev.name), scratched: isScratched(data[id] || {}), relay: true, relayLabel: l.relay, evIdx: ei, htIdx: hi, relayLane: l.lane, leg });
        // A swap leaves the outgoing swimmer off the roster entirely — surface
        // a read-only "scratched, replaced by X" entry for them too.
        const sub = (data[id] || {}).subFor;
        if (sub && sub.name) {
          const gkey = sub.name + "|" + l.team;
          (sw[gkey] || (sw[gkey] = { name: sub.name, team: l.team, age: sub.age, entries: [] }));
          sw[gkey].entries.push({ id: id + ":ghost", legId: id, ev: shortEvent(ev.name), scratched: true, relay: true, relayLabel: l.relay, ghost: true, replacedBy: s.name });
        }
      });
      return;
    }
    const id = entryId(ei, hi, l.lane), key = l.name + "|" + l.team;
    (sw[key] || (sw[key] = { name: l.name, team: l.team, age: l.age, entries: [] }));
    if (l.age) sw[key].age = l.age;
    sw[key].entries.push({ id, ev: shortEvent(ev.name), scratched: isScratched(data[id] || {}) });
  })));
  return Object.values(sw).sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
}

// Every unique swimmer on a team across the whole meet program (solo + relay legs).
function teamRoster(events, team) {
  const seen = new Map();
  events.forEach((ev) => ev.heats.forEach((ht) => ht.lanes.forEach((l) => {
    if (l.swimmers) { if (l.team === team) l.swimmers.forEach((s) => { if (s.name && !seen.has(s.name)) seen.set(s.name, { name: s.name, age: s.age || 0, team }); }); return; }
    if (l.team === team && l.name && !seen.has(l.name)) seen.set(l.name, { name: l.name, age: l.age || 0, team });
  })));
  return [...seen.values()];
}
// Infer each swimmer's gender from any Girls/Boys-labeled event they swim (solo or relay leg).
function swimmerGenderMap(events) {
  const map = {};
  events.forEach((ev) => { const g = evGender(ev.name); if (g === "Mixed") return;
    ev.heats.forEach((ht) => ht.lanes.forEach((l) => { if (l.swimmers) l.swimmers.forEach((s) => (map[s.name + "|" + l.team] = g)); else map[l.name + "|" + l.team] = g; })); });
  return map;
}
// Fastest known time (final if swum, else seed) a swimmer has in a stroke category this meet.
function bestStrokeSeed(events, data, name, team, cat) {
  let best = Infinity;
  events.forEach((ev, ei) => { if (isRelayEvent(ev.name) || categorize(ev.name) !== cat) return;
    ev.heats.forEach((ht, hi) => ht.lanes.forEach((l) => { if (l.name !== name || l.team !== team) return;
      const d = data[entryId(ei, hi, l.lane)] || {}; const t = toSeconds(d.time), s = toSeconds(l.seed), v = !isNaN(t) ? t : s;
      if (!isNaN(v) && v < best) best = v; })); });
  return isFinite(best) ? best : null;
}
// Every relay slot (any event) a team's swimmers currently occupy this meet —
// used to keep replacement suggestions from double-booking someone who's
// already committed to a different relay.
function relaySlotsByTeam(events, team) {
  const slots = new Map(); // name -> {evIdx, htIdx, lane, leg, eventName}
  events.forEach((ev, ei) => { if (!isRelayEvent(ev.name)) return;
    ev.heats.forEach((ht, hi) => ht.lanes.forEach((l) => { if (l.team !== team || !l.swimmers) return;
      l.swimmers.forEach((s, leg) => { if (s.name) slots.set(s.name, { evIdx: ei, htIdx: hi, lane: l.lane, leg, eventName: ev.name }); }); })); });
  return slots;
}
// Where a team's relay currently sits by seed time (across all heats of the
// event) vs. where it would land if its total changed by deltaSec (negative
// = faster/less time, positive = slower/more time) — the shared math behind
// both "is this move safe" and the replacement picker's +/- time & place.
function relayPlaceProjection(events, team, evIdx, deltaSec) {
  const ev = events[evIdx]; if (!ev || deltaSec == null || isNaN(deltaSec)) return null;
  const field = [];
  ev.heats.forEach((ht) => ht.lanes.forEach((l) => { if (!l.swimmers) return; const s = toSeconds(l.seed); if (!isNaN(s)) field.push({ team: l.team, v: s }); }));
  const idx = field.findIndex((f) => f.team === team); if (idx < 0) return null;
  const oldPlace = [...field].sort((a, b) => a.v - b.v).findIndex((f) => f.team === team) + 1;
  const oldTime = field[idx].v;
  const newField = field.map((f) => f.team === team ? { ...f, v: f.v + deltaSec } : f);
  const newPlace = [...newField].sort((a, b) => a.v - b.v).findIndex((f) => f.team === team) + 1;
  return { oldPlace, newPlace, placeDelta: oldPlace - newPlace, timeDelta: deltaSec, oldTime, newTime: oldTime + deltaSec };
}
// What happens to `name`'s OTHER relay if they're pulled out of it and
// backfilled with the next-best available teammate — the donor side of a
// "move" candidate, so the picker can show that relay's own +/- alongside
// the one gaining the swimmer. null when there's no seed/backfill to compare.
function relayDonorImpact(events, data, name, team, fromSlot) {
  const ev = events[fromSlot.evIdx]; if (!ev) return null;
  const stroke = /medley/i.test(ev.name) ? (MEDLEY_LEGS[fromSlot.leg] || "Free") : "Free";
  const nameLegTime = bestStrokeSeed(events, data, name, team, stroke);
  const backfill = relayReplacementCandidatesRaw(events, data, fromSlot.evIdx, fromSlot.htIdx, fromSlot.lane, fromSlot.leg, team)[0];
  if (nameLegTime == null || !backfill || backfill.best == null) return null;
  const proj = relayPlaceProjection(events, team, fromSlot.evIdx, backfill.best - nameLegTime);
  return proj && { ...proj, backfillName: backfill.name, eventName: ev.name };
}
// Would pulling `name` out of their other relay (backfilling it with the next
// best available teammate) cost that relay's seed-based place in its event?
// A "move" suggestion should never sacrifice ground on a relay we're already
// seeded to hold. Missing data (no seed, no backfill option) errs toward
// allowing the move rather than blocking on incomplete information.
function relayMoveIsSafe(events, data, name, team, fromSlot) {
  const impact = relayDonorImpact(events, data, name, team, fromSlot);
  return !impact || impact.newPlace <= impact.oldPlace;
}
// How many real (non-pending) DQs a swimmer already has THIS meet — a live
// risk signal for relay lineup picks (especially medley, where one DQ'd leg
// takes the whole relay out) that's cheap to compute from what's already on
// the board, without needing season history threaded through every caller.
function dqCountThisMeet(events, data, name, team) {
  let n = 0;
  events.forEach((ev, ei) => ev.heats.forEach((ht, hi) => ht.lanes.forEach((l) => {
    if (l.swimmers) { l.swimmers.forEach((s, leg) => { if (s.name !== name || l.team !== team) return;
      const d = data[entryId(ei, hi, l.lane) + "#" + leg] || {}; if (hasDq(d) && !isPendingDq(d)) n++; }); return; }
    if (l.name !== name || l.team !== team) return;
    const d = data[entryId(ei, hi, l.lane)] || {}; if (hasDq(d) && !isPendingDq(d)) n++;
  })));
  return n;
}
// Drops any roster candidate who's on a different relay this meet UNLESS
// moving them is "safe" per relayMoveIsSafe — used to gate both the flat
// candidate list and the medley full-reoptimization pool.
function filterSafeMoveCandidates(events, data, roster, team) {
  const otherSlots = relaySlotsByTeam(events, team);
  return roster.filter((c) => { const other = otherSlots.get(c.name); return !other || relayMoveIsSafe(events, data, c.name, team, other); });
}
// Teammates eligible to swap into a relay leg: same team, same natural age group,
// same gender as the event (when known), not already swimming this relay — ranked
// fastest-first by their best time in the relevant stroke (medley legs swim in
// Back/Breast/Fly/Free order; free relays are Free throughout). Falls back to an
// unverified same-team list (flagged) if nobody fits the strict rule, so a coach
// always has a couple of options rather than a dead end. Candidates already
// tied up in a different relay are marked "move" — swapping them in also
// vacates their old slot, which the caller should offer to backfill. Only
// offered at all when relayMoveIsSafe() says it won't cost that relay ground.
function relayReplacementCandidatesRaw(events, data, evIdx, htIdx, lane, leg, team) {
  const ev = events[evIdx]; const ht = ev && ev.heats[htIdx];
  const relayLane = ht && ht.lanes.find((l) => l.lane === lane);
  if (!relayLane || !relayLane.swimmers) return [];
  const group = evAgeGroup(ev.name), evg = evGender(ev.name);
  const stroke = /medley/i.test(ev.name) ? (MEDLEY_LEGS[leg] || "Free") : "Free";
  const already = new Set(relayLane.swimmers.map((s) => s.name));
  const genderMap = swimmerGenderMap(events);
  const otherSlots = relaySlotsByTeam(events, team);
  const rank = (list) => list.map((c) => { const other = otherSlots.get(c.name);
    return { ...c, best: bestStrokeSeed(events, data, c.name, team, stroke), stroke, moveFrom: other || null, dqCount: dqCountThisMeet(events, data, c.name, team) }; }).sort((a, b) => (a.best ?? Infinity) - (b.best ?? Infinity));
  const pool = teamRoster(events, team).filter((c) => !already.has(c.name));
  // For mixed relays, match the SCRATCHED swimmer's own gender (not "any
  // gender goes") so the 2-girls/2-boys balance — and the boys-anchor rule —
  // survives a straight swap instead of needing a reshuffle.
  const scratchedName = relayLane.swimmers[leg] && relayLane.swimmers[leg].name;
  const requiredGender = evg === "Mixed" ? genderMap[scratchedName + "|" + team] : evg;
  const strict = rank(pool.filter((c) => ageGroupOf(c.age) === group && (!requiredGender || !genderMap[c.name + "|" + team] || genderMap[c.name + "|" + team] === requiredGender))).map((c) => ({ ...c, verified: true }));
  if (strict.length) return strict.slice(0, 3);
  return rank(pool).slice(0, 3).map((c) => ({ ...c, verified: false }));
}
function relayReplacementCandidates(events, data, evIdx, htIdx, lane, leg, team) {
  return relayReplacementCandidatesRaw(events, data, evIdx, htIdx, lane, leg, team).filter((c) => !c.moveFrom || relayMoveIsSafe(events, data, c.name, team, c.moveFrom));
}
// Replaces just the scratched leg of a medley relay for THIS meet's roster,
// keeping the other 3 swimmers exactly where they are — a scratch should
// only change the scratched swimmer's slot, not reshuffle everyone. Only
// falls back to a full reshuffle (may touch every leg) when literally no
// same-gender teammate is available for that specific stroke — e.g. a mixed
// relay needs a new girl and none is free, so a boy has to move out to make
// room. The pool excludes anyone whose move would cost their other relay
// ground (relayMoveIsSafe).
function medleyReplacementPlan(events, data, evIdx, htIdx, lane, excludeName) {
  const ev = events[evIdx]; if (!ev || !/medley/i.test(ev.name)) return null;
  const ht = ev.heats[htIdx]; const relayLane = ht && ht.lanes.find((l) => l.lane === lane);
  if (!relayLane || !relayLane.swimmers) return null;
  const team = relayLane.team, group = evAgeGroup(ev.name), evg = evGender(ev.name);
  const genderMap = swimmerGenderMap(events);
  const legIdx = relayLane.swimmers.findIndex((s) => s.name === excludeName);
  if (legIdx < 0) return null;
  const stroke = MEDLEY_LEGS[legIdx] || "Free";
  const requiredGender = evg === "Mixed" ? genderMap[excludeName + "|" + team] : evg;
  // Tags each leg with origName/origTime (the leg's PREVIOUS occupant's time
  // in that same stroke, if it changed) so the review screen can show a
  // per-leg time delta, not just the new occupant's raw time.
  const withOrig = (legs) => legs.map((l, i) => { const wasName = relayLane.swimmers[i] && relayLane.swimmers[i].name;
    if (!wasName || wasName === l.name) return l;
    return { ...l, origName: wasName, origTime: bestStrokeSeed(events, data, wasName, team, l.stroke) }; });
  const already = new Set(relayLane.swimmers.map((s) => s.name));
  const poolRaw = teamRoster(events, team).filter((c) => !already.has(c.name) && ageGroupOf(c.age) === group)
    .map((c) => ({ ...c, gender: genderMap[c.name + "|" + team] }));
  const pool = filterSafeMoveCandidates(events, data, poolRaw, team);
  const eligible = pool.filter((c) => !requiredGender || !c.gender || c.gender === requiredGender)
    .map((c) => ({ ...c, s: bestStrokeSeed(events, data, c.name, team, stroke), dqCount: dqCountThisMeet(events, data, c.name, team) })).filter((c) => c.s != null).sort((a, b) => a.s - b.s);
  // Minimal-change option: swap in the fastest eligible outsider for just the
  // vacated leg, leaving the other three swimmers on their original strokes.
  // A medley DQ takes out the whole relay, so a swimmer who's already been
  // DQ'd this meet is a real risk — prefer an equally-fast (within 5%) clean
  // alternative over the raw-fastest pick when one's available.
  let minimalPlan = null;
  if (eligible.length) {
    const clean = eligible.find((c) => c.dqCount === 0 && c.s <= eligible[0].s * 1.05);
    const pick = eligible[0].dqCount > 0 && clean ? clean : eligible[0];
    const legs = relayLane.swimmers.map((s, i) => { if (i === legIdx) return { name: pick.name, age: pick.age, gender: pick.gender || requiredGender, stroke, s: pick.s, dqCount: pick.dqCount };
      const st = MEDLEY_LEGS[i] || "Free"; return { name: s.name, age: s.age, gender: genderMap[s.name + "|" + team], stroke: st, s: bestStrokeSeed(events, data, s.name, team, st) ?? 0 }; });
    minimalPlan = { legs: withOrig(legs), total: legs.reduce((a, l) => a + l.s, 0) };
  }
  // Full-reshuffle option: also let the three surviving relay members swap
  // strokes with each other (and with any outsider), in case that's faster
  // overall than a straight 1-for-1 swap on just the vacated leg.
  const rosterRaw = teamRoster(events, team).filter((c) => c.name !== excludeName && ageGroupOf(c.age) === group)
    .map((c) => ({ ...c, gender: genderMap[c.name + "|" + team] }));
  const roster = filterSafeMoveCandidates(events, data, rosterRaw, team);
  const timeOf = (name, s) => bestStrokeSeed(events, data, name, team, s);
  const reshuffleRaw = evg === "Mixed" ? optimalMixedMedley(roster, timeOf) : optimalMedley(roster.filter((c) => !c.gender || c.gender === evg), timeOf);
  const reshufflePlan = reshuffleRaw ? { legs: withOrig(reshuffleRaw.legs), total: reshuffleRaw.total } : null;
  if (minimalPlan && reshufflePlan) return reshufflePlan.total < minimalPlan.total - 0.001 ? reshufflePlan : minimalPlan;
  return minimalPlan || reshufflePlan;
}

// Participants & scratches — all swimmers, filter by team, scratch per event
// (including individual relay legs) or the whole meet.
function ParticipantsModal({ onClose, events, data, homeTeam, onOne, onAll, revertible, onRevertSwap }) {
  const people = useMemo(() => computeParticipants(events, data), [events, data]);
  const teams = useMemo(() => [...new Set(people.map((p) => p.team))].sort(), [people]);
  const [team, setTeam] = useState(homeTeam || "All");
  const [open, setOpen] = useState(null);
  const rows = people.filter((p) => team === "All" || p.team === team);
  return (
    <div className="md-scrim" onClick={onClose}>
      <div className="md-modal md-imp" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="md-mhead"><button className="md-logo sm" onClick={onClose} aria-label="Home" title="MeetDeck — home">≈</button><div className="md-mheadtxt"><div className="md-mtitle">Scratches</div><div className="md-msub">Scratch a swimmer per event — relay legs included — or the whole meet. Any team.</div></div><button className="md-x" onClick={onClose}>✕</button></div>
        <div className="md-rbctl"><label className="md-ctl">Team<select value={team} onChange={(e) => setTeam(e.target.value)}><option>All</option>{teams.map((t) => <option key={t}>{t}</option>)}</select></label><span className="md-lgcount">{rows.length} swimmers</span></div>
        <div className="md-lglist">
          {rows.map((p) => { const key = p.name + "|" + p.team, anyScr = p.entries.some((e) => e.scratched), allScr = p.entries.every((e) => e.scratched);
            return (<div key={key} className={"md-lgitem" + (anyScr ? " scr" : "")}>
              <button className="md-lgrow" onClick={() => setOpen(open === key ? null : key)}>
                <span className="md-lgdot" style={{ background: teamColor(p.team) }} />
                <span className="md-lgname">{p.name}</span>
                <span className="md-lgmeta">{p.team}{p.age ? " · " + p.age : ""} · {p.entries.length} event{p.entries.length === 1 ? "" : "s"}</span>
                {anyScr && <span className="md-timex" style={{ width: "auto", fontSize: 14 }}>X</span>}
                <span className="md-cc">{open === key ? "▾" : "▸"}</span>
              </button>
              {open === key && <div className="md-lgdetail">
                <button className={"md-mbtn" + (allScr ? "" : " danger")} onClick={() => onAll(p.name, p.team, !allScr)}>{allScr ? "↺ Un-scratch whole meet" : "✕ Scratch whole meet"}</button>
                {p.entries.map((e) => (
                  <div key={e.id} className="md-partev">
                    <span className={"md-partname" + (e.scratched ? " scr" : "")}>{e.ev}{e.relay && <em className="md-relaytag"> · relay {e.relayLabel}</em>}</span>
                    {e.ghost
                      ? (revertible && revertible[e.legId]
                        ? <button className="md-partbtn revert" onClick={() => onRevertSwap(e.legId)}>↺ Revert — restore {p.name}</button>
                        : <span className="md-partghost">✕ scratched — replaced by {e.replacedBy}</span>)
                      // A relay leg left scratched as the side effect of moving
                      // this swimmer onto another relay (no one has filled it
                      // in yet, so it isn't a "ghost" row) still has the same
                      // full-cascade restoreFn registered under its own id —
                      // offer that instead of a plain un-scratch toggle.
                      : (e.scratched && e.relay && revertible && revertible[e.id]
                        ? <button className="md-partbtn revert" onClick={() => onRevertSwap(e.id)}>↺ Revert — undo this swap</button>
                        : <button className={"md-partbtn" + (e.scratched ? " on" : "")} onClick={() => onOne({ ...e, name: p.name, team: p.team }, !e.scratched)}>{e.scratched ? "X — tap to restore" : "Scratch"}</button>)}
                  </div>
                ))}
              </div>}
            </div>); })}
          {!rows.length && <div className="md-prevempty">No swimmers for this team.</div>}
        </div>
        <div className="md-mfoot"><button className="md-apply" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

// After a relay swimmer is scratched: for a medley relay, offer the full
// re-optimized lineup (may reshuffle more than one leg); for a free relay (or
// if no full medley plan is possible), offer a couple of eligible teammates
// for just this leg — flagging anyone already on a different relay as a
// "move" so the coach knows swapping them in leaves a gap elsewhere.
function RelayDeltaLine({ label, d }) {
  if (!d) return null;
  const timeCls = d.timeDelta < 0 ? "neg" : "pos";
  const timeStr = (d.timeDelta < 0 ? "−" : "+") + Math.abs(d.timeDelta).toFixed(2) + "s";
  const placeCls = d.placeDelta > 0 ? "neg" : d.placeDelta < 0 ? "pos" : "";
  const placeStr = d.placeDelta === 0 ? ORD(d.oldPlace) + " (no change)" : ORD(d.oldPlace) + " → " + ORD(d.newPlace);
  return (
    <div className="md-reldeltaline">
      <span className="md-reldeltalabel">{label}</span>
      <span className={"md-delta sm" + (placeCls ? " " + placeCls : "")}>{placeStr}</span>
      <span className={"md-delta sm " + timeCls}>{timeStr}</span>
    </div>
  );
}
function RelayReplaceModal({ target, candidates, plan, planDelta, originalLegs, onClose, onSwap, onApplyPlan }) {
  return (
    <div className="md-scrim" onClick={onClose}>
      <div className="md-modal md-scratchmodal" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="md-mhead"><button className="md-logo sm" onClick={onClose} aria-label="Home" title="MeetDeck — home">≈</button><div className="md-mheadtxt"><div className="md-mtitle">Replace {target.name}?</div><div className="md-msub">{shortEvent(target.eventName)} · {target.stroke || (candidates[0] && candidates[0].stroke) || (plan && plan.legs[0].stroke) || ""}{plan ? "" : " leg"} · {target.team}</div></div><button className="md-x" onClick={onClose}>✕</button></div>
        <div className="md-scratchbtns">
          {plan ? (<>
            <div className="md-planlegs">
              {plan.legs.map((l, i) => { const was = originalLegs[i]; const changed = was && was !== l.name;
                const legDelta = changed && l.origTime != null ? l.s - l.origTime : null;
                return (
                  <div key={i} className="md-planleg">
                    <span className="md-planstroke">{l.stroke}</span>
                    <span className="md-planname">{changed ? <><s>{was}</s> → <b>{l.name}</b></> : <b>{l.name}</b>}</span>
                    <span className="md-plantime">{fmtT(l.s)}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      {legDelta != null && <span className={"md-delta sm " + (legDelta < 0 ? "pos" : "neg")}>{(legDelta < 0 ? "−" : "+") + Math.abs(legDelta).toFixed(2) + "s"}</span>}
                      {l.dqCount > 0 && <em style={{ color: "#b42318", fontStyle: "normal", fontSize: 11 }}>⚠ {l.dqCount} DQ{l.dqCount > 1 ? "s" : ""}</em>}
                    </span>
                  </div>
                ); })}
            </div>
            {planDelta && <RelayDeltaLine label="This relay, projected:" d={planDelta} />}
            <button className="md-mbtn primary" onClick={onApplyPlan}>Apply this lineup</button>
          </>) : candidates.length ? candidates.map((c) => (
            <button key={c.name} className="md-mbtn" onClick={() => onSwap(c)}>
              <b>{c.name}</b>{c.age ? ` (${c.age})` : ""} — {c.best != null ? fmtT(c.best) : "no time on record"}
              {c.moveFrom && <em style={{ marginLeft: 6, color: "#7c3aed", fontStyle: "normal" }}>currently on {shortEvent(c.moveFrom.eventName)} — moving them leaves a gap there</em>}
              {!c.verified && <em style={{ marginLeft: 6, color: "#a8842a", fontStyle: "normal" }}>unverified age/gender</em>}
              {c.dqCount > 0 && <em style={{ marginLeft: 6, color: "#b42318", fontStyle: "normal" }}>⚠ {c.dqCount} DQ{c.dqCount > 1 ? "s" : ""} this meet</em>}
              <RelayDeltaLine label="This relay:" d={c.thisDelta} />
              {c.donorDelta && <RelayDeltaLine label={"Their relay (backfilled by " + c.donorDelta.backfillName + "):"} d={c.donorDelta} />}
            </button>
          )) : <div className="md-prevempty">No eligible teammate found on the roster for this age group.</div>}
          <button className="md-cancel" onClick={onClose}>Leave relay short (keep scratch)</button>
        </div>
      </div>
    </div>
  );
}

// Improvement rate for a swimmer across meets (avg fractional time drop).
function computeImpRate(name, team, meets) {
  let acc = 0, n = 0;
  meets.forEach((m) => { if (m.mode === "timetrial") return; (m.events || []).forEach((ev, ei) => { if (isRelayEvent(ev.name)) return;
    ev.heats.forEach((ht, hi) => ht.lanes.forEach((l) => { if (l.name !== name || l.team !== team) return; const d = (m.data || {})[entryId(ei, hi, l.lane)] || {}; const fs = toSeconds(d.time), ss = toSeconds(l.seed); if (!isNaN(fs) && !isNaN(ss) && ss > 0 && fs < ss) { acc += (ss - fs) / ss; n++; } })); }); });
  return n ? acc / n : 0.01;
}
// SwimCloud-style power: blends speed percentile (within gender/age/stroke
// buckets, across the league) with season improvement rate and points
// scored — speed-weighted (60/25/15) so it's still primarily "how fast are
// they," with improvement and scoring as secondary signals. `filter`
// (gender/ageGroup/stroke) restricts which buckets count, for the League
// page's filtered views — each still uses the full field for percentiles.
function computePower(meets, filter) {
  const sw = {}, bestByEv = {};
  meets.forEach((m) => { const table = m.mode === "champs" ? CHAMPS : DUAL; const tt = m.mode === "timetrial"; const data = m.data || {};
    (m.events || []).forEach((ev, ei) => { if (isRelayEvent(ev.name)) return;
      const g = evGender(ev.name), ag = evAgeGroup(ev.name), cat = categorize(ev.name);
      if (filter) { if (filter.gender && filter.gender !== "All" && g !== filter.gender) return; if (filter.ageGroup && filter.ageGroup !== "All" && ag !== filter.ageGroup) return; if (filter.stroke && filter.stroke !== "All" && cat !== filter.stroke) return; }
      const ekey = g + "|" + ag + "|" + cat;
      const placeOf = {}; if (!tt) rankedEvent(ev, ei, data, null).forEach((e, i) => (placeOf[e.id] = i + 1));
      ev.heats.forEach((ht, hi) => ht.lanes.forEach((l) => { const id = entryId(ei, hi, l.lane); const d = data[id] || {}; const t = toSeconds(d.time); const s = isNaN(t) ? toSeconds(l.seed) : t; if (isNaN(s)) return; const key = l.name + "|" + l.team;
        // Individual events are always Girls- or Boys-only, but guard anyway
        // so a swimmer's own gender tick can never come out as "Mixed" (that
        // describes the relay's makeup, not any one swimmer's gender).
        (sw[key] || (sw[key] = { name: l.name, team: l.team, age: l.age, gender: g === "Mixed" ? undefined : g, events: {}, pts: 0, improveSum: 0, improveN: 0 }));
        if (l.age) sw[key].age = l.age; sw[key].events[ekey] = Math.min(sw[key].events[ekey] ?? Infinity, s);
        (bestByEv[ekey] || (bestByEv[ekey] = {})); if (bestByEv[ekey][key] === undefined || s < bestByEv[ekey][key]) bestByEv[ekey][key] = s;
        if (!tt) { const p = placeOf[id]; if (p) sw[key].pts += (table[p] || 0); }
        const fs = toSeconds(d.time), ss = toSeconds(l.seed);
        if (!isNaN(fs) && !isNaN(ss) && ss > 0) { sw[key].improveSum += (ss - fs) / ss; sw[key].improveN++; }
      })); });
  });
  const acc = {};
  Object.values(bestByEv).forEach((mp) => { const arr = Object.entries(mp).map(([k, t]) => ({ k, t })).sort((a, b) => a.t - b.t); const n = arr.length; arr.forEach((e, i) => { const pct = n > 1 ? ((n - 1 - i) / (n - 1)) * 100 : 100; (acc[e.k] || (acc[e.k] = { s: 0, n: 0 })); acc[e.k].s += pct; acc[e.k].n++; }); });
  const maxPts = Math.max(1, ...Object.values(sw).map((s) => s.pts));
  Object.entries(acc).forEach(([k, v]) => { const s = sw[k]; if (!s) return;
    const speed = v.s / v.n;
    const improveScore = s.improveN ? Math.max(0, Math.min(100, (s.improveSum / s.improveN) * 1500)) : 0;
    const ptsScore = (s.pts / maxPts) * 100;
    s.power = Math.round(0.6 * speed + 0.25 * improveScore + 0.15 * ptsScore);
  });
  return sw;
}
// "Top Kid" score for the League page's improvement+points leaderboard —
// unlike computePower's blended power rating (60% speed), this is 50/50
// improvement rate and points scored, so it surfaces swimmers who are
// climbing fast or racking up points even if they aren't the fastest yet.
function topKidScore(s, maxPts) {
  const improveScore = s.improveN ? Math.max(0, Math.min(100, (s.improveSum / s.improveN) * 1500)) : 0;
  const ptsScore = maxPts ? (s.pts / maxPts) * 100 : 0;
  return Math.round(0.5 * improveScore + 0.5 * ptsScore);
}
// Team standings (W-L, points for/against, margins) from dual meets.
function computeStandings(meets) {
  const rec = {};
  meets.forEach((m) => { if (m.mode !== "dual" || !m.hostTeam || !m.awayTeam) return;
    const scores = computeScores(m.events || [], m.data || {}, "dual", [m.hostTeam, m.awayTeam]);
    const hs = scores.pts[m.hostTeam] || 0, as = scores.pts[m.awayTeam] || 0;
    [[m.hostTeam, hs, as], [m.awayTeam, as, hs]].forEach(([t, pf, pa]) => { (rec[t] || (rec[t] = { team: t, w: 0, l: 0, tie: 0, pf: 0, pa: 0, meets: [] }));
      rec[t].pf += pf; rec[t].pa += pa; if (pf > pa) rec[t].w++; else if (pf < pa) rec[t].l++; else rec[t].tie++;
      rec[t].meets.push({ meet: m.meetName, date: m.date, opp: t === m.hostTeam ? m.awayTeam : m.hostTeam, pf, pa, margin: pf - pa }); });
  });
  return rec;
}

// A swimmer's entries in one meet (season snapshot or the live board), for
// the profile page's "last meet" / "upcoming meet" snippets.
function swimsForMeet(name, team, meet) {
  const out = []; const data = meet.data || {}; const table = meet.mode === "champs" ? CHAMPS : DUAL;
  (meet.events || []).forEach((ev, ei) => { const relay = isRelayEvent(ev.name);
    const placeOf = {}; if (meet.mode !== "timetrial") rankedEvent(ev, ei, data, null).forEach((e, i) => (placeOf[e.id] = i + 1));
    ev.heats.forEach((ht, hi) => ht.lanes.forEach((l) => {
      if (relay) { if (!l.swimmers || l.team !== team || !l.swimmers.some((s) => s.name === name)) return;
        const id = entryId(ei, hi, l.lane); const d = data[id] || {}; out.push({ ev: shortEvent(ev.name), relay: true, seed: l.seed, time: d.time, place: placeOf[id] }); return; }
      if (l.name !== name || l.team !== team) return;
      const id = entryId(ei, hi, l.lane); const d = data[id] || {}; out.push({ ev: shortEvent(ev.name), seed: l.seed, time: d.time, place: placeOf[id] });
    }));
  });
  return out;
}
// One swimmer's full-season profile: notes, DQs, best improvements, season
// points and improvement %, plus a snippet of their last saved meet and the
// currently-loaded ("upcoming") one. Always unfiltered — a profile is about
// the person, not whatever League filter happens to be active.
function computeSwimmerProfile(name, team, seasonMeets, liveMeet) {
  const sorted = [...(seasonMeets || [])].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const notes = [], dqs = [], improvements = [], splits = [];
  let totalPts = 0, improveSum = 0, improveN = 0;
  sorted.forEach((m) => { const table = m.mode === "champs" ? CHAMPS : DUAL; const tt = m.mode === "timetrial"; const data = m.data || {};
    (m.events || []).forEach((ev, ei) => {
      const placeOf = {}; if (!tt) rankedEvent(ev, ei, data, null).forEach((e, i) => (placeOf[e.id] = i + 1));
      ev.heats.forEach((ht, hi) => ht.lanes.forEach((l) => {
        if (l.swimmers) { l.swimmers.forEach((s, leg) => { if (s.name !== name || l.team !== team) return;
          const id = entryId(ei, hi, l.lane) + "#" + leg; const d = data[id] || {};
          if (d.notes) notes.push({ note: d.notes, ev: shortEvent(ev.name), meet: m.meetName, date: m.date });
          (d.dqs || []).forEach((q) => dqs.push({ ...q, ev: shortEvent(ev.name), meet: m.meetName, date: m.date }));
          // Splits belong to the swimmer, not just the relay entry, so they
          // can surface on this profile and feed future relay leg estimates.
          const relayData = data[entryId(ei, hi, l.lane)] || {}; const sp = (relayData.splits || [])[leg];
          if (sp) splits.push({ split: sp, leg: leg + 1, stroke: /medley/i.test(ev.name) ? (MEDLEY_LEGS[leg] || "Free") : "Free", ev: shortEvent(ev.name), meet: m.meetName, date: m.date });
        }); return; }
        if (l.name !== name || l.team !== team) return;
        const id = entryId(ei, hi, l.lane); const d = data[id] || {};
        if (d.notes) notes.push({ note: d.notes, ev: shortEvent(ev.name), meet: m.meetName, date: m.date });
        (d.dqs || []).forEach((q) => dqs.push({ ...q, ev: shortEvent(ev.name), meet: m.meetName, date: m.date }));
        if (!tt && !isRelayEvent(ev.name)) { const p = placeOf[id]; if (p) totalPts += (table[p] || 0); }
        (d.splits || []).forEach((sp, i) => { if (sp) splits.push({ split: sp, leg: i + 1, stroke: categorize(ev.name), ev: shortEvent(ev.name), meet: m.meetName, date: m.date }); });
        const fs = toSeconds(d.time), ss = toSeconds(l.seed);
        if (!isNaN(fs) && !isNaN(ss) && ss > 0) { const drop = ss - fs; improveSum += drop / ss; improveN++;
          if (drop > 0) improvements.push({ ev: shortEvent(ev.name), drop, seed: l.seed, time: d.time, meet: m.meetName, date: m.date }); }
      }));
    });
  });
  improvements.sort((a, b) => b.drop - a.drop);
  const lastMeet = sorted[sorted.length - 1];
  return {
    notes: notes.reverse(), dqs: dqs.reverse(), improvements: improvements.slice(0, 5), splits: splits.reverse(),
    improvePct: improveN ? Math.round((improveSum / improveN) * 1000) / 10 : 0, totalPts,
    lastMeet, lastMeetSwims: lastMeet ? swimsForMeet(name, team, lastMeet) : [],
    upcomingSwims: liveMeet ? swimsForMeet(name, team, liveMeet) : [],
  };
}

// League dashboard: team records → tap a team for full stats + power ranking
// (SwimCloud-style), and tap a swimmer for their full profile. A full-page
// takeover (not a modal). Gender/age/stroke filters restrict which events
// count toward Power (team W-L stays whole-team, since a dual meet result
// isn't a per-cohort thing) — everything downstream (standings, roster)
// derives from the same filtered power map.
const LEAGUE_SORTS = {
  record: (a, b) => (b.w - b.l) - (a.w - a.l) || b.power - a.power,
  power: (a, b) => b.power - a.power,
  pf: (a, b) => b.pf - a.pf,
};
// Custom Pointer Events slider (not a native <input type=range>) so dragging
// is reliable on iPad Safari — same reasoning as the drag boards elsewhere
// in this file: setPointerCapture keeps tracking the finger regardless of
// what's underneath, which native range thumbs don't reliably do on iOS.
function AgeSlider({ idx, onChange }) {
  const trackRef = useRef(null);
  const dragging = useRef(false);
  const n = AGE_GROUPS.length;
  const pctFor = (i) => (n > 1 ? (i / (n - 1)) * 100 : 0);
  const idxFromX = (clientX) => {
    const el = trackRef.current; if (!el) return idx;
    const r = el.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return Math.round(pct * (n - 1));
  };
  const onDown = (e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); onChange(idxFromX(e.clientX)); e.preventDefault(); };
  const onMove = (e) => { if (!dragging.current) return; onChange(idxFromX(e.clientX)); };
  const endDrag = () => { dragging.current = false; };
  return (
    <div ref={trackRef} className="md-agesldr" style={{ touchAction: "none" }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag} role="slider" aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={idx}>
      <div className="md-agesldrtrack"><div className="md-agesldrfill" style={{ width: pctFor(idx) + "%" }} /></div>
      <div className="md-agesldrthumb" style={{ left: pctFor(idx) + "%" }} />
    </div>
  );
}

function LeagueModal({ onClose, meets, homeTeam, liveMeet, initialProfile }) {
  const [filterGender, setFilterGender] = useState("All");
  const [filterAge, setFilterAge] = useState("All");
  const [filterStroke, setFilterStroke] = useState("All");
  const power = useMemo(() => computePower(meets, { gender: filterGender, ageGroup: filterAge, stroke: filterStroke }), [meets, filterGender, filterAge, filterStroke]);
  const standings = useMemo(() => computeStandings(meets), [meets]);
  const teams = useMemo(() => [...new Set(Object.values(power).map((s) => s.team))].sort(), [power]);
  const teamPower = (t) => { const arr = Object.values(power).filter((s) => s.team === t && s.power != null); return arr.length ? Math.round(arr.reduce((a, b) => a + b.power, 0) / arr.length) : 0; };
  const [sel, setSel] = useState(null);
  // Jumped straight into a profile (e.g. tapped a name in a popover
  // elsewhere) has no team-roster context to step back into, so the profile
  // view's back arrow goes all the way home instead — see the `sel` check below.
  const [profile, setProfile] = useState(initialProfile || null);
  const [sort, setSort] = useState("record");
  const [rosterSort, setRosterSort] = useState("power");
  const rows = teams.map((t) => ({ team: t, ...(standings[t] || { w: 0, l: 0, tie: 0, pf: 0, pa: 0, meets: [] }), power: teamPower(t) })).sort(LEAGUE_SORTS[sort]);

  // Top Kid leaderboard — its own age-group slider, independent of the page
  // filter bar, sliding left (6u) to right (15-18).
  const [topKidAgeIdx, setTopKidAgeIdx] = useState(2);
  const topKidAge = AGE_GROUPS[topKidAgeIdx];
  const topKidPower = useMemo(() => computePower(meets, { ageGroup: topKidAge }), [meets, topKidAge]);
  const topKids = useMemo(() => {
    const arr = Object.values(topKidPower).filter((s) => s.pts > 0 || s.improveN > 0);
    const maxPts = Math.max(1, ...arr.map((s) => s.pts));
    return arr.map((s) => ({ ...s, score: topKidScore(s, maxPts) })).sort((a, b) => b.score - a.score).slice(0, 5);
  }, [topKidPower]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return Object.values(power).filter((s) => s.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8);
  }, [search, power]);
  const openProfile = (s) => { setProfile({ name: s.name, team: s.team }); setSearch(""); setSearchOpen(false); };
  const searchBar = (
    <div className="md-lgsearch">
      <button className={"md-lgsearchbtn" + (searchOpen ? " on" : "")} onClick={() => setSearchOpen((o) => !o)} aria-label="Search swimmers">🔍</button>
      {searchOpen && (
        <div className="md-lgsearchbox">
          <input autoFocus className="md-lgsearchinput" placeholder="Search swimmers…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search.trim() && (
            <div className="md-lgsearchresults">
              {searchMatches.length ? searchMatches.map((s) => (
                <button key={s.name + "|" + s.team} className="md-lgsearchrow" onClick={() => openProfile(s)}>
                  <span className="md-lgteambar" style={{ background: teamColor(s.team) }} />{s.name}<span className="md-lgsearchteam">{s.team}</span>
                </button>
              )) : <div className="md-prevempty">No swimmers match.</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
  const filterOn = filterGender !== "All" || filterAge !== "All" || filterStroke !== "All";
  const filterBar = (
    <div className="md-lgfilterwrap">
      <div className="md-lgfiltertop">
        {searchBar}
        <button className={"md-statsfilterbtn" + (filterOn ? " on" : "")} onClick={() => setFiltersOpen((o) => !o)}>⚙ Filters{filterOn ? " •" : ""}</button>
      </div>
      {filtersOpen && (
        <div className="md-lgfilters">
          <label className="md-ctl">Gender<select value={filterGender} onChange={(e) => setFilterGender(e.target.value)}><option>All</option><option>Girls</option><option>Boys</option></select></label>
          <label className="md-ctl">Age group<select value={filterAge} onChange={(e) => setFilterAge(e.target.value)}><option>All</option>{AGE_GROUPS.map((g) => <option key={g}>{g}</option>)}</select></label>
          <label className="md-ctl">Stroke<select value={filterStroke} onChange={(e) => setFilterStroke(e.target.value)}><option>All</option>{PROG_STROKES.map((s) => <option key={s}>{s}</option>)}</select></label>
        </div>
      )}
    </div>
  );

  if (profile) {
    const prof = computeSwimmerProfile(profile.name, profile.team, meets, liveMeet);
    return (
      <div className="md-leaguepage" role="dialog">
        <div className="md-lgtopbar"><button className="md-lgback" onClick={() => (sel ? setProfile(null) : onClose())}>{sel ? `← ${TEAM_NAME[profile.team] || profile.team}` : "← MeetDeck"}</button><button className="md-x sm" onClick={onClose}>✕</button></div>
        <div className="md-lgbanner" style={{ background: `linear-gradient(135deg, ${teamColor(profile.team)}, #0f2036)` }}>
          <div className="md-lgbannerteam">{profile.name}</div>
          <div className="md-lgbannerstats">
            <div className="md-lgstat"><b>{prof.totalPts}</b><span>season points</span></div>
            <div className="md-lgstat"><b>{prof.improvePct}%</b><span>avg improvement</span></div>
            <div className="md-lgstat"><b>{prof.dqs.length}</b><span>DQs</span></div>
          </div>
        </div>
        <div className="md-lgbody">
          <div className="md-lgsection">
            <div className="md-lgsectitle">📈 Most improved swims</div>
            {prof.improvements.length ? prof.improvements.map((im, i) => (
              <div key={i} className="md-statrow"><span className="md-statname">{im.ev}</span><span className="md-statsub">{im.seed} → {im.time} · {im.meet}</span><span className="md-statval green">−{im.drop.toFixed(2)}</span></div>
            )) : <div className="md-prevempty">No improvements on record yet.</div>}
          </div>
          <div className="md-lgsection">
            <div className="md-lgsectitle">⏱ Splits</div>
            {prof.splits.length ? prof.splits.map((sp, i) => (
              <div key={i} className="md-statrow"><span className="md-statname">{sp.ev}<em className="md-statage">leg {sp.leg} · {sp.stroke}</em></span><span className="md-statsub">{sp.meet}</span><span className="md-statval">{sp.split}</span></div>
            )) : <div className="md-prevempty">No splits recorded yet.</div>}
          </div>
          <div className="md-lgsection">
            <div className="md-lgsectitle">📝 Notes</div>
            {prof.notes.length ? prof.notes.map((n, i) => <div key={i} className="md-profnote"><b>{n.ev}</b><span className="md-profnotemeta"> · {n.meet}</span><p>{n.note}</p></div>) : <div className="md-prevempty">No notes yet.</div>}
          </div>
          <div className="md-lgsection">
            <div className="md-lgsectitle">🚩 DQs</div>
            {prof.dqs.length ? prof.dqs.map((q, i) => <div key={i} className="md-statrow"><span className="md-statname">{q.ev}</span><span className="md-statsub">{q.meet}</span><span className="md-statval red">{q.code}</span></div>) : <div className="md-prevempty">No DQs on record.</div>}
          </div>
          <div className="md-lgsection">
            <div className="md-lgsectitle">Last meet{prof.lastMeet ? " — " + prof.lastMeet.meetName : ""}</div>
            {prof.lastMeetSwims.length ? prof.lastMeetSwims.map((sw, i) => <div key={i} className="md-statrow"><span className="md-statname">{sw.ev}</span><span className="md-statsub">seed {sw.seed}</span><span className="md-statval">{sw.time || "—"}{sw.place ? " · " + ORD(sw.place) : ""}</span></div>) : <div className="md-prevempty">No saved meets yet.</div>}
          </div>
          <div className="md-lgsection">
            <div className="md-lgsectitle">Upcoming meet</div>
            {prof.upcomingSwims.length ? prof.upcomingSwims.map((sw, i) => <div key={i} className="md-statrow"><span className="md-statname">{sw.ev}</span><span className="md-statsub">seed {sw.seed}</span><span className="md-statval">{sw.time || "not yet swum"}</span></div>) : <div className="md-prevempty">Not entered in the currently loaded meet.</div>}
          </div>
        </div>
      </div>
    );
  }
  if (sel) {
    const st = standings[sel] || { meets: [] };
    const rosterSorts = { power: (a, b) => (b.power || 0) - (a.power || 0), name: (a, b) => a.name.localeCompare(b.name), age: (a, b) => (a.age || 0) - (b.age || 0) };
    const roster = Object.values(power).filter((s) => s.team === sel).sort(rosterSorts[rosterSort]);
    return (
      <div className="md-leaguepage" role="dialog">
        <div className="md-lgtopbar"><button className="md-lgback" onClick={() => setSel(null)}>← League</button><button className="md-x sm" onClick={onClose}>✕</button></div>
        <div className="md-lgbanner" style={{ background: `linear-gradient(135deg, ${teamColor(sel)}, #0f2036)` }}>
          <div className="md-lgbannerteam">{TEAM_NAME[sel] || sel}</div>
          <div className="md-lgbannerstats">
            <div className="md-lgstat"><b>{st.w || 0}-{st.l || 0}{st.tie ? "-" + st.tie : ""}</b><span>record</span></div>
            <div className="md-lgstat"><b>{teamPower(sel)}</b><span>team power</span></div>
            <div className="md-lgstat"><b>{roster.length}</b><span>swimmers</span></div>
          </div>
        </div>
        <div className="md-lgbody">
          {filterBar}
          <div className="md-lgsection">
            <div className="md-lgsectitle">Meets</div>
            {st.meets && st.meets.length ? (
              <table className="md-lgtable"><tbody>
                {st.meets.map((mm, i) => <tr key={i}><td className="md-lgopp">vs {TEAM_NAME[mm.opp] || mm.opp}</td><td className="md-lgdate">{mm.date}</td><td className={"md-lgresult " + (mm.margin > 0 ? "win" : mm.margin < 0 ? "loss" : "")}>{mm.margin > 0 ? "W" : mm.margin < 0 ? "L" : "T"} {mm.pf}-{mm.pa}</td></tr>)}
              </tbody></table>
            ) : <div className="md-prevempty">No dual-meet records yet.</div>}
          </div>
          <div className="md-lgsection">
            <div className="md-lgsectitle">Roster — power ranking</div>
            <table className="md-lgtable roster">
              <thead><tr>
                <th className="md-lgsortable" onClick={() => setRosterSort("name")}>Swimmer</th>
                <th className="md-lgsortable" onClick={() => setRosterSort("age")}>Age</th>
                <th>Gender</th>
                <th className="md-lgsortable" onClick={() => setRosterSort("power")}>Power</th>
              </tr></thead>
              <tbody>{roster.map((s) => <tr key={s.name} className="md-lgtr" onClick={() => setProfile({ name: s.name, team: s.team })}><td className="md-lgswimname">{s.name}</td><td>{ageGroupOf(s.age) || "?"}</td><td><span className={"md-gpill sm " + s.gender.toLowerCase()}>{s.gender[0]}</span></td><td className="md-lgpower">{s.power ?? "—"}</td></tr>)}</tbody>
            </table>
            {!roster.length && <div className="md-prevempty">No swimmers match this filter.</div>}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="md-leaguepage" role="dialog">
      <div className="md-lgtopbar"><button className="md-lgback" onClick={onClose}>← MeetDeck</button><button className="md-x sm" onClick={onClose}>✕</button></div>
      <div className="md-lgheader">
        <h1 className="md-lgtitle">League standings</h1>
        <p className="md-lgsub">Across {meets.filter((m) => m.id).length} saved meet{meets.filter((m) => m.id).length === 1 ? "" : "s"}{meets.length > meets.filter((m) => m.id).length ? " + this meet (live)" : ""} · tap a team for the full profile</p>
      </div>
      <div className="md-lgbody">
        <div className="md-lgsection md-topkid">
          <div className="md-lgsectitle">🏅 Top Kid — {topKidAge} <em className="md-topkidnote">improvement + points, all teams</em></div>
          <div className="md-topkidslider">
            <span className="md-topkidend">6u</span>
            <AgeSlider idx={topKidAgeIdx} onChange={setTopKidAgeIdx} />
            <span className="md-topkidend">15-18</span>
          </div>
          {topKids.length ? (
            <table className="md-lgtable roster">
              <thead><tr><th>#</th><th>Swimmer</th><th>Team</th><th>Avg improvement</th><th>Points</th><th>Score</th></tr></thead>
              <tbody>
                {topKids.map((s, i) => (
                  <tr key={s.name + "|" + s.team} className="md-lgtr" onClick={() => setProfile({ name: s.name, team: s.team })}>
                    <td><span className={"md-lgrank" + (i < 3 ? " top" + (i + 1) : "")}>{i + 1}</span></td>
                    <td className="md-lgswimname">{s.name}</td>
                    <td><span className="md-lgteambar" style={{ background: teamColor(s.team) }} />{TEAM_NAME[s.team] || s.team}</td>
                    <td>{s.improveN ? ((s.improveSum / s.improveN) * 100).toFixed(1) + "%" : "—"}</td>
                    <td>{s.pts}</td>
                    <td className="md-lgpower">{s.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="md-prevempty">No swims recorded for {topKidAge} yet.</div>}
        </div>
        <table className="md-lgtable standings">
          <thead><tr>
            <th>#</th><th>Team</th>
            <th className="md-lgsortable" onClick={() => setSort("record")}>W-L</th>
            <th className="md-lgsortable" onClick={() => setSort("pf")}>Pts F</th>
            <th>Pts A</th>
            <th className="md-lgsortable" onClick={() => setSort("power")}>Power</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.team} className={"md-lgtr" + (r.team === homeTeam ? " mine" : "")} onClick={() => setSel(r.team)}>
                <td><span className={"md-lgrank" + (i < 3 ? " top" + (i + 1) : "")}>{i + 1}</span></td>
                <td><span className="md-lgteambar" style={{ background: teamColor(r.team) }} />{TEAM_NAME[r.team] || r.team}</td>
                <td>{r.w}-{r.l}{r.tie ? "-" + r.tie : ""}</td>
                <td>{r.pf}</td>
                <td>{r.pa}</td>
                <td className="md-lgpower">{r.power}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="md-prevempty">No teams yet — import a meet or results, then save it to the season.</div>}
        {filterBar}
      </div>
    </div>
  );
}

// Distribution of a swimmer's fractional time change (seed → final) in one
// stroke, used to turn "improvement rate" into an actual spread instead of a
// single number. Falls back to a modest, wide-uncertainty guess when there's
// not enough history to estimate a spread from.
function swimmerImprovementStats(name, team, stroke, meets) {
  const deltas = [];
  meets.forEach((m) => { if (m.mode === "timetrial") return; (m.events || []).forEach((ev, ei) => { if (isRelayEvent(ev.name) || categorize(ev.name) !== stroke) return;
    ev.heats.forEach((ht, hi) => ht.lanes.forEach((l) => { if (l.name !== name || l.team !== team) return;
      const d = (m.data || {})[entryId(ei, hi, l.lane)] || {}; const fs = toSeconds(d.time), ss = toSeconds(l.seed);
      if (!isNaN(fs) && !isNaN(ss) && ss > 0) deltas.push((ss - fs) / ss);
    })); }); });
  const n = deltas.length;
  const mean = n ? deltas.reduce((s, v) => s + v, 0) / n : 0.012;
  const variance = n > 1 ? deltas.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  const sd = n > 1 ? Math.sqrt(variance) : 0.03;
  return { mean, sd: Math.max(sd, 0.01), n };
}
// Standard normal CDF (Abramowitz & Stegun 7.1.26 approximation) — used to turn
// a projected-time gap + combined spread into a win probability.
function normCdf(z) {
  const sign = z < 0 ? -1 : 1; const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}
// Project a swimmer's next swim from their current best + their improvement
// spread: a pinpoint "likely" time, plus a best/conservative case ~1sd out.
function projectSwimmer(base, stats) {
  const { mean, sd } = stats;
  // The pinpoint (used for the head-to-head winner call) deliberately only
  // credits half the historical improvement rate — past improvement isn't a
  // guarantee every single swim, so don't over-project it. The spread still
  // uses the full mean+sd on the best-case side to stay realistically wide.
  const pinpoint = mean * 0.5;
  const likely = base * (1 - pinpoint);
  const best = base * (1 - Math.min(mean + sd, 0.14));
  const conservative = base * (1 - (pinpoint - sd));
  return { base, likely, best, conservative, sdTime: base * sd, ...stats };
}

// Swimmer comparison: pick a team, then age group, then swimmer, for each
// side. Projects each swimmer's next swim (pinpoint + best/conservative
// spread) from their own improvement history, then a head-to-head win
// probability from the gap between projections vs. their combined spread.
// Filterable swimmer bank (age group + gender checkboxes) on one side, 4
// comparison slots on the other — drag a bank chip onto a slot to add them,
// drag between slots to swap, or tap-then-tap-a-slot as an alternative to
// dragging (same Pointer Events pattern as the relay lineup editor, since
// iOS/iPadOS Safari doesn't support native HTML5 drag-and-drop for touch).
function CompareBoard({ people, slots, onAssign, onSwap, onRemove, onProfile }) {
  const dragRef = useRef(null);
  const [overSlot, setOverSlot] = useState(null);
  const [draggingKey, setDraggingKey] = useState(null);
  const [selected, setSelected] = useState(null); // { key, source, slotIdx }
  // Age/gender: circular single-select, same as Simple mode — click the same
  // circle again to clear it back to "all".
  const [ageSel, setAgeSel] = useState(null);
  const [genderSel, setGenderSel] = useState(null);
  // Team filter: circular multi-select, all teams on by default — click one
  // off to hide it from the bank, same "turn off what you don't want" idea
  // as the relay builder's team-compare toggles.
  const allTeams = useMemo(() => [...new Set(people.map((p) => p.team))].sort(), [people]);
  const [teamOff, setTeamOff] = useState([]);
  const toggleTeamOff = (t) => setTeamOff((s) => s.includes(t) ? s.filter((x) => x !== t) : [...s, t]);
  const TAP_SLOP = 6;
  const keyOf = (name, team) => name + "|" + team;
  const availAges = useMemo(() => AGE_GROUPS.filter((g) => people.some((p) => ageGroupOf(p.age) === g)), [people]);
  const bank = useMemo(() => people.filter((p) =>
    (!ageSel || ageGroupOf(p.age) === ageSel) &&
    (!genderSel || p.gender === genderSel) &&
    !teamOff.includes(p.team) &&
    !slots.some((s) => s && s.name === p.name && s.team === p.team)
  ), [people, ageSel, genderSel, teamOff, slots]);

  const slotAt = (x, y) => { const el = document.elementFromPoint(x, y); const slot = el && el.closest && el.closest("[data-slot-idx]"); return slot ? Number(slot.getAttribute("data-slot-idx")) : null; };
  const isSame = (a, b) => !!a && !!b && a.key === b.key && a.source === b.source && a.slotIdx === b.slotIdx;
  const onDown = (e, k, source, slotIdx) => { dragRef.current = { key: k, source, slotIdx, x0: e.clientX, y0: e.clientY, moved: false }; setDraggingKey(k); e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); };
  const onMove = (e) => { if (!dragRef.current) return; if (Math.hypot(e.clientX - dragRef.current.x0, e.clientY - dragRef.current.y0) > TAP_SLOP) dragRef.current.moved = true; setOverSlot(slotAt(e.clientX, e.clientY)); };
  const doAssign = (from, targetIdx) => {
    if (from.source === "slot") { if (from.slotIdx === targetIdx) return; onSwap(from.slotIdx, targetIdx); return; }
    const p = people.find((x) => keyOf(x.name, x.team) === from.key); if (p) onAssign(targetIdx, p);
  };
  const endDrag = (e) => {
    if (!dragRef.current) return;
    const cur = dragRef.current; dragRef.current = null; setDraggingKey(null); setOverSlot(null);
    if (cur.moved) { const idx = slotAt(e.clientX, e.clientY); if (idx != null) doAssign({ key: cur.key, source: cur.source, slotIdx: cur.slotIdx }, idx); setSelected(null); return; }
    const tapped = { key: cur.key, source: cur.source, slotIdx: cur.slotIdx };
    if (!selected) { setSelected(tapped); return; }
    if (isSame(selected, tapped)) { setSelected(null); return; }
    if (tapped.slotIdx != null) { doAssign(selected, tapped.slotIdx); setSelected(null); return; }
    setSelected(tapped);
  };
  const chip = (person, source, slotIdx) => {
    const k = keyOf(person.name, person.team);
    return (
      <div key={k} role="button" tabIndex={0} className={"md-rbchip" + (draggingKey === k ? " dragging" : "") + (isSame(selected, { key: k, source, slotIdx }) ? " selected" : "")}
        // Bank chips allow native vertical panning (so the list can still be
        // scrolled by touch) — dragging into a slot is a horizontal gesture
        // and there's always the tap-then-tap-target fallback anyway. Slot
        // chips aren't in a scrolling list, so they keep touch-action:none.
        style={{ touchAction: source === "bank" ? "pan-y" : "none" }}
        onPointerDown={(e) => onDown(e, k, source, slotIdx)} onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
        {person.gender && <em className={"md-gtick " + person.gender.toLowerCase()}>{person.gender[0]}</em>}{person.name}{person.age ? ` (${person.age})` : ""}
        <span className="md-cmpchipteam" style={{ color: teamColor(person.team) }}>{person.team}</span>
        {onProfile && <button type="button" className="md-cmpchipinfo" aria-label={"View " + person.name + "'s profile"}
          onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onProfile(person, e.currentTarget); }}>ⓘ</button>}
      </div>
    );
  };
  return (
    <div className="md-cmpboard">
      <div className="md-cmpslots">
        {slots.map((s, i) => (
          <div key={i} data-slot-idx={i} className={"md-cmpslot" + (overSlot === i ? " over" : "") + (selected ? " selectable" : "")}>
            {s ? <>{chip(s, "slot", i)}<button className="md-cmpslotremove" onClick={() => onRemove(i)}>✕ remove</button></> : <span className="md-cmpslotempty" onClick={() => { if (selected) { doAssign(selected, i); setSelected(null); } }}>Drop swimmer {i + 1} here</span>}
          </div>
        ))}
      </div>
      <div className="md-cmpbank">
        <div className="md-cmpbankfilters">
          <div className="md-cmpradiogrp"><span className="md-cmpchecklabel">Gender</span>{["Girls", "Boys"].map((g) => <label key={g} className="md-cmpradio"><input type="checkbox" checked={genderSel === g} onChange={() => setGenderSel(genderSel === g ? null : g)} />{g}</label>)}</div>
          <div className="md-cmpradiogrp"><span className="md-cmpchecklabel">Age</span>{availAges.length ? availAges.map((g) => <label key={g} className="md-cmpradio"><input type="checkbox" checked={ageSel === g} onChange={() => setAgeSel(ageSel === g ? null : g)} />{g}</label>) : <span className="md-cmpchecklabel">—</span>}</div>
          <div className="md-cmpcheckgrp"><span className="md-cmpchecklabel">Teams</span>{allTeams.map((t) => (
            <label key={t} className="md-cmpteamdot"><input type="checkbox" checked={!teamOff.includes(t)} onChange={() => toggleTeamOff(t)} />
              <span className="md-cmpteamcircle" style={{ background: teamOff.includes(t) ? "#fff" : teamColor(t), borderColor: teamColor(t) }} />{t}
            </label>
          ))}</div>
        </div>
        <div className="md-rbbenchlabel">Drag a swimmer onto a slot — or tap a name, then tap the slot</div>
        <div className="md-rbbench md-cmpbanklist">
          {bank.length ? bank.map((p) => chip(p, "bank", null)) : <span className="md-rbbenchempty">No swimmers match this filter.</span>}
        </div>
      </div>
    </div>
  );
}

// Simple-mode picker: one swimmer chosen via team + single-select (circle,
// not multi-select) age/gender filters + a name dropdown, instead of the
// Complex mode's drag-and-drop bank. Two of these side by side replace the
// 4-slot board when the coach just wants a quick head-to-head.
function SimplePicker({ idx, people, slot, onAssign, onRemove }) {
  const [team, setTeam] = useState(slot ? slot.team : "");
  const [ageSel, setAgeSel] = useState(null);
  const [genderSel, setGenderSel] = useState(null);
  const teams = useMemo(() => [...new Set(people.map((p) => p.team))].sort(), [people]);
  const availAges = useMemo(() => AGE_GROUPS.filter((g) => people.some((p) => (!team || p.team === team) && ageGroupOf(p.age) === g)), [people, team]);
  const filtered = useMemo(() => people.filter((p) => (!team || p.team === team) && (!ageSel || ageGroupOf(p.age) === ageSel) && (!genderSel || p.gender === genderSel)), [people, team, ageSel, genderSel]);
  const curVal = slot ? slot.name + "|" + slot.team : "";
  return (
    <div className="md-cmpsimplecard">
      <div className="md-cmpsimplehead">Swimmer {idx + 1}</div>
      <label className="md-ctl">Team<select value={team} onChange={(e) => { setTeam(e.target.value); onRemove(); }}>
        <option value="">Any team</option>{teams.map((t) => <option key={t} value={t}>{t}</option>)}
      </select></label>
      <div className="md-cmpradiogrp"><span className="md-cmpchecklabel">Gender</span>{["Girls", "Boys"].map((g) => (
        <label key={g} className="md-cmpradio"><input type="checkbox" checked={genderSel === g} onChange={() => setGenderSel(genderSel === g ? null : g)} />{g}</label>
      ))}</div>
      <div className="md-cmpradiogrp"><span className="md-cmpchecklabel">Age</span>{availAges.length ? availAges.map((g) => (
        <label key={g} className="md-cmpradio"><input type="checkbox" checked={ageSel === g} onChange={() => setAgeSel(ageSel === g ? null : g)} />{g}</label>
      )) : <span className="md-cmpchecklabel">—</span>}</div>
      <label className="md-ctl">Swimmer<select value={curVal} onChange={(e) => { const p = filtered.find((x) => x.name + "|" + x.team === e.target.value); onAssign(p || null); }}>
        <option value="">Choose…</option>{filtered.map((p) => <option key={p.name + "|" + p.team} value={p.name + "|" + p.team}>{p.name}{p.age ? ` (${p.age})` : ""} — {p.team}</option>)}
      </select></label>
      {slot && <button className="md-cmpslotremove" onClick={onRemove}>✕ remove</button>}
    </div>
  );
}

function SwimmerCompareModal({ onClose, events, data, seasonMeets, homeTeam, mode, onModeChange, onOpenLeague }) {
  const meets = useMemo(() => [{ meetName: "This meet", mode: "meet", events, data }, ...seasonMeets], [events, data, seasonMeets]);
  const power = useMemo(() => computePower(meets), [meets]);
  const people = useMemo(() => Object.values(power).sort((a, b) => a.name.localeCompare(b.name)), [power]);
  const [stroke, setStroke] = useState("Free");
  const [slots, setSlots] = useState([null, null, null, null]); // { name, team }
  const toggleMode = () => { onModeChange(mode === "complex" ? "simple" : "complex"); setSlots([null, null, null, null]); };
  // Profile popover for a bank swimmer — same card used from the meet sheet,
  // just opened locally instead of through the App's popover stack.
  const [profilePop, setProfilePop] = useState(null); // { name, team, rect }
  const openProfile = (p, el) => setProfilePop({ name: p.name, team: p.team, rect: el.getBoundingClientRect() });

  const assign = (idx, person) => setSlots((s) => { const ns = [...s]; ns[idx] = { name: person.name, team: person.team }; return ns; });
  const removeSlot = (idx) => setSlots((s) => { const ns = [...s]; ns[idx] = null; return ns; });
  const swapSlots = (i, j) => setSlots((s) => { const ns = [...s]; [ns[i], ns[j]] = [ns[j], ns[i]]; return ns; });

  const proj = (slot) => { if (!slot) return null;
    const times = swimmerStrokeTimes(slot.name, slot.team, stroke, meets).map((t) => toSeconds(t.final) || toSeconds(t.seed)).filter((x) => !isNaN(x));
    if (!times.length) return null;
    const stats = swimmerImprovementStats(slot.name, slot.team, stroke, meets);
    return { name: slot.name, team: slot.team, ...projectSwimmer(Math.min(...times), stats) };
  };
  const projections = slots.map(proj);
  const filled = projections.filter(Boolean);
  const simKey = (p) => p.name + "|" + p.team;
  const winProb = useMemo(() => filled.length >= 2 ? simulateRelayField(filled.map((p) => ({ team: simKey(p), projTotal: p.likely, sd: p.sdTime || 0.05 }))) : {}, [filled]);
  const domain = filled.length ? { min: Math.min(...filled.map((p) => p.best)), max: Math.max(...filled.map((p) => p.conservative)) } : null;
  const pct = (t) => domain ? Math.min(100, Math.max(0, ((t - domain.min) / (domain.max - domain.min || 1)) * 100)) : 0;
  const fastest = filled.length ? [...filled].sort((a, b) => a.likely - b.likely)[0] : null;

  return (
    <div className="md-scrim" onClick={onClose}>
      <div className="md-modal md-imp md-cmpmodal" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="md-mhead"><button className="md-logo sm" onClick={onClose} aria-label="Home" title="MeetDeck — home">≈</button><div className="md-mheadtxt"><div className="md-mtitle">Swimmer comparison</div><div className="md-msub">{mode === "complex" ? "Drag up to 4 swimmers from the bank into the slots." : "Pick 2 swimmers by team, age and gender."} Projections use each swimmer's own improvement spread.</div></div><button className="md-x" onClick={onClose}>✕</button></div>
        <div className="md-rbctl">
          <label className="md-ctl">Stroke<select value={stroke} onChange={(e) => setStroke(e.target.value)}>{PROG_STROKES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <button className="md-cmpmodebtn" onClick={toggleMode}>{mode === "complex" ? "Simple" : "Complex"}</button>
        </div>
        {mode === "complex" ? (
          <CompareBoard people={people} slots={slots} onAssign={assign} onSwap={swapSlots} onRemove={removeSlot} onProfile={openProfile} />
        ) : (
          <div className="md-cmpsimplewrap">
            <SimplePicker idx={0} people={people} slot={slots[0]} onAssign={(p) => (p ? assign(0, p) : removeSlot(0))} onRemove={() => removeSlot(0)} />
            <SimplePicker idx={1} people={people} slot={slots[1]} onAssign={(p) => (p ? assign(1, p) : removeSlot(1))} onRemove={() => removeSlot(1)} />
          </div>
        )}
        {slots.some(Boolean) && (
          <div className="md-cmpspreadwrap">
            {slots.map((s, i) => { const p = projections[i]; if (!s) return null;
              return (
                <div key={i} className="md-cmpspreadrow">
                  <div className="md-cmpspreadname" style={{ color: teamColor(s.team) }}>{s.name} <em>{s.team}</em>{p && winProb[simKey(p)] != null && <b className="md-cmpprobpct">{(winProb[simKey(p)] * 100).toFixed(0)}% to touch first</b>}</div>
                  {p ? (
                    <div className="md-cmpspread">
                      <div className="md-cmptrack">
                        <div className="md-cmpband" style={{ left: pct(p.best) + "%", width: Math.max(2, pct(p.conservative) - pct(p.best)) + "%" }} />
                        <div className="md-cmppin" style={{ left: pct(p.likely) + "%" }} title={`pinpoint ${fmtT(p.likely)}`} />
                      </div>
                      <div className="md-cmpspreadlabels"><span>{fmtT(p.best)}</span><span className="mid">{fmtT(p.likely)}</span><span>{fmtT(p.conservative)}</span></div>
                      <div className="md-cmprate">current best {fmtT(p.base)} · trending {(p.mean * 100).toFixed(1)}%/swim{p.n < 3 ? " (thin history)" : ""}</div>
                    </div>
                  ) : <div className="md-prevempty">No {stroke} time on record.</div>}
                </div>
              ); })}
          </div>
        )}
        {fastest && filled.length >= 2 && <div className="md-cmpwin">Projected fastest: <b style={{ color: teamColor(fastest.team) }}>{fastest.name}</b> ({fmtT(fastest.likely)}) · {((winProb[simKey(fastest)] || 0) * 100).toFixed(0)}% to touch first</div>}
        <div className="md-mfoot"><button className="md-apply" onClick={onClose}>Done</button></div>
      </div>
      {profilePop && (
        // Stops a click on the popover (e.g. its own ✕) from bubbling up to
        // the .md-scrim's onClick, which would otherwise close the whole
        // comparison modal along with the popover.
        <div onClick={(e) => e.stopPropagation()}>
          <SwimmerProfilePopover name={profilePop.name} team={profilePop.team} seasonMeets={seasonMeets} liveMeet={{ meetName: "This meet", events, data }} rect={profilePop.rect} depth={0} onClose={() => setProfilePop(null)} onOpenLeague={onOpenLeague} />
        </div>
      )}
    </div>
  );
}

// Projects a relay's total using each swimmer's own improvement spread
// instead of their raw seed time, and carries the combined uncertainty
// (variances add for independent legs) needed to simulate the field.
function projectRelay(relay, meets) {
  const legs = relay.swimmers.map((sw) => { const stroke = sw.stroke || "Free"; const stats = swimmerImprovementStats(sw.name, relay.team, stroke, meets); return { name: sw.name, gender: sw.gender, stroke, ...projectSwimmer(sw.s, stats) }; });
  const projTotal = legs.reduce((a, l) => a + l.likely, 0);
  const sd = Math.sqrt(legs.reduce((a, l) => a + l.sdTime ** 2, 0)) || 0.05;
  return { ...relay, legs, projTotal, sd };
}
// Re-look-up a swimmer's leg time for a manual lineup override.
function applyRelayOverride(relay, overrideNames, meets, ageGroup, genderMap) {
  if (!overrideNames || !overrideNames.some(Boolean)) return relay;
  const roster = seasonRoster(meets, relay.team);
  const swimmers = relay.swimmers.map((leg, i) => { const on = overrideNames[i]; if (!on || on === leg.name) return leg;
    const cand = roster.find((c) => c.name === on); if (!cand) return leg;
    const gender = genderMap[on + "|" + relay.team]; const stroke = leg.stroke || "Free";
    const s = bestLegTime(meets, on, relay.team, stroke, ageGroup, gender);
    return { name: on, age: cand.age, gender, stroke, s: s != null ? s : leg.s };
  });
  return { ...relay, swimmers, total: swimmers.reduce((a, b) => a + b.s, 0) };
}
function gaussian() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
// Monte Carlo the field: each team's total is drawn from Normal(projTotal, sd)
// per trial, fastest wins that trial. Cheap (a few thousand draws) and handles
// >2 teams naturally, unlike a pairwise normal-CDF comparison.
function simulateRelayField(projected, iters = 3000) {
  const wins = {}; projected.forEach((r) => (wins[r.team] = 0));
  for (let i = 0; i < iters; i++) {
    let bestTeam = null, bestTime = Infinity;
    projected.forEach((r) => { const t = r.projTotal + gaussian() * r.sd; if (t < bestTime) { bestTime = t; bestTeam = r.team; } });
    if (bestTeam) wins[bestTeam]++;
  }
  const out = {}; projected.forEach((r) => (out[r.team] = wins[r.team] / iters)); return out;
}

// Drag-and-drop (or tap-to-select, tap-to-move) lineup editor for one team's
// relay: 4 leg slots plus a bench of the rest of the team's roster. Drop a
// bench chip onto a leg to swap them in; drop a leg chip onto another leg to
// swap the two swimmers' positions. Built on Pointer Events (not native
// HTML5 drag-and-drop, which iOS/iPadOS Safari doesn't support for touch)
// with setPointerCapture so the gesture keeps tracking the finger/cursor
// regardless of what's underneath; the actual drop target is resolved via
// elementFromPoint since captured pointers don't fire hover/enter events on
// other elements. A tap that barely moves is treated as select-then-move
// instead of a drag, for coaches who find two taps easier than a drag.
function RelayLegDragBoard({ legs, bench, relayType, mixed, doubleANames, doubleASeverity, onAssign }) {
  const dragRef = useRef(null);
  const [overLeg, setOverLeg] = useState(null);
  const [draggingName, setDraggingName] = useState(null);
  const [selected, setSelected] = useState(null); // tap-to-select: { name, source, legIdx }
  const [benchFilter, setBenchFilter] = useState("All");
  const TAP_SLOP = 6; // px of movement below which a gesture counts as a tap, not a drag
  const legAt = (x, y) => { const el = document.elementFromPoint(x, y); const slot = el && el.closest && el.closest("[data-leg-idx]"); return slot ? Number(slot.getAttribute("data-leg-idx")) : null; };
  const isSame = (a, b) => !!a && !!b && a.name === b.name && a.source === b.source && a.legIdx === b.legIdx;
  const onDown = (e, name, source, legIdx) => { dragRef.current = { name, source, legIdx, x0: e.clientX, y0: e.clientY, moved: false }; setDraggingName(name); e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); };
  const onMove = (e) => { if (!dragRef.current) return; if (Math.hypot(e.clientX - dragRef.current.x0, e.clientY - dragRef.current.y0) > TAP_SLOP) dragRef.current.moved = true; setOverLeg(legAt(e.clientX, e.clientY)); };
  const endDrag = (e) => {
    if (!dragRef.current) return;
    const cur = dragRef.current; dragRef.current = null; setDraggingName(null); setOverLeg(null);
    if (cur.moved) { const idx = legAt(e.clientX, e.clientY); if (idx != null) onAssign({ name: cur.name, source: cur.source, legIdx: cur.legIdx }, idx); setSelected(null); return; }
    // Tap (negligible movement): first tap selects, second tap on a leg moves
    // the selection there, tapping the same chip again deselects, and
    // tapping a different bench chip just re-selects that one instead.
    const tapped = { name: cur.name, source: cur.source, legIdx: cur.legIdx };
    if (!selected) { setSelected(tapped); return; }
    if (isSame(selected, tapped)) { setSelected(null); return; }
    if (tapped.legIdx != null) { onAssign(selected, tapped.legIdx); setSelected(null); return; }
    setSelected(tapped);
  };
  const doubleACls = (name) => doubleANames && doubleANames.includes(name) ? " doubleA-" + doubleASeverity : "";
  const chip = (name, age, gender, source, legIdx, cls) => (
    <button key={name} type="button" className={"md-rbchip" + (cls ? " " + cls : "") + (draggingName === name ? " dragging" : "") + (isSame(selected, { name, source, legIdx }) ? " selected" : "") + doubleACls(name)} style={{ touchAction: "none" }}
      onPointerDown={(e) => onDown(e, name, source, legIdx)} onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
      {gender && <em className={"md-gtick " + gender.toLowerCase()}>{gender[0]}</em>}{name}{age ? ` (${age})` : ""}
    </button>
  );
  const shownBench = mixed && benchFilter !== "All" ? bench.filter((c) => c.gender === benchFilter) : bench;
  return (
    <div className="md-rbdrag">
      <div className="md-rbdraglegs">
        {legs.map((l, i) => (
          <div key={i} data-leg-idx={i} className={"md-rbdragleg" + (overLeg === i ? " over" : "") + (selected ? " selectable" : "")}>
            {relayType === "Medley" && <span className="md-rbeditstroke">{l.stroke}</span>}
            {chip(l.name, l.age, l.gender, "leg", i)}
          </div>
        ))}
      </div>
      <div className="md-rbbenchlabel">Drag a name onto a leg — or tap a name, then tap the leg to move them there</div>
      {mixed && (
        <div className="md-rbbenchfilter">
          {["All", "Girls", "Boys"].map((g) => <button key={g} type="button" className={"md-rbfilterbtn" + (benchFilter === g ? " on" : "")} onClick={() => setBenchFilter(g)}>{g}</button>)}
        </div>
      )}
      <div className="md-rbbench">
        {shownBench.length ? shownBench.map((c) => chip(c.name, c.age, c.gender, "bench", null, "bench")) : <span className="md-rbbenchempty">No one else on the roster for this age group{mixed && benchFilter !== "All" ? " (" + benchFilter.toLowerCase() + ")" : ""}.</span>}
      </div>
    </div>
  );
}

// "Who's coming" attendance popup — anchored to its trigger button with a
// caret, like the swimmer popovers. Everyone on the roster starts checked in
// (present); unchecking marks them absent so relay auto-picks and the manual
// edit bench skip them, same path as the locked-other-relay exclusion.
// A connected Yes/No segmented control — not a checkbox. Tap either side to
// set it directly, or drag the thumb across; both just move it to whichever
// side is under the pointer, same Pointer Events pattern as the drag boards
// elsewhere in this file (reliable on iPad, unlike relying on click targets).
function AttendanceToggle({ present, onToggle }) {
  const dragRef = useRef(null);
  const applyFromX = (e) => {
    const el = e.currentTarget.getBoundingClientRect();
    const wantsYes = e.clientX < el.left + el.width / 2;
    if (wantsYes !== present) onToggle();
  };
  const onDown = (e) => { dragRef.current = true; e.currentTarget.setPointerCapture(e.pointerId); applyFromX(e); };
  const onMove = (e) => { if (dragRef.current) applyFromX(e); };
  const endDrag = () => { dragRef.current = false; };
  return (
    <div className="md-attndtoggle" style={{ touchAction: "none" }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <span className={"md-attndthumb" + (present ? "" : " no")} />
      <span className={"md-attndseg yes" + (present ? " on" : "")}>Yes</span>
      <span className={"md-attndseg no" + (!present ? " on" : "")}>No</span>
    </div>
  );
}
function AttendancePopup({ team, roster, isAbsent, onToggle, onResetAll, rect, onClose }) {
  const ref = useRef(null);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState({ top: rect.bottom + 10, left: rect.left, caret: 24 });
  useLayoutEffect(() => {
    const W = 280, m = 10, vw = window.innerWidth, vh = window.innerHeight, h = ref.current ? ref.current.offsetHeight : 320;
    let top = rect.bottom + 10;
    if (top + h > vh - m) top = Math.max(m, vh - h - m);
    const left = Math.min(Math.max(m, rect.left), vw - W - m);
    setPos({ top, left, caret: Math.min(Math.max(16, rect.left + rect.width / 2 - left), W - 24) });
  }, [rect]);
  const q = search.trim().toLowerCase();
  const filtered = q ? roster.filter((s) => s.name.toLowerCase().includes(q)) : roster;
  const absentCount = roster.filter((s) => isAbsent(s.name)).length;
  return (
    <div ref={ref} className="md-attndpov" style={{ top: pos.top, left: pos.left }} role="dialog">
      <span className="md-caret" style={{ left: pos.caret }} />
      <div className="md-agepovhead"><span>Who's coming — {team}</span><button className="md-x sm" onClick={onClose}>✕</button></div>
      <div className="md-attndsub">{roster.length - absentCount} of {roster.length} present{absentCount > 0 && <button className="md-attndreset" onClick={onResetAll}>Reset — everyone coming</button>}</div>
      <input className="md-attndsearch" placeholder="Search swimmers…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="md-attndlist">
        {filtered.length ? filtered.map((s) => (
          <div key={s.name} className="md-attndrow">
            <span className="md-attndname">{s.name}{s.age ? <em> ({s.age})</em> : null}</span>
            <AttendanceToggle present={!isAbsent(s.name)} onToggle={() => onToggle(s.name)} />
          </div>
        )) : <div className="md-prevempty">No swimmers match.</div>}
      </div>
    </div>
  );
}

// Relay builder: fastest 4-swimmer relay per team built from the WHOLE
// SEASON (not just the loaded meet) — Free or Medley, home team highlighted,
// ranked by projected time (each swimmer's improvement trend factored in)
// with a simulated probability of touching first. Every other team is shown
// at ITS season-best lineup too, since that's usually who shows up at champs
// even though it means we sometimes project a harder finish than we actually
// get (their real lineup isn't always their fastest). Coaches can plug in a
// different swimmer per leg to explore "what if" lineups, and Lock in a
// lineup — for our team or any opponent — to freeze it while comparing.
// A locked A relay also keeps that swimmer out of the OTHER stroke type's
// auto-pick for the same team/age (one A relay per person); B/C/D depth
// squads aren't built yet, so that's the only exclusivity enforced today.
function RelayBuilderModal({ onClose, events, data, seasonMeets, homeTeam }) {
  const meets = useMemo(() => [{ meetName: "This meet", mode: "meet", events, data }, ...(seasonMeets || [])], [events, data, seasonMeets]);
  const ageGroups = useMemo(() => AGE_GROUPS.filter((g) => meets.some((m) => (m.events || []).some((e) => !isRelayEvent(e.name) && evAgeGroup(e.name) === g))), [meets]);
  const [ag, setAg] = useState(ageGroups[0] || "11-12");
  const [gender, setGender] = useState("Girls");
  const [relayType, setRelayType] = useState("Free");
  const [overrides, setOverrides] = useState({});
  const [locked, setLocked] = useState({});
  const [editing, setEditing] = useState(null);
  const mixed = MIXED_GROUPS.includes(ag);
  const genderMap = useMemo(() => seasonGenderMap(meets), [meets]);
  const keyFor = (team, type) => (type || relayType) + "|" + ag + "|" + team;
  const otherType = relayType === "Free" ? "Medley" : "Free";
  // Every team that appears anywhere in the season data — the coach opts
  // teams into the comparison (home team is always included); teams left
  // unchecked are hidden entirely rather than always showing everyone found.
  const allTeams = useMemo(() => { const s = new Set(); meets.forEach((m) => (m.events || []).forEach((ev) => ev.heats.forEach((ht) => ht.lanes.forEach((l) => s.add(l.team))))); return [...s].sort(); }, [meets]);
  const [selTeams, setSelTeams] = useState(() => [homeTeam]);
  const toggleTeam = (t) => setSelTeams((s) => s.includes(t) ? s.filter((x) => x !== t) : [...s, t]);
  const rankTeams = useMemo(() => [...new Set([homeTeam, ...selTeams])], [homeTeam, selTeams]);
  // Who's actually at the meet — keyed name|team, false = marked absent,
  // missing/true = present (everyone starts checked in). Feeds straight into
  // excludeByTeam below so absent swimmers never get auto-picked or offered
  // as a manual bench candidate, same path as the locked-other-relay rule.
  const [attendance, setAttendance] = useState({});
  const [attendanceOpen, setAttendanceOpen] = useState(null); // { rect } | null
  const isAbsent = (name, team) => attendance[name + "|" + team] === false;
  const toggleAttendance = (name, team) => setAttendance((a) => ({ ...a, [name + "|" + team]: a[name + "|" + team] === false ? true : false }));
  const resetAttendance = (team) => setAttendance((a) => { const na = {}; Object.entries(a).forEach(([k, v]) => { if (!k.endsWith("|" + team)) na[k] = v; }); return na; });
  // If a team doesn't have 8+ swimmers in this age group, there just aren't
  // enough people for two fully-distinct A squads — let someone swim both
  // instead of leaving a relay short. Only enforce "one A relay per person"
  // when the roster is deep enough to reasonably expect it. Absent swimmers
  // are always excluded regardless of depth — they just aren't there.
  const excludeByTeam = (team) => { const other = locked[keyFor(team, otherType)];
    const depth = seasonRoster(meets, team).filter((c) => ageGroupOf(c.age) === ag).length;
    const otherExcl = other && depth >= 8 ? other.swimmers.map((s) => s.name) : [];
    const absent = seasonRoster(meets, team).filter((c) => ageGroupOf(c.age) === ag && isAbsent(c.name, team)).map((c) => c.name);
    if (!otherExcl.length && !absent.length) return null;
    return new Set([...otherExcl, ...absent]); };
  const baseRelaysAll = useMemo(() => relayType === "Medley" ? buildMedleyRelaysSeason(meets, ag, gender, excludeByTeam) : buildFreeRelaysSeason(meets, ag, gender, excludeByTeam), [meets, ag, gender, relayType, locked, attendance]);
  const baseRelays = useMemo(() => baseRelaysAll.filter((r) => rankTeams.includes(r.team)), [baseRelaysAll, rankTeams]);
  const relays = useMemo(() => baseRelays.map((r) => { const key = keyFor(r.team); if (locked[key]) return locked[key]; return applyRelayOverride(r, overrides[key], meets, ag, genderMap); }).sort((a, b) => a.total - b.total), [baseRelays, overrides, locked, meets, ag, genderMap, relayType]);
  const projected = useMemo(() => relays.map((r) => projectRelay(r, meets)).sort((a, b) => a.projTotal - b.projTotal), [relays, meets]);
  const winProb = useMemo(() => simulateRelayField(projected), [projected]);
  const homeIdx = projected.findIndex((r) => r.team === homeTeam);
  const homeRow = homeIdx >= 0 ? projected[homeIdx] : null;
  const otherRows = projected.filter((r) => r.team !== homeTeam);
  const rosterFor = (team) => seasonRoster(meets, team).filter((c) => ageGroupOf(c.age) === ag).sort((a, b) => a.name.localeCompare(b.name));
  const setLeg = (team, legIdx, name) => { const key = keyFor(team); setOverrides((o) => { const cur = (o[key] || [null, null, null, null]).slice(); cur[legIdx] = name || null; return { ...o, [key]: cur }; });
    setLocked((l) => { if (!l[key]) return l; const { [key]: _, ...rest } = l; return rest; }); };
  const toggleLock = (r) => { const key = keyFor(r.team); setLocked((l) => { if (l[key]) { const { [key]: _, ...rest } = l; return rest; } return { ...l, [key]: r }; }); };
  // Full revert: clears both manual leg overrides AND lock state for a team,
  // back to whatever the builder auto-picks right now — unlike "Reset to
  // auto-picked" (overrides only, while still editing), this undoes everything.
  const revertTeam = (team) => { const key = keyFor(team);
    setOverrides((o) => { if (!o[key]) return o; const { [key]: _, ...rest } = o; return rest; });
    setLocked((l) => { if (!l[key]) return l; const { [key]: _, ...rest } = l; return rest; }); };
  const onAssign = (r, drag, targetIdx) => {
    if (drag.source === "leg") { if (drag.legIdx === targetIdx) return; setLeg(r.team, targetIdx, drag.name); setLeg(r.team, drag.legIdx, r.legs[targetIdx].name); }
    else setLeg(r.team, targetIdx, drag.name);
  };
  const teamCard = (r, rankIdx, extraClass) => {
    const key = keyFor(r.team); const isLocked = !!locked[key]; const hasOverride = overrides[key] && overrides[key].some(Boolean); const roster = editing === r.team ? rosterFor(r.team) : [];
    const excluded = excludeByTeam(r.team); // this team's other-type A relay, locked in — those 4 aren't eligible here
    const otherLocked = locked[keyFor(r.team, otherType)];
    const depth = seasonRoster(meets, r.team).filter((c) => ageGroupOf(c.age) === ag).length;
    const doubleANames = otherLocked ? r.legs.filter((l) => otherLocked.swimmers.some((s) => s.name === l.name)).map((l) => l.name) : [];
    const doubleASeverity = depth < 8 ? "yellow" : "red";
    return (
      <div key={r.team} className={"md-rbteam" + (extraClass ? " " + extraClass : "") + (isLocked ? " locked" : "")}>
        <div className="md-rbhead"><span className="md-rbrank">{rankIdx + 1}</span><span className="md-rbteamname" style={{ color: teamColor(r.team) }}>{r.team}</span>
          <span className="md-rbtotal">{fmtT(r.projTotal)}<span className="md-rbproj">seed {fmtT(r.total)}</span></span>
          {rankIdx > 0 && <span className="md-rbgap">+{fmtT(r.projTotal - projected[0].projTotal)}</span>}
          <button className={"md-rblock" + (isLocked ? " on" : "")} onClick={() => toggleLock(r)}>{isLocked ? "🔒 Locked" : "🔓 Lock in"}</button>
          <button className={"md-rbedit" + (hasOverride ? " on" : "")} onClick={() => setEditing(editing === r.team ? null : r.team)}>✎ {editing === r.team ? "Done" : "Edit"}</button>
          {(isLocked || hasOverride) && <button className="md-rbrevert" onClick={() => revertTeam(r.team)} title="Undo lock + edits, back to auto-picked">↺ Revert</button>}
        </div>
        {editing === r.team ? (
          <div className="md-rbeditgrid">
            <RelayLegDragBoard
              legs={r.legs}
              bench={roster.filter((c) => !r.legs.some((l) => l.name === c.name) && (!excluded || !excluded.has(c.name))).map((c) => ({ ...c, gender: genderMap[c.name + "|" + r.team] }))}
              relayType={relayType}
              mixed={mixed}
              doubleANames={doubleANames}
              doubleASeverity={doubleASeverity}
              onAssign={(drag, targetIdx) => onAssign(r, drag, targetIdx)}
            />
            {hasOverride && <button className="md-rbreset" onClick={() => setOverrides((o) => ({ ...o, [key]: null }))}>↺ Reset to auto-picked</button>}
          </div>
        ) : (
          <div className="md-rbswimmers">{r.legs.map((l, j) => <span key={j} className={"md-rbswim" + (doubleANames.includes(l.name) ? " doubleA-" + doubleASeverity : "")}>{l.gender ? <em className={"md-gtick " + l.gender.toLowerCase()}>{l.gender[0]}</em> : null}{relayType === "Medley" && <b className="md-rbstroke">{l.stroke} </b>}{l.name} <em>{fmtT(l.likely)}</em></span>)}</div>
        )}
        <div className="md-rbprob"><div className="md-rbprobbar"><div className="md-rbprobfill" style={{ width: ((winProb[r.team] || 0) * 100).toFixed(0) + "%" }} /></div><span className="md-rbprobval">{((winProb[r.team] || 0) * 100).toFixed(0)}%</span></div>
      </div>
    );
  };
  return (
    <div className="md-scrim" onClick={onClose}>
      <div className="md-modal md-imp" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="md-mhead"><button className="md-logo sm" onClick={onClose} aria-label="Home" title="MeetDeck — home">≈</button><div className="md-mheadtxt"><div className="md-mtitle">Relay builder — fastest {relayType.toLowerCase()} relay</div><div className="md-msub">Built from the whole season ({meets.length} meet{meets.length === 1 ? "" : "s"}) · check off teams to compare against · lock in a lineup to freeze it while comparing.</div></div><button className="md-x" onClick={onClose}>✕</button></div>
        <div className="md-rbctl">
          <div className="md-rbtabs">{["Free", "Medley"].map((t) => <button key={t} className={"md-rbtab" + (relayType === t ? " on" : "")} onClick={() => setRelayType(t)}>{t}</button>)}</div>
          <label className="md-ctl">Age<select value={ag} onChange={(e) => setAg(e.target.value)}>{ageGroups.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
          {mixed ? <span className="md-mixtag">Mixed</span> : <label className="md-ctl">Gender<select value={gender} onChange={(e) => setGender(e.target.value)}>{["Girls", "Boys"].map((g) => <option key={g} value={g}>{g}</option>)}</select></label>}
          <button className="md-mbtn sm" onClick={(e) => setAttendanceOpen(attendanceOpen ? null : { rect: e.currentTarget.getBoundingClientRect() })}>🧍 Who's coming</button>
        </div>
        {attendanceOpen && <AttendancePopup team={homeTeam} roster={rosterFor(homeTeam)} isAbsent={(name) => isAbsent(name, homeTeam)} onToggle={(name) => toggleAttendance(name, homeTeam)} onResetAll={() => resetAttendance(homeTeam)} rect={attendanceOpen.rect} onClose={() => setAttendanceOpen(null)} />}
        <div className="md-impbar"><span className="md-impnote">Compare against:</span>
          <span className="md-teamsel">{allTeams.filter((t) => t !== homeTeam).map((t) => <button key={t} className={"md-teamchip" + (selTeams.includes(t) ? " on" : "")} style={selTeams.includes(t) ? { background: teamColor(t), borderColor: teamColor(t), color: "#0a1628" } : {}} onClick={() => toggleTeam(t)}>{t}</button>)}</span></div>
        {homeRow && <div className="md-rbhometeam">
          <div className="md-rbhometeamlabel">Your team — projected {ORD(homeIdx + 1)} of {projected.length}</div>
          {teamCard(homeRow, homeIdx, "mine top")}
        </div>}
        <div className="md-rblist">
          {otherRows.length ? otherRows.map((r) => teamCard(r, projected.indexOf(r)))
            : (projected.length === 0 ? <div className="md-prevempty">No full 4-swimmer set found for this group across the season. Try another age, or import more results.</div>
              : <div className="md-prevempty">Check off a team above to compare against.</div>)}
        </div>
        <div className="md-mfoot"><button className="md-apply" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

// ---- results-sheet parser (single-column Hy-Tek "Results") ----------------
// Rows: PLACE  Last, First [MI]  AGE  Full Team Name  SeedTime  FinalsTime
// Finals time = the last decimal time on the row. Relays: PLACE Team A ... time.
function parseResults(text) {
  if (!text || !text.trim()) return [];
  const events = []; let ev = null;
  for (let raw of text.split(/\r?\n/)) {
    let line = raw.replace(/\s+/g, " ").trim(); if (!line) continue;
    const m = line.match(/^\(?event\s+(\d+)\s+(.+?)\)?$/i);
    if (m && /(free|back|breast|fly|medley|relay|\bim\b)/i.test(line)) { ev = { num: m[1], name: m[2].replace(/\)+$/, "").trim(), relay: /relay/i.test(m[2]), heats: [{ num: 1, lanes: [] }] }; events.push(ev); continue; }
    if (!ev) continue;
    if (/^name age team|^team relay|vcsl record|hy-tek|valley cabana|^results|^\d{4} vcsl|meet -|belwood:/i.test(line)) continue;
    // A DQ'd individual swim shows "DQ" in place of (or alongside) the finals
    // time — strip it out before matching name/age/team so it doesn't get
    // swallowed into the team token, but remember it so we can flag a
    // pending DQ on merge (relay DQ rows aren't handled here).
    const isDq = !ev.relay && /\bdq\b/i.test(line);
    const cleanLine = isDq ? line.replace(/\bdq\b/gi, " ").replace(/\s+/g, " ").trim() : line;
    const times = [...cleanLine.matchAll(/\b\d{1,2}:\d{2}\.\d{2}\b|\b\d{1,3}\.\d{2}\b/g)].map((x) => x[0]);
    if (!times.length && !isDq) continue;
    const seed = times.length > 1 ? times[0] : "NT", final = times.length ? times[times.length - 1] : "";
    if (!ev.relay) {
      const nm = cleanLine.match(/^\*?\d+\s+([A-Za-zÀ-ÿ'’.\-]+,\s*[A-Za-zÀ-ÿ'’.\- ]+?)\s+(\d{1,2})\s+([A-Za-z].*)$/);
      if (nm) ev.heats[0].lanes.push({ name: nm[1].trim(), age: +nm[2], team: normTeam(nm[3]), seed, finalTime: final, lane: ev.heats[0].lanes.length + 1, ...(isDq ? { dq: true } : {}) });
    } else {
      const rm = line.match(/^\*?\d+\s+(.+?)\s+([A-Z])\b/);
      if (rm) ev.heats[0].lanes.push({ name: normTeam(rm[1]) + " " + rm[2], team: normTeam(rm[1]), relay: rm[2], seed, finalTime: final, lane: ev.heats[0].lanes.length + 1, swimmers: [] });
    }
  }
  return events;
}

// Turn a parsed results sheet into a full standalone meet (events + final times).
function resultsToMeet(parsed) {
  const byNum = {}, order = [];
  parsed.forEach((ev) => { if (!byNum[ev.num]) { byNum[ev.num] = { num: ev.num, name: ev.name, lanes: [] }; order.push(ev.num); } ev.heats[0].lanes.forEach((l) => byNum[ev.num].lanes.push(l)); });
  const events = [], data = {};
  order.forEach((num, i) => { const g = byNum[num]; const lanes = g.lanes.map((l, j) => ({ lane: j + 1, name: l.name, age: l.age || 0, team: l.team, seed: l.seed || "NT", ...(l.relay ? { relay: l.relay, swimmers: [] } : {}) }));
    events.push({ id: "ev" + i, num: g.num, name: g.name, flat: true, heats: [{ num: 1, lanes }] });
    g.lanes.forEach((l, j) => { if (l.finalTime) data[entryId(i, 0, j + 1)] = { time: l.finalTime, dqs: [], tags: {}, notes: "" }; });
  });
  return { events: events.filter((e) => e.heats[0].lanes.length), data };
}

// ---- parser tuned to the de-columned Hy-Tek "Meet Program" layout ---------
function parseHeatSheet(text) {
  if (!text || !text.trim()) return [];
  const events = []; let ev = null, heat = null, lastRelay = null;
  const skip = /^(valley cabana|2026 vcsl|meet program|.*hy-tek|lane (team|name)|.*- page \d)/i;
  for (let raw of text.split(/\r?\n/)) {
    let line = raw.replace(/\s+/g, " ").trim(); if (!line) continue;
    if (skip.test(line)) continue;
    const m = line.match(/^#(\d+)\s+(.+)$/);
    if (m && /(free|back|breast|fly|medley|relay|\bim\b)/i.test(line)) { ev = { id: "ev" + events.length, num: m[1], name: m[2].trim(), heats: [] }; events.push(ev); heat = null; lastRelay = null; continue; }
    const r = line.match(/vcsl record[:\s]+.*?(\d{1,2}:\d{2}\.\d{2}|\d{1,3}\.\d{2})/i);
    if (r && ev) { ev.record = r[1]; continue; }
    const h = line.match(/^heat\s+(\d+)/i);
    if (h) { if (!ev) { ev = { id: "ev0", num: "", name: "Event", heats: [] }; events.push(ev); } heat = { num: +h[1], lanes: [] }; ev.heats.push(heat); lastRelay = null; continue; }
    if (!ev || !heat) continue;
    if (isRelayEvent(ev.name)) {
      const e = line.match(/^(\d{1,2})\s+([A-Z]{2,6})\s+([AB])\s+(NT|X?\d[\d:.]*)/);
      if (e) { const tc = normTeam(e[2]); lastRelay = { lane: +e[1], team: tc, relay: e[3], name: `${tc} ${e[3]}`, age: 0, seed: e[4].replace(/^X/, ""), swimmers: [] }; heat.lanes.push(lastRelay); continue; }
      if (/[A-Za-z],/.test(line) && lastRelay) {
        [...line.matchAll(/([A-Za-zÀ-ÿ'’.\-]+,\s*[A-Za-zÀ-ÿ'’.\- ]+?)\s+([WM]?)(\d{1,2})(?=\s|$)/g)]
          .forEach((mm) => { if (lastRelay.swimmers.length < 4) lastRelay.swimmers.push({ name: mm[1].trim(), age: +mm[3] }); });
      }
      continue;
    }
    const s = line.replace(/(\d)([A-Za-z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2");
    const e = s.match(/^(\d{1,2})\s+(.+?,\s*.+?)\s+(\d{1,2})\s+([A-Z]{2,6})\s+(NT|X?\d[\d:.]*)\s*$/);
    if (e) heat.lanes.push({ lane: +e[1], name: e[2].replace(/\s+/g, " ").trim(), age: +e[3], team: normTeam(e[4]), seed: e[5].replace(/^X/, "") });
  }
  return events.filter((e) => e.heats.some((h) => h.lanes.length));
}

// ---- small sample meet (upload the real VCSL PDF via Import) --------------
const L = (lane, name, team, age, seed, relay, swimmers) => ({ lane, name, team, age, seed, ...(relay ? { relay } : {}), ...(swimmers ? { swimmers } : {}) });
const SEED_EVENTS = [
  { id: "e0", num: "19", name: "Girls 9-10 25 Yard Butterfly", record: "13.90", heats: [
    { num: 1, lanes: [L(3,"Arreola, Casielle","LPAC",10,"31.69"),L(4,"Minister, Addison S","MTVD",9,"28.75"),L(5,"Oswald, Arianna","AGCC",9,"28.58"),L(6,"Desimone, Giavanna","LPAC",9,"28.58"),L(7,"Reyna, Rae R","BDST",9,"31.06"),L(8,"Barnett, Olivia M","SCVCC",9,"32.92")] },
    { num: 2, lanes: [L(2,"Abrams, Elise","OAK",10,"27.22"),L(3,"Fleming, Heidi","LPAC",9,"25.60"),L(4,"Reichmuth, Gigi L","AGCC",9,"24.50"),L(5,"Syzygy, Kaya","LPAC",10,"24.29"),L(6,"Opp, Audrey","OAK",9,"24.35"),L(7,"Morris, Emerson R","AGCC",9,"24.67")] },
  ]},
  { id: "e1", num: "23", name: "Girls 6 & Under 25 Yard Butterfly", record: "19.04", heats: [
    { num: 1, lanes: [L(3,"McClelland, Paisley","AGCC",4,"1:03.75"),L(4,"Lai, Harper","LPAC",5,"57.50"),L(5,"Donner, Alayna T","SCVCC",6,"52.31"),L(6,"Dally, Brooke","AGCC",6,"53.35"),L(7,"Errecart, Cameron J","BDST",5,"39.52")] },
  ]},
  { id: "e2", num: "21", name: "Girls 7-8 25 Yard Butterfly", record: "16.01", heats: [
    { num: 1, lanes: [L(3,"Marandian, Celine","BDST",8,"33.72"),L(4,"Hadley, Lauren S","MTVD",7,"30.22"),L(5,"Rose, Emma L","MTVD",8,"30.11"),L(6,"Alfaro, Juliette","LPAC",7,"30.11"),L(7,"Preston, Brynlee","AGCC",8,"30.87")] },
  ]},
  { id: "e3", num: "63", name: "Girls 11-12 50 Yard Freestyle", record: "26.14", heats: [
    { num: 7, lanes: [L(1,"Stanley, Caitlyn","AGCC",11,"34.86"),L(2,"Takeuchi, Tessa N","BDST",11,"34.68"),L(3,"Toda, Marion A","BDST",12,"34.61"),L(4,"Keller, Mary","OAK",12,"34.22"),L(5,"Wong, Madelyn","BDST",11,"32.96"),L(6,"Ertell, Ava E","BDST",12,"33.57")] },
    { num: 8, lanes: [L(1,"Casey, Quinn S","OAK",12,"32.85"),L(2,"Mast, Emma","OAK",11,"31.31"),L(3,"Cendejas, Eva","LPAC",12,"30.79"),L(4,"Gray, Kensie","LPAC",11,"30.61"),L(5,"Caleca, Gigi J","AGCC",11,"30.22"),L(6,"Xie, Lexie","LPAC",11,"30.59")] },
  ]},
  { id: "e4", num: "75", name: "Girls 11-12 200 Yard Freestyle Relay", record: "1:54.89", heats: [
    { num: 1, lanes: [
      L(3,"SCVCC A","SCVCC",0,"2:35.46","A",[{name:"Kalchuri, Aarika",age:11},{name:"McGugan, Aylie S",age:11},{name:"Bhatia, Alea",age:12},{name:"Alcantara, Ava C",age:12}]),
      L(4,"LPAC A","LPAC",0,"2:21.70","A",[{name:"Pham, Taylor",age:11},{name:"Gronholm, Amelia",age:11},{name:"Lopez, Hazel",age:12},{name:"Sunderman, Aurora",age:12}]),
      L(5,"BDST A","BDST",0,"2:05.72","A",[{name:"Wong, Madelyn",age:11},{name:"Grose, Emme D",age:11},{name:"Bek, Geva",age:11},{name:"Wang, Eleanor S",age:12}]),
      L(6,"OAK A","OAK",0,"2:08.50","A",[{name:"Mast, Emma",age:11},{name:"Casey, Quinn S",age:12},{name:"Westgate, Kaitlyn",age:12},{name:"Kluëck, Cat",age:12}]),
      L(7,"AGCC A","AGCC",0,"2:23.86","A",[{name:"Hoppock, Hana",age:11},{name:"Fingerman, Cara M",age:12},{name:"Saah, Sophia C",age:12},{name:"Fergus, Addison",age:12}]),
      L(8,"MTVD A","MTVD",0,"2:40.84","A",[{name:"Holeman, Zoey E",age:12},{name:"Blanchard, Shelby S",age:11},{name:"Singh, Kaashvi N",age:12},{name:"Seiden, Savannah N",age:12}]),
    ] },
  ]},
];
const INITIAL_RECORDS = Object.fromEntries(SEED_EVENTS.filter((e) => e.record).map((e) => [e.id, e.record]));
// Event #19 fully scored so the results board shows on load.
const INITIAL_DATA = {
  "0:0:3": { time: "30.92", dqs: [], tags: {}, notes: "" },
  "0:0:4": { time: "28.20", dqs: [], tags: {}, notes: "" },
  "0:0:5": { time: "28.71", dqs: [], tags: {}, notes: "" },
  "0:0:6": { time: "27.95", dqs: [], tags: {}, notes: "" },
  "0:0:7": { time: "29.88", dqs: [], tags: { "Turns: Open turn": true }, notes: "" },
  "0:0:8": { time: "33.10", dqs: [], tags: {}, notes: "" },
  "0:1:2": { time: "27.40", dqs: [], tags: {}, notes: "" },
  "0:1:3": { time: "25.11", dqs: [], tags: {}, notes: "" },
  "0:1:4": { time: "24.62", dqs: [], tags: {}, notes: "" },
  "0:1:5": { time: "23.90", dqs: [], tags: {}, notes: "" },
  "0:1:6": { time: "24.99", dqs: [{ code: "1C", reason: "Scissors kick", group: "Butterfly" }], tags: {}, notes: "" },
  "0:1:7": { time: "24.30", dqs: [], tags: {}, notes: "" },
};

function MeetDeckBoard({ session, isAdmin, onLogout, accounts, onSaveAccounts }) {
  const [meetName, setMeetName] = useState("2026 VCSL Championship");
  const [meetDate, setMeetDate] = useState(new Date().toISOString().slice(0, 10));
  const [events, setEvents] = useState(SEED_EVENTS);
  const [records, setRecords] = useState(INITIAL_RECORDS);
  const [data, setData] = useState(INITIAL_DATA);
  const [heatPtr, setHeatPtr] = useState(4);
  const [homeTeam, setHomeTeam] = useState("BDST");
  const [hostTeam, setHostTeam] = useState("BDST");
  const [awayTeam, setAwayTeam] = useState("OAK");
  const [mode, setMode] = useState("champs");
  const [dualLanes, setDualLanes] = useState(6);
  const [dqTarget, setDqTarget] = useState(null);
  const [dqSwimmer, setDqSwimmer] = useState(null);
  const [dqNsTarget, setDqNsTarget] = useState(null); // leg-specific id for the No-show toggle inside DQModal
  const [dqAnchorRect, setDqAnchorRect] = useState(null); // where DQModal's caret points
  const [scratchTarget, setScratchTarget] = useState(null);
  const [relayReplaceTarget, setRelayReplaceTarget] = useState(null);
  const [modal, setModal] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pop, setPop] = useState(null);
  const [ageStack, setAgeStack] = useState([]); // age-chip drill-down, stacked on top of `pop`
  const [odOpen, setOdOpen] = useState(true);
  const [prevOpen, setPrevOpen] = useState(true);
  // Relay splits popup scope: null (closed), or { evIdx, htIdx, lane }, where
  // lane null means every home-team relay lane in that heat (the blue-dot /
  // auto-open-on-start behavior) and a lane number scopes it to just the one
  // relay entry tapped (which may be on-deck or previous, not just current).
  const [relaySplitsScope, setRelaySplitsScope] = useState(null);
  // Swimmer comparison mode — lifted up here (not local to the modal) so it's
  // remembered the next time the modal is opened, not reset to the default
  // every time. Starts on Simple, the quicker 2-swimmer picker.
  const [cmpMode, setCmpMode] = useState("simple");
  // Which team the Meet stats modal is focused on — null means "my team"
  // (homeTeam); tapping a team's score in the top strip focuses that team
  // instead, same as tapping a swimmer name opens their own profile.
  const [statsTeam, setStatsTeam] = useState(null);
  // Set when a swimmer's name is tapped from a profile popover elsewhere
  // (meet sheet, comparison, age-group list) so League opens straight to
  // their profile instead of the team roster.
  const [leagueProfileTarget, setLeagueProfileTarget] = useState(null);
  const openLeagueProfile = (name, team) => { setLeagueProfileTarget({ name, team }); setModal("league"); setMenuOpen(false); setPop(null); setAgeStack([]); };
  const [startedHeats, setStartedHeats] = useState({});
  const [showFinalizeDqs, setShowFinalizeDqs] = useState(false);
  const autoFinalizeShown = useRef(false);
  const lanesPerHeat = dualLanes;
  const sheetRef = useRef(null);
  const evRefs = useRef({});

  const flatHeats = useMemo(() => { const out = []; events.forEach((ev, evIdx) => ev.heats.forEach((ht, htIdx) => out.push({ evIdx, htIdx, evId: ev.id, eventName: ev.name, num: ht.num, lanes: ht.lanes }))); return out; }, [events]);
  const ptr = Math.min(heatPtr, Math.max(0, flatHeats.length - 1));
  const current = flatHeats[ptr];
  const previous = ptr > 0 ? flatHeats[ptr - 1] : null;
  const onDeck = ptr < flatHeats.length - 1 ? flatHeats[ptr + 1] : null;

  const teamsPresent = useMemo(() => { const s = new Set(); events.forEach((ev) => ev.heats.forEach((h) => h.lanes.forEach((l) => s.add(l.team)))); return [...s]; }, [events]);
  const filter = mode === "dual" ? [hostTeam, awayTeam] : null;
  const places = useMemo(() => computePlaces(events, data, filter, mode), [events, data, mode, hostTeam, homeTeam, awayTeam]);
  const finishedEvents = useMemo(() => events.map((ev, i) => eventFinished(ev, i, data, filter)), [events, data, mode, hostTeam, homeTeam, awayTeam]);
  const curHeatPlaces = useMemo(() => current ? computeHeatPlaces(events[current.evIdx], current.evIdx, current.htIdx, data, filter) : {}, [events, data, current, mode, hostTeam, homeTeam, awayTeam]);
  const prevHeatPlaces = useMemo(() => previous ? computeHeatPlaces(events[previous.evIdx], previous.evIdx, previous.htIdx, data, filter) : {}, [events, data, previous, mode, hostTeam, homeTeam, awayTeam]);
  const scores = useMemo(() => computeScores(events, data, mode, filter), [events, data, mode, hostTeam, homeTeam, awayTeam]);

  // Results ticker shows the PREVIOUS event's results (never the current one).
  const resultsEvent = useMemo(() => {
    const start = current ? current.evIdx - 1 : events.length - 1;
    for (let i = start; i >= 0; i--) if (eventFinished(events[i], i, data, filter)) return { ev: events[i], evIdx: i, live: false };
    for (let i = start; i >= 0; i--) if (rankedEvent(events[i], i, data, filter).length) return { ev: events[i], evIdx: i, live: true };
    return null;
  }, [events, data, current, mode, hostTeam, homeTeam, awayTeam]);
  const resultsList = useMemo(() => resultsEvent ? rankedEvent(resultsEvent.ev, resultsEvent.evIdx, data, filter).slice(0, mode === "champs" ? 10 : 6) : [], [resultsEvent, data, mode, hostTeam, homeTeam, awayTeam]);

  const get = useCallback((id) => data[id] || { time: "", dqs: [], tags: {}, notes: "" }, [data]);
  const update = (id, patch) => setData((d) => ({ ...d, [id]: { ...(d[id] || { time: "", dqs: [], tags: {}, notes: "" }), ...patch } }));
  const curKey = current ? current.evIdx + ":" + current.htIdx : null;
  const curHasTimes = current ? current.lanes.some((l) => (data[entryId(current.evIdx, current.htIdx, l.lane)] || {}).time) : false;
  const isStarted = !!(curKey && (startedHeats[curKey] || curHasTimes));
  // Live stopwatch for the heat on the board — deliberately transient (not
  // persisted): it only drives tap-to-lap while this heat is up, and resets
  // whenever Start is pressed again or the board moves to a different heat.
  const [raceClock, setRaceClock] = useState(null); // { key, startedAt }
  const startRace = () => { if (!curKey) return; setStartedHeats((s) => ({ ...s, [curKey]: true })); setRaceClock({ key: curKey, startedAt: Date.now() }); if (current && isRelayEvent(current.eventName)) setRelaySplitsScope({ evIdx: current.evIdx, htIdx: current.htIdx, lane: null }); };
  const clockActive = raceClock && raceClock.key === curKey ? raceClock : null;
  useEffect(() => { setRaceClock((c) => (c && c.key === curKey ? c : null)); }, [curKey]);
  // The heat the splits popup is currently scoped to — may not be `current`
  // (a coach can tap a relay while it's still on-deck to preview it early).
  const relaySplitsHeat = useMemo(() => relaySplitsScope ? flatHeats.find((f) => f.evIdx === relaySplitsScope.evIdx && f.htIdx === relaySplitsScope.htIdx) : null, [relaySplitsScope, flatHeats]);
  // Auto-close it once every home-team relay entry it's scoped to has a
  // finish time recorded — no manual close needed. Keyed only on `data` (via
  // a ref for the rest) so reopening an already-finished heat's panel (blue
  // dot, tapping the relay again) doesn't get instantly closed right back —
  // this should only fire on an actual transition to "done", not every time
  // the scope changes while the heat happens to already be complete.
  const relaySplitsCloseCheck = useRef();
  relaySplitsCloseCheck.current = () => {
    if (!relaySplitsScope || !relaySplitsHeat || !isRelayEvent(relaySplitsHeat.eventName)) return;
    const homeLanes = relaySplitsHeat.lanes.filter((l) => l.swimmers && l.team === homeTeam && (relaySplitsScope.lane == null || l.lane === relaySplitsScope.lane));
    if (!homeLanes.length) return;
    const allDone = homeLanes.every((l) => !!(data[entryId(relaySplitsScope.evIdx, relaySplitsScope.htIdx, l.lane)] || {}).time);
    if (allDone) setRelaySplitsScope(null);
  };
  useEffect(() => { relaySplitsCloseCheck.current(); }, [data]);
  const recordLap = (id, eventName) => {
    if (!clockActive) return;
    const d = get(id); if (d.time) return;
    const req = requiredTapsFor(eventName);
    const splits = [...(d.splits || [])];
    const elapsedSec = (Date.now() - clockActive.startedAt) / 1000;
    const prevCum = splits.reduce((s, x) => s + (toSeconds(x) || 0), 0);
    const legSec = Math.max(0, elapsedSec - prevCum);
    splits.push(fmtT(legSec));
    if (splits.length >= req) update(id, { splits, time: fmtT(elapsedSec) });
    else update(id, { splits });
  };
  // Heat is done when every entered lane has a time or DQ (and at least one time).
  const curHeatComplete = useMemo(() => { if (!current) return false; let entered = 0, done = 0, timed = 0; current.lanes.forEach((l) => { const d = data[entryId(current.evIdx, current.htIdx, l.lane)] || {}; entered++; if (d.time || (d.dqs || []).length) done++; if (d.time) timed++; }); return entered > 0 && timed > 0 && done === entered; }, [current, data]);
  const autoEnded = useRef({});
  const seenIncomplete = useRef({});
  useEffect(() => { if (!curKey) return;
    if (!curHeatComplete) { seenIncomplete.current[curKey] = true; return; }
    if (seenIncomplete.current[curKey] && !autoEnded.current[curKey]) { autoEnded.current[curKey] = true; setHeatPtr((p) => Math.min(flatHeats.length - 1, p + 1)); }
  }, [curKey, curHeatComplete, flatHeats.length]);
  const pendingDqs = useMemo(() => pendingDqList(events, data), [events, data]);
  const meetOver = flatHeats.length > 0 && ptr === flatHeats.length - 1 && curHeatComplete;
  useEffect(() => { if (meetOver && pendingDqs.length && !autoFinalizeShown.current) { autoFinalizeShown.current = true; setShowFinalizeDqs(true); } }, [meetOver, pendingDqs.length]);
  const prevList = useMemo(() => previous ? [...previous.lanes].map((l) => { const id = entryId(previous.evIdx, previous.htIdx, l.lane); return { id, l, time: (data[id] || {}).time, place: prevHeatPlaces[id] }; }).sort((a, b) => (a.place || 99) - (b.place || 99) || a.l.lane - b.l.lane) : [], [previous, data, prevHeatPlaces]);
  const [toast, setToast] = useState("");
  const [relayUndo, setRelayUndo] = useState(null); // { label, fn }
  const relayUndoTimer = useRef(null);
  const pushRelayUndo = (label, fn) => { setRelayUndo({ label, fn }); if (relayUndoTimer.current) clearTimeout(relayUndoTimer.current); relayUndoTimer.current = setTimeout(() => setRelayUndo(null), 8000); };
  // Unlike relayUndo above (a single toast that expires after 8s), this is a
  // durable log of "restore" closures keyed by relay leg id, so the Scratches
  // page can revert a swap — and the scratch + any donor-relay side effect it
  // caused — whenever the coach comes back to it, not just right after it happened.
  const [relaySwapHistory, setRelaySwapHistory] = useState({});
  const revertRelaySwap = (legId) => { relaySwapHistory[legId]?.(); };
  const [seasonMeets, setSeasonMeets] = useState([]);
  const progMeets = useMemo(() => [{ date: "This meet", meetName, events, data }, ...seasonMeets], [meetName, events, data, seasonMeets]);
  // Includes the live in-progress meet (unlike seasonMeets alone) so League
  // stats, Team stats, and swimmer profiles reflect DQs/splits/notes/times
  // the instant they're entered, without waiting on "Save to season." Skips
  // the live meet once it's actually been saved (same dedup key saveToSeason
  // itself uses), so a saved meet is never double-counted. Saved snapshots
  // always carry an "id" — the live entry never does — so consumers can tell
  // them apart (e.g. for a "saved meets" count in a subtitle).
  const liveMeetDateKey = meetDate || new Date().toISOString().slice(0, 10);
  const liveAlreadySaved = seasonMeets.some((m) => m.meetName === meetName && m.date === liveMeetDateKey);
  const rankMeets = useMemo(() => {
    const live = { meetName, mode, date: liveMeetDateKey, events, data, homeTeam, hostTeam, awayTeam, dualLanes };
    return liveAlreadySaved ? seasonMeets : [live, ...seasonMeets];
  }, [liveAlreadySaved, meetName, mode, liveMeetDateKey, events, data, homeTeam, hostTeam, awayTeam, dualLanes, seasonMeets]);
  const relayCandidates = useMemo(() => relayReplaceTarget ? relayReplacementCandidates(events, data, relayReplaceTarget.evIdx, relayReplaceTarget.htIdx, relayReplaceTarget.lane, relayReplaceTarget.leg, relayReplaceTarget.team) : [], [relayReplaceTarget, events, data]);
  // Time & place +/- for each candidate: this relay's own delta from
  // swapping in their time, plus (for a "move" candidate) the donor relay's
  // delta from losing them and backfilling with the next-best teammate.
  const relayCandidatesWithDelta = useMemo(() => {
    if (!relayReplaceTarget) return [];
    const { evIdx, team, name } = relayReplaceTarget;
    const ev = events[evIdx];
    const stroke = ev && /medley/i.test(ev.name) ? (MEDLEY_LEGS[relayReplaceTarget.leg] || "Free") : "Free";
    const scratchedTime = bestStrokeSeed(events, data, name, team, stroke);
    return relayCandidates.map((c) => ({
      ...c,
      thisDelta: (scratchedTime != null && c.best != null) ? relayPlaceProjection(events, team, evIdx, c.best - scratchedTime) : null,
      donorDelta: c.moveFrom ? relayDonorImpact(events, data, c.name, team, c.moveFrom) : null,
    }));
  }, [relayReplaceTarget, relayCandidates, events, data]);
  const medleyPlan = useMemo(() => relayReplaceTarget ? medleyReplacementPlan(events, data, relayReplaceTarget.evIdx, relayReplaceTarget.htIdx, relayReplaceTarget.lane, relayReplaceTarget.name) : null, [relayReplaceTarget, events, data]);
  const relayOriginalLegs = useMemo(() => { if (!relayReplaceTarget) return []; const ev = events[relayReplaceTarget.evIdx]; const ht = ev && ev.heats[relayReplaceTarget.htIdx]; const l = ht && ht.lanes.find((x) => x.lane === relayReplaceTarget.lane); return l && l.swimmers ? l.swimmers.map((s) => s.name) : []; }, [relayReplaceTarget, events]);
  // Whole-relay projected time/place delta for the "Apply this lineup" plan —
  // same math as a single-candidate swap, just against the plan's new total.
  const medleyPlanDelta = useMemo(() => {
    if (!medleyPlan || !relayReplaceTarget) return null;
    const ev = events[relayReplaceTarget.evIdx]; const ht = ev && ev.heats[relayReplaceTarget.htIdx];
    const relayLane = ht && ht.lanes.find((l) => l.lane === relayReplaceTarget.lane);
    if (!relayLane) return null;
    const origTotal = toSeconds(relayLane.seed);
    if (isNaN(origTotal)) return null;
    return relayPlaceProjection(events, relayReplaceTarget.team, relayReplaceTarget.evIdx, medleyPlan.total - origTotal);
  }, [medleyPlan, relayReplaceTarget, events]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 2200); };
  // Restore last session, then autosave.
  useEffect(() => { if (!STORE) return; let live = true; (async () => { try { const r = await STORE.get(CUR_KEY); if (live && r && r.value) { const s = JSON.parse(r.value); if (s.events) { setEvents(s.events); setRecords(s.records || {}); setData(s.data || {}); if (s.meetName) setMeetName(s.meetName); if (s.meetDate) setMeetDate(s.meetDate); if (s.mode) setMode(s.mode); if (s.homeTeam) setHomeTeam(s.homeTeam); if (s.hostTeam) setHostTeam(s.hostTeam); if (s.awayTeam) setAwayTeam(s.awayTeam); if (s.dualLanes) setDualLanes(s.dualLanes); } } } catch (e) {}
    try { const r = await STORE.get(INDEX_KEY); if (live && r && r.value) { const arr = []; for (const it of JSON.parse(r.value)) { try { const mr = await STORE.get(it.id); if (mr && mr.value) arr.push(JSON.parse(mr.value)); } catch (e) {} } setSeasonMeets(arr); } } catch (e) {} })(); return () => { live = false; }; }, []);
  // Autosave the current draft (for session restore) once the whole current
  // EVENT finishes — not after every heat/keystroke — so saves land at
  // natural pause points. A slow idle fallback still covers the case where a
  // coach steps away mid-event without ever completing it.
  const evComplete = useMemo(() => { if (!current) return false; const heats = (events[current.evIdx] || {}).heats || [];
    return heats.length > 0 && heats.every((ht, hi) => { let entered = 0, done = 0, timed = 0; ht.lanes.forEach((l) => { const d = data[entryId(current.evIdx, hi, l.lane)] || {}; entered++; if (d.time || (d.dqs || []).length) done++; if (d.time) timed++; }); return entered > 0 && timed > 0 && done === entered; });
  }, [current, events, data]);
  const savedEvtRef = useRef(-1);
  useEffect(() => { if (!STORE || !evComplete || !current || savedEvtRef.current === current.evIdx) return; savedEvtRef.current = current.evIdx;
    STORE.set(CUR_KEY, JSON.stringify({ events, records, data, meetName, meetDate, mode, homeTeam, hostTeam, awayTeam, dualLanes })).catch(() => {});
  }, [evComplete, current, events, records, data, meetName, meetDate, mode, homeTeam, awayTeam, dualLanes]);
  useEffect(() => { if (!STORE) return; const t = setTimeout(() => { STORE.set(CUR_KEY, JSON.stringify({ events, records, data, meetName, meetDate, mode, homeTeam, hostTeam, awayTeam, dualLanes })).catch(() => {}); }, 8000); return () => clearTimeout(t); }, [events, records, data, meetName, meetDate, mode, homeTeam, awayTeam, dualLanes]);
  // Uses the meet-date field (settable in Meet setup) instead of "today" so
  // importing results from a past meet saves under its actual date.
  const saveToSeason = async () => { const date = meetDate || new Date().toISOString().slice(0, 10); const id = "meetdeck:meet:" + Date.now(); const snap = { id, meetName, mode, date, events, data, records, homeTeam, hostTeam, awayTeam, dualLanes };
    setSeasonMeets((a) => [...a.filter((m) => !(m.meetName === meetName && m.date === date)), snap]);
    if (!STORE) { flash("Saved to season (this session)"); return; }
    try { await STORE.set(id, JSON.stringify(snap));
      let idx = []; try { const r = await STORE.get(INDEX_KEY); if (r && r.value) idx = JSON.parse(r.value); } catch (e) {}
      idx = idx.filter((x) => x.meetName !== meetName || x.date !== date); idx.push({ id, meetName, mode, date });
      await STORE.set(INDEX_KEY, JSON.stringify(idx)); flash("Saved to season ✓"); } catch (e) { flash("Saved (storage limit — kept for this session)"); } };
  const loadMeet = (snap) => { setEvents(snap.events || []); setData(snap.data || {}); setRecords(snap.records || {}); if (snap.meetName) setMeetName(snap.meetName); if (snap.date) setMeetDate(snap.date); if (snap.mode) setMode(snap.mode); if (snap.homeTeam) setHomeTeam(snap.homeTeam); if (snap.hostTeam) setHostTeam(snap.hostTeam); if (snap.awayTeam) setAwayTeam(snap.awayTeam); if (snap.dualLanes) setDualLanes(snap.dualLanes); setStartedHeats({}); setHeatPtr(0); setModal(null); flash("Loaded " + (snap.meetName || "meet")); };
  const deleteMeet = async (id) => { if (STORE) { try { await STORE.delete(id); } catch (e) {} try { const r = await STORE.get(INDEX_KEY); if (r && r.value) await STORE.set(INDEX_KEY, JSON.stringify(JSON.parse(r.value).filter((x) => x.id !== id))); } catch (e) {} } setSeasonMeets((a) => a.filter((m) => m.id !== id)); flash("Meet removed"); };
  const clearData = async () => { if (typeof window !== "undefined" && window.confirm && !window.confirm("Clear all saved meets and reset the board? This can't be undone.")) return;
    if (STORE) { try { const r = await STORE.get(INDEX_KEY); if (r && r.value) for (const it of JSON.parse(r.value)) { try { await STORE.delete(it.id); } catch (e) {} } } catch (e) {}
      try { await STORE.delete(INDEX_KEY); } catch (e) {} try { await STORE.delete(CUR_KEY); } catch (e) {} }
    setSeasonMeets([]); setEvents(SEED_EVENTS); setRecords(INITIAL_RECORDS); setData(INITIAL_DATA); setMeetDate(new Date().toISOString().slice(0, 10)); setStartedHeats({}); setHeatPtr(4); setModal(null); flash("Data cleared"); };
  const toggleTag = (id, key) => { const tags = { ...get(id).tags }; tags[key] ? delete tags[key] : (tags[key] = true); update(id, { tags }); };
  const toggleDqCode = (id, group, code, reason, swimmer) => { let dqs = [...(get(id).dqs || [])]; const i = dqs.findIndex((q) => q.code === code); if (i >= 0) dqs.splice(i, 1); else { dqs = dqs.filter((q) => q.code !== PEND_DQ_CODE); dqs.push({ code, reason, group, ...(swimmer ? { swimmer } : {}) }); } update(id, { dqs }); };
  // Quick tap: flag a DQ instantly with the reason left pending (toggles off
  // if the only thing recorded is still the placeholder — a real reason can
  // only be cleared via the full picker, so an accidental tap can't wipe it).
  const toggleQuickDq = (id, swimmer) => { const d = get(id), dqs = d.dqs || [];
    if (dqs.length === 0) update(id, { dqs: [{ code: PEND_DQ_CODE, reason: "Reason pending — awaiting DQ slip", group: "Pending", ...(swimmer ? { swimmer } : {}) }] });
    else if (isPendingDq(d) && dqs.length === 1) update(id, { dqs: [] }); };
  const scratchOne = (id) => update(id, { scratched: true });
  const unscratchOne = (id) => update(id, { scratched: false });
  // Scratches a swimmer everywhere they appear this meet — solo entries AND
  // every relay leg they're named on (addressed as entryId + "#" + leg).
  const scratchAll = (name, team, val = true) => setData((d) => { const nd = { ...d };
    events.forEach((ev, ei) => ev.heats.forEach((ht, hi) => ht.lanes.forEach((l) => {
      if (l.swimmers) { l.swimmers.forEach((s, leg) => { if (s.name === name && l.team === team) { const id = entryId(ei, hi, l.lane) + "#" + leg; nd[id] = { ...(nd[id] || { time: "", dqs: [], tags: {}, notes: "" }), scratched: val }; } }); return; }
      if (l.name === name && l.team === team) { const id = entryId(ei, hi, l.lane); nd[id] = { ...(nd[id] || { time: "", dqs: [], tags: {}, notes: "" }), scratched: val }; }
    })));
    return nd; });
  // Swap a new swimmer into a scratched relay leg — edits the roster (events),
  // not just the results (data), then clears any stale scratched/tag state on
  // that leg's id since it now belongs to a different swimmer. If the pick was
  // already swimming a different relay ("move" candidate), vacate that old
  // slot and chain straight into a replacement popup for it.
  const swapRelaySwimmer = (evIdx, htIdx, lane, leg, candidate) => {
    const outgoing = events[evIdx]?.heats[htIdx]?.lanes.find((l) => l.lane === lane)?.swimmers[leg];
    const legId = entryId(evIdx, htIdx, lane) + "#" + leg;
    const prevLegData = data[legId];
    const donorLegId = candidate.moveFrom ? entryId(candidate.moveFrom.evIdx, candidate.moveFrom.htIdx, candidate.moveFrom.lane) + "#" + candidate.moveFrom.leg : null;
    setEvents((evs) => evs.map((ev, ei) => ei !== evIdx ? ev : { ...ev, heats: ev.heats.map((ht, hi) => hi !== htIdx ? ht : { ...ht, lanes: ht.lanes.map((l) => l.lane !== lane ? l : { ...l, swimmers: l.swimmers.map((s, i) => i !== leg ? s : { name: candidate.name, age: candidate.age || 0 }) }) }) }));
    update(legId, { scratched: false, tags: {}, notes: "", subFor: outgoing ? { name: outgoing.name, age: outgoing.age || 0 } : null });
    flash(candidate.name + " swapped in for " + (relayReplaceTarget ? relayReplaceTarget.name : "scratched swimmer"));
    // Undoes the whole swap — this leg's swimmer AND (when the pick was moved
    // in from another relay) that relay's forced scratch — not just this leg
    // in isolation, so a revert always leaves both lineups consistent.
    const restoreFn = () => {
      setEvents((evs) => evs.map((ev, ei) => ei !== evIdx ? ev : { ...ev, heats: ev.heats.map((ht, hi) => hi !== htIdx ? ht : { ...ht, lanes: ht.lanes.map((l) => l.lane !== lane ? l : { ...l, swimmers: l.swimmers.map((s, i) => i !== leg ? s : (outgoing || s)) }) }) }));
      update(legId, prevLegData || { time: "", dqs: [], tags: {}, notes: "" });
      if (donorLegId) update(donorLegId, { scratched: false });
      setRelaySwapHistory((h) => { const rest = { ...h }; delete rest[legId]; if (donorLegId) delete rest[donorLegId]; return rest; });
      flash("Undone");
    };
    pushRelayUndo(candidate.name + " swapped in for " + (outgoing ? outgoing.name : "scratched swimmer"), restoreFn);
    // Registered under both legs so the Scratches page can offer the same
    // full revert whether the coach is looking at the relay that gained a
    // swimmer or the donor relay that lost one.
    setRelaySwapHistory((h) => ({ ...h, [legId]: restoreFn, ...(donorLegId ? { [donorLegId]: restoreFn } : {}) }));
    // Moving someone in from another relay only touches these two lineups —
    // this one (gaining them) and their old one (now short a leg). Their old
    // slot is left flagged scratched for the coach to fill on their own time
    // rather than auto-chaining into a second replacement popup, which could
    // itself pull from a third relay and cascade the lineup changes further
    // than intended.
    if (candidate.moveFrom) {
      const slot = candidate.moveFrom;
      update(donorLegId, { scratched: true });
      flash(candidate.name + " moved in — their " + shortEvent(slot.eventName) + " spot is now open");
    }
    setRelayReplaceTarget(null);
  };
  // Apply a full re-optimized medley lineup (possibly reassigning multiple
  // legs at once). If it pulls in someone already on a different relay,
  // vacate that slot and chain into its replacement popup too.
  const applyRelayPlan = (evIdx, htIdx, lane, plan) => {
    const ev = events[evIdx], ht = ev.heats[htIdx], relayLane = ht.lanes.find((l) => l.lane === lane);
    const team = relayLane.team, prevSwimmers = relayLane.swimmers, before = prevSwimmers.map((s) => s.name);
    const prevLegDatas = prevSwimmers.map((s, i) => data[entryId(evIdx, htIdx, lane) + "#" + i]);
    const otherSlots = relaySlotsByTeam(events, team);
    const legIds = plan.legs.map((leg, i) => entryId(evIdx, htIdx, lane) + "#" + i);
    // Same one-relay-change rule as swapRelaySwimmer above: leave the donor
    // slot flagged scratched instead of auto-chaining into its own replacement
    // popup, so a single lineup edit can't cascade into a third relay.
    const conflictLeg = plan.legs.find((leg) => !before.includes(leg.name) && otherSlots.has(leg.name));
    const donorLegId = conflictLeg ? entryId(otherSlots.get(conflictLeg.name).evIdx, otherSlots.get(conflictLeg.name).htIdx, otherSlots.get(conflictLeg.name).lane) + "#" + otherSlots.get(conflictLeg.name).leg : null;
    setEvents((evs) => evs.map((e, ei) => ei !== evIdx ? e : { ...e, heats: e.heats.map((h, hi) => hi !== htIdx ? h : { ...h, lanes: h.lanes.map((l) => l.lane !== lane ? l : { ...l, swimmers: plan.legs.map((leg) => ({ name: leg.name, age: leg.age || 0 })) }) }) }));
    plan.legs.forEach((leg, i) => update(legIds[i], { scratched: false, tags: {}, notes: "", subFor: before[i] && before[i] !== leg.name ? { name: before[i], age: 0 } : null }));
    // Reverts every leg this plan touched, plus the donor relay's forced
    // scratch (if any) — registered under every leg id so any of this relay's
    // "replaced by" ghost rows on the Scratches page can trigger the same revert.
    const restoreFn = () => {
      setEvents((evs) => evs.map((e, ei) => ei !== evIdx ? e : { ...e, heats: e.heats.map((h, hi) => hi !== htIdx ? h : { ...h, lanes: h.lanes.map((l) => l.lane !== lane ? l : { ...l, swimmers: prevSwimmers }) }) }));
      prevLegDatas.forEach((pd, i) => update(legIds[i], pd || { time: "", dqs: [], tags: {}, notes: "" }));
      if (donorLegId) update(donorLegId, { scratched: false });
      setRelaySwapHistory((h) => { const rest = { ...h }; legIds.forEach((id) => delete rest[id]); if (donorLegId) delete rest[donorLegId]; return rest; });
      flash("Undone");
    };
    pushRelayUndo("Lineup updated for " + team, restoreFn);
    // Registered under every leg this plan touched, plus the donor relay's
    // leg (if a "move" pulled someone in) — so the Scratches page can offer
    // the same full revert from either relay's row.
    setRelaySwapHistory((h) => { const nh = { ...h }; legIds.forEach((id) => (nh[id] = restoreFn)); if (donorLegId) nh[donorLegId] = restoreFn; return nh; });
    if (conflictLeg) {
      update(donorLegId, { scratched: true });
      flash(conflictLeg.name + " moved in — their " + shortEvent(otherSlots.get(conflictLeg.name).eventName) + " spot is now open");
    } else {
      flash("Lineup updated");
    }
    setRelayReplaceTarget(null);
  };

  const swimmerAt = useCallback((id) => { if (!id) return null; const [base, legStr] = id.split("#"); const [ei, hi, ln] = base.split(":").map(Number); const ev = events[ei], ht = ev?.heats[hi], lane = ht?.lanes.find((l) => l.lane === ln); if (!lane) return null;
    if (legStr !== undefined && lane.swimmers) { const leg = +legStr, s = lane.swimmers[leg]; return s ? { ei, hi, ln, evId: ev.id, eventName: ev.name, heatNum: ht.num, relayBase: base, leg, sw: { name: s.name, age: s.age || 0, team: lane.team, seed: "" } } : null; }
    return { ei, hi, ln, evId: ev.id, eventName: ev.name, heatNum: ht.num, sw: lane }; }, [events]);
  const popInfo = useMemo(() => swimmerAt(pop?.id), [pop, swimmerAt]);
  const dqInfo = useMemo(() => swimmerAt(dqTarget), [dqTarget, swimmerAt]);
  // Tapping a home-team relay's own row (not a specific leg swimmer inside an
  // already-open splits panel, which still wants the usual notes popover)
  // opens the splits popup scoped to just that relay instead of the DQ/notes
  // ActionPopover — splits are what a coach actually wants from a relay tap.
  const openPop = (id, el) => {
    const info = swimmerAt(id);
    if (info && info.leg === undefined && info.sw && info.sw.swimmers && info.sw.team === homeTeam) { setRelaySplitsScope({ evIdx: info.ei, htIdx: info.hi, lane: info.ln }); return; }
    setPop({ id, rect: el.getBoundingClientRect() }); setAgeStack([]);
  };
  // Shared renderer for the swimmer action popover, used both for the base
  // popover (opened from any lane on the board) and for each "swimmer" level
  // pushed onto ageStack by the age-chip drill-down, so every level has full
  // DQ/scratch/notes functionality, not just the outermost one.
  const renderSwimmerPop = (id, rect, depth, onCloseThis, pushAge, pushProfile, key) => {
    const info = swimmerAt(id); if (!info) return null;
    const d = get(id);
    return (
      <ActionPopover key={key} info={info} d={d} mine={info.sw.team === homeTeam} imEvent={/(\bim\b|individual medley)/i.test(info.eventName)} hideSplits={info.leg !== undefined || !!info.sw.swimmers} relaySwimmer={info.leg !== undefined} relaySplit={info.leg !== undefined ? (get(info.relayBase).splits || [])[info.leg] : null} progMeets={progMeets} rect={rect} depth={depth} onClose={onCloseThis}
        onDq={() => { setDqTarget(info.relayBase || id); setDqSwimmer(info.leg !== undefined ? info.sw.name : null); setDqNsTarget(id); setDqAnchorRect(rect); setPop(null); setAgeStack([]); }}
        onDqQuick={() => toggleQuickDq(info.relayBase || id, info.leg !== undefined ? info.sw.name : null)}
        onToggle={(k) => toggleTag(id, k)} onSplits={(a) => update(id, { splits: a })} onNotes={(v) => update(id, { notes: v })} onNoShow={() => update(id, { noshow: !isNoShow(get(id)) })}
        onScratch={() => { setScratchTarget({ id, name: info.sw.name, team: info.sw.team, evIdx: info.ei, htIdx: info.hi, lane: info.ln, relay: info.leg !== undefined, leg: info.leg, eventName: info.eventName }); setPop(null); setAgeStack([]); }}
        onUnscratch={() => unscratchOne(id)}
        onOpenAgeGroup={(el) => { const ag = ageGroupOf(info.sw.age); if (!ag) return; pushAge(ag, el ? el.getBoundingClientRect() : rect); }}
        onOpenProfile={(el) => pushProfile(info.sw.name, info.sw.team, el ? el.getBoundingClientRect() : rect)} />
    );
  };
  // Return to Meet setup (not closing out entirely) so lanes-per-heat — which
  // depends on the just-imported roster — can be adjusted right away.
  const applyImport = (parsed) => { setEvents(parsed.events); setRecords(Object.fromEntries(parsed.events.filter((e) => e.record).map((e) => [e.id, e.record]))); if (parsed.myTeam) setHomeTeam(parsed.myTeam); setData({}); setPop(null); setHeatPtr(0); setRelaySwapHistory({}); setModal("meetsetup"); };
  const scrollToEvent = (evId) => { const el = evRefs.current[evId]; if (el && sheetRef.current) sheetRef.current.scrollTo({ top: el.offsetTop - 8, behavior: "smooth" }); };
  const jumpToCurrent = () => scrollToEvent(current?.evId);
  // Jump the whole board (heat pointer) to the first heat of an event by index,
  // and scroll the meet sheet to it — used by the event jump bar's arrows and
  // typed-number/name lookup.
  const goToEventIdx = (evIdx) => { if (evIdx < 0 || evIdx >= events.length) return; const fi = flatHeats.findIndex((f) => f.evIdx === evIdx); if (fi < 0) return; setHeatPtr(fi); scrollToEvent(events[evIdx].id); };
  const [jumpQuery, setJumpQuery] = useState("");
  const jumpToQuery = () => { const q = jumpQuery.trim(); if (!q) return;
    let idx = events.findIndex((e) => String(e.num) === q);
    if (idx < 0) idx = events.findIndex((e) => e.name.toLowerCase().includes(q.toLowerCase()));
    if (idx >= 0) goToEventIdx(idx); else flash("No matching event"); };

  const slots = (heat, n) => { const out = []; for (let i = 1; i <= n; i++) out.push(heat.lanes.find((l) => l.lane === i) || null); return out; };

  return (
    <div className="md-root">

      <header className="md-top">
        <div className="md-logowrap">
          <button className="md-logo" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu">≈</button>
          {menuOpen && (<>
            <div className="md-menuscrim" onClick={() => setMenuOpen(false)} />
            <div className="md-menu">
              <div className="md-menutitle">Analytics</div>
              <button className="md-mbtn" onClick={() => { setStatsTeam(null); setModal("stats"); setMenuOpen(false); }}>Meet stats</button>
              <button className="md-mbtn" onClick={() => { setModal("league"); setMenuOpen(false); }}>League stats</button>
              <button className="md-mbtn" onClick={() => { setModal("season"); setMenuOpen(false); }}>Team stats</button>
              <div className="md-menutitle">Meet day</div>
              <button className="md-mbtn" onClick={() => { setModal("participants"); setMenuOpen(false); }}>Scratches</button>
              <button className="md-mbtn" onClick={() => { setShowFinalizeDqs(true); setMenuOpen(false); }}>🚩 Finalize DQs{pendingDqs.length ? ` (${pendingDqs.length})` : ""}</button>
              <div className="md-menutitle">Meet day analytics</div>
              <button className="md-mbtn" onClick={() => { setModal("relay"); setMenuOpen(false); }}>Relay builder</button>
              <button className="md-mbtn" onClick={() => { setModal("compare"); setMenuOpen(false); }}>Swimmer comparison</button>
              <div className="md-mdiv" />
              <button className="md-mbtn" onClick={() => { setModal("settings"); setMenuOpen(false); }}>⚙ Settings</button>
            </div>
          </>)}
        </div>
        <ScoreStrip scores={scores} mode={mode} home={hostTeam} away={awayTeam} teams={teamsPresent} onTeamClick={(t) => { setStatsTeam(t); setModal("stats"); }} />
      </header>

      <div className="md-grid">
        {/* -------- LEFT: fixed stack -------- */}
        <section className="md-left">
          <div className="md-panel od">
            <div className="md-phead"><span className="md-eyebrow">On deck</span>
              <span className="md-pmeta">{onDeck ? `#${events[onDeck.evIdx].num} ${shortEvent(onDeck.eventName)} · H${onDeck.num}` : "—"}</span></div>
            <OnDeckStrip heat={onDeck} homeTeam={homeTeam} onPick={openPop} />
          </div>

          <div className={"md-panel water" + (isStarted ? " grow" : " prestart")}>
            <div className="md-phead">
              <span className="md-waterhead">
                {isRelayEvent(current?.eventName)
                  ? <button className="md-splitsdot" onClick={() => setRelaySplitsScope({ evIdx: current.evIdx, htIdx: current.htIdx, lane: null })} aria-label="Open relay splits for the whole team" title="Relay splits — whole team" />
                  : <span className="md-splitsdot static" />}
                <span className="md-waterstack">
                  <span className="md-eyebrow water-e">In the water{!isStarted && <em className="md-waiting"> · ready</em>}</span>
                  {clockActive && <RaceClockDisplay startedAt={clockActive.startedAt} stopped={curHeatComplete} />}
                </span>
              </span>
              {isStarted
                ? <button className="md-endrace" onClick={() => setHeatPtr((p) => Math.min(flatHeats.length - 1, p + 1))} disabled={ptr >= flatHeats.length - 1} aria-label="Stop / end race" />
                : <button className="md-startsq" onClick={startRace} aria-label="Start race">▶</button>}
              <span className="md-pnav"><button onClick={() => setHeatPtr((p) => Math.max(0, p - 1))} disabled={ptr === 0}>‹</button>
                <span className="md-pmeta">#{events[current.evIdx].num} {shortEvent(current?.eventName)} · H{current?.num}</span>
                <button onClick={() => setHeatPtr((p) => Math.min(flatHeats.length - 1, p + 1))} disabled={ptr >= flatHeats.length - 1}>›</button></span>
            </div>
            {isStarted ? (<>
              <div className="md-lanes">
                {slots(current, lanesPerHeat).map((l, i) => l ? (() => { const id = entryId(current.evIdx, current.htIdx, l.lane);
                  return <LaneRow key={id} lane={l} d={get(id)} place={curHeatPlaces[id]} rec={records[current.evId]} active mine={l.team === homeTeam} selected={pop?.id === id} onSelect={(el) => openPop(id, el)} onTime={(v) => update(id, { time: v })}
                    eventName={current.eventName} clockActive={!!clockActive} onLap={() => recordLap(id, current.eventName)} onSplitEdit={(arr) => update(id, { splits: arr })} />; })()
                  : <div key={"e" + i} className="md-lane empty"><span className="md-lanenum">{i + 1}</span><span className="md-emptytxt">—</span></div>)}
              </div>
            </>) : (
              <AllLanesStrip heat={current} homeTeam={homeTeam} onPick={openPop} />
            )}
          </div>

          <div className={"md-panel prev" + (isStarted ? " racing" : " grow")}>
            <div className="md-phead"><span className="md-eyebrow">Previous</span>
              <span className="md-pmeta">{previous ? `#${events[previous.evIdx].num} ${shortEvent(previous.eventName)} · H${previous.num}` : "—"}</span></div>
            {previous && (isStarted
              ? <PreviousSlider list={prevList} homeTeam={homeTeam} onPick={openPop} />
              : <div className="md-lanes">
                  {[...previous.lanes].map((l) => ({ l, id: entryId(previous.evIdx, previous.htIdx, l.lane) })).sort((a, b) => (prevHeatPlaces[a.id] || 99) - (prevHeatPlaces[b.id] || 99))
                    .map(({ l, id }) => <LaneRow key={id} lane={l} d={get(id)} place={prevHeatPlaces[id]} rec={records[previous.evId]} mine={l.team === homeTeam} selected={pop?.id === id} onSelect={(el) => openPop(id, el)} onTime={(v) => update(id, { time: v })} />)}
                </div>)}
          </div>
        </section>

        {/* -------- RIGHT: results ticker + meet sheet (scrolls) -------- */}
        <section className="md-right">
          <ResultsTicker resultsEvent={resultsEvent} list={resultsList} mode={mode} homeTeam={homeTeam} records={records} onPick={openPop} />
          <div className="md-sheethead"><span className="md-eyebrow">Meet sheet</span>
            <div className="md-jumpwrap">
              <div className="md-eventjump">
                <button onClick={() => goToEventIdx((current?.evIdx ?? 0) - 1)} disabled={!current || current.evIdx <= 0} aria-label="Previous event" title="Previous event">▲</button>
                <input value={jumpQuery} onChange={(e) => setJumpQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && jumpToQuery()} placeholder="# or name" aria-label="Jump to event" />
                <button onClick={() => goToEventIdx((current?.evIdx ?? 0) + 1)} disabled={!current || current.evIdx >= events.length - 1} aria-label="Next event" title="Next event">▼</button>
              </div>
              <button className="md-jumpgo" onClick={jumpToQuery}>Go</button>
              <button className="md-jump" onClick={jumpToCurrent}>⌖ Current</button>
            </div>
          </div>
          <div className="md-sheet" ref={sheetRef}>
            {events.map((ev, evIdx) => {
              const isCurEv = current && evIdx === current.evIdx;
              return (
              <div key={ev.id} ref={(el) => (evRefs.current[ev.id] = el)} className={"md-evblock" + (isCurEv ? " curev" : "")}>
                <div className="md-evname"><span className="md-evnum">#{ev.num}</span> {ev.name}{isCurEv && <span className="md-nowpill">NOW</span>}<span className="md-evcat">{categorize(ev.name)}</span></div>
                <div className="md-recordrow"><span className="md-reclabel">Record</span>
                  <input className="md-recinput" value={records[ev.id] || ""} placeholder="—:—" onChange={(e) => setRecords((r) => ({ ...r, [ev.id]: e.target.value }))} /></div>
                {ev.heats.map((ht, htIdx) => { const fi = flatHeats.findIndex((f) => f.evIdx === evIdx && f.htIdx === htIdx); const isCur = fi === ptr;
                  return (
                    <div key={ht.num} className={"md-heat" + (isCur ? " cur" : "")}>
                      {!ev.flat && <button className="md-heatbar" onClick={() => setHeatPtr(fi)}><span>Heat {ht.num}</span>{isCur && <span className="md-curpill">On board</span>}</button>}
                      {ht.lanes.map((l) => { const id = entryId(evIdx, htIdx, l.lane);
                        return <SheetRow key={id} lane={l} d={get(id)} place={finishedEvents[evIdx] ? places[id] : null} rec={records[ev.id]} mine={l.team === homeTeam} selected={pop?.id === id} onSelect={(el) => openPop(id, el)} onSwimmer={(leg, el) => openPop(id + "#" + leg, el)} legData={l.swimmers ? l.swimmers.map((s, i) => get(id + "#" + i)) : null} />; })}
                    </div>
                  ); })}
              </div>
            ); })}
          </div>
        </section>
      </div>

      {pop && popInfo && (<>
        <div className="md-povscrim" onClick={() => { setPop(null); setAgeStack([]); }} />
        {renderSwimmerPop(pop.id, pop.rect, 0, () => { setPop(null); setAgeStack([]); },
          (ag, rect) => setAgeStack([{ kind: "age", ageGroup: ag, rect }]),
          (name, team, rect) => setAgeStack([{ kind: "profile", name, team, rect }]), "base")}
        {ageStack.map((item, i) => item.kind === "age"
          ? <AgeGroupPopover key={"age" + i} ageGroup={item.ageGroup} roster={ageGroupPowerRoster(rankMeets, item.ageGroup)} rect={item.rect} depth={i + 1} onClose={() => setAgeStack((s) => s.slice(0, i))} onPick={(name, team, el) => setAgeStack((s) => [...s.slice(0, i + 1), { kind: "profile", name, team, rect: el.getBoundingClientRect() }])} />
          : <SwimmerProfilePopover key={"pf" + i} name={item.name} team={item.team} seasonMeets={rankMeets} liveMeet={{ meetName, mode, events, data }} rect={item.rect} depth={i + 1} onClose={() => setAgeStack((s) => s.slice(0, i))} onOpenLeague={openLeagueProfile} />)}
      </>)}
      {showFinalizeDqs && <FinalizeDqsPanel list={pendingDqs} onClose={() => setShowFinalizeDqs(false)}
        onPick={(row, el) => { setDqTarget(row.id); setDqSwimmer(row.swimmer || null); setDqNsTarget(row.id); setDqAnchorRect(el ? el.getBoundingClientRect() : null); }} />}
      {dqInfo && <DQModal info={dqInfo} dqs={get(dqTarget).dqs || []} swimmer={dqSwimmer} ns={isNoShow(get(dqNsTarget || dqTarget))} rect={dqAnchorRect} onClose={() => { setDqTarget(null); setDqSwimmer(null); setDqNsTarget(null); setDqAnchorRect(null); }}
        onClear={() => update(dqTarget, { dqs: [] })}
        onNoShow={() => { const id = dqNsTarget || dqTarget; update(id, { noshow: !isNoShow(get(id)) }); }}
        onToggle={(group, code, reason) => toggleDqCode(dqTarget, group, code, reason, dqSwimmer)} />}
      {modal === "import" && <ImportModal onClose={() => setModal(null)} onApply={applyImport} defaultTeam={homeTeam} />}
      {modal === "results" && <ResultsModal onClose={() => setModal(null)} events={events} homeTeam={homeTeam}
        onApply={(patch) => { setData((d) => { const nd = { ...d }; Object.entries(patch).forEach(([id, p]) => {
          const cur = nd[id] || { time: "", dqs: [], tags: {}, notes: "" };
          // A pending-DQ patch from the sheet shouldn't stack duplicate pending
          // markers or clobber a DQ the coach already entered by hand.
          const dqs = p.dqs ? (cur.dqs && cur.dqs.length ? cur.dqs : p.dqs) : cur.dqs;
          nd[id] = { ...cur, ...p, ...(p.dqs ? { dqs } : {}) };
        }); return nd; }); setModal(null); }}
        onSaveNew={({ meet, name, date, mode: mtype, host, away }) => {
          const saveDate = date || new Date().toISOString().slice(0, 10);
          setEvents(meet.events); setData(meet.data); setRecords({}); setStartedHeats({}); setHeatPtr(0);
          setMeetName(name); setMeetDate(saveDate); setMode(mtype); if (host) setHostTeam(host); if (away) setAwayTeam(away); setModal(null);
          const id = "meetdeck:meet:" + Date.now();
          const snap = { id, meetName: name, mode: mtype, date: saveDate, events: meet.events, data: meet.data, records: {}, homeTeam, hostTeam: host, awayTeam: away, dualLanes };
          setSeasonMeets((a) => [...a.filter((m) => !(m.meetName === name && m.date === saveDate)), snap]);
          if (STORE) { (async () => { try { await STORE.set(id, JSON.stringify(snap)); let idx = []; try { const r = await STORE.get(INDEX_KEY); if (r && r.value) idx = JSON.parse(r.value); } catch (e) {} idx = idx.filter((x) => x.meetName !== name || x.date !== saveDate); idx.push({ id, meetName: name, mode: mtype, date: saveDate }); await STORE.set(INDEX_KEY, JSON.stringify(idx)); } catch (e) {} })(); }
          flash("Saved new meet: " + name);
        }} />}
      {modal === "stats" && <StatsModal onClose={() => { setModal(null); setStatsTeam(null); }} events={events} data={data} mode={mode} filter={filter} homeTeam={statsTeam || homeTeam} />}
      {modal === "participants" && <ParticipantsModal onClose={() => setModal(null)} events={events} data={data} homeTeam={homeTeam}
        onOne={(entry, val) => { update(entry.id, { scratched: val });
          if (val && entry.relay) { pushRelayUndo("Scratched " + entry.name, () => { update(entry.id, { scratched: false }); flash("Undone"); }); setRelayReplaceTarget({ evIdx: entry.evIdx, htIdx: entry.htIdx, lane: entry.relayLane, leg: entry.leg, name: entry.name, team: entry.team, eventName: events[entry.evIdx]?.name || entry.ev }); } }}
        onAll={(name, team, val) => scratchAll(name, team, val)} revertible={relaySwapHistory} onRevertSwap={revertRelaySwap} />}
      {modal === "league" && <LeagueModal onClose={() => { setModal(null); setLeagueProfileTarget(null); }} meets={rankMeets} homeTeam={homeTeam} liveMeet={{ meetName, mode, events, data }} initialProfile={leagueProfileTarget} />}
      {modal === "season" && <SeasonModal onClose={() => setModal(null)} homeTeam={homeTeam} meets={rankMeets} />}
      {modal === "meetsetup" && <MeetSetupModal onClose={() => setModal(null)} meetName={meetName} setMeetName={setMeetName} meetDate={meetDate} setMeetDate={setMeetDate} mode={mode} setMode={setMode} dualLanes={dualLanes} setDualLanes={setDualLanes} hostTeam={hostTeam} setHostTeam={setHostTeam} awayTeam={awayTeam} setAwayTeam={setAwayTeam} teams={teamsPresent} onImport={() => setModal("import")} />}
      {modal === "settings" && <SettingsModal onClose={() => setModal(null)} homeTeam={homeTeam} setHomeTeam={setHomeTeam} teams={teamsPresent} onMeetSetup={() => setModal("meetsetup")} onResults={() => setModal("results")} onSave={() => saveToSeason()} onExport={() => setModal("export")} onClear={clearData} meets={seasonMeets} onLoad={loadMeet} onDelete={deleteMeet}
        session={session} isAdmin={isAdmin} onLogout={onLogout} onManageAccounts={() => setModal("accounts")} />}
      {modal === "accounts" && isAdmin && <AccountsModal onClose={() => setModal(null)} accounts={accounts} onSave={onSaveAccounts} currentUsername={session?.username} />}
      {modal === "compare" && <SwimmerCompareModal onClose={() => setModal(null)} events={events} data={data} seasonMeets={seasonMeets} homeTeam={homeTeam} mode={cmpMode} onModeChange={setCmpMode} onOpenLeague={openLeagueProfile} />}
      {scratchTarget && <div className="md-scrim" onClick={() => setScratchTarget(null)}>
        <div className="md-modal md-scratchmodal" onClick={(e) => e.stopPropagation()} role="dialog">
          <div className="md-mhead"><button className="md-logo sm" onClick={() => setScratchTarget(null)} aria-label="Home" title="MeetDeck — home">≈</button><div className="md-mheadtxt"><div className="md-mtitle">Scratch {scratchTarget.name}?</div><div className="md-msub">Scratched swims are crossed out and don't score or place.</div></div><button className="md-x" onClick={() => setScratchTarget(null)}>✕</button></div>
          <div className="md-scratchbtns">
            <button className="md-mbtn" onClick={() => { scratchOne(scratchTarget.id); setPop(null);
              if (scratchTarget.relay) { pushRelayUndo("Scratched " + scratchTarget.name, () => { unscratchOne(scratchTarget.id); flash("Undone"); }); setRelayReplaceTarget({ evIdx: scratchTarget.evIdx, htIdx: scratchTarget.htIdx, lane: scratchTarget.lane, leg: scratchTarget.leg, name: scratchTarget.name, team: scratchTarget.team, eventName: scratchTarget.eventName }); }
              else pushRelayUndo("Scratched " + scratchTarget.name, () => { unscratchOne(scratchTarget.id); flash("Undone"); });
              setScratchTarget(null); }}>{scratchTarget.relay ? "Just this relay" : "Just this event"}</button>
            <button className="md-mbtn danger" onClick={() => { scratchAll(scratchTarget.name, scratchTarget.team); setPop(null);
              if (scratchTarget.relay) { pushRelayUndo("Scratched " + scratchTarget.name + " (whole meet)", () => { scratchAll(scratchTarget.name, scratchTarget.team, false); flash("Undone"); }); setRelayReplaceTarget({ evIdx: scratchTarget.evIdx, htIdx: scratchTarget.htIdx, lane: scratchTarget.lane, leg: scratchTarget.leg, name: scratchTarget.name, team: scratchTarget.team, eventName: scratchTarget.eventName }); }
              else pushRelayUndo("Scratched " + scratchTarget.name + " (whole meet)", () => { scratchAll(scratchTarget.name, scratchTarget.team, false); flash("Undone"); });
              setScratchTarget(null); }}>Whole meet (all events)</button>
            <button className="md-cancel" onClick={() => setScratchTarget(null)}>Cancel</button>
          </div>
        </div>
      </div>}
      {relayReplaceTarget && <RelayReplaceModal target={relayReplaceTarget} candidates={relayCandidatesWithDelta} plan={medleyPlan} planDelta={medleyPlanDelta} originalLegs={relayOriginalLegs} onClose={() => setRelayReplaceTarget(null)}
        onSwap={(c) => swapRelaySwimmer(relayReplaceTarget.evIdx, relayReplaceTarget.htIdx, relayReplaceTarget.lane, relayReplaceTarget.leg, c)}
        onApplyPlan={() => applyRelayPlan(relayReplaceTarget.evIdx, relayReplaceTarget.htIdx, relayReplaceTarget.lane, medleyPlan)} />}
      {relayUndo && <div className="md-toast md-toastundo"><span>{relayUndo.label}</span><button className="md-undobtn" onClick={() => { relayUndo.fn(); setRelayUndo(null); }}>Undo</button></div>}
      {toast && !relayUndo && <div className="md-toast">{toast}</div>}
      {modal === "relay" && <RelayBuilderModal onClose={() => setModal(null)} events={events} data={data} seasonMeets={seasonMeets} homeTeam={homeTeam} />}
      {modal === "export" && <ExportModal onClose={() => setModal(null)} events={events} data={data} myTeam={homeTeam} places={places} records={records} meetName={meetName} />}
      {relaySplitsScope && relaySplitsHeat && isRelayEvent(relaySplitsHeat.eventName) && <RelaySplitsPanel heat={relaySplitsHeat} evIdx={relaySplitsScope.evIdx} htIdx={relaySplitsScope.htIdx} scopeLane={relaySplitsScope.lane} data={data} homeTeam={homeTeam} onClose={() => setRelaySplitsScope(null)} update={update} get={get} openPop={openPop}
        clockActive={curKey === relaySplitsScope.evIdx + ":" + relaySplitsScope.htIdx ? clockActive : null} />}
    </div>
  );
}

const ACCOUNTS_KEY = "meetdeck:accounts:v1";
const SESSION_KEY = "meetdeck:session:v1";
const DEFAULT_ACCOUNTS = [{ username: "Coach-Cooper", password: "123456", role: "admin" }];
const findAccount = (accounts, username) => accounts.find((a) => a.username.toLowerCase() === (username || "").trim().toLowerCase());

// Top-level: gates the board behind a login screen and owns the account list,
// both kept in persistent storage so a page refresh on the iPad doesn't log
// the coach back out or forget who else has an account.
export default function App() {
  const [accounts, setAccounts] = useState(null); // null while loading
  const [session, setSession] = useState(null);
  const [loginError, setLoginError] = useState("");

  useEffect(() => { let live = true; (async () => {
    let acc = DEFAULT_ACCOUNTS, sess = null;
    if (STORE) {
      try { const r = await STORE.get(ACCOUNTS_KEY); if (r && r.value) acc = JSON.parse(r.value); else await STORE.set(ACCOUNTS_KEY, JSON.stringify(acc)); } catch (e) {}
      try { const r = await STORE.get(SESSION_KEY); if (r && r.value) sess = JSON.parse(r.value); } catch (e) {}
    }
    if (!live) return;
    setAccounts(acc);
    if (sess && findAccount(acc, sess.username)) setSession(sess);
  })(); return () => { live = false; }; }, []);

  const saveAccounts = (next) => { setAccounts(next); if (STORE) STORE.set(ACCOUNTS_KEY, JSON.stringify(next)).catch(() => {}); };
  const login = (username, password) => {
    const acc = findAccount(accounts || [], username);
    if (!acc || acc.password !== password) { setLoginError("Incorrect username or password."); return; }
    const sess = { username: acc.username };
    setSession(sess); setLoginError(""); if (STORE) STORE.set(SESSION_KEY, JSON.stringify(sess)).catch(() => {});
  };
  const logout = () => { setSession(null); if (STORE) STORE.delete(SESSION_KEY).catch(() => {}); };
  const isAdmin = session && findAccount(accounts || [], session.username)?.role === "admin";

  return (<>
    <style>{CSS}</style>
    {accounts === null ? null // brief flash while persisted state loads
      : !session ? <LoginScreen onLogin={login} error={loginError} />
      : <MeetDeckBoard session={session} isAdmin={isAdmin} onLogout={logout} accounts={accounts} onSaveAccounts={saveAccounts} />}
  </>);
}

function LoginScreen({ onLogin, error }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const submit = (e) => { e.preventDefault(); onLogin(username, password); };
  return (
    <div className="md-root md-loginwrap">
      <form className="md-loginbox" onSubmit={submit}>
        <div className="md-loginlogo">≈ MeetDeck</div>
        <div className="md-loginsub">Sign in to load your team's meets &amp; season data.</div>
        <label className="md-mrow">Username<input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoCorrect="off" placeholder="username" /></label>
        <label className="md-mrow">Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <div className="md-loginerr">{error}</div>}
        <button className="md-apply" type="submit">Log in</button>
      </form>
    </div>
  );
}

// `accounts`/`onSave` come straight from the top-level App's own state (the
// same state `login()` reads), not an independent copy loaded from storage —
// otherwise a newly added account couldn't log in until a page refresh.
function AccountsModal({ onClose, accounts, onSave, currentUsername }) {
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [role, setRole] = useState("coach");
  const [err, setErr] = useState("");
  const add = () => {
    if (!username.trim() || !password) { setErr("Username and password required."); return; }
    if (findAccount(accounts, username)) { setErr("That username already exists."); return; }
    onSave([...accounts, { username: username.trim(), password, role }]);
    setUsername(""); setPassword(""); setRole("coach"); setErr("");
  };
  const remove = (u) => { if (u.toLowerCase() === (currentUsername || "").toLowerCase()) { setErr("Can't remove the account you're signed in with."); return; } onSave(accounts.filter((a) => a.username !== u)); };
  return (
    <div className="md-scrim" onClick={onClose}>
      <div className="md-modal md-settings" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="md-mhead"><button className="md-logo sm" onClick={onClose} aria-label="Home" title="MeetDeck — home">≈</button><div className="md-mheadtxt"><div className="md-mtitle">👤 Manage accounts</div><div className="md-msub">Admin only — add or remove coach logins.</div></div><button className="md-x" onClick={onClose}>✕</button></div>
        <div className="md-setbody">
          {accounts.map((a) => (
            <div key={a.username} className="md-meetrow">
              <div className="md-meetinfo"><div className="md-meetname">{a.username}</div><div className="md-meetmeta">{a.role}</div></div>
              <button className="md-meetdel" onClick={() => remove(a.username)} aria-label="Remove">🗑</button>
            </div>
          ))}
          <div className="md-mdiv" />
          <label className="md-mrow">New username<input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" /></label>
          <label className="md-mrow">Password<input value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <label className="md-mrow">Role<select value={role} onChange={(e) => setRole(e.target.value)}><option value="coach">Coach</option><option value="admin">Admin</option></select></label>
          {err && <div className="md-loginerr">{err}</div>}
          <button className="md-mbtn primary" onClick={add}>Add account</button>
        </div>
        <div className="md-mfoot"><button className="md-apply" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

// On-deck: horizontal strip of the home team's swimmers in the next heat —
// all shown at once (shrinking to fit, same tight-space fallback as the
// pre-start strip) rather than a sliding carousel, since it's already
// filtered to just the home team and usually only a handful of cards.
function OnDeckStrip({ heat, homeTeam, onPick }) {
  const lanes = heat ? [...heat.lanes].filter((l) => l.team === homeTeam).sort((a, b) => a.lane - b.lane) : [];
  if (!heat) return <div className="md-odempty">No swimmers on deck.</div>;
  if (!lanes.length) return <div className="md-odempty">No {homeTeam} swimmers in this heat.</div>;
  const n = lanes.length;
  const cardW = (400 - 10 - Math.max(0, n - 1) * 3) / n;
  const tightName = cardW < 70, tightTeam = cardW < 46;
  return (
    <div className="md-odstrip all">
      {lanes.map((l) => { const id = entryId(heat.evIdx, heat.htIdx, l.lane);
        const teamLabel = tightTeam ? (TEAM_MICRO[l.team] || l.team.slice(0, 2)) : l.team;
        const nameLabel = tightName ? abbrevName(l.name) : l.name;
        return <button key={l.lane} className="md-odcard mine sm" title={`${l.name} · ${l.team}${l.age ? " · " + l.age : ""} · seed ${l.seed}`} onClick={(e) => onPick(id, e.currentTarget)}>
          <span className="md-odlane">{l.lane}</span>
          <span className="md-odcname">{nameLabel}</span>
          <span className="md-odcteam" style={{ color: teamColor(l.team) }}>{teamLabel}{l.age ? " · " + l.age : ""}</span>
          <span className="md-odcseed">{l.seed}</span>
        </button>; })}
    </div>
  );
}

// Pre-start preview of the heat that's about to swim: every lane laid out in
// one horizontal row, sized to fit the on-deck-sized box without scrolling —
// distinct from OnDeckStrip's 2-card carousel, which only shows the home team.
// Falls back to tighter labels (name → initials, team → 2-letter code) once
// the estimated per-card width can't fit the full versions, rather than
// scrolling or clipping — full info is still available via the tooltip.
function AllLanesStrip({ heat, homeTeam, onPick }) {
  const lanes = heat ? [...heat.lanes].sort((a, b) => a.lane - b.lane) : [];
  if (!lanes.length) return <div className="md-odempty">No swimmers in this heat.</div>;
  const n = lanes.length;
  const cardW = (400 - 10 - Math.max(0, n - 1) * 3) / n; // panel is 400px wide (see .md-grid)
  const tightName = cardW < 40, tightTeam = cardW < 42;
  return (
    <div className="md-allstrip">
      {lanes.map((l) => { const id = entryId(heat.evIdx, heat.htIdx, l.lane);
        const teamLabel = tightTeam ? (TEAM_MICRO[l.team] || l.team.slice(0, 2)) : l.team;
        const nameLabel = tightName ? abbrevName(l.name) : firstNameOnly(l.name);
        return <button key={l.lane} className={"md-odcard allfit" + (l.team === homeTeam ? " mine" : "")} title={`${l.name} · ${l.team}`} onClick={(e) => onPick(id, e.currentTarget)}>
          <span className="md-odlane">{l.lane}</span>
          <span className="md-odcname">{nameLabel}</span>
          <span className="md-odcteam" style={{ color: teamColor(l.team) }}>{teamLabel}</span>
        </button>; })}
    </div>
  );
}

function PreviousSlider({ list, homeTeam, onPick }) {
  const [idx, setIdx] = useState(0);
  const [winH, setWinH] = useState(68);
  const winRef = useRef(null);
  const hold = useRef(0); const tx = useRef(null); const ty = useRef(null);
  const ROW = 34;
  const vis = Math.max(2, Math.floor(winH / ROW));
  const maxIdx = Math.max(0, list.length - vis);
  useLayoutEffect(() => { const el = winRef.current; if (!el) return; const measure = () => setWinH(el.clientHeight); measure(); const ro = new ResizeObserver(measure); ro.observe(el); return () => ro.disconnect(); }, []);
  useEffect(() => { setIdx((i) => Math.min(i, maxIdx)); }, [maxIdx]);
  useEffect(() => { if (list.length <= vis) return; const t = setInterval(() => { if (Date.now() < hold.current) return; setIdx((i) => (i >= maxIdx ? 0 : i + 1)); }, 2000); return () => clearInterval(t); }, [list.length, vis, maxIdx]);
  const nudge = (d) => { hold.current = Date.now() + 6000; setIdx((i) => Math.min(maxIdx, Math.max(0, i + d))); };
  if (!list.length) return <div className="md-prevslider empty">No times in the previous heat yet.</div>;
  return (
    <div className="md-prevslider"
      onWheel={(e) => nudge(e.deltaY > 0 ? 1 : -1)}
      onTouchStart={(e) => { tx.current = e.touches[0].clientX; ty.current = e.touches[0].clientY; }}
      onTouchEnd={(e) => { if (tx.current === null) return; const dx = e.changedTouches[0].clientX - tx.current, dy = e.changedTouches[0].clientY - ty.current; tx.current = null; if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 24) nudge(dy < 0 ? 1 : -1); else if (Math.abs(dx) > 40) nudge(dx < 0 ? 1 : -1); }}>
      <div className="md-prevwin" ref={winRef}>
        <div className="md-prevroll" style={{ transform: `translateY(${-idx * ROW}px)` }}>
          {list.map((e) => (
            <button key={e.id} className={"md-prevrow" + (e.l.team === homeTeam ? " mine" : "")} style={{ height: ROW }} onClick={(ev2) => onPick(e.id, ev2.currentTarget)}>
              <span className="md-place">{e.place ? ORD(e.place) : e.l.lane}</span>
              <span className="md-resname">{e.l.name}</span>
              <span className="md-resteam" style={{ color: teamColor(e.l.team) }}>{e.l.team}{e.l.age ? " · " + e.l.age : ""}</span>
              <span className="md-restime">{e.time || "––.––"}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Last-race live ticker: shows 2 places, auto-slides one place every 2s,
// loops back to 1st after the last scoring place. Swipe/arrows jump by 2.
function ResultsTicker({ resultsEvent, list, mode, homeTeam, records, onPick }) {
  const [idx, setIdx] = useState(0);
  const holdUntil = useRef(0);
  const touchX = useRef(null);
  const maxIdx = Math.max(0, list.length - 2);
  useEffect(() => { setIdx(0); }, [resultsEvent?.ev?.id]);
  useEffect(() => {
    if (list.length <= 2) return;
    const t = setInterval(() => {
      if (Date.now() < holdUntil.current) return;
      setIdx((i) => (i >= maxIdx ? 0 : i + 1));
    }, 2000);
    return () => clearInterval(t);
  }, [list.length, maxIdx]);
  const nudge = (d) => { holdUntil.current = Date.now() + 5000; setIdx((i) => Math.min(maxIdx, Math.max(0, i + d))); };
  if (!resultsEvent || !list.length) {
    return <div className="md-ticker empty"><span className="md-eyebrow gold">🏁 Last race</span><span className="md-tickempty">no finished event yet</span></div>;
  }
  const relay = isRelayEvent(resultsEvent.ev.name);
  const table = mode === "champs" ? CHAMPS : DUAL;
  const ROW = 30;
  return (
    <div className="md-ticker"
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => { if (touchX.current === null) return; const dx = e.changedTouches[0].clientX - touchX.current; touchX.current = null; if (Math.abs(dx) > 40) nudge(dx < 0 ? 2 : -2); }}>
      <div className="md-tickhead">
        <span className="md-eyebrow gold">🏁 Last race</span>
        <span className="md-tickev">#{resultsEvent.ev.num} {shortEvent(resultsEvent.ev.name)}</span>
        <span className="md-ticknav">
          <button onClick={() => nudge(-2)} disabled={idx === 0} aria-label="Back 2 places">‹</button>
          <span className="md-tickpos">{idx + 1}–{Math.min(idx + 2, list.length)} of {list.length}</span>
          <button onClick={() => nudge(2)} disabled={idx >= maxIdx} aria-label="Forward 2 places">›</button>
        </span>
      </div>
      <div className="md-tickwin" style={{ height: ROW * 2 }}>
        <div className="md-tickroll" style={{ transform: `translateY(${-idx * ROW}px)` }}>
          {list.map((e, i) => {
            const pts = (table[i + 1] || 0) * (relay ? 2 : 1);
            const mine = e.l.team === homeTeam;
            const best = isBest(e.time, e.l.seed), br = brokeRecord(e.time, records[resultsEvent.ev.id]);
            return (
              <button key={e.id} className={"md-tickrow" + (mine ? " mine" : "")} style={{ height: ROW }}
                onClick={(ev2) => onPick(e.id, ev2.currentTarget)}>
                <span className={"md-resplace p" + (i + 1)}>{ORD(i + 1)}</span>
                <span className="md-resname">{e.l.name}</span>
                <span className="md-resteam" style={{ color: teamColor(e.l.team) }}>{e.l.team}{e.l.age ? " · " + e.l.age : ""}</span>
                <span className="md-restime">{e.time}{best && <em className="md-best sm">B</em>}{br && <em className="md-br">BR</em>}</span>
                <span className="md-respts">+{pts}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MeetSetupModal({ onClose, meetName, setMeetName, meetDate, setMeetDate, mode, setMode, dualLanes, setDualLanes, hostTeam, setHostTeam, awayTeam, setAwayTeam, teams, onImport }) {
  return (
    <div className="md-scrim" onClick={onClose}>
      <div className="md-modal md-settings" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="md-mhead"><button className="md-logo sm" onClick={onClose} aria-label="Home" title="MeetDeck — home">≈</button><div className="md-mheadtxt"><div className="md-mtitle">Meet set up</div><div className="md-msub">Name, date, type, teams, lanes &amp; roster</div></div><button className="md-x" onClick={onClose}>✕</button></div>
        <div className="md-setbody">
          <label className="md-mrow">Meet name<input value={meetName} onChange={(e) => setMeetName(e.target.value)} /></label>
          <label className="md-mrow">Meet date<input type="date" value={meetDate} onChange={(e) => setMeetDate(e.target.value)} /></label>
          <label className="md-mrow">Meet type<select value={mode} onChange={(e) => setMode(e.target.value)}><option value="dual">Dual meet</option><option value="champs">Champs</option><option value="timetrial">Time trials</option></select></label>
          <div className="md-mrow">Lanes per heat<div className="md-stepper"><button onClick={() => setDualLanes((n) => Math.max(4, n - 1))}>−</button><span>{dualLanes}</span><button onClick={() => setDualLanes((n) => Math.min(12, n + 1))}>＋</button></div></div>
          {mode === "dual" && <label className="md-mrow">Home team (1st)<select value={hostTeam} onChange={(e) => setHostTeam(e.target.value)}>{teams.map((t) => <option key={t} value={t}>{TEAM_NAME[t] || t}</option>)}</select></label>}
          {mode === "dual" && <label className="md-mrow">Away team (2nd)<select value={awayTeam} onChange={(e) => setAwayTeam(e.target.value)}>{teams.map((t) => <option key={t} value={t}>{TEAM_NAME[t] || t}</option>)}</select></label>}
          <div className="md-mdiv" />
          <button className="md-mbtn" onClick={onImport}>Import roster / heat sheet (PDF / text)</button>
        </div>
        <div className="md-mfoot"><button className="md-apply" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

function SettingsModal({ onClose, homeTeam, setHomeTeam, teams, onMeetSetup, onResults, onSave, onExport, onClear, meets, onLoad, onDelete, session, isAdmin, onLogout, onManageAccounts }) {
  const [pendingDelete, setPendingDelete] = useState(null);
  return (
    <div className="md-scrim" onClick={onClose}>
      <div className="md-modal md-settings" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="md-mhead"><button className="md-logo sm" onClick={onClose} aria-label="Home" title="MeetDeck — home">≈</button><div className="md-mheadtxt"><div className="md-mtitle">⚙ Settings</div><div className="md-msub">Setup, team, saved meets &amp; data</div></div><button className="md-x" onClick={onClose}>✕</button></div>
        <div className="md-setbody">
          {session && <div className="md-acctrow"><span>Signed in as <b>{session.username}</b>{isAdmin ? " · admin" : ""}</span><button className="md-mbtn sm" onClick={onLogout}>Log out</button></div>}
          {isAdmin && <button className="md-mbtn" onClick={onManageAccounts}>👤 Manage accounts</button>}
          <div className="md-mdiv" />
          <button className="md-mbtn" onClick={onMeetSetup}>Meet set up</button>
          <button className="md-mbtn" onClick={onResults}>Results</button>
          <div className="md-mdiv" />
          <label className="md-mrow">Main team (yours)<select value={homeTeam} onChange={(e) => setHomeTeam(e.target.value)}>{teams.map((t) => <option key={t} value={t}>{TEAM_NAME[t] || t}</option>)}</select></label>
          <button className="md-mbtn" onClick={onSave}>💾 Save this meet to season</button>
          <button className="md-mbtn primary" onClick={onExport}>Export to Google Sheets</button>
          <div className="md-mdiv" />
          <div className="md-menutitle">Saved meets ({(meets || []).length})</div>
          <div className="md-savedmeets">
            {(meets || []).length ? [...meets].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((m) => (
              <div key={m.id} className="md-meetrow">
                <div className="md-meetinfo"><div className="md-meetname">{m.meetName}</div><div className="md-meetmeta">{m.date} · {m.mode === "timetrial" ? "Time trials" : m.mode === "champs" ? "Champs" : "Dual"}</div></div>
                <button className="md-meetload" onClick={() => onLoad(m)}>Load</button>
                <button className="md-meetdel" onClick={() => setPendingDelete(m)} aria-label="Delete">🗑</button>
              </div>
            )) : <div className="md-prevempty">No saved meets yet.</div>}
          </div>
          <div className="md-mdiv" />
          {isAdmin && <button className="md-mbtn danger" onClick={onClear}>🗑 Clear all data &amp; reset</button>}
        </div>
        {pendingDelete && <div className="md-confirm" onClick={() => setPendingDelete(null)}>
          <div className="md-confirmbox" onClick={(e) => e.stopPropagation()}>
            <div className="md-confirmq">Delete “{pendingDelete.meetName}” ({pendingDelete.date})? This can't be undone.</div>
            <div className="md-confirmbtns"><button className="md-cancel" onClick={() => setPendingDelete(null)}>Cancel</button><button className="md-confirmyes" onClick={() => { onDelete(pendingDelete.id); setPendingDelete(null); }}>Yes, delete</button></div>
          </div>
        </div>}
        <div className="md-mfoot"><button className="md-apply" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

function ScoreStrip({ scores, mode, home, away, teams, onTeamClick }) {
  if (mode === "timetrial") return <div className="md-strip"><span className="md-ttlabel">⏱ Time trials — no scoring</span></div>;
  const row = (t) => { const sw = scores.swims[t] || 0, im = scores.imp[t] || 0; return { t, pts: scores.pts[t] || 0, pct: sw ? Math.round((im / sw) * 100) : 0 }; };
  if (mode === "dual") { const H = row(home), A = row(away); return <div className="md-strip dual"><TeamScore r={H} big onClick={onTeamClick} /><span className="md-vs">vs</span><TeamScore r={A} big onClick={onTeamClick} /></div>; }
  const rows = teams.map(row).sort((a, b) => b.pts - a.pts);
  return <div className="md-strip">{rows.map((r) => <TeamScore key={r.t} r={r} onClick={onTeamClick} />)}</div>;
}
// Tapping a team's points/improvement pulls up its meet stats — same
// "tap the summary, get the detail popover" pattern as swimmer names on the
// meet sheet opening a profile.
function TeamScore({ r, big, onClick }) {
  return (
    <button type="button" className={"md-tscore" + (big ? " big" : "")} onClick={() => onClick && onClick(r.t)}>
      <span className="md-tsdot" style={{ background: teamColor(r.t) }} /><span className="md-tscode">{r.t}</span><span className="md-tspts">{r.pts}</span><span className="md-tspct">{r.pct}%<small>imp</small></span>
    </button>
  );
}

function LaneRow({ lane, d, place, rec, active, mine, selected, onSelect, onTime, eventName, clockActive, onLap, onSplitEdit }) {
  const best = isBest(d.time, lane.seed), br = brokeRecord(d.time, rec), dq = hasDq(d), scr = isScratched(d), ns = isNoShow(d), off = scr || ns, tagCount = Object.keys(d.tags || {}).length;
  const fs = toSeconds(d.time), ss = toSeconds(lane.seed);
  const delta = !isNaN(fs) && !isNaN(ss) ? fs - ss : null; // negative = improved
  const deltaStr = delta === null ? null : (delta < 0 ? "−" : "+") + Math.abs(delta).toFixed(2);
  const req = active && eventName ? requiredTapsFor(eventName) : 1;
  const tapsLeft = active && clockActive && !off && !d.time;
  const setSplit = (i, v) => { const ns2 = [...(d.splits || [])]; ns2[i] = v; onSplitEdit && onSplitEdit(ns2); };
  return (
    <div className={"md-lane clickable" + (selected ? " sel" : "") + (dq ? " dq" : "") + (off ? " scr" : "") + (mine ? " mine" : "")} onClick={(e) => (tapsLeft ? onLap && onLap() : onSelect(e.currentTarget))}>
      <span className="md-lanenum">{lane.lane}</span>
      <span className="md-laneid">
        <span className="md-laneswimmer">{lane.name}{br && !dq && !off && <span className="md-br">BR</span>}</span>
        <span className="md-laneteam" style={{ color: teamColor(lane.team) }}>{lane.team}{lane.age ? " · " + lane.age : ""}</span>
        {active && req > 1 && !off && (
          <span className="md-splitrow2" onClick={(e) => e.stopPropagation()}>
            {Array.from({ length: req }).map((_, i) => <input key={i} className="md-splitbox" placeholder={`#${i + 1}`} value={(d.splits || [])[i] || ""} onChange={(e) => setSplit(i, e.target.value)} />)}
          </span>
        )}
      </span>
      <span className="md-lanemarks">
        {tapsLeft && req > 1 && <span className="md-tapbadge">⏱ tap {(d.splits || []).length}/{req}</span>}
        {ns && <span className="md-scrbadge">NS</span>}
        {deltaStr && !dq && !off && <span className={"md-delta sm" + (delta < 0 ? " neg" : " pos")}>{deltaStr}</span>}
        {place && !dq && !off && <span className="md-place">{ORD(place)}</span>}
        {dq && <span className="md-dqbadge">DQ {dqLabel(d)}</span>}
        {tagCount > 0 && <span className="md-tagcount">{tagCount}</span>}
      </span>
      <span className="md-timewrap">{off ? <span className="md-timex">{ns ? "NS" : "X"}</span> : <>{best && !dq && <span className="md-best">B</span>}{active ? <input className="md-timein" value={d.time} placeholder="––.––" inputMode="decimal" onClick={(e) => e.stopPropagation()} onChange={(e) => onTime(e.target.value)} /> : <span className="md-timeout">{d.time || "––.––"}</span>}</>}</span>
    </div>
  );
}

function SheetRow({ lane, d, place, rec, mine, selected, onSelect, onSwimmer, legData }) {
  const best = isBest(d.time, lane.seed), br = brokeRecord(d.time, rec), dq = hasDq(d), scr = isScratched(d), ns = isNoShow(d), off = scr || ns, tags = Object.keys(d.tags || {});
  const fs = toSeconds(d.time), ss = toSeconds(lane.seed);
  const delta = !isNaN(fs) && !isNaN(ss) ? fs - ss : null; // negative = improved
  const deltaStr = delta === null ? null : (delta < 0 ? "−" : "+") + Math.abs(delta).toFixed(2);
  return (
    <div className={"md-srowwrap" + (lane.swimmers ? " relay" : "")}>
      <button className={"md-swim" + (dq ? " dq" : "") + (off ? " scr" : "") + (selected ? " sel" : "") + (mine ? " mine" : "")} onClick={(e) => onSelect(e.currentTarget)}>
        <span className="md-slane">{lane.lane}</span>
        <span className="md-sid"><span className="md-sname">{lane.name}{br && !dq && !off && <span className="md-br">BR</span>}</span>
          <span className="md-steam" style={{ color: teamColor(lane.team) }}>{lane.team}{lane.age ? " · " + lane.age : ""}<em className="md-seed">seed {lane.seed}</em></span></span>
        <span className="md-smeta">
          {ns && <span className="md-scrbadge">NS</span>}
          {deltaStr && !dq && !off && <span className={"md-delta" + (delta < 0 ? " neg" : " pos")}>{deltaStr}</span>}
          {place && !dq && !off && <span className="md-place">{ORD(place)}</span>}
          {dq && <span className="md-dqbadge sm">DQ {dqLabel(d)}</span>}
          {tags.slice(0, 2).map((t) => <span key={t} className="md-minitag">{t.split(":").pop().trim()}</span>)}
          {tags.length > 2 && <span className="md-more">+{tags.length - 2}</span>}
          {best && !dq && !off && <span className="md-best">B</span>}
          {off ? <span className="md-stime scrx">{ns ? "NS" : "X"}</span> : (d.time && <span className="md-stime">{d.time}</span>)}
        </span>
      </button>
      {lane.swimmers && <div className="md-relayswim">{lane.swimmers.map((s, i) => { const ld = (legData && legData[i]) || {}; const scr = isScratched(ld);
        return <button key={i} className={"md-rswim btn" + (scr ? " scr" : "")} onClick={(e) => onSwimmer && onSwimmer(i, e.currentTarget)}>
          <b>{i + 1}</b> {s.name}{s.age ? ` (${s.age})` : ""}{scr && <em className="md-subx"> — scratched</em>}
          {ld.subFor && <em className="md-subnote"> · subbed for <s>{ld.subFor.name}</s></em>}
        </button>; })}</div>}
    </div>
  );
}

// Left column (On Deck / In The Water / Previous) is a fixed 400px — never let
// a floating popover's left edge land inside it, or it visually covers those
// live panels; push it just past the column instead. `depth` staggers stacked
// popovers (age-group drill-down) so each is still visible behind the next.
const POV_SAFE_X = 410;
function popoverPos(rect, depth) {
  const W = 320, m = 10, vw = window.innerWidth, vh = window.innerHeight, h = 300;
  const off = (depth || 0) * 18;
  let top = Math.min(rect.bottom + 10, vh - h - m) + off;
  if (top < m) top = m;
  let left = Math.max(POV_SAFE_X, Math.min(rect.left, vw - W - m)) + off;
  if (left + W > vw - m) left = Math.max(POV_SAFE_X, vw - W - m);
  return { top, left };
}
function ActionPopover({ info, d, mine, imEvent, hideSplits, relaySwimmer, relaySplit, progMeets, rect, depth, onClose, onDq, onDqQuick, onToggle, onSplits, onNotes, onNoShow, onScratch, onUnscratch, onOpenAgeGroup, onOpenProfile }) {
  const ref = useRef(null);
  const lastDqClick = useRef(0);
  const dq = hasDq(d), pend = isPendingDq(d);
  // Double-click/double-tap opens the full code picker (own timing instead of
  // the native dblclick event, since iOS Safari's double-tap-to-zoom can
  // swallow it); a single tap does the obviously-right thing instead: mark a
  // quick pending DQ, clear one, or — if a real code is already set — show
  // what it is by opening the picker (view mode; reasons are visible there).
  const dqClick = () => {
    const now = Date.now(), wasDouble = now - lastDqClick.current < 350;
    lastDqClick.current = wasDouble ? 0 : now;
    if (wasDouble) { onDq(); return; }
    if (dq && !pend) onDq(); else onDqQuick();
  };
  const [pos, setPos] = useState(() => popoverPos(rect, depth));
  const [openCat, setOpenCat] = useState(null);
  const [showSplits, setShowSplits] = useState(false);
  const [imStroke, setImStroke] = useState("Fly");
  const [showProg, setShowProg] = useState(false);
  const [progStroke, setProgStroke] = useState("Free");
  const tags = TAG_TREE.filter((c) => !(c.minAge && info.sw.age && info.sw.age < c.minAge && !imEvent));
  const progTimes = showProg ? completedStrokeProgression(swimmerStrokeTimes(info.sw.name, info.sw.team, progStroke, progMeets || [])) : [];
  useLayoutEffect(() => {
    const W = 320, m = 10, vw = window.innerWidth, vh = window.innerHeight, h = ref.current ? ref.current.offsetHeight : 300;
    const off = (depth || 0) * 18;
    let top = rect.bottom + 10 + off;
    if (top + h > vh - m) top = Math.max(m, vh - h - m);
    let left = Math.max(POV_SAFE_X, Math.min(rect.left, vw - W - m)) + off;
    if (left + W > vw - m) left = Math.max(POV_SAFE_X, vw - W - m);
    setPos({ top, left });
  }, [rect, depth]);
  const ns = isNoShow(d), scr = isScratched(d);
  return (
    <div ref={ref} className="md-pov" style={{ top: pos.top, left: pos.left }} role="dialog">
      <div className="md-povhead"><div><div className="md-povname"><button type="button" className="md-povnamelink" onClick={(e) => onOpenProfile && onOpenProfile(e.currentTarget)}>{info.sw.name}</button> {info.sw.age > 0 && <button type="button" className="md-agechip" onClick={(e) => onOpenAgeGroup && onOpenAgeGroup(e.currentTarget)}>{info.sw.age}</button>}<span className="md-povteam" style={{ color: teamColor(info.sw.team) }}>{info.sw.team}</span></div><div className="md-povmeta">{shortEvent(info.eventName)} · H{info.heatNum} · Lane {info.ln}{info.sw.seed ? ` · seed ${info.sw.seed}` : ""}</div></div><button className="md-x sm" onClick={onClose}>✕</button></div>
      <div className="md-povtop">
        <button className={"md-dq" + (dq ? " on" : "") + (pend ? " pend" : "")} onClick={dqClick}>
          {pend ? "DQ — reason pending" : dq ? `DQ ${dqLabel(d)} — tap to see why` : "Tap: DQ · Double-tap: pick reason"}
        </button>
      </div>
      <div className="md-povtop" style={{ marginTop: 8, marginBottom: 4 }}>
        <button className={"md-nsbtn" + (ns ? " on" : "")} onClick={onNoShow}>{ns ? "NS — no-show" : "No-show (NS)"}</button>
        <button className={"md-nsbtn" + (scr ? " on" : "")} onClick={() => (scr ? onUnscratch() : onScratch())}>{scr ? "X — tap to restore" : "Scratch"}</button>
      </div>

      {mine ? (<>
        {imEvent && <div className="md-imrow"><span className="md-imlabel">IM leg:</span>{IM_STROKES.map((s) => <button key={s} className={"md-imchip" + (imStroke === s ? " on" : "")} onClick={() => setImStroke(s)}>{s}</button>)}</div>}
        {relaySwimmer && <div className="md-imrow"><span className="md-imlabel">Relay spot:</span>{RELAY_POSITION.map((s) => { const key = "Spot: " + s, on = !!(d.tags && d.tags[key]); return <button key={s} className={"md-imchip" + (on ? " on" : "")} onClick={() => onToggle(key)}>{s}</button>; })}</div>}
        <div className="md-workhdr">Work on{imEvent ? ` (${imStroke})` : ""}:</div>
        <div className="md-worktags">{tags.map((t) => { const key = imEvent ? `${imStroke} · ${t.label}` : t.label, on = !!(d.tags && d.tags[key]); return <button key={t.label} className={"md-worktag" + (on ? " on" : "")} style={on ? { background: t.color, borderColor: t.color, color: "#fff" } : {}} onClick={() => onToggle(key)}>{t.label}</button>; })}</div>
        {!hideSplits && <button className={"md-splitbtn" + (showSplits ? " on" : "")} onClick={() => setShowSplits((s) => !s)}>⏱ Splits {(d.splits && d.splits.length) ? `(${d.splits.filter(Boolean).length})` : ""}</button>}
        {!hideSplits && showSplits && (
          <div className="md-splitboxrow">
            {Array.from({ length: Math.max(requiredTapsFor(info.eventName), (d.splits || []).length) }).map((_, i) => (
              <input key={i} className="md-splitbox lg" inputMode="decimal" placeholder={`#${i + 1}`} value={(d.splits || [])[i] || ""} onChange={(e) => { const ns = [...(d.splits || [])]; ns[i] = e.target.value; onSplits(ns); }} />
            ))}
          </div>
        )}
        {relaySwimmer && relaySplit && <div className="md-relaysplitread">⏱ Relay split: <b>{relaySplit}</b></div>}
        <textarea className="md-notearea" placeholder={`Notes on ${info.sw.name.split(",")[0]}…`} value={d.notes || ""} onChange={(e) => onNotes(e.target.value)} />
      </>) : (
        <div className="md-otherteam">Other team — DQ and no-show only.</div>
      )}
      <button className={"md-progbtn" + (showProg ? " on" : "")} onClick={() => setShowProg((s) => !s)}>📈 Progression by stroke</button>
      {showProg && <div className="md-progwrap">
        <div className="md-imrow">{PROG_STROKES.map((s) => <button key={s} className={"md-imchip" + (progStroke === s ? " on" : "")} onClick={() => setProgStroke(s)}>{s}</button>)}</div>
        <div className="md-proglist">{progTimes.length ? progTimes.map((t, i) => (
          <div key={i} className="md-progrow"><span className="md-progev">{t.ev}</span><span className="md-progt">{t.seed}{t.final ? ` → ${t.final}` : ""}</span><span className="md-progm">{t.meet || t.date}</span></div>
        )) : <div className="md-progempty">No {progStroke} swims on record yet.</div>}</div>
      </div>}
    </div>
  );
}

// Age-chip drill-down: a small stacked popup ranking everyone in that age
// group across the whole season by Power. Tapping a name pushes that
// swimmer's profile popover on top (via onPick), so popovers "build on each
// other" instead of navigating away to a full page.
function AgeGroupPopover({ ageGroup, roster, rect, depth, onClose, onPick }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(() => popoverPos(rect, depth));
  useLayoutEffect(() => {
    const W = 270, m = 10, vw = window.innerWidth, vh = window.innerHeight, h = ref.current ? ref.current.offsetHeight : 240;
    const off = (depth || 0) * 18;
    let top = rect.bottom + 10 + off;
    if (top + h > vh - m) top = Math.max(m, vh - h - m);
    let left = Math.max(POV_SAFE_X, Math.min(rect.left, vw - W - m)) + off;
    if (left + W > vw - m) left = Math.max(POV_SAFE_X, vw - W - m);
    setPos({ top, left });
  }, [rect, depth]);
  return (
    <div ref={ref} className="md-agepov" style={{ top: pos.top, left: pos.left }} role="dialog">
      <div className="md-agepovhead"><span>Age {ageGroup} — ranked</span><button className="md-x sm" onClick={onClose}>✕</button></div>
      <div className="md-agepovlist">
        {roster.length ? roster.map((s, i) => (
          <button key={s.name + "|" + s.team} className="md-agepovrow" onClick={(e) => onPick(s.name, s.team, e.currentTarget)}>
            <span className="md-agepovrank">{i + 1}</span>
            <span className="md-agepovteam" style={{ background: teamColor(s.team) }}>{s.team}</span>
            <span>{s.name}</span>
            <span className="md-agepovpower">{s.power ?? "—"}</span>
          </button>
        )) : <div className="md-prevempty">No season data for this age group yet.</div>}
      </div>
    </div>
  );
}

// Rich swimmer profile as a small stacked popup (most improved swims, notes,
// DQs, season points, last/upcoming meet) — the same content as the League
// profile page, just reachable without leaving the board.
function SwimmerProfilePopover({ name, team, seasonMeets, liveMeet, rect, depth, onClose, onOpenLeague }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(() => popoverPos(rect, depth));
  useLayoutEffect(() => {
    const W = 300, m = 10, vw = window.innerWidth, vh = window.innerHeight, h = ref.current ? ref.current.offsetHeight : 400;
    const off = (depth || 0) * 18;
    let top = rect.bottom + 10 + off;
    if (top + h > vh - m) top = Math.max(m, vh - h - m);
    let left = Math.max(POV_SAFE_X, Math.min(rect.left, vw - W - m)) + off;
    if (left + W > vw - m) left = Math.max(POV_SAFE_X, vw - W - m);
    setPos({ top, left });
  }, [rect, depth]);
  const prof = useMemo(() => computeSwimmerProfile(name, team, seasonMeets, liveMeet), [name, team, seasonMeets, liveMeet]);
  return (
    <div ref={ref} className="md-profilepov" style={{ top: pos.top, left: pos.left }} role="dialog">
      <div className="md-agepovhead">
        <span>{onOpenLeague ? <button type="button" className="md-povnamelink" onClick={() => onOpenLeague(name, team)}>{name}</button> : name} <em style={{ color: teamColor(team) }}>{team}</em></span>
        <button className="md-x sm" onClick={onClose}>✕</button>
      </div>
      <div className="md-profilestats">
        <div className="md-lgstat"><b>{prof.totalPts}</b><span>season pts</span></div>
        <div className="md-lgstat"><b>{prof.improvePct}%</b><span>improvement</span></div>
        <div className="md-lgstat"><b>{prof.dqs.length}</b><span>DQs</span></div>
      </div>
      <div className="md-lgsection">
        <div className="md-lgsectitle">📈 Most improved</div>
        {prof.improvements.length ? prof.improvements.slice(0, 4).map((im, i) => <div key={i} className="md-statrow"><span className="md-statname">{im.ev}</span><span className="md-statval green">−{im.drop.toFixed(2)}</span></div>) : <div className="md-prevempty">No improvements on record yet.</div>}
      </div>
      <div className="md-lgsection">
        <div className="md-lgsectitle">📝 Notes</div>
        {prof.notes.length ? prof.notes.slice(0, 4).map((n, i) => <div key={i} className="md-profnote"><b>{n.ev}</b><p>{n.note}</p></div>) : <div className="md-prevempty">No notes yet.</div>}
      </div>
      <div className="md-lgsection">
        <div className="md-lgsectitle">🚩 DQs</div>
        {prof.dqs.length ? prof.dqs.slice(0, 4).map((q, i) => <div key={i} className="md-statrow"><span className="md-statname">{q.ev}</span><span className="md-statval red">{q.code}</span></div>) : <div className="md-prevempty">No DQs on record.</div>}
      </div>
    </div>
  );
}

// Every entry currently flagged DQ with the reason still pending — feeds the
// non-blocking Finalize DQs panel so reasons can be filled in once the paper
// DQ slips come in, without having to remember which lane/heat each was in.
function pendingDqList(events, data) {
  const out = [];
  events.forEach((ev, evIdx) => ev.heats.forEach((ht, htIdx) => ht.lanes.forEach((l) => {
    const id = entryId(evIdx, htIdx, l.lane), d = data[id] || {};
    if (!isPendingDq(d)) return;
    const pend = (d.dqs || []).find((q) => q.code === PEND_DQ_CODE);
    out.push({ id, eventName: ev.name, heatNum: ht.num, lane: l.lane, name: (pend && pend.swimmer) || l.name, team: l.team, swimmer: pend && pend.swimmer });
  })));
  return out;
}

// Floating, caret-anchored popover (not a full-screen modal) — points back
// at whichever swimmer/row opened it, same non-blocking pattern as the other
// popovers, and small enough to sit comfortably next to the Finalize DQs list.
function DQModal({ info, dqs, swimmer, ns, rect, onClose, onClear, onToggle, onNoShow }) {
  const age = info.sw.age;
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: 80, left: 80, caret: null });
  useLayoutEffect(() => {
    const W = 340, m = 10, vw = window.innerWidth, vh = window.innerHeight, h = ref.current ? ref.current.offsetHeight : 420;
    if (!rect) { setPos({ top: Math.max(m, (vh - h) / 2), left: Math.max(m, (vw - W) / 2), caret: null }); return; }
    let top = rect.bottom + 10;
    if (top + h > vh - m) top = Math.max(m, vh - h - m);
    const left = Math.min(Math.max(m, rect.left), vw - W - m);
    setPos({ top, left, caret: Math.min(Math.max(16, rect.left + rect.width / 2 - left), W - 24) });
  }, [rect]);
  useEffect(() => { const h = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  return (
    <div ref={ref} className="md-dqpov" style={{ top: pos.top, left: pos.left }} role="dialog">
      {pos.caret != null && <span className="md-caret" style={{ left: pos.caret }} />}
      <div className="md-agepovhead"><span>Record DQ — select all that apply</span><button className="md-x sm" onClick={onClose}>✕</button></div>
      <div className="md-dqpovsub">{swimmer ? `${swimmer} (relay) · ` : ""}{info.sw.name} · {info.sw.team}{age > 0 ? ` · age ${age}` : ""} · {shortEvent(info.eventName)} · Lane {info.ln}</div>
      {age > 0 && age <= 6 && <div className="md-warn red">🚩 <b>6 &amp; under — CHALLENGE this DQ.</b> 6u swimmers should not be getting DQed. Talk to the referee before accepting; only record what was clearly and directly observed.</div>}
      {age >= 7 && age <= 8 && <div className="md-warn amber">⚠︎ <b>7–8 — review before accepting.</b> Double-check the call with the official; benefit of the doubt goes to the swimmer.</div>}
      {!swimmer && <button className={"md-nsbtn" + (ns ? " on" : "")} style={{ marginBottom: 10 }} onClick={onNoShow}>{ns ? "NS — no-show" : "No-show (NS) instead of a DQ"}</button>}
      <div className="md-codes">{Object.entries(DQ_CODES).map(([group, codes]) => (<div key={group} className="md-cgroup"><div className="md-cglabel">{group}</div><div className="md-cgrid">{codes.map(([code, reason]) => { const on = dqs.some((q) => q.code === code); return <button key={code} className={"md-code" + (on ? " on" : "")} onClick={() => onToggle(group, code, reason)} title={reason}><span className="md-ccode">{code}</span><span className="md-creason">{reason}</span></button>; })}</div></div>))}</div>
      <div className="md-dqpovfoot">
        {dqs.length > 0 && <button className="md-clear" onClick={onClear}>Clear all ({dqs.length})</button>}
        <button className="md-apply" onClick={onClose}>Done{dqs.length ? ` — ${dqs.length} selected` : ""}</button>
      </div>
    </div>
  );
}

// Floating, non-blocking review list of every DQ still marked "reason
// pending" — deliberately NOT a full-screen modal so On Deck / In The Water /
// Previous stay visible and usable while going through the paper DQ slips.
function FinalizeDqsPanel({ list, onClose, onPick }) {
  return (
    <div className="md-finalizepanel" role="dialog">
      <div className="md-agepovhead"><span>🚩 Finalize DQs {list.length ? `(${list.length})` : ""}</span><button className="md-x sm" onClick={onClose}>✕</button></div>
      <div className="md-agepovlist">
        {list.length ? list.map((row) => (
          <button key={row.id + (row.swimmer || "")} className="md-agepovrow" onClick={(e) => onPick(row, e.currentTarget)}>
            <span className="md-agepovteam" style={{ background: teamColor(row.team) }}>{row.team}</span>
            <span>{row.name}</span>
            <span className="md-finalizemeta">{shortEvent(row.eventName)} · H{row.heatNum} · L{row.lane}</span>
          </button>
        )) : <div className="md-prevempty">No DQs waiting on a reason.</div>}
      </div>
    </div>
  );
}

function ImportModal({ onClose, onApply, defaultTeam }) {
  const [text, setText] = useState(""); const [busy, setBusy] = useState("");
  const parsed = useMemo(() => parseHeatSheet(text), [text]);
  const teams = useMemo(() => { const s = new Set(); parsed.forEach((ev) => ev.heats.forEach((h) => h.lanes.forEach((l) => s.add(l.team)))); return [...s]; }, [parsed]);
  const [team, setTeam] = useState(defaultTeam);
  useEffect(() => { const b = teams.find((t) => /bdst/i.test(t)); if (b) setTeam(b); }, [teams]);
  const count = parsed.reduce((n, ev) => n + ev.heats.reduce((m, h) => m + h.lanes.length, 0), 0);
  const onFile = async (e) => { const f = e.target.files?.[0]; if (!f) return;
    if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") { setBusy("Reading PDF…"); try { setText(await pdfToText(f)); setBusy(""); } catch { setBusy("Couldn't read the PDF here — paste the text instead."); } }
    else { const r = new FileReader(); r.onload = () => setText(String(r.result || "")); r.readAsText(f); } };
  return (
    <div className="md-scrim" onClick={onClose}>
      <div className="md-modal md-imp" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="md-mhead"><button className="md-logo sm" onClick={onClose} aria-label="Home" title="MeetDeck — home">≈</button><div className="md-mheadtxt"><div className="md-mtitle">Import roster</div><div className="md-msub">Upload the VCSL meet program PDF (or paste text). Preview shows what was read.</div></div><button className="md-x" onClick={onClose}>✕</button></div>
        <div className="md-impbar"><label className="md-filebtn">Choose file<input type="file" accept=".pdf,.txt,.csv,.tsv,application/pdf,text/plain" onChange={onFile} hidden /></label><span className="md-impnote">{busy || "PDF, .txt or .csv"}</span></div>
        <div className="md-impgrid">
          <textarea className="md-imparea" placeholder={"Paste here…\n\n#13 Girls 15-18 50 Yard Butterfly\nVCSL Record: 26.69 2018 Chelsea Huffman\nHeat 1 of 5 Finals\n3 Greenberg, Maayan 15 BDST 47.78"} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="md-preview">
            <div className="md-prevtop"><span>{parsed.length} events · {count} entries</span>{teams.length > 0 && <label className="md-ctl sm">Team<select value={team} onChange={(e) => setTeam(e.target.value)}>{teams.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>}</div>
            <div className="md-prevbody">{parsed.length === 0 ? <div className="md-prevempty">Nothing parsed yet — upload the meet program PDF and the preview fills in.</div>
              : parsed.map((ev) => <div key={ev.id} className="md-prevev"><div className="md-prevevname">#{ev.num} {ev.name}{ev.record ? <em> · rec {ev.record}</em> : ""}</div>{ev.heats.map((h, i) => <div key={i} className="md-prevheat"><div className="md-prevheatn">Heat {h.num}</div>{h.lanes.map((l, j) => <div key={j} className={"md-prevlane" + (l.team === team ? " mine" : "")}><span>{l.lane}</span><span>{l.name}{l.swimmers ? ` (+${l.swimmers.length})` : ""}</span><span>{l.team}</span><span>{l.age || ""}</span><span>{l.seed}</span></div>)}</div>)}</div>)}</div>
          </div>
        </div>
        <div className="md-mfoot"><button className="md-cancel" onClick={onClose}>Cancel</button><button className="md-apply" disabled={count === 0} onClick={() => onApply({ events: parsed, myTeam: team })}>Load {count > 0 ? `${count} entries` : "meet"}</button></div>
      </div>
    </div>
  );
}

function ExportModal({ onClose, events, data, myTeam, places, records, meetName }) {
  const matrix = useMemo(() => buildGrid(events, data, myTeam, places, records), [events, data, myTeam, places, records]);
  const [msg, setMsg] = useState("");
  const copy = async () => { try { await navigator.clipboard.writeText(toTSV(matrix)); setMsg("Copied — paste into a blank Google Sheet (Ctrl/Cmd+V)."); } catch { setMsg("Clipboard blocked here — use Download CSV."); } };
  const download = () => { try { const blob = new Blob([toCSV(matrix)], { type: "text/csv" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${meetName.replace(/\s+/g, "_")}_${myTeam}.csv`; a.click(); URL.revokeObjectURL(url); setMsg("CSV downloaded — File ▸ Import in Google Sheets."); } catch { setMsg("Download blocked here — use Copy."); } };
  return (
    <div className="md-scrim" onClick={onClose}>
      <div className="md-modal md-imp" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="md-mhead"><button className="md-logo sm" onClick={onClose} aria-label="Home" title="MeetDeck — home">≈</button><div className="md-mheadtxt"><div className="md-mtitle">Export to Google Sheets — {myTeam}</div><div className="md-msub">Roster down the side, strokes across the top. Cells show place, time (B best · BR record), DQ codes, comments.</div></div><button className="md-x" onClick={onClose}>✕</button></div>
        <div className="md-exwrap"><table className="md-extable"><thead><tr>{matrix[0].map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{matrix.slice(1).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j === 0 ? "nm" : ""}>{c}</td>)}</tr>)}{matrix.length === 1 && <tr><td colSpan={matrix[0].length} className="md-exempty">No {myTeam} entries yet.</td></tr>}</tbody></table></div>
        {msg && <div className="md-exmsg">{msg}</div>}
        <div className="md-mfoot"><button className="md-cancel" onClick={onClose}>Close</button><button className="md-ghost2" onClick={download}>Download CSV</button><button className="md-apply" onClick={copy}>Copy for Google Sheets</button></div>
      </div>
    </div>
  );
}

const CSS = `
* { box-sizing: border-box; }
html, body, #root { height: 100%; }
.md-root { --ink:#0a1628; --line:#1e3a5f; --cyan:#22d3ee; --muted:#7d93b0; --text:#e8f0fb; --sheet:#f4f7fb; --card:#fff; --sline:#e2e8f0; --sink:#0f2036; --dq:#ef4444; --amber:#f59e0b; --green:#10b981; --rec:#e0b400;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color:var(--sink); background:var(--sheet); height:100vh; display:flex; flex-direction:column; overflow:hidden; -webkit-font-smoothing:antialiased; }
.md-lanenum,.md-timein,.md-timeout,.md-stime,.md-tspts,.md-restime { font-variant-numeric:tabular-nums; }
.md-loginwrap { align-items:center; justify-content:center; padding:20px; }
.md-loginbox { width:100%; max-width:340px; display:flex; flex-direction:column; gap:12px; background:var(--card); border-radius:16px; padding:26px; box-shadow:0 24px 60px -14px rgba(6,14,28,.35); }
.md-loginlogo { font-size:22px; font-weight:800; }
.md-loginsub { font-size:13px; color:#64748b; margin-bottom:4px; }
.md-loginerr { font-size:12.5px; font-weight:700; color:var(--dq); }
.md-top { display:flex; align-items:center; gap:14px; padding:8px 14px; background:var(--ink); color:var(--text); border-bottom:1px solid var(--line); flex:none; }
.md-logowrap { position:relative; flex:none; }
.md-logo { width:40px; height:40px; display:grid; place-items:center; font-size:25px; color:var(--ink); background:var(--cyan); border:none; border-radius:11px; font-weight:800; cursor:pointer; }
.md-logo:hover { background:#5fe3f5; }
.md-menuscrim { position:fixed; inset:0; z-index:30; }
.md-menu { position:absolute; top:48px; left:0; z-index:31; width:290px; max-height:76vh; overflow-y:auto; background:#fff; color:var(--sink); border-radius:14px; box-shadow:0 24px 60px -16px rgba(0,0,0,.5); padding:10px; display:flex; flex-direction:column; gap:8px; }
.md-menutitle { font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.1em; color:#94a3b8; padding:2px 2px 0; }
.md-mrow { display:flex; flex-direction:column; gap:4px; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.07em; color:#64748b; }
.md-mrow input, .md-mrow select { font-size:14px; font-weight:600; text-transform:none; letter-spacing:0; color:var(--sink); padding:8px 10px; border:1px solid var(--sline); border-radius:9px; background:#fff; }
.md-mrow input:disabled { background:#f1f5f9; color:#94a3b8; }
.md-mdiv { height:1px; background:var(--sline); margin:2px 0; }
.md-mbtn { text-align:left; padding:10px 12px; border-radius:9px; border:1px solid var(--sline); background:#fff; font-weight:700; font-size:13.5px; cursor:pointer; color:var(--sink); }
.md-mbtn.danger { border-color:#fecaca; color:#b42318; } .md-mbtn.danger:hover { background:#fef2f2; }
.md-mbtn:hover { background:#f1f5f9; } .md-mbtn.primary { background:var(--cyan); border-color:var(--cyan); color:#062a33; }
.md-mbtn.sm { padding:6px 10px; font-size:12px; }
.md-reldeltaline { display:flex; align-items:center; gap:6px; margin-top:4px; flex-wrap:wrap; }
.md-reldeltalabel { font-size:11px; font-weight:700; color:var(--muted); }
.md-acctrow { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:12.5px; color:#64748b; }
.md-strip { display:flex; align-items:center; gap:8px; flex-wrap:wrap; overflow-x:auto; }
.md-strip.dual { gap:14px; }
.md-tscore { display:inline-flex; align-items:center; gap:6px; background:#0c1c33; border:1px solid var(--line); border-radius:10px; padding:5px 10px; font:inherit; color:inherit; cursor:pointer; }
.md-tscore:hover { border-color:var(--cyan); }
.md-tscore.big { padding:7px 14px; border-radius:12px; }
.md-tsdot { width:10px; height:10px; border-radius:50%; }
.md-tscode { font-weight:800; font-size:12.5px; } .md-tscore.big .md-tscode { font-size:15px; }
.md-tspts { font-weight:800; font-size:18px; color:var(--cyan); } .md-tscore.big .md-tspts { font-size:25px; }
.md-tspct { display:flex; flex-direction:column; align-items:flex-end; line-height:1; font-weight:800; font-size:11.5px; color:var(--green); }
.md-tspct small { color:var(--muted); font-size:8.5px; } .md-vs { color:var(--muted); font-weight:800; font-size:12px; }

.md-grid { flex:1; min-height:0; display:grid; grid-template-columns:400px 1fr; gap:12px; padding:12px; }
.md-left { min-height:0; overflow-y:auto; overflow-x:hidden; display:flex; flex-direction:column; gap:8px; }
.md-eyebrow { text-transform:uppercase; letter-spacing:.12em; font-size:9.5px; font-weight:800; color:var(--muted); }
.md-eyebrow.gold { color:var(--rec); }
.md-panel { background:var(--ink); border:1px solid var(--line); border-radius:13px; overflow:hidden; display:flex; flex-direction:column; min-height:0; }
.md-panel.od { flex:none; max-height:118px; overflow:hidden; }
.md-panel.water { flex:none; border-color:#1f6b7d; box-shadow:0 0 0 1px rgba(34,211,238,.25) inset; }
.md-panel.water.grow { flex:none; }
.md-panel.water .md-lanes { overflow:visible; }
.md-panel.prev { flex:1 1 auto; min-height:76px; }
.md-panel.prev .md-lanes { flex:1 1 auto; min-height:0; }
.md-panel.results { flex:none; max-height:30vh; border-color:#6b5b13; box-shadow:0 0 0 1px rgba(224,180,0,.2) inset; }
.md-phead { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:7px 11px; background:linear-gradient(180deg,#122b4d,#0d2038); border-bottom:1px solid var(--line); flex:none; }
.water-e { color:var(--cyan); } .md-pmeta { color:var(--muted); font-size:11.5px; font-weight:700; text-align:right; }
.md-splitsdot { display:inline-block; width:18px; height:18px; margin-right:7px; border-radius:50%; background:#2563eb; border:none; padding:0; cursor:pointer; vertical-align:middle; box-shadow:0 0 0 4px rgba(37,99,235,.18); }
.md-splitsdot:hover { background:#1d4ed8; }
.md-splitsdot.static { background:var(--cyan); box-shadow:none; cursor:default; width:14px; height:14px; }
.md-waterhead { display:flex; align-items:center; gap:8px; }
.md-waterstack { display:flex; flex-direction:column; align-items:flex-start; gap:1px; }
.md-raceclock { flex:none; width:fit-content; margin:0; padding:1px 8px; font-family:ui-monospace,"SF Mono",Menlo,monospace; font-size:13px; font-weight:800; letter-spacing:.04em; color:var(--cyan); background:#0a1a2e; border-radius:5px; }
.md-raceclock.stopped { color:var(--green); }
.md-pnav { display:flex; align-items:center; gap:7px; }
.md-pnav button { width:26px; height:26px; border-radius:7px; border:1px solid var(--line); background:#0c1c33; color:var(--text); font-size:16px; line-height:1; cursor:pointer; }
.md-pnav button:disabled { opacity:.3; } .md-pnav button:hover:not(:disabled){ border-color:var(--cyan); }
.md-lanes { padding:4px; display:flex; flex-direction:column; gap:2px; overflow-y:auto; }
.md-lanes.noscroll { overflow:visible; }
.md-lane { display:grid; grid-template-columns:26px 1fr auto 80px; align-items:center; gap:8px; padding:4px 8px; border-radius:8px; color:var(--text); background:#0c1c33; border:1px solid transparent; }
.md-lane.mine { cursor:pointer; } .md-lane.mine:hover { background:#112741; }
.md-lane.sel { border-color:var(--cyan); background:#102b47; } .md-lane.dq { background:#2a1116; } .md-lane.dq.sel { border-color:var(--dq); }
.md-lane.empty { opacity:.35; } .md-emptytxt { color:var(--muted); }
.md-lanenum { width:26px; height:26px; display:grid; place-items:center; font-weight:800; font-size:13px; background:#0a1628; border:1px solid var(--line); border-radius:7px; }
.md-laneid { display:flex; flex-direction:column; min-width:0; line-height:1.15; }
.md-laneswimmer { font-weight:700; font-size:12.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; gap:5px; }
.md-laneteam { font-size:9.5px; font-weight:700; }
.md-splitrow2 { display:flex; gap:3px; margin-top:3px; }
.md-splitbox { width:38px; height:20px; border-radius:5px; border:1px solid var(--line); background:#0a1628; color:var(--text); font-size:10px; padding:0 4px; text-align:center; }
.md-splitboxrow { display:flex; gap:6px; margin:2px 0 8px; }
.md-splitbox.lg { width:auto; flex:1; height:32px; border-radius:8px; border:1px solid var(--sline); background:#fff; color:var(--sink); font-size:13px; text-align:center; }
.md-tapbadge { background:#123049; color:var(--cyan); border:1px solid #1d5a78; font-size:9.5px; font-weight:800; padding:1px 6px; border-radius:6px; }
.md-lanemarks { display:flex; align-items:center; gap:4px; }
.md-place { background:#0b3a55; color:var(--cyan); border:1px solid #12557a; font-size:9.5px; font-weight:800; padding:1px 5px; border-radius:5px; }
.md-br { background:var(--rec); color:#3a2e00; font-size:9px; font-weight:900; padding:1px 4px; border-radius:4px; font-style:normal; }
.md-dqbadge { background:var(--dq); color:#fff; font-size:9.5px; font-weight:800; padding:1px 6px; border-radius:5px; white-space:nowrap; } .md-dqbadge.sm { font-size:9px; }
.md-tagcount { min-width:17px; height:17px; padding:0 4px; display:grid; place-items:center; background:var(--amber); color:#3a2600; font-size:10px; font-weight:800; border-radius:6px; }
.md-timewrap { display:flex; align-items:center; justify-content:flex-end; gap:4px; }
.md-best { background:var(--green); color:#04241a; font-size:10px; font-weight:900; width:16px; height:16px; display:grid; place-items:center; border-radius:4px; font-style:normal; }
.md-best.sm { width:15px; height:15px; }
.md-timein { width:64px; height:28px; text-align:center; border-radius:7px; border:1px solid var(--line); background:#0a1628; color:var(--cyan); font-weight:700; font-size:12.5px; }
.md-timein:focus { outline:2px solid var(--cyan); outline-offset:1px; } .md-timeout { color:var(--cyan); font-weight:700; font-size:12.5px; }
.md-odlist { padding:6px; display:flex; flex-wrap:wrap; gap:4px; }
.md-odstrip { padding:5px; }
.md-odstrip.all { display:flex; gap:3px; }
.md-odcard { flex:1 1 0; min-width:0; box-sizing:border-box; display:flex; flex-direction:column; gap:1px; padding:6px 10px; background:#0c1c33; border:none; color:var(--text); text-align:left; cursor:pointer; border-radius:7px; }
.md-odcard.mine { box-shadow:inset 3px 0 0 #facc15; }
.md-odcard.sm { padding:4px 6px; gap:0; }
.md-odcard.sm .md-odcname { font-size:11px; }
.md-odcard.sm .md-odcteam, .md-odcard.sm .md-odcseed { font-size:9px; }
.md-odcard:hover { background:#112741; }
.md-odlane { font-size:11px; font-weight:900; color:var(--cyan); }
.md-odcname { font-size:12.5px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.md-odcteam { font-size:10px; font-weight:700; white-space:nowrap; }
.md-odcseed { font-size:10px; color:var(--muted); font-variant-numeric:tabular-nums; }
.md-odempty { padding:12px; color:var(--muted); font-size:12px; }
.md-odchip { background:#0c1c33; border:1px solid var(--line); color:var(--text); font-size:10.5px; padding:3px 7px; border-radius:14px; }
.md-odchip.mine { border-color:var(--cyan); background:#102b47; }
.md-odchip b { color:var(--muted); margin-right:3px; } .md-odchip i { font-style:normal; font-weight:700; margin-left:3px; }

.md-reslist { display:flex; flex-direction:column; gap:2px; padding:4px; overflow-y:auto; }
.md-resrow { display:grid; grid-template-columns:38px 1fr auto auto 34px; align-items:center; gap:8px; padding:4px 8px; border:none; border-radius:8px; background:#0c1c33; color:var(--text); text-align:left; cursor:pointer; }
.md-resrow.mine:hover { background:#112741; } .md-resrow.locked { cursor:default; opacity:.62; }
.md-resplace { font-weight:900; font-size:11px; color:var(--muted); background:#0a1628; border:1px solid var(--line); border-radius:6px; padding:2px 0; text-align:center; }
.md-resplace.p1 { color:#3a2e00; background:var(--rec); border-color:var(--rec); }
.md-resplace.p2 { color:#1c2430; background:#c8d3e0; border-color:#c8d3e0; }
.md-resplace.p3 { color:#3a2007; background:#d98c4a; border-color:#d98c4a; }
.md-resname { font-weight:700; font-size:12.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.md-resteam { font-size:10px; font-weight:800; }
.md-restime { font-weight:800; font-size:12.5px; color:var(--cyan); display:flex; align-items:center; gap:4px; }
.md-respts { font-weight:800; font-size:11px; color:var(--green); text-align:right; }

.md-phead.clickable { width:100%; text-align:left; border:none; cursor:pointer; }
.md-phead.clickable:hover { background:linear-gradient(180deg,#16345c,#0f2544); }
.md-chev { font-style:normal; color:var(--cyan); margin-left:7px; }

.md-ticker { flex:none; background:var(--ink); border-bottom:1px solid var(--line); color:var(--text); overflow:hidden; touch-action:pan-y; }
.md-ticker.empty { display:flex; align-items:center; gap:10px; padding:9px 14px; }
.md-tickempty { color:var(--muted); font-size:12px; font-weight:600; }
.md-tickhead { display:flex; align-items:center; gap:10px; padding:7px 12px 5px; }
.md-tickev { font-weight:800; font-size:12px; color:var(--text); flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.md-ticknav { display:flex; align-items:center; gap:6px; }
.md-ticknav button { width:24px; height:24px; border-radius:6px; border:1px solid var(--line); background:#0c1c33; color:var(--text); font-size:14px; line-height:1; cursor:pointer; }
.md-ticknav button:disabled { opacity:.3; } .md-ticknav button:hover:not(:disabled) { border-color:var(--cyan); }
.md-tickpos { color:var(--muted); font-size:10px; font-weight:800; }
.md-tickwin { overflow:hidden; margin:0 8px 8px; border-radius:9px; }
.md-tickroll { display:flex; flex-direction:column; transition:transform .45s ease; }
.md-tickrow { display:grid; grid-template-columns:38px 1fr auto auto 34px; align-items:center; gap:8px; padding:0 8px; border:none; background:#0c1c33; color:var(--text); text-align:left; cursor:pointer; border-bottom:1px solid #0a1628; }
.md-tickrow.mine:hover { background:#112741; } .md-tickrow.locked { cursor:default; opacity:.62; }

.md-seed { font-style:normal; color:#94a3b8; font-weight:700; margin-left:8px; }
.md-delta { font-weight:900; font-size:11.5px; padding:2px 7px; border-radius:6px; font-variant-numeric:tabular-nums; }
.md-delta.neg { background:#dcfce7; color:#166534; }
.md-delta.pos { background:#fee2e2; color:#b42318; }
.md-delta.sm { font-size:9.5px; padding:1px 5px; }

.md-right { min-height:0; background:var(--card); border:1px solid var(--sline); border-radius:13px; display:flex; flex-direction:column; overflow:hidden; }
.md-sheethead { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:9px 14px; border-bottom:1px solid var(--sline); background:#fbfdff; flex:none; }
.md-jump { display:inline-flex; align-items:center; gap:5px; background:var(--cyan); color:#062a33; border:none; border-radius:8px; padding:7px 12px; font-weight:800; font-size:12.5px; cursor:pointer; white-space:nowrap; }
.md-jump:hover { background:#5fe3f5; }
.md-jumpwrap { display:flex; align-items:center; gap:6px; }
.md-eventjump { display:flex; align-items:center; gap:2px; background:#fff; border:1px solid var(--sline); border-radius:8px; padding:2px; }
.md-eventjump button { width:22px; height:24px; display:grid; place-items:center; border:none; background:transparent; border-radius:5px; font-size:10px; color:#475569; cursor:pointer; }
.md-eventjump button:hover:not(:disabled) { background:#f1f5f9; color:#0e7490; }
.md-eventjump button:disabled { opacity:.3; cursor:default; }
.md-eventjump input { width:74px; height:24px; border:none; text-align:center; font-size:12px; font-weight:700; color:var(--sink); background:transparent; }
.md-eventjump input:focus { outline:none; }
.md-jumpgo { background:#0f2036; color:#fff; border:none; border-radius:8px; padding:7px 10px; font-weight:800; font-size:12px; cursor:pointer; }
.md-jumpgo:hover { background:#1a3050; }
.md-sheet { flex:1; min-height:0; overflow-y:auto; padding:8px; scroll-behavior:smooth; }
.md-evblock { margin-bottom:12px; border-radius:12px; }
.md-evblock.curev { outline:2px solid var(--cyan); outline-offset:2px; background:#f4fbff; }
.md-evname { font-weight:800; font-size:13.5px; color:var(--sink); padding:8px 8px 4px; display:flex; align-items:center; gap:8px; }
.md-evnum { color:#94a3b8; }
.md-nowpill { background:var(--cyan); color:#08303a; font-size:9.5px; font-weight:900; padding:2px 8px; border-radius:14px; letter-spacing:.05em; }
.md-evcat { margin-left:auto; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:#0e7490; background:#e0f2fe; padding:2px 8px; border-radius:16px; }
.md-recordrow { display:flex; align-items:center; gap:8px; padding:0 8px 8px; }
.md-reclabel { font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; color:#a8842a; background:#fdf6e3; border:1px solid #f2e3b3; padding:3px 8px; border-radius:6px; }
.md-recinput { width:110px; font-size:12.5px; font-weight:700; color:#7a611a; padding:4px 8px; border:1px solid var(--sline); border-radius:7px; background:#fff; font-variant-numeric:tabular-nums; }
.md-recinput:focus { outline:2px solid var(--rec); outline-offset:1px; }
.md-heat { border:1px solid var(--sline); border-radius:11px; overflow:hidden; margin:0 4px 8px; background:#fff; }
.md-heat.cur { border-color:var(--cyan); box-shadow:0 0 0 1px var(--cyan) inset; }
.md-heatbar { width:100%; display:flex; align-items:center; justify-content:space-between; padding:7px 12px; background:#eef4fb; border:none; border-bottom:1px solid var(--sline); font-weight:700; font-size:12px; color:#334155; cursor:pointer; }
.md-heatbar:hover { background:#e3edf9; }
.md-curpill { background:var(--cyan); color:#08303a; font-size:10px; font-weight:800; padding:2px 8px; border-radius:16px; }
.md-srowwrap { border-bottom:1px solid #eef2f7; } .md-srowwrap:last-child { border-bottom:none; }
.md-srowwrap.relay { background:#fafcff; }
.md-swim { width:100%; display:grid; grid-template-columns:26px 1fr auto; align-items:center; gap:10px; padding:9px 12px; background:transparent; border:none; cursor:pointer; text-align:left; }
.md-swim:hover { background:#f7fafd; } .md-swim.sel { background:#eaf6ff; box-shadow:inset 3px 0 0 var(--cyan); }
.md-swim.locked { cursor:default; opacity:.5; } .md-swim.locked:hover { background:transparent; } .md-swim.dq { background:#fef4f4; }
.md-slane { font-size:13px; font-weight:800; color:#64748b; text-align:center; }
.md-sid { display:flex; flex-direction:column; min-width:0; }
.md-sname { font-weight:700; font-size:14px; color:var(--sink); display:flex; align-items:center; gap:6px; } .md-steam { font-size:10.5px; font-weight:800; }
.md-smeta { display:flex; align-items:center; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
.md-minitag { background:#fff7e6; color:#a15c00; border:1px solid #fde3ac; font-size:10px; font-weight:700; padding:2px 7px; border-radius:6px; max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.md-more { color:#94a3b8; font-size:10.5px; font-weight:800; }
.md-stime { font-weight:800; font-size:14px; color:#0e7490; }
.md-relayswim { display:flex; flex-wrap:wrap; gap:6px 14px; padding:0 12px 9px 48px; }
.md-rswim { font-size:11.5px; color:#64748b; } .md-rswim b { color:#94a3b8; margin-right:3px; }

.md-povscrim { position:fixed; inset:0; z-index:60; }
.md-pov { position:fixed; z-index:61; width:320px; max-height:74vh; overflow-y:auto; background:#fff; border-radius:14px; box-shadow:0 24px 60px -14px rgba(6,14,28,.55); border:1px solid var(--sline); padding:12px; }
.md-caret { position:absolute; top:-8px; width:16px; height:16px; background:#fff; border-left:1px solid var(--sline); border-top:1px solid var(--sline); transform:rotate(45deg); }
.md-attndpov { position:fixed; z-index:71; width:280px; max-height:70vh; overflow-y:auto; background:#fff; border-radius:14px; box-shadow:0 24px 60px -14px rgba(6,14,28,.55); border:1px solid var(--sline); padding:12px; }
.md-attndsub { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:11px; font-weight:800; color:#64748b; margin-bottom:6px; }
.md-attndreset { border:none; background:none; color:#0e7490; font-size:11px; font-weight:800; cursor:pointer; padding:0; text-decoration:underline; }
.md-attndreset:hover { color:#0a5a6e; }
.md-attndsearch { width:100%; padding:8px 10px; border-radius:9px; border:1px solid var(--sline); font-size:13px; margin-bottom:8px; }
.md-attndlist { display:flex; flex-direction:column; gap:2px; }
.md-attndrow { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 4px; font-size:13px; font-weight:700; color:var(--sink); }
.md-attndrow em { font-style:normal; color:#94a3b8; font-weight:600; margin-left:2px; }
.md-attndname { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.md-attndtoggle { position:relative; flex:none; width:88px; height:28px; border-radius:14px; background:#eef2f7; border:1px solid var(--sline); cursor:pointer; user-select:none; }
.md-attndthumb { position:absolute; top:1px; left:1px; width:42px; height:24px; border-radius:12px; background:#10b981; transition:transform .15s ease, background .15s ease; }
.md-attndthumb.no { transform:translateX(42px); background:#ef4444; }
.md-attndseg { position:relative; z-index:1; display:inline-flex; align-items:center; justify-content:center; width:44px; height:26px; font-size:10.5px; font-weight:800; color:#94a3b8; }
.md-attndseg.on { color:#fff; }
.md-povhead { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin-bottom:10px; }
.md-povname { font-weight:800; font-size:16px; display:flex; align-items:center; gap:7px; }
.md-povnamelink { border:none; background:none; padding:0; font:inherit; color:inherit; cursor:pointer; text-decoration:none; }
.md-povnamelink:hover, .md-povnamelink:focus, .md-povnamelink:active { text-decoration:none; outline:none; }
.md-agechip { border:none; background:#eef4fb; color:#33608a; font:inherit; font-size:11px; font-weight:800; padding:2px 7px; border-radius:16px; cursor:pointer; text-decoration:none; }
.md-agechip:hover, .md-agechip:focus, .md-agechip:active { text-decoration:none; outline:none; }
.md-agechip:hover { background:#dbeafe; }
.md-povmeta { font-size:12px; color:#64748b; margin-top:1px; }
.md-agepov { position:fixed; z-index:61; width:270px; max-height:60vh; overflow-y:auto; background:#fff; border-radius:14px; box-shadow:0 24px 60px -14px rgba(6,14,28,.55); border:1px solid var(--sline); padding:10px; }
.md-agepovhead { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px; font-weight:800; font-size:13.5px; }
.md-agepovhead em { font-style:normal; font-size:11px; font-weight:800; margin-left:4px; }
.md-agepovlist { display:flex; flex-direction:column; gap:2px; }
.md-agepovrow { display:flex; align-items:center; gap:8px; padding:6px 7px; border-radius:8px; border:none; background:none; text-align:left; font-size:13px; font-weight:700; cursor:pointer; color:var(--sink); width:100%; }
.md-agepovrow:hover { background:#f1f5f9; }
.md-agepovrank { width:16px; flex:none; font-size:11px; font-weight:800; color:#94a3b8; }
.md-agepovteam { font-size:10.5px; font-weight:800; padding:1px 6px; border-radius:10px; color:#fff; }
.md-agepovpower { margin-left:auto; font-size:11.5px; font-weight:800; color:var(--cyan); }
.md-profilepov { position:fixed; z-index:61; width:300px; max-height:70vh; overflow-y:auto; background:#fff; border-radius:14px; box-shadow:0 24px 60px -14px rgba(6,14,28,.55); border:1px solid var(--sline); padding:12px; }
.md-profilestats { display:flex; gap:8px; margin-bottom:10px; }
.md-profilestats .md-lgstat { flex:1; background:#f8fafc; border-radius:9px; padding:8px; text-align:center; }
.md-finalizepanel { position:fixed; z-index:55; top:64px; right:14px; width:290px; max-height:70vh; overflow-y:auto; background:#fff; border-radius:14px; box-shadow:0 24px 60px -14px rgba(6,14,28,.55); border:1px solid var(--sline); padding:10px; }
.md-finalizepanel .md-agepovrow { flex-direction:column; align-items:flex-start; gap:1px; }
.md-finalizemeta { font-size:10.5px; font-weight:600; color:#94a3b8; }
.md-x { width:34px; height:34px; border-radius:9px; border:1px solid var(--sline); background:#fff; font-size:15px; cursor:pointer; flex:none; } .md-x.sm { width:28px; height:28px; font-size:13px; } .md-x:hover { background:#f1f5f9; }
.md-dq { width:100%; padding:12px; border-radius:11px; border:2px solid var(--dq); background:#fff; color:var(--dq); font-weight:800; font-size:14px; cursor:pointer; margin-bottom:10px; text-align:left; line-height:1.3; }
.md-dq:hover { background:#fef2f2; } .md-dq.on { background:var(--dq); color:#fff; }
.md-dq.pend { border-color:var(--amber); color:#92600a; background:#fff7e6; }
.md-povtags { display:flex; flex-direction:column; gap:6px; }
.md-catbtn { width:100%; display:flex; align-items:center; gap:9px; padding:10px 11px; border-radius:10px; border:1.5px solid var(--sline); background:#fff; font-weight:700; font-size:13.5px; color:#334155; cursor:pointer; }
.md-catbtn:hover { border-color:#94a3b8; } .md-catbtn.has { background:#fbfdff; }
.md-catdot { width:9px; height:9px; border-radius:50%; flex:none; } .md-catnum { color:#fff; font-size:11px; font-weight:800; padding:1px 7px; border-radius:16px; } .md-cc { margin-left:auto; color:#94a3b8; }
.md-subs { display:flex; flex-wrap:wrap; gap:6px; padding:8px 2px 4px; }
.md-sub { padding:7px 10px; border-radius:8px; border:1.5px solid var(--sline); background:#fff; color:#334155; font-weight:600; font-size:12.5px; cursor:pointer; }
.md-sub:hover { border-color:#94a3b8; } .md-sub.on { color:#fff; }

.md-scrim { position:fixed; inset:0; background:rgba(6,14,28,.6); backdrop-filter:blur(2px); display:grid; place-items:center; padding:16px; z-index:50; overscroll-behavior:contain; }
.md-modal { position:relative; background:#fff; border-radius:18px; width:min(680px,96vw); max-height:92vh; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 30px 80px -20px rgba(0,0,0,.5); }
.md-imp { width:min(940px,96vw); }
.md-mhead { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:16px 18px; border-bottom:1px solid var(--sline); }
.md-mheadtxt { flex:1; min-width:0; }
.md-logo.sm { width:30px; height:30px; font-size:17px; border-radius:8px; flex:none; }
.md-mtitle { font-weight:800; font-size:17px; } .md-msub { font-size:12.5px; color:#64748b; margin-top:2px; }
.md-warn { margin:14px 18px 0; border-radius:12px; padding:12px 14px; font-size:13.5px; line-height:1.5; }
.md-warn.red { background:#fef2f2; border:1px solid #fecaca; color:#b42318; }
.md-warn.amber { background:#fffbeb; border:1px solid #fde68a; color:#92600a; }
.md-dqpov { position:fixed; z-index:61; width:340px; max-height:78vh; display:flex; flex-direction:column; overflow:hidden; background:#fff; border-radius:14px; box-shadow:0 24px 60px -14px rgba(6,14,28,.55); border:1px solid var(--sline); }
.md-dqpov .md-agepovhead { padding:12px 14px 0; }
.md-dqpovsub { padding:2px 14px 8px; font-size:11.5px; font-weight:700; color:#64748b; }
.md-dqpov .md-warn { margin:0 14px 8px; }
.md-dqpov .md-nsbtn { margin-left:14px; margin-right:14px; width:calc(100% - 28px); }
.md-dqpovfoot { display:flex; gap:8px; padding:10px 14px; border-top:1px solid var(--sline); }
.md-codes { flex:1; min-height:0; overflow-y:auto; padding:14px 18px; }
.md-cgroup { margin-bottom:14px; } .md-cglabel { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.1em; color:#64748b; margin-bottom:7px; }
.md-cgrid { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:7px; }
.md-code { display:flex; align-items:center; gap:8px; text-align:left; padding:9px 10px; border-radius:9px; border:1px solid var(--sline); background:#fff; cursor:pointer; } .md-code:hover { border-color:var(--dq); background:#fff6f6; }
.md-code.on { border-color:var(--dq); background:var(--dq); } .md-code.on .md-creason,.md-code.on .md-ccode { color:#fff; }
.md-ccode { font-weight:900; font-size:12px; color:var(--dq); background:#fef2f2; border-radius:6px; padding:2px 6px; flex:none; } .md-code.on .md-ccode { background:rgba(255,255,255,.2); }
.md-creason { font-size:12.5px; font-weight:600; color:#334155; line-height:1.25; }
.md-mfoot { display:flex; justify-content:flex-end; gap:8px; padding:12px 18px; border-top:1px solid var(--sline); flex-wrap:wrap; }
.md-clear { padding:10px 14px; border-radius:9px; border:1.5px solid var(--dq); background:#fff; color:var(--dq); font-weight:800; font-size:13px; cursor:pointer; margin-right:auto; }
.md-cancel { padding:10px 14px; border-radius:9px; border:1px solid var(--sline); background:#fff; color:#334155; font-weight:700; font-size:13px; cursor:pointer; }
.md-apply { padding:10px 16px; border-radius:9px; border:none; background:var(--cyan); color:#062a33; font-weight:800; font-size:13px; cursor:pointer; } .md-apply:disabled { opacity:.4; cursor:default; }
.md-ghost2 { padding:10px 14px; border-radius:9px; border:1px solid var(--sline); background:#fff; color:#0e7490; font-weight:800; font-size:13px; cursor:pointer; }
.md-impbar { display:flex; align-items:center; gap:10px; padding:12px 18px 0; }
.md-filebtn { background:#0f2036; color:#fff; padding:8px 14px; border-radius:9px; font-weight:700; font-size:13px; cursor:pointer; } .md-impnote { font-size:12px; color:#94a3b8; }
.md-impgrid { display:grid; grid-template-columns:1fr 1fr; min-height:0; flex:1; margin-top:12px; }
@media (max-width:720px){ .md-impgrid{ grid-template-columns:1fr; } }
.md-imparea { border:none; border-top:1px solid var(--sline); border-right:1px solid var(--sline); padding:14px 16px; font-size:13px; font-family:ui-monospace,Menlo,monospace; resize:none; min-height:280px; line-height:1.5; }
.md-imparea:focus { outline:none; background:#fbfdff; }
.md-preview { display:flex; flex-direction:column; min-height:0; background:#f8fafc; border-top:1px solid var(--sline); }
.md-prevtop { display:flex; align-items:center; justify-content:space-between; padding:10px 14px; border-bottom:1px solid var(--sline); font-size:12px; font-weight:700; color:#475569; }
.md-impdqnote { color:#b42318; }
.md-ctl { display:flex; align-items:center; gap:6px; font-size:10.5px; color:#64748b; font-weight:700; text-transform:uppercase; }
.md-ctl select { background:#fff; color:#0f2036; border:1px solid var(--sline); border-radius:8px; padding:6px 8px; font-size:13px; font-weight:700; }
.md-prevbody { overflow-y:auto; padding:10px 14px; }
.md-prevempty { color:#94a3b8; font-size:12.5px; line-height:1.55; }
.md-prevev { margin-bottom:10px; } .md-prevevname { font-weight:800; font-size:12.5px; color:#0f2036; margin-bottom:4px; } .md-prevevname em { color:#a8842a; font-style:normal; font-weight:700; }
.md-prevheat { margin:0 0 6px 6px; } .md-prevheatn { font-size:10.5px; font-weight:700; color:#94a3b8; text-transform:uppercase; }
.md-prevlane { display:grid; grid-template-columns:22px 1fr auto auto auto; gap:8px; font-size:12px; padding:3px 0; color:#475569; }
.md-prevlane.mine { color:#0e7490; font-weight:700; }
.md-exwrap { overflow:auto; padding:10px 14px; }
.md-extable { border-collapse:collapse; width:100%; font-size:12px; }
.md-extable th { position:sticky; top:0; background:#0f2036; color:#fff; text-align:left; padding:8px 10px; font-size:11px; text-transform:uppercase; white-space:nowrap; }
.md-extable td { border:1px solid var(--sline); padding:7px 10px; vertical-align:top; color:#334155; min-width:120px; }
.md-extable td.nm { font-weight:800; color:#0f2036; background:#f8fafc; white-space:nowrap; position:sticky; left:0; }
.md-exempty { text-align:center; color:#94a3b8; padding:22px; }
.md-exmsg { margin:0 18px; padding:10px 12px; background:#ecfeff; border:1px solid #a5f3fc; color:#0e7490; border-radius:10px; font-size:13px; font-weight:600; }
.md-lane.mine { box-shadow:inset 3px 0 0 #facc15; } .md-swim.mine { box-shadow:inset 3px 0 0 #facc15; }
.md-povteam { font-size:11px; font-weight:800; margin-left:6px; }
.md-splitbtn { width:100%; margin-top:8px; padding:9px; border-radius:9px; border:1.5px solid var(--sline); background:#fff; color:#0e7490; font-weight:800; font-size:13px; cursor:pointer; }
.md-splitbtn.on { background:#ecfeff; border-color:#67e8f9; }
.md-notearea { width:100%; min-height:62px; margin-top:8px; resize:vertical; border-radius:10px; border:1px solid #cfe0f2; background:#fff; padding:9px 11px; font-size:13.5px; font-family:inherit; color:var(--sink); line-height:1.4; }
.md-notearea.one { min-height:0; height:38px; }
.md-notearea:focus { outline:2px solid var(--cyan); outline-offset:1px; border-color:var(--cyan); }
.md-relaysplitread { margin-top:6px; font-size:13px; color:#0e7490; background:#ecfeff; border:1px solid #a5f3fc; border-radius:8px; padding:6px 10px; }
.md-relaysplitread b { font-variant-numeric:tabular-nums; }
.md-otherteam { font-size:12.5px; color:#64748b; background:#f8fafc; border:1px solid var(--sline); border-radius:10px; padding:10px 12px; line-height:1.5; }

.md-splitpanel { position:fixed; z-index:45; display:flex; flex-direction:column; overflow:hidden; background:#0a1628; border:1px solid var(--line); border-radius:16px; box-shadow:0 30px 80px -20px rgba(0,0,0,.6); }
.md-splithead { display:flex; align-items:center; justify-content:space-between; padding:12px 14px; color:var(--text); font-weight:800; font-size:14px; border-bottom:1px solid var(--line); background:linear-gradient(180deg,#122b4d,#0d2038); }
.md-splitstandings { display:flex; flex-wrap:wrap; gap:8px; padding:8px 14px; background:#0c1c33; border-bottom:1px solid var(--line); font-size:12.5px; color:#9fb3cc; }
.md-standingchip { display:inline-flex; align-items:center; gap:4px; }
.md-standingchip.mine { background:rgba(56,224,255,.12); border:1px solid rgba(56,224,255,.35); border-radius:16px; padding:2px 9px; color:var(--cyan); }
.md-splitgrid { padding:12px; display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:10px; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; }
.md-splitcard { background:#0c1c33; border:1px solid var(--line); border-radius:12px; padding:10px; }
.md-splitcard.mine { box-shadow:inset 3px 0 0 #facc15; }
.md-splitcardhead { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
.md-splitlane { font-size:11px; font-weight:800; color:var(--muted); }
.md-splitteam { font-weight:800; font-size:13px; flex:1; }
.md-splittime { width:70px; height:28px; text-align:center; border-radius:7px; border:1px solid var(--line); background:#0a1628; color:var(--cyan); font-weight:700; font-size:12.5px; }
.md-legs { display:flex; flex-direction:column; gap:3px; }
.md-leg { display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:8px; border:1px solid transparent; background:#0a1628; color:var(--text); }
.md-legnote { flex:none; width:24px; height:24px; border-radius:6px; border:1px solid var(--line); background:#0c1c33; color:var(--cyan); font-size:12px; cursor:pointer; }
.md-legnote:hover { border-color:var(--cyan); }
.md-mixtag { font-size:12px; font-weight:800; color:#7c3aed; background:#f3e8ff; border:1px solid #ddd6fe; padding:6px 12px; border-radius:9px; }
.md-gtick { font-style:normal; font-weight:900; font-size:9px; color:#fff; padding:1px 4px; border-radius:4px; margin-right:4px; }
.md-gtick.girls { background:#ec4899; } .md-gtick.boys { background:#3b82f6; }
.md-ttlabel { font-weight:800; font-size:14px; color:var(--cyan); }
.md-legnum { width:18px; height:18px; display:grid; place-items:center; font-size:10px; font-weight:800; border-radius:5px; background:#0c1c33; border:1px solid var(--line); flex:none; }
.md-legname { font-size:12px; font-weight:600; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.md-nextleg { flex:none; width:100%; margin-top:8px; padding:8px 10px; border-radius:8px; border:1px solid var(--line); background:#0e2c3a; color:var(--cyan); font-weight:800; font-size:12px; cursor:pointer; }
.md-nextleg.tap { background:var(--cyan); color:#062a33; border-color:var(--cyan); }

.md-teamsel { display:flex; gap:5px; flex-wrap:wrap; margin-left:auto; }
.md-teamchip { padding:5px 10px; border-radius:16px; border:1.5px solid var(--sline); background:#fff; color:#475569; font-weight:800; font-size:12px; cursor:pointer; }

.md-statwrap { display:grid; grid-template-columns:1fr 1fr; gap:0; overflow:hidden; flex:1; min-height:0; }
@media (max-width:720px){ .md-statwrap { grid-template-columns:1fr; overflow-y:auto; } }
.md-tsmodal { max-width:900px; }
.md-tsbanner { padding:18px 20px; color:#fff; display:flex; flex-direction:column; gap:12px; }
.md-tsbannertop { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.md-tsbannerteam { font-size:22px; font-weight:900; }
.md-statsfilterbtn { padding:7px 14px; border-radius:9px; border:1px solid rgba(255,255,255,.35); background:rgba(255,255,255,.12); color:#fff; font-weight:800; font-size:12.5px; cursor:pointer; }
.md-statsfilterbtn:hover { background:rgba(255,255,255,.2); }
.md-statsfilterbtn.on { background:#fff; color:#0f2036; border-color:#fff; }
.md-statsfilterpanel { display:flex; flex-direction:column; gap:8px; padding:12px 20px; border-bottom:1px solid var(--sline); background:#f8fafc; }
.md-statcol { overflow-y:auto; overscroll-behavior:contain; -webkit-overflow-scrolling:touch; padding:12px 16px; border-right:1px solid var(--sline); }
.md-statcol:last-child { border-right:none; }
.md-stath { font-weight:800; font-size:13px; margin-bottom:8px; color:var(--sink); position:sticky; top:0; background:#fff; padding-bottom:4px; }
.md-statrow { display:grid; grid-template-columns:auto 1fr auto auto; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #f1f5f9; }
.md-statrank { width:20px; text-align:center; font-weight:800; color:#94a3b8; font-size:12px; }
.md-statname { font-weight:700; font-size:13px; color:var(--sink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.md-statsub { font-size:11px; color:#94a3b8; }
.md-statval { font-weight:900; font-size:14px; } .md-statval.gold { color:#a8842a; } .md-statval.green { color:#166534; } .md-statval.red { color:#b42318; }
.md-agegrp { margin-bottom:10px; } .md-agehdr { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; color:#0e7490; margin:6px 0 2px; }
.md-gpill { width:18px; height:18px; display:grid; place-items:center; border-radius:50%; font-size:10px; font-weight:900; color:#fff; }
.md-gpill.girls { background:#ec4899; } .md-gpill.boys { background:#3b82f6; } .md-gpill.mixed { background:#8b5cf6; }
.md-gpill.sm { width:15px; height:15px; font-size:8.5px; flex:none; }
.md-statname.statid { display:inline-flex; align-items:center; gap:5px; }
.md-statage { font-style:normal; color:#94a3b8; font-weight:700; }

.md-rbctl { display:flex; gap:14px; padding:12px 18px; border-bottom:1px solid var(--sline); }
.md-rblist { overflow-y:auto; padding:10px 16px 12px; border-top:1px solid var(--sline); }
.md-rbteam { border:1px solid var(--sline); border-radius:12px; padding:10px 12px; margin-bottom:8px; }
.md-rbteam.mine { border-color:#facc15; box-shadow:0 0 0 1px #facc15 inset; background:#fffdf0; }
.md-rbhometeam { margin:0 18px 12px; }
.md-rbhometeamlabel { font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; color:#94a3b8; margin-bottom:4px; }
.md-rbteam.top { margin-bottom:0; }
.md-rbteam.locked { border-color:#0e7490; box-shadow:0 0 0 1px #0e7490 inset; }
.md-rblock { padding:4px 9px; border-radius:7px; border:1px solid var(--sline); background:#fff; color:#475569; font-weight:800; font-size:11px; cursor:pointer; }
.md-rblock.on { border-color:#0e7490; color:#0e7490; background:#ecfeff; }
.md-rbrevert { padding:4px 9px; border-radius:7px; border:1px dashed #7c3aed; background:#fff; color:#7c3aed; font-weight:800; font-size:11px; cursor:pointer; }
.md-rbrevert:hover { background:#f5f3ff; }
.md-rbhead { display:flex; align-items:center; gap:10px; margin-bottom:6px; }
.md-rbrank { width:22px; height:22px; display:grid; place-items:center; border-radius:6px; background:#0f2036; color:#fff; font-weight:900; font-size:12px; }
.md-rbteamname { font-weight:800; font-size:15px; flex:1; }
.md-rbtotal { font-weight:900; font-size:16px; color:#0e7490; font-variant-numeric:tabular-nums; }
.md-rbgap { font-size:11px; font-weight:800; color:#b42318; }
.md-rbswimmers { display:flex; flex-wrap:wrap; gap:6px 12px; }
.md-rbswim { font-size:12px; color:#475569; font-weight:600; } .md-rbswim em { color:#94a3b8; font-style:normal; font-variant-numeric:tabular-nums; }
.md-rbswim.doubleA-red { color:#b42318; font-weight:800; } .md-rbswim.doubleA-red em { color:#b42318; }
.md-rbswim.doubleA-yellow { color:#92600a; font-weight:800; } .md-rbswim.doubleA-yellow em { color:#92600a; }
.md-rbstroke { color:#0e7490; font-weight:800; margin-right:2px; }
.md-rbproj { font-size:11px; color:#0e7490; font-weight:700; margin-left:4px; }
.md-rbtabs { display:flex; gap:4px; background:#f1f5f9; border-radius:9px; padding:3px; }
.md-rbtab { padding:6px 12px; border-radius:7px; border:none; background:transparent; color:#475569; font-weight:800; font-size:12.5px; cursor:pointer; }
.md-rbtab.on { background:#fff; color:#0f2036; box-shadow:0 1px 3px rgba(0,0,0,.15); }
.md-rbedit { margin-left:auto; padding:4px 9px; border-radius:7px; border:1px solid var(--sline); background:#fff; color:#475569; font-weight:800; font-size:11px; cursor:pointer; }
.md-rbedit.on { border-color:#7c3aed; color:#7c3aed; background:#f5f3ff; }
.md-rbeditgrid { display:flex; flex-direction:column; gap:8px; margin-bottom:4px; }
.md-rbeditstroke { font-size:9.5px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:#0e7490; display:block; margin-bottom:3px; }
.md-rbreset { padding:6px; border-radius:8px; border:1px dashed var(--sline); background:#fff; color:#7c3aed; font-weight:700; font-size:11.5px; cursor:pointer; }
.md-rbdrag { background:#f8fafc; border:1px solid var(--sline); border-radius:10px; padding:10px; }
.md-rbdraglegs { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:8px; margin-bottom:10px; }
.md-rbdragleg { border:2px dashed transparent; border-radius:9px; padding:2px; transition:border-color .1s; }
.md-rbdragleg.over { border-color:#0e7490; background:#ecfeff; }
.md-rbdragleg.selectable { border-color:#cbd5e1; }
.md-rbchip { width:100%; display:flex; align-items:center; gap:5px; padding:8px 10px; border-radius:8px; border:1px solid var(--sline); background:#fff; font-weight:700; font-size:12.5px; color:var(--sink); cursor:grab; user-select:none; }
.md-rbchip:active, .md-rbchip.dragging { cursor:grabbing; opacity:.45; box-shadow:0 4px 10px rgba(0,0,0,.15); }
.md-rbchip.bench { background:#fff; border-style:dashed; color:#475569; font-weight:600; }
.md-rbchip.selected { border-color:#0e7490; border-width:2px; box-shadow:0 0 0 2px #ecfeff; }
.md-rbchip.doubleA-red { background:#fef2f2; border-color:#fecaca; color:#b42318; }
.md-rbchip.doubleA-yellow { background:#fffbeb; border-color:#fde68a; color:#92600a; }
.md-rbbenchlabel { font-size:10.5px; color:#94a3b8; font-weight:700; margin-bottom:6px; }
.md-rbbenchfilter { display:flex; gap:5px; margin-bottom:8px; }
.md-rbfilterbtn { padding:4px 10px; border-radius:14px; border:1.5px solid var(--sline); background:#fff; color:#475569; font-weight:800; font-size:11px; cursor:pointer; }
.md-rbfilterbtn.on { background:var(--sink); border-color:var(--sink); color:#fff; }
.md-rbbench { display:flex; flex-wrap:wrap; gap:6px; }
.md-rbbenchempty { font-size:12px; color:#94a3b8; }
.md-rbprob { display:flex; align-items:center; gap:8px; margin-top:6px; }
.md-rbprobbar { flex:1; height:8px; border-radius:5px; background:#eef2f7; overflow:hidden; }
.md-rbprobfill { height:100%; background:#10b981; }
.md-rbprobval { font-size:11px; font-weight:800; color:#166534; width:34px; text-align:right; }

.md-cmpmodal { max-width:900px; }
.md-cmpcheckgrp { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:2px 0; }
.md-cmpchecklabel { font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8; }
.md-cmpteamdot { display:inline-flex; align-items:center; gap:4px; font-size:11.5px; font-weight:800; color:var(--sink); cursor:pointer; }
.md-cmpteamdot input { display:none; }
.md-cmpteamcircle { width:14px; height:14px; border-radius:50%; border:2px solid; display:inline-block; transition:background .1s; }
.md-cmpmodebtn { margin-left:auto; align-self:center; background:#2563eb; color:#fff; border:none; border-radius:9px; padding:9px 16px; font-weight:800; font-size:13px; cursor:pointer; }
.md-cmpmodebtn:hover { background:#1d4ed8; }
.md-cmpsimplewrap { display:grid; grid-template-columns:1fr 1fr; gap:16px; padding:0 18px 12px; align-items:start; }
.md-cmpsimplecard { border:1px solid var(--sline); border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:8px; }
.md-cmpsimplehead { font-size:12.5px; font-weight:800; color:var(--sink); }
.md-cmpradiogrp { display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:2px 0; }
.md-cmpradio { display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:700; color:var(--sink); cursor:pointer; }
.md-cmpradio input[type=checkbox] { appearance:none; -webkit-appearance:none; width:16px; height:16px; margin:0; border-radius:50%; border:2px solid #94a3b8; cursor:pointer; }
.md-cmpradio input[type=checkbox]:checked { background:#2563eb; border-color:#2563eb; box-shadow:inset 0 0 0 3px #fff; }
.md-cmpboard { display:flex; gap:16px; padding:0 18px 12px; align-items:flex-start; }
.md-cmpslots { flex:1 1 55%; min-width:0; display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.md-cmpslot { min-height:60px; border:2px dashed var(--sline); border-radius:10px; padding:8px; display:flex; flex-direction:column; align-items:flex-start; justify-content:center; gap:4px; transition:border-color .1s; }
.md-cmpslot.over { border-color:#0e7490; background:#ecfeff; }
.md-cmpslot.selectable { border-color:#94a3b8; }
.md-cmpslotempty { font-size:12px; color:#94a3b8; font-weight:700; margin:0 auto; }
.md-cmpslotremove { border:none; background:none; color:#94a3b8; font-size:10.5px; font-weight:800; cursor:pointer; padding:0; }
.md-cmpslotremove:hover { color:#b42318; }
.md-cmpbank { flex:1 1 45%; min-width:0; border-left:1px solid var(--sline); padding-left:16px; }
.md-cmpbankfilters { display:flex; flex-direction:column; gap:4px; margin-bottom:6px; }
.md-cmpbanklist { max-height:min(52vh,420px); overflow-y:auto; -webkit-overflow-scrolling:touch; scroll-behavior:smooth; overscroll-behavior:contain; padding-right:4px; }
.md-cmpchipteam { margin-left:auto; font-size:10px; font-weight:800; }
.md-cmpchipinfo { flex:none; width:22px; height:22px; margin-left:4px; border-radius:50%; border:1px solid var(--sline); background:#f8fafc; color:#475569; font-size:12px; font-weight:800; cursor:pointer; display:grid; place-items:center; }
.md-cmpchipinfo:hover { background:#eef2f7; color:#0e7490; }
.md-cmpspreadwrap { padding:0 18px 10px; display:flex; flex-direction:column; gap:12px; }
.md-cmpspreadrow { border-top:1px solid var(--sline); padding-top:10px; }
.md-cmpspreadname { font-weight:800; font-size:13px; color:var(--sink); display:flex; align-items:center; gap:8px; }
.md-cmpspreadname em { font-style:normal; font-size:10.5px; font-weight:800; opacity:.75; }
.md-cmpprobpct { margin-left:auto; font-size:11px; font-weight:800; color:#0e7490; }
.md-cmpspread { padding:4px 2px 0; }
.md-cmptrack { position:relative; height:10px; border-radius:6px; background:#eef2f7; margin:10px 2px 6px; }
.md-cmpband { position:absolute; top:0; bottom:0; border-radius:6px; background:#bae6fd; }
.md-cmppin { position:absolute; top:-4px; width:3px; height:18px; background:#0e7490; border-radius:2px; transform:translateX(-1.5px); }
.md-cmpspreadlabels { display:flex; justify-content:space-between; font-size:12.5px; font-weight:800; color:#0f2036; font-variant-numeric:tabular-nums; }
.md-cmpspreadlabels .mid { color:#0e7490; }
.md-cmprate { font-size:11px; color:#64748b; margin-top:6px; }
.md-cmpwin { margin:0 18px 12px; padding:10px 12px; background:#f0fdfa; border:1px solid #99f6e4; border-radius:10px; font-size:13px; font-weight:700; color:#0f2036; }

.md-imrow { display:flex; align-items:center; gap:6px; margin-bottom:8px; flex-wrap:wrap; }
.md-imlabel { font-size:11px; font-weight:800; color:#64748b; text-transform:uppercase; }
.md-imchip { padding:5px 11px; border-radius:16px; border:1.5px solid var(--sline); background:#fff; color:#334155; font-weight:800; font-size:12px; cursor:pointer; }
.md-imchip.on { background:#0ea5e9; border-color:#0ea5e9; color:#fff; }
.md-rswim.btn { border:1px solid var(--sline); background:#fff; cursor:pointer; padding:3px 8px; border-radius:14px; }
.md-rswim.btn:hover { border-color:#facc15; background:#fffdf0; }
.md-rswim.btn.scr { border-color:#fecaca; background:#fef2f2; }
.md-subx { font-style:normal; color:#b42318; font-weight:800; }
.md-subnote { font-style:normal; color:#7c3aed; } .md-subnote s { color:#94a3b8; }

.md-lgcount { margin-left:auto; font-size:12px; font-weight:800; color:#64748b; }

.md-leaguepage { position:fixed; inset:0; z-index:90; background:#fff; display:flex; flex-direction:column; overflow-y:auto; }
.md-lgtopbar { display:flex; align-items:center; justify-content:space-between; padding:12px 20px; border-bottom:1px solid var(--sline); flex:none; position:sticky; top:0; background:#fff; z-index:2; }
.md-lgback { border:none; background:none; color:#0e7490; font-weight:800; font-size:14px; cursor:pointer; padding:6px 4px; }
.md-lgback:hover { text-decoration:underline; }
.md-lgheader { padding:24px 24px 8px; max-width:920px; margin:0 auto; width:100%; }
.md-lgtitle { font-size:26px; font-weight:900; color:var(--sink); margin:0; }
.md-lgsub { font-size:13.5px; color:#64748b; margin:4px 0 0; }
.md-lgbanner { padding:28px 24px; color:#fff; display:flex; flex-direction:column; gap:14px; }
.md-lgbannerteam { font-size:28px; font-weight:900; }
.md-lgbannerstats { display:flex; gap:28px; }
.md-lgstat { display:flex; flex-direction:column; }
.md-lgstat b { font-size:22px; font-weight:900; }
.md-lgstat span { font-size:10.5px; text-transform:uppercase; letter-spacing:.08em; opacity:.8; font-weight:700; }
.md-lgbody { max-width:920px; margin:0 auto; width:100%; padding:16px 24px 40px; display:flex; flex-direction:column; gap:28px; }
.md-lgsection { display:flex; flex-direction:column; gap:8px; }
.md-lgsectitle { font-size:15px; font-weight:800; color:var(--sink); }
.md-topkid { background:linear-gradient(135deg, #fffbeb, #fff); border:1px solid #fde68a; border-radius:14px; padding:14px 16px; }
.md-topkidnote { margin-left:8px; font-style:normal; font-size:11px; font-weight:700; color:#94a3b8; text-transform:none; letter-spacing:0; }
.md-topkidslider { display:flex; align-items:center; gap:10px; padding:4px 2px 8px; }
.md-topkidend { font-size:11px; font-weight:800; color:#94a3b8; white-space:nowrap; }
.md-agesldr { position:relative; flex:1; height:30px; display:flex; align-items:center; cursor:pointer; }
.md-agesldrtrack { position:relative; width:100%; height:6px; border-radius:4px; background:#fde68a; }
.md-agesldrfill { position:absolute; left:0; top:0; bottom:0; border-radius:4px; background:#f59e0b; }
.md-agesldrthumb { position:absolute; top:50%; width:24px; height:24px; margin-left:-12px; margin-top:-12px; border-radius:50%; background:#f59e0b; border:3px solid #fff; box-shadow:0 1px 5px rgba(0,0,0,.35); pointer-events:none; }
.md-lgtable { width:100%; border-collapse:collapse; font-size:13.5px; }
.md-lgtable.standings thead th, .md-lgtable.roster thead th { text-align:left; padding:9px 10px; font-size:10.5px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8; border-bottom:2px solid var(--sline); }
.md-lgsortable { cursor:pointer; user-select:none; } .md-lgsortable:hover { color:#0e7490; }
.md-lgtable.standings tbody td, .md-lgtable.roster tbody td { padding:11px 10px; border-bottom:1px solid #f1f5f9; color:#334155; }
.md-lgtr { cursor:pointer; } .md-lgtr:hover td { background:#f8fafc; }
.md-lgtr.mine td { background:#fffdf0; } .md-lgtr.mine:hover td { background:#fef9e0; }
.md-lgrank { display:inline-grid; place-items:center; width:24px; height:24px; border-radius:50%; background:#eef2f7; color:#475569; font-weight:800; font-size:12px; }
.md-lgrank.top1 { background:#facc15; color:#3a2e00; } .md-lgrank.top2 { background:#cbd5e1; color:#1c2430; } .md-lgrank.top3 { background:#d98c4a; color:#3a2007; }
.md-lgteambar { display:inline-block; width:4px; height:16px; border-radius:2px; margin-right:9px; vertical-align:middle; }
.md-lgpower { font-weight:900; color:#0e7490; font-variant-numeric:tabular-nums; }
.md-lgopp { font-weight:700; color:var(--sink); } .md-lgdate { color:#94a3b8; }
.md-lgresult { font-weight:800; text-align:right; } .md-lgresult.win { color:#166534; } .md-lgresult.loss { color:#b42318; }
.md-lgswimname { font-weight:700; color:var(--sink); }
.md-lgfilters { display:flex; gap:14px; flex-wrap:wrap; align-items:flex-start; padding:2px 0 14px; }
.md-lgfilterwrap { margin-top:18px; padding-top:14px; border-top:1px solid var(--sline); }
.md-lgfiltertop { display:flex; align-items:center; gap:10px; }
.md-lgfiltertop .md-statsfilterbtn { border:1px solid var(--sline); background:#f8fafc; color:var(--sink); }
.md-lgfiltertop .md-statsfilterbtn.on { border-color:var(--cyan); background:#e6fbff; color:#0e7490; }
.md-lgsearch { position:relative; display:flex; align-items:center; }
.md-lgsearchbtn { width:36px; height:36px; border-radius:9px; border:1px solid var(--sline); background:#fff; font-size:15px; cursor:pointer; }
.md-lgsearchbtn.on { background:var(--cyan); border-color:var(--cyan); }
.md-lgsearchbtn:hover { background:#f1f5f9; }
.md-lgsearchbox { position:absolute; left:42px; top:0; z-index:5; }
.md-lgsearchinput { height:36px; width:220px; border-radius:9px; border:1px solid var(--sline); background:#fff; padding:0 12px; font-size:13.5px; }
.md-lgsearchresults { position:absolute; top:40px; left:0; width:260px; max-height:280px; overflow-y:auto; background:#fff; border-radius:12px; border:1px solid var(--sline); box-shadow:0 18px 40px -12px rgba(6,14,28,.35); padding:6px; }
.md-lgsearchrow { display:flex; align-items:center; gap:8px; width:100%; padding:8px 9px; border-radius:8px; border:none; background:none; text-align:left; font-size:13px; font-weight:700; cursor:pointer; color:var(--sink); }
.md-lgsearchrow:hover { background:#f1f5f9; }
.md-lgsearchteam { margin-left:auto; font-size:10.5px; font-weight:800; color:#94a3b8; }
.md-profnote { padding:10px 12px; background:#f8fafc; border-radius:9px; margin-bottom:6px; font-size:12.5px; }
.md-profnote b { color:var(--sink); } .md-profnotemeta { color:#94a3b8; font-weight:700; }
.md-profnote p { margin:4px 0 0; color:#334155; line-height:1.4; }
@media (max-width:640px){ .md-lgbannerstats { gap:16px; } .md-lgbanner { padding:20px 16px; } .md-lgheader,.md-lgbody { padding-left:16px; padding-right:16px; } }
.md-lglist { overflow-y:auto; padding:8px 12px; flex:1; min-height:0; }
.md-lgitem { border:1px solid var(--sline); border-radius:11px; margin-bottom:6px; overflow:hidden; }
.md-lgitem.mine { border-color:#facc15; }
.md-lgrow { width:100%; display:grid; grid-template-columns:auto 1fr auto auto auto; align-items:center; gap:9px; padding:9px 12px; background:#fff; border:none; cursor:pointer; text-align:left; }
.md-lgrow:hover { background:#f8fafc; }
.md-lgdot { width:9px; height:9px; border-radius:50%; }
.md-lgname { font-weight:800; font-size:13.5px; color:var(--sink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.md-lgmeta { font-size:11px; color:#94a3b8; font-weight:700; white-space:nowrap; }
.md-lgpts { font-weight:900; font-size:15px; color:#0e7490; } .md-lgpts small { font-size:9px; color:#94a3b8; margin-left:2px; }
.md-lgdetail { padding:6px 12px 10px; background:#fbfdff; border-top:1px solid var(--sline); }
.md-lgev { display:flex; align-items:center; gap:8px; padding:4px 0; font-size:12px; border-bottom:1px solid #eef2f7; }
.md-lgev:last-child { border-bottom:none; }
.md-lgevname { font-weight:700; color:#334155; min-width:96px; }
.md-lgevseed { color:#64748b; font-variant-numeric:tabular-nums; flex:1; }
.md-lgevplace { font-weight:800; color:#0e7490; } .md-lgevpts { font-weight:800; color:#166534; }

.md-panel.prev.grow { flex:2 1 auto; }
.md-panel.water.prestart { flex:none; max-height:118px; overflow:hidden; }
.md-allstrip { display:flex; align-items:stretch; gap:3px; padding:5px; height:100%; overflow:hidden; }
.md-odcard.allfit { padding:6px 6px; }
.md-odcard.allfit .md-odcname, .md-odcard.allfit .md-odcteam { white-space:nowrap; overflow:hidden; text-overflow:clip; }
.md-waiting { font-style:normal; color:var(--muted); font-weight:700; }
.md-prestartbox { padding:12px; display:flex; flex-direction:column; gap:10px; }
.md-startbtn { padding:14px; border-radius:12px; border:none; background:var(--cyan); color:#062a33; font-weight:900; font-size:16px; cursor:pointer; letter-spacing:.02em; }
.md-startbtn:hover { background:#5fe3f5; }
.md-prevslider { padding:4px; flex:1 1 auto; min-height:0; display:flex; flex-direction:column; } .md-prevslider.empty { padding:12px; color:var(--muted); font-size:12px; }
.md-prevwin { overflow:hidden; flex:1 1 auto; min-height:68px; }
.md-prevroll { display:flex; flex-direction:column; transition:transform .45s ease; }
.md-prevrow { display:grid; grid-template-columns:auto 1fr auto auto; align-items:center; gap:8px; padding:0 8px; border:none; background:#0c1c33; color:var(--text); text-align:left; cursor:pointer; border-bottom:1px solid #0a1628; }
.md-prevrow.mine { box-shadow:inset 3px 0 0 #facc15; }

.md-statrow.mine { background:#fffdf0; box-shadow:inset 3px 0 0 #facc15; border-radius:6px; }
.md-toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%); z-index:80; background:#0f2036; color:#fff; padding:12px 20px; border-radius:12px; font-weight:800; font-size:14px; box-shadow:0 16px 40px -12px rgba(0,0,0,.6); }
.md-toastundo { display:flex; align-items:center; gap:14px; }
.md-undobtn { background:var(--cyan); color:#062a33; border:none; border-radius:8px; padding:6px 12px; font-weight:900; font-size:13px; cursor:pointer; }
.md-undobtn:hover { background:#5fe3f5; }

.md-gear { position:fixed; left:16px; bottom:16px; z-index:35; width:52px; height:52px; border-radius:50%; border:none; background:#0f2036; color:#fff; font-size:24px; cursor:pointer; box-shadow:0 10px 30px -8px rgba(0,0,0,.6); }
.md-gear:hover { background:#1a3050; }
.md-settings { width:min(560px,96vw); }
.md-setbody { padding:16px 18px; overflow-y:auto; display:flex; flex-direction:column; gap:10px; }
.md-fixed { font-size:13px; color:#94a3b8; font-weight:700; padding:8px 0; }
.md-stepper { display:inline-flex; align-items:center; gap:2px; }
.md-stepper button { width:38px; height:38px; border-radius:9px; border:1px solid var(--sline); background:#fff; font-size:20px; font-weight:800; color:#0f2036; cursor:pointer; }
.md-stepper button:hover { background:#f1f5f9; border-color:#94a3b8; }
.md-stepper span { min-width:44px; text-align:center; font-size:17px; font-weight:900; font-variant-numeric:tabular-nums; }
.md-endrace { width:26px; height:26px; background:#ef4444; border:none; border-radius:7px; cursor:pointer; margin-left:auto; box-shadow:0 1px 4px rgba(239,68,68,.5); }
.md-endrace:hover { background:#dc2626; } .md-endrace:disabled { opacity:.4; cursor:default; }
.md-startsq { width:26px; height:26px; margin-left:auto; border:none; border-radius:7px; background:var(--cyan); color:#062a33; font-weight:900; font-size:12px; cursor:pointer; display:grid; place-items:center; box-shadow:0 1px 4px rgba(34,211,238,.4); }
.md-startsq:hover { background:#5fe3f5; }
.md-progbtn { width:100%; margin-top:8px; padding:9px; border-radius:9px; border:1.5px solid var(--sline); background:#fff; color:#7c3aed; font-weight:800; font-size:13px; cursor:pointer; }
.md-progbtn.on { background:#f3e8ff; border-color:#ddd6fe; }
.md-progwrap { margin-top:8px; }
.md-proglist { margin-top:6px; max-height:150px; overflow-y:auto; display:flex; flex-direction:column; gap:3px; }
.md-progrow { display:grid; grid-template-columns:1fr auto auto; gap:8px; align-items:center; padding:6px 8px; background:#f8fafc; border-radius:8px; font-size:12px; }
.md-progev { font-weight:700; color:#334155; } .md-progt { font-weight:800; color:#0e7490; font-variant-numeric:tabular-nums; } .md-progm { font-size:10px; color:#94a3b8; }
.md-progempty { font-size:12px; color:#94a3b8; padding:8px; }

.md-seasontabs { display:flex; gap:6px; padding:10px 18px 0; }
.md-seasontab { flex:1; padding:9px; border-radius:9px; border:1.5px solid var(--sline); background:#fff; color:#475569; font-weight:800; font-size:13px; cursor:pointer; }
.md-seasontab.on { background:#0f2036; border-color:#0f2036; color:#fff; }
.md-meetlist { flex:1; min-height:0; overflow-y:auto; padding:12px 16px; display:flex; flex-direction:column; gap:8px; }
.md-meetrow { display:flex; align-items:center; gap:10px; padding:11px 12px; border:1px solid var(--sline); border-radius:11px; background:#fff; }
.md-meetinfo { flex:1; min-width:0; }
.md-meetname { font-weight:800; font-size:14px; color:var(--sink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.md-meetmeta { font-size:11.5px; color:#94a3b8; margin-top:1px; }
.md-meetload { flex:none; padding:8px 14px; border-radius:8px; border:none; background:var(--cyan); color:#062a33; font-weight:800; font-size:13px; cursor:pointer; }
.md-meetload:hover { background:#5fe3f5; }
.md-meetdel { flex:none; width:34px; height:34px; border-radius:8px; border:1px solid #fecaca; background:#fff; color:#b42318; font-size:14px; cursor:pointer; }
.md-meetdel:hover { background:#fef2f2; }

.md-onlymine { display:flex; align-items:center; gap:8px; font-size:12.5px; font-weight:700; color:#475569; padding:2px 2px 8px; }
.md-onlymine input { width:16px; height:16px; }
.md-confirm { position:absolute; inset:0; background:rgba(6,14,28,.55); display:grid; place-items:center; z-index:70; border-radius:18px; }
.md-confirmbox { background:#fff; border-radius:14px; padding:18px; width:min(360px,90%); box-shadow:0 20px 50px -16px rgba(0,0,0,.5); }
.md-confirmq { font-size:14px; font-weight:700; color:var(--sink); line-height:1.5; margin-bottom:14px; }
.md-confirmbtns { display:flex; justify-content:flex-end; gap:8px; }
.md-confirmyes { padding:10px 16px; border-radius:9px; border:none; background:var(--dq); color:#fff; font-weight:800; font-size:13px; cursor:pointer; }
.md-confirmyes:hover { background:#dc2626; }

.md-lane.scr .md-laneswimmer, .md-swim.scr .md-sname { text-decoration:line-through; opacity:.6; }
.md-lane.scr, .md-swim.scr { opacity:.72; }
.md-scrbadge { background:#ef4444; color:#fff; font-size:9px; font-weight:900; padding:1px 5px; border-radius:4px; letter-spacing:.03em; }
.md-timex { width:64px; text-align:center; color:#ef4444; font-weight:900; font-size:16px; }
.md-povtop { display:flex; gap:8px; }
.md-povtop .md-dq { flex:1; width:auto; margin:0; }
.md-nsbtn { flex:1; padding:11px; border-radius:11px; border:1.5px solid var(--sline); background:#fff; color:#475569; font-weight:800; font-size:13px; cursor:pointer; }
.md-nsbtn:hover { border-color:#94a3b8; } .md-nsbtn.on { background:#fee2e2; border-color:#fca5a5; color:#b42318; }
.md-workhdr { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; color:#64748b; margin:10px 0 6px; }
.md-worktags { display:flex; flex-wrap:wrap; gap:6px; }
.md-worktag { padding:7px 12px; border-radius:16px; border:1.5px solid var(--sline); background:#fff; color:#334155; font-weight:700; font-size:12.5px; cursor:pointer; }
.md-worktag:hover { border-color:#94a3b8; }
.md-stime.scrx { color:#ef4444; font-weight:900; }
.md-lgitem.scr { border-color:#fecaca; }
.md-partghost { font-size:11.5px; font-weight:700; color:#94a3b8; font-style:italic; }
.md-partev { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:5px 0; border-bottom:1px solid #eef2f7; }
.md-partev:last-child { border-bottom:none; }
.md-partname { font-size:12.5px; font-weight:700; color:#334155; }
.md-relaytag { font-style:normal; font-weight:700; color:#0e7490; }
.md-partname.scr { text-decoration:line-through; color:#94a3b8; }
.md-partbtn { padding:5px 12px; border-radius:8px; border:1px solid var(--sline); background:#fff; color:#475569; font-weight:800; font-size:12px; cursor:pointer; }
.md-partbtn:hover { border-color:#ef4444; color:#b42318; } .md-partbtn.on { background:#fee2e2; border-color:#fecaca; color:#b42318; }
.md-partbtn.revert { border-color:#7c3aed; color:#7c3aed; background:#f5f3ff; }
.md-partbtn.revert:hover { background:#ede9fe; border-color:#7c3aed; color:#5b21b6; }
.md-scratchbtn { width:100%; padding:11px; border-radius:11px; border:1.5px solid var(--sline); background:#fff; color:#475569; font-weight:800; font-size:13.5px; cursor:pointer; margin-bottom:10px; }
.md-scratchbtn:hover { background:#f1f5f9; } .md-scratchbtn.on { background:#e2e8f0; border-color:#94a3b8; color:#334155; }
.md-scratchmodal { width:min(400px,94vw); }
.md-scratchbtns { padding:14px 18px; display:flex; flex-direction:column; gap:8px; }
.md-planlegs { display:flex; flex-direction:column; gap:5px; margin-bottom:4px; }
.md-planleg { display:grid; grid-template-columns:60px 1fr auto auto; align-items:center; gap:8px; padding:8px 10px; background:#f8fafc; border-radius:9px; font-size:12.5px; }
.md-planstroke { font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:#0e7490; }
.md-planname { font-weight:700; color:#334155; } .md-planname s { color:#94a3b8; font-weight:600; }
.md-plantime { font-weight:800; color:#0e7490; font-variant-numeric:tabular-nums; }

.md-newmeetform { padding:16px 18px; display:flex; flex-direction:column; gap:10px; overflow-y:auto; }
.md-newmeetnote { font-size:12px; color:#64748b; background:#f8fafc; border:1px solid var(--sline); border-radius:9px; padding:9px 11px; }

@media (max-width:900px){ .md-root { height:auto; min-height:100vh; overflow:visible; } .md-grid { grid-template-columns:1fr; } .md-left { overflow:visible; } .md-sheet { overflow-y:visible; } .md-gear { bottom:12px; left:12px; } }
@media (prefers-reduced-motion: reduce){ * { transition:none !important; scroll-behavior:auto !important; } }
`;
