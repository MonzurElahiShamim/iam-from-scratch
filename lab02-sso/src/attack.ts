import { SignJWT, jwtVerify } from "jose";

const realSecret     = new TextEncoder().encode("dev-shared-secret-change-me");  // only the IdP has this
const attackerSecret = new TextEncoder().encode("attacker-guess");              // attacker's guess

// How an app verifies an incoming proof:
async function appVerifies(label: string, proof: string) {
  try {
    const { payload } = await jwtVerify(proof, realSecret, {
      audience: "dashboard",
      issuer: "http://login.localhost:3000",
    });
    console.log(`${label}\n   ✅ ACCEPTED as: ${payload.sub}\n`);
  } catch (e) {
    console.log(`${label}\n   ❌ REJECTED: ${(e as Error).message}\n`);
  }
}

// [1] A genuine proof, signed by the real IdP
const genuine = await new SignJWT({}).setProtectedHeader({ alg: "HS256" })
  .setSubject("alice").setAudience("dashboard").setIssuer("http://login.localhost:3000")
  .setExpirationTime("60s").sign(realSecret);
await appVerifies("[1] Genuine proof for alice:", genuine);

// [2] Attacker FORGES a proof for admin — but doesn't know the real secret
const forged = await new SignJWT({}).setProtectedHeader({ alg: "HS256" })
  .setSubject("admin").setAudience("dashboard").setIssuer("http://login.localhost:3000")
  .setExpirationTime("60s").sign(attackerSecret);   // wrong secret
await appVerifies("[2] Forged proof for admin (attacker's secret):", forged);

// [3] Attacker TAMPERS a genuine proof: rewrite the payload to admin, keep the old signature
const [h, p, s] = genuine.split(".");
const payload = JSON.parse(Buffer.from(p, "base64url").toString());
payload.sub = "admin";
const tamperedP = Buffer.from(JSON.stringify(payload)).toString("base64url");
await appVerifies("[3] Tampered proof (payload → admin, old signature):", `${h}.${tamperedP}.${s}`);
