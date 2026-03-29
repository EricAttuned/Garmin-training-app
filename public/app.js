// RunForge — Adaptive Training App
(function () {
  "use strict";
  let currentPlan = null, currentScreen = "setup", selectedWorkout = null, garminConnected = false;
  let userId = localStorage.getItem("runforge_userId") || "default";
  let settings = JSON.parse(localStorage.getItem("runforge_settings") || "{}");
  const RACE_LABELS = { "5k": "5K", "10k": "10K", half: "Half Marathon", marathon: "Marathon", ultra50k: "Ultra 50K" };
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const DAY_NAMES_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  document.addEventListener("DOMContentLoaded", init);

  function init() { checkGarminConnection(); loadExistingPlan(); bindEvents(); setMinDate(); }

  function setMinDate() {
    const dateInput = document.getElementById("race-date");
    const today = new Date(); today.setDate(today.getDate() + 28);
    dateInput.min = today.toISOString().split("T")[0];
  }

  async function api(endpoint, options = {}) {
    const res = await fetch(`/api/${endpoint}`, { headers: { "Content-Type": "application/json" }, ...options });
    if (!res.ok) { const err = await res.json().catch(() => ({ error: res.statusText })); throw new Error(err.error || "API error"); }
    return res.json();
  }

  function showScreen(name) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    const screen = document.getElementById(`screen-${name}`);
    if (screen) { screen.classList.add("active"); currentScreen = name; }
    document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.screen === name));
    document.getElementById("bottom-nav").style.display = name === "workout" ? "none" : "flex";
  }

  function bindEvents() {
    document.getElementById("form-create-plan").addEventListener("submit", handleCreatePlan);
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const screen = btn.dataset.screen;
        if (screen === "dashboard" && currentPlan) showScreen("dashboard");
        else if (screen === "dashboard") showScreen("setup");
        else if (screen === "activities") showActivities();
        else if (screen === "settings") showScreen("settings");
      });
    });
    document.getElementById("btn-garmin-status").addEventListener("click", () => showScreen("settings"));
    document.getElementById("btn-settings").addEventListener("click", () => showScreen("settings"));
    document.getElementById("btn-back").addEventListener("click", () => showScreen("dashboard"));
    document.getElementById("btn-back-settings").addEventListener("click", () => showScreen(currentPlan ? "dashboard" : "setup"));
    document.getElementById("btn-adapt").addEventListener("click", handleAdaptPlan);
    document.getElementById("btn-new-plan").addEventListener("click", () => showScreen("setup"));
    document.getElementById("btn-push-week").addEventListener("click", handlePushWeek);
    document.getElementById("btn-push-single").addEventListener("click", handlePushSingle);
    document.getElementById("btn-complete").addEventListener("click", handleComplete);
    document.getElementById("btn-connect-garmin").addEventListener("click", handleConnectGarmin);
    document.querySelectorAll(".view-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".view-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const view = btn.dataset.view;
        document.getElementById("plan-calendar").style.display = view === "calendar" ? "flex" : "none";
        document.getElementById("plan-list").style.display = view === "list" ? "flex" : "none";
      });
    });
    document.getElementById("setting-units").addEventListener("change", (e) => { settings.units = e.target.value; saveSettings(); if (currentPlan) renderDashboard(); });
    document.getElementById("setting-autopush").addEventListener("change", (e) => { settings.autoPush = e.target.checked; saveSettings(); });
    document.getElementById("setting-autoadapt").addEventListener("change", (e) => { settings.autoAdapt = e.target.checked; saveSettings(); });
  }

  function saveSettings() { localStorage.setItem("runforge_settings", JSON.stringify(settings)); }

  function checkGarminConnection() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("garmin") === "connected") {
      const newUserId = params.get("userId");
      if (newUserId) { userId = newUserId; localStorage.setItem("runforge_userId", userId); }
      garminConnected = true; updateGarminUI(); toast("Connected to Garmin!", "success");
      window.history.replaceState({}, "", "/");
    } else if (userId !== "default") { garminConnected = true; updateGarminUI(); }
  }

  function updateGarminUI() {
    const dot = document.querySelector("#btn-garmin-status .status-dot");
    const connDot = document.querySelector(".connection-dot");
    const connText = document.querySelector(".connection-info span:last-child");
    const connBtn = document.getElementById("btn-connect-garmin");
    if (garminConnected) {
      dot?.classList.remove("disconnected"); dot?.classList.add("connected");
      connDot?.classList.remove("disconnected"); connDot?.classList.add("connected");
      if (connText) connText.textContent = "Connected";
      if (connBtn) connBtn.textContent = "Reconnect";
    }
  }

  async function handleConnectGarmin() {
    try { toast("Connecting to Garmin..."); const data = await api("garmin-auth"); if (data.authorizeUrl) window.location.href = data.authorizeUrl; }
    catch (err) { toast(err.message, "error"); }
  }

  async function loadExistingPlan() {
    try { const plan = await api(`training-plan?userId=${userId}`); if (plan && plan.weeks) { currentPlan = plan; renderDashboard(); showScreen("dashboard"); } }
    catch { /* No plan yet */ }
  }

  async function handleCreatePlan(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const origText = btn.innerHTML;
    btn.innerHTML = '<span class="loading-spinner"></span> Generating...'; btn.disabled = true;
    try {
      const goalH = parseInt(document.getElementById("goal-hours").value) || 0;
      const goalM = parseInt(document.getElementById("goal-minutes").value) || 0;
      const goalS = parseInt(document.getElementById("goal-seconds").value) || 0;
      const goalTime = goalH > 0 || goalM > 0 || goalS > 0 ? goalH * 60 + goalM + goalS / 60 : null;
      const recentH = parseInt(document.getElementById("recent-h").value) || 0;
      const recentM = parseInt(document.getElementById("recent-m").value) || 0;
      const recentS = parseInt(document.getElementById("recent-s").value) || 0;
      const recentTime = recentH > 0 || recentM > 0 ? recentH * 60 + recentM + recentS / 60 : null;
      const body = { action: "generate", userId, raceDistance: document.getElementById("race-distance").value, raceDate: document.getElementById("race-date").value, goalTime, daysPerWeek: parseInt(document.getElementById("days-per-week").value), currentWeeklyKm: parseInt(document.getElementById("weekly-km").value) || null, recentRaceDistance: document.getElementById("recent-race-dist").value || null, recentRaceTime: recentTime };
      currentPlan = await api("training-plan", { method: "POST", body: JSON.stringify(body) });
      renderDashboard(); showScreen("dashboard"); toast("Training plan created!", "success");
    } catch (err) { toast(err.message, "error"); }
    finally { btn.innerHTML = origText; btn.disabled = false; }
  }

  async function handleAdaptPlan() {
    const btn = document.getElementById("btn-adapt");
    const origText = btn.innerHTML;
    btn.innerHTML = '<span class="loading-spinner"></span> Adapting...'; btn.disabled = true;
    try {
      let activities = [];
      if (garminConnected) { const data = await api(`garmin-activities?userId=${userId}&days=30`); activities = data.activities || []; }
      currentPlan = await api("training-plan", { method: "POST", body: JSON.stringify({ action: "adapt", userId, recentActivities: activities }) });
      renderDashboard(); toast("Plan adapted based on your recent runs!", "success");
    } catch (err) { toast(err.message, "error"); }
    finally { btn.innerHTML = origText; btn.disabled = false; }
  }

  async function handlePushWeek() {
    if (!garminConnected) { toast("Connect your Garmin first in Settings", "warning"); return; }
    try { toast("Pushing workouts to your Garmin..."); const result = await api("garmin-push-workout", { method: "POST", body: JSON.stringify({ userId, pushAll: true }) }); toast(`${result.pushed} workouts pushed to your watch!`, "success"); }
    catch (err) { toast(err.message, "error"); }
  }

  async function handlePushSingle() {
    if (!garminConnected) { toast("Connect your Garmin first in Settings", "warning"); return; }
    if (!selectedWorkout) return;
    try { toast("Pushing workout to Garmin..."); await api("garmin-push-workout", { method: "POST", body: JSON.stringify({ userId, workout: selectedWorkout, date: selectedWorkout.date }) }); toast("Workout sent to your watch!", "success"); }
    catch (err) { toast(err.message, "error"); }
  }

  async function handleComplete() {
    if (!selectedWorkout) return;
    try {
      await api("training-plan", { method: "POST", body: JSON.stringify({ action: "complete-workout", userId, date: selectedWorkout.date }) });
      for (const week of currentPlan.weeks) for (const day of week.days) if (day.date === selectedWorkout.date) day.completed = true;
      toast("Workout marked complete!", "success"); renderDashboard(); showScreen("dashboard");
    } catch (err) { toast(err.message, "error"); }
  }

  async function showActivities() {
    showScreen("dashboard");
    if (!garminConnected) toast("Connect Garmin in Settings to see activities", "warning");
  }

  function renderDashboard() {
    if (!currentPlan) return;
    const plan = currentPlan, useKm = settings.units !== "mi", unitLabel = useKm ? "km" : "mi";
    document.getElementById("race-badge").textContent = plan.raceDistance.toUpperCase();
    document.getElementById("race-name").textContent = RACE_LABELS[plan.raceDistance] || plan.raceDistance;
    document.getElementById("race-date-display").textContent = formatDate(plan.raceDate);
    document.getElementById("stat-weeks").textContent = plan.totalWeeks;
    document.getElementById("stat-vdot").textContent = plan.vdot;
    const today = new Date().toISOString().split("T")[0];
    const currentWeek = plan.weeks.find((w) => w.days.some((d) => d.date >= today)) || plan.weeks[0];
    document.getElementById("stat-phase").textContent = currentWeek?.phase || "\u2014";
    renderInsights(plan.insights); renderWeekWorkouts(currentWeek, today);
    document.getElementById("week-title").textContent = currentWeek ? `Week ${currentWeek.weekNumber} \u2014 ${currentWeek.phase}` : "This Week";
    renderCalendar(plan.weeks, today); renderListView(plan.weeks, useKm, unitLabel); renderPaces(plan.paces, useKm, unitLabel);
  }

  function renderInsights(insights) {
    const container = document.getElementById("insights-container");
    if (!insights || insights.length === 0) { container.innerHTML = ""; return; }
    container.innerHTML = insights.map((i) => `<div class="insight ${i.type}"><svg class="insight-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${i.type === "improvement" ? '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' : i.type === "fatigue" ? '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>' : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'}</svg><span>${i.message}</span></div>`).join("");
  }

  function renderWeekWorkouts(week, today) {
    const container = document.getElementById("week-workouts");
    if (!week) { container.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:20px">No current week</p>'; return; }
    container.innerHTML = week.days.map((day) => {
      const date = new Date(day.date + "T12:00:00");
      const dayName = DAY_NAMES[day.dayOfWeek] || DAY_NAMES[date.getDay() === 0 ? 6 : date.getDay() - 1];
      const dayNum = date.getDate(), isToday = day.date === today;
      const effortClass = `effort-${day.effort || (day.type === "rest" ? "none" : "easy")}`;
      const brief = day.steps?.length > 0 ? day.steps.filter((s) => s.type !== "repeat").map((s) => `${s.distance}${s.unit === "km" ? "km" : s.unit === "m" ? "m" : ""}`).join(" + ") || "" : "";
      return `<div class="workout-card ${day.completed ? "completed" : ""} ${isToday ? "today" : ""}" data-date="${day.date}" onclick="window._openWorkout('${day.date}')"><div class="workout-day-col"><div class="workout-day-name">${dayName}</div><div class="workout-day-num">${dayNum}</div></div><div class="workout-effort-dot ${effortClass}"></div><div class="workout-info"><div class="workout-type-label">${day.label || "Rest Day"}</div><div class="workout-brief">${brief}</div></div><svg class="workout-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>`;
    }).join("");
  }

  function renderCalendar(weeks, today) {
    document.getElementById("plan-calendar").innerHTML = weeks.map((week) => {
      const isCurrentWeek = week.days.some((d) => d.date === today);
      return `<div class="calendar-week ${isCurrentWeek ? "current" : ""}"><div class="calendar-week-header" onclick="this.parentElement.classList.toggle('collapsed')"><span class="week-label">Week ${week.weekNumber} \u2014 ${week.totalVolumeKm}km</span><span class="week-phase phase-${week.phase}">${week.phase}</span></div><div class="calendar-week-days">${week.days.map((day) => { const date = new Date(day.date + "T12:00:00"); const effortClass = day.effort ? `effort-${day.effort}` : day.type === "rest" ? "effort-none" : "effort-easy"; const typeLabel = day.type === "rest" ? "" : (day.label || "").split(" ")[0]; return `<div class="calendar-day ${day.completed ? "completed" : ""}" onclick="window._openWorkout('${day.date}')"><span class="calendar-day-num">${date.getDate()}</span>${day.type !== "rest" ? `<span class="calendar-day-dot ${effortClass}"></span>` : ""}<span class="calendar-day-type">${typeLabel}</span></div>`; }).join("")}</div></div>`;
    }).join("");
  }

  function renderListView(weeks, useKm, unitLabel) {
    document.getElementById("plan-list").innerHTML = weeks.map((week) => `<div class="plan-list-week"><div class="plan-list-week-header"><span>Week ${week.weekNumber} \u2014 ${week.phase}</span><span class="plan-list-volume">${week.totalVolumeKm}${unitLabel}</span></div>${week.days.filter((d) => d.type !== "rest").map((day) => `<div class="plan-list-day" onclick="window._openWorkout('${day.date}')"><span class="workout-effort-dot effort-${day.effort || "easy"}" style="width:8px;height:8px"></span><span class="plan-list-day-date">${formatShortDate(day.date)}</span><span class="plan-list-day-type">${day.label}</span></div>`).join("")}</div>`).join("");
  }

  function renderPaces(paces, useKm, unitLabel) {
    const grid = document.getElementById("paces-grid"); if (!paces) return;
    const convert = (pace) => { if (!useKm) { const [m, s] = pace.split(":").map(Number); const secPerMi = (m * 60 + (s || 0)) * 1.60934; const mm = Math.floor(secPerMi / 60); const ss = Math.round(secPerMi % 60); return `${mm}:${ss.toString().padStart(2, "0")}`; } return pace; };
    const items = [{ zone: "Easy", value: `${convert(paces.easy.min)}\u2013${convert(paces.easy.max)}`, color: "var(--green)" }, { zone: "Marathon", value: convert(paces.marathon), color: "#f97316" }, { zone: "Threshold", value: convert(paces.threshold), color: "var(--amber)" }, { zone: "Interval", value: convert(paces.interval), color: "var(--red)" }, { zone: "Repetition", value: convert(paces.repetition), color: "var(--purple)" }];
    grid.innerHTML = items.map((i) => `<div class="pace-item"><span class="pace-zone">${i.zone}</span><span class="pace-value" style="color:${i.color}">${i.value}</span><span class="pace-unit">/${unitLabel}</span></div>`).join("");
  }

  window._openWorkout = function (dateStr) {
    if (!currentPlan) return;
    let workout = null;
    for (const week of currentPlan.weeks) for (const day of week.days) if (day.date === dateStr) { workout = day; break; }
    if (!workout || workout.type === "rest") return;
    selectedWorkout = workout; renderWorkoutDetail(workout); showScreen("workout");
  };

  function renderWorkoutDetail(workout) {
    document.getElementById("workout-date").textContent = formatDateLong(workout.date);
    document.getElementById("workout-title").textContent = workout.label;
    document.getElementById("workout-desc").textContent = workout.description || "";
    document.getElementById("workout-steps").innerHTML = renderSteps(workout.steps || []);
    const completeBtn = document.getElementById("btn-complete");
    if (workout.completed) { completeBtn.textContent = "Completed"; completeBtn.disabled = true; completeBtn.style.opacity = "0.5"; }
    else { completeBtn.textContent = "Mark Complete"; completeBtn.disabled = false; completeBtn.style.opacity = "1"; }
  }

  function renderSteps(steps) {
    return steps.map((step) => {
      if (step.type === "repeat") return `<div class="step-repeat"><div class="step-repeat-header">${step.reps}x Repeat</div>${renderSteps(step.steps)}</div>`;
      const paceStr = formatPace(step.pace);
      const distStr = `${step.distance}${step.unit === "km" ? " km" : step.unit === "m" ? "m" : ""}`;
      return `<div class="step-card step-${step.type}"><div class="step-info"><div class="step-label">${step.label}</div><div class="step-detail">${distStr}</div></div>${paceStr ? `<div class="step-pace">${paceStr}</div>` : ""}</div>`;
    }).join("");
  }

  function formatPace(pace) { if (!pace) return ""; if (typeof pace === "string") return pace; if (pace.min && pace.max && pace.min !== pace.max) return `${pace.min}\u2013${pace.max}`; return pace.min || pace.max || ""; }
  function formatDate(dateStr) { return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); }
  function formatDateLong(dateStr) { const d = new Date(dateStr + "T12:00:00"); const dayIdx = d.getDay() === 0 ? 6 : d.getDay() - 1; return `${DAY_NAMES_LONG[dayIdx]}, ${d.toLocaleDateString("en-US", { month: "long", day: "numeric" })}`; }
  function formatShortDate(dateStr) { const d = new Date(dateStr + "T12:00:00"); return `${d.getMonth() + 1}/${d.getDate()}`; }
  function toast(message, type = "info") { const container = document.getElementById("toast-container"); const el = document.createElement("div"); el.className = `toast ${type}`; el.textContent = message; container.appendChild(el); setTimeout(() => el.remove(), 3000); }
})();
