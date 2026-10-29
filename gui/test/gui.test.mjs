import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert";
import { request as httpRequest } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveReaCommand,
  loadCatalog,
  categorize,
  buildArgv,
  classifyDoctor,
} from "../lib.mjs";
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
