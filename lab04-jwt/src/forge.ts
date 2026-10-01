import crypto from "node:crypto";
import { importSPKI, jwtVerify } from "jose";


const b64 = (o: object | string) =>
  Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const readPayload = (p: string) => JSON.parse(Buffer.from(p, "base64url").toString());

// The issuer's RSA keypair. The PUBLIC key (PEM) is published to everyone (JWKS).
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicPem  = publicKey.export({ type: "spki", format: "pem" }).toString();
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

// A genuine RS256 token the issuer mints (signs with the PRIVATE key):
function signRS256(payload: object) {
  const head = b64({ alg: "RS256", typ: "JWT" }), body = b64(payload);
  const sig = crypto.createSign("RSA-SHA256").update(`${head}.${body}`).sign(privatePem).toString("base64url");
  return `${head}.${body}.${sig}`;
}

// ❌ THE NAIVE VERIFIER — reads alg from the header and trusts it. This is the bug.
function naiveVerify(token: string): object {
  const [h, p, s] = token.split(".");
  const { alg } = JSON.parse(Buffer.from(h, "base64url").toString());
  const input = `${h}.${p}`;
  if (alg === "none") return readPayload(p);                                    // trusts "none"!
  if (alg === "HS256") {                                                        // uses public key as HMAC secret!
    if (crypto.createHmac("sha256", publicPem).update(input).digest("base64url") !== s) throw new Error("bad HMAC");
    return readPayload(p);
  }
  if (alg === "RS256") {
    if (!crypto.createVerify("RSA-SHA256").update(input).verify(publicPem, Buffer.from(s, "base64url"))) throw new Error("bad RSA");
    return readPayload(p);
  }
  throw new Error("unknown alg");
}

const genuine = signRS256({ sub: "alice", role: "user" });
console.log("genuine       →", naiveVerify(genuine));

// ATTACK 1 — alg:none. Header says "none", drop the signature entirely.
const noneToken = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: "attacker", role: "admin" })}.`;
console.log("alg:none      →", naiveVerify(noneToken));         // forged admin ACCEPTED

// ATTACK 2 — algorithm confusion (RS256→HS256). Sign with the PUBLIC key as an HMAC secret.
const head = b64({ alg: "HS256", typ: "JWT" }), body = b64({ sub: "attacker", role: "admin" });
const sig  = crypto.createHmac("sha256", publicPem).update(`${head}.${body}`).digest("base64url");
console.log("alg confusion →", naiveVerify(`${head}.${body}.${sig}`));  // forged admin ACCEPTED

const key = await importSPKI(publicPem, "RS256");   // an RSA public key object, pinned to RS256
console.log("\n--- safe verifier (pins algorithms: ['RS256']) ---");
for (const [name, tok] of [["genuine", genuine], ["alg:none", noneToken],
                           ["confusion", `${head}.${body}.${sig}`]] as const) {
  try { await jwtVerify(tok, key, { algorithms: ["RS256"] }); console.log(name, "→ ✅ accepted"); }
  catch (e) { console.log(name, "→ ❌ rejected:", (e as Error).message); }
}