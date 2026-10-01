// Regression guard for the AuthN/AuthZ split.
// Passes now; FAILS loudly if anyone ever collapses the two checks back into one.
// Requires a FRESH server (the revoke-admin demo mutates roles in memory) — restart first.
import assert from "node:assert";

const BASE = "http://localhost:3000";

// Log in and return the session cookie. Login 302-redirects; the cookie is set on that
// response, so we must NOT follow the redirect (redirect: "manual").
async function login(user: string): Promise<string> {
  const res = await fetch(`${BASE}/login?user=${user}`, { method: "POST", redirect: "manual" });
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error(`no Set-Cookie for ${user}`);
  return setCookie.split(";")[0]; // "session=..."
}

async function adminStatus(cookie: string): Promise<number> {
  const res = await fetch(`${BASE}/admin`, { headers: { cookie }, redirect: "manual" });
  return res.status;
}

const bob = await login("bob");
const alice = await login("alice");

// THE GUARD: a non-admin must be forbidden from /admin.
assert.strictEqual(
  await adminStatus(bob), 403,
  "BUG: a non-admin reached /admin — the two checks were collapsed into one!"
);

// An admin must be allowed.
assert.strictEqual(
  await adminStatus(alice), 200,
  "an admin should be allowed into /admin"
);

console.log("✅ authz test passed: non-admin → 403, admin → 200");
