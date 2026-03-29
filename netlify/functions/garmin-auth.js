// Garmin Connect OAuth 1.0a — Step 1: Get request token & redirect to Garmin
//
// Required env vars:
//   GARMIN_CONSUMER_KEY    — from developer.garmin.com
//   GARMIN_CONSUMER_SECRET — from developer.garmin.com
//   SITE_URL               — your Netlify site URL (e.g. https://my-app.netlify.app)

const crypto = require("crypto");

const GARMIN_REQUEST_TOKEN_URL = "https://connectapi.garmin.com/oauth-service/oauth/request_token";
const GARMIN_AUTHORIZE_URL = "https://connect.garmin.com/oauthConfirm";

/** Generate OAuth 1.0a signature */
function oauthSign(method, url, params, consumerSecret, tokenSecret = "") {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join("&");
  const baseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  return crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");
}

/** Generate nonce */
function nonce() {
  return crypto.randomBytes(16).toString("hex");
}

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  const consumerKey = process.env.GARMIN_CONSUMER_KEY;
  const consumerSecret = process.env.GARMIN_CONSUMER_SECRET;
  const siteUrl = process.env.SITE_URL || process.env.URL || "http://localhost:8888";
  const callbackUrl = `${siteUrl}/api/garmin-callback`;

  if (!consumerKey || !consumerSecret) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Garmin API credentials not configured",
        setup: "Set GARMIN_CONSUMER_KEY and GARMIN_CONSUMER_SECRET in Netlify environment variables",
      }),
    };
  }

  try {
    const oauthParams = {
      oauth_consumer_key: consumerKey,
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_nonce: nonce(),
      oauth_version: "1.0",
      oauth_callback: callbackUrl,
    };

    oauthParams.oauth_signature = oauthSign(
      "POST",
      GARMIN_REQUEST_TOKEN_URL,
      oauthParams,
      consumerSecret
    );

    const authHeader =
      "OAuth " +
      Object.entries(oauthParams)
        .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
        .join(", ");

    const response = await fetch(GARMIN_REQUEST_TOKEN_URL, {
      method: "POST",
      headers: { Authorization: authHeader },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Garmin request token failed: ${response.status} ${text}`);
    }

    const body = await response.text();
    const tokenParams = new URLSearchParams(body);
    const oauthToken = tokenParams.get("oauth_token");
    const oauthTokenSecret = tokenParams.get("oauth_token_secret");

    // Store token secret temporarily (in production, use a proper session store)
    const { getStore } = require("@netlify/blobs");
    const store = getStore("garmin-oauth-temp");
    await store.setJSON(oauthToken, {
      tokenSecret: oauthTokenSecret,
      createdAt: Date.now(),
    });

    const authorizeUrl = `${GARMIN_AUTHORIZE_URL}?oauth_token=${oauthToken}`;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ authorizeUrl }),
    };
  } catch (err) {
    console.error("Garmin auth error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
