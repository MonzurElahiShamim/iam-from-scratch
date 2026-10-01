# Lab 04 — JWTs: build, verify, forge, defend

**Concept:** Open the JWT envelope. Build a token by hand, read its payload with no key (encode ≠ encrypt), switch from a shared secret to a public/private keypair, publish a JWKS, then forge admin tokens past a naive verifier with the two classic attacks — and defend.

**Maps to:** `iam-foundations-final.md` §12 (JWT: the self-contained token).

**Time:** ~1 day. **Prerequisites:** Labs 01–02 (you've already *used* a JWT — the SSO proof — now you dissect it).

> **How to follow:** do the steps in order. This lab is script-based (JWTs are best seen as raw bytes in the terminal), with one small server (the JWKS endpoint) in Step 3. Each step: create a file, run it with `npx tsx`, read the output. The finished files are in `src/`.

## The idea in plain words

A session cookie is just a ticket number — the real information lives on the server, so every check means a lookup. Fine for one server, but painful when a token minted by one party must be checked by many others (maybe different companies): nobody wants a database round-trip, or shared database access, on every request.

A **JWT** flips this around: instead of a ticket pointing at server-side data, the token *carries* the data ("this is alice, expires 3pm") and is **signed**. Now any server can read it and check it **offline**, with no lookup. Two things make that safe:

- **A signature** — so the contents can't be forged or altered. Note it's *signed, not encrypted*: anyone can read a JWT (so never put secrets in one), but only the holder of the key can produce a valid one.
- **Asymmetric keys** — the issuer signs with a *private* key; everyone else verifies with a freely published *public* key. So only the issuer can mint tokens, but anyone can check them.

The danger to respect: a JWT's header says which algorithm it uses — and that header is attacker-controlled. So a verifier must **pin** the algorithm itself and never trust that field. That one rule defeats both forgery attacks in this lab.

---

## Step 0 — set up the project

```bash
npm init -y
npm pkg set type="module"
npm install express jose
npm install -D typescript tsx @types/express @types/node
npm pkg delete scripts.test
cp ../lab03-authn-authz/tsconfig.json .
```

We run scripts directly with `npx tsx src/<file>.ts`.

---

## Step 1 — mint a JWT, then read it with no key (`src/mint.ts`)

```ts
import { SignJWT } from "jose";
const secret = new TextEncoder().encode("dev-secret-change-me");   // HMAC key (HS256)

const jwt = await new SignJWT({ role: "user" })
  .setProtectedHeader({ alg: "HS256", typ: "JWT" })
  .setSubject("alice").setIssuer("https://issuer.example").setAudience("my-app")
  .setExpirationTime("1h").sign(secret);
console.log(jwt);
```

**Run & observe:**
```bash
npx tsx src/mint.ts            # → header.payload.signature (two dots, three base64url parts)

# decode the first two parts with NO secret:
node -e "const [h,p]=process.argv[1].split('.'); const d=x=>JSON.parse(Buffer.from(x,'base64url')); console.log('HEADER :',d(h)); console.log('PAYLOAD:',d(p));" "PASTE_JWT"
#   HEADER : { alg: 'HS256', typ: 'JWT' }
#   PAYLOAD: { role: 'user', sub: 'alice', iss: ..., aud: 'my-app', exp: ... }
```

**Lesson:** the header and payload are only **base64url-encoded** (trivially reversible), not encrypted. A JWT is **sealed, not secret** — the signature stops *tampering*, not *reading*. Never put confidential data in a JWT payload.

---

## Step 2 — verify, then tamper and watch it fail (`src/verify.ts`)

```ts
import { SignJWT, jwtVerify } from "jose";
const secret = new TextEncoder().encode("dev-secret-change-me");

const jwt = await new SignJWT({ role: "user" }).setProtectedHeader({ alg: "HS256", typ: "JWT" })
  .setSubject("alice").setIssuer("https://issuer.example").setAudience("my-app")
  .setExpirationTime("1h").sign(secret);

// 1) verify genuine — checks signature + iss + aud + exp
const { payload } = await jwtVerify(jwt, secret, { issuer: "https://issuer.example", audience: "my-app" });
console.log("✅ genuine verified →", { sub: payload.sub, role: payload.role });

// 2) tamper: rewrite payload to role:admin, keep the signature
const [h, p, s] = jwt.split(".");
const hacked = { ...JSON.parse(Buffer.from(p, "base64url").toString()), role: "admin" };
const tampered = `${h}.${Buffer.from(JSON.stringify(hacked)).toString("base64url")}.${s}`;
try { await jwtVerify(tampered, secret, { issuer: "https://issuer.example", audience: "my-app" });
  console.log("❌ tampered ACCEPTED"); }
catch (e) { console.log("✅ tampered REJECTED →", (e as Error).message); }
```

**Run & observe:**
```bash
npx tsx src/verify.ts
#   ✅ genuine verified → { sub: 'alice', role: 'user' }
#   ✅ tampered REJECTED → signature verification failed
```

**Lesson:** `jwtVerify` recomputes the signature over the `header.payload` *as received*; a changed payload no longer matches, and you can't produce a new signature without the secret. Readable, but not forgeable. The `issuer`/`audience` options also reject a validly-signed token meant for someone else, or expired.

---

## Step 3 — RS256 + a JWKS endpoint (`src/jwks-server.ts`, `src/verify-remote.ts`)

HS256 forces every verifier to hold the signing secret (so any could mint tokens). RS256 splits it: **private key signs (secret), public key verifies (shared)**.

**Issuer server** (`src/jwks-server.ts`): generates an RSA keypair, publishes the public key at `/.well-known/jwks.json`, mints RS256 tokens at `/token` signed with the private key. (Full file in `src/`.)

```bash
npx tsx src/jwks-server.ts                                    # terminal 1
curl -s http://localhost:4000/.well-known/jwks.json | jq     # public key only (n/e/kid/alg) — no private material
curl -s http://localhost:4000/token                          # an RS256 token (header has alg:RS256 + kid)
```

**Remote verifier** (`src/verify-remote.ts`): fetches a token and the JWKS, verifies with the public key — no secret anywhere.

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";
const token = await (await fetch("http://localhost:4000/token")).text();
const JWKS = createRemoteJWKSet(new URL("http://localhost:4000/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, JWKS, { issuer: "https://issuer.example", audience: "my-app" });
console.log("✅ verified with public JWKS →", { sub: payload.sub, role: payload.role });
```
```bash
npx tsx src/verify-remote.ts        # → ✅ verified with public JWKS → { sub: 'alice', role: 'user' }
```

**Lesson:** the verifier never had the private key — only the issuer can sign, everyone can verify. This is exactly how a resource server validates a provider's access token (Lab 06): fetch the JWKS, verify offline, trust the claims, no per-request call to the issuer. The `kid` tells the verifier which key in the JWKS to use (issuers rotate keys).

**How can the public key verify but not forge?** The two keys are a matched pair of inverse operations: the private key *does* something to the hash (signing), and the public key *undoes* it (verifying). If the undo works, it must have been the private key that did it — so the signature checks out. But knowing how to *undo* gives you no way to *do* it yourself, so the public key can check a signature yet never create one. The "undo" is safe to hand to the whole world; the "do" stays with the issuer.

---

## Step 4 — forge admin tokens, then defend (`src/forge.ts`)

Both classic attacks exploit one mistake: **trusting the `alg` field in the header**. Build a naive verifier, forge past it with only *public* info, then fix.

The naive verifier reads `alg` from the token and acts on it; the attacks:
- **`alg:none`** — set `"alg":"none"`, drop the signature; the naive verifier skips the check.
- **Algorithm confusion (RS256→HS256)** — flip the header to `HS256` and sign using **the public key as the HMAC secret** (it's public, so the attacker has it); the naive verifier HMACs with the same public key and it matches.

(Full `src/forge.ts` uses `node:crypto` to build a naive verifier and both forged tokens.)

**Run & observe — both forgeries accepted by naive, rejected by safe:**
```bash
npx tsx src/forge.ts
#   genuine       → { sub: 'alice', role: 'user' }
#   alg:none      → { sub: 'attacker', role: 'admin' }   ← naive ACCEPTED
#   alg confusion → { sub: 'attacker', role: 'admin' }   ← naive ACCEPTED
#   --- safe verifier (pins algorithms: ['RS256']) ---
#   genuine   → ✅ accepted
#   alg:none  → ❌ rejected: "alg" value not allowed
#   confusion → ❌ rejected: "alg" value not allowed
```

**The fix:** decide the algorithm and key **out of band** and pin them — `jwtVerify(token, key, { algorithms: ["RS256"] })` with a real RSA key object. jose then won't honor `none` and won't HMAC with an RSA key. **The header describes the token; it does not get to decide how the token is trusted.**

---

## Checkpoint

1. Why can anyone read a JWT's payload without the key? What does the signature actually protect?
2. HS256 vs RS256: who can sign, who can verify, and why does RS256 fit "one issuer, many independent verifiers"?
3. Why are `alg:none` and algorithm confusion the *same* root mistake? What single rule defeats both?
4. What is the `kid` header for?

## Deliverables

- [ ] `mint.ts` — minted a token and read its payload with no key.
- [ ] `verify.ts` — genuine verified, tampered rejected.
- [ ] `jwks-server.ts` + `verify-remote.ts` — RS256 token verified via the published JWKS, no secret.
- [ ] `forge.ts` — both forgeries accepted by the naive verifier, rejected by the pinned one.
- [ ] Checkpoint answered.

## Known gaps / what's next

- **Revocation.** A self-contained JWT can't be revoked before `exp` — the statelessness-vs-revocation trade-off (§12's core cost). That's **Lab 07** (short expiry, refresh tokens, `jti` blocklist, introspection, JWT-vs-opaque).
- **The JWKS pattern returns.** In **Lab 06**, your resource server fetches a real provider's (Keycloak's) JWKS and validates access tokens exactly as `verify-remote.ts` does here.
