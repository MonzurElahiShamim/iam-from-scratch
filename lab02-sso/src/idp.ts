import express from "express";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";

// A shared secret to sign the proof (HMAC). Lab 04 replaces this with a public/private keypair.
const secret = new TextEncoder().encode("dev-shared-secret-change-me");

const app = express();
app.use(express.urlencoded({ extended: false }));   // parse POSTed form fields into req.body

const sessions = new Map<string, string>();          // IdP session id -> username

// --- UI theme (unique per server) ---
const THEME = { accent: "#7c3aed", accent2: "#a855f7", icon: "🔐", name: "Acme ID", host: "login.localhost" };
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
    form{display:grid;gap:.6rem;margin-top:1rem}
    input{padding:.7rem .8rem;border:1px solid #d1d5db;border-radius:10px;font-size:1rem}
    input:focus{outline:2px solid ${t.accent};border-color:transparent}
    button{padding:.7rem;border:0;border-radius:10px;font-size:1rem;font-weight:600;color:#fff;cursor:pointer;
    background:linear-gradient(135deg,${t.accent},${t.accent2})} button:hover{filter:brightness(1.05)}
    code{background:#f3f4f6;padding:.1rem .35rem;border-radius:5px} a{color:${t.accent};font-weight:600}
  </style></head><body><div class="card">
    <div class="brand"><div class="icon">${t.icon}</div>
    <div><div class="name">${t.name}</div><div class="host">${t.host}</div></div></div>
    ${body}
  </div></body></html>`;
}

function getSessionId(cookieHeader?: string) {
  if (!cookieHeader) return undefined;
  for (const pair of cookieHeader.split(";")) {
    const [k, v] = pair.trim().split("=");
    if (k === "idp_session") return v;
  }
  return undefined;
}

app.get("/login", (req, res) => {
  const next = (req.query.next as string) || "";
  const user = sessions.get(getSessionId(req.headers.cookie) ?? "");
  if (user) {
    if (next) return res.redirect(next);            // already logged in → resume authorize
    return res.send(page(`<h2>Signed in</h2><p>You already have an IdP session as <b>${user}</b>.</p>`));
  }
  res.send(page(`
    <h2>Sign in</h2>
    <form method="POST" action="/login">
      <input type="hidden" name="next" value="${next}" />
      <input name="username" placeholder="username" />
      <input name="password" type="password" placeholder="password" />
      <button>Log in</button>
    </form>
    <p style="font-size:.8rem;color:#9ca3af">demo password: <code>password</code></p>
  `));
});

app.post("/login", (req, res) => {
  const { username, password, next } = req.body;
  if (password !== "password") {
    return res.status(401).send(page("<h2>Wrong password</h2><p><a href='/login'>Try again</a></p>"));
  }
  const sessionId = randomUUID();
  sessions.set(sessionId, username);
  res.setHeader("Set-Cookie", `idp_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/`);
  if (next) return res.redirect(next);              // resume the authorize we came from
  res.send(page(`<h2>Signed in</h2><p>Logged in as <b>${username}</b>. IdP session set.</p>`));
});

app.get("/authorize", async (req, res) => {
  const { client_id, redirect_uri, state } = req.query as Record<string, string>;
  const user = sessions.get(getSessionId(req.headers.cookie) ?? "");

  if (!user) {
    // No IdP session → send to login, remembering to come back here afterward.
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  }

  // Logged in → mint a signed proof of identity, addressed to this app, short-lived.
  const proof = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user)                 // who
    .setAudience(client_id)           // which app it's for
    .setIssuer("http://login.localhost:3000")
    .setExpirationTime("60s")         // short-lived
    .sign(secret);

  // Send the browser back to the app with the proof + the state it gave us.
  const back = new URL(redirect_uri);
  back.searchParams.set("proof", proof);
  back.searchParams.set("state", state);
  res.redirect(back.toString());
});

app.get("/logout", (req, res) => {
  // 1) clear the IdP's OWN session first
  const sid = getSessionId(req.headers.cookie);
  if (sid) sessions.delete(sid);
  res.setHeader("Set-Cookie", "idp_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");

  // 2) chain the browser through EVERY app's logout, ending back here at /logout/done.
  // The IdP must know every app — that knowledge is what makes single logout fiddly.
  const done  = "http://login.localhost:3000/logout/done";
  const step2 = `http://docs.localhost:3002/logout?next=${encodeURIComponent(done)}`;
  const step1 = `http://dashboard.localhost:3001/logout?next=${encodeURIComponent(step2)}`;
  res.redirect(step1);
});

app.get("/logout/done", (req, res) => {
  res.send(page(`<h2>Logged out everywhere</h2>
    <p>Your session at Acme ID and every connected app has been cleared.</p>`));
});

app.listen(3000, "127.0.0.1", () => console.log("IdP on http://login.localhost:3000"));
