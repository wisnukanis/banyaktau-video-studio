import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { paths } from "./config.js";

const ZIP_URL = "https://github.com/btahir/open-lofi/releases/latest/download/openlofi.zip";

const fileMappings = {
  "2-am-debug-loop.mp3": "sains.mp3",
  "cafe-da-tarde.mp3": "penemuan.mp3",
  "ashes-in-the-coffee-cup.mp3": "sejarah.mp3",
  "a-taste-of-spring.mp3": "tubuh_manusia.mp3",
  "almost-floating.mp3": "alam_semesta.mp3",
  "brushstrokes-and-rain.mp3": "teknologi.mp3",
  "dusk-between-stoops.mp3": "benda_sehari-hari.mp3",
  "3am-sink-light.mp3": "tokoh_dunia.mp3"
};

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const ps = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
    let stdout = "";
    let stderr = "";
    
    ps.stdout.on("data", (data) => stdout += data.toString());
    ps.stderr.on("data", (data) => stderr += data.toString());
    
    ps.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `PowerShell exited with code ${code}`));
    });
  });
}

async function main() {
  const musicDir = path.join(paths.rootDir, "assets", "music");
  await fs.mkdir(musicDir, { recursive: true });

  const zipPath = path.join(musicDir, "openlofi.zip");

  console.log(`Downloading Open Lo-Fi Zip from: ${ZIP_URL}`);
  console.log("This is a 680MB file. Downloading via stream to avoid memory limits...");

  const startTime = Date.now();
  const res = await fetch(ZIP_URL);
  if (!res.ok) {
    throw new Error(`Failed to download zip: HTTP ${res.status} ${res.statusText}`);
  }

  const fileStream = createWriteStream(zipPath);
  await finished(Readable.fromWeb(res.body).pipe(fileStream));
  
  const downloadDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Download finished in ${downloadDuration}s! Saved to: ${zipPath}`);

  console.log("Extracting required category tracks selectively using PowerShell .NET API...");

  // Generate powershell mapping hash table representation
  const psMappings = Object.entries(fileMappings)
    .map(([src, dest]) => `'${src}' = '${dest}'`)
    .join("; ");

  // Escape paths for PowerShell strings (replacing \ with \\ or using single quotes)
  const escapedZipPath = zipPath.replace(/'/g, "''");
  const escapedMusicDir = musicDir.replace(/'/g, "''");

  const psScript = `
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead('${escapedZipPath}')
    $mappings = @{ ${psMappings} }
    foreach ($entry in $zip.Entries) {
      if ($mappings.ContainsKey($entry.Name)) {
        $destName = $mappings[$entry.Name]
        $destPath = Join-Path '${escapedMusicDir}' $destName
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destPath, $true)
        Write-Output "Extracted $($entry.Name) to $destName"
      }
    }
    $zip.Dispose()
  `;

  try {
    const output = await runPowerShell(psScript);
    console.log("PowerShell extraction output:\n" + output.trim());
  } catch (err) {
    console.error("PowerShell extraction failed:", err);
  } finally {
    console.log("Cleaning up ZIP file...");
    try {
      await fs.unlink(zipPath);
      console.log("Successfully removed temporary ZIP file.");
    } catch (err) {
      console.error("Failed to delete ZIP file:", err.message);
    }
  }

  console.log("Check assets/music/ directory content:");
  const files = await fs.readdir(musicDir);
  console.log(files.filter(f => f.endsWith(".mp3") || f.endsWith(".m4a")));
}

main().catch(err => {
  console.error("Download and extraction failed:", err);
  process.exit(1);
});
