# iam-from-scratch

Hands-on labs for learning web identity and access management from first principles — cookies, sessions, SSO, OAuth 2.0, OIDC, and JWTs — built from scratch in Node and TypeScript.

## What this is

A set of small, self-contained labs that build web authentication and authorization *by hand*, one mechanism at a time. No auth library does the interesting part for you: you write the client, the server, the session store, and the token validation yourself, so you can see exactly how each piece works.

Two written companions sit alongside the labs:

- **[The Mechanics of Web Identity and Access Management](iam-foundations-final.md)** — the concepts, from first principles (cookies and redirects up through OAuth, OIDC, JWT, SAML, federation, SCIM, authorization models, and passkeys). Read the relevant section before each lab.
- **[The hands-on plan](iam-handson-plan.md)** — the full lab curriculum, pacing, and rationale.

## The method

Every lab follows the same shape: **build a mechanism, then break it.** You implement something that works, then deliberately attack or misconfigure it and watch it fail — because seeing the failure is what makes the safeguard make sense. Each lab ends with a short list of what you should be able to explain from your own code.

## Prerequisites

- **Node 20+** and **npm**
- **Docker** (only from Lab 05 onward, for a real identity provider)
- A modern **browser** for the labs that involve redirects and cookies
- Comfort with the terminal, `curl`, and reading HTTP headers

TypeScript runs directly via [`tsx`](https://github.com/privatenumber/tsx) — there's no separate build step.

## Getting started

```bash
git clone <your-fork-or-clone-url> iam-from-scratch
cd iam-from-scratch/lab00-stateless
npm install
npm run dev
```

Each lab is an independent npm project. The pattern for every lab is the same:

```bash
cd labXX-topic
npm install       # restore dependencies (node_modules is not committed)
npm run dev       # start the server (auto-restarts on save)
```

Then follow that lab's `README.md`.

### Hostnames and local networking

Several labs use multiple hostnames to demonstrate how the browser isolates cookies by domain. We use **`*.localhost`** names (`app-one.localhost`, `login.localhost`, etc.) — browsers auto-resolve any `*.localhost` name to loopback with no hosts-file setup required.

If you're on **WSL2**, enable *mirrored networking* so those loopback names reach the Linux VM from a Windows browser. Full setup notes are in [lab01-cookies/README.md](lab01-cookies/README.md#reaching-the-server-from-a-browser-wsl2-note).

## How to use the labs

Do them **in order** — each builds on the last. Every lab folder contains:

- `README.md` — Concept · Setup · Build (in stages) · Break it · Checkpoint · Deliverables
- `src/` — the code you write
- `package.json` / `tsconfig.json` — the project setup

The lab READMEs walk you through building the code yourself in stages, with the commands to run and what you should observe at each step. The `src/` files are the end-state to compare against — note that some labs (e.g. Lab 00) end *deliberately broken* to motivate the next one.

## Labs

| # | Topic | You build / feel | Status |
|---|---|---|---|
| [00](lab00-stateless/README.md) | Statelessness | Why HTTP has no memory; the global-variable trap | ✅ |
| [01](lab01-cookies/README.md) | Cookies & sessions | The coat-check session; cookie theft; `Secure` / `HttpOnly` / `SameSite` | ✅ |
| [02](lab02-sso/README.md) | Single sign-on | The redirect dance across three servers, by hand | 🚧 in progress |
| 03 | AuthN vs AuthZ | The `if (authenticated) grant()` bug; the revocation test | planned |
| 04 | JWTs | Build, verify, forge (`alg:none`, algorithm confusion), and defend | planned |
| 05 | OAuth 2.0 | The authorization code flow against a real IdP; PKCE | planned |
| 06 | OpenID Connect | Real login + your own resource server; the confused-deputy attack | planned |
| 07 | Refresh & revocation | Rotation, the revocation gap, JWT vs opaque tokens | planned |
| 08 | SAML *(optional)* | Signed XML assertions; the enterprise-SSO wrinkles | planned |
| 09 | Federation | The identity broker; JIT provisioning and its gap | planned |
| 10 | SCIM & authz models | Provisioning (deactivate ≠ delete); RBAC / ABAC / ReBAC | planned |
| 11 | MFA & passkeys | TOTP phishing relay vs passkey origin binding | planned |
| — | Capstone | Wire it all together + a one-page threat model | planned |

## Safety

These labs deliberately build broken flows and demonstrate attacks. Keep them harmless:

- Everything binds to **localhost / `127.0.0.1`** — never expose a lab server, identity provider, or endpoint on a public interface.
- **Fake credentials only** — no real passwords, personal data, or API keys.
- **Never commit secrets** — `.env`, TLS keys (`*.pem`), and cookie jars (`*.cookies`) are git-ignored; use `.env.example` with placeholders.
- The attacks are for **your own machine only.**

## License

[MIT](LICENSE) © 2026 Monzur Elahi Shamim
