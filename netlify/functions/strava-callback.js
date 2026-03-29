const { getStore } = require("@netlify/blobs");
exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const code = params.code;
  if (!code) return { statusCode: 400, headers: { "Content-Type": "text/html" }, body: "<h1>Authorization failed</h1><p>Missing code.</p>" };
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  const siteUrl = process.env.SITE_URL || process.env.URL || "http://localhost:8888";
  try {
    const response = await fetch("https://www.strava.com/oauth/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code: code, grant_type: "authorization_code" }) });
    if (!response.ok) { const text = await response.text(); throw new Error("Token exchange failed: " + response.status + " " + text); }
    const data = await response.json();
    const store = getStore("strava-users");
    const userId = "strava_" + data.athlete.id;
    await store.setJSON(userId, { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: data.expires_at, athlete: { id: data.athlete.id, firstname: data.athlete.firstname, lastname: data.athlete.lastname }, connectedAt: new Date().toISOString() });
    return { statusCode: 302, headers: { Location: siteUrl + "/?strava=connected&userId=" + userId, "Cache-Control": "no-cache" }, body: "" };
  } catch (err) {
    console.error("Strava callback error:", err);
    return { statusCode: 500, headers: { "Content-Type": "text/html" }, body: "<h1>Connection Failed</h1><p>" + err.message + '</p><p><a href="/">Try Again</a></p>' };
  }
};
