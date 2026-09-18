import { readFileSync } from "node:fs";

const appPath = new URL("../src/App.tsx", import.meta.url);
const app = readFileSync(appPath, "utf8");

const required = [
  "CYVRA Mobile",
  "Desktop Workstation",
];

const forbidden = [
  "Get started",
  "Count is",
  "Explore Vite",
  "Join the Vite community",
  "vite.dev",
  "react.dev",
  "github.com/vitejs/vite",
  "chat.vite.dev",
  "x.com/vite_js",
  "bsky.app/profile/vite.dev",
  "reactLogo",
  "viteLogo",
];

for (const value of required) {
  if (!app.includes(value)) {
    throw new Error(
      `Missing required CYVRA shell marker: ${value}`
    );
  }
}

for (const value of forbidden) {
  if (app.includes(value)) {
    throw new Error(
      `Starter content still present: ${value}`
    );
  }
}

if (app.includes("useState")) {
  throw new Error(
    "Starter counter state is still present."
  );
}

console.log("D1.5 shell validation: PASS");