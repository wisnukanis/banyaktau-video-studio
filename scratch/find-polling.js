import fs from "node:fs/promises";

async function main() {
  const content = await fs.readFile("public/app.js", "utf8");
  const lines = content.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("function startProgressPolling(")) {
      start = i;
      break;
    }
  }

  if (start !== -1) {
    console.log(`Found startProgressPolling starting at line ${start + 1}:`);
    for (let i = start; i < start + 30 && i < lines.length; i++) {
      console.log(`${i + 1}: ${lines[i]}`);
    }
  } else {
    console.log("startProgressPolling not found");
  }
}

main().catch(console.error);
