// Push a structured workout to Garmin Connect
//
// POST /api/garmin-push-workout
// Body: { userId, workout }
//
// Converts our workout format to Garmin's Workout API format and pushes it
// so it syncs to the user's Garmin watch.

const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

const GARMIN_WORKOUT_API = "https://apis.garmin.com/training-api/workout";

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

/** Convert our pace string (mm:ss per km) to Garmin speed (m/s) */
function paceToSpeed(paceStr) {
  if (!paceStr) return null;
  const pace = typeof paceStr === "string" ? paceStr : paceStr.min || paceStr;
  const [m, s] = pace.split(":").map(Number);
  const secsPerKm = m * 60 + (s || 0);
  return secsPerKm > 0 ? 1000 / secsPerKm : null; // m/s
}

/** Convert distance to meters */
function toMeters(distance, unit) {
  if (unit === "km") return distance * 1000;
  if (unit === "mi") return distance * 1609.34;
  return distance; // assume meters
}

/** Convert our workout step to Garmin workout step format */
function convertStep(step, stepOrder) {
  if (step.type === "repeat") {
    return {
      type: "WorkoutRepeatStep",
      stepOrder,
      numberOfIterations: step.reps,
      steps: step.steps.map((s, i) => convertStep(s, i + 1)),
    };
  }

  const garminStep = {
    type: "WorkoutStep",
    stepOrder,
    stepType: step.type === "warmup" ? "warmUp" : step.type === "cooldown" ? "coolDown" : step.type === "recovery" ? "recovery" : "interval",
    endCondition: {
      conditionTypeKey: "distance",
      conditionTypeId: 3,
    },
    targetType: step.pace ? {
      targetTypeKey: "speed.zone",
      targetTypeId: 6,
    } : null,
    description: step.label || "",
  };

  // Set distance target
  const meters = toMeters(step.distance, step.unit);
  garminStep.endCondition.value = meters;

  // Set pace/speed target
  if (step.pace) {
    const minPace = typeof step.pace === "string" ? step.pace : step.pace.min;
    const maxPace = typeof step.pace === "string" ? step.pace : step.pace.max || step.pace.min;
    garminStep.targetType = {
      targetTypeKey: "speed.zone",
      zoneNumber: null,
      targetValueOne: paceToSpeed(maxPace), // slower pace = lower speed = min
      targetValueTwo: paceToSpeed(minPace), // faster pace = higher speed = max
    };
  }

  return garminStep;
}

/** Convert our workout to Garmin Workout API format */
function toGarminWorkout(workout, scheduledDate) {
  const steps = [];
  let stepOrder = 1;

  for (const step of workout.steps || []) {
    steps.push(convertStep(step, stepOrder));
    stepOrder++;
  }

  return {
    workoutName: workout.label || "Training Run",
    description: workout.description || "",
    sport: { sportTypeKey: "running", sportTypeId: 1 },
    subSport: null,
    workoutSegments: [
      {
        segmentOrder: 1,
        sportType: { sportTypeKey: "running", sportTypeId: 1 },
        workoutSteps: steps,
      },
    ],
    scheduledDate: scheduledDate || null,
  };
}

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const consumerKey = process.env.GARMIN_CONSUMER_KEY;
  const consumerSecret = process.env.GARMIN_CONSUMER_SECRET;

  try {
    const body = JSON.parse(event.body);
    const { userId, workout, date, pushAll } = body;

    if (!userId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "userId required" }) };
    }

    // Get stored credentials
    const userStore = getStore("garmin-users");
    const user = await userStore.get(userId, { type: "json" });

    if (!user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: "Not connected to Garmin" }),
      };
    }

    const results = [];

    if (pushAll) {
      // Push upcoming week of workouts
      const planStore = getStore("training-plans");
      const plan = await planStore.get(`${userId}/current`, { type: "json" });

      if (!plan) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "No active plan" }) };
      }

      const today = new Date();
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);

      for (const week of plan.weeks) {
        for (const day of week.days) {
          const dayDate = new Date(day.date);
          if (dayDate >= today && dayDate <= nextWeek && day.type !== "rest" && day.steps?.length > 0) {
            const garminWorkout = toGarminWorkout(day, day.date);
            results.push({ date: day.date, workout: garminWorkout, status: "queued" });
          }
        }
      }
    } else if (workout) {
      const garminWorkout = toGarminWorkout(workout, date);
      results.push({ date, workout: garminWorkout, status: "queued" });
    }

    // Push each workout to Garmin
    for (const result of results) {
      try {
        const url = GARMIN_WORKOUT_API;
        const oauthParams = {
          oauth_consumer_key: consumerKey,
          oauth_token: user.accessToken,
          oauth_signature_method: "HMAC-SHA1",
          oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
          oauth_nonce: nonce(),
          oauth_version: "1.0",
        };

        oauthParams.oauth_signature = oauthSign("POST", url, oauthParams, consumerSecret, user.accessTokenSecret);

        const authHeader =
          "OAuth " +
          Object.entries(oauthParams)
            .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
            .join(", ");

        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(result.workout),
        });

        if (response.ok) {
          result.status = "pushed";
          const data = await response.json();
          result.garminWorkoutId = data.workoutId;
        } else {
          const text = await response.text();
          result.status = "failed";
          result.error = `${response.status}: ${text}`;
        }
      } catch (err) {
        result.status = "failed";
        result.error = err.message;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        pushed: results.filter((r) => r.status === "pushed").length,
        failed: results.filter((r) => r.status === "failed").length,
        results,
      }),
    };
  } catch (err) {
    console.error("Garmin push error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
