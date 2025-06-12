import { spawn } from "child_process";
import os from "os";
import path from "path";
import fs from "fs";

const platform = os.platform();

let binaryPath;
if (platform === "win32") {
  binaryPath = path.resolve("bin", "windows", "anttp.exe");
} else if (platform === "darwin") {
  binaryPath = path.resolve("bin", "macos", "anttp");
} else {
  // For Linux
  binaryPath = path.resolve("bin", "linux", "anttp");
}

// Make binary executable if not on Windows
if (platform !== "win32") {
  try {
    fs.accessSync(binaryPath, fs.constants.X_OK);
  } catch {
    console.log(`Making ${binaryPath} executable`);
    try {
      const stat = fs.statSync(binaryPath);
      fs.chmodSync(binaryPath, stat.mode | 0o100);
    } catch (chmodErr) {
      console.error(`Failed to chmod ${binaryPath}:`, chmodErr);
      process.exit(1);
    }
  }

  try {
    fs.chmodSync(binaryPath, 0o755);
    console.log("chmod +x done");
  } catch (e) {
    console.error("chmod error:", e);
  }
}

console.log("Platform:", platform);
console.log("Binary path:", binaryPath);
console.log("Exists:", fs.existsSync(binaryPath));

// Default port or listen address for ANTPP (should be consistent with your other configs)
const listenAddress = process.env.ANTPP_PORT || "127.0.0.1:8082"; 

console.log(`Starting anttp on ${listenAddress}`);

// Spawn anttp process, passing listen address to -l flag
const child = spawn(binaryPath, ["-l", listenAddress], {
  stdio: "inherit",
  shell: false,
});

child.on("close", (code) => {
  console.log(`anttp exited with code ${code}`);
  process.exit(code);
});
