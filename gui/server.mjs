import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, extname, dirname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  resolveReaCommand,
  loadCatalog,
  categorize,
  buildArgv,
  classifyDoctor,
} from "./lib.mjs";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

let catalogCache = null;
let reaVersionCache = null;
let guiToken = "";
let actualPort = 0;
const runningProcesses = new Set();
const MAX_CONCURRENT = 2;
const RUN_TIMEOUT = 10 * 60 * 1000;

async function getReaVersion(reaCommand) {
  if (reaVersionCache) return reaVersionCache;
  try {
    const result = await runCommand([...reaCommand, "--version"]);
    reaVersionCache = result.stdout.trim();
    return reaVersionCache;
  } catch {
    return "unknown";
  }
}

async function loadCatalogOnce(reaCommand) {
  if (catalogCache) return catalogCache;
  const result = await runCommand([
    ...reaCommand,
    "--llms-full",
    "--format",
    "json",
  ]);
  const parsed = loadCatalog(result.stdout);
  catalogCache = {
    ...parsed,
    commands: parsed.commands.map((c) => ({
      ...c,
      category: categorize(c.name),
    })),
  };
  return catalogCache;
}

function runCommand(argv, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const [cmd, ...args] = argv;
    const child = spawn(cmd, args, { shell: false, ...options });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));

    child.on("error", reject);
    child.on("close", (code) =>
      resolvePromise({ exitCode: code, stdout, stderr }),
    );
  });
}

function formatSse(event, data) {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return `event: ${event}\ndata: ${payload}\n\n`;
}

function safeWrite(res, chunk) {
  if (res.writableEnded || res.destroyed) return;
  res.write(chunk);
}

async function handleCatalog(req, res, reaCommand) {
  try {
    const catalog = await loadCatalogOnce(reaCommand);
    const version = await getReaVersion(reaCommand);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({ reaVersion: version, commands: catalog.commands }),
    );
  } catch {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Failed to load catalog" }));
  }
}

async function handleDoctor(req, res, reaCommand) {
  try {
    const result = await runCommand([
      ...reaCommand,
      "doctor",
      "--format",
      "json",
    ]);
    let raw;
    try {
      raw = JSON.parse(result.stdout);
    } catch {
      raw = { error: "Failed to parse doctor output", stdout: result.stdout };
    }
    const summary = classifyDoctor(raw);
    try {
      const catalog = await loadCatalogOnce(reaCommand);
      const available = new Set(catalog.commands.map((c) => c.name));
      summary.engineFree = summary.engineFree.filter((name) =>
        available.has(name),
      );
    } catch {}
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ raw, summary }));
  } catch {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Doctor check failed" }));
  }
}

export function validateHost(req) {
  const host = req.headers.host || "";
  return (
    host === `127.0.0.1:${actualPort}` || host === `localhost:${actualPort}`
  );
}

function validateToken(req) {
  return req.headers["x-rea-gui-token"] === guiToken;
}

async function handleRun(req, res, reaCommand) {
  if (!validateToken(req)) {
    res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Invalid token" }));
    return;
  }

  if (runningProcesses.size >= MAX_CONCURRENT) {
    res.writeHead(429, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Max concurrent runs reached" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const { command, args, options } = payload;
    if (!command || typeof command !== "string") {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Missing command" }));
      return;
    }

    const catalog = await loadCatalogOnce(reaCommand);
    const cmdInfo = catalog.commands.find((c) => c.name === command);
    if (!cmdInfo) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Unknown command" }));
      return;
    }

    const knownArgs = new Set(cmdInfo.args.map((a) => a.name));
    const knownOptions = new Set(cmdInfo.options.map((o) => o.name));

    for (const key of Object.keys(args || {})) {
      if (!knownArgs.has(key)) {
        res.writeHead(400, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify({ error: `Unknown arg: ${key}` }));
        return;
      }
    }
    for (const key of Object.keys(options || {})) {
      if (!knownOptions.has(key)) {
        res.writeHead(400, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify({ error: `Unknown option: ${key}` }));
        return;
      }
    }

    const argv = buildArgv(command, { args, options }, cmdInfo);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    safeWrite(res, formatSse("log", `Starting: ${argv.join(" ")}`));

    const [cmd, ...spawnArgs] = reaCommand;
    const child = spawn(cmd, [...spawnArgs, ...argv], { shell: false });
    runningProcesses.add(child);

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, RUN_TIMEOUT);

    const finish = () => {
      clearTimeout(timeout);
      runningProcesses.delete(child);
    };

    res.on("close", () => {
      if (!res.writableEnded) {
        finish();
        if (!child.killed) child.kill("SIGKILL");
      }
    });

    let stdoutBuf = "";
    let stderrBuf = "";
    let stderrRemainder = "";

    child.stdout.on("data", (d) => (stdoutBuf += d));
    child.stderr.on("data", (d) => {
      stderrBuf += d;
      stderrRemainder += d.toString();
      const lines = stderrRemainder.split("\n");
      stderrRemainder = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.rea_progress) {
            safeWrite(res, formatSse("progress", parsed.rea_progress));
          } else {
            safeWrite(res, formatSse("log", line));
          }
        } catch {
          safeWrite(res, formatSse("log", line));
        }
      }
    });

    child.on("error", (err) => {
      finish();
      safeWrite(res, formatSse("error", err.message));
      if (!res.writableEnded) res.end();
    });

    child.on("close", (code) => {
      finish();
      if (stderrRemainder.trim()) {
        safeWrite(res, formatSse("log", stderrRemainder));
      }
      let result;
      try {
        result = stdoutBuf
          ? JSON.parse(stdoutBuf)
          : { exitCode: code, stdout: "" };
      } catch {
        result = { exitCode: code, stdout: stdoutBuf };
      }
      safeWrite(res, formatSse("result", { exitCode: code, ...result }));
      if (!res.writableEnded) res.end();
    });
  });
}

async function serveStatic(req, res, publicDir, pathname) {
  let normalized = pathname === "/" ? "/index.html" : pathname;
  const safePath = resolve(publicDir, "." + normalized);
  if (safePath !== publicDir && !safePath.startsWith(publicDir + sep)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    let content = await readFile(safePath);
    if (normalized === "/index.html") {
      content = Buffer.from(
        content.toString("utf8").replaceAll("__REA_GUI_TOKEN__", guiToken),
        "utf8",
      );
    }
    const ext = extname(safePath);
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end(
      normalized === "/index.html" ? "index.html not found" : "Not found",
    );
  }
}

export async function startServer({
  port = 7700,
  reaCommand,
  open = true,
} = {}) {
  guiToken = randomBytes(16).toString("hex");
  reaCommand = reaCommand || (await resolveReaCommand());

  const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), "public");

  const server = createServer(async (req, res) => {
    if (!validateHost(req)) {
      res.writeHead(403);
      return res.end("Forbidden: Invalid Host header");
    }

    const url = new URL(req.url, "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/api/catalog") {
      return handleCatalog(req, res, reaCommand);
    }
    if (req.method === "GET" && url.pathname === "/api/doctor") {
      return handleDoctor(req, res, reaCommand);
    }
    if (req.method === "POST" && url.pathname === "/api/run") {
      return handleRun(req, res, reaCommand);
    }
    if (req.method === "GET") {
      return serveStatic(req, res, publicDir, url.pathname);
    }

    res.writeHead(404);
    res.end("Not found");
  });

  await new Promise((resolvePromise) =>
    server.listen(port, "127.0.0.1", resolvePromise),
  );

  actualPort = server.address().port;
  const origin = `http://127.0.0.1:${actualPort}`;
  console.log(`REA GUI server running at ${origin}/?token=${guiToken}`);

  if (open) {
    const opener =
      process.platform === "win32"
        ? "start"
        : process.platform === "darwin"
          ? "open"
          : "xdg-open";
    try {
      spawn(opener, [`${origin}/?token=${guiToken}`], {
        detached: true,
        stdio: "ignore",
      }).unref();
    } catch {}
  }

  return {
    url: origin,
    token: guiToken,
    port: actualPort,
    close: () =>
      new Promise((resolvePromise) => {
        for (const child of runningProcesses) {
          try {
            child.kill("SIGKILL");
          } catch {}
        }
        runningProcesses.clear();
        server.close(resolvePromise);
        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }
      }),
  };
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(
    `Usage: node server.mjs [--port 7700] [--rea <path>] [--no-open]`,
  );
  process.exit(0);
}

const portArg = args.indexOf("--port");
const port = portArg !== -1 ? parseInt(args[portArg + 1], 10) : 7700;
const reaArg = args.indexOf("--rea");
const reaPath = reaArg !== -1 ? args[reaArg + 1] : undefined;
const noOpen = args.includes("--no-open");

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  (async () => {
    try {
      const reaCommand = reaPath ? await resolveReaCommand(reaPath) : undefined;
      await startServer({ port, reaCommand, open: !noOpen });
    } catch (e) {
      console.error("Server failed:", e);
      process.exit(1);
    }
  })();
}
