import express from "express";
import { randomUUID } from "node:crypto";   // built into Node — no install needed

const app = express();

const sessions = new Map<string, string>();   // ticket number -> username (the coat room)

// The Cookie header is one string: "session=abc123; theme=dark". Pull out our value.
function getSessionId(cookieHeader?: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const pair of cookieHeader.split(";")) {
    const [key, value] = pair.trim().split("=");
    if (key === "session") return value;
  }
  return undefined;
}

app.post("/login", (req, res) => {
  const name = req.query.name as string;
  const sessionId = randomUUID();
  sessions.set(sessionId, name);             // file the coat under this ticket number
  res.setHeader("Set-Cookie", `session=${sessionId};`);
  res.send(`Logged in as ${name}.`);
});

app.get("/whoami", (req, res) => {
  const sessionId = getSessionId(req.headers.cookie);
  const name = sessionId ? sessions.get(sessionId) : undefined;   // look up the coat
  res.send(name ? `You are ${name}.` : "Nobody is logged in (no valid ticket).");
});

// DEMO ONLY: log in via a plain GET so we can test cookies from a browser.
app.get("/demo", (req, res) => {
  const sessionId = randomUUID();
  sessions.set(sessionId, "browser-user");
  res.setHeader("Set-Cookie", `session=${sessionId}; HttpOnly; SameSite=Lax`);
  res.send(`
    <h1>Logged in on app-one.local</h1>
    <p>Now visit <a href="http://app-two.localhost:3000/other-site">app-two.localhost/other-site</a></p>
  `);
});

// A page that pretends to be a *different* site (you'll load it via app-two.local).
app.get("/other-site", (req, res) => {
  res.send(`
    <h1>You are on app-two.local — a different site.</h1>
    <p><a href="http://app-one.localhost:3000/whoami">Go to app-one.localhost/whoami</a></p>
  `);
});


app.listen(3000, () => console.log("Listening on http://localhost:3000"));
