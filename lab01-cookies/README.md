# Lab 01 — Cookies: giving each client its own ticket

**Concept:** Fix Lab 00's detonation. Instead of one shared `currentUser` box, give *each* browser its own box plus a **ticket** (a cookie) that says which box is theirs. The server hands out the ticket once (`Set-Cookie`); the browser hands it back on every later request (`Cookie`), automatically. Then feel what the cookie **flags** protect.

**Maps to:** `iam-foundations-final.md` §3 (cookies), §5 (cookies + redirects as a team).

**Time:** ~half day. **Prerequisites:** Lab 00. For the browser demos (HttpOnly, SameSite) you need to reach the server from a real browser — see [Reaching the server from a browser](#reaching-the-server-from-a-browser-wsl2-note) at the end if you're on WSL2.

> This lab builds a session by hand — no session library — so the coat-check mechanism is fully visible.

---

## Setup

Same npm ritual as Lab 00 (from inside `lab01-cookies/`):

```bash
npm init -y
npm pkg set type="module"
npm install express
npm install -D typescript tsx @types/express @types/node
npm pkg set scripts.dev="tsx watch src/server.ts"
npm pkg delete scripts.test
cp ../lab00-stateless/tsconfig.json .
```

Run with `npm run dev`; use a second terminal for `curl`.

---

## Build it in stages

### Stage 1 — issue a ticket, watch it come back

The pure mechanism: server sets a note, browser returns it. `src/server.ts`:

```ts
import express from "express";
import { randomUUID } from "node:crypto";

const app = express();

app.post("/login", (req, res) => {
  const name = req.query.name as string;
  const sessionId = randomUUID();                       // unguessable ticket number
  res.setHeader("Set-Cookie", `session=${sessionId}`);  // "here's your note — hold it"
  res.send(`Logged in as ${name}. Ticket: ${sessionId}.`);
});

app.get("/whoami", (req, res) => {
  const cookie = req.headers.cookie;                    // the raw Cookie header sent back
  res.send(`Cookie header you sent: ${cookie ?? "(none)"}`);
});

app.listen(3000, "127.0.0.1", () => console.log("http://127.0.0.1:3000"));
```

`curl`'s `-c` writes received cookies to a jar file, `-b` sends them back — this is what a browser does automatically:

```bash
curl -v -c jar.cookies -X POST "http://localhost:3000/login?name=alice"   # see `< Set-Cookie:`
cat jar.cookies                                                            # stored, tied to domain
curl -b jar.cookies "http://localhost:3000/whoami"                         # server sees the ticket
curl "http://localhost:3000/whoami"                                        # no jar → (none)
```

Notice in the jar: the cookie is filed under the **domain** (`localhost`), and `expire 0` means it's a *session cookie* (dies when the browser closes) — the `Expires`/`Max-Age` flag in its default state.

### Stage 2 — the coat-check lookup (defuse Lab 00's detonation)

Add the server-side coat room and a hand-rolled cookie parser; rewrite the routes:

```ts
const sessions = new Map<string, string>();   // ticket -> username

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
  sessions.set(sessionId, name);                        // file the coat under this ticket
  res.setHeader("Set-Cookie", `session=${sessionId}`);
  res.send(`Logged in as ${name}.`);
});

app.get("/whoami", (req, res) => {
  const sessionId = getSessionId(req.headers.cookie);
  const name = sessionId ? sessions.get(sessionId) : undefined;
  res.send(name ? `You are ${name}.` : "Nobody is logged in (no valid ticket).");
});
```

Now re-run Lab 00's detonation with **two separate jars** and watch it fail to detonate:

```bash
curl -c alice.cookies -X POST "http://localhost:3000/login?name=alice"
curl -c bob.cookies   -X POST "http://localhost:3000/login?name=bob"
curl -b alice.cookies "http://localhost:3000/whoami"   # → You are alice.
curl -b bob.cookies   "http://localhost:3000/whoami"   # → You are bob.
```

In Lab 00, Bob's login clobbered Alice. Here Alice stays Alice: **separate box per client** (distinct Map entries) + **each client names its own box** (its cookie). The two requirements Lab 00 identified are met.

---

## Break it #1 — steal the ticket (bearer tokens)

§3: *"anyone holding the ticket can claim the coat."* The cookie is a **bearer token** — the server checks the ticket, not who holds it. Copy Alice's value and replay it as an attacker, no jar, no password:

```bash
cat alice.cookies                                              # grab the session=... value
curl -H "Cookie: session=PASTE-ALICES-VALUE" "http://localhost:3000/whoami"   # → You are alice.
```

You became Alice with a string. **That's why cookie theft = session theft**, and why cookie jars (`*.cookies`) are git-ignored — they hold live credentials.

---

## Break it #2 — the flags, one at a time

A cookie flag is an **instruction the server writes and the browser enforces**. The server can't force compliance (a hostile client ignores them); flags protect *honest browsers*.

### `Secure` — only travels over HTTPS

Add `; Secure`:

```ts
res.setHeader("Set-Cookie", `session=${sessionId}; Secure`);
```

- Over plain `http` to a **non-localhost** host, the browser/curl **refuses to even store** it:
  ```bash
  curl -c ho.cookies -X POST "http://app-one.localhost:3000/login?name=alice"
  cat ho.cookies       # no `session` line — not stored
  curl -b ho.cookies   "http://app-one.localhost:3000/whoami"   # → Nobody is logged in
  ```
- **Gotcha:** browsers *and curl* treat `localhost`/`127.0.0.1` as a **secure context**, so `Secure` cookies DO work there over http — which is why local dev works. Test the flag on a non-localhost name (`app-one.localhost`) to see it bite.
- **Nuance:** the server sends the `Set-Cookie` header regardless of scheme — it can't see http vs https (TLS is terminated below the app, often at a proxy). So sending a `Secure` cookie over http is a real *leak* of that value on that response; `Secure` only stops the *client* from storing/resending it insecurely afterward. The real fix is: never serve auth over http.

Revert to no `Secure` for the rest of the lab (we run http):

```ts
// NOTE: production MUST add `; Secure`.
res.setHeader("Set-Cookie", `session=${sessionId}`);
```

### `HttpOnly` — hidden from page JavaScript (XSS defense)

Add a browser-testable demo route (above `listen`):

```ts
app.get("/demo", (req, res) => {
  const sessionId = randomUUID();
  sessions.set(sessionId, "browser-user");
  res.setHeader("Set-Cookie", `session=${sessionId}; HttpOnly; SameSite=Strict`);
  res.send(`<h1>Logged in on app-one.localhost</h1>
    <p>Now visit <a href="http://app-two.localhost:3000/other-site">app-two.localhost/other-site</a></p>`);
});
app.get("/other-site", (req, res) => {
  res.send(`<h1>You are on app-two.localhost — a different site.</h1>
    <p><a href="http://app-one.localhost:3000/whoami">Go to app-one.localhost/whoami</a></p>`);
});
```

In a browser at `http://app-one.localhost:3000/demo`, open DevTools console and type `document.cookie`:
- **Without** `HttpOnly`: it prints `session=...` → any injected script could steal it.
- **With** `HttpOnly`: it prints nothing — JS is blind — yet `/whoami` still says `You are browser-user.` The cookie still goes to the *server*; only *page scripts* are locked out. That kills the XSS steal-the-cookie route.

### `SameSite` — does the ticket cross site boundaries?

Controls whether the cookie is attached when a request is triggered by *another* site. `Strict` = never; `Lax` (browser default) = only on top-level link navigations; `None` = always (requires `Secure`+https).

Because `app-one.localhost` and `app-two.localhost` are **different sites**, demo it:

1. `http://app-one.localhost:3000/demo` — sets a `SameSite=Strict` cookie.
2. `http://app-one.localhost:3000/whoami` — baseline, `You are browser-user.` (same-site).
3. `http://app-two.localhost:3000/other-site` — now "on" another site.
4. Click through to `app-one.localhost/whoami` → **Strict** withholds the cookie → `Nobody is logged in.`

Switch the `/demo` cookie to `SameSite=Lax`, re-run: the click now shows `You are browser-user.` — Lax permits the cookie on a top-level navigation where Strict blocked it.

---

## The lesson → why this is the SSO problem

A cookie belongs to one domain and rides only with requests to that domain (and, with `SameSite`, only when the request isn't cross-site). So when you're logged in at `login.localhost`, a second app at `app-two.localhost` can neither *read* nor *be sent* that login cookie. The only holder is your **browser**. The only way to use it is to **move the browser onto `login.localhost`'s domain** — via a **redirect** — where the cookie is released. That redirect dance is Single Sign-On (Lab 02).

---

## Reaching the server from a browser (WSL2 note)

The HttpOnly/SameSite demos need a real browser, and cross-site needs multiple hostnames. Two facts make this painless:

1. **Use `*.localhost` names** (`app-one.localhost`, `app-two.localhost`, `login.localhost`). Browsers auto-resolve any `*.localhost` name to loopback per RFC 6761 — **no hosts file needed**. (Avoid `.local` — it's reserved for mDNS and won't resolve via the hosts file on Windows.)
2. **On WSL2, enable mirrored networking** so loopback names reach the WSL VM. In `C:\Users\<you>\.wslconfig`:
   ```
   [wsl2]
   networkingMode=mirrored
   ```
   Then `wsl --shutdown` (PowerShell), reopen WSL, restart the server. Requires WSL ≥ 2.0.0 / Windows 11 22H2+. Default NAT mode only forwards the literal name `localhost`, so `127.0.0.1` and custom names fail — mirrored mode fixes that by sharing Windows' network stack. Bind the server to `127.0.0.1` so mirrored mode doesn't expose the lab on your LAN.

   *(Alternative if mirrored isn't available: run a browser inside WSL via WSLg, where `/etc/hosts` and localhost work natively.)*

---

## Checkpoint

1. Why does stealing the cookie value = stealing the session? What check is *missing*?
2. What exactly does each flag prevent: `Secure`, `HttpOnly`, `SameSite`?
3. Who *enforces* cookie flags — the server or the browser? Why does that mean they don't stop a hostile client?
4. In one sentence: why can't `app-two.localhost` see that you're logged in at `login.localhost`?

---

## Deliverables

- [ ] `src/server.ts` runs; two separate jars stay separate (Lab 00's detonation defused).
- [ ] A transcript of the ticket-replay theft (`Cookie: session=...` → `You are alice.`).
- [ ] Observed `document.cookie` empty under `HttpOnly`, and the `Strict`-vs-`Lax` cross-site click difference.
- [ ] Checkpoint answered in a sentence each.
