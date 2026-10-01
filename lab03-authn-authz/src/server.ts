import express from "express";
import { randomUUID } from "node:crypto";

const app = express();

// Our user directory: who exists, and what role each has.
const users: Record<string, { role: string }> = {
  alice: { role: "admin" },
  bob:   { role: "user" },
};

const sessions = new Map<string, string>();   // sessionId -> username

// --- UI ---
const THEME = { accent: "#d97706", accent2: "#f59e0b", icon: "🛡️", name: "Acme Console", host: "localhost:3000" };
function page(body: string) {
  const t = THEME;
  return `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1"><title>${t.name}</title><style>
    *{box-sizing:border-box} body{margin:0;min-height:100vh;display:grid;place-items:center;
    font-family:ui-sans-serif,system-ui,sans-serif;background:linear-gradient(135deg,${t.accent},${t.accent2})}
    .card{background:#fff;width:min(92vw,26rem);padding:2rem;border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.28)}
    .brand{display:flex;align-items:center;gap:.7rem;margin-bottom:1.25rem}
    .icon{width:2.6rem;height:2.6rem;border-radius:12px;display:grid;place-items:center;font-size:1.4rem;
    background:linear-gradient(135deg,${t.accent},${t.accent2})}
    .name{font-weight:700;font-size:1.05rem} .host{color:#6b7280;font-size:.8rem}
    h2{margin:.2rem 0 .6rem;font-size:1.3rem} p{color:#374151;line-height:1.5} b{color:#111}
    hr{border:0;border-top:1px solid #eee;margin:1.25rem 0}
    form{margin:.45rem 0}
    button,.btn{display:inline-block;width:100%;text-align:center;padding:.7rem;border:0;border-radius:10px;
    font-size:1rem;font-weight:600;color:#fff;cursor:pointer;text-decoration:none;
    background:linear-gradient(135deg,${t.accent},${t.accent2})} button:hover,.btn:hover{filter:brightness(1.05)}
    button.alt,.btn.alt{background:#6b7280} button.warn{background:#dc2626}
    .row{display:flex;gap:.5rem} .row .btn{width:auto;flex:1}
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

// AUTHENTICATION: who is this request?
function currentUser(req: express.Request): string | undefined {
  return sessions.get(getCookie("session", req.headers.cookie) ?? "");
}

// AUTHORIZATION: is this user allowed to do this? (a separate question)
function isAdmin(username: string): boolean {
  return users[username]?.role === "admin";
}

app.get("/", (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.send(page(`
      <h2>Sign in</h2>
      <p>Two demo users — pick one:</p>
      <form method="POST" action="/login?user=alice"><button>Log in as Alice (admin)</button></form>
      <form method="POST" action="/login?user=bob"><button class="alt">Log in as Bob (user)</button></form>
    `));
  }
  res.send(page(`
    <h2>Signed in as ${user}</h2>
    <p>Role: <b>${users[user].role}</b></p>
    <div class="row"><a class="btn" href="/profile">My profile</a><a class="btn" href="/admin">Admin panel</a></div>
    <hr>
    <form method="POST" action="/revoke-admin?user=${user}"><button class="warn">Revoke my admin (IT, at 2pm)</button></form>
    <form method="POST" action="/logout"><button class="alt">Log out</button></form>
  `));
});

app.post("/login", (req, res) => {
  const username = req.query.user as string;
  if (!users[username]) return res.status(400).send(page("<h2>No such user</h2><p><a href='/'>Back</a></p>"));
  const sessionId = randomUUID();
  sessions.set(sessionId, username);
  res.setHeader("Set-Cookie", `session=${sessionId}; HttpOnly; Path=/`);
  res.redirect("/");
});

app.post("/logout", (req, res) => {
  const sid = getCookie("session", req.headers.cookie);
  if (sid) sessions.delete(sid);
  res.setHeader("Set-Cookie", "session=; HttpOnly; Path=/; Max-Age=0");
  res.redirect("/");
});

// Any logged-in user may see their own profile. (Authentication is enough here.)
app.get("/profile", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).send(page("<h2>Not logged in</h2><p><a href='/'>Back</a></p>"));
  res.send(page(`<h2>Profile</h2><p>You are <b>${user}</b> (role: ${users[user].role}).</p><p><a href="/">Back</a></p>`));
});

// Admin area — the TWO-CHECK shape.
app.get("/admin", (req, res) => {
  const user = currentUser(req);                              // AuthN: who are you?
  if (!user) return res.status(401).send(page("<h2>Not logged in</h2><p><a href='/'>Back</a></p>"));
  if (!isAdmin(user)) {                                       // AuthZ: may you?
    return res.status(403).send(page(
      `<h2>🚫 Forbidden</h2><p>Admins only. You are <b>authenticated</b> as ${user}, but not <b>authorized</b>.</p><p><a href="/">Back</a></p>`
    ));
  }
  res.send(page(`<h2>🔑 Admin panel</h2><p>Welcome, <b>${user}</b> — you have admin rights.</p><p><a href="/">Back</a></p>`));
});

// Simulate IT changing the access list at "2pm" — mutate the user's role live.
app.post("/revoke-admin", (req, res) => {
  const username = req.query.user as string;
  if (users[username]) users[username].role = "user";
  res.redirect("/");
});

app.listen(3000, "127.0.0.1", () => console.log("Acme Console on http://localhost:3000"));
