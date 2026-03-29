// Fetch running activities from Garmin Connect API
//
// GET /api/garmin-activities?userId=...&days=30

const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

const GARMIN_API_BASE = "https://apis.garmin.com/wellness-api/rest";

function oauthSign(method, url, params, consumerSecret, tokenSecret) {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join("&");
  const baseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  return crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");
}

function nonce() {
  return crypto.randomBytes(16).toString("hex");
}

/** Make an authenticated request to Garmin API */
async function garminRequest(endpoint, accessToken, accessTokenSecret) {
  const consumerKey = process.env.GARMIN_CONSUMER_KEY;
  const consumerSecret = process.env.GARMIN_CONSUMER_SECRET;
  const url = `${GARMIN_API_BASE}${endpoint}`;

  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_token: accessToken,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: nonce(),
    oauth_version: "1.0",
  };

  oauthParams.oauth_signature = oauthSign("GET", url, oauthParams, consumerSecret, accessTokenSecret);

  const authHeader =
    "OAuth " +
    Object.entries(oauthParams)
      .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
      .join(", ");

  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: authHeader },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Garmin API error: ${response.status} ${text}`);
  }

  return response.json();
}

/** Parse Garmin activity into our normalized format */
function parseActivity(raw) {
  const durationMinutes = (raw.durationInSeconds || 0) / 60;
  const distanceKm = (raw.distanceInMeters || 0) / 1000;
  const avgPaceSeconds = distanceKm > 0 ? (durationMinutes * 60) / distanceKm : 0;

  return {
    id: raw.activityId || raw.summaryId,
    date: raw.startTimeLocal || raw.calendarDate,
    type: raw.activityType === "RUNNING" || raw.activityType === "TRAIL_RUNNING" ? "running" : raw.activityType?.toLowerCase() || "other",
    distanceKm: Math.round(distanceKm * 100) / 100,
    durationMinutes: Math.round(durationMinutes * 10) / 10,
    avgPaceSeconds: Math.round(avgPaceSeconds),
    avgHeartRate: raw.averageHeartRateInBeatsPerMinute || null,
    maxHeartRate: raw.maxHeartRateInBeatsPerMinute || null,
    avgHrPct: raw.averageHeartRateInBeatsPerMinute && raw.maxHeartRateInBeatsPerMinute
      ? raw.averageHeartRateInBeatsPerMinute / raw.maxHeartRateInBeatsPerMinute
      : null,
    calories: raw.activeKilocalories || raw.calories || null,
    elevationGainM: raw.elevationGainInMeters || null,
    isWorkout: raw.isWorkout || false,
    name: raw.activityName || null,
  };
}

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const params = event.queryStringParameters || {};
  const userId = params.userId;
  const days = parseInt(params.days) || 30;

  if (!userId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "userId required" }) };
  }

  try {
    // Get stored credentials
    const userStore = getStore("garmin-users");
    const user = await userStore.get(userId, { type: "json" });

    if (!user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: "Not connected to Garmin. Please connect first." }),
      };
    }

    // Fetch activities for the date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const startEpoch = Math.floor(startDate.getTime() / 1000);
    const endEpoch = Math.floor(endDate.getTime() / 1000);

    // Fetch activity summaries
    const activities = await garminRequest(
      `/activities?uploadStartTimeInSeconds=${startEpoch}&uploadEndTimeInSeconds=${endEpoch}`,
      user.accessToken,
      user.accessTokenSecret
    );

    // Parse and filter for running activities
    const parsed = (Array.isArray(activities) ? activities : [])
      .map(parseActivity)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    // Cache activities for plan adaptation
    const activityStore = getStore("garmin-activities");
    await activityStore.setJSON(`${userId}/recent`, {
      activities: parsed,
      fetchedAt: new Date().toISOString(),
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        activities: parsed,
        total: parsed.length,
        runningCount: parsed.filter((a) => a.type === "running").length,
      }),
    };
  } catch (err) {
    console.error("Garmin activities error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
