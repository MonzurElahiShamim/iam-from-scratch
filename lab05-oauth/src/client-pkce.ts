import express from "express";
import "dotenv/config";
import crypto from "node:crypto";

const app = express();
const { KC_BASE, KC_REALM, REDIRECT_URI } = process.env as Record<string, string>;
const CLIENT_ID = "spa";                                   // public client — NO secret
const AUTH  = `${KC_BASE}/realms/${KC_REALM}/protocol/openid-connect/auth`;
const TOKEN = `${KC_BASE}/realms/${KC_REALM}/protocol/openid-connect/token`;

const flows = new Map<string, string>();                  // state -> code_verifier (kept in memory)
const b64url = (b: Buffer) => b.toString("base64url");

app.get("/", (_req, res) => res.send(`<h1>spa (public client)</h1><p><a href="/login">Log in (PKCE)</a></p>`));

app.get("/login", (_req, res) => {
  const state = crypto.randomUUID();
  const verifier = b64url(crypto.randomBytes(32));                            // the per-login secret
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());  // its hash
  flows.set(state, verifier);
  const url = new URL(AUTH);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);          // only the HASH crosses the browser
  url.searchParams.set("code_challenge_method", "S256");
  res.redirect(url.toString());
});

app.get("/callback", async (req, res) => {
  const { code, state } = req.query as Record<string, string>;
  const verifier = flows.get(state);
  if (!verifier) return res.status(400).send("Invalid state.");
  flows.delete(state);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,            // prove possession — NO client_secret anywhere
  });
  const r = await fetch(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  res.type("html").send(`<h1>Tokens (PKCE, no secret)</h1><pre>${JSON.stringify(await r.json(), null, 2)}</pre>`);
});

app.listen(3000, "127.0.0.1", () => console.log("spa on http://localhost:3000"));
