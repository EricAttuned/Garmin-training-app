// Training Data Storage — User profiles, settings, and run log
//
// GET  /api/training-data?userId=...&type=profile|settings|log
// POST /api/training-data  { userId, type, data }

const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  const store = getStore("training-data");

  try {
    if (event.httpMethod === "GET") {
      const params = event.queryStringParameters || {};
      const userId = params.userId || "default";
      const type = params.type || "profile";

      const data = await store.get(`${userId}/${type}`, { type: "json" });
      return {
        statusCode: data ? 200 : 404,
        headers,
        body: JSON.stringify(data || { error: "Not found" }),
      };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body);
      const { userId = "default", type, data } = body;

      if (!type || !data) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "type and data required" }),
        };
      }

      // For run log, append rather than overwrite
      if (type === "log") {
        const existing = (await store.get(`${userId}/log`, { type: "json" })) || [];
        existing.push({ ...data, recordedAt: new Date().toISOString() });
        // Keep last 500 entries
        const trimmed = existing.slice(-500);
        await store.setJSON(`${userId}/log`, trimmed);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, count: trimmed.length }) };
      }

      await store.setJSON(`${userId}/${type}`, {
        ...data,
        updatedAt: new Date().toISOString(),
      });

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (err) {
    console.error("Training data error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
;
};
