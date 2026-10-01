import { createRemoteJWKSet, jwtVerify } from "jose";

const token = await (await fetch("http://localhost:4000/token")).text();

// Fetch the issuer's PUBLIC keys and verify against them.
const JWKS = createRemoteJWKSet(new URL("http://localhost:4000/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, JWKS, {
  issuer: "https://issuer.example",
  audience: "my-app",
});
console.log("✅ verified with public JWKS →", { sub: payload.sub, role: payload.role });
