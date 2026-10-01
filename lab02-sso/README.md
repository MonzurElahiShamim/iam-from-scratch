# Lab 02 — Single sign-on by hand

**Concept:** Build single sign-on from scratch — three separate servers cooperating through browser redirects and a signed identity proof, so you log in once and walk into every app without re-entering your password. No OAuth/OIDC library: you write the identity provider, the clients, the proof, and the verification yourself.

**Maps to:** `iam-foundations-final.md` §6 (how SSO actually works) and §7 (the five-step pattern).

**Time:** ~1 day. **Prerequisites:** Lab 01 (cookies, sessions, `SameSite`), and browser access to `*.localhost` names (see [lab01's WSL note](../lab01-cookies/README.md#reaching-the-server-from-a-browser-wsl2-note)).

> ⚠️ **Teaching code** — shared HMAC secret, no `redirect_uri` validation. See [Known gaps](#known-gaps).

> **How to follow this lab:** do the steps in order. We build three functional servers first (Steps 1–4), make them visually distinct (Step 5), then add logout and an attack (Steps 6–8). The finished files in `src/` are the end state.

## The idea in plain words

You're logged in at the login service, which means your browser holds *its* cookie. Now you open a second app. It would love to know you're already logged in — but it **can't see the login service's cookie**, because a cookie only goes back to the domain that set it (Lab 01). The apps can't peek at each other's cookies, and often can't even talk to each other directly.

So who *can* reach the login service? **Your browser** — it's the only party holding that cookie. Single sign-on works by **routing your browser through the login service** with a redirect: on the login service's own domain its cookie *is* sent, so it recognizes you and sends your browser back to the app carrying a **signed proof** of who you are. The app checks the proof and starts its *own* session.

- **Why signed?** The proof travels through the browser, which the app doesn't trust — signing makes it tamper-proof and forgery-proof.
- **Why `state` and a short `exp`?** To stop a forged callback (CSRF) and to limit replay if a proof is captured.
- **Why is logging out everywhere hard?** Because each app ends up with its *own* cookie that only it can clear — so the login service has to actively visit each one to log you out.

---

## The cast — one login service, two products

| Role | Name | URL | client_id | cookie |
|---|---|---|---|---|
| Identity Provider | 🔐 Acme ID | `login.localhost:3000` | — | `idp_session` |
| App (client) | 📊 Acme Dashboard | `dashboard.localhost:3001` | `dashboard` | `dashboard_session` |
| App (client) | 📄 Acme Docs | `docs.localhost:3002` | `docs` | `docs_session` |

Run them as **three independent processes** (not one faking three roles) so the isolation is honest: the browser enforces cookie scoping by hostname, and ports just pick which process answers.

## Setup

```bash
npm init -y
npm pkg set type="module"
npm install express jose
npm install -D typescript tsx @types/express @types/node
cp ../lab01-cookies/tsconfig.json .
npm pkg set scripts.idp="tsx watch src/idp.ts"
npm pkg set scripts.dashboard="tsx watch src/dashboard.ts"
npm pkg set scripts.docs="tsx watch src/docs.ts"
```

You'll run three terminals: `npm run idp`, `npm run dashboard`, `npm run docs`.

---

## Step 1 — the IdP can log you in (`src/idp.ts`)

SSO reuses the IdP's own session cookie, so first make the IdP able to log a user in. Create `src/idp.ts` — no styling, no `/authorize` yet:

```ts
import express from "express";
import { randomUUID } from "node:crypto";

const app = express();
app.use(express.urlencoded({ extended: false }));   // parse POSTed form fields into req.body
const sessions = new Map<string, string>();         // idp_session id -> username

function getSessionId(cookieHeader?: string) {
  if (!cookieHeader) return undefined;
  for (const pair of cookieHeader.split(";")) {
    const [k, v] = pair.trim().split("=");
    if (k === "idp_session") return v;
  }
  return undefined;
}

app.get("/login", (req, res) => {
  const user = sessions.get(getSessionId(req.headers.cookie) ?? "");
  if (user) return res.send(`<h1>IdP</h1><p>Already signed in as <b>${user}</b>.</p>`);
  res.send(`<h1>login.localhost — the IdP</h1>
    <form method="POST" action="/login">
      <input name="username" placeholder="username" />
      <input name="password" type="password" placeholder="password" />
      <button>Log in</button>
    </form>`);
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (password !== "password") return res.status(401).send("Wrong password.");
  const sessionId = randomUUID();
  sessions.set(sessionId, username);
  // Lax so this cookie survives the SSO redirect (a top-level GET navigation). Strict would break SSO.
  res.setHeader("Set-Cookie", `idp_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/`);
  res.send(`<h1>IdP</h1><p>Logged in as <b>${username}</b>.</p>`);
});

app.listen(3000, "127.0.0.1", () => console.log("IdP on http://login.localhost:3000"));
```

**Run & observe:** `npm run idp`, then in the browser `http://login.localhost:3000/login` → form → log in (password `password`). Revisit `/login` → "Already signed in" (your cookie was returned). That recognition is the seed of SSO.

---

## Step 2 — the IdP issues a signed proof (`/authorize`)

So you can test with `curl` from WSL, add the names to WSL's hosts file (the browser auto-resolves `*.localhost`, but curl doesn't):

```bash
echo "127.0.0.1  login.localhost dashboard.localhost docs.localhost" | sudo tee -a /etc/hosts
```

Add signing to `src/idp.ts`: `import { SignJWT } from "jose";` and `const secret = new TextEncoder().encode("dev-shared-secret-change-me");`. Thread a `next` param through `/login` (so an interrupted authorize can resume), and add `/authorize`:

```ts
app.get("/authorize", async (req, res) => {
  const { client_id, redirect_uri, state } = req.query as Record<string, string>;
  const user = sessions.get(getSessionId(req.headers.cookie) ?? "");
  if (!user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);

  const proof = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user).setAudience(client_id)
    .setIssuer("http://login.localhost:3000").setExpirationTime("60s")
    .sign(secret);

  const back = new URL(redirect_uri);
  back.searchParams.set("proof", proof);
  back.searchParams.set("state", state);
  res.redirect(back.toString());
});
```
(For `next`: `GET /login` reads `req.query.next` into a hidden form field and redirects there if already logged in; `POST /login` redirects to `next` after setting the cookie. Full version in `src/idp.ts`.)

**Run & observe (curl):**
```bash
# no session → bounced to /login
curl -si "http://login.localhost:3000/authorize?client_id=dashboard&redirect_uri=http://dashboard.localhost:3001/callback&state=xyz" | grep -i location
#   → Location: /login?next=%2Fauthorize%3F...

# log in, then retry WITH the cookie
curl -s -c idp.cookies -d "username=alice&password=password" "http://login.localhost:3000/login" -o /dev/null
curl -si -b idp.cookies "http://login.localhost:3000/authorize?client_id=dashboard&redirect_uri=http://dashboard.localhost:3001/callback&state=xyz" | grep -i location
#   → Location: http://dashboard.localhost:3001/callback?proof=eyJ...&state=xyz

# decode the proof — readable with NO key (encode ≠ encrypt):
node -e "console.log(Buffer.from(process.argv[1].split('.')[1],'base64url').toString())" "PASTE_PROOF"
#   → {"sub":"alice","aud":"dashboard","iss":"http://login.localhost:3000","exp":...}
```
`/authorize` runs twice in a real login: once bouncing to the form, once (cookie in hand) minting the proof.

---

## Step 3 — the first client (`src/dashboard.ts`)

The client *starts* the login and *consumes* the proof. Create `src/dashboard.ts`:

```ts
import express from "express";
import { randomUUID } from "node:crypto";
import { jwtVerify } from "jose";

const app = express();
const PORT = 3001;
const SELF = "http://dashboard.localhost:3001";
const IDP = "http://login.localhost:3000";
const CLIENT_ID = "dashboard";
const secret = new TextEncoder().encode("dev-shared-secret-change-me"); // SAME secret as the IdP

const sessions = new Map<string, string>();
const pendingStates = new Set<string>();   // CSRF: states we issued, awaiting callback

function getCookie(name: string, h?: string) {
  if (!h) return undefined;
  for (const p of h.split(";")) { const [k, v] = p.trim().split("="); if (k === name) return v; }
  return undefined;
}

app.get("/", (req, res) => {
  const user = sessions.get(getCookie("dashboard_session", req.headers.cookie) ?? "");
  if (!user) {
    const state = randomUUID();
    pendingStates.add(state);
    const authorize = new URL(`${IDP}/authorize`);
    authorize.searchParams.set("client_id", CLIENT_ID);
    authorize.searchParams.set("redirect_uri", `${SELF}/callback`);
    authorize.searchParams.set("state", state);
    return res.redirect(authorize.toString());        // START SSO
  }
  res.send(`<h1>Dashboard</h1><p>Logged in as <b>${user}</b>.</p>`);
});

app.get("/callback", async (req, res) => {
  const { proof, state } = req.query as Record<string, string>;
  if (!state || !pendingStates.has(state)) return res.status(400).send("Invalid state.");
  pendingStates.delete(state);                          // one-time use
  try {
    const { payload } = await jwtVerify(proof, secret, { audience: CLIENT_ID, issuer: IDP });
    const sessionId = randomUUID();
    sessions.set(sessionId, String(payload.sub));       // our OWN session (step 5)
    res.setHeader("Set-Cookie", `dashboard_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/`);
    res.redirect("/");
  } catch { res.status(401).send("Invalid proof."); }
});

app.listen(PORT, "127.0.0.1", () => console.log(`Acme Dashboard on ${SELF}`));
```

**Run & observe:** `npm run idp` + `npm run dashboard`. In **Incognito**, open `http://dashboard.localhost:3001/`. Address bar hops `dashboard → login (form) → dashboard`; log in → you land on the Dashboard. The two servers never spoke directly — your browser carried every message.

---

## Step 4 — the second client, and the SSO payoff (`src/docs.ts`)

```bash
cp src/dashboard.ts src/docs.ts
```
In `src/docs.ts` change four things: `PORT=3002`, `SELF="http://docs.localhost:3002"`, `CLIENT_ID="docs"`, cookie `docs_session` (both spots). Same IDP, same secret.

**Run & observe the magic:** `npm run docs`. Still logged into Dashboard, open `http://docs.localhost:3002/` → **straight in, no password.** It bounces through `login.localhost`, but your browser already holds `idp_session`, so the IdP mints a proof silently. That's single sign-on.

---

## Step 5 — make the three servers visually distinct

All three look identical, so the redirect dance is hard to follow. Add a themed `page()` card helper to each file and wrap every `res.send(...)` in it. Each file gets its own theme (full CSS in the finished `src/` files):

```ts
const THEME = { accent: "#7c3aed", accent2: "#a855f7", icon: "🔐", name: "Acme ID", host: "login.localhost" };
function page(body: string) { /* returns a styled HTML card from THEME — see src/ */ }
```

| File | accent | icon | name |
|---|---|---|---|
| `idp.ts` | purple | 🔐 | Acme ID |
| `dashboard.ts` | blue | 📊 | Acme Dashboard |
| `docs.ts` | green | 📄 | Acme Docs |

**Observe:** re-run the SSO demo — the browser now flashes purple→blue→green as it hops, making every redirect visible.

---

## Step 6 — logout, and the single-logout problem

Add a **local** `/logout` to each app (clear its own cookie) and a logout link on its logged-in page:

```ts
app.get("/logout", (req, res) => {
  const sid = getCookie("dashboard_session", req.headers.cookie);
  if (sid) sessions.delete(sid);
  res.setHeader("Set-Cookie", "dashboard_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  const next = req.query.next as string;
  if (next) return res.redirect(next);        // used by single-logout in Step 7
  res.send(page(`<h2>Logged out</h2><p><a href="/">Log back in</a></p>`));
});
```
(Same in `docs.ts` with `docs_session`.)

**Observe the problem:** log into both, then visit `dashboard.localhost:3001/logout`. Open `docs.localhost:3002/` → **still logged in** (Dashboard can't clear Docs' cookie). And revisit Dashboard → **silently logged back in**, because the `idp_session` was never cleared.

---

## Step 7 — real single logout (the fiddly fix)

The IdP must route the browser through every app's logout. Add to `src/idp.ts`:

```ts
app.get("/logout", (req, res) => {
  const sid = getSessionId(req.headers.cookie);
  if (sid) sessions.delete(sid);
  res.setHeader("Set-Cookie", "idp_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  const done  = "http://login.localhost:3000/logout/done";
  const step2 = `http://docs.localhost:3002/logout?next=${encodeURIComponent(done)}`;
  const step1 = `http://dashboard.localhost:3001/logout?next=${encodeURIComponent(step2)}`;
  res.redirect(step1);   // chain through every app — the IdP must KNOW each one
});
app.get("/logout/done", (req, res) => res.send(page("<h2>Logged out everywhere</h2>")));
```
Add a `<a href="http://login.localhost:3000/logout">Log out everywhere</a>` link to each app.

**Observe the fix:** click **Log out everywhere** → browser marches `login → dashboard → docs → login/done`; both apps now show login. Why it's fiddly: the IdP hardcodes every app (add one → edit the chain); if one app is down the chain stalls (partial logout). Real OIDC uses front-channel iframes (hurt by third-party-cookie blocking) or back-channel signed logout tokens.

---

## Step 8 — prove the proof is unforgeable (`src/attack.ts`)

The proof rides through the browser — why can't an attacker edit it? The signature. Create `src/attack.ts` (full version in `src/`) that verifies a genuine proof, a forged one (wrong secret), and a tampered one (payload rewritten, old signature):

```bash
npx tsx src/attack.ts
#   [1] genuine  → ✅ ACCEPTED as alice
#   [2] forged   → ❌ REJECTED: signature verification failed
#   [3] tampered → ❌ REJECTED: signature verification failed
```
That's why the front channel is safe for the proof: tampering is caught, forgery needs the secret. Remove `jwtVerify` and [2]/[3] would log in as `admin`.

---

## The five-step pattern (§7), mapped

1. Visit app, no session → client `GET /`.
2. App redirects to IdP with a request → `redirect(/authorize?...&state=S)`.
3. User authenticates *or reuses a live session* → IdP `/authorize` checks `idp_session`.
4. IdP redirects back with proof → `redirect(redirect_uri?proof=…&state=S)`.
5. App validates proof, starts its own session → client `/callback` sets its cookie.

Three proof guards, one per attack class: **signature** (forgery/tamper), **`state`** (CSRF, one-time), **`exp`** (replay window).

## Checkpoint

1. Trace every redirect and cookie for opening Docs *after* already being in Dashboard.
2. Why must the IdP cookie be `SameSite=Lax`, not `Strict`?
3. Why can't logging out of one app log you out of the others without the IdP?
4. Why is it safe to send the signed proof through the browser, when OAuth keeps its access token off it?

## Deliverables

- [ ] Three servers run; SSO works (second app, no password).
- [ ] Single-logout demo: local logout leaves the other in; "log out everywhere" clears both.
- [ ] `npx tsx src/attack.ts` shows genuine accepted, forged + tampered rejected.
- [ ] Checkpoint answered.

## Known gaps (fixed later)

- **Shared HMAC secret** — every app can mint proofs. Lab 04 → public/private keypair.
- **No `redirect_uri` validation** — open redirect. Real IdPs pin it. Lab 05.
- **`state` in a global `Set`** — not tied to the browser/session; fine for one user.
- **Homegrown SSO** — Labs 05–06 rebuild it on real OAuth 2.0 + OIDC with Keycloak.
