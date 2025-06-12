// utils/ant.ts
import { spawn } from "child_process";
import os from "os";
import path from "path";
import fs from "fs";

/**
 * Uploads a file using ant CLI and returns the resulting xorname.
 * @param filePath - Local file to upload
 * @param options - Optional CLI flags like --public, --quorum, etc.
 * @returns The xorname (64-char hash address) on success
 */
export function uploadFileWithAnt(
    filePath: string,
    options: { public?: boolean; quorum?: string; noVerify?: boolean } = {}
): Promise<string> {
    return new Promise((resolve, reject) => {
        const platform = os.platform();

        let binaryPath;
        if (platform === "win32") {
            binaryPath = path.resolve("bin", "windows", "ant.exe");
        } else if (platform === "darwin") {
            binaryPath = path.resolve("bin", "macos", "ant");
        } else {
            binaryPath = path.resolve("bin", "linux", "ant");
        }

        if (platform !== "win32") {
            try {
                fs.chmodSync(binaryPath, 0o755);
            } catch (e) {
                return reject(`chmod failed: ${e}`);
            }
        }

        const args = ["file", "upload"];
        if (options.public) args.push("-p");
        if (options.quorum) args.push("-q", options.quorum);
        if (options.noVerify) args.push("-x");
        args.push(filePath);

        const child = spawn(binaryPath, args, {
            shell: false,
        });

        let output = "";
        child.stdout?.on("data", (data) => {
            output += data.toString();
        });

        child.stderr?.on("data", (data) => {
            output += data.toString(); // capture stderr too if needed
        });

        child.on("close", (code) => {
            if (code === 0) {
                const match = output.match(/At address:\s*([a-f0-9]{64})/i);
                if (match) {
                    resolve(match[1]); // xorname
                } else {
                    reject("Upload succeeded but no address found in output.");
                }
            } else {
                reject(
                    new Error(
                        `ant exited with code ${code}\nOutput:\n${output}`
                    )
                );
            }
        });

        child.on("error", (err) => {
            reject(err);
        });
    });
}
