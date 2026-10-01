import { SignJWT } from "jose";

const secret = new TextEncoder().encode("dev-secret-change-me");   // HMAC key (HS256)

const jwt = await new SignJWT({ role: "user" })        // a custom (private) claim
  .setProtectedHeader({ alg: "HS256", typ: "JWT" })    // the header
  .setSubject("alice")                                 // sub
  .setIssuer("https://issuer.example")                 // iss
  .setAudience("my-app")                               // aud
  .setExpirationTime("1h")                             // exp
  .sign(secret);                                       // compute the signature

console.log(jwt);
