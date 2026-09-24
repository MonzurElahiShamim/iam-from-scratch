import express from "express";        // pull in the web-server library

const app = express();                // create an app — a bucket to hang routes on

let currentUser: string | undefined;   // ONE variable — shared by the ENTIRE server

app.get("/", (req, res) => {          // when someone does GET / ...
  res.send("Lab 00 is alive.");       // ... send back this text
});

app.post("/login", (req, res) => {
  const name = req.query.name as string;
  currentUser = name;                   // "remember" who logged in
  res.send(`Logged in as: ${name}.`);
});

app.get("/whoami", (req, res) => {
  res.send(currentUser ? `You are ${currentUser}.` : "Nobody is logged in.");
});

app.listen(3000, () => {              // start listening on port 3000
  console.log("Listening on http://localhost:3000");
});
