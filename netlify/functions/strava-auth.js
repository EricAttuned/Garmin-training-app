exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  const clientId = process.env.STRAVA_CLIENT_ID;
  const siteUrl = process.env.SITE_URL || process.env.URL || "http://localhost:8888";
  const redirectUri = siteUrl + "/api/strava-callback";
  if (!clientId) return { statusCode: 500, headers, body: JSON.stringify({ error: "Strava API credentials not configured. Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in Netlify env vars." }) };
  const authorizeUrl = "https://www.strava.com/oauth/authorize?client_id=" + clientId + "&response_type=code&redirect_uri=" + encodeURIComponent(redirectUri) + "&approval_prompt=auto&scope=read,activity:read_all";
  return { statusCode: 200, headers, body: JSON.stringify({ authorizeUrl: authorizeUrl }) };
};
