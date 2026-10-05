import express from "express";
import "dotenv/config";                 // loads .env into process.env
import { randomUUID } from "node:crypto";

const app = express();
const { KC_BASE, KC_REALM, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI } = process.env as Record<string, string>;
const AUTH  = `${KC_BASE}/realms/${KC_REALM}/protocol/openid-connect/auth`;    // authorize endpoint
const TOKEN = `${KC_BASE}/realms/${KC_REALM}/protocol/openid-connect/token`;   // token endpoint

const pendingStates = new Set<string>();   // CSRF guard (same idea as Lab 02)

app.get("/", (_req, res) => {
  res.send(`<h1>web-app</h1><p><a href="/login">Log in with Keycloak</a></p>`);
});

// FRONT CHANNEL — send the browser to Keycloak's authorize endpoint (all non-secret values, in the URL)
app.get("/login", (_req, res) => {
  const state = randomUUID();
  pendingStates.add(state);
  const url = new URL(AUTH);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");    // ← the authorization CODE flow
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

// The browser returns here with ?code=...&state=... (front channel — the code is near-worthless alone)
app.get("/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query as Record<string, string>;
  if (error) return res.status(400).send(`Keycloak error: ${error} — ${error_description}`);
  if (!state || !pendingStates.has(state)) return res.status(400).send("Invalid state.");
  pendingStates.delete(state);

  // BACK CHANNEL — swap the code for tokens, server-to-server, presenting the client_secret
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,       // ← the secret never touches the browser
  });
  const tokenRes = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokens = await tokenRes.json();
  res.type("html").send(`<h1>Tokens received (over the back channel)</h1>
    <pre>${JSON.stringify(tokens, null, 2)}</pre>`);
});

app.listen(3000, "127.0.0.1", () => console.log("web-app on http://localhost:3000"));
