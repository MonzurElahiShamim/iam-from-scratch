import { SignJWT, jwtVerify } from "jose";

const secret = new TextEncoder().encode("dev-secret-change-me");

// Mint a genuine token (role: user)
const jwt = await new SignJWT({ role: "user" })
  .setProtectedHeader({ alg: "HS256", typ: "JWT" })
  .setSubject("alice")
  .setIssuer("https://issuer.example")
  .setAudience("my-app")
  .setExpirationTime("1h")
  .sign(secret);

// 1) VERIFY the genuine token — checks signature + iss + aud + exp
const { payload } = await jwtVerify(jwt, secret, {
  issuer: "https://issuer.example",
  audience: "my-app",
});
console.log("✅ genuine verified →", { sub: payload.sub, role: payload.role });

// 2) TAMPER: rewrite the payload to role:admin, keep the original signature
const [h, p, s] = jwt.split(".");
const hacked = { ...JSON.parse(Buffer.from(p, "base64url").toString()), role: "admin" };
const tampered = `${h}.${Buffer.from(JSON.stringify(hacked)).toString("base64url")}.${s}`;
console.log("tampered token now claims role →", hacked.role);

try {
  await jwtVerify(tampered, secret, { issuer: "https://issuer.example", audience: "my-app" });
  console.log("❌ tampered token ACCEPTED — this would be a disaster");
} catch (e) {
  console.log("✅ tampered token REJECTED →", (e as Error).message);
}
