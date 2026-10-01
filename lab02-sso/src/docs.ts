import express from "express";
import { randomUUID } from "node:crypto";
import { jwtVerify } from "jose";

const app = express();

const PORT = 3002;
const SELF = "http://docs.localhost:3002";
const IDP = "http://login.localhost:3000";
const CLIENT_ID = "docs";
const secret = new TextEncoder().encode("dev-shared-secret-change-me");  // SAME secret as the IdP

const sessions = new Map<string, string>();   // Acme Docs' OWN session id -> username
const pendingStates = new Set<string>();      // states we've handed out, awaiting callback

// --- UI theme (unique per server) ---
const THEME = { accent: "#059669", accent2: "#10b981", icon: "📄", name: "Acme Docs", host: "docs.localhost" };
function page(body: string) {
  const t = THEME;
  return `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1"><title>${t.name}</title><style>
    *{box-sizing:border-box} body{margin:0;min-height:100vh;display:grid;place-items:center;
    font-family:ui-sans-serif,system-ui,sans-serif;background:linear-gradient(135deg,${t.accent},${t.accent2})}
    .card{background:#fff;width:min(92vw,24rem);padding:2rem;border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.28)}
    .brand{display:flex;align-items:center;gap:.7rem;margin-bottom:1.25rem}
    .icon{width:2.6rem;height:2.6rem;border-radius:12px;display:grid;place-items:center;font-size:1.4rem;
    background:linear-gradient(135deg,${t.accent},${t.accent2})}
    .name{font-weight:700;font-size:1.05rem} .host{color:#6b7280;font-size:.8rem}
    h1,h2{margin:.2rem 0 .6rem;font-size:1.3rem} p{color:#374151;line-height:1.5} b{color:#111}
    button{padding:.7rem;border:0;border-radius:10px;font-size:1rem;font-weight:600;color:#fff;cursor:pointer;
    background:linear-gradient(135deg,${t.accent},${t.accent2})} button:hover{filter:brightness(1.05)}
    a{color:${t.accent};font-weight:600}
  </style></head><body><div class="card">
    <div class="brand"><div class="icon">${t.icon}</div>
    <div><div class="name">${t.name}</div><div class="host">${t.host}</div></div></div>
    ${body}
  </div></body></html>`;
}

function getCookie(name: string, cookieHeader?: string) {
  if (!cookieHeader) return undefined;
  for (const pair of cookieHeader.split(";")) {
    const [k, v] = pair.trim().split("=");
    if (k === name) return v;
  }
  return undefined;
}

app.get("/", (req, res) => {
  const user = sessions.get(getCookie("docs_session", req.headers.cookie) ?? "");
  if (!user) {
    const state = randomUUID();
    pendingStates.add(state);
    const authorize = new URL(`${IDP}/authorize`);
    authorize.searchParams.set("client_id", CLIENT_ID);
    authorize.searchParams.set("redirect_uri", `${SELF}/callback`);
    authorize.searchParams.set("state", state);
    return res.redirect(authorize.toString());
  }
  res.send(page(`<h2>Docs</h2><p>You are logged in as <b>${user}</b>.</p>
    <p><a href="/logout">Log out (this app)</a> ·
       <a href="http://login.localhost:3000/logout">Log out everywhere</a></p>`));
});

app.get("/callback", async (req, res) => {
  const { proof, state } = req.query as Record<string, string>;

  if (!state || !pendingStates.has(state)) {
    return res.status(400).send(page("<h2>Invalid state</h2><p>This app did not start this login.</p>"));
  }
  pendingStates.delete(state);

  try {
    const { payload } = await jwtVerify(proof, secret, { audience: CLIENT_ID, issuer: IDP });
    const user = String(payload.sub);
    const sessionId = randomUUID();
    sessions.set(sessionId, user);
    res.setHeader("Set-Cookie", `docs_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/`);
    res.redirect("/");
  } catch {
    res.status(401).send(page("<h2>Invalid proof</h2><p>The identity proof could not be verified.</p>"));
  }
});

app.get("/logout", (req, res) => {
  const sid = getCookie("docs_session", req.headers.cookie);
  if (sid) sessions.delete(sid);
  res.setHeader("Set-Cookie", "docs_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  const next = req.query.next as string;
  if (next) return res.redirect(next);   // part of the single-logout chain → keep going
  res.send(page(`<h2>Logged out</h2><p>You are logged out of Acme Docs.</p>
    <p><a href="/">Log back in</a></p>`));
});


app.listen(PORT, "127.0.0.1", () => console.log(`Acme Docs on ${SELF}`));
