# IAM Hands-On Labs — Build It Yourself

*A learn-by-building companion to the notes in `iam-foundations-final.md`. Stack: **Node 20 + TypeScript**. Emphasis: you write the client, the resource server, and the token validation yourself — no framework doing the interesting part for you.*

**The one rule:** you already understand the concepts, so each lab exists to make you *feel a mechanism, then break it*. Every lab ends with a **Break it** step, because seeing the failure is what makes the safeguard real. Don't skip those.

> This document is written to be followed by anyone, from a clean machine, in order. It doubles as the repo's guide. If you're reading it as a repo, start at [How to use this repo](#how-to-use-this-repo).

---

## How to use this repo

Each lab lives in its own folder and is self-contained — clone, `cd`, `npm install`, run. Do them **in order**; each reuses ideas (and sometimes code) from the last.

```
iam-labs/
├── README.md                  ← this file (or a short version linking to it)
├── SETUP.md                   ← the one-time setup below, extracted
├── docker-compose.yml         ← Keycloak (+ OpenFGA later), shared by labs 5+
├── .gitignore                 ← node_modules, .env, *.pem, realm exports with secrets
├── .env.example               ← copy to .env; never commit real .env
├── certs/                      ← local dev certs from mkcert (git-ignored)
├── shared/                    ← tiny helpers reused across labs (logging, hosts)
├── lab00-stateless/
├── lab01-cookies/
├── lab02-sso/
├── lab03-authn-authz/
├── lab04-jwt/
├── lab05-oauth/
├── lab06-oidc/
├── lab07-refresh-revocation/
├── lab08-saml/                 (optional)
├── lab09-federation/
├── lab10-scim-authz/
├── lab11-mfa-passkeys/
└── capstone/
```

**Every lab folder contains the same shape**, so a follower always knows where to look:

```
labNN-topic/
├── README.md        ← Concept · Prerequisites · Build · Break it · Checkpoint · Deliverables
├── package.json
├── src/             ← your code
├── requests.http    ← raw curl/HTTP calls to run alongside (the "watch the headers" part)
└── SOLUTION.md      ← what you should have observed + answers to the checkpoint (write this last)
```

Each lab README follows a fixed template so the repo reads consistently:

1. **Concept** — the one idea this lab makes concrete (with the `iam-foundations-final.md` section it maps to).
2. **Prerequisites** — which earlier lab / setup step it assumes.
3. **Build** — numbered steps to a working thing.
4. **Break it** — the deliberate failure(s) that motivate the safeguard.
5. **Checkpoint** — questions you must be able to answer from *your own* code before moving on.
6. **Deliverables** — what should exist when the lab is "done" (see below).

### What every lab delivers

A lab is **done** when the folder contains:

- **Working code** that runs with a single documented command.
- **A request/response trace** in `requests.http` (or a saved `curl -v` transcript) showing the key headers — `Set-Cookie`, `Location`, `Authorization`, token bodies.
- **One attack demonstration** — the "Break it" step, reproduced, with a one-line note on what you saw.
- **A short written explanation** (a paragraph in `SOLUTION.md`) naming the safeguard and the exact attack it stops.

If you can't write that last paragraph from memory, the lab isn't done yet — that's the real test.

---

## One-time setup

Do this once before Lab 0. It's also extracted into `SETUP.md` for followers.

### 1. Tooling

| Tool | Version used here | Check |
| --- | --- | --- |
| Node | 20 LTS | `node --version` |
| Docker + Compose | any recent | `docker compose version` |
| curl, jq | any | `curl --version`, `jq --version` |
| mkcert | any | needed for HTTPS labs (install below) |

Per lab, the base toolbox is: `tsx` (run TS directly), `express`, `cookie-parser`, `jose` (JWTs/keys — the workhorse, install it early), and `openid-client` (only from Lab 5 on). Lab-specific extras (`otplib`, `@simplewebauthn/*`, `@node-saml/node-saml`) are noted in that lab.

### 2. Hostnames (`/etc/hosts`)

Using distinct **hostnames** — not just ports — is what makes the cookie and SSO labs honest: cookies are scoped by domain, and `localhost:3000` vs `localhost:4000` share a cookie jar in ways real, different domains don't. Add:

```
127.0.0.1  app-one.local app-two.local login.local api.local broker.local upstream.local
```

### 3. Local HTTPS (required from Lab 1's SameSite step onward)

Here's a correction worth internalizing early: **`SameSite=None` cookies are only honored when also marked `Secure`, and `Secure` cookies aren't sent over plain HTTP** (except on `localhost` itself, which browsers treat as a secure context — but our `*.local` hostnames are *not* `localhost`). So the cross-site cookie experiments **need real HTTPS**, or they'll fail for the wrong reason and teach you nothing.

Fix it once with a locally-trusted cert:

```bash
# install mkcert (Linux): see https://github.com/FiloSottile/mkcert
mkcert -install
mkcert -cert-file certs/local.pem -key-file certs/local-key.pem \
  app-one.local app-two.local login.local api.local broker.local upstream.local
```

Then have each lab server read `certs/local.pem` / `certs/local-key.pem` and listen on HTTPS. A `shared/https.ts` helper (a few lines wrapping `https.createServer`) keeps this out of your way.

> **Fallback if you can't install mkcert:** run everything on `http://localhost:<port>` and *skip only* the `SameSite=None` cross-site demonstration, noting in `SOLUTION.md` that it requires HTTPS. Everything else in the labs works over plain HTTP on localhost.

### 4. Keycloak (from Lab 5 on)

`docker-compose.yml` at the repo root:

```yaml
services:
  keycloak:
    image: quay.io/keycloak/keycloak:latest
    command: start-dev --import-realm
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
    ports: ["8080:8080"]
    volumes: ["./keycloak/realms:/opt/keycloak/data/import"]
```

Export your configured realm to `keycloak/realms/` and commit it (**after scrubbing client secrets**) so a follower gets your exact setup with `docker compose up`. This is the single most valuable thing you can do for reproducibility.

### 5. Safety & responsible use

These labs deliberately build broken flows and attacks. Keep them harmless:

- **Everything binds to `localhost` / `127.0.0.1` only.** Never expose Keycloak, a lab server, or the SCIM endpoint on a public interface or tunnel.
- **Fake credentials only.** No real passwords, no real personal data, no real API keys. `alice/password` is the vibe.
- **Never commit secrets.** `.env`, `*.pem`, and realm exports with live secrets are git-ignored; use `.env.example` with placeholders.
- **Don't copy real tokens into logs, `requests.http`, or commits.** Tokens are bearer credentials even in a lab. Redact before saving a trace.
- **The attacks are for your own machine only.** Real-time phishing relays, MFA-fatigue floods, and token replay are demonstrated against *your* localhost services and nowhere else.

---

## Lab 00 — See the statelessness problem (30 min)

**Concept:** §1 — HTTP has no memory. Feel the problem before fixing it.

**Build:**
- A ~20-line Express server with one route `GET /whoami` that tries to greet you by name — no cookies, no storage.
- Hit it twice with `curl`. Confirm the server cannot tell the two requests apart.

**Break it:** add a global `let lastUser` and watch it "work" for one browser, then catastrophically leak identity across two browsers. That bug *is* why session state must be keyed per-client, not global.

**Checkpoint:** why can't the server tell request #2 came from the same person as #1?

**Deliverables:** the server; a `curl` transcript of two indistinguishable requests; the one-paragraph note.

---

## Lab 01 — Cookies & sessions from scratch (half day)

**Concept:** §3 (cookies), §5 (cookies + redirects), cookie flags. No session library — build the coat-check ticket yourself.

**Prerequisites:** Lab 00; local HTTPS set up (step 3) for the SameSite part.

**Build:**
1. `POST /login` checks a hardcoded password, generates `crypto.randomUUID()`, stores `{ sessionId -> username }` in a `Map`, sends `Set-Cookie: session=…`.
2. `GET /dashboard` reads the cookie, looks it up, greets the user — the coat-check ticket, literally.
3. `GET /logout` deletes the map entry and expires the cookie.

**Break it — one per flag:**
- Copy the cookie value, replay it from `curl`. You *are* the user now → why session cookies are bearer-sensitive.
- Set `HttpOnly`, try `document.cookie` in the console → can't read it (XSS defense).
- Set `Secure`, request over plain HTTP → cookie silently dropped. Feel it break.
- **`SameSite` (needs HTTPS — see setup step 3):** serve `app-one.local` and `app-two.local` over HTTPS. Have `app-two.local` embed a form/image hitting `app-one.local`, and compare `Strict` vs `Lax` vs `None` (`None` **must** be paired with `Secure`, hence HTTPS). Watch whether the cookie rides along. This sets up *why SSO needs redirects, not shared cookies*.

**Checkpoint:** why does stealing the cookie = stealing the session? What exactly does each flag prevent?

**Deliverables:** the login/dashboard/logout server; a trace of `Set-Cookie` and the replay; a note per flag.

---

## Lab 02 — Single sign-on by hand (1 day)

**Concept:** §6 (the SSO dance), §7 (the five-step pattern). The keystone lab — **no OAuth library yet.**

**Prerequisites:** Lab 01.

Three servers: `login.local` (IdP), `app-one.local`, `app-two.local`. We'll walk the "open the *second* app while already logged into the *first*" scenario end to end, so the roles stay consistent throughout:

**Build:**
1. Log into `app-one.local` first (the normal first-login-of-the-day: the IdP shows a password form, sets *its own* cookie, redirects back).
2. Now open `app-two.local` for the first time. It sees no session cookie of its own → `302` to `login.local`.
3. `login.local` finds *its own* cookie (set in step 1) → skips the password and `302`s back to `app-two.local` carrying a **signed proof** of identity.
4. `app-two.local` validates the proof, sets *its own* cookie, serves the page — no password typed.

**Make the proof safe (correcting a naive first pass):** a bare signed blob is replayable — a stolen valid proof could be reused. So the proof must carry, and the app must check:
- **`exp`** — a short expiry (seconds), rejected once passed.
- **`aud`** — which app it's for, so a proof for `app-two` can't be used at `app-one`.
- **A one-time `nonce`/`jti`** that the requesting app generated, planted before the redirect, and checks on return — then burns. This is the hand-built ancestor of OIDC's `state`/`nonce`, and building it here is why those parameters feel obvious later.

Sign with `jose` and a shared key for now (Lab 04 replaces shared-secret signing with asymmetric keys).

**Break it:**
- `GET /logout` on the IdP that clears only the IdP cookie → confirm you're still logged into both apps. That's §"why single logout is hard," felt.
- Then implement real single logout (IdP notifies each app to clear its own cookie) and feel how fiddly it is.
- Tamper with the signed proof in transit → rejected. Remove the signature check entirely → account takeover.
- **Replay:** capture a valid proof and submit it twice → the second is rejected *because* of `exp` + one-time `nonce`. Remove those and watch replay succeed. This is why step "make the proof safe" exists.

**Checkpoint:** narrate every redirect and every cookie in the jar at each step. Which cookie is released where, and why?

**Deliverables:** three servers; a full redirect trace; the replay demo (works without `exp`/`nonce`, fails with them).

---

## Lab 03 — AuthN vs AuthZ, and the classic bug (half day)

**Concept:** §9. Short but essential.

**Prerequisites:** Lab 02.

**Build & break (same step here — the bug *is* the lesson):**
- Add `/profile` (any logged-in user) and `/admin` (role `admin` only).
- Write the **bug** on purpose: `if (isAuthenticated(req)) grantAccess()`. Log in as a normal user → you reach `/admin`. See it.
- Fix to two checks: `isAuthenticated && isAllowed(user, action, resource)`.
- **Revocation test (§9):** user logs in at "9am"; flip their role in the store at "2pm"; they hit `/admin` at "2:01" → denied, though their session is still valid. Exactly the notes' scenario.

**Checkpoint:** why does a valid session not imply permission? Which check catches the revoked user?

**Deliverables:** the two-route app; an automated test that **passes only when both checks are present** (a regression guard for the most common IAM bug); the revocation demo.

---

## Lab 04 — JWTs: build, verify, forge, defend (1 day)

**Concept:** §12. Do this before real OAuth so tokens aren't magic later.

**Prerequisites:** Lab 03.

**Build:**
1. With `jose`: mint an HS256 JWT with `sub`, `aud`, `exp`, `iss`. Decode the three parts with `base64` in the terminal — **read the payload with no key** to prove "encode ≠ encrypt."
2. Verify it. Edit the payload (`user` → `admin`), re-base64 it, watch verification fail (signature no longer matches).
3. Switch to RS256: generate a keypair, sign with the private key, verify with the public. Publish the public key as JWKS at `/.well-known/jwks.json` — you'll consume this in Lab 06.

**Break it (the two §12 attacks, hands-on):**
- **`alg:none`:** strip the signature, set `"alg":"none"`, write a naive verifier that trusts the header → forged admin token accepted. Fix by pinning the algorithm out of band.
- **Algorithm confusion (RS256→HS256):** sign a token with the *public* key using HS256, feed it to a verifier that reads `alg` from the token → forged. Fix: verifier pins both key and algorithm, never trusts the header.

**Checkpoint:** why is trusting the token's own `alg` header the root of both attacks?

**Deliverables:** mint/verify scripts (HS256 + RS256); the JWKS endpoint; both forgeries reproduced against a naive verifier and rejected by the hardened one.

---

## Lab 05 — OAuth 2.0 authorization code flow (1–2 days)

**Concept:** §10. Now bring in a real IdP so you're a real client.

**Prerequisites:** Lab 04; Keycloak running (setup step 4).

**Build:**
- In Keycloak, register a **confidential client** with a redirect URI.
- **Configure the audience (correction — easy to miss):** by default Keycloak's access token may not carry your API's identifier in `aud`, so a correct resource server would reject it later. Add an **audience mapper** (or a client scope that includes the resource server as an audience) so the access token's `aud` names your API. You'll rely on this in Lab 06.
- *Without* `openid-client` at first, implement the flow with raw redirects and `fetch`, to feel front vs back channel:
  1. Redirect browser to `/authorize` with `client_id`, `scope`, `redirect_uri`, `state`.
  2. Log in at Keycloak (its domain, its cookie — your Lab 02 SSO, now real).
  3. Receive the `code` on your `redirect_uri` (front channel).
  4. **Back channel:** server-to-server `POST /token` with `code` + `client_secret` → access token. Print it, decode it.
  5. Call a protected route with the token.

**Break it:**
- Ignore `state` → build the callback-CSRF scenario and see why `state` exists (this is the same job as Lab 02's one-time nonce).
- Put the access token in a URL/query string and watch it land in history/logs → why the implicit flow died.
- Replay a used `code` → rejected (single-use).

**Then add PKCE** as a **public client** (SPA-style): generate `code_verifier`/`code_challenge`, drop the secret, prove a stolen code is useless without the verifier. §"Confidential vs public clients, and PKCE," made concrete.

**Checkpoint:** what travels on which channel, and why is the code safe to expose but the token not?

**Deliverables:** the raw flow + the PKCE variant; the audience-mapper config noted in the lab README; the three break demos.

---

## Lab 06 — OpenID Connect: real login + your own resource server (1–2 days)

**Concept:** §11; ties back to Lab 04's JWKS.

**Prerequisites:** Lab 05 (incl. the audience mapper).

**Build:**
1. Add `scope=openid profile email` to Lab 05's flow — now you also get an **ID token**.
2. Verify the ID token *yourself* against Keycloak's JWKS (from `/.well-known/openid-configuration`): signature, `aud` = your client, `exp`, `nonce`. Read `sub`, create *your own* app session. §"Applying this to your own application," Case 1.
3. Build **Case 2**: a resource server on `api.local` that validates the *access token* per request (issuer, **audience** — the mapper from Lab 05 matters here — expiry, scope) via discovery + JWKS, no shared secret. The payoff of Lab 04's asymmetric signing.

**Break it — the confused-deputy attack (§11):**
- Build the broken "log in with the access token" shortcut; present a token minted for a *different* client and log in as someone else. Fix by requiring the ID token with correct `aud`. Feeling this attack is the single best reason to do OIDC by hand.
- Match accounts on `email` instead of `sub`, change the email at the IdP → account confusion. Switch to `sub`.

**Stretch — BFF:** backend runs the flow, holds tokens server-side, browser gets only a cookie. Contrast with putting the token in `localStorage` and reading it from the console (public-client exposure).

**Checkpoint:** why can't an access token log a user in? What does the `aud` check on the ID token stop?

**Deliverables:** the OIDC login (Case 1) and the resource server (Case 2); the confused-deputy demo and its fix; the `sub`-vs-`email` demo.

---

## Lab 07 — Refresh tokens, revocation & the JWT-vs-opaque choice (1 day)

**Concept:** §"Access tokens and refresh tokens" **and** §"statelessness versus revocation" / §"JWT or opaque." Where §12's central trade-off becomes a decision you make.

**Prerequisites:** Lab 06.

**Build:**
- Short access-token lifetime in Keycloak (e.g. 60s). Watch an API call fail after expiry.
- Silent refresh on the back channel; confirm no re-prompt.
- **Refresh token rotation + reuse detection:** Keycloak supports this via the realm setting **"Revoke Refresh Token"** (Realm settings → Tokens). Turn it on, use an old refresh token after rotation, and watch the reuse be rejected. *(Setting names/behavior shift slightly across Keycloak versions — confirm the toggle in your version's admin console before relying on the exact wording.)* It works *because* the refresh token is the opaque, database-backed model — the coat-check, not a self-contained JWT.

**Feel the revocation gap (§12's core cost):**
- Mint a 5-minute JWT access token, "fire" the user at minute 1, and confirm your resource server *keeps accepting the token* until expiry — there's no record to delete. "A self-contained token cannot be individually revoked before it expires," felt.
- Implement the two heavier tools and feel the cost each reintroduces:
  - a **`jti` blocklist** the resource server checks per request, and
  - **token introspection** (resource server asks Keycloak's introspection endpoint about each token).
  Both bring back the per-request lookup JWTs existed to avoid — that's the point.

**On "opaque tokens" (correction):** Keycloak issues **JWT access tokens**; it has no simple switch to emit opaque ones. So model the opaque side honestly by **treating the token as a reference and validating it *only* by introspection** — ignore the JWT body, call the introspection endpoint every time. That reproduces the opaque model's properties (instant revocation, a round trip per call) using the machinery Keycloak actually has. Note in `SOLUTION.md` that a purpose-built AS could issue genuinely opaque tokens; the trade-off table in §12 is what you're demonstrating either way.

**Checkpoint:** why is the refresh token revocable but the access token not? What does each of introspection / `jti`-blocklist cost you?

**Deliverables:** silent refresh + rotation demo; the "fired user still gets in" demo; both revocation approaches; the introspection-as-opaque contrast with the trade-off written out.

---

## Lab 08 — SAML *(optional, 1 day)*

**Concept:** §13. Do only if you'll touch enterprise SSO.

**Prerequisites:** Lab 06.

**Build:**
- Add a SAML client in Keycloak; use `@node-saml/node-saml` for the SP side.
- Exchange **metadata** both directions (SAML's discovery equivalent). Note the signing **certificate is embedded** in metadata, not fetched from a live rotating endpoint like OIDC's JWKS.
- Compare to Lab 06: same five-step choreography, different envelope. Watch the **POST binding** in devtools — the signed XML **assertion travels through the browser** in a hidden auto-submitting form. Confirm *why that's safe* (§13): signed (can't tamper) + audience-restricted (can't replay elsewhere), and SAML has no bearer token, so no back channel.

**Break it (the two §13 wrinkles):**
- Tamper with an assertion attribute → XML signature rejects it; try an unsigned assertion.
- Change the audience / replay at a *different* SP → refused.
- Trigger an **IdP-initiated** login → no SP-side state to correlate against (no `nonce` equivalent): the replay/injection window §13 warns about. Contrast SP-initiated, which the SP can check.
- Simulate an **expired certificate** (rotate Keycloak's signing cert without updating your SP metadata) → SSO breaks. The classic "SAML just stopped working" failure OIDC avoids via auto key rotation.

**Checkpoint:** why is it safe to send the SAML assertion through the browser when OIDC deliberately keeps the token off it?

**Deliverables:** working SP↔Keycloak SAML login; tamper + replay + IdP-initiated + expired-cert demos.

---

## Lab 09 — Federation & the identity broker (1 day)

**Concept:** §14. Federation is "SSO with a role-flip"; Keycloak makes the flip visible.

**Prerequisites:** Lab 06.

**Build:**
- Run a **second** IdP as "upstream" — a second Keycloak realm (`upstream.local`), or wire Keycloak to broker **Sign in with Google**. Configure your first Keycloak (`broker.local`) as an **identity broker** trusting it.
- Log in through the chain; watch the broker play **two roles at once**: IdP to your Lab 06 app *downstream*, client to the upstream IdP. The "which role is this box playing here?" idea, named.
- If brokering more than one upstream, add **home-realm discovery** (route by email domain or an org picker).

**Then feel the JIT gap that motivates SCIM (§14 → §15):**
- On first federated login, **JIT-provision** a local user from the trusted token's claims — matched on `sub`, not email. Later logins find-and-update.
- "Fire" the user upstream. They can't log in anymore — but confirm the **orphaned local record still exists** (still owns data, still in "share with" lists, still a billed seat). JIT is login-triggered; departure produces no login. Sets up Lab 10.

**Checkpoint:** in the chain, which box is client and which is IdP, and when does that flip?

**Deliverables:** the brokered login chain; the JIT provisioning code; the orphaned-record demo after "firing."

---

## Lab 10 — SCIM provisioning & authorization models (1–2 days)

**Concept:** §15 SCIM, §16 RBAC/ABAC/ReBAC.

**Prerequisites:** Lab 09 (SCIM half); Lab 03 (authz half).

**SCIM (§15) — close Lab 09's deprovisioning gap:**
- Implement a minimal SCIM 2.0 endpoint (`/scim/v2/Users`) with the standard User schema (`schemas`, `id`, `externalId`, `userName`, `active`, `groups`). Support `POST`, `GET`/filter, `PATCH`, `DELETE`. Protect it with a bearer token (SCIM is itself a protected API).
- Headline op: **deactivate, don't delete** — `PATCH active:false`. Confirm the record and authored work survive while login is cut, vs. a `DELETE` that orphans everything.
- Match on stable `id`/`externalId`, not email — same principle as `sub`.
- Point Keycloak (or `curl`) at it and watch the **push-on-change** model: the source fires deactivation the instant someone leaves — the inversion of JIT's pull-on-login.

**Authorization models (§16) — one policy, three ways:**
Encode "a developer may write, but only own-team repos, only in business hours, only from the company network" three times:
- **RBAC:** roles → permissions table. Then deliberately hit **role explosion** trying to encode the conditions with roles alone.
- **ABAC:** rewrite as one rule — `subject.team == resource.owning_team AND time IN business_hours AND ip IN company_range`. It never names a team, so one rule covers all. Feel the cost: trace a "why was I denied?" and see it needs evaluating the whole rule, not reading a table.
- **ReBAC:** model per-document sharing as a graph (`Alice —member of→ Team A —owns→ Folder X —contains→ Doc Y`); decide by path reachability. Use a tiny tuple store you write, or run **[OpenFGA](https://openfga.dev)** in Docker (the open Zanzibar-style engine §16 references — add it to `docker-compose.yml`).
- Run the *same* request through all three; then layer them as real systems do (RBAC coarse cut, ABAC conditions, ReBAC sharing). Tie to §10: a **scope gates the app, these gate the user**, and they stack.

**Checkpoint:** why deactivate rather than delete? Where does RBAC break and ABAC rescue it — and where does ReBAC fit that ABAC doesn't?

**Deliverables:** the SCIM endpoint with deactivate demo; the same policy implemented in all three models with a comparison note.

---

## Lab 11 — MFA & passkeys (1 day)

**Concept:** §17. Feel the dividing line in §17's ranking table — phishable vs phishing-resistant is a difference *in kind*.

**Prerequisites:** Lab 01/02 login to attach factors to.

**Build & break:**
- **TOTP:** generate a secret + QR, verify a 6-digit code (`otplib`). Stage the **real-time phishing relay** (§17): a fake page captures the code, you replay it to the real site inside its validity window → it works. TOTP resists SIM-swap/SS7 (no phone number) but is **still phishable**.
- **Push approval + MFA fatigue:** add an "approve this login?" prompt, then fire repeated attempts and watch the prompt flood that pressures a user into approving one. Number-matching blunts blind flooding but doesn't restore phishing resistance.
- **Passkey / WebAuthn:** registration + login with `@simplewebauthn/server` + `/browser`. Register a platform authenticator, log in with no password. Confirm the site stores only the **public key** — a DB leak exposes nothing usable.
- **The origin binding that ends phishing:** repeat the relay attack against the passkey. The device signs for the *fake* origin; relayed to the real site, the wrong origin makes the real site reject it — automatically, because the *browser* enforces the domain check, not the human. Phishing-*resistant* vs phishing-*harder*, felt.

**Checkpoint:** why does the passkey relay fail where the TOTP relay succeeds?

**Deliverables:** TOTP + push + passkey flows; the successful TOTP relay and the failed passkey relay, side by side.

---

## Pacing — by effort, not by calendar

Total hands-on time is roughly **8–12 focused days** for everything, so don't hold yourself to a fixed weekly schedule. Do it in tracks:

| Track | Labs | ~Effort | You'll be able to… |
| --- | --- | --- | --- |
| **Foundations (core)** | 00–02 | 2 days | Explain and build cookies, sessions, and SSO from raw HTTP |
| **The two questions + tokens** | 03–04 | 1.5 days | Separate AuthN/AuthZ; build, verify, and forge JWTs |
| **Real protocols** | 05–06 | 2–3 days | Run OAuth + OIDC against a real IdP; validate tokens yourself |
| **Best single add-on** | 07 | 1 day | Make the statelessness-vs-revocation trade-off a real decision |
| **Enterprise IAM** | 09–10 (08 optional) | 2–3 days | Federation, provisioning, and the three authz models |
| **Modern auth** | 11 | 1 day | Show why passkeys end phishing as a category |

**Recommended path:** do the core (00–06) first, then Lab 07, then pick an advanced track (enterprise or modern auth) by interest. Attempt the capstone only after the core plus at least one advanced track. If time is truly short, the irreducible four are **01, 02, 04, 06** — sessions, SSO, JWTs, OIDC.

---

## Capstone

Wire it into one coherent system: Keycloak as IdP (brokering an upstream, so federation is live); `app-one.local` and `app-two.local` as OIDC clients sharing SSO; `api.local` as a resource server validating access tokens; SCIM provisioning users in and deactivating on departure; RBAC + ABAC + ReBAC layered for access; passkeys for login.

Then write a one-page **threat model** — for each safeguard you built, name the attack it stops:

| Safeguard | Attack it stops |
| --- | --- |
| `state` (and Lab 02's one-time nonce) | callback CSRF / proof replay |
| `nonce` in the ID token | ID-token replay / injection |
| PKCE verifier | authorization-code interception |
| `aud` check on the ID token | confused-deputy / token from another client |
| match on `sub` | account takeover via email change |
| algorithm pinning | `alg:none` and RS256→HS256 confusion |
| `SameSite` + `Secure` | cross-site cookie leakage / CSRF |
| short access-token TTL | bounded blast radius of a leaked token |
| SCIM `active:false` on departure | access that outlives employment |
| passkey origin binding | real-time phishing |

**Definition of done for the whole repo:** you can fill and explain that table from memory, and a stranger can `git clone`, follow `SETUP.md`, and reproduce any lab's "Break it" demo without asking you a question.

---

*Changelog — this revision incorporated an external review: fixed the Lab 02 role-consistency wording; added replay protection (`exp` + one-time nonce + `aud`) to the hand-built SSO proof; documented that `SameSite=None` needs `Secure`+HTTPS and added local-cert setup; added the Keycloak audience-mapper step to Lab 05/06; named the exact Keycloak "Revoke Refresh Token" setting with a version caveat; reframed the opaque-token exercise as introspection-based since Keycloak issues JWTs; re-paced by effort rather than calendar weeks; and added per-lab deliverables plus a safety/responsible-use section.*
