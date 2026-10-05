# Lab 05 — OAuth 2.0 with a real authorization server

**Concept:** Stop hand-building servers and become a *client* to real infrastructure. Run **Keycloak** (a production-grade authorization server) in Docker, then execute the OAuth 2.0 **authorization code flow** by hand — feeling front channel vs back channel against a server you didn't write — and add **PKCE** for clients that can't keep a secret.

**Maps to:** `iam-foundations-final.md` §10 (OAuth 2.0: delegated access).

**Time:** 1–2 days. **Prerequisites:** Lab 02 (the hand-built version of this flow), Lab 04 (JWTs — Keycloak's tokens are JWTs). Docker running.

> ⚠️ Keycloak runs in `start-dev` mode (no HTTPS, fast boot) — never in production. Secrets live in `.env` (git-ignored); only `.env.example` is committed.

## The idea in plain words

OAuth answers a different question from login: *"can this app do something on my behalf, without getting my password?"* The app sends your browser to the **authorization server** (Keycloak), where *you* log in on *its* domain and consent. Keycloak then hands the app a **token** scoped to specific access.

The clever part is **keeping the valuable token off the browser**. The browser is an exposed channel (URLs leak into history, logs, the `Referer` header). So the flow sends a near-worthless **authorization code** back through the browser (front channel), and the app swaps that code for the real **token** on a direct server-to-server call (back channel), proving who it is with its **client secret**. Two channels: non-secret stuff through the browser, secrets and tokens server-to-server.

**PKCE** is for apps that *can't* hold a secret (single-page, mobile — anything shipped to the user). Instead of a pre-shared secret, the app invents a random **verifier** per login, sends only its **hash** (the challenge) on the front channel, and proves possession of the verifier on the back channel. A stolen code is useless without the verifier, which never left the app.

---

## Step 0 — stand up Keycloak

**Create `docker-compose.yml`:**
```yaml
services:
  keycloak:
    image: quay.io/keycloak/keycloak:latest
    container_name: iam-keycloak
    command: start-dev
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
    ports:
      - "8888:8080"      # host 8888 → container 8080 (8080 on the host was already taken)
```
```bash
docker compose up -d
docker compose logs -f keycloak        # wait for "started in …s", then Ctrl+C
```
Open **`http://localhost:8888`**, log in **admin / admin**. (Keycloak boots in ~40s; a connection refused before that just means it's still starting.)

> **Port note:** this compose maps host **8888** because 8080 was in use. If 8080 is free on your machine, use `"8080:8080"` and replace `8888` with `8080` everywhere below.

---

## Step 1 — realm, client, user (in the admin console)

A **realm** is an isolated world of users/clients. Keep `master` for admin; make one for the lab.

1. **Create realm** → name **`iam-labs`** → Create. (Make sure the realm switcher shows `iam-labs` for everything below.)
2. **Clients → Create client** → OpenID Connect, Client ID **`web-app`** → Next → **Client authentication: ON** (confidential — it gets a secret), **Standard flow** on → Next → Valid redirect URIs `http://localhost:3000/callback`, Web origins `http://localhost:3000` → Save.
3. `web-app` → **Credentials** tab → copy the **Client Secret** (into `.env`, below).
4. **Users → Create user** → username **`alice`** → Create → **Credentials** → Set password `password`, Temporary **OFF**.

---

## Step 2 — the authorization code flow, by hand

```bash
npm init -y
npm pkg set type="module"
npm install express dotenv jose
npm install -D typescript tsx @types/express @types/node
npm pkg set scripts.dev="tsx watch src/client.ts"
cp ../lab04-jwt/tsconfig.json .
```

**`.env`** (git-ignored — paste your real secret):
```
KC_BASE=http://localhost:8888
KC_REALM=iam-labs
CLIENT_ID=web-app
CLIENT_SECRET=your-client-secret
REDIRECT_URI=http://localhost:3000/callback
```
Also commit a **`.env.example`** with placeholder values.

**`src/client.ts`** — full file in `src/`. The shape:
- `GET /login` → **front channel**: redirect the browser to Keycloak's `/auth` with `client_id`, `redirect_uri`, `response_type=code`, `state`.
- `GET /callback` → receives `?code=…&state=…` (front channel). Verifies `state` (CSRF guard, as in Lab 02), then does the **back channel**: `POST /token` with the `code` + `client_secret` → tokens.

**Run & observe:**
```bash
npm run dev
```
Open `http://localhost:3000/` → **Log in with Keycloak** → sign in as `alice`. Watch the hops:
1. `localhost:3000/login` → **302** to `localhost:8888/.../auth?...` — you're on **Keycloak's** domain. (To see this URL: glance at the address bar on Keycloak's login page, or DevTools → Network with **Preserve log** on.)
2. Keycloak's own login form → authenticate.
3. `localhost:3000/callback?code=…&state=…` — the **code** arrives in the URL (front channel).
4. Your server's back-channel `POST /token` returns `access_token`, `expires_in`, `refresh_token`, `token_type`.

**The key feel:** the *code* travelled through your browser; the *access token* did not — it came back only on the server-to-server back channel.

**Decode the access token** (it's a JWT — Lab 04):
```bash
node -e "console.log(Buffer.from(process.argv[1].split('.')[1],'base64url').toString())" "PASTE_ACCESS_TOKEN"
```
You'll see `iss` (`http://localhost:8888/realms/iam-labs`), `sub`, `exp`, `azp`, `scope`, `realm_access.roles`. In Lab 06 a resource server verifies this against Keycloak's JWKS.

---

## Step 3 — break it

**The code is single-use.** Your callback already redeemed it; replay it with curl and watch it fail:
```bash
curl -s -X POST "http://localhost:8888/realms/iam-labs/protocol/openid-connect/token" \
  -d grant_type=authorization_code -d code=THE_USED_CODE \
  -d redirect_uri=http://localhost:3000/callback \
  -d client_id=web-app -d client_secret=YOUR_SECRET | jq
#   → { "error": "invalid_grant", "error_description": "Code not valid" }
```
A reused code is a theft signal; real servers can revoke the tokens it produced.

Two more guards you already have:
- **`state`** — without it, an attacker could splice their login into your callback (CSRF). Your `pendingStates` check stops it.
- **Token in the URL** — the dead "implicit flow" returned the *token* in the redirect, leaking it into history/logs/`Referer`. The code flow returns a worthless code instead, keeping the token on the back channel.

---

## Step 4 — PKCE (a public client, no secret)

A single-page/mobile app can't hide a secret, so it uses a per-login verifier instead.

**4a — create a public client:** Clients → Create client → ID **`spa`** → Next → **Client authentication: OFF** (public), Standard flow on → Next → same redirect URI / web origins → Save. *(Optional: Advanced tab → set PKCE Code Challenge Method = S256 to require it.)*

**4b — the PKCE client** (`src/client-pkce.ts`, full file in `src/`; `npm run pkce`):
- `GET /login`: make a random **verifier**, send only its SHA-256 **challenge** (`code_challenge` + `code_challenge_method=S256`) on the front channel; keep the verifier in memory.
- `GET /callback`: exchange the code with `code_verifier` and **no `client_secret`**.

**Run** `npm run pkce` (stop the Step-2 client first — same port), log in as alice → tokens come back with **no secret anywhere in the flow**.

**The break — prove the verifier is load-bearing:** temporarily change `code_verifier: verifier` to `code_verifier: "wrong-verifier-value"`, re-run the login:
```json
{ "error": "invalid_grant", "error_description": "PKCE verification failed" }
```
Even a valid, fresh code fails without the right verifier — which never crossed the browser. Revert the line afterward.

---

## Checkpoint

1. What travels on the front channel vs the back channel, and why is the code safe to expose but the token not?
2. Why does the authorization code exist at all — why not return the token in the first redirect?
3. What does PKCE replace, and what does it prove? What can't it prove (hint: it's not client *authentication*)?
4. Why is a reused authorization code treated as an attack?

## Deliverables

- [ ] Keycloak up at `localhost:8888`; realm `iam-labs` with `web-app` (confidential), `spa` (public), user `alice`.
- [ ] Confidential code flow returns tokens; you traced the front/back channel split.
- [ ] Code-replay rejected (`invalid_grant`).
- [ ] PKCE flow returns tokens with no secret; wrong verifier → `PKCE verification failed`.
- [ ] Checkpoint answered.

## Known gaps / what's next

- **No `openid` scope yet** — this is pure OAuth (access token only, no identity guarantee). **Lab 06** adds `scope=openid` → an **ID token** for login, and builds a **resource server** that validates the access token against Keycloak's JWKS (plus an **audience mapper** so the token's `aud` names the API).
- **Realm reproducibility** — a follower must click through Step 1, or import an exported realm. To make it one-command, export the realm (`Realm settings → Action → Partial export`, or `kc.sh export`) and commit the scrubbed JSON, then mount it with `--import-realm`.
- **`.env` secret** — rotate the client secret if it ever leaks (Keycloak → client → Credentials → Regenerate).
