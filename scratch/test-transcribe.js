import { transcribeSpeechSegments } from "../src/openai.js";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { config } from "../src/config.js";

async function transcribeTest(responseFormat) {
  const audioPath = "C:/xampp/htdocs/videoasal/generated/audio/tau_0b4c72563491-openai-natural-narration.mp3";
  console.log(`\nTesting transcription with format: ${responseFormat}...`);
  
  try {
    const buffer = await fs.readFile(audioPath);
    const form = new FormData();
    form.append("file", new Blob([buffer]), path.basename(audioPath));
    form.append("model", "whisper-1");
    form.append("language", "id");
    form.append("response_format", responseFormat);
    if (responseFormat === "verbose_json") {
      form.append("timestamp_granularities[]", "word");
    }

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.openai.apiKey}` },
      body: form
    });
    
    console.log(`Response status: ${response.status} (${response.statusText})`);
    const text = await response.text();
    console.log(`Response body (first 300 chars): ${text.slice(0, 300)}`);
  } catch (error) {
    console.error(`Format ${responseFormat} failed with error:`, error.message);
  }
}

async function main() {
  await transcribeTest("verbose_json");
  await transcribeTest("json");
}

main().catch(console.error);
