import { spawn } from "child_process";
import os from "os";
import path from "path";
import fs from "fs";

const platform = os.platform();

let binaryPath;
if (platform === "win32") {
  binaryPath = path.resolve("bin", "windows", "anttp.exe");
} 
 else if (platform === "darwin") {
  binaryPath = path.resolve("bin", "macos", "anttp");  
} else {
  // For Linux/macOS etc.
  binaryPath = path.resolve("bin", "linux", "anttp");
}

// Check if executable, add exec permission if not
if (platform !== "win32") {
  try {
    fs.accessSync(binaryPath, fs.constants.X_OK);
  } catch (err) {
    console.log(`Making ${binaryPath} executable`);
    try {
      const stat = fs.statSync(binaryPath);
      // Add owner execute bit
      fs.chmodSync(binaryPath, stat.mode | 0o100);
    } catch (chmodErr) {
      console.error(`Failed to chmod ${binaryPath}:`, chmodErr);
      process.exit(1);
    }
  }
}

console.log("Platform:", platform);
console.log("Binary path:", binaryPath);
console.log("Exists:", fs.existsSync(binaryPath));
console.log("absolute binary path:", binaryPath);
console.log("exists:", fs.existsSync(binaryPath));

try {
  if (platform !== "win32") {
    fs.chmodSync(binaryPath, 0o755);
    console.log("chmod +x done");
  }
} catch (e) {
  console.error("chmod error:", e);
}


const child = spawn(binaryPath, [], { stdio: "inherit", shell: false });



child.on("close", (code) => {
  console.log(`anttp exited with code ${code}`);
  process.exit(code);
});
