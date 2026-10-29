import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert";
import { request as httpRequest } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveReaCommand,
  loadCatalog,
  categorize,
  buildArgv,
  classifyDoctor,
  ENGINE_FREE_COMMANDS,
} from "../lib.mjs";
import { MESSAGES, SUPPORTED, detectLang, translate } from "../public/i18n.js";
import { startServer } from "../server.mjs";

const LLMS_SAMPLE = JSON.stringify({
  version: "incur.v1",
  commands: [
    {
      name: "doctor",
      description: "Check environment health",
      schema: {
        args: { type: "object", properties: {}, additionalProperties: false },
        options: {
          type: "object",
          properties: {
            verbose: { type: "boolean", description: "Verbose output" },
            maxSemanticNodes: { type: "integer", description: "Max nodes" },
            evidence_output: { type: "string", description: "Output path" },
            tags: { type: "array", items: { type: "string" } },
          },
          additionalProperties: false,
        },
      },
    },
    {
      name: "analyze-javascript-application",
      description: "Analyze JS app",
      schema: {
        args: {
          type: "object",
          properties: { path: { type: "string", description: "App path" } },
          required: ["path"],
          additionalProperties: false,
        },
        options: {
          type: "object",
          properties: {
            snapshot: { type: "string", description: "Snapshot path" },
          },
          additionalProperties: false,
        },
      },
    },
    {
      name: "capabilities",
      description: "List capabilities",
    },
  ],
});

const DOCTOR_SAMPLE = {
  healthy: false,
  environment_healthy: false,
  scope_checks: [
    { name: "node", ok: true, classification: "healthy", detail: "20.0.0" },
    {
      name: "ghidra",
      ok: false,
      classification: "missing_analysis_engine",
      detail: "GHIDRA_INSTALL_DIR not set",
      remediation: "Set GHIDRA_INSTALL_DIR",
    },
    {
      name: "skill:identity",
      ok: false,
      classification: "config_drift",
      detail: "Skill missing",
      remediation: "Run rea setup",
    },
  ],
  providerInspections: [
    {
      id: "hopper",
      configured: false,
      reason: "Not installed",
      remediation: "Install Hopper",
    },
  ],
};

describe("i18n", () => {
  test("en and ko expose the same non-empty keys", () => {
    assert.deepStrictEqual(
      Object.keys(MESSAGES.ko).sort(),
      Object.keys(MESSAGES.en).sort(),
    );
    assert.deepStrictEqual(SUPPORTED, ["en", "ko"]);
    for (const lang of SUPPORTED)
      for (const [key, value] of Object.entries(MESSAGES[lang])) {
        assert.strictEqual(typeof value, "string", `${lang}.${key}`);
        assert.ok(value.trim().length > 0, `${lang}.${key} is empty`);
      }
  });

  test("detectLang prefers stored, then Korean navigator languages", () => {
    assert.strictEqual(detectLang("ko", []), "ko");
    assert.strictEqual(detectLang("en", ["ko-KR"]), "en");
    assert.strictEqual(detectLang("xx", ["ko-KR"]), "ko");
    assert.strictEqual(detectLang("xx", ["en-US"]), "en");
    assert.strictEqual(detectLang(undefined, ["en-US"]), "en");
    assert.strictEqual(detectLang(null, ["en-US", "ko-KR"]), "ko");
    assert.strictEqual(detectLang(null, []), "en");
  });

  test("translate falls back and replaces placeholders", () => {
    assert.strictEqual(translate("ko", "actions.run"), "실행");
    assert.strictEqual(translate("en", "actions.run"), "Run");
    assert.strictEqual(translate("fr", "actions.run"), "Run");
    assert.strictEqual(translate("ko", "missing.key"), "missing.key");
    assert.strictEqual(
      translate("en", "form.optional", { n: 3 }),
      "Optional settings (3)",
    );
    assert.strictEqual(
      translate("ko", "form.optional", { n: 3 }),
      "선택 설정 (3개)",
    );
    assert.strictEqual(
      translate("ko", "env.chipTitle", { name: "doctor" }),
      "doctor 열기",
    );
  });

  test("every t() key literal in app.js exists in MESSAGES.en", async () => {
    const source = await readFile(
      new URL("../public/app.js", import.meta.url),
      "utf8",
    );
    const keys = new Set();
    const pattern = /\bt\(\s*(["'])([^"'`]+)\1\s*[,)]/g;
    let match;
    while ((match = pattern.exec(source))) keys.add(match[2]);
    assert.ok(keys.size > 20, `found only ${keys.size} keys`);
    for (const key of keys)
      assert.ok(
        Object.prototype.hasOwnProperty.call(MESSAGES.en, key),
        `missing MESSAGES.en key: ${key}`,
      );
  });

  test("every static data-i18n key in index.html exists in MESSAGES.en", async () => {
    const source = await readFile(
      new URL("../public/index.html", import.meta.url),
      "utf8",
    );
    const keys = new Set();
    const pattern = /data-i18n(?:-placeholder|-aria)?="([^"]+)"/g;
    let match;
    while ((match = pattern.exec(source))) keys.add(match[1]);
    assert.ok(keys.size > 0);
    for (const key of keys)
      assert.ok(
        Object.prototype.hasOwnProperty.call(MESSAGES.en, key),
        `missing MESSAGES.en key: ${key}`,
      );
  });
});

describe("lib.mjs", () => {
  let catalog;
  let doctorCmd;
  let analyzeCmd;

  before(() => {
    catalog = loadCatalog(LLMS_SAMPLE);
    doctorCmd = catalog.commands.find((c) => c.name === "doctor");
    analyzeCmd = catalog.commands.find(
      (c) => c.name === "analyze-javascript-application",
    );
  });

  describe("buildArgv", () => {
    test("camelCase -> kebab-case", () => {
      const argv = buildArgv(
        "doctor",
        { options: { maxSemanticNodes: 100 } },
        doctorCmd,
      );
      assert.deepStrictEqual(argv, [
        "doctor",
        "--max-semantic-nodes",
        "100",
        "--format",
        "json",
      ]);
    });

    test("snake_case stays", () => {
      const argv = buildArgv(
        "doctor",
        { options: { evidence_output: "/tmp/out" } },
        doctorCmd,
      );
      assert.deepStrictEqual(argv, [
        "doctor",
        "--evidence_output",
        "/tmp/out",
        "--format",
        "json",
      ]);
    });

    test("boolean flag", () => {
      const argv = buildArgv(
        "doctor",
        { options: { verbose: true } },
        doctorCmd,
      );
      assert.deepStrictEqual(argv, ["doctor", "--verbose", "--format", "json"]);
      const argvFalse = buildArgv(
        "doctor",
        { options: { verbose: false } },
        doctorCmd,
      );
      assert.deepStrictEqual(argvFalse, ["doctor", "--format", "json"]);
    });

    test("omits options equal to their schema default", () => {
      const cmdInfo = {
        name: "inspect",
        args: [],
        options: [
          { name: "detail", schema: { type: "string", default: "complete" } },
          {
            name: "artifactFormat",
            schema: { type: "string", default: "auto" },
          },
        ],
      };
      assert.deepStrictEqual(
        buildArgv(
          "inspect",
          { options: { detail: "complete", artifactFormat: "auto" } },
          cmdInfo,
        ),
        ["inspect", "--format", "json"],
      );
      assert.deepStrictEqual(
        buildArgv("inspect", { options: { detail: "brief" } }, cmdInfo),
        ["inspect", "--detail", "brief", "--format", "json"],
      );
    });

    test("array repeats flag", () => {
      const argv = buildArgv(
        "doctor",
        { options: { tags: ["a", "b"] } },
        doctorCmd,
      );
      assert.deepStrictEqual(argv, [
        "doctor",
        "--tags",
        "a",
        "--tags",
        "b",
        "--format",
        "json",
      ]);
    });

    test("positional args in order", () => {
      const argv = buildArgv(
        "analyze-javascript-application",
        { args: { path: "/app" } },
        analyzeCmd,
      );
      assert.deepStrictEqual(argv, [
        "analyze-javascript-application",
        "/app",
        "--format",
        "json",
      ]);
    });

    test("rejects unknown option key", () => {
      assert.throws(
        () => buildArgv("doctor", { options: { unknown: "x" } }, doctorCmd),
        /Unknown option/,
      );
    });

    test("rejects unknown arg key", () => {
      assert.throws(
        () =>
          buildArgv(
            "analyze-javascript-application",
            { args: { unknown: "x" } },
            analyzeCmd,
          ),
        /Unknown arg/,
      );
    });

    test("always ends with --format json", () => {
      const argv = buildArgv(
        "capabilities",
        {},
        catalog.commands.find((c) => c.name === "capabilities"),
      );
      assert.deepStrictEqual(argv.slice(-2), ["--format", "json"]);
    });
  });

  describe("categorize", () => {
    test("Start here is only the exact entry-point commands", () => {
      assert.strictEqual(categorize("doctor"), "Start here");
      assert.strictEqual(categorize("capabilities"), "Start here");
      assert.strictEqual(categorize("analyze"), "Start here");
      assert.strictEqual(categorize("inspect"), "Start here");
      assert.notStrictEqual(categorize("analyze-something"), "Start here");
      assert.notStrictEqual(categorize("inspect-binary"), "Start here");
    });

    test("JavaScript & Electron", () => {
      assert.strictEqual(
        categorize("analyze-javascript-application"),
        "JavaScript & Electron",
      );
      assert.strictEqual(
        categorize("inspect-electron-app"),
        "JavaScript & Electron",
      );
      assert.strictEqual(categorize("decompile-asar"), "JavaScript & Electron");
      assert.strictEqual(
        categorize("analyze-web-bundle"),
        "JavaScript & Electron",
      );
    });

    test("Web & browser", () => {
      assert.strictEqual(categorize("analyze-web-app"), "Web & browser");
      assert.strictEqual(
        categorize("inspect-browser-extension"),
        "Web & browser",
      );
      assert.strictEqual(categorize("webmcp-something"), "Web & browser");
      assert.strictEqual(categorize("har-analyzer"), "Web & browser");
      assert.strictEqual(categorize("inspect-packet-capture"), "Web & browser");
      assert.strictEqual(categorize("inspect-pcap"), "Web & browser");
    });

    test("Native binaries", () => {
      assert.strictEqual(categorize("decompile-function"), "Native binaries");
      assert.strictEqual(categorize("ghidra-analyze"), "Native binaries");
      assert.strictEqual(categorize("ida-decompile"), "Native binaries");
      assert.strictEqual(categorize("hopper-something"), "Native binaries");
      assert.strictEqual(categorize("kuna-run"), "Native binaries");
      assert.strictEqual(
        categorize("address-to-file-offset"),
        "Native binaries",
      );
      assert.strictEqual(categorize("inspect-go-binary"), "Native binaries");
      assert.strictEqual(categorize("inspect-rust-binary"), "Native binaries");
      assert.strictEqual(categorize("inspect-pe-header"), "Native binaries");
      assert.strictEqual(categorize("inspect-macho"), "Native binaries");
    });

    test("Android", () => {
      assert.strictEqual(categorize("adb-pull"), "Android");
      assert.strictEqual(categorize("apk-analyze"), "Android");
      assert.strictEqual(categorize("jadx-decompile"), "Android");
    });

    test(".NET & managed", () => {
      assert.strictEqual(
        categorize("analyze-dotnet-assembly"),
        ".NET & managed",
      );
      assert.strictEqual(categorize("il2cpp-inspect"), ".NET & managed");
    });

    test("Evidence & compare", () => {
      assert.strictEqual(categorize("compare-evidence"), "Evidence & compare");
      assert.strictEqual(categorize("evidence-ledger"), "Evidence & compare");
    });

    test("Environments", () => {
      assert.strictEqual(categorize("environment-setup"), "Environments");
    });

    test("Other", () => {
      assert.strictEqual(categorize("random-command"), "Other");
      assert.strictEqual(categorize("inspect-sqlite-database"), "Other");
    });
  });

  describe("classifyDoctor", () => {
    test("categorizes correctly", () => {
      const result = classifyDoctor(DOCTOR_SAMPLE);
      assert.ok(result.ready.some((r) => r.name === "node"));
      assert.ok(result.needsEngine.some((n) => n.name === "ghidra"));
      assert.ok(result.needsEngine.some((n) => n.name === "hopper"));
      assert.ok(result.other.some((o) => o.name === "skill:identity"));
      assert.ok(Array.isArray(result.engineFree));
      assert.ok(result.engineFree.length > 0);
    });
  });

  describe("loadCatalog", () => {
    test("parses commands with schema", () => {
      const catalog = loadCatalog(LLMS_SAMPLE);
      assert.strictEqual(catalog.version, "incur.v1");
      assert.strictEqual(catalog.commands.length, 3);
      const doctor = catalog.commands.find((c) => c.name === "doctor");
      assert.ok(doctor);
      assert.strictEqual(doctor.options.length, 4);
      const analyze = catalog.commands.find(
        (c) => c.name === "analyze-javascript-application",
      );
      assert.ok(analyze);
      assert.strictEqual(analyze.args.length, 1);
      assert.strictEqual(analyze.args[0].required, true);
    });

    test("handles commands without schema", () => {
      const catalog = loadCatalog(LLMS_SAMPLE);
      const caps = catalog.commands.find((c) => c.name === "capabilities");
      assert.ok(caps);
      assert.strictEqual(caps.args.length, 0);
      assert.strictEqual(caps.options.length, 0);
    });
  });

  describe("resolveReaCommand", () => {
    test("uses provided path", async () => {
      const cmd = await resolveReaCommand("/custom/rea.mjs");
      assert.deepStrictEqual(cmd, [process.execPath, "/custom/rea.mjs"]);
    });

    test("uses env REA_GUI_REA_BIN", async () => {
      const previous = process.env.REA_GUI_REA_BIN;
      process.env.REA_GUI_REA_BIN = "/env/rea.mjs";
      try {
        const cmd = await resolveReaCommand();
        assert.deepStrictEqual(cmd, [process.execPath, "/env/rea.mjs"]);
      } finally {
        if (previous === undefined) {
          delete process.env.REA_GUI_REA_BIN;
        } else {
          process.env.REA_GUI_REA_BIN = previous;
        }
      }
    });

    test("finds the repo build when no path or env is provided", async () => {
      const previous = process.env.REA_GUI_REA_BIN;
      delete process.env.REA_GUI_REA_BIN;
      try {
        const cmd = await resolveReaCommand();
        const repoRoot = resolve(
          dirname(fileURLToPath(import.meta.url)),
          "../..",
        );
        assert.deepStrictEqual(cmd, [
          process.execPath,
          join(repoRoot, "scripts/rea.mjs"),
        ]);
      } finally {
        if (previous === undefined) {
          delete process.env.REA_GUI_REA_BIN;
        } else {
          process.env.REA_GUI_REA_BIN = previous;
        }
      }
    });
  });
});

function httpGetStatus(urlString, hostHeader) {
  return new Promise((resolvePromise, reject) => {
    const target = new URL(urlString);
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: "GET",
        headers: { Host: hostHeader },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolvePromise(res.statusCode));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("server.mjs integration", () => {
  let server;
  let reaCommand;

  before(async () => {
    reaCommand = await resolveReaCommand(process.env.REA_GUI_REA_BIN);
  });

  test("startServer returns origin, token, port and close", async () => {
    server = await startServer({ port: 0, reaCommand, open: false });
    assert.ok(server.url.startsWith("http://127.0.0.1:"));
    assert.ok(!server.url.includes("?"));
    assert.match(server.token, /^[0-9a-f]+$/);
    assert.strictEqual(Number(server.port), Number(new URL(server.url).port));
    assert.ok(typeof server.close === "function");
    await server.close();
  });

  test("startServer with open:true and a missing opener does not crash", async () => {
    const emptyPathDir = await mkdtemp(
      join(dirname(fileURLToPath(import.meta.url)), ".empty-path-"),
    );
    const previousPath = process.env.PATH;
    process.env.PATH = emptyPathDir;
    let localServer;
    try {
      localServer = await startServer({
        port: 0,
        reaCommand,
        open: true,
      });
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      const res = await fetch(new URL("/", localServer.url));
      assert.strictEqual(res.status, 200);
      await res.text();
    } finally {
      process.env.PATH = previousPath;
      if (localServer) await localServer.close();
      await rm(emptyPathDir, { recursive: true, force: true });
    }
  });

  test("GET / returns HTML with token replaced", async () => {
    server = await startServer({ port: 0, reaCommand, open: false });
    const res = await fetch(new URL("/", server.url));
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes("<html"));
    assert.ok(text.includes(server.token));
    assert.ok(!text.includes("__REA_GUI_TOKEN__"));
    await server.close();
  });

  test("GET /api/catalog has >100 commands", async () => {
    server = await startServer({ port: 0, reaCommand, open: false });
    const res = await fetch(new URL("/api/catalog", server.url));
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.commands.length > 100);
    await server.close();
  });

  test("engineFree names exist in the catalog", async () => {
    server = await startServer({ port: 0, reaCommand, open: false });
    const catalogRes = await fetch(new URL("/api/catalog", server.url));
    assert.strictEqual(catalogRes.status, 200);
    const catalog = await catalogRes.json();
    const names = new Set(catalog.commands.map((command) => command.name));

    const doctorRes = await fetch(new URL("/api/doctor", server.url));
    assert.strictEqual(doctorRes.status, 200);
    const doctor = await doctorRes.json();
    const engineFree = doctor.summary.engineFree;
    assert.ok(Array.isArray(engineFree));
    assert.ok(engineFree.length > 0);
    for (const name of engineFree) {
      assert.ok(names.has(name), `engineFree command missing: ${name}`);
    }
    for (const name of ENGINE_FREE_COMMANDS) {
      assert.ok(
        names.has(name),
        `engineFree source list command missing from catalog: ${name}`,
      );
    }
    await server.close();
  });

  test("Host header evil.example rejected", async () => {
    server = await startServer({ port: 0, reaCommand, open: false });
    const badStatus = await httpGetStatus(
      new URL("/api/catalog", server.url),
      "evil.example",
    );
    assert.strictEqual(badStatus, 403);

    const goodStatus = await httpGetStatus(
      new URL("/api/catalog", server.url),
      `127.0.0.1:${server.port}`,
    );
    assert.strictEqual(goodStatus, 200);
    await server.close();
  });

  test("POST /api/run without token -> 403", async () => {
    server = await startServer({ port: 0, reaCommand, open: false });
    const res = await fetch(new URL("/api/run", server.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "capabilities" }),
    });
    assert.strictEqual(res.status, 403);
    await server.close();
  });

  test("POST /api/run capabilities with token streams result exitCode 0", async () => {
    server = await startServer({ port: 0, reaCommand, open: false });

    const res = await fetch(new URL("/api/run", server.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-REA-GUI-Token": server.token,
      },
      body: JSON.stringify({ command: "capabilities", args: {}, options: {} }),
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get("content-type"), "text/event-stream");

    const reader = res.body.getReader();
    let resultEvent = null;
    while (!resultEvent) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = new TextDecoder().decode(value);
      for (const line of chunk.split("\n\n")) {
        if (line.startsWith("event: result")) {
          const dataLine = line.split("\n").find((l) => l.startsWith("data: "));
          if (dataLine) resultEvent = JSON.parse(dataLine.slice(6));
        }
      }
    }
    await reader.cancel();

    assert.ok(resultEvent, "No result event received");
    assert.strictEqual(resultEvent.exitCode, 0);
    await server.close();
  });
});
