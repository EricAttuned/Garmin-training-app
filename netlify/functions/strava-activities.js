const { getStore } = require("@netlify/blobs");
async function refreshToken(userId, userData) {
  if (Date.now() / 1000 < userData.expiresAt - 300) return userData.accessToken;
  const response = await fetch("https://www.strava.com/oauth/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: process.env.STRAVA_CLIENT_ID, client_secret: process.env.STRAVA_CLIENT_SECRET, refresh_token: userData.refreshToken, grant_type: "refresh_token" }) });
  if (!response.ok) throw new Error("Failed to refresh Strava token. Please reconnect.");
  const data = await response.json();
  const store = getStore("strava-users");
  await store.setJSON(userId, Object.assign({}, userData, { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: data.expires_at }));
  return data.access_token;
}
function parseActivity(raw) {
  var dur = (raw.moving_time || 0) / 60, dist = (raw.distance || 0) / 1000, pace = dist > 0 ? (dur * 60) / dist : 0;
  return { id: raw.id, date: (raw.start_date_local || "").split("T")[0], type: (raw.sport_type === "Run" || raw.sport_type === "TrailRun" || raw.type === "Run") ? "running" : "other", distanceKm: Math.round(dist * 100) / 100, durationMinutes: Math.round(dur * 10) / 10, avgPaceSeconds: Math.round(pace), avgHeartRate: raw.average_heartrate || null, maxHeartRate: raw.max_heartrate || null, avgHrPct: raw.average_heartrate && raw.max_heartrate ? raw.average_heartrate / raw.max_heartrate : null, calories: raw.calories || null, elevationGainM: raw.total_elevation_gain || null, isWorkout: raw.workout_type === 1 || raw.workout_type === 3, name: raw.name || null };
}
exports.handler = async (event) => {
  var headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: headers, body: "" };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: headers, body: JSON.stringify({ error: "Method not allowed" }) };
  var params = event.queryStringParameters || {};
  var userId = params.userId, days = parseInt(params.days) || 30;
  if (!userId) return { statusCode: 400, headers: headers, body: JSON.stringify({ error: "userId required" }) };
  try {
    var userStore = getStore("strava-users");
    var user = await userStore.get(userId, { type: "json" });
    if (!user) return { statusCode: 401, headers: headers, body: JSON.stringify({ error: "Not connected to Strava." }) };
    var accessToken = await refreshToken(userId, user);
    var after = Math.floor((Date.now() - days * 86400000) / 1000);
    var response = await fetch("https://www.strava.com/api/v3/athlete/activities?after=" + after + "&per_page=100", { headers: { Authorization: "Bearer " + accessToken } });
    if (!response.ok) throw new Error("Strava API error: " + response.status);
    var activities = await response.json();
    var parsed = activities.map(parseActivity).sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
    return { statusCode: 200, headers: headers, body: JSON.stringify({ activities: parsed, total: parsed.length, runningCount: parsed.filter(function(a) { return a.type === "running"; }).length }) };
  } catch (err) {
    console.error("Strava activities error:", err);
    return { statusCode: 500, headers: headers, body: JSON.stringify({ error: err.message }) };
  }
};
