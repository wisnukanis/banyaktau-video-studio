import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { paths } from "../config.js";

/**
 * Generates an MP3 file using Microsoft Edge TTS.
 * @param {object} params
 * @param {string} params.text - The text to read.
 * @param {string} params.voiceId - The voice to use (e.g. en-US-GuyNeural).
 * @param {string} params.outputPath - The absolute path where the output file should be saved.
 */
export async function generateEdgeTts({ text, voiceId, outputPath }) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const selectedVoice = voiceId || "en-US-GuyNeural";

  return new Promise((resolve, reject) => {
    const args = [
      "--text", text,
      "--voice", selectedVoice,
      "--write-media", outputPath
    ];

    console.log(`[Edge-TTS] Spawning edge-tts with voice ${selectedVoice}...`);
    const child = spawn("edge-tts", args, { windowsHide: true, cwd: paths.rootDir });

    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    let resolved = false;

    child.on("error", (err) => {
      if (resolved) return;
      console.log(`[Edge-TTS] Direct execution failed (${err.message}). Trying fallback via python...`);
      runPythonFallback();
    });

    child.on("close", (code) => {
      if (resolved) return;
      if (code === 0) {
        resolved = true;
        resolve();
      } else {
        console.log(`[Edge-TTS] Direct execution exited with code ${code}. Trying fallback via python...`);
        runPythonFallback();
      }
    });

    function runPythonFallback() {
      const pythonArgs = ["-m", "edge_tts", ...args];
      const fallbackChild = spawn("python", pythonArgs, { windowsHide: true, cwd: paths.rootDir });

      let fallbackStderr = "";
      fallbackChild.stderr.on("data", (chunk) => { fallbackStderr += chunk.toString(); });

      fallbackChild.on("error", (err2) => {
        resolved = true;
        reject(new Error(`Failed to start edge-tts: ${err2.message}`));
      });

      fallbackChild.on("close", (code) => {
        if (resolved) return;
        if (code === 0) {
          resolved = true;
          resolve();
        } else {
          try {
            console.log("[Edge-TTS] edge-tts not installed. Attempting on-the-fly pip install...");
            import("node:child_process").then(({ execSync }) => {
              try {
                execSync("pip install --break-system-packages edge-tts || pip install edge-tts", { stdio: "inherit" });
                const retry = spawn("python", ["-m", "edge_tts", ...args], { windowsHide: true, cwd: paths.rootDir });
                retry.on("close", (rCode) => {
                  resolved = true;
                  if (rCode === 0) resolve();
                  else reject(new Error(`edge-tts retry failed with code ${rCode}`));
                });
                retry.on("error", (rErr) => {
                  resolved = true;
                  reject(new Error(`edge-tts retry error: ${rErr.message}`));
                });
              } catch (pipErr) {
                resolved = true;
                reject(new Error(`pip install edge-tts failed: ${pipErr.message}`));
              }
            });
          } catch {
            resolved = true;
            reject(new Error(`edge-tts fallback failed with code ${code}. Stderr: ${fallbackStderr}`));
          }
        }
      });
    }
  });
}
