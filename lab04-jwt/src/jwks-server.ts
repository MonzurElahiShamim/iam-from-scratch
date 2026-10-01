import express from "express";
import { generateKeyPair, SignJWT, exportJWK } from "jose";

// Generate an RSA keypair at startup (extractable so we can publish the public half).
const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const kid = "dev-key-1";                                  // key id — names which key signed
const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };

const app = express();

// Publish the PUBLIC key so anyone can verify. This is the JWKS endpoint.
app.get("/.well-known/jwks.json", (_req, res) => res.json({ keys: [publicJwk] }));

// Mint a token signed with the PRIVATE key — only we can do this.
app.get("/token", async (_req, res) => {
  const jwt = await new SignJWT({ role: "user" })
    .setProtectedHeader({ alg: "RS256", kid })           // header names the key (kid)
    .setSubject("alice").setIssuer("https://issuer.example").setAudience("my-app")
    .setExpirationTime("1h").sign(privateKey);
  res.send(jwt);
});

app.listen(4000, "127.0.0.1", () => console.log("Issuer on http://localhost:4000"));
