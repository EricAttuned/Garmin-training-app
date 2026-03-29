// Garmin Connect OAuth 1.0a — Step 2: Exchange request token for access token
//
// Garmin redirects here after user authorizes. We exchange the verifier for
// a permanent access token and store it.

const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

const GARMIN_ACCESS_TOKEN_URL = "https://connectapi.garmin.com/oauth-service/oauth/access_token";

function oauthSign(method, url, params, consumerSecret, tokenSecret = "") {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join("&");
  const baseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  return crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");
}

function nonce() {
  return crypto.randomBytes(16).toString("hex");
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const oauthToken = params.oauth_token;
  const oauthVerifier = params.oauth_verifier;

  if (!oauthToken || !oauthVerifier) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "text/html" },
      body: "<h1>Authorization failed</h1><p>Missing OAuth parameters. Please try again.</p>",
    };
  }

  const consumerKey = process.env.GARMIN_CONSUMER_KEY;
  const consumerSecret = process.env.GARMIN_CONSUMER_SECRET;

  try {
    // Retrieve stored token secret
    const tempStore = getStore("garmin-oauth-temp");
    const stored = await tempStore.get(oauthToken, { type: "json" });

    if (!stored) {
      throw new Error("OAuth session expired. Please try connecting again.");
    }

    const { tokenSecret } = stored;

    // Exchange for access token
    const oauthParams = {
      oauth_consumer_key: consumerKey,
      oauth_token: oauthToken,
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_nonce: nonce(),
      oauth_version: "1.0",
      oauth_verifier: oauthVerifier,
    };

    oauthParams.oauth_signature = oauthSign(
      "POST",
      GARMIN_ACCESS_TOKEN_URL,
      oauthParams,
      consumerSecret,
      tokenSecret
    );

    const authHeader =
      "OAuth " +
      Object.entries(oauthParams)
        .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
        .join(", ");

    const response = await fetch(GARMIN_ACCESS_TOKEN_URL, {
      method: "POST",
      headers: { Authorization: authHeader },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Access token exchange failed: ${response.status} ${text}`);
    }

    const body = await response.text();
    const tokenParams = new URLSearchParams(body);
    const accessToken = tokenParams.get("oauth_token");
    const accessTokenSecret = tokenParams.get("oauth_token_secret");

    // Store access token permanently
    const userStore = getStore("garmin-users");
    const userId = `garmin_${accessToken.substring(0, 8)}`;
    await userStore.setJSON(userId, {
      accessToken,
      accessTokenSecret,
      connectedAt: new Date().toISOString(),
    });

    // Clean up temp token
    await tempStore.delete(oauthToken);

    // Redirect back to app with success
    const siteUrl = process.env.SITE_URL || process.env.URL || "http://localhost:8888";
    return {
      statusCode: 302,
      headers: {
        Location: `${siteUrl}/?garmin=connected&userId=${userId}`,
        "Cache-Control": "no-cache",
      },
      body: "",
    };
  } catch (err) {
    console.error("Garmin callback error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/html" },
      body: `<h1>Connection Failed</h1><p>${err.message}</p><p><a href="/">Try Again</a></p>`,
    };
  }
};
