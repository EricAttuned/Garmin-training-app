// Training Plan Engine
// Generates adaptive, periodized running plans targeting a specific race
// Adjusts workouts based on recent Garmin activity data

const { getStore } = require("@netlify/blobs");

// ── Pace & Zone Helpers ──────────────────────────────────────────────

/** Convert mm:ss pace string to seconds */
function paceToSeconds(pace) {
  const [m, s] = pace.split(":").map(Number);
  return m * 60 + (s || 0);
}

/** Convert seconds to mm:ss pace string */
function secondsToPace(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Estimate VDOT from a recent race or time-trial result */
function estimateVDOT(distanceKm, timeMinutes) {
  const velocity = distanceKm / timeMinutes;
  const vo2 = -4.6 + 0.182258 * velocity * 1000 + 0.000104 * (velocity * 1000) ** 2;
  const pctVO2 =
    0.8 +
    0.1894393 * Math.exp(-0.012778 * timeMinutes) +
    0.2989558 * Math.exp(-0.1932605 * timeMinutes);
  return vo2 / pctVO2;
}

/** Generate training paces from VDOT */
function trainingPaces(vdot) {
  const base = 510 - vdot * 4.5;
  return {
    easy: { min: secondsToPace(base), max: secondsToPace(base + 30) },
    marathon: secondsToPace(base - 25),
    threshold: secondsToPace(base - 45),
    interval: secondsToPace(base - 65),
    repetition: secondsToPace(base - 80),
  };
}

const RACE_DISTANCES = {
  "5k": { km: 5, weeks: 8, longRunMaxKm: 16 },
  "10k": { km: 10, weeks: 10, longRunMaxKm: 19 },
  half: { km: 21.1, weeks: 12, longRunMaxKm: 24 },
  marathon: { km: 42.2, weeks: 16, longRunMaxKm: 35 },
  ultra50k: { km: 50, weeks: 20, longRunMaxKm: 42 },
};

const PHASES = [
  { name: "Base", pct: 0.3, focus: "aerobic_base" },
  { name: "Build", pct: 0.3, focus: "lactate_threshold" },
  { name: "Peak", pct: 0.25, focus: "race_specific" },
  { name: "Taper", pct: 0.15, focus: "recovery" },
];

const WORKOUT_TYPES = {
  easy: { label: "Easy Run", effort: "easy", description: "Conversational pace, build aerobic base" },
  long: { label: "Long Run", effort: "easy", description: "Extended aerobic effort at easy pace" },
  tempo: { label: "Tempo Run", effort: "threshold", description: "Sustained effort at threshold pace" },
  intervals: { label: "Intervals", effort: "interval", description: "Hard repeats with recovery jogs" },
  repetitions: { label: "Repetitions", effort: "repetition", description: "Short, fast repeats for speed" },
  recovery: { label: "Recovery Run", effort: "easy", description: "Very easy, short recovery jog" },
  race_pace: { label: "Race Pace", effort: "marathon", description: "Extended segments at goal race pace" },
  rest: { label: "Rest Day", effort: "none", description: "Full rest or cross-training" },
  cross: { label: "Cross Training", effort: "easy", description: "Non-running aerobic activity" },
};

function weekTemplate(phase, daysPerWeek) {
  const templates = {
    3: { aerobic_base: ["easy", "easy", "long"], lactate_threshold: ["easy", "tempo", "long"], race_specific: ["intervals", "tempo", "long"], recovery: ["easy", "easy", "easy"] },
    4: { aerobic_base: ["easy", "easy", "easy", "long"], lactate_threshold: ["easy", "tempo", "easy", "long"], race_specific: ["intervals", "tempo", "easy", "long"], recovery: ["easy", "recovery", "easy", "easy"] },
    5: { aerobic_base: ["easy", "easy", "easy", "easy", "long"], lactate_threshold: ["easy", "tempo", "easy", "intervals", "long"], race_specific: ["tempo", "easy", "intervals", "easy", "long"], recovery: ["easy", "recovery", "easy", "recovery", "easy"] },
    6: { aerobic_base: ["easy", "easy", "easy", "easy", "recovery", "long"], lactate_threshold: ["easy", "tempo", "easy", "intervals", "recovery", "long"], race_specific: ["tempo", "easy", "intervals", "race_pace", "recovery", "long"], recovery: ["easy", "recovery", "easy", "recovery", "easy", "easy"] },
    7: { aerobic_base: ["easy", "easy", "easy", "easy", "easy", "recovery", "long"], lactate_threshold: ["easy", "tempo", "easy", "intervals", "easy", "recovery", "long"], race_specific: ["tempo", "easy", "intervals", "easy", "race_pace", "recovery", "long"], recovery: ["easy", "recovery", "easy", "recovery", "easy", "recovery", "easy"] },
  };
  const clampedDays = Math.max(3, Math.min(7, daysPerWeek));
  return templates[clampedDays][phase] || templates[clampedDays]["aerobic_base"];
}

function weeklyVolume(baseVolumeKm, weekNum, totalWeeks, phase) {
  const progression = 1 + (weekNum / totalWeeks) * 0.4;
  let volume = baseVolumeKm * progression;
  if (weekNum > 0 && weekNum % 4 === 3) volume *= 0.9;
  if (phase === "recovery") {
    const taperWeek = weekNum - Math.floor(totalWeeks * 0.85);
    volume *= Math.max(0.5, 1 - taperWeek * 0.15);
  }
  return Math.round(volume);
}

function generateWorkout(type, paces, volumeKm, weekPhase, raceDistance) {
  const info = WORKOUT_TYPES[type];
  if (!info) return { type: "rest", label: "Rest Day", steps: [] };
  const steps = [];
  switch (type) {
    case "easy":
      steps.push({ type: "active", distance: Math.round(volumeKm * 0.15 * 10) / 10, unit: "km", pace: paces.easy, label: "Easy Run" });
      break;
    case "long":
      steps.push({ type: "active", distance: Math.round(volumeKm * 0.3 * 10) / 10, unit: "km", pace: paces.easy, label: "Long Run" });
      break;
    case "tempo":
      steps.push(
        { type: "warmup", distance: 2, unit: "km", pace: paces.easy, label: "Warm Up" },
        { type: "active", distance: Math.max(3, Math.round(volumeKm * 0.12 * 10) / 10), unit: "km", pace: { min: paces.threshold, max: paces.threshold }, label: "Tempo" },
        { type: "cooldown", distance: 1.5, unit: "km", pace: paces.easy, label: "Cool Down" }
      );
      break;
    case "intervals": {
      const repDistance = raceDistance === "5k" ? 400 : raceDistance === "10k" ? 800 : 1000;
      const reps = raceDistance === "5k" ? 6 : raceDistance === "10k" ? 5 : 4;
      steps.push(
        { type: "warmup", distance: 2, unit: "km", pace: paces.easy, label: "Warm Up" },
        { type: "repeat", reps, steps: [
          { type: "active", distance: repDistance, unit: "m", pace: { min: paces.interval, max: paces.interval }, label: `${repDistance}m Hard` },
          { type: "recovery", distance: repDistance === 400 ? 200 : 400, unit: "m", pace: paces.easy, label: "Recovery Jog" },
        ]},
        { type: "cooldown", distance: 1.5, unit: "km", pace: paces.easy, label: "Cool Down" }
      );
      break;
    }
    case "repetitions":
      steps.push(
        { type: "warmup", distance: 2, unit: "km", pace: paces.easy, label: "Warm Up" },
        { type: "repeat", reps: 8, steps: [
          { type: "active", distance: 200, unit: "m", pace: { min: paces.repetition, max: paces.repetition }, label: "200m Fast" },
          { type: "recovery", distance: 200, unit: "m", pace: paces.easy, label: "Recovery Jog" },
        ]},
        { type: "cooldown", distance: 1.5, unit: "km", pace: paces.easy, label: "Cool Down" }
      );
      break;
    case "race_pace":
      steps.push(
        { type: "warmup", distance: 2, unit: "km", pace: paces.easy, label: "Warm Up" },
        { type: "active", distance: Math.max(3, Math.round(volumeKm * 0.1 * 10) / 10), unit: "km", pace: { min: paces.marathon, max: paces.marathon }, label: "Race Pace" },
        { type: "cooldown", distance: 1.5, unit: "km", pace: paces.easy, label: "Cool Down" }
      );
      break;
    case "recovery":
      steps.push({ type: "active", distance: Math.max(3, Math.round(volumeKm * 0.08 * 10) / 10), unit: "km", pace: paces.easy, label: "Recovery Run" });
      break;
  }
  return { type, label: info.label, description: info.description, effort: info.effort, steps };
}

function adaptPlan(recentActivities, currentPaces, currentVdot) {
  if (!recentActivities || recentActivities.length < 3) {
    return { adjustedVdot: currentVdot, adjustedPaces: currentPaces, insights: [] };
  }
  const insights = [];
  let vdotAdjustment = 0;
  const recentRuns = recentActivities.filter((a) => a.type === "running" && a.durationMinutes > 15).slice(0, 10);
  if (recentRuns.length >= 3) {
    const easyRuns = recentRuns.filter((r) => r.avgHrPct < 0.78 || (!r.avgHrPct && !r.isWorkout));
    if (easyRuns.length > 0) {
      const avgEasyPace = easyRuns.reduce((sum, r) => sum + r.avgPaceSeconds, 0) / easyRuns.length;
      if (avgEasyPace < paceToSeconds(currentPaces.easy.min) - 15) {
        insights.push({ type: "warning", message: "Your easy runs are faster than prescribed. Slow down to build aerobic base and prevent injury." });
      }
    }
    const workoutRuns = recentRuns.filter((r) => r.isWorkout);
    if (workoutRuns.length >= 2) {
      const avgWorkoutPace = workoutRuns.reduce((sum, r) => sum + r.avgPaceSeconds, 0) / workoutRuns.length;
      const targetIntervalPace = paceToSeconds(currentPaces.interval);
      if (avgWorkoutPace < targetIntervalPace - 10) {
        vdotAdjustment += 1;
        insights.push({ type: "improvement", message: "Your workout paces suggest improved fitness! Adjusting targets up." });
      } else if (avgWorkoutPace > targetIntervalPace + 20) {
        vdotAdjustment -= 1;
        insights.push({ type: "caution", message: "Recent workouts were slower than target. Adjusting paces to be more achievable." });
      }
    }
    const hrRuns = recentRuns.filter((r) => r.avgHeartRate);
    if (hrRuns.length >= 4) {
      const recentHr = hrRuns.slice(0, 2).reduce((s, r) => s + r.avgHeartRate, 0) / 2;
      const olderHr = hrRuns.slice(2, 4).reduce((s, r) => s + r.avgHeartRate, 0) / 2;
      if (recentHr > olderHr * 1.05) {
        insights.push({ type: "fatigue", message: "Heart rate is trending up at similar paces \u2014 possible fatigue. Consider extra recovery." });
      }
    }
  }
  const lastTwoWeeks = recentActivities.filter((a) => {
    const daysAgo = (Date.now() - new Date(a.date).getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo <= 14 && a.type === "running";
  });
  if (lastTwoWeeks.length < 4) {
    insights.push({ type: "consistency", message: "You've had fewer runs than planned recently. Consistency is key \u2014 even short runs help." });
  }
  const adjustedVdot = Math.max(20, Math.min(80, currentVdot + vdotAdjustment));
  return { adjustedVdot, adjustedPaces: trainingPaces(adjustedVdot), insights };
}

function generatePlan({ raceDistance, raceDate, goalTime, currentWeeklyKm, daysPerWeek, recentRaceDistance, recentRaceTime, recentActivities }) {
  const race = RACE_DISTANCES[raceDistance];
  if (!race) throw new Error(`Unknown race distance: ${raceDistance}`);
  let vdot;
  if (recentRaceDistance && recentRaceTime) {
    vdot = estimateVDOT(RACE_DISTANCES[recentRaceDistance]?.km || parseFloat(recentRaceDistance), recentRaceTime);
  } else if (goalTime) {
    vdot = estimateVDOT(race.km, goalTime);
  } else {
    vdot = 40;
  }
  let paces = trainingPaces(vdot);
  let insights = [];
  if (recentActivities && recentActivities.length > 0) {
    const adaptation = adaptPlan(recentActivities, paces, vdot);
    vdot = adaptation.adjustedVdot;
    paces = adaptation.adjustedPaces;
    insights = adaptation.insights;
  }
  const raceDateObj = new Date(raceDate);
  const today = new Date();
  const weeksUntilRace = Math.max(4, Math.floor((raceDateObj - today) / (7 * 24 * 60 * 60 * 1000)));
  const totalWeeks = Math.min(weeksUntilRace, race.weeks);
  const baseVolume = currentWeeklyKm || Math.round(race.km * 1.2);
  const clampedDays = Math.max(3, Math.min(7, daysPerWeek || 4));
  const weeks = [];
  let currentPhaseIdx = 0;
  let phaseWeekCount = 0;
  for (let w = 0; w < totalWeeks; w++) {
    const phaseLength = Math.max(1, Math.round(totalWeeks * PHASES[currentPhaseIdx].pct));
    if (phaseWeekCount >= phaseLength && currentPhaseIdx < PHASES.length - 1) {
      currentPhaseIdx++;
      phaseWeekCount = 0;
    }
    const phase = PHASES[currentPhaseIdx];
    const volume = weeklyVolume(baseVolume, w, totalWeeks, phase.focus);
    const template = weekTemplate(phase.focus, clampedDays);
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() + w * 7);
    const dayOfWeek = startDate.getDay();
    const mondayOffset = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 0 : 8 - dayOfWeek;
    startDate.setDate(startDate.getDate() + mondayOffset);
    const days = [];
    let dayIdx = 0;
    for (let d = 0; d < 7; d++) {
      const dayDate = new Date(startDate);
      dayDate.setDate(dayDate.getDate() + d);
      if (dayIdx < template.length) {
        const spacing = Math.floor(7 / clampedDays);
        const isTrainingDay = d % spacing === 0 || dayIdx === template.length - 1;
        if (isTrainingDay && dayIdx < template.length) {
          const workout = generateWorkout(template[dayIdx], paces, volume, phase.focus, raceDistance);
          days.push({ date: dayDate.toISOString().split("T")[0], dayOfWeek: d, ...workout, completed: false });
          dayIdx++;
        } else {
          days.push({ date: dayDate.toISOString().split("T")[0], dayOfWeek: d, type: "rest", label: "Rest Day", steps: [], completed: false });
        }
      } else {
        days.push({ date: dayDate.toISOString().split("T")[0], dayOfWeek: d, type: "rest", label: "Rest Day", steps: [], completed: false });
      }
    }
    weeks.push({ weekNumber: w + 1, phase: phase.name, focus: phase.focus, totalVolumeKm: volume, days });
    phaseWeekCount++;
  }
  const raceWeek = weeks[weeks.length - 1];
  if (raceWeek) {
    const raceDayIdx = raceWeek.days.findIndex((d) => d.date === raceDate || d.dayOfWeek === 6);
    if (raceDayIdx >= 0) {
      raceWeek.days[raceDayIdx] = { ...raceWeek.days[raceDayIdx], type: "race", label: `Race Day \u2014 ${raceDistance.toUpperCase()}`, description: goalTime ? `Goal: ${Math.floor(goalTime / 60)}:${(goalTime % 60).toString().padStart(2, "0")}` : "Give it your all!", steps: [] };
    }
  }
  return { id: `plan_${Date.now()}`, createdAt: new Date().toISOString(), raceDistance, raceDate, goalTime, totalWeeks, daysPerWeek: clampedDays, vdot: Math.round(vdot * 10) / 10, paces, insights, weeks };
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  try {
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body);
      const { action } = body;
      if (action === "generate") {
        const plan = generatePlan(body);
        const store = getStore("training-plans");
        const userId = body.userId || "default";
        await store.setJSON(`${userId}/current`, plan);
        const history = (await store.get(`${userId}/history`, { type: "json" })) || [];
        history.push({ id: plan.id, raceDistance: plan.raceDistance, raceDate: plan.raceDate, createdAt: plan.createdAt });
        await store.setJSON(`${userId}/history`, history);
        return { statusCode: 200, headers, body: JSON.stringify(plan) };
      }
      if (action === "adapt") {
        const store = getStore("training-plans");
        const userId = body.userId || "default";
        const currentPlan = await store.get(`${userId}/current`, { type: "json" });
        if (!currentPlan) return { statusCode: 404, headers, body: JSON.stringify({ error: "No active plan found" }) };
        const updatedPlan = generatePlan({ ...currentPlan, recentActivities: body.recentActivities });
        updatedPlan.id = currentPlan.id;
        await store.setJSON(`${userId}/current`, updatedPlan);
        return { statusCode: 200, headers, body: JSON.stringify(updatedPlan) };
      }
      if (action === "complete-workout") {
        const store = getStore("training-plans");
        const userId = body.userId || "default";
        const plan = await store.get(`${userId}/current`, { type: "json" });
        if (plan) {
          for (const week of plan.weeks) {
            for (const day of week.days) {
              if (day.date === body.date) { day.completed = true; day.actualData = body.actualData || null; }
            }
          }
          await store.setJSON(`${userId}/current`, plan);
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }
    }
    if (event.httpMethod === "GET") {
      const params = event.queryStringParameters || {};
      const store = getStore("training-plans");
      const userId = params.userId || "default";
      if (params.history === "true") {
        const history = (await store.get(`${userId}/history`, { type: "json" })) || [];
        return { statusCode: 200, headers, body: JSON.stringify(history) };
      }
      const plan = await store.get(`${userId}/current`, { type: "json" });
      return { statusCode: plan ? 200 : 404, headers, body: JSON.stringify(plan || { error: "No active plan" }) };
    }
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (err) {
    console.error("Training plan error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

module.exports.generatePlan = generatePlan;
module.exports.adaptPlan = adaptPlan;
module.exports.trainingPaces = trainingPaces;
module.exports.estimateVDOT = estimateVDOT;
