# Lab 03 — AuthN vs AuthZ, and the classic bug

**Concept:** *Knowing who you are* (authentication, AuthN) is not *deciding what you may do* (authorization, AuthZ). Collapsing the two — "if you're logged in, you're allowed" — is the most common real-world auth bug. This lab writes that bug on purpose, fixes it, proves the fix with the revocation test, then makes it clickable in a browser.

**Maps to:** `iam-foundations-final.md` §9 (Authentication vs Authorization).

**Time:** ~half day. **Prerequisites:** Lab 01 (cookies, sessions).

> **How to follow this lab:** do the steps in order. We build it **curl-first** (Steps 1–3) to keep the logic bare, then add a **browser UI** (Step 4), then a **regression test** (Step 5) — the exact path this lab was built. The finished `src/server.ts` is the Step-4 (browser) version; Steps 1–3 show the same logic with plain text responses so the *decision* stays in focus. This lab skips passwords — you "log in" as a named user who has a role.

## The idea in plain words

Two questions sound the same but aren't: **"Who are you?"** (authentication) and **"Are you allowed to do this?"** (authorization). Logging in answers the first. It says *nothing* about the second.

The classic bug is treating them as one — "you're logged in, so go ahead" — which lets *any* valid account into *everything*. The fix is always **two checks**: first establish who you are, then *separately* decide whether that person may do this specific thing. They even differ in rhythm: identity is checked once and lasts your session, while permission is checked on *every* action and can change mid-session. That's the revocation test — your login can still be valid at 2:01pm while your admin rights, revoked at 2pm, are already gone, because the permission check runs fresh every single time.

---

## Setup

```bash
npm init -y
npm pkg set type="module"
npm install express
npm install -D typescript tsx @types/express @types/node
cp ../lab02-sso/tsconfig.json .
npm pkg set scripts.dev="tsx watch src/server.ts"
npm pkg set scripts.test="tsx src/test-authz.ts"
```

Run with `npm run dev`; use a second terminal for `curl`.

---

## Step 1 — a login with roles, and the bug (curl)

Create **`src/server.ts`** with a user directory (who exists + their role), a session store, an authentication helper, and three routes — where `/admin` has the classic bug:

```ts
import express from "express";
import { randomUUID } from "node:crypto";

const app = express();

// Who exists, and what role each has.
const users: Record<string, { role: string }> = {
  alice: { role: "admin" },
  bob:   { role: "user" },
};
const sessions = new Map<string, string>();   // sessionId -> username

function getCookie(name: string, h?: string) {
  if (!h) return undefined;
  for (const p of h.split(";")) { const [k, v] = p.trim().split("="); if (k === name) return v; }
  return undefined;
}

// AUTHENTICATION: who is this request?
function currentUser(req: express.Request): string | undefined {
  return sessions.get(getCookie("session", req.headers.cookie) ?? "");
}

app.post("/login", (req, res) => {
  const username = req.query.user as string;
  if (!users[username]) return res.status(400).send("No such user.\n");
  const sessionId = randomUUID();
  sessions.set(sessionId, username);
  res.setHeader("Set-Cookie", `session=${sessionId}; HttpOnly; Path=/`);
  res.send(`Logged in as ${username} (role: ${users[username].role}).\n`);
});

app.get("/profile", (req, res) => {   // any logged-in user may see their own profile
  const user = currentUser(req);
  if (!user) return res.status(401).send("Not logged in.\n");
  res.send(`Profile of ${user} (role: ${users[user].role}).\n`);
});

app.get("/admin", (req, res) => {     // admin area — WITH THE BUG
  const user = currentUser(req);
  if (user) return res.send(`ADMIN PANEL — welcome ${user}.\n`);  // BUG: only checks AuthN
  res.status(401).send("Not logged in.\n");
});

app.listen(3000, "127.0.0.1", () => console.log("http://localhost:3000"));
```

The bug: `/admin` asks only "are you logged in?" (authentication), never "are you an admin?" (authorization).

**Run and observe** Bob (a plain user) breaking in:
```bash
npm run dev    # terminal 1
```
```bash
curl -c bob.cookies -X POST "http://localhost:3000/login?user=bob"   # → role: user
curl -b bob.cookies "http://localhost:3000/admin"
#   → ADMIN PANEL — welcome bob.      ← THE BUG (a non-admin in the admin panel)
```

---

## Step 2 — the two-check fix (curl)

Add an authorization helper and rewrite `/admin` to ask *both* questions:

```ts
// AUTHORIZATION: is this user allowed? (a separate question)
function isAdmin(username: string): boolean {
  return users[username]?.role === "admin";
}
```
```ts
app.get("/admin", (req, res) => {
  const user = currentUser(req);                                  // AuthN: who are you?
  if (!user) return res.status(401).send("Not logged in.\n");     // 401: not authenticated
  if (!isAdmin(user)) return res.status(403).send("Forbidden: admins only.\n");  // 403: not allowed
  res.send(`ADMIN PANEL — welcome ${user}.\n`);
});
```

`isAuthenticated && isAllowed(...)`. The status codes map to the two questions: **401** = not authenticated, **403** = authenticated but not authorized. (HTTP confusingly named `401` "Unauthorized" when it means *unauthenticated*; `403` Forbidden is the real *unauthorized*.)

**Run and observe** — Bob turned away, Alice let in:
```bash
curl -i -b bob.cookies "http://localhost:3000/admin"                 # → 403 Forbidden
curl -c alice.cookies -X POST "http://localhost:3000/login?user=alice"
curl -i -b alice.cookies "http://localhost:3000/admin"               # → 200 OK, ADMIN PANEL — welcome alice.
```

---

## Step 3 — the revocation test (curl)

The scenario that proves AuthN and AuthZ come apart. Add a route that simulates IT changing the access list:

```ts
app.post("/revoke-admin", (req, res) => {
  const username = req.query.user as string;
  if (users[username]) users[username].role = "user";
  res.send(`${username} is no longer an admin.\n`);
});
```

**Run and observe** — Alice keeps the *same session* throughout:
```bash
curl -b alice.cookies "http://localhost:3000/admin"            # → ADMIN PANEL (allowed, 9am)
curl -X POST "http://localhost:3000/revoke-admin?user=alice"   # IT revokes at 2pm
curl -i -b alice.cookies "http://localhost:3000/admin"         # → 403 (denied at 2:01)
curl    -b alice.cookies "http://localhost:3000/profile"       # → still works (still authenticated)
```

Trace it: **when** — authz is checked every request, so 2:01 re-checks her current role; **shelf life** — her authentication is untouched (same cookie, `/profile` works); **who decides** — the role lives in `users` (IT changed it), the session in `sessions` (untouched). A perfectly authenticated user, correctly denied.

---

## Step 4 — make it clickable (browser UI)

Now wrap the same logic in a browser UI so the split is visible in clicks. Rewrite the responses to return styled HTML via a `page()` helper, add a home page with login buttons, a logout, and a "revoke my admin" button, and make `login`/`logout`/`revoke` `302`-redirect to `/` (the post/redirect/get pattern). **The full styled version is the finished `src/server.ts`** — key shape:

```ts
// a themed card helper (amber), same idea as the Lab 02 page() helper
const THEME = { accent: "#d97706", accent2: "#f59e0b", icon: "🛡️", name: "Acme Console", host: "localhost:3000" };
function page(body: string) { /* returns an HTML card — see src/server.ts */ return body; }

app.get("/", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.send(page(`<h2>Sign in</h2>
    <form method="POST" action="/login?user=alice"><button>Log in as Alice (admin)</button></form>
    <form method="POST" action="/login?user=bob"><button class="alt">Log in as Bob (user)</button></form>`));
  res.send(page(`<h2>Signed in as ${user}</h2><p>Role: <b>${users[user].role}</b></p>
    <div class="row"><a class="btn" href="/profile">My profile</a><a class="btn" href="/admin">Admin panel</a></div>
    <form method="POST" action="/revoke-admin?user=${user}"><button class="warn">Revoke my admin (IT, at 2pm)</button></form>
    <form method="POST" action="/logout"><button class="alt">Log out</button></form>`));
});
// /login, /logout, /revoke-admin now res.redirect("/"); /profile and /admin render page(...) with 401/403 pages.
```

**Run and observe** — open `http://localhost:3000/` and click through:

1. **Log in as Bob (user)** → Home shows **Role: user**.
2. **Admin panel** → **🚫 Forbidden** ("authenticated as bob, but not authorized"). *(the fix)*
3. **Log out** → **Log in as Alice (admin)** → **Admin panel** → **🔑 Admin panel**. *(both checks pass)*
4. Click **Revoke my admin** — you never log out — Home now shows **Role: user**.
5. **Admin panel** → **🚫 Forbidden** now. *(revocation, mid-session)*
6. **My profile** → still works. *(authentication intact)*

Steps 4–6 are the payoff: admin access vanishes *without logging out*, identity stays valid. *(Restart the server to reset roles for another run.)*

---

## Step 5 — lock it in with a regression test

Create **`src/test-authz.ts`** (full version in `src/`) that logs in as Bob and Alice and asserts a non-admin gets `403` and an admin gets `200`. It passes now, and would fail loudly if the two checks were ever merged back into one.

```bash
# restart the server first (the revoke demo mutates roles in memory), then:
npm test
#   → ✅ authz test passed: non-admin → 403, admin → 200
```

---

## Checkpoint

1. What is the difference between `401` and `403`, in terms of AuthN vs AuthZ?
2. In the revocation test, what exactly changed and what stayed the same — and which check caught it?
3. Why is `/profile` correctly guarded by an authentication check alone, while `/admin` needs both?
4. Which line, removed, reintroduces the classic bug?

## Deliverables

- [ ] Step 1 reproduced (Bob reaches `/admin`), then the fix (Bob `403`, Alice `200`).
- [ ] Revocation demo: after `/revoke-admin`, Alice's `/admin` → `403` but `/profile` still works.
- [ ] Browser click-through completed.
- [ ] `npm test` passes (and you understand why it would fail if the checks merged).
- [ ] Checkpoint answered.

## Known gaps (addressed in later labs)

- **Roles are hardcoded and coarse.** This is the simplest authorization model (a role check). Lab 10 builds RBAC properly, then ABAC/ReBAC for context- and relationship-based access.
- **No real login.** Deliberate — AuthN mechanics live in Labs 01–02 and 05–06. This lab isolates the *decision*.
