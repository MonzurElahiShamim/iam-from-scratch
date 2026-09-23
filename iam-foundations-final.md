# The Mechanics of Web Identity and Access Management

*How authentication, single sign-on, tokens, and access control actually work — from first principles, before any protocol names.*

Most explanations of identity and access management (IAM) start with a pile of acronyms: OAuth, OIDC, SAML, JWT, SCIM, MFA. That's backwards. Those are all solutions, and they're hard to follow until you understand the problem they're solving.

So this note skips the acronyms and covers the groundwork instead: the handful of roles every login system uses, the two web mechanisms everything is built on (cookies and redirects), and why single sign-on ends up working the way it does. You don't need to know any protocols to follow along — that's the whole idea.

---

## 1. Why identity is hard at all

Start with a fact about the web that causes all the trouble: **HTTP has no memory.**

Every HTTP request arrives at a server as a complete stranger. The server reads it, sends a response, and immediately forgets you ever existed. The next request from the same browser — even a fraction of a second later — arrives as another total stranger. HTTP is *stateless*: each request stands alone, carrying no knowledge of any request before it.

This is fine for serving a static page. It is a disaster for anything personal. If the server forgets you the instant it answers, then how can it possibly know, on your *second* request, that you are the same person who typed a password on your *first*? Without a solution, you would have to send your username and password on every single click.

Everything that follows — cookies, sessions, login systems, single sign-on — comes back to this one problem: giving a protocol with no memory a way to remember you.

---

## 2. The four roles in a login

Before getting into the mechanics, it helps to know the players. However complicated a login system looks, it's usually the same few roles interacting — just under different names. Once you can spot them, the diagrams get a lot easier to read.

There are four:

| Role | What it wants | Other names you'll meet |
| --- | --- | --- |
| **The User** | To access something, proving who they are as rarely as possible. | subject, principal, end-user, resource owner |
| **The Application** | To know who is knocking — *without* having to store passwords itself. | client, relying party (RP), service provider (SP) |
| **The Identity Provider (IdP)** | To be the single place where identity is decided. It runs the login page and holds the credentials. | authorization server, OpenID Provider (OP), asserting party |
| **The Resource** | To hand over data or perform an action — but only after checking the request is allowed. | resource server, protected resource, "the API" |

Think of them as an office building. The **User** is a visitor. The **Application** is a department they want to enter. The **Identity Provider** is the front-desk security guard who checks IDs and issues badges. The **Resource** is a locked filing room that only opens for a valid badge.

### One server can play several roles

The important thing is that these are **roles, not machines.** One piece of software often plays several of them, and it can even play different roles in different conversations.

Take a company that runs its own identity provider for internal logins. To its own apps, that server is the **Identity Provider** — the thing that decides who users are. But say it also offers "Sign in with Google." As soon as a user picks that option, the company's server turns around and talks to Google as a *client* — now it's the **Application**, asking Google's identity provider to vouch for the user. It's the same server playing both roles, sometimes within a single login.

So when you're reading a login diagram, the useful question isn't "which server is this box?" but "which role is this box playing right here?" The same hostname can show up twice doing two different jobs, and once you expect that, these systems get much easier to follow.

---

## 3. Cookies: giving HTTP a memory

The fix for HTTP's forgetfulness is pretty simple: **the server hands your browser a note, and the browser hands it back on every request after that.**

That note is a **cookie.**

### The mechanism, step by step

You log in to a site. Your browser sends your credentials once:

```
POST /login
username=alice&password=correct-horse
```

The server checks the password, and if it is right, replies with an ordinary response plus one special header:

```
200 OK
Set-Cookie: session=k3n8fj2p9x
```

That `Set-Cookie` header is the server saying: *"Here is a note. Hold onto it."* Your browser stores the string `session=k3n8fj2p9x`.

From this moment on, **automatically**, without the web page doing anything at all, every future request your browser makes to that site includes the note back:

```
GET /dashboard
Cookie: session=k3n8fj2p9x
```

The server reads `k3n8fj2p9x`, looks it up in its own memory ("this is Alice, who logged in at 14:02"), and serves her dashboard. HTTP is still forgetful, but the cookie carries the memory across the gap. And the browser attaches it by itself on every request — the page doesn't have to do anything.

### A cookie is a coat-check ticket

A useful way to picture a session cookie is as a **coat-check ticket.**

The value `k3n8fj2p9x` isn't your name, your password, or your data — it's just a stub. The *server* holds the coat: all your real session information sits in the server's memory, filed under that number. The ticket only says "I'm whoever this number belongs to."

This has an important consequence: **anyone holding the ticket can claim the coat.** If someone steals your session cookie, the server cannot tell them apart from you — the ticket is all it checks. This is why session cookies are sensitive, and why the protective flags below exist.

### Cookies are tied to one domain

There's one fact about cookies worth remembering above the others, because it ends up shaping how single sign-on works:

> **A cookie belongs to the domain that set it, and the browser sends it back *only* to that domain.**

If `accounts.example.com` set a cookie, your browser attaches it only to requests going back to `accounts.example.com`. A request to `app.example.com`, or to any other site, won't carry it. Different domain, different jar — the browser keeps each site's cookies separate and never lets one site see another's.

There's nothing clever going on here. The browser doesn't track changes or reason about context. On every request it just checks which cookies in its jar are tagged for the domain it's about to contact, and sends those. Destination matches the tag, the cookie goes along; if it doesn't, the cookie stays put.

This rule comes back in Section 6, where it does most of the explaining.

### Common cookie flags

Real cookies carry attributes that control their behaviour and security:

| Flag | What it does |
| --- | --- |
| `Expires` / `Max-Age` | When the cookie dies. With neither, it vanishes when the browser closes. |
| `HttpOnly` | JavaScript on the page cannot read the cookie — a key defence against theft via cross-site scripting (XSS). |
| `Secure` | The cookie is only ever sent over HTTPS, never plain HTTP. |
| `SameSite` | Controls whether the cookie is sent when the request originates from *another* site. Critical for both security and — as it turns out — for making cross-site logins work. |
| `Domain` | Can widen a cookie to a parent domain (e.g. `.example.com`) so subdomains share it. |
| `Path` | Narrows a cookie to part of a site (e.g. only `/admin`). |

Of these, `SameSite` is the one to keep an eye on — it's the attribute most likely to quietly break (or protect) a login flow that hops between domains.

---

## 4. Redirects: how the browser gets moved

The second building block is even simpler, and it's just as often misunderstood. People talk about a site "redirecting you" as if it reaches out and moves your browser somewhere. It can't do that. A server only ever answers the request in front of it; it has no way to push your browser anywhere on its own.

A **redirect** is just a note in the response that says, in effect, "not here — go there instead."

When a server wants to send your browser elsewhere, it replies:

```
302 Found
Location: https://accounts.example.com/login
```

That is the entire mechanism. The status code `302` means "redirect," and the `Location` header holds the address. The server serves **no page** — just this note. Your **browser** reads it and, on its own initiative, makes a brand-new request to the URL in `Location`. You did not click anything. Browsers simply obey `Location` headers automatically.

So when someone says *"the app redirects you to the login server,"* here is what physically happens:

1. Your browser asks the app for a page.
2. The app replies `302`, `Location: accounts.example.com/...` — serving no content, just the note.
3. Your browser, obeying the note, makes a fresh request to `accounts.example.com`.

Nothing jumped between servers. The browser walked itself to the new destination, one ordinary HTTP request at a time. That flicker you sometimes see in the address bar — one hostname showing briefly before another loads — is exactly this: a redirect happening in a few milliseconds.

---

## 5. Cookies and redirects are a team

On their own, cookies and redirects are unremarkable. Put them together and you get the mechanism behind every web login. The way they connect is this:

- A **redirect** changes which domain your browser is talking to.
- The **cookie rule** decides which cookie tags along — the one that belongs to that domain.

So a redirect isn't only about navigation. It's also a way of moving your browser onto a particular domain so the cookie for that domain gets released. Move the browser, and the matching cookie comes with it. That's the idea single sign-on is built on, and the next section leans on it entirely.

---

## 6. Putting it together: how single sign-on actually works

We now have everything needed to understand single sign-on (SSO) — the feature where you log in once and then walk into many separate applications without typing your password again.

### The problem SSO must solve

Picture two separate applications, `app-one.com` and `app-two.com`, that both trust a central identity provider at `login.example.com`. You have already logged in to the first app, so you have a session going. Now you open the second app for the first time. It should let you straight in, no password. But how?

Recall the cookie rule. When you logged in via `login.example.com`, that domain set a cookie — but that cookie lives *only* in the `login.example.com` jar. `app-two.com` has never seen it and never will. The browser will not hand `login.example.com`'s cookie to `app-two.com`; wrong domain. Worse, `app-two.com` may not even be able to reach `login.example.com` over the network directly.

So `app-two.com` has no way, on its own, to discover that you are already logged in. It cannot read the identity provider's cookie, and it cannot ask the identity provider behind your back.

But there is exactly one thing in the entire system that *does* hold the `login.example.com` cookie: **your browser.**

### The solution: move the browser to where the cookie lives

Since the browser is the only party holding the login cookie, the only possible solution is to route the browser *through* the identity provider. Watch the cookie rule do all the work. Here is the whole dance as a sequence of plain request-and-reply exchanges:

| # | Your browser asks… | The server answers… |
| --- | --- | --- |
| 1 | `GET app-two.com` | *"I don't know you — no cookie of mine in your jar."* → `302` redirect to `login.example.com` |
| 2 | `GET login.example.com` **← your browser attaches the login cookie, because this request is going to that domain** | *"I recognise this cookie — you're already logged in. No need to ask for a password."* → `302` redirect back to `app-two.com`, carrying proof of who you are |
| 3 | `GET app-two.com` (now with proof) | *"Proof checks out. Welcome in."* → sets its **own** cookie for `app-two.com`, serves the page |

Row 2 is where it all happens. The redirect in Row 1 moved your browser onto `login.example.com`, and because the browser was now making a request to that domain, the cookie rule released the login cookie automatically. The identity provider read the cookie, saw you already had a live session, and skipped the password prompt — it just redirected you back with proof of who you are.

That quiet pass-through — one existing cookie at the identity provider, reused to let a second app in — is really all single sign-on is. There's no hidden channel. The first login left a cookie at the identity provider, and every app after that gets bounced through the same identity provider, where the cookie is already waiting. So nobody has to type a password again.

The first login of the day works a little differently. There's no cookie in the jar yet, so at Row 2 the identity provider *does* show the login page. You authenticate, it sets its cookie, and then it redirects you back. Every app you open after that rides on that one cookie.

### Why single logout is hard

This same mechanism explains a problem that surprises people: logging out of one app often does *not* log you out of the others.

Look at what you are left with after visiting a few apps: a separate cookie in a separate jar for *each* domain — one for `login.example.com`, one for `app-one.com`, one for `app-two.com`, and so on. The identity provider can delete *its own* cookie easily enough. But it has no ability to reach into `app-two.com`'s jar and delete the cookie sitting there. No server can touch another domain's cookies — that is the very rule that made SSO necessary in the first place, now working against us.

So "single logout" cannot be as simple as "clear one cookie." It requires the identity provider to actively *notify* every application that the session is over, and each application to then clear its own cookie. That coordination is fiddly, easy to get wrong, and the reason logout across an SSO system is so often incomplete. The same domain isolation that makes single sign-*in* clean makes single sign-*out* messy.

---

## 7. The five-step pattern behind every login

If you step back from the SSO exchange above, you'll notice it has a shape that shows up in pretty much every login protocol. Take the names away and it comes down to these five steps:

1. **The user visits an application.** They have no session with it yet.
2. **The application redirects the browser to the identity provider,** carrying a request ("please tell me who this is").
3. **The user authenticates** — by typing a password, completing a second factor, or, as we saw, simply by already having a live session cookie.
4. **The identity provider redirects the browser back to the application,** carrying proof of identity.
5. **The application validates the proof and starts its own session** — setting its own cookie — and stops talking to the identity provider.

Three things about this pattern are worth holding onto, because they explain a lot of what looks odd in real systems:

- **The browser is the messenger.** Through steps 1–4, the application and the identity provider may never talk to each other directly. Your browser carries every message between them by following redirects. That's deliberate: neither server needs a network path to the other, which is part of what lets systems from different companies work together.
- **Protocols mostly differ in steps 2 and 4** — in the *format* of the request and the proof. One might use a block of signed XML; another, a short code or a compact token. The choreography stays the same; only the envelopes change. It's why, once one protocol clicks, the next one takes an afternoon instead of a week.
- **Step 5 is easy to forget.** Once the application has its proof, it sets its own cookie and the protocol is done. That separate, per-application cookie is what made single logout hard earlier — and it's easy to miss because it happens right after the interesting part.

---

## 8. Summary

With nothing but cookies and redirects, you can now explain:

- **Why login systems exist at all** — because HTTP has no memory, and something has to carry identity across the gap between requests.
- **Who the players are** — the user, the application, the identity provider, and the resource, understood as *roles* that one system can play several of at once.
- **How a session is remembered** — a coat-check cookie, set by one domain and returned only to that domain.
- **How a browser gets moved** — a `302` redirect with a `Location` header, obeyed automatically.
- **Why single sign-on has the shape it does** — because the login cookie lives only at the identity provider's domain, so the browser must be routed through that domain to release it.
- **Why single logout is hard** — because every application ends up holding its own independent cookie that no other party can clear.

Notice that none of it needed a protocol name, which is really the point. OAuth, OIDC, and SAML are variations on that same five-step pattern — each picks a different format for the request and the proof, and makes different promises about what the proof actually means. Underneath, the five steps, the roles, the cookie, and the redirect stay the same.

Everything else builds on top of this.

---

## 9. Authentication vs Authorization

Every login system rests on two questions that sound alike and get confused constantly: *who are you?* and *what are you allowed to do?* The first is **authentication**; the second is **authorization**. Getting them cleanly apart is the difference between a system that's secure and one that merely looks it.

Because the two full words are so easy to misread for each other in running text, people usually shorten them:

- **Authentication → AuthN** (the "N" from authe**N**tication)
- **Authorization → AuthZ** (the "Z" from authori**Z**ation)

### An analogy to anchor it

Picture an office building with a security guard at the front desk and a locked server room on the third floor. Getting to work involves two separate checks.

The guard checks your ID at the entrance. That's **authentication** — establishing who you are. It happens once, when you arrive, and the building trusts it for the rest of the day; you don't re-prove your identity at every doorway.

The server-room door checks your badge against IT's access list. That's **authorization** — deciding whether you may do a specific thing. And it happens *every time* you try the door. Walk up to it ten times and it checks ten times.

That difference in rhythm — identity checked once, permission checked on every access — is the heart of the distinction, and it's why the two can't be collapsed into a single check.

### The three differences that matter

The textbook definition ("who you are" vs "what you can do") is correct but hard to actually use. These three differences are what make it usable:

| | Authentication (AuthN) | Authorization (AuthZ) |
| --- | --- | --- |
| **Question** | Who are you? | Are you allowed to do this? |
| **When** | Once, at the start of a session | Every time you touch a resource |
| **Shelf life** | Durable — lasts the whole session | Fresh each time — can change mid-session |
| **Who decides** | The identity provider (central) | The resource owner (local) |

The last row is the one people rarely think about, and it's worth dwelling on.

### Why identity is central but permission is local

In the building, the front desk checks IDs for the entire building — one desk, everyone's identity. That works *because* identity is a universal fact: "this is Alice" is true whether Alice is heading to the server room, the supply closet, or the cafeteria. One authority can answer it for the whole building.

But "may Alice enter the server room?" is a fact only IT can answer. The front-desk guard has no idea what IT's policy is, who's on the list this week, or that Alice was taken off it yesterday. Forcing the guard to know every access rule for every room — and keep up as those rules change — wouldn't scale, and it would put the decision in the hands of someone who doesn't own the room.

So the natural division is:

- **Authentication is centralized.** One authority — the identity provider — establishes identity for everyone, once.
- **Authorization is local.** Each resource owner decides access to its own stuff. The server room's rules live with IT; the finance system's rules live with finance.

This maps straight onto real infrastructure. An identity provider authenticates a user once. Then each application — a Git server, a monitoring dashboard, a bastion host — makes its *own* decision about what that authenticated user may do inside it. The identity provider says "this is definitely Alice"; the application says "and Alice may read this repository but not that one." Two systems, two decisions, neither doing the other's job.

### The bug this prevents

The most common authentication-related vulnerability comes from collapsing the two decisions into one. In code, it looks like this:

```
if (userIsAuthenticated(request)) {
    grantAccess();   // BUG
}
```

That says: "if we know who you are, let you do the thing." It checks authentication and skips authorization entirely. Any valid account — any authenticated user at all — walks straight in, whether or not they were ever permitted.

The correct shape is always two checks:

```
if (userIsAuthenticated(request)                   // AuthN: who are you?
    && userIsAllowed(user, action, resource)) {    // AuthZ: may you do this?
    grantAccess();
}
```

Knowing who someone is tells you nothing about what they're allowed to do. A logged-in user is not an authorized one. Every real access decision needs both questions answered separately.

### The test that proves the distinction: revocation

One scenario shows the two decisions coming apart cleanly.

Alice authenticated at 9am — the guard checked her ID, and she's held a valid building session since. At 2pm, IT removes her from the server-room list. At 2:01pm she swipes her badge at the server-room door.

The door stays shut. Trace why through the three differences:

- **When** — authorization is checked on every access, so the 2:01pm swipe triggers a fresh check. It doesn't ride on any earlier decision.
- **Shelf life** — her authentication is still perfectly valid. She's still Alice, still holds a legitimate session from 9am. Nothing about her identity changed; the 2pm revocation only touched authorization.
- **Who decides** — IT owns that list and changed it. The front desk that authenticated her never hears about it, and doesn't need to.

That's the whole idea in one example: a perfectly authenticated user, correctly denied. Her identity is intact; her permission is gone. A system that opened the door — reasoning "she logged in fine this morning, so let her in" — would be committing the `if (authenticated) grant()` bug, and that's how real breaches happen. A revoked user holding a still-valid session has to be stopped at the authorization check, because that's the only check still looking.

---

Everything that follows — delegated access, tokens, scopes, and the protocols that carry them — is built on keeping these two questions cleanly apart.

---

## 10. OAuth 2.0: delegated access

Everything up to this point covered *one* user logging into *one* system. OAuth exists for a different situation: letting a *third-party application* reach some of your data on *another* service — without you handing that application your password.

The one-sentence definition to carry throughout:

> OAuth 2.0 lets you give an application narrow, revocable access to your data on another service, without the application ever seeing your password.

The word that matters is **delegation**. OAuth is not a login protocol; it is a way to delegate a slice of your access to an app. Every design choice in it serves that goal. (Login is a *different* job, layered on top later — that's OpenID Connect.)

### The problem it solves

Imagine a photo-printing site — call it PrintMyPics — that wants to print photos you keep in a cloud photo service. The obvious approach, and the only one available before OAuth, is to give PrintMyPics your photo-service username and password and let it log in as you.

That arrangement is bad in several distinct ways:

- **Over-broad access.** The app can now reach your entire account — email, contacts, files — not just your photos. You wanted to share one room and handed over the master key.
- **No selective revocation.** The only way to cut the app off is to change your password.
- **All-or-nothing.** Because the password is the only handle, changing it (to revoke one app, or for any other reason) breaks every app you've given it to.
- **Your credential lives in their database**, in a form they can replay — the most dangerous way anything can hold a password.
- **Their breach becomes your catastrophe.** Since people reuse passwords, a leak of the one you gave them can expose far more than photos.
- **No audit trail, and it defeats MFA.** When the app logs in *as you*, the service can't tell your actions from the app's, so nothing is attributable. And if you have multi-factor authentication switched on, the app can't get past it anyway — the whole scheme collapses the moment you add real security.

Each of those problems maps directly to something OAuth provides. Read the mapping and OAuth stops looking arbitrary — it's a point-by-point answer to this list:

| The problem | What OAuth does about it |
| --- | --- |
| Access to everything | **scopes** — access is narrowed to, say, read-only photos |
| Revoke = change password | the app holds a **token** that can be revoked on its own |
| Credential stored & replayable | the app holds a token, **not your password** |
| Their breach → your disaster | the app **never receives your password**; you type it only at the service |
| No audit, breaks MFA | the service sees the app **as itself**, and you authenticate normally at the service |

### The four roles

OAuth describes four roles. On the PrintMyPics example:

| Role | Who it is in the example | What it does |
| --- | --- | --- |
| **Resource owner** | you | owns the photos and grants access |
| **Client** | PrintMyPics | the app that wants access |
| **Authorization server** | the photo service's login/consent system | authenticates you, issues tokens |
| **Resource server** | the photo service's photo API | holds the photos, checks tokens |

A single company often runs both the authorization server and the resource server, but they are separate roles doing separate jobs — one issues tokens, the other checks them.

### The authorization code flow

The hard rule driving the whole design: the client must never see your password, and the valuable access token must never travel through your browser (browsers leak URLs into history, server logs, and the `Referer` header). Here's how the flow satisfies both.

1. **The client sends your browser to the authorization server** (front channel — a redirect), carrying its `client_id` and the `scope` it wants.
2. **You authenticate at the authorization server** — on the service's own domain, with your own password and any MFA. The service sets its own session cookie for you, exactly as in any direct login.
3. **You approve a consent screen** ("PrintMyPics wants to view your photos"), and the server mints a short-lived, single-use **authorization code**.
4. **The server redirects your browser back to the client with the code** (front channel). The code is a near-worthless placeholder — safe to travel the exposed channel.
5. **The client swaps the code for a token** (back channel — a direct server-to-server call), presenting the code plus its `client_secret`. The server verifies both and returns the **access token** over that private connection.
6. **The client calls the resource server's API** with the access token to fetch your photos.

### Front channel and back channel

The whole flow makes sense once you separate the two channels it uses:

- **Front channel** — anything passing *through the browser*, via redirects and URLs. Convenient and visible to the user, but exposed: whatever travels here can end up in history, logs, or the `Referer` header. It carries the authorization code, the `client_id`, the scope, and other non-secret values.
- **Back channel** — a direct *server-to-server* HTTP call, with no browser involved. Private. It carries the `client_secret` and the access token.

OAuth's guiding instinct in one line: use the front channel only for things that are safe to expose, and the back channel for anything secret.

### Why a code exists at all

It's natural to ask why the server doesn't just hand the token back in the first redirect and skip the second step. That shortcut was a real, now-deprecated design called the **implicit flow**, and it's broken: a redirect carries its data in the URL, so the token would land in browser history, server logs, and the `Referer` header sent to every third-party script on the page. An access token is a **bearer token** — whoever holds it can use it, no ownership check, like cash — so scattering copies of it across the browser is a serious leak.

The authorization code is the way out of a genuine bind. The only path from the authorization server back to the client, at that moment, is *through the user's browser* — the server can't reach the client's backend directly out of nowhere. But the token must not travel through the browser. So the server sends a worthless code through the browser, and the client redeems it privately for the token. The code does two jobs at once:

- It's a **disposable stand-in** — safe to send over the exposed channel because it's useless on its own.
- It's a **claim ticket** the client presents to *open* the back channel, proving a real user consented moments ago.

The code is safe to expose because redeeming it requires two things a thief usually can't get: the `client_secret` (which never leaves the client's server) and a live window (the code is single-use and expires in about a minute; reusing a redeemed code trips an alarm that can revoke the issued tokens).

### The client secret

The `client_secret` is a password *for the application itself*, separate from any user's password. Two different "who are you?" checks happen in one flow: the **user** proves who they are with their password at the login page, and the **application** proves who it is with its client secret at the token endpoint.

It comes from **registration** — a one-time setup step before any user is involved. The developer registers the application with the authorization server, which generates and returns a pair: a `client_id` (public — names the app) and a `client_secret` (private — proves it's really that app). The authorization server keeps its own copy and later verifies the secret the client presents against it, the same way any service checks a password. The secret only ever travels the back channel; sending it through the browser would leak it exactly as a token would.

### Confidential vs public clients, and PKCE

The client secret only works for clients that have somewhere safe to keep it. That splits clients in two:

- **Confidential client** — runs on a server (a traditional web app). It can hide a `client_secret`.
- **Public client** — a mobile app, single-page app, or desktop app. It has *nowhere* safe: anything shipped inside the app can be extracted by anyone who downloads it. A secret baked into such an app isn't secret.

For a public client, the guard is gone — the code can leak on the front channel, and the "secret" is extractable — so a stolen code could be redeemed by an attacker. **PKCE** (Proof Key for Code Exchange, pronounced "pixy") rebuilds the guard without any pre-shared secret, by inventing a fresh one for each login:

1. When the login starts, the app generates a big random string — the **code verifier** — and keeps it in memory. It hashes the verifier (SHA-256) into a **code challenge** and sends only the *challenge* in the front-channel authorize request. The server files the challenge next to the code.
2. At redemption, the app sends the code plus the *original verifier* on the back channel.
3. The server hashes the received verifier and checks it matches the stored challenge. Match means it's the same app instance that started the flow; token released.

A stolen code is worthless to an attacker because redeeming it needs the verifier, which never crossed the browser — and the challenge that *did* cross is a one-way hash the verifier can't be recovered from.

One limit worth stating plainly: PKCE proves "the same app instance that started this flow," **not** "this app is really PrintMyPics." A public client cannot be *authenticated* as an application at all, because authentication needs a verifiable secret and it has none. What protects your data instead is that *you* were authenticated (password + MFA) and *you* consented; PKCE only ensures the code can't be hijacked mid-flow. Modern guidance (OAuth 2.1) is to use PKCE on **every** authorization code flow — public clients rely on it alone, confidential clients use it alongside their secret as a second layer.

### Access tokens and refresh tokens

The token exchange usually returns two tokens, and the reason is a security-versus-convenience trade-off.

An access token is presented on *every* API call, so it's the most-exposed credential the client holds. If it were long-lived, a stolen one would grant long-lived access. If it's short-lived, a stolen one is nearly worthless soon after — but then the app would have to drag you through login again every hour to get a new one.

The **refresh token** resolves this. The split puts longevity where exposure is *low*:

| | Access token | Refresh token |
| --- | --- | --- |
| Lifetime | short (minutes to an hour) | long (days to months) |
| Used on | every API call | only to obtain new access tokens |
| Travels | everywhere the API is called (exposed) | back channel only (protected) |

When the short-lived access token expires, the client quietly uses the refresh token on the back channel to get a fresh one — no user involvement, no new login screen. You get the safety of short-lived access tokens and the convenience of staying logged in. A common hardening measure is **refresh token rotation**: each use issues a new refresh token and invalidates the old one, so if a stolen token is used, the legitimate client's next use trips a detectable conflict.

Short access-token lifetime is itself the revocation strategy: self-contained tokens aren't checked against a central list on every call, so the way you limit the damage of a leak is to not let the token live long.

### Scopes

A **scope** is a label naming one slice of access — it's how the "narrow access" promise is delivered. The client *requests* scopes in the authorize request (`scope=photos.readonly`), you *consent* to them on the login screen (the consent text is the requested scopes read back in plain language), and the resource server *enforces* them on each API call (a read-only token can't delete). Three separate parties, so no one of them can quietly widen the access.

Two points to keep straight:

- **A scope is authorization, not authentication.** It says what the app may *do*, never *who you are*. There is no OAuth scope that means "tell me who this user is" — that gap is exactly what OpenID Connect fills, with a scope named `openid`.
- **A scope is coarse, not a per-object permission.** "May touch photos at all" is a scope; "may edit *this specific album*" is a role or permission on the resource side. A real request often needs both: a token scoped for the operation *and* a user with the right role for that specific object.

### Grant types, in one pass

OAuth's "flows" are called **grant types**. The durable way to hold them is by one question — *is a user being represented, or is an app acting as itself?*

- **With a user (delegation):** the **authorization code** grant (with PKCE). This is the one that matters; everything else in this category is deprecated — the **implicit** grant (token in the redirect, leaks) and the **resource owner password** grant (user types their password into the app, the very anti-pattern OAuth exists to kill).
- **Without a user (machine-to-machine):** the **client credentials** grant — a service authenticates as itself with its `client_id` and `client_secret` and gets a token. No browser, no consent, no code, because there's no user whose consent is needed.

OAuth 2.1 collapses the messy list to essentially those two survivors: authorization code + PKCE for user flows, client credentials for service-to-service.

### A few things that follow from the design

Some consequences of how OAuth works are worth knowing whichever side of it you sit on — building a client, building an API, or just reasoning about a system:

- **A token has to be checked, not just possessed.** When an API receives an access token, validating it means confirming it was really issued by the expected authorization server (signature and issuer), that it was meant for *this* API and not some other one (the audience), that it hasn't expired, and that its scopes permit the request. A token being present is not the same as a token being valid.
- **Tokens don't belong in exposed places.** Because a bearer token is usable by anyone holding it, it shouldn't end up in a URL, in logs, or in browser storage that other scripts can read. This is the same reasoning that killed the implicit flow.
- **The return address is pinned in advance.** The authorization server only sends the code back to an address the client registered ahead of time, matched exactly. That's what stops an attacker from redirecting the code to themselves, and it's why registering a new client always involves declaring its redirect URLs.
- **Modern practice is narrow on purpose.** The authorization code flow with PKCE covers user logins; the client credentials flow covers service-to-service; the older implicit and password flows are deprecated. Fewer flows, each with clearer guarantees.

For the authoritative details, OAuth 2.0 is defined in RFC 6749 and PKCE in RFC 7636, with current guidance in the "OAuth 2.0 Security Best Current Practice" and the emerging OAuth 2.1.

---

## 11. OpenID Connect: identity on top of OAuth

OAuth solves delegated access — letting an app *do* something on your behalf. It does not solve login. The two get confused because both start with "authenticate at a provider and come back," but they answer different questions, and using one for the other's job is a real security mistake. OpenID Connect (OIDC) is the piece that adds login, built directly on top of OAuth.

### Why an access token can't log you in

The tempting shortcut, once you have OAuth working, is to treat the access token as proof of who the user is: "the provider gave me a valid access token for this user, so I'll log them in as that user." Two independent problems make this unsafe.

**An access token is a bearer token.** Whoever holds it can use it, and holding it proves nothing about who the holder is. Even if the token names a user inside it, a copy of that token in anyone else's hands works identically. So "I hold a token naming Alice" is not "Alice is here."

**An access token is addressed to the API, not to your app.** It was minted for a resource server to check when the app calls an API — it's meant to be *presented*, not *read and trusted* by the app holding it. Nothing about it was designed to answer your app's "who just logged in?" question.

Put together, these enable a classic attack. Suppose an app you use legitimately holds a valid access token that names you. If a second app does login the broken way — "show me any valid access token that names a user, and I'll log you in as that user" — then whoever operates the first app can present *your* token to the second app and be logged in as you. The token is real and it names you; it was just never meant to prove your identity to that second app. This was a widespread vulnerability when apps first built "Log in with \<provider\>" on raw OAuth.

The root issue: the access token answers "may the holder call this API?" Login needs the opposite question answered — "who is this user, and can my app *verify* that the answer was meant for it?"

### The ID token

OIDC adds a second token, the **ID token**, built specifically for identity:

| | Access token | ID token |
| --- | --- | --- |
| Answers | what may the holder do? | who is the user? |
| Carries | authorization (scopes) | authentication (identity claims) |
| Addressed to | the resource server (the API) | the client (your app) |
| The app should… | present it to the API | read it and verify it |

The ID token is a signed statement from the provider, addressed to one specific app, that says in effect: "this user is Alice, she authenticated at this time, and this statement is issued for *your app* specifically." That last part is what closes the attack above: the app checks that the ID token was issued *for it*, and a token issued for some other app is rejected.

### What's inside an ID token

The ID token carries claims — fields the app reads and checks. The core ones:

| Claim | Meaning | What the app does with it |
| --- | --- | --- |
| `iss` | issuer — which provider minted it | look up that issuer's keys; reject unknown issuers |
| `sub` | subject — the user's stable unique ID | this is the identity to key the account off |
| `aud` | audience — which app it's for | must equal this app's own client ID, or reject |
| `exp` | expiry — when it stops being valid | reject if passed; this is what stops replay |
| `iat` | issued-at — when it was minted | sanity/age checks |
| `auth_time` | when the user actually authenticated | only if the app enforces a maximum login age |
| `nonce` | a one-time value tying it to this login request | must match the value the app sent; stops token injection |

Two of these deserve emphasis.

**Match users on `sub`, not email.** The `sub` is stable and unique; it never changes for a given user at a given provider. Emails and usernames can change or be reassigned. Keying accounts off the email claim is a known route to account takeover — always store and match on `sub`.

**`nonce` defends browser logins against replay.** The app generates a random value, sends it in the login request, and the provider stamps that same value into the ID token. When the token comes back, the app confirms the nonce matches what it sent — proving the token is the answer to *this* request, not an ID token captured from an earlier login and injected. It is the ID-token counterpart of the `state` parameter used in the OAuth request.

So the app's trust check, end to end: verify the **signature** (using the issuer's published keys), confirm **`aud`** is itself, confirm **`exp`** hasn't passed, confirm **`nonce`** matches — and only then believe that **`sub`** is who just logged in.

### OIDC is a layer, not a replacement

OIDC does not compete with OAuth; it is defined as an identity layer *on top of* OAuth 2.0. Every OIDC login is an ordinary OAuth authorization code flow, with identity switched on. The switch is a single scope:

- Request without `openid` → a plain OAuth flow, access token only, no identity guarantee.
- Request with `scope=openid` → the same flow *also* returns an ID token, and the provider behaves as an OpenID Provider.

They stack rather than compete:

- **OAuth alone** answers *what may the app do?* — good for API access, "connect your account" buttons, and machine-to-machine.
- **OIDC (OAuth + `openid`)** answers *who is the user?* — good for login and single sign-on.

This resolves a common question: single sign-on needs *authentication*, and raw OAuth doesn't authenticate the user, so SSO is done with OIDC (or with SAML, the older identity protocol). It isn't that OAuth is absent from SSO — OIDC runs on OAuth — it's that OAuth *alone* is insufficient, and the identity layer is the part that makes it a login.

A login request commonly asks for identity scopes together: `openid` (required — switches on OIDC and yields the core claims), plus optional `profile` and `email` to receive name and email claims. These identity scopes are different in kind from resource scopes like "read files"; a single request can mix both.

### The three tokens of a real login

It's tempting to conclude "OIDC gives an ID token plus an access token," but the precise picture has three moving parts, and separating them clears up most confusion:

| Thing | Role | Lifespan |
| --- | --- | --- |
| ID token | proves who the user is, once, at login | consumed immediately |
| Access token | lets the app call APIs as the user | used across the session (when needed) |
| The app's own session | keeps the user logged in to *this* app | the actual session |

The ID token logs you *in*; the app then creates *its own* session (its own cookie, exactly as in any direct login) and runs on that; the access token does API work in between, and only when the app actually needs to call an API. An access token is not always issued — request only `openid` with no resource scopes and you can get an essentially identity-only result. The ID token is the constant; the access token appears when the app also needs API access.

### Applying this to your own application

The clearest way to see the token split is to build a login into an app you control. The roles are the usual ones: the user is the person logging in; the provider is the authorization server and identity provider; your app is the client. The only question that decides your architecture is: **after the provider proves who the user is, does anything keep acting as that user?**

**Case 1 — a self-contained app (ID token only).** Your app has its own backend and its own record of users and permissions. It uses the provider only to answer "who is this." The user logs in, your backend verifies the ID token, reads `sub`, looks that user up in your own database, and creates your own session. From there the app runs entirely on its own session and its own permission tables; it never calls the provider again for that user until the session expires. No access token is needed, because nothing is calling a provider-protected API on the user's behalf — your app is its own authority on what the user may do. This is the common shape for a self-contained internal tool.

**Case 2 — an app that calls protected APIs as the user (ID token and access token).** Your app is split into a frontend and a backend API, or it needs to call other protected services on the user's behalf. Now the login yields both tokens: the ID token establishes the session, and the access token is attached to each API call so the backend — acting as a resource server — can validate it and authorize the request per call.

The deciding factor is *not* whether the backend is a separate service. It's whether **the browser makes API calls that the backend must authorize on each request**. That refines the two cases into two concrete shapes:

- **Server-rendered pages with a cookie session** → ID token only. The browser talks to the backend by loading pages; after login the backend sets a session cookie and every later request is authorized by that cookie. No token is presented anywhere after login, so no access token is required — even though the app has a backend.
- **A frontend that calls a JSON/HTTP API** → access token. The browser makes API calls that the backend must authorize per request, so those calls carry an access token that the backend validates. This holds whether the API is the same app's backend or a separate service — "same app vs separate service" is not the line; "does the browser call an API that authorizes tokens" is.

There is an important refinement for browser-based apps that call an API. A single-page app holding an access token in the browser is a public client, and browser storage is a poor place for tokens — any injected script can read them. The recommended pattern is the **backend-for-frontend (BFF)**: the app's own backend runs the OIDC flow, keeps the tokens server-side, and hands the browser only an ordinary session cookie. The browser calls the backend with the cookie; the backend attaches the access token to any downstream API calls on the server side, where it stays safe. Under BFF the browser is back to a cookie-only model and the access token never reaches it.

Two mistakes are worth avoiding in an app you build yourself:

- **Don't use the access token to log the user in.** Even in your own app, identity must come from the ID token — verify it, read `sub`, confirm `aud` is your client. Establishing identity from the access token reintroduces the confused-deputy problem, because the access token is addressed to the API, not to your app.
- **Don't skip validation because the app is internal.** A token is a token; internal doesn't mean trusted. Verify the ID token's signature against the provider's published keys and check `aud`, `exp`, and `nonce`. Reading a token's claims *without* verifying its signature is the most common homegrown mistake.

### Fetching identity and finding the endpoints

Two mechanisms finish the picture.

**The UserInfo endpoint.** Besides the claims inside the ID token, the provider exposes an API — the UserInfo endpoint — that returns a user's claims as JSON when called *with the access token*. This exists as a size trade-off: keep the ID token lean with the essentials, and let the app fetch fuller profile data on demand. It's one concrete reason a login flow may request an access token even when the app's goal is identity — the access token is the key to UserInfo. The division is clean: the ID token is a statement handed *to* the app and verified locally; UserInfo is data the app *fetches* using the access token.

**Discovery.** An OIDC client needs several URLs — where to send the user, where to exchange the code, where UserInfo lives, and where the provider's public keys are. Rather than configure these by hand, every provider publishes a metadata document at a fixed path, `/.well-known/openid-configuration`. Fetching it returns a JSON document listing every endpoint, the supported scopes and algorithms, and a link to the provider's public keys (its key set). This is why adding "Log in with \<provider\>" is often just supplying one issuer URL — the client discovers everything else, including the keys it needs to verify ID token signatures without any key being shared in advance.

Assembled, an OIDC login is: send the user to the provider with `scope=openid …`; the user authenticates and consents; a code comes back; the app exchanges it for an ID token (and usually an access token); the app verifies the ID token — signature via the provider's published keys, plus `aud`, `exp`, and `nonce` — reads `sub`, and creates its own session; optionally it calls UserInfo for more profile data. It is OAuth's exact flow, plus an identity token and the endpoints that make identity verifiable and fetchable.

---

## 12. JWT: the self-contained token

The tokens in the previous sections — the ID token especially — are usually in a format called a **JWT** (JSON Web Token, pronounced "jot"). This section opens the envelope: what a JWT is, why it's shaped the way it is, how its signature works, and the one trade-off that explains every decision around it.

### The problem it solves

Recall the session cookie from the start of this note: a meaningless reference like `k3n8fj2p9x`, where the real information lives in the server's own memory and the string is just a lookup key. That works well for one server. It works badly the moment more than one party is involved.

Picture many servers behind a load balancer, or the situation from the OAuth sections: a token minted by an authorization server but checked by a separate resource server, possibly run by a different company. With the reference model, *any* server checking the token has to look it up in the issuer's database on every request. That means a database round trip per call, a central bottleneck every server depends on, and — across companies — handing outsiders a way to query your database, which is usually a non-starter.

The way out is to make the token **self-contained**: instead of a reference pointing at information held elsewhere, the token *carries* the information. "This is Alice, expires at 3pm" is written into the token itself. Now any server can read it and decide, with no lookup and no shared database. The reference is a coat-check ticket; a JWT is the coat printed on the ticket.

### The problem that creates

If the token now carries readable facts, what stops the holder from editing them? A token that says "Alice, regular user" could be changed to "Alice, admin" — the truth is now in the holder's hands, not locked in a server's database.

A plain checksum doesn't fix this. Hashing the contents and attaching the hash proves the data wasn't *corrupted*, but it stops no attacker: the hash function is public, so a forger who edits the payload simply recomputes the hash to match. What's needed is an integrity check that **only the issuer can produce but anyone can verify** — and that is a **signature**.

### How signatures work

A signature combines a hash with a key the forger doesn't have. There are two families.

**Shared secret (HMAC, e.g. HS256).** The issuer computes the signature from the content *plus a secret key*. Anyone holding the same secret can recompute and verify it. It's symmetric — the same secret both signs and verifies. That's fine when one party does both, but it doesn't fit a world where one party issues tokens and many independently verify them: every verifier would need the signing secret, and any of them could then mint tokens, not just check them.

**Public/private key pair (asymmetric, e.g. RS256).** The issuer holds two linked keys: a **private key** that signs, kept secret, and a **public key** that verifies, shared freely. The defining property is that a signature made with the private key can be verified with the public key, but the public key cannot be used to *create* a signature. So the issuer alone can sign, while the whole world can verify. This is the model that makes OAuth and OIDC work: the provider signs with its private key, and every resource server fetches the public key to verify — none of them able to forge a token. (This is what the provider's published key set, referenced in discovery, is for.)

| | HMAC (HS256) | Asymmetric (RS256) |
| --- | --- | --- |
| Keys | one shared secret | private (sign) + public (verify) |
| Who can verify | only holders of the secret | anyone, with the public key |
| Who can sign | anyone with the secret | only the issuer |
| Fits | one party signs and verifies | one signs, many verify |

### The structure

A JWT is three base64url-encoded parts joined by dots: `header.payload.signature`.

**Header** — metadata, as JSON: the token type and the signing algorithm, e.g. `{"alg":"RS256","typ":"JWT"}`.

**Payload** — the claims, the actual content, e.g. `{"sub":"alice-123","aud":"my-app","exp":1735689600,"iss":"https://provider.example"}`. These are the same claims described in the OIDC section; this is where they physically live.

**Signature** — the cryptographic proof, computed over the header and payload together.

Signing, concretely, takes the base64url header and payload, joins them with a dot to form the signing input, hashes that, and encrypts the hash with the private key — that encrypted hash is the signature. Verifying reverses it: the receiver recomputes the hash of the header and payload *as received*, decrypts the signature with the public key to recover the hash the issuer computed, and compares. If they match, the content is exactly what was signed. If an attacker altered the payload, its hash no longer matches, and they can't produce a corrected signature without the private key — so the tampering is caught.

### The payload is readable — encode is not encrypt

The header and payload are only base64url-*encoded*, which is trivially reversible. Anyone holding a JWT can decode and read its payload. A JWT is sealed, not opaque: tamper-proof, but not secret. So nothing confidential goes in a JWT payload — no passwords, no secrets, no sensitive personal data. Treat every claim as public.

### Never trust the header's algorithm

The signing algorithm is named in the header, which is attacker-controlled — and two classic vulnerabilities come from trusting it.

The first is the "none" algorithm. Early libraries honoured `"alg":"none"`, meaning "unsigned." An attacker edits the payload, sets the algorithm to `none`, drops the signature, and a naive verifier accepts it as needing no check. The second is algorithm confusion: a server that verifies with a published RSA public key can be tricked by an attacker who switches the header to a shared-secret algorithm and signs with that public key as if it were the secret — which, being public, the attacker has.

Both share one fix: the verifier must decide the algorithm and key out of band and pin them, never taking the algorithm from the token. The header describes the token; it does not get to dictate how the token is trusted.

### Registered and private claims

Some claim names are standardized by the JWT spec — the **registered claims** — so that everyone agrees on their meaning:

| Claim | Meaning |
| --- | --- |
| `iss` | issuer — who minted the token |
| `sub` | subject — the user's stable unique ID |
| `aud` | audience — who the token is for |
| `exp` | expiry — when it stops being valid |
| `nbf` | not-before — when it starts being valid |
| `iat` | issued-at — when it was minted |
| `jti` | a unique ID for this specific token |

Everything else is a **private claim** — `name`, `email`, `roles`, or anything an issuer and consumer agree on. A JWT payload is just standard claims everyone understands plus custom claims for a particular system. Access tokens frequently carry the user's scopes or roles as claims here, which is exactly what lets a resource server authorize a request offline, straight from the verified token.

### The trade-off: statelessness versus revocation

Self-contained verification has one unavoidable cost, and every design decision around JWTs is about managing it.

Suppose a token is valid until 3pm, and at 2pm the user must be cut off immediately. The resource servers checking the token don't consult any database — they verify the signature and read the expiry, and the token says 3pm. There is no record to delete, because the token stands alone. A self-contained token cannot be individually revoked before it expires.

The primary answer is to keep such tokens short-lived. If an access token lasts only a few minutes, then "revoke" becomes "wait a few minutes" — a small, bounded window. Short expiry *is* the revocation strategy. That, in turn, is why a **refresh token** exists: re-logging-in every few minutes would be intolerable, so a short access token is paired with a longer-lived refresh token that silently obtains new access tokens.

The two tokens are deliberately different in form:

| | Access token | Refresh token |
| --- | --- | --- |
| Form | self-contained JWT | usually an opaque reference |
| Verified | offline, no lookup | at the auth server, with a lookup |
| Revocable | no — kept short instead | yes — checked on every use |
| Lifespan | minutes | days |

The refresh token deliberately goes back to the coat-check model, because that lookup is what makes it revocable. It's presented only to the authorization server, never verified offline by anyone, so it gains nothing from being self-contained — and by being a database-backed reference, it can be cancelled the instant it's needed. This resolves an apparent contradiction: a refresh token is long-lived yet revocable early, because "long-lived" means "valid until revoked," and the authorization server checks it against its records every single time it's used. Cancel it, and the next refresh attempt fails — while the short access-token lifetime bounds how long the user retains access in the meantime.

Where instant revocation of the access token itself is genuinely required, two heavier tools exist: a blocklist of revoked token IDs (using the `jti` claim), which resource servers check, or token introspection, where the resource server asks the authorization server about each token. Both work, and both reintroduce exactly the per-request lookup that JWTs were adopted to avoid — so they're used deliberately and sparingly, trading some statelessness back for control.

### JWT or opaque — a real choice

For access tokens, the two models are a genuine deployment decision:

- A **JWT access token** is verified offline with the public key: fast, no lookup, works across independent parties. The cost is that it's hard to revoke before expiry, its payload is readable by whoever holds it, and it's larger.
- An **opaque access token** is a reference the resource server must introspect against the authorization server: a round trip per check, but instantly revocable and meaningless if intercepted.

Many systems combine them — short-lived JWT access tokens for speed, opaque refresh tokens for control — which is why a typical token response carries a JWT access token, a JWT ID token, and an opaque refresh token. Each token is in the form that suits its job: self-contained where speed matters, reference-based where revocability matters.

In one line: a JWT trades revocability for statelessness — anyone can verify it offline and read it, nobody can forge it, and the price is that you can't easily take it back.

---

## 13. SAML: the older way to do SSO

SAML (Security Assertion Markup Language) answers the same question as OpenID Connect — who is this user, proven to the app they're logging into — but it predates OIDC by roughly a decade and is shaped for enterprise use. It shows up today mainly because a great deal of established enterprise and government software adopted it early and still speaks only SAML. If OIDC is already clear, SAML is largely a matter of new names for familiar ideas, plus two genuine differences.

### The same roles under different names

Every SAML term has a counterpart from the OAuth and OIDC sections:

| SAML | OIDC / OAuth equivalent | What it is |
| --- | --- | --- |
| Identity Provider (IdP) | identity provider / OpenID Provider | authenticates the user |
| Service Provider (SP) | relying party / client | the app being logged into |
| Assertion | ID token | the signed statement of who the user is |
| Authentication request (`AuthnRequest`) | the authorization request | "please authenticate this user" |
| SAML response | the token response | "here is who they are" |
| Metadata | discovery document | machine-readable configuration about each party |
| XML signature | JWT signature | the tamper-proof seal |

The roles are identical; SP and IdP are simply SAML's words for the client and the identity provider. The concept worth the most attention is the **assertion**, because it plays the same part as the ID token — a signed statement of identity — and comparing the two carries most of the stage.

### The two real differences

Only two things genuinely differ from OIDC, and both follow from SAML being older.

**It's XML, not JSON.** An ID token is a compact JWT; a SAML assertion is a block of XML, signed with a heavier standard (XML Digital Signature). Same purpose — a signed identity statement — in a bulkier format.

**It has no concept of an access token or API authorization.** SAML answers "who is the user" and stops there. There is no SAML access token, no scopes for API calls, no delegated resource access. It does authentication and SSO only. This is precisely the gap that OAuth and OIDC were later built to fill: letting an app call an API on the user's behalf is something SAML never addressed. The short version to carry: SAML is SSO and login only; OIDC is login plus the OAuth machinery for API access underneath it.

### Where the assertion travels, and why that's safe

SAML uses the same five-step browser-redirect pattern described earlier: the user reaches the app, is redirected to the IdP, authenticates, is redirected back, and lands logged in. But unlike OIDC — which deliberately keeps the valuable token off the browser and sends only a code — SAML's common flow (called POST binding) sends the **assertion itself through the browser**. The IdP places the signed assertion in a hidden auto-submitting form, and the browser posts it to the SP.

This seems to contradict the earlier principle of not sending the valuable thing through the exposed channel. It doesn't, because of *what* the assertion is. Two properties make front-channel travel safe:

- **It's signed.** Altering any part of the assertion in transit breaks the XML signature, and the SP rejects it. Exposure doesn't enable tampering — the same reasoning as a signed JWT.
- **It's audience-restricted.** The assertion names which SP it's for, exactly like an ID token's audience. A stolen assertion can't be replayed at a different SP, because that SP checks whether it's the intended recipient and refuses otherwise.

The contrast with OIDC comes down to the *kind* of thing traveling. OIDC's access token is a bearer credential — whoever holds it can use it to call APIs — so a stolen copy is live access, which is why OIDC keeps it on the back channel. A SAML assertion is a signed, audience-locked identity statement meant to be consumed once at login by one named SP; stealing it in transit buys little, since it can't be altered, can't be reused elsewhere, and expires in seconds. The deeper point closes the loop from the OAuth section: SAML has no back channel in its common flow because it never issues a bearer token that needs protecting. The whole front-channel/back-channel apparatus exists because OAuth introduced bearer tokens for API access — the very thing SAML lacks.

### SP-initiated vs IdP-initiated

SAML allows a login to *start* in two places, and the difference matters (OIDC essentially only supports the first).

**SP-initiated** is the normal case and matches the five-step pattern exactly: the user goes to the app first, isn't logged in, and the SP redirects them to the IdP and back.

**IdP-initiated** starts at the identity provider. Picture a company portal showing tiles for several apps; the user is already logged into the portal (the IdP), clicks an app tile, and the IdP sends them into that SP already authenticated, with no initial round-trip. The IdP pushes an unsolicited assertion straight to the SP.

IdP-initiated is convenient but weaker, and current guidance discourages it. In an SP-initiated flow the SP started the login, so it holds state — it knows it's expecting a response and can plant a value to check the response against, the way OIDC uses `nonce`. In an IdP-initiated flow the assertion arrives unsolicited, with nothing for the SP to correlate it against, which opens a replay and injection window. It's the SAML echo of exactly why OIDC expects the app to start the flow: an identity statement should answer a request the app actually made.

### Metadata exchange

Setting up a SAML integration is, at its core, exchanging metadata — SAML's equivalent of OIDC discovery. For an SP and IdP to trust each other, each needs the other's endpoint URLs, signing certificate (the public key for verifying signatures, equivalent to OIDC's published keys), unique identifier (entity ID), and various settings. All of it is bundled into an XML metadata document. The IdP gives the SP its metadata and the SP gives the IdP its own; each imports the other's, and from then on they know each other's endpoints and certificates.

| | OIDC | SAML |
| --- | --- | --- |
| Configuration document | discovery JSON at a well-known URL | metadata XML |
| Keys for verification | fetched live from a keys endpoint, auto-rotating | certificate embedded in the metadata |
| Setup | often just supply the issuer URL | exchange metadata in both directions |

One operational consequence is worth knowing: because SAML embeds the certificate in metadata rather than fetching keys from a live, rotating endpoint the way OIDC does, SAML **certificates expire**, and when one does, SSO breaks until updated metadata is exchanged. A SAML login that suddenly stops working is very often an expired signing certificate — a failure mode OIDC largely avoids through automatic key rotation.

### In short

SAML does the same job as OIDC — log the user in and prove their identity to the app — over the same five-step redirect pattern, but as an older design: signed XML assertions instead of JWTs, no access-token or API-authorization concept at all, and a metadata exchange instead of a discovery URL. If OIDC is clear, SAML is a re-skin plus two wrinkles: the discouraged IdP-initiated flow, and certificates that expire. The most useful thing to remember in practice is that something which only speaks SAML is offering SSO and login only — if API authorization is also needed, that is OAuth and OIDC territory, and SAML will not provide it.

---

## 14. Federation: identity providers trusting each other

Ordinary single sign-on is an app trusting an identity provider. Federation is one level up: **one identity provider trusting another identity provider to authenticate users**, so a user from one organization can access resources in another without holding a separate account there. The core idea is trust *between* identity providers, not just between an app and an identity provider.

### The problem it solves

Picture a company — call it Acme — with its own identity provider that all its employees log in through. Acme buys a software-as-a-service product from an outside vendor, and its employees need to use it. The naive approach is for every employee to create an account directly with the vendor, so the vendor ends up holding a username and password for each of them.

That arrangement has four problems, and they share a single root cause:

- **Departures leave orphaned accounts.** When someone leaves Acme, IT disables their Acme account — but their account at the vendor is separate and lives on unless someone remembers to disable it too. Across every SaaS product a company uses, this produces access that outlives employment, which is the most serious of the four.
- **Credentials live where they can't be governed.** Acme can enforce password rules and multi-factor authentication on its own identity provider, but has no control over accounts held directly at the vendor.
- **Reuse compounds the exposure.** Employees tend to reuse their work password at the vendor, so a breach at the vendor can leak credentials that also open Acme.
- **A separate login for every tool.** The employee now has a different account and password for each external product — defeating the whole point of single sign-on.

All four trace back to the same thing: the accounts live in the wrong place. They sit at the vendor, when they should sit at Acme — the organization that actually knows who its employees are and when they leave.

Federation fixes this by not creating accounts at the vendor at all. The vendor configures Acme's identity provider as a trusted source. When an employee visits the vendor's tool, the tool sends them to *Acme's* identity provider to log in; Acme authenticates them with Acme's own password and MFA and returns a signed token saying "this is alice@acme.com, and she's legitimate"; the vendor reads it and lets her in, without ever holding an account or password for her. All four problems dissolve at once: disabling Alice at Acme instantly removes her access everywhere, the vendor never holds Acme credentials, there is only one credential under one policy, and the employee logs in once for everything.

The principle in one line: federation moves the source of truth for identity to the organization that owns it, and lets everyone else trust that source instead of duplicating it.

### The mechanism is SSO with a role-flip

Federation introduces no new protocols — it uses OIDC or SAML, exactly as described earlier. What is new is the topology. In plain SSO, an app is a client and an identity provider authenticates. In federation, the vendor *has* its own identity provider, but instead of authenticating the user itself, that identity provider turns to Acme's and says, in effect, "you authenticate her, and I'll trust your answer." So the vendor's identity provider plays two roles at the same time:

- an **identity provider** to its own app, issuing the token the app finally consumes, and
- a **client** to Acme's identity provider, redirecting to Acme and consuming Acme's response.

An identity provider in this middle position — trusting one or more identity providers upstream while serving its own apps downstream — is acting as an **identity broker**. It's the same "which role is this box playing here?" idea from the start of this note, now with a name.

### Just-in-time provisioning

When a federated user reaches a vendor's tool for the very first time, the vendor has a signed token proving who she is but no local record of her — no row in its user table, no profile, no settings. A token is enough to *authenticate* her, but the app needs a local record to attach permissions, preferences, and ownership of her work to. So at first login the broker reads the identity details out of the trusted token and creates a local user record on the spot. This is **just-in-time (JIT) provisioning** — the account materializes exactly when first needed, rather than being set up in advance, and the user never fills in a signup form.

The lifecycle is straightforward: on the first login, no local record exists, so the broker creates one from the token's claims; on every later login, the broker finds the existing record — matched on a stable identifier such as the subject claim, not the email — and updates any changed attributes.

### The gap JIT leaves

JIT provisioning has a blind spot that matters, and it motivates the next topic. It handles creation well and refreshes attributes on each login, but it does nothing about deletion. When Alice leaves Acme, Acme disables her there, so she can no longer obtain a token and therefore can no longer log in to the vendor's tool. But the local record JIT created at the vendor still sits in the vendor's database, orphaned. She can't log in, so it isn't an access hole in the login sense — but the stale account still exists: it still owns data, still appears in "share with" lists, still counts toward per-seat billing, still shows as an active user.

The reason is structural: JIT is login-triggered, and departure is precisely the event that produces no login. Creation and updates ride on logins; deprovisioning has no login to ride on. Closing that gap needs a mechanism that pushes lifecycle changes — including deletions — proactively, without waiting for the user to appear. That mechanism is a provisioning protocol (SCIM), covered next.

### The vocabulary

- **Identity brokering** — the middle-identity-provider pattern: an identity provider that delegates authentication to another and relays the result.
- **Home-realm discovery** — when a broker trusts several upstream identity providers, the step that decides which one to send a given user to, often by asking them to choose their organization or by routing on their email domain.
- **Upstream and downstream** — directional language for the chain: upstream is the identity provider that actually authenticates; downstream is the broker relaying the result.
- **Trust relationship** — the pre-arranged configuration (exchanged metadata in SAML, or client registration and discovery in OIDC) that lets the broker verify the upstream's signatures. Federation is a trust relationship made concrete.

In short: federation is identity providers trusting identity providers, so identity lives once at the organization that owns it. Brokering is the middle identity provider that relays that trust; just-in-time provisioning creates a local account from the trusted token on first login; and its inability to handle departures is exactly the gap a provisioning protocol fills.

---

## 15. SCIM: provisioning across organizations

Everything up to this point has been about **authentication** — proving who someone is at the moment they log in. Provisioning is a different axis entirely: **managing whether an account exists at all, and with what attributes, over time**, independent of any login. Authentication is login-time and reactive — it happens when the user shows up. Provisioning is continuous, and it has to be driven by changes at the source whether or not the user ever logs in.

The previous section left a gap that makes this concrete. Just-in-time provisioning creates and updates accounts when a user logs in, but nobody logs in when they *leave* — so departures go unhandled and disabled-but-still-present accounts accumulate at every vendor. Fixing that needs a mechanism outside the login flow.

### The direction of the flow

The organization that owns the identity — the source of truth — is the only party that knows when someone is hired, changes department, or leaves. So it has to be the one that initiates: it pushes each change outward to every connected application the moment it happens, rather than waiting for the user to appear. This is the inversion from JIT — where JIT pulls on login, provisioning pushes on change, from the source.

That pattern is what **SCIM** standardizes. SCIM stands for **System for Cross-domain Identity Management**, and the name describes the job precisely: *identity management* is the account lifecycle (create, update, deactivate); *cross-domain* means across organizational boundaries, between one organization and an outside vendor; and *system for* means it's a shared standard, so every vendor implements the same one. Without such a standard, each vendor would expose its own custom API for managing users, and a company would have to write bespoke integration code for every tool it uses. SCIM defines one common REST API and one common shape for a user, so an organization's identity provider learns to speak SCIM once and can then provision into any vendor that also speaks it.

This is the same interoperability payoff seen elsewhere: OIDC standardized authentication so any app can trust any provider; SCIM standardizes provisioning so any organization can sync users into any app. The two are complementary halves of the identity lifecycle — OIDC or SAML handle the login, SCIM handles the account's existence.

### Deactivate, don't delete

The most important subtlety in provisioning is what "removing" a user actually means. Hard-deleting an account is usually the wrong move: everything tied to that user — documents they authored, comments, history, audit-log entries — would break or become orphaned, which harms data integrity, auditability, and compliance.

So real systems separate two operations:

- **Deactivation** is the normal case for a departure. The account is marked inactive — in SCIM, its `active` attribute is set to `false` — but the record stays. The person can no longer log in, their sessions end, and they disappear from "share with" pickers and active-seat counts, while everything they authored and their name on past activity remain intact. Nothing is orphaned, because nothing was removed. This is what offboarding almost always means in practice.
- **Deletion** is rare and deliberate — reserved for an account created in error, or a legal erasure requirement. Even then, mature systems tend to anonymize rather than rip the record out, reassigning authored work to a placeholder so the data survives while the personal identity is scrubbed.

The lifecycle SCIM manages, then, is: create on hire, update on change, **deactivate on departure**, and delete only in the rare deliberate cases. The departure case is a deactivation precisely because deletion would orphan the person's work — the concern that makes hard deletion the wrong default.

### On the wire

SCIM defines a standard JSON shape for a user, so every vendor agrees on what a user is:

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "id": "2819c223-7f76-...",
  "userName": "alice@example.com",
  "name": { "givenName": "Alice", "familyName": "Chowdhury" },
  "emails": [{ "value": "alice@example.com", "primary": true }],
  "active": true,
  "groups": [{ "value": "engineering" }]
}
```

Two fields carry most of the weight. The `id` is the vendor's stable unique identifier for the user, returned when the account is created and used to reference it thereafter — the same "match on a stable ID, not email" principle as the subject claim in a token. (A companion `externalId` holds the *source's* identifier for the same person, so both sides can correlate.) And `active` is the boolean that drives offboarding — one field that is the entire deactivation mechanism.

The operations are a small REST API, matching the lifecycle directly:

| Operation | Call | Meaning |
| --- | --- | --- |
| Create | `POST /Users` | provision a new account |
| Read / search | `GET /Users/{id}` or `GET /Users?filter=...` | fetch or find users |
| Replace | `PUT /Users/{id}` | overwrite the whole record |
| Update | `PATCH /Users/{id}` | change specific attributes |
| Delete | `DELETE /Users/{id}` | hard-delete (rare) |

A parallel `/Groups` set manages group membership the same way. Deactivation — the operation that matters most — is a `PATCH` setting `active` to `false`, fired from the source to every connected vendor at the moment of departure. That single wave of calls is the security payoff of the whole approach: the instant someone is marked gone in the source system, they are cut off everywhere at once, with their work preserved — no waiting for a login that will never come, and no per-vendor manual cleanup. The SCIM API is itself a protected API, and the source authenticates to it like any client, typically with an OAuth bearer token — so provisioning is secured by the same machinery covered earlier.

### How SCIM and JIT fit together

The two are not competitors; they cover different parts of the lifecycle, and mature setups often combine them:

| | JIT provisioning | SCIM |
| --- | --- | --- |
| Trigger | the user logs in | the source pushes a change |
| Direction | pull (reacts to login) | push (source initiates) |
| Creation | lazily, on first login | eagerly, on hire |
| Updates | at each login | immediately on change |
| Departure | not handled — no login to trigger it | handled — the main reason it exists |
| Account exists before first login | no | yes |

JIT alone is cheap and simple and fine for low-stakes apps, but blind to departures. SCIM covers the full lifecycle — especially the departure JIT can't see — and additionally means accounts exist *before* first login, which matters when a user must be pre-assigned to something or have a document shared with them before they've ever signed in. A common arrangement is JIT for creation and SCIM for deactivation: let accounts appear lazily on first login, but rely on SCIM's push to reliably disable them on departure, which is the security-critical part.

In short: provisioning is a separate axis from authentication — it manages whether an account exists over time, not who is logging in. SCIM is the standard REST API for it, letting a source of truth push create, update, and deactivate changes to every connected app so their user lists stay in sync. Its payoff is instant deactivation everywhere at departure; its key subtlety is to deactivate rather than delete, so that a person's authored work is never orphaned.

---

## 16. Authorization models: RBAC, ABAC, ReBAC

An earlier section separated authentication from authorization: authentication proves who someone is, authorization decides what they may do, and that second decision is made locally by the resource owner on every request. This section is about *how* that "what may you do?" decision is actually structured. There are three common models, and each one is a response to where the previous one breaks down.

### The naive starting point

The simplest authorization is to attach permissions directly to each user: Alice may read and write repository A and read repository B; Bob may read repository A; and so on. This is fine for a handful of people, but it collapses at scale. With thousands of users, hundreds of resources, and several actions each, the system becomes a vast per-user permission list maintained by hand. Adding a resource means editing thousands of users; when someone changes jobs, their sprawling list has to be hand-edited and something is always missed.

### RBAC — role-based access control

The fix is to notice that many users have the *same* permissions because they do the same job, and to insert a **role** between users and permissions. Permissions are attached to a role once, and users are assigned to roles:

- Permissions to role: a "Developer" role can read and write repositories and run pipelines; a "Viewer" role can only read.
- Users to role: whole teams are assigned the "Developer" role.

Now a new resource means updating one role, and everyone in it gets the change automatically. A job change is a single reassignment that swaps a person's entire permission set. A new hire gets one role. Thousands of per-user lists collapse into a handful of roles. This is why RBAC is the default in almost every system in use.

RBAC's limit shows up when access depends on things a role can't express. Consider a rule like "a developer may write to a repository, but only ones owned by their own team, only during business hours, and only from a company network." A role is a static label; it can't reason about "their own team" or "business hours." The only way to encode those conditions in roles is to create ever-narrower ones — "Developer-TeamA," then "Developer-TeamA-BusinessHours," and so on — which multiplies into an unmanageable number of hyper-specific roles. This failure has a name: **role explosion**. RBAC breaks down when access depends on context and attributes.

### ABAC — attribute-based access control

ABAC replaces the pre-assigned label with a **rule evaluated against facts at the moment of the request**. Rather than looking up a static role, the system gathers properties that already exist and checks them against a written policy. Those properties fall into four categories:

- **Subject** attributes — facts about the user (team, department, clearance, employment status).
- **Resource** attributes — facts about the thing being accessed (owning team, sensitivity, creator).
- **Action** attributes — what is being attempted (read, write, delete).
- **Environment** attributes — context of the request (time of day, source IP, device, location).

None of these are special permission data assigned in advance; they are ordinary facts the system already knows. The "own-team repositories, in hours, from the company network" rule that caused role explosion becomes a single policy:

```
ALLOW write IF
    subject.team == resource.owning_team
    AND environment.time IN business_hours
    AND environment.ip IN company_range
```

The important detail is that the rule never names a specific team. It says *the user's team is the same as the resource's owning team* — a comparison between two facts — so one rule covers every team that exists now or later. That single comparison replaces the entire exploded set of per-team roles, because it reasons about the relationship between attributes rather than enumerating cases. Run the rule for a user on the owning team during business hours on the company network and every clause passes; run the same rule unchanged for someone on a different team and the first clause fails. Same policy, different facts, different outcome.

ABAC's strength is exactly RBAC's weakness — it handles context and conditional access without exploding. Its cost is complexity: the system now runs a policy engine, decisions are harder to trace ("why was I denied?" requires evaluating the whole rule), and testing is harder because the range of possible inputs is large. RBAC can be audited by reading a table; ABAC has to be evaluated. In practice the two are often combined — RBAC for the broad cut ("is this person a developer at all?") and ABAC for the conditions layered on top.

### ReBAC — relationship-based access control

Some access questions aren't about a label or an attribute but about how entities are *connected*. In a document-sharing system, a person may open a document because they created it, because it was shared with them directly, because it sits in a folder shared with a group they belong to, or because they're on a team that owns the parent folder. Roles can't express per-document, per-user sharing, and attributes fit awkwardly, because the deciding factor isn't a property like "team = X" but a chain of relationships.

ReBAC models permission as those relationships, which naturally form a **graph** — each relationship ("Alice is a member of Team A," "Team A owns Folder X," "Folder X contains Document Y") is an edge connecting two entities. A request becomes a question of whether a path exists through the graph from the user to the resource:

```
Alice ──member of──> Team A ──owns──> Folder X ──contains──> Document Y
```

When Alice tries to open Document Y, the system walks the graph, finds a connected path, and allows it; a user with no such path is denied. Access becomes reachability in the graph. This fits systems whose permissions are inherently about connection — document sharing, source-code hosting, social networks — where questions like "can see this because they're friends with someone tagged in it" are natural as graph traversals and awkward as anything else. The well-known reference design is Google's Zanzibar, which several open-source systems are modelled on; "Zanzibar-style authorization" refers to this approach of storing permissions as relationship tuples and deciding by graph reachability.

Its cost is the infrastructure: a graph of relationships and an engine to traverse it, which can be demanding to scale.

### Choosing and combining

The three models increase in expressiveness and in cost:

| Model | Decides by asking | Best when | Weakness |
| --- | --- | --- | --- |
| RBAC | what role does the user have? | permissions cluster into a few job types | role explosion when access depends on context |
| ABAC | do the facts satisfy this rule? | access depends on attributes or context | harder to reason about and audit |
| ReBAC | is there a relationship path to the resource? | permissions flow through ownership, membership, sharing | needs a graph and traversal engine |

Real systems rarely pick one exclusively. A common arrangement uses RBAC for the coarse cut (staff versus admin), ABAC for conditions (only in business hours, only from a managed device), and ReBAC where sharing and ownership matter (only documents in the user's team folders). The right model is chosen per kind of decision, and the models are layered.

One connection to the earlier OAuth material is worth drawing. A scope is coarse — it says an application may touch a class of resource at all — and is distinct from what the *user* is permitted to do. These authorization models are how that finer, user-level question is answered on the resource side. Scopes gate the application; RBAC, ABAC, and ReBAC gate the user; the two stack.

In short: authorization models structure the "what may you do?" decision — RBAC by pre-assigned roles, ABAC by rules over attributes evaluated at request time, and ReBAC by paths through a relationship graph — increasing in expressiveness and cost, and usually combined rather than chosen exclusively.

---

## 17. Multi-factor authentication and passkeys

Every flow in this document has, at some point, said "the user authenticates" and moved on. This section is about that step itself: how a person actually proves who they are, and how to make that proof hard to fake. It ends with passkeys, which are built on the same public/private-key idea introduced in the JWT section.

### The three factors

Evidence for an identity claim always falls into one of three categories:

- **Something you know** — a password, PIN, or security answer.
- **Something you have** — a phone, hardware key, or smartcard.
- **Something you are** — a fingerprint, face, or iris.

**Multi-factor authentication (MFA)** means requiring evidence from two or more *different* categories. The "different" is what matters: a password plus a PIN is not MFA, because both are things you know; a password plus a phone code is, because it combines knowledge with possession.

The reason combining categories is strong comes down to how each one fails. Knowledge is copyable at a distance — a password can be phished, leaked in a breach, or guessed from anywhere in the world, and stealing it doesn't deprive you of it. Possession is not copyable at a distance — to satisfy "something you have," an attacker needs the actual physical object. Requiring one of each forces an attacker to clear two obstacles whose attack methods don't overlap: knowing a secret is easy remotely, holding your physical device is not. Adding a *second* password would add nothing, because it fails to the exact same remote attacks as the first. MFA works by combining factors with independent failure modes.

### Not all second factors are equal

"Something you have" sounds solid, but how possession is proven matters enormously, and the most common method — the **SMS code** — turns out to be attackable on three separate layers.

- **SIM swap.** A phone number isn't bound to a physical phone; it's bound to a SIM, and the carrier decides which SIM a number points at. An attacker who social-engineers the carrier's support process (or exploits a lax or complicit agent) can have the number reassigned to their own SIM, so the codes arrive on their device — stolen remotely, without ever touching the victim's phone. (Some countries harden this with biometric SIM re-issuance, which closes the retail path but not the two below.)
- **SS7 diversion.** SS7 is the decades-old signaling system carriers use between each other to route calls and texts. It was built for a small set of trusted operators and has almost no authentication between network elements. An attacker with SS7 access — a rogue or compromised carrier, or a leased entry point — can reroute or intercept the text at the signaling layer, remotely and invisibly, with no access to the phone or the carrier's support desk.
- **Real-time phishing.** A fake login page captures the password and immediately enters it on the real site; the real site sends the code to the genuine phone; the user, believing they're on the real site, types the code into the fake page; the attacker relays it to the real site within the code's short validity window. The code being short-lived doesn't help, because it's relayed in real time.

The first two are specific to phone numbers; the third defeats *any* factor whose security depends on the user reading a value and typing it somewhere. That includes authenticator-app codes (TOTP), which are immune to SIM swap and SS7 because no phone number is involved, but are still phishable — a user can be tricked into typing the rotating code into a fake site.

**Push approval** — the "approve this login?" prompt sent to an app on the phone — improves on codes in one way: nothing travels over the phone network, so SIM swap and SS7 don't apply. But it keeps the same ceiling, because the user still decides whether to approve. In a real-time phishing attack the attacker triggers the real login, the genuine prompt arrives on the user's phone, and the user — expecting to log in — approves the attacker's session. Push also introduces its own attack, **MFA fatigue**: an attacker with the password triggers login repeatedly, flooding the phone with prompts until the user approves one out of annoyance or confusion. Number matching (typing a code shown on the login screen into the app) blunts blind flooding but doesn't restore phishing resistance.

What every method above shares is that security rests on a human correctly judging whether a site is genuine. As long as that's true, phishing works.

### Passkeys and WebAuthn

Passkeys remove the human judgment from the security decision, using the public/private-key mechanism from the JWT section. The user proves identity by holding a private key and signing a challenge with it, rather than by transmitting any secret.

**At registration**, the device generates a key pair. The private key stays on the device, held in secure hardware (a phone's secure enclave, a laptop's TPM, or a hardware key) — it is never transmitted or shown. The public key is sent to the website and stored there. A leak of the site's database exposes only public keys, which cannot produce signatures and so cannot be used to impersonate anyone.

**At login**, the site sends a random challenge; the device signs it with the private key, after the user unlocks the key with a local gesture (fingerprint, face, or device PIN); the signature goes back and the site verifies it with the stored public key. Nothing reusable is ever transmitted — only a one-time signature over a one-time challenge.

This defeats all three SMS attacks at once: there is no code to divert over SS7, no phone number to swap, and — the important part — real-time phishing fails too. The signature is cryptographically bound to the real site's domain: the browser includes the origin it's actually talking to, and the device will only sign for that origin. So if a user is completely fooled by a fake site, their device signs for the *fake* domain; when the attacker relays that signature to the real site, the real site sees the wrong domain in it and rejects it. The signature made for the fake site is useless at the real one, automatically. Nothing the user can do overrides this, because the browser, not the user, enforces the domain check. That is the difference between phishing-*resistant* and merely phishing-*harder*: the user's mistake is made harmless rather than merely discouraged.

The terminology, placed:

- **WebAuthn** — the browser standard that performs key generation, challenge-signing, and domain binding; what a website calls to use this.
- **FIDO2** — the broader standard family WebAuthn belongs to; often used interchangeably with WebAuthn.
- **Passkey** — a WebAuthn credential that also syncs across a user's devices through their platform (for example, a phone and laptop sharing it), so losing one device doesn't lock the user out.

A passkey is often two factors in a single step: unlocking the private key needs both the device that holds it (possession) and the local biometric or PIN (inherence or knowledge) — and the biometric never leaves the device; it only unlocks the local key. Multi-factor strength from one fingerprint touch, with no shared secret anywhere in the system.

### The ranking

| Method | Phishable? | SIM swap / SS7? | Notes |
| --- | --- | --- | --- |
| Password alone | yes | n/a | single factor |
| SMS code | yes | yes | weak on three layers |
| Authenticator app (TOTP) | yes | no | no phone number, but still phishable |
| Push approval | effectively yes | no | vulnerable to MFA-fatigue flooding |
| Passkey (WebAuthn) | no | no | phishing-resistant by design |

The dividing line in that table is phishability, and it's a difference in kind rather than degree. Everything above passkeys depends on the user transmitting something and correctly judging who receives it; passkeys remove the transmittable secret and move the judgment from the fallible human to the browser. That is why passkeys are treated not as better MFA but as a replacement for passwords, and why the industry is moving toward them.

In short: authentication factors combine categories with independent failure modes — something you know, have, or are; SMS is the weakest because it's attackable at three layers; and passkeys end phishing as a category by proving possession of a domain-bound private key that never leaves the device, so that even a fully fooled user stays safe.

---

## Glossary

- **HTTP (stateless)** — The web's request/response protocol. "Stateless" means each request is independent; the server retains no memory of previous requests on its own.
- **Cookie** — A small string a server stores in the browser via the `Set-Cookie` header; the browser returns it on every subsequent request to the *same domain*.
- **Session** — The server-side record of a logged-in user, typically referenced by a session cookie.
- **Redirect** — An HTTP response (`302` with a `Location` header) instructing the browser to make a fresh request to another URL.
- **Domain isolation** — The browser rule that a cookie is only ever sent back to the domain that set it.
- **Identity Provider (IdP)** — The system that authenticates users and vouches for their identity to applications.
- **Relying Party / Client / Service Provider** — Names for the application that relies on an identity provider to identify its users.
- **Single Sign-On (SSO)** — Logging in once and gaining access to multiple applications without re-entering credentials.
- **Single Logout (SLO)** — Ending a user's session across all applications at once; harder than it sounds, due to domain isolation.
- **Authentication (AuthN)** — Establishing who a user is. Done once, up front; the result lasts the session.
- **Authorization (AuthZ)** — Deciding whether a user may perform a specific action on a resource. Checked on every access; the answer can change mid-session.
- **OAuth 2.0** — A framework for delegating narrow, revocable access to your data on one service to a third-party application, without sharing your password.
- **Delegation** — Granting an application a slice of your access, as opposed to logging in yourself. OAuth's actual job.
- **Resource owner / Client / Authorization server / Resource server** — OAuth's four roles: the user who owns the data; the app wanting access; the system that authenticates the user and issues tokens; the API that holds the data and checks tokens.
- **Authorization code** — A short-lived, single-use placeholder sent through the browser, which the client swaps for a token over the back channel.
- **Access token** — A short-lived bearer credential the client presents to the resource server to make API calls on the user's behalf. Carries authorization (scopes), not proof of the user's identity.
- **Refresh token** — A long-lived credential, used only on the back channel, that the client exchanges for fresh access tokens without involving the user.
- **Bearer token** — A credential where mere possession is sufficient to use it, with no check that the holder is the rightful owner — like cash.
- **Front channel / Back channel** — The exposed path through the browser (redirects, URLs) versus the private path server-to-server. Secrets and tokens travel only on the back channel.
- **Client secret** — A password for the application itself, issued at registration and verified by the authorization server; only confidential clients can hold one.
- **Confidential vs public client** — A client that can safely store a secret (runs on a server) versus one that can't (mobile, single-page, or desktop app).
- **PKCE (Proof Key for Code Exchange)** — A per-login verifier/challenge mechanism that binds an authorization code to the app instance that started the flow, protecting the code exchange without a pre-shared secret.
- **Scope** — A label naming one slice of access; requested by the client, consented to by the user, and enforced by the resource server. Authorization, not identity.
- **Grant type** — An OAuth flow. The two that matter today: authorization code (with PKCE) for user delegation, and client credentials for service-to-service access.
- **Consent** — The user's approval, on the authorization server's own screen, of the specific access an app requested. Distinct from authentication.
- **OpenID Connect (OIDC)** — An identity layer on top of OAuth 2.0; switched on with the `openid` scope, it adds login to OAuth's delegated access.
- **ID token** — A signed statement from the provider, addressed to a specific app, proving who the user is. Read and verified by the app; distinct from the access token.
- **Claim** — A field inside a token (e.g. `sub`, `aud`, `exp`), stating one fact the receiver reads and checks.
- **`sub` (subject)** — The user's stable, unique identifier at a provider. The correct thing to match accounts on, rather than email.
- **`aud` (audience)** — The recipient a token is intended for. An app confirms a token's audience is itself before trusting it.
- **`nonce`** — A one-time value the app sends in a login request and checks in the returned ID token, proving the token answers that request and wasn't replayed.
- **UserInfo endpoint** — A provider API that returns a user's identity claims as JSON when called with the access token; an alternative to packing everything into the ID token.
- **Discovery** — A provider's metadata document at `/.well-known/openid-configuration`, listing its endpoints, keys, and capabilities so a client can configure itself from one URL.
- **Backend-for-frontend (BFF)** — A pattern where a browser app's own backend runs the OIDC flow and holds the tokens server-side, giving the browser only a session cookie so tokens never reach it.
- **JWT (JSON Web Token)** — A self-contained, signed token in three base64url parts (header, payload, signature); anyone can verify and read it, but only the issuer can forge it.
- **Self-contained vs opaque token** — A token that carries its own claims and is verified offline, versus a meaningless reference the issuer must look up. JWTs are self-contained; opaque tokens are the coat-check model.
- **Signature (HMAC vs asymmetric)** — Integrity proof on a token. HMAC (e.g. HS256) uses one shared secret to sign and verify; asymmetric (e.g. RS256) signs with a private key and lets anyone verify with the public key.
- **Registered vs private claims** — Standardized claim names defined by the JWT spec (`iss`, `sub`, `aud`, `exp`, `nbf`, `iat`, `jti`) versus custom fields an issuer and consumer agree on.
- **Introspection** — A resource server asking the authorization server whether a token is still valid, trading offline speed for the ability to revoke instantly.
- **SAML (Security Assertion Markup Language)** — An older SSO protocol that proves a user's identity to an app using signed XML; does login only, with no concept of API authorization.
- **Assertion** — SAML's signed XML statement of who the user is, addressed to one service provider. The SAML counterpart of an ID token.
- **Service Provider (SP) / Identity Provider (IdP)** — SAML's names for the application being logged into and the system that authenticates the user.
- **SP-initiated vs IdP-initiated** — Whether a SAML login starts at the app (normal, and safer because the app can check the response) or at the identity provider (unsolicited, weaker, and discouraged).
- **Metadata (SAML)** — An XML document each party publishes with its endpoints, identifier, and signing certificate; exchanged in both directions to establish trust. SAML's equivalent of OIDC discovery.
- **Federation** — One identity provider trusting another to authenticate users, so a user from one organization can reach another's resources without a separate account there.
- **Identity broker** — An identity provider that delegates authentication to another (upstream) provider and relays the result to its own apps; plays client and identity-provider roles at once.
- **Just-in-time (JIT) provisioning** — Creating a local user record from a trusted token the first time a federated user logs in, rather than setting it up in advance.
- **Home-realm discovery** — The step where a broker decides which upstream identity provider to send a user to, often by organization choice or email domain.
- **Provisioning** — Managing the lifecycle of a user account — creating, updating, and deactivating it over time — as distinct from authenticating a login.
- **SCIM (System for Cross-domain Identity Management)** — A standard REST API and user schema that lets a source of truth push account create, update, and deactivate changes to connected applications.
- **Deactivation vs deletion** — Marking an account inactive (`active: false`) so it can't log in while its record and authored work remain, versus removing the record entirely. Departures are handled by deactivation.
- **RBAC (role-based access control)** — Authorization by a role placed between users and permissions; simple and auditable, but prone to role explosion when access depends on context.
- **ABAC (attribute-based access control)** — Authorization by a rule evaluated at request time against facts about the subject, resource, action, and environment; flexible but harder to audit.
- **ReBAC (relationship-based access control)** — Authorization by whether a path exists through a graph of relationships between users, groups, and resources; fits ownership and sharing.
- **Role explosion** — The proliferation of ever-narrower roles that happens when RBAC is stretched to encode context-dependent access.
- **Multi-factor authentication (MFA)** — Requiring evidence from two or more different categories — something you know, have, or are — so that factors with independent failure modes must both be defeated.
- **The three factors** — Knowledge (password, PIN), possession (phone, hardware key), and inherence (biometrics); the categories authentication evidence falls into.
- **Phishing resistance** — A property of an authentication method where a fooled user still can't hand access to an attacker, because the check is enforced cryptographically rather than by human judgment.
- **Passkey / WebAuthn** — Login by signing a challenge with a private key held in device hardware and verified by a stored public key; the signature is bound to the site's domain, making it phishing-resistant.
- **SIM swap / SS7** — Two telecom-layer attacks that defeat SMS codes: reassigning a phone number to an attacker's SIM, and rerouting texts through the unauthenticated inter-carrier signaling system.
