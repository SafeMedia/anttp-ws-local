import http from "http";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import fetch, { Response as FetchResponse } from "node-fetch";
import { uploadFileWithAnt } from "../utils/ant.js";
import fs from "fs/promises";
import os from "os";
import path from "path";

const CLIENT_PORT = parseInt(process.env.CLIENT_PORT || "8081");
const ANTTP_PORT = parseInt(process.env.ANTTP_PORT || "8082");
const ANTTP_HOST = process.env.ANTTP_HOST || "127.0.0.1";

const PATH_REGEX = /^[a-f0-9]{64}(\/[\w\-._~:@!$&'()*+,;=]+)*$/i;

type FetchJob = { address: string; ws: WebSocket };
const queue: FetchJob[] = [];
let activeJobs = 0;
const MAX_CONCURRENT = 5;
const TIMEOUT_MS = 60000;
const EXPIRATION_MS = 180000;

const uploadBuffers = new Map<
    string,
    {
        mime_type: string;
        total_chunks: number;
        received: number;
        chunks: Buffer[];
        filename: string;
    }
>();

const uploadTimers = new Map<string, NodeJS.Timeout>();

function startChunkExpiration(key: string) {
    if (uploadTimers.has(key)) clearTimeout(uploadTimers.get(key));
    uploadTimers.set(
        key,
        setTimeout(() => {
            uploadBuffers.delete(key);
            uploadTimers.delete(key);
            console.warn(`⚠️ Upload expired for key: ${key}`);
        }, EXPIRATION_MS)
    );
}

// Create HTTP server
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end("✨ WebSocket server is live ✨");
});

server.headersTimeout = 120000;
const wss = new WebSocketServer({ server });

console.log(`✅ WebSocket server initialized.`);

wss.on("connection", (ws, req) => {
    const ip = req.socket.remoteAddress || "unknown";
    console.log(`👤 Client connected from ${ip}`);

    ws.on("message", async (message: string | Buffer) => {
        let data: any;
        try {
            data = JSON.parse(message.toString());
        } catch (err) {
            return ws.send(
                JSON.stringify({ type: "error", message: "Invalid JSON" })
            );
        }

        if (data.type === "download" && typeof data.address === "string") {
            const address = data.address.trim();
            if (!PATH_REGEX.test(address) || address.includes("..")) {
                return ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "Invalid address format",
                    })
                );
            }
            queue.push({ address, ws });
            processQueue();
        } else if (data.type === "upload_chunk") {
            handleUploadChunk(ws, data);
        } else {
            ws.send(
                JSON.stringify({
                    type: "error",
                    message: "Invalid message type",
                })
            );
        }
    });

    ws.on("close", () => {
        console.log(`❌ Client disconnected from ${ip}`);
    });
});

function handleUploadChunk(ws: WebSocket, data: any) {
    const { filename, mime_type, chunk_index, total_chunks, chunk_base64 } =
        data;

    if (
        typeof filename !== "string" ||
        typeof mime_type !== "string" ||
        typeof chunk_index !== "number" ||
        typeof total_chunks !== "number" ||
        typeof chunk_base64 !== "string"
    ) {
        return ws.send(
            JSON.stringify({
                type: "error",
                message: "Missing or invalid upload fields",
            })
        );
    }

    const key = filename;
    const buffer = Buffer.from(chunk_base64, "base64");

    if (!uploadBuffers.has(key)) {
        uploadBuffers.set(key, {
            filename,
            mime_type,
            total_chunks,
            received: 0,
            chunks: new Array(total_chunks),
        });
    }

    const entry = uploadBuffers.get(key)!;
    if (!entry.chunks[chunk_index]) {
        entry.chunks[chunk_index] = buffer;
        entry.received++;
    }

    startChunkExpiration(key);

    if (entry.received === total_chunks) {
        console.log(`✅ Reconstructing file: ${filename}`);
        const fullBuffer = Buffer.concat(entry.chunks);

        writeTempAndUpload(ws, filename, fullBuffer);

        uploadBuffers.delete(key);
        uploadTimers.delete(key);
    }
}

async function writeTempAndUpload(
    ws: WebSocket,
    name: string,
    buffer: Buffer,
    options: { public?: boolean; quorum?: string; noVerify?: boolean } = {}
) {
    try {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "upload-"));
        const filePath = path.join(dir, name);
        await fs.writeFile(filePath, buffer);

        const xorname = await uploadFileWithAnt(filePath, options);
        if (!xorname) throw new Error("Upload failed or returned no address");

        ws.send(
            JSON.stringify({
                type: "upload_complete",
                xorname,
                filename: name,
            })
        );
    } catch (err: any) {
        ws.send(
            JSON.stringify({
                type: "error",
                message: err.message || String(err),
                filename: name,
            })
        );
    }
}

function processQueue() {
    if (activeJobs >= MAX_CONCURRENT || queue.length === 0) return;

    const job = queue.shift();
    if (!job) return;

    activeJobs++;

    console.log("ANTTP_PORT: ", ANTTP_PORT);

    const url = `http://${ANTTP_HOST}:${ANTTP_PORT}/${job.address}`;
    console.log("attempting to get from: ", url);

    fetchWithTimeout(url, TIMEOUT_MS)
        .then(async (res) => {
            if (!res.ok) throw new Error(`http ${res.status}`);
            const mimeType =
                res.headers.get("content-type") || "application/octet-stream";
            const buffer = await res.arrayBuffer();

            const metadata = JSON.stringify({ mimeType, xorname: job.address });
            const metadataBuffer = Buffer.from(metadata, "utf-8");
            const headerBuffer = Buffer.alloc(4);
            headerBuffer.writeUInt32BE(metadataBuffer.length, 0);

            const combined = Buffer.concat([
                headerBuffer,
                metadataBuffer,
                Buffer.from(buffer),
            ]);

            job.ws.send(combined);
        })
        .catch((err) => {
            console.error(`❌ Error fetching from ANTPP: ${err.message}`);
            job.ws.send(
                JSON.stringify({
                    type: "error",
                    message: `Error fetching: ${err.message}`,
                })
            );
        })
        .finally(() => {
            activeJobs--;
            processQueue();
        });
}

async function fetchWithTimeout(
    url: string,
    timeoutMs: number
): Promise<FetchResponse> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res;
}

server.listen(CLIENT_PORT, () => {
    console.log(`🚀 Server running at ws://localhost:${CLIENT_PORT}`);
});
