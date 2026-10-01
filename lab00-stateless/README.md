# Lab 00 — HTTP has no memory

**Concept:** Every HTTP request arrives at the server as a complete stranger. The server answers it and immediately forgets you existed. Before we can build *any* login, we have to feel this problem directly — because everything later (cookies, sessions, tokens) exists to work around it.

**Maps to:** `iam-foundations-final.md` §1 ("Why identity is hard at all").

**Time:** ~30 min. **Prerequisites:** none — this is the first lab.

> ⚠️ **This lab ends deliberately broken.** The final code here is *supposed* to be wrong. Lab 01 fixes it with cookies. Don't copy this pattern into anything real.

## The idea in plain words

The web has a strange property: **the server forgets you the instant it answers.** Every click is a brand-new request that arrives like a stranger — there's no built-in memory telling the server "this is the same person who just logged in." That's what *stateless* means.

So before you can have *any* login, you must solve one thing: **how does the server remember you between requests?** This lab makes that problem concrete, then tries the obvious fix — one shared variable — and watches it blow up, because a single shared slot can't tell two people apart. That failure is exactly why the real solution has to exist: a **separate memory per visitor**, plus a **ticket** that says which memory is yours. That ticket is the cookie, in Lab 01.

---

## Setup

Every lab is its own self-contained npm project. From inside this folder:

```bash
npm init -y                 # create package.json with defaults
npm pkg set type="module"   # use modern ESM `import`, not old require()
npm install express         # the web server (runtime dependency)
npm install -D typescript tsx @types/express @types/node   # dev tooling
npm pkg set scripts.dev="tsx watch src/server.ts"          # run + auto-restart
```

`tsx` runs TypeScript directly — no separate build step. `npm run dev` starts the server and restarts it on every save.

You'll also want a `tsconfig.json` (see the one in this folder) — it's only for editor type-checking; `tsx` does the running.

Run the server with `npm run dev`, and use a **second terminal** for the `curl` commands below.

---

## Build it in three stages

Build it yourself, one stage at a time. Run the commands after each stage and *read the output* — the lesson is in what you observe, not in the final file.

### Stage 1 — a server that breathes

`src/server.ts`:

```ts
import express from "express";

const app = express();

app.get("/", (req, res) => {
  res.send("Lab 00 is alive.");
});

app.listen(3000, () => {
  console.log("Listening on http://localhost:3000");
});
```

```bash
curl http://localhost:3000
# → Lab 00 is alive.
```

Goal of this stage: just feel the edit → save → auto-restart → curl loop you'll use all series.

### Stage 2 — the problem, in two requests

Add these two routes *above* `app.listen(...)`:

```ts
app.post("/login", (req, res) => {
  const name = req.query.name;                     // e.g. POST /login?name=alice
  // We "receive" a login... but where would we store it? Nowhere.
  // This function ends, and `name` vanishes with it.
  res.send(`Got a login for: ${name}. But I stored nothing.`);
});

app.get("/whoami", (req, res) => {
  // A brand-new request. Nothing from /login came with it.
  res.send("I have no idea who you are. This request is a stranger to me.");
});
```

```bash
curl -X POST "http://localhost:3000/login?name=alice"
# → Got a login for: alice. But I stored nothing.
curl "http://localhost:3000/whoami"
# → I have no idea who you are. This request is a stranger to me.
```

**What you just proved:** there is no thread connecting request 1 to request 2. Each handler runs, replies, and forgets — its local variables die when it returns. The server didn't *lose* your name; there was never anywhere to keep it. **This is "HTTP has no memory."**

---

## Break it — the tempting "fix" that detonates

The obvious reaction: "just store the name in a variable." Do exactly that, and watch it fail in the way that explains the whole rest of the field.

Add a shared variable and rewrite the two routes (final code is in `src/server.ts`):

```ts
let currentUser: string | undefined;   // ONE variable — shared by the ENTIRE server

app.post("/login", (req, res) => {
  const name = req.query.name as string;
  currentUser = name;                   // "remember" who logged in
  res.send(`Logged in as: ${name}.`);
});

app.get("/whoami", (req, res) => {
  res.send(currentUser ? `You are ${currentUser}.` : "Nobody is logged in.");
});
```

**First, watch it seem to work:**

```bash
curl -X POST "http://localhost:3000/login?name=alice"
curl "http://localhost:3000/whoami"
# → You are alice.        ...looks fixed!
```

**Now the detonation.** Treat these as *two different people on two different laptops* hitting your one server:

```bash
curl -X POST "http://localhost:3000/login?name=alice"   # Alice, on her laptop
curl -X POST "http://localhost:3000/login?name=bob"     # Bob, on his laptop
curl "http://localhost:3000/whoami"                     # Alice refreshes her page
# → You are bob.
```

Alice checks who she is and the server says **`You are bob.`** There is exactly *one* `currentUser` slot for the whole server, so Bob's login overwrote Alice's. Every logged-in user would see whoever logged in most recently — accidental account takeover.

---

## The lesson (what makes this lab matter)

The server cannot keep identity in **one shared box**. It needs:

1. a **separate box per client**, and
2. a way for each client to say *"this box is mine"* on **every** request.

That per-client claim ticket — handed to the browser and returned automatically on each request — is the **cookie** (the coat-check ticket of §3). That is Lab 01.

---

## Checkpoint

Answer these from your own code before moving on:

1. In Stage 2, why can't the server tell that the `/whoami` request came from the same person as the `/login` request?
2. In the Break step, *why* does Alice see "bob"? What exactly is shared?
3. What two things (from "The lesson") does a real session need that the global variable lacks?

---

## Deliverables (this lab is "done" when…)

- [ ] `src/server.ts` runs with `npm run dev`.
- [ ] You've saved a transcript of the detonation (`login alice` → `login bob` → `whoami` = `You are bob.`).
- [ ] You can answer the three checkpoint questions in a sentence each (jot them in a `SOLUTION.md` if you like).
