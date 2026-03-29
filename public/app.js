(function () {
  "use strict";
  let currentPlan = null, currentScreen = "setup", selectedWorkout = null, stravaConnected = false;
  let userId = localStorage.getItem("runforge_userId") || "default";
  let settings = JSON.parse(localStorage.getItem("runforge_settings") || '{"units":"mi"}');

  const RACE_LABELS = { "5k": "5K", "10k": "10K", half: "Half Marathon", marathon: "Marathon", ultra50k: "Ultra 50K" };
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const DAY_NAMES_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  document.addEventListener("DOMContentLoaded", init);

  function init() { checkStravaConnection(); loadExistingPlan(); bindEvents(); setMinDate(); }

  function setMinDate() {
    var d = new Date(); d.setDate(d.getDate() + 28);
    document.getElementById("race-date").min = d.toISOString().split("T")[0];
  }

  async function api(endpoint, options) {
    options = options || {};
    var res = await fetch("/api/" + endpoint, Object.assign({ headers: { "Content-Type": "application/json" } }, options));
    if (!res.ok) { var err = await res.json().catch(function() { return { error: res.statusText }; }); throw new Error(err.error || "API error"); }
    return res.json();
  }

  function showScreen(name) {
    document.querySelectorAll(".screen").forEach(function(s) { s.classList.remove("active"); });
    var screen = document.getElementById("screen-" + name);
    if (screen) { screen.classList.add("active"); currentScreen = name; }
    document.querySelectorAll(".nav-btn").forEach(function(btn) { btn.classList.toggle("active", btn.dataset.screen === name); });
    document.getElementById("bottom-nav").style.display = name === "workout" ? "none" : "flex";
  }

  function bindEvents() {
    document.getElementById("form-create-plan").addEventListener("submit", handleCreatePlan);
    document.querySelectorAll(".nav-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var screen = btn.dataset.screen;
        if (screen === "dashboard" && currentPlan) showScreen("dashboard");
        else if (screen === "dashboard") showScreen("setup");
        else if (screen === "activities") { showScreen("dashboard"); if (!stravaConnected) toast("Connect Strava in Settings to see activities", "warning"); }
        else if (screen === "settings") showScreen("settings");
      });
    });
    document.getElementById("btn-garmin-status").addEventListener("click", function() { showScreen("settings"); });
    document.getElementById("btn-settings").addEventListener("click", function() { showScreen("settings"); });
    document.getElementById("btn-back").addEventListener("click", function() { showScreen("dashboard"); });
    document.getElementById("btn-back-settings").addEventListener("click", function() { showScreen(currentPlan ? "dashboard" : "setup"); });
    document.getElementById("btn-adapt").addEventListener("click", handleAdaptPlan);
    document.getElementById("btn-new-plan").addEventListener("click", function() { showScreen("setup"); });
    document.getElementById("btn-push-week").addEventListener("click", handleDownloadWeekFit);
    document.getElementById("btn-push-single").addEventListener("click", handleDownloadSingleFit);
    document.getElementById("btn-complete").addEventListener("click", handleComplete);
    document.getElementById("btn-connect-garmin").addEventListener("click", handleConnectStrava);
    document.querySelectorAll(".view-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        document.querySelectorAll(".view-btn").forEach(function(b) { b.classList.remove("active"); });
        btn.classList.add("active");
        var view = btn.dataset.view;
        document.getElementById("plan-calendar").style.display = view === "calendar" ? "flex" : "none";
        document.getElementById("plan-list").style.display = view === "list" ? "flex" : "none";
      });
    });
    document.getElementById("setting-units").addEventListener("change", function(e) { settings.units = e.target.value; saveSettings(); if (currentPlan) renderDashboard(); });
    document.getElementById("setting-autopush").addEventListener("change", function(e) { settings.autoPush = e.target.checked; saveSettings(); });
    document.getElementById("setting-autoadapt").addEventListener("change", function(e) { settings.autoAdapt = e.target.checked; saveSettings(); });
  }

  function saveSettings() { localStorage.setItem("runforge_settings", JSON.stringify(settings)); }

  function checkStravaConnection() {
    var params = new URLSearchParams(window.location.search);
    if (params.get("strava") === "connected") {
      var newUserId = params.get("userId");
      if (newUserId) { userId = newUserId; localStorage.setItem("runforge_userId", userId); }
      stravaConnected = true; updateConnectionUI(); toast("Connected to Strava!", "success");
      window.history.replaceState({}, "", "/");
    } else if (userId !== "default") { stravaConnected = true; updateConnectionUI(); }
  }

  function updateConnectionUI() {
    if (!stravaConnected) return;
    var dot = document.querySelector("#btn-garmin-status .status-dot");
    var connDot = document.querySelector(".connection-dot");
    var connText = document.querySelector(".connection-info span:last-child");
    var connBtn = document.getElementById("btn-connect-garmin");
    if (dot) { dot.classList.remove("disconnected"); dot.classList.add("connected"); }
    if (connDot) { connDot.classList.remove("disconnected"); connDot.classList.add("connected"); }
    if (connText) connText.textContent = "Connected to Strava";
    if (connBtn) connBtn.textContent = "Reconnect";
  }

  async function handleConnectStrava() {
    try { toast("Connecting to Strava..."); var data = await api("strava-auth"); if (data.authorizeUrl) window.location.href = data.authorizeUrl; }
    catch (err) { toast(err.message, "error"); }
  }

  async function loadExistingPlan() {
    try { var plan = await api("training-plan?userId=" + userId); if (plan && plan.weeks) { currentPlan = plan; renderDashboard(); showScreen("dashboard"); } }
    catch (e) { /* No plan yet */ }
  }

  async function handleCreatePlan(e) {
    e.preventDefault();
    var btn = e.target.querySelector('button[type="submit"]');
    var origText = btn.innerHTML;
    btn.innerHTML = '<span class="loading-spinner"></span> Generating...'; btn.disabled = true;
    try {
      var goalH = parseInt(document.getElementById("goal-hours").value) || 0;
      var goalM = parseInt(document.getElementById("goal-minutes").value) || 0;
      var goalS = parseInt(document.getElementById("goal-seconds").value) || 0;
      var goalTime = (goalH > 0 || goalM > 0 || goalS > 0) ? goalH * 60 + goalM + goalS / 60 : null;
      var recentH = parseInt(document.getElementById("recent-h").value) || 0;
      var recentM = parseInt(document.getElementById("recent-m").value) || 0;
      var recentS = parseInt(document.getElementById("recent-s").value) || 0;
      var recentTime = (recentH > 0 || recentM > 0) ? recentH * 60 + recentM + recentS / 60 : null;
      var weeklyInput = parseInt(document.getElementById("weekly-km").value) || null;
      var weeklyKm = weeklyInput ? Math.round(weeklyInput * 1.60934) : null;
      var body = { action: "generate", userId: userId, raceDistance: document.getElementById("race-distance").value, raceDate: document.getElementById("race-date").value, goalTime: goalTime, daysPerWeek: parseInt(document.getElementById("days-per-week").value), currentWeeklyKm: weeklyKm, recentRaceDistance: document.getElementById("recent-race-dist").value || null, recentRaceTime: recentTime };
      currentPlan = await api("training-plan", { method: "POST", body: JSON.stringify(body) });
      renderDashboard(); showScreen("dashboard"); toast("Training plan created!", "success");
    } catch (err) { toast(err.message, "error"); }
    finally { btn.innerHTML = origText; btn.disabled = false; }
  }

  async function handleAdaptPlan() {
    var btn = document.getElementById("btn-adapt");
    var origText = btn.innerHTML;
    btn.innerHTML = '<span class="loading-spinner"></span> Adapting...'; btn.disabled = true;
    try {
      var activities = [];
      if (stravaConnected) { var data = await api("strava-activities?userId=" + userId + "&days=30"); activities = data.activities || []; }
      currentPlan = await api("training-plan", { method: "POST", body: JSON.stringify({ action: "adapt", userId: userId, recentActivities: activities }) });
      renderDashboard(); toast("Plan adapted based on your recent runs!", "success");
    } catch (err) { toast(err.message, "error"); }
    finally { btn.innerHTML = origText; btn.disabled = false; }
  }

  async function downloadFit(workout, date) {
    try {
      var res = await fetch("/api/generate-fit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workout: workout, date: date }) });
      if (!res.ok) throw new Error("Failed to generate FIT file");
      var blob = await res.blob();
      var filename = "RunForge_" + (workout.label || "workout").replace(/[^a-zA-Z0-9]/g, "_") + "_" + (date || "today") + ".fit";
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
      return true;
    } catch (err) { toast(err.message, "error"); return false; }
  }

  async function handleDownloadWeekFit() {
    if (!currentPlan) return;
    var today = new Date().toISOString().split("T")[0];
    var currentWeek = currentPlan.weeks.find(function(w) { return w.days.some(function(d) { return d.date >= today; }); });
    if (!currentWeek) { toast("No current week found", "warning"); return; }
    var workouts = currentWeek.days.filter(function(d) { return d.type !== "rest" && d.steps && d.steps.length > 0; });
    if (workouts.length === 0) { toast("No workouts this week", "warning"); return; }
    toast("Downloading " + workouts.length + " workout files...");
    var downloaded = 0;
    for (var i = 0; i < workouts.length; i++) {
      var ok = await downloadFit(workouts[i], workouts[i].date);
      if (ok) downloaded++;
      await new Promise(function(r) { setTimeout(r, 500); });
    }
    toast(downloaded + " .FIT files downloaded! Upload to Garmin Connect to sync.", "success");
  }

  async function handleDownloadSingleFit() {
    if (!selectedWorkout) return;
    toast("Generating .FIT file...");
    var ok = await downloadFit(selectedWorkout, selectedWorkout.date);
    if (ok) toast("FIT file downloaded! Upload to Garmin Connect to sync to your Fenix.", "success");
  }

  async function handleComplete() {
    if (!selectedWorkout) return;
    try {
      await api("training-plan", { method: "POST", body: JSON.stringify({ action: "complete-workout", userId: userId, date: selectedWorkout.date }) });
      currentPlan.weeks.forEach(function(week) { week.days.forEach(function(day) { if (day.date === selectedWorkout.date) day.completed = true; }); });
      toast("Workout marked complete!", "success"); renderDashboard(); showScreen("dashboard");
    } catch (err) { toast(err.message, "error"); }
  }

  function renderDashboard() {
    if (!currentPlan) return;
    var plan = currentPlan;
    var useKm = settings.units !== "mi";
    var unitLabel = useKm ? "km" : "mi";
    document.getElementById("race-badge").textContent = plan.raceDistance.toUpperCase();
    document.getElementById("race-name").textContent = RACE_LABELS[plan.raceDistance] || plan.raceDistance;
    document.getElementById("race-date-display").textContent = formatDate(plan.raceDate);
    document.getElementById("stat-weeks").textContent = plan.totalWeeks;
    document.getElementById("stat-vdot").textContent = plan.vdot;
    var today = new Date().toISOString().split("T")[0];
    var currentWeek = plan.weeks.find(function(w) { return w.days.some(function(d) { return d.date >= today; }); }) || plan.weeks[0];
    document.getElementById("stat-phase").textContent = currentWeek ? currentWeek.phase : "-";
    renderInsights(plan.insights);
    renderWeekWorkouts(currentWeek, today);
    document.getElementById("week-title").textContent = currentWeek ? "Week " + currentWeek.weekNumber + " - " + currentWeek.phase : "This Week";
    renderCalendar(plan.weeks, today);
    renderListView(plan.weeks, useKm, unitLabel);
    renderPaces(plan.paces, useKm, unitLabel);
  }

  function renderInsights(insights) {
    var container = document.getElementById("insights-container");
    if (!insights || insights.length === 0) { container.innerHTML = ""; return; }
    container.innerHTML = insights.map(function(i) {
      var icon = '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
      if (i.type === "improvement") icon = '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>';
      if (i.type === "fatigue") icon = '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>';
      return '<div class="insight ' + i.type + '"><svg class="insight-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + icon + '</svg><span>' + i.message + '</span></div>';
    }).join("");
  }

  function renderWeekWorkouts(week, today) {
    var container = document.getElementById("week-workouts");
    if (!week) { container.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:20px">No current week</p>'; return; }
    container.innerHTML = week.days.map(function(day) {
      var date = new Date(day.date + "T12:00:00");
      var dayName = DAY_NAMES[day.dayOfWeek] || DAY_NAMES[date.getDay() === 0 ? 6 : date.getDay() - 1];
      var dayNum = date.getDate();
      var isToday = day.date === today;
      var effortClass = "effort-" + (day.effort || (day.type === "rest" ? "none" : "easy"));
      var brief = "";
      if (day.steps && day.steps.length > 0) { brief = day.steps.filter(function(s) { return s.type !== "repeat"; }).map(function(s) { return s.distance + (s.unit === "km" ? "km" : s.unit === "m" ? "m" : ""); }).join(" + "); }
      return '<div class="workout-card ' + (day.completed ? "completed" : "") + " " + (isToday ? "today" : "") + '" onclick="window._openWorkout(\'' + day.date + '\')"><div class="workout-day-col"><div class="workout-day-name">' + dayName + '</div><div class="workout-day-num">' + dayNum + '</div></div><div class="workout-effort-dot ' + effortClass + '"></div><div class="workout-info"><div class="workout-type-label">' + (day.label || "Rest Day") + '</div><div class="workout-brief">' + brief + '</div></div><svg class="workout-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>';
    }).join("");
  }

  function renderCalendar(weeks, today) {
    document.getElementById("plan-calendar").innerHTML = weeks.map(function(week) {
      var isCurrentWeek = week.days.some(function(d) { return d.date === today; });
      var daysHtml = week.days.map(function(day) {
        var date = new Date(day.date + "T12:00:00");
        var effortClass = day.effort ? "effort-" + day.effort : day.type === "rest" ? "effort-none" : "effort-easy";
        var typeLabel = day.type === "rest" ? "" : (day.label || "").split(" ")[0];
        return '<div class="calendar-day ' + (day.completed ? "completed" : "") + '" onclick="window._openWorkout(\'' + day.date + '\')"><span class="calendar-day-num">' + date.getDate() + '</span>' + (day.type !== "rest" ? '<span class="calendar-day-dot ' + effortClass + '"></span>' : '') + '<span class="calendar-day-type">' + typeLabel + '</span></div>';
      }).join("");
      return '<div class="calendar-week ' + (isCurrentWeek ? "current" : "") + '"><div class="calendar-week-header" onclick="this.parentElement.classList.toggle(\'collapsed\')"><span class="week-label">Week ' + week.weekNumber + ' - ' + week.totalVolumeKm + 'km</span><span class="week-phase phase-' + week.phase + '">' + week.phase + '</span></div><div class="calendar-week-days">' + daysHtml + '</div></div>';
    }).join("");
  }

  function renderListView(weeks, useKm, unitLabel) {
    document.getElementById("plan-list").innerHTML = weeks.map(function(week) {
      var daysHtml = week.days.filter(function(d) { return d.type !== "rest"; }).map(function(day) {
        return '<div class="plan-list-day" onclick="window._openWorkout(\'' + day.date + '\')"><span class="workout-effort-dot effort-' + (day.effort || "easy") + '" style="width:8px;height:8px"></span><span class="plan-list-day-date">' + formatShortDate(day.date) + '</span><span class="plan-list-day-type">' + day.label + '</span></div>';
      }).join("");
      return '<div class="plan-list-week"><div class="plan-list-week-header"><span>Week ' + week.weekNumber + ' - ' + week.phase + '</span><span class="plan-list-volume">' + week.totalVolumeKm + unitLabel + '</span></div>' + daysHtml + '</div>';
    }).join("");
  }

  function renderPaces(paces, useKm, unitLabel) {
    var grid = document.getElementById("paces-grid");
    if (!paces) return;
    function convert(pace) {
      if (!useKm) { var parts = pace.split(":"); var secPerKm = parseInt(parts[0]) * 60 + parseInt(parts[1] || 0); var secPerMi = secPerKm * 1.60934; var mm = Math.floor(secPerMi / 60); var ss = Math.round(secPerMi % 60); return mm + ":" + (ss < 10 ? "0" : "") + ss; }
      return pace;
    }
    var items = [
      { zone: "Easy", value: convert(paces.easy.min) + "-" + convert(paces.easy.max), color: "var(--green)" },
      { zone: "Marathon", value: convert(paces.marathon), color: "#f97316" },
      { zone: "Threshold", value: convert(paces.threshold), color: "var(--amber)" },
      { zone: "Interval", value: convert(paces.interval), color: "var(--red)" },
      { zone: "Repetition", value: convert(paces.repetition), color: "var(--purple)" }
    ];
    grid.innerHTML = items.map(function(i) { return '<div class="pace-item"><span class="pace-zone">' + i.zone + '</span><span class="pace-value" style="color:' + i.color + '">' + i.value + '</span><span class="pace-unit">/' + unitLabel + '</span></div>'; }).join("");
  }

  window._openWorkout = function(dateStr) {
    if (!currentPlan) return;
    var workout = null;
    for (var w = 0; w < currentPlan.weeks.length; w++) {
      for (var d = 0; d < currentPlan.weeks[w].days.length; d++) {
        if (currentPlan.weeks[w].days[d].date === dateStr) { workout = currentPlan.weeks[w].days[d]; break; }
      }
    }
    if (!workout || workout.type === "rest") return;
    selectedWorkout = workout; renderWorkoutDetail(workout); showScreen("workout");
  };

  function renderWorkoutDetail(workout) {
    document.getElementById("workout-date").textContent = formatDateLong(workout.date);
    document.getElementById("workout-title").textContent = workout.label;
    document.getElementById("workout-desc").textContent = workout.description || "";
    document.getElementById("workout-steps").innerHTML = renderSteps(workout.steps || []);
    var completeBtn = document.getElementById("btn-complete");
    if (workout.completed) { completeBtn.textContent = "Completed"; completeBtn.disabled = true; completeBtn.style.opacity = "0.5"; }
    else { completeBtn.textContent = "Mark Complete"; completeBtn.disabled = false; completeBtn.style.opacity = "1"; }
  }

  function renderSteps(steps) {
    return steps.map(function(step) {
      if (step.type === "repeat") return '<div class="step-repeat"><div class="step-repeat-header">' + step.reps + 'x Repeat</div>' + renderSteps(step.steps) + '</div>';
      var paceStr = formatPace(step.pace);
      var distStr = step.distance + (step.unit === "km" ? " km" : step.unit === "m" ? "m" : "");
      return '<div class="step-card step-' + step.type + '"><div class="step-info"><div class="step-label">' + step.label + '</div><div class="step-detail">' + distStr + '</div></div>' + (paceStr ? '<div class="step-pace">' + paceStr + '</div>' : '') + '</div>';
    }).join("");
  }

  function formatPace(pace) {
    if (!pace) return "";
    if (typeof pace === "string") return pace;
    if (pace.min && pace.max && pace.min !== pace.max) return pace.min + "-" + pace.max;
    return pace.min || pace.max || "";
  }

  function formatDate(dateStr) { return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); }
  function formatDateLong(dateStr) { var d = new Date(dateStr + "T12:00:00"); var dayIdx = d.getDay() === 0 ? 6 : d.getDay() - 1; return DAY_NAMES_LONG[dayIdx] + ", " + d.toLocaleDateString("en-US", { month: "long", day: "numeric" }); }
  function formatShortDate(dateStr) { var d = new Date(dateStr + "T12:00:00"); return (d.getMonth() + 1) + "/" + d.getDate(); }

  function toast(message, type) {
    type = type || "info";
    var container = document.getElementById("toast-container");
    var el = document.createElement("div"); el.className = "toast " + type; el.textContent = message;
    container.appendChild(el); setTimeout(function() { el.remove(); }, 3000);
  }
})();
