const http = require("http");
const fs = require("fs");
const path = require("path");

// Try finding the token file in a few common paths since PowerShell failed
const possibleTokenPaths = [
  "C:/Users/maroe/.gemini/antigravity/brain/e949ca29-d0bb-41d1-a81f-006083234c3d/token.txt",
  path.join(
    process.env.USERPROFILE,
    ".gemini/antigravity/brain/e949ca29-d0bb-41d1-a81f-006083234c3d/token.txt",
  ),
  path.resolve(__dirname, "../token.txt"), // Fallback if copied locally
];

let token = null;
for (const tokenPath of possibleTokenPaths) {
  try {
    if (fs.existsSync(tokenPath)) {
      token = fs.readFileSync(tokenPath, "utf8").trim();
      break;
    }
  } catch (e) {
    // Ignore and try next
  }
}

if (!token) {
  console.log("Could not find token file. Trying without auth (might fail).");
  token = "dummy-token"; // We might need a real auth bypassed route or just login
}

const req = http.request(
  "http://localhost:3001/api/notifications?limit=5&offset=0&priority=low",
  {
    headers: {
      Authorization: "Bearer " + token,
    },
  },
  (res) => {
    let data = "";
    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => console.log("API Response:", data));
  },
);

req.on("error", console.error);
req.end();
