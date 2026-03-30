const { getStore } = require("@netlify/blobs");

function paceToSeconds(pace) { var p = pace.split(":"); return parseInt(p[0]) * 60 + parseInt(p[1] || 0); }
function secondsToPace(secs) { var m = Math.floor(secs / 60); var s = Math.round(secs % 60); return m + ":" + (s < 10 ? "0" : "") + s; }

function estimateVDOT(distanceKm, timeMinutes) {
  var velocity = distanceKm / timeMinutes;
  var vo2 = -4.6 + 0.182258 * velocity * 1000 + 0.000104 * Math.pow(velocity * 1000, 2);
  var pctVO2 = 0.8 + 0.1894393 * Math.exp(-0.012778 * timeMinutes) + 0.2989558 * Math.exp(-0.1932605 * timeMinutes);
  return vo2 / pctVO2;
}

function trainingPaces(vdot) {
  var base = 510 - vdot * 4.5;
  return { easy: { min: secondsToPace(base), max: secondsToPace(base + 30) }, marathon: secondsToPace(base - 25), threshold: secondsToPace(base - 45), interval: secondsToPace(base - 65), repetition: secondsToPace(base - 80) };
}

var RACE_DISTANCES = { "5k": { km: 5, weeks: 8 }, "10k": { km: 10, weeks: 10 }, half: { km: 21.1, weeks: 12 }, marathon: { km: 42.2, weeks: 16 }, ultra50k: { km: 50, weeks: 20 } };
var PHASES = [{ name: "Base", pct: 0.3, focus: "aerobic_base" }, { name: "Build", pct: 0.3, focus: "lactate_threshold" }, { name: "Peak", pct: 0.25, focus: "race_specific" }, { name: "Taper", pct: 0.15, focus: "recovery" }];

var WORKOUT_TYPES = {
  easy: { label: "Easy Run", effort: "easy", description: "Conversational pace, build aerobic base" },
  long: { label: "Long Run", effort: "easy", description: "Extended aerobic effort at easy pace" },
  tempo: { label: "Tempo Run", effort: "threshold", description: "Sustained effort at threshold pace" },
  intervals: { label: "Intervals", effort: "interval", description: "Hard repeats with recovery jogs" },
  repetitions: { label: "Repetitions", effort: "repetition", description: "Short, fast repeats for speed" },
  recovery: { label: "Recovery Run", effort: "easy", description: "Very easy, short recovery jog" },
  race_pace: { label: "Race Pace", effort: "marathon", description: "Extended segments at goal race pace" },
  rest: { label: "Rest Day", effort: "none", description: "Full rest or cross-training" }
};

function weekTemplate(phase, daysPerWeek) {
  var t = {
    3: { aerobic_base: ["easy","easy","long"], lactate_threshold: ["easy","tempo","long"], race_specific: ["intervals","tempo","long"], recovery: ["easy","easy","easy"] },
    4: { aerobic_base: ["easy","easy","easy","long"], lactate_threshold: ["easy","tempo","easy","long"], race_specific: ["intervals","tempo","easy","long"], recovery: ["easy","recovery","easy","easy"] },
    5: { aerobic_base: ["easy","easy","easy","easy","long"], lactate_threshold: ["easy","tempo","easy","intervals","long"], race_specific: ["tempo","easy","intervals","easy","long"], recovery: ["easy","recovery","easy","recovery","easy"] },
    6: { aerobic_base: ["easy","easy","easy","easy","recovery","long"], lactate_threshold: ["easy","tempo","easy","intervals","recovery","long"], race_specific: ["tempo","easy","intervals","race_pace","recovery","long"], recovery: ["easy","recovery","easy","recovery","easy","easy"] },
    7: { aerobic_base: ["easy","easy","easy","easy","easy","recovery","long"], lactate_threshold: ["easy","tempo","easy","intervals","easy","recovery","long"], race_specific: ["tempo","easy","intervals","easy","race_pace","recovery","long"], recovery: ["easy","recovery","easy","recovery","easy","recovery","easy"] }
  };
  var d = Math.max(3, Math.min(7, daysPerWeek));
  return t[d][phase] || t[d]["aerobic_base"];
}

function weeklyVolume(base, weekNum, totalWeeks, phase) {
  var vol = base * (1 + (weekNum / totalWeeks) * 0.4);
  if (weekNum > 0 && weekNum % 4 === 3) vol *= 0.9;
  if (phase === "recovery") vol *= Math.max(0.5, 1 - (weekNum - Math.floor(totalWeeks * 0.85)) * 0.15);
  return Math.round(vol);
}

function generateWorkout(type, paces, volumeKm, raceDistance) {
  var info = WORKOUT_TYPES[type];
  if (!info) return { type: "rest", label: "Rest Day", steps: [] };
  var steps = [];
  switch (type) {
    case "easy": steps.push({ type: "active", distance: Math.round(volumeKm * 0.15 * 10) / 10, unit: "km", pace: paces.easy, label: "Easy Run" }); break;
    case "long": steps.push({ type: "active", distance: Math.round(volumeKm * 0.3 * 10) / 10, unit: "km", pace: paces.easy, label: "Long Run" }); break;
    case "tempo": steps.push({ type: "warmup", distance: 2, unit: "km", pace: paces.easy, label: "Warm Up" }, { type: "active", distance: Math.max(3, Math.round(volumeKm * 0.12 * 10) / 10), unit: "km", pace: { min: paces.threshold, max: paces.threshold }, label: "Tempo" }, { type: "cooldown", distance: 1.5, unit: "km", pace: paces.easy, label: "Cool Down" }); break;
    case "intervals":
      var rd = raceDistance === "5k" ? 400 : raceDistance === "10k" ? 800 : 1000;
      var reps = raceDistance === "5k" ? 6 : raceDistance === "10k" ? 5 : 4;
      steps.push({ type: "warmup", distance: 2, unit: "km", pace: paces.easy, label: "Warm Up" }, { type: "repeat", reps: reps, steps: [{ type: "active", distance: rd, unit: "m", pace: { min: paces.interval, max: paces.interval }, label: rd + "m Hard" }, { type: "recovery", distance: rd === 400 ? 200 : 400, unit: "m", pace: paces.easy, label: "Recovery Jog" }] }, { type: "cooldown", distance: 1.5, unit: "km", pace: paces.easy, label: "Cool Down" }); break;
    case "repetitions": steps.push({ type: "warmup", distance: 2, unit: "km", pace: paces.easy, label: "Warm Up" }, { type: "repeat", reps: 8, steps: [{ type: "active", distance: 200, unit: "m", pace: { min: paces.repetition, max: paces.repetition }, label: "200m Fast" }, { type: "recovery", distance: 200, unit: "m", pace: paces.easy, label: "Recovery Jog" }] }, { type: "cooldown", distance: 1.5, unit: "km", pace: paces.easy, label: "Cool Down" }); break;
    case "race_pace": steps.push({ type: "warmup", distance: 2, unit: "km", pace: paces.easy, label: "Warm Up" }, { type: "active", distance: Math.max(3, Math.round(volumeKm * 0.1 * 10) / 10), unit: "km", pace: { min: paces.marathon, max: paces.marathon }, label: "Race Pace" }, { type: "cooldown", distance: 1.5, unit: "km", pace: paces.easy, label: "Cool Down" }); break;
    case "recovery": steps.push({ type: "active", distance: Math.max(3, Math.round(volumeKm * 0.08 * 10) / 10), unit: "km", pace: paces.easy, label: "Recovery Run" }); break;
  }
  return { type: type, label: info.label, description: info.description, effort: info.effort, steps: steps };
}

function generatePlan(opts) {
  var race = RACE_DISTANCES[opts.raceDistance];
  if (!race) throw new Error("Unknown race distance: " + opts.raceDistance);
  var vdot;
  if (opts.recentRaceDistance && opts.recentRaceTime) { vdot = estimateVDOT((RACE_DISTANCES[opts.recentRaceDistance] || {}).km || parseFloat(opts.recentRaceDistance), opts.recentRaceTime); }
  else if (opts.goalTime) { vdot = estimateVDOT(race.km, opts.goalTime); }
  else { vdot = 40; }
  var paces = trainingPaces(vdot);
  var today = new Date();
  var raceDateObj = new Date(opts.raceDate);
  var weeksUntilRace = Math.max(4, Math.floor((raceDateObj - today) / (7 * 86400000)));
  var totalWeeks = Math.min(weeksUntilRace, race.weeks);
  var baseVolume = opts.currentWeeklyKm || Math.round(race.km * 1.2);
  var clampedDays = Math.max(3, Math.min(7, opts.daysPerWeek || 4));
  var weeks = [], phaseIdx = 0, phaseWeekCount = 0;
  for (var w = 0; w < totalWeeks; w++) {
    var phaseLength = Math.max(1, Math.round(totalWeeks * PHASES[phaseIdx].pct));
    if (phaseWeekCount >= phaseLength && phaseIdx < PHASES.length - 1) { phaseIdx++; phaseWeekCount = 0; }
    var phase = PHASES[phaseIdx];
    var volume = weeklyVolume(baseVolume, w, totalWeeks, phase.focus);
    var template = weekTemplate(phase.focus, clampedDays);
    var startDate = new Date(today); startDate.setDate(startDate.getDate() + w * 7);
    var dow = startDate.getDay(); var mo = dow === 0 ? 1 : dow === 1 ? 0 : 8 - dow; startDate.setDate(startDate.getDate() + mo);
    var days = [], dayIdx = 0;
    for (var d = 0; d < 7; d++) {
      var dayDate = new Date(startDate); dayDate.setDate(dayDate.getDate() + d);
      var dateStr = dayDate.toISOString().split("T")[0];
      if (dayIdx < template.length) {
        var spacing = Math.floor(7 / clampedDays);
        if ((d % spacing === 0 || dayIdx === template.length - 1) && dayIdx < template.length) {
          var workout = generateWorkout(template[dayIdx], paces, volume, opts.raceDistance);
          days.push(Object.assign({ date: dateStr, dayOfWeek: d, completed: false }, workout));
          dayIdx++;
        } else { days.push({ date: dateStr, dayOfWeek: d, type: "rest", label: "Rest Day", steps: [], completed: false }); }
      } else { days.push({ date: dateStr, dayOfWeek: d, type: "rest", label: "Rest Day", steps: [], completed: false }); }
    }
    weeks.push({ weekNumber: w + 1, phase: phase.name, focus: phase.focus, totalVolumeKm: volume, days: days });
    phaseWeekCount++;
  }
  var raceWeek = weeks[weeks.length - 1];
  if (raceWeek) {
    var ri = raceWeek.days.findIndex(function(d) { return d.date === opts.raceDate || d.dayOfWeek === 6; });
    if (ri >= 0) raceWeek.days[ri] = Object.assign({}, raceWeek.days[ri], { type: "race", label: "Race Day - " + opts.raceDistance.toUpperCase(), description: opts.goalTime ? "Goal: " + Math.floor(opts.goalTime / 60) + ":" + (Math.round(opts.goalTime % 60) < 10 ? "0" : "") + Math.round(opts.goalTime % 60) : "Give it your all!", steps: [] });
  }
  return { id: "plan_" + Date.now(), createdAt: new Date().toISOString(), raceDistance: opts.raceDistance, raceDate: opts.raceDate, goalTime: opts.goalTime, totalWeeks: totalWeeks, daysPerWeek: clampedDays, vdot: Math.round(vdot * 10) / 10, paces: paces, insights: [], weeks: weeks };
}

async function tryGetStore(name) {
  try { return getStore(name); } catch (e) { console.log("Blobs not available:", e.message); return null; }
}

exports.handler = async (event) => {
  var headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: headers, body: "" };
  try {
    if (event.httpMethod === "POST") {
      var body = JSON.parse(event.body);
      if (body.action === "generate") {
        var plan = generatePlan(body);
        var store = await tryGetStore("training-plans");
        if (store) {
          var userId = body.userId || "default";
          try { await store.setJSON(userId + "/current", plan); } catch (e) { console.log("Failed to save plan to Blobs:", e.message); }
        }
        return { statusCode: 200, headers: headers, body: JSON.stringify(plan) };
      }
      if (body.action === "adapt") {
        var store2 = await tryGetStore("training-plans");
        var currentPlan = null;
        if (store2) { try { currentPlan = await store2.get((body.userId || "default") + "/current", { type: "json" }); } catch (e) {} }
        if (!currentPlan) return { statusCode: 404, headers: headers, body: JSON.stringify({ error: "No active plan found. Please create a new plan." }) };
        var updatedPlan = generatePlan(Object.assign({}, currentPlan, { recentActivities: body.recentActivities }));
        updatedPlan.id = currentPlan.id;
        if (store2) { try { await store2.setJSON((body.userId || "default") + "/current", updatedPlan); } catch (e) {} }
        return { statusCode: 200, headers: headers, body: JSON.stringify(updatedPlan) };
      }
      if (body.action === "complete-workout") {
        var store3 = await tryGetStore("training-plans");
        if (store3) {
          try {
            var p = await store3.get((body.userId || "default") + "/current", { type: "json" });
            if (p) { p.weeks.forEach(function(wk) { wk.days.forEach(function(dy) { if (dy.date === body.date) { dy.completed = true; } }); }); await store3.setJSON((body.userId || "default") + "/current", p); }
          } catch (e) {}
        }
        return { statusCode: 200, headers: headers, body: JSON.stringify({ success: true }) };
      }
    }
    if (event.httpMethod === "GET") {
      var params = event.queryStringParameters || {};
      var store4 = await tryGetStore("training-plans");
      if (store4) {
        try {
          var plan2 = await store4.get((params.userId || "default") + "/current", { type: "json" });
          if (plan2) return { statusCode: 200, headers: headers, body: JSON.stringify(plan2) };
        } catch (e) {}
      }
      return { statusCode: 404, headers: headers, body: JSON.stringify({ error: "No active plan" }) };
    }
    return { statusCode: 405, headers: headers, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (err) {
    console.error("Training plan error:", err);
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: err.message }) };
  }
};
