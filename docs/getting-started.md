# First steps

A short beginner path from zero to a working REA setup.

## 1) Install REA

**Requirements:** Node.js `^22.23.4 || ^24.22.1 || >=26.12.1` and npm.

Quick one-off (no global install):

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

Global CLI install:

```bash
npm install --global rea-agents
rea --help
```

> **Note:** `npm install --global rea-agents` may print a warning that frida's install script was not run under `npm allowScripts`. This comes from an optional transitive dependency and does not affect REA.

## 2) Run `rea doctor` and read the output

```bash
rea doctor --json
```

Typical output on a machine with no native engines:

```json
{
  "healthy": false,
  "scope_checks": [
    {
      "name": "node",
      "ok": true,
      "classification": "healthy",
      "detail": "24.22.1"
    },
    {
      "name": "host",
      "ok": true,
      "classification": "healthy",
      "detail": "debian 13"
    },
    {
      "name": "hopper",
      "ok": false,
      "classification": "missing_analysis_engine",
      "remediation": "Run rea setup to install Hopper, or set HOPPER_LAUNCHER_PATH."
    },
    {
      "name": "ghidra",
      "ok": false,
      "classification": "missing_analysis_engine",
      "detail": "GHIDRA_INSTALL_DIR is not set",
      "remediation": "Set GHIDRA_INSTALL_DIR to an extracted Ghidra 12.1.x release directory."
    },
    {
      "name": "ida-registration",
      "ok": false,
      "classification": "missing_analysis_engine",
      "detail": "IDA MCP registration is not configured.",
      "remediation": "Set REA_IDA_MCP_CONFIG to your upstream IDA MCP registration JSON; see docs/ida-provider.md."
    },
    {
      "name": "jadx",
      "ok": false,
      "classification": "missing_analysis_engine",
      "detail": "Set REA_JADX_MCP_JAR to the absolute path of a caller-supplied jadx-headless-mcp 0.7.1 JAR. REA does not download or install it.",
      "remediation": "Set REA_JADX_MCP_JAR to the absolute path of a caller-supplied jadx-headless-mcp 0.7.1 JAR. REA does not download or install it."
    },
    {
      "name": "kuna-installation",
      "ok": false,
      "classification": "missing_analysis_engine",
      "detail": "Set REA_KUNA_COMMAND to the absolute path of a caller-supplied kuna executable (verified with 1.833). REA does not download, install or update Kuna.",
      "remediation": "Set REA_KUNA_COMMAND to the absolute path of a caller-supplied kuna executable (verified with 1.833). REA does not download, install or update Kuna."
    }
  ]
}
```

**How to read it:**

| Field                                       | Meaning                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `healthy: false`                            | Normal when no deep-analysis engines are configured. Your engine-free workflows still work. |
| `classification: "missing_analysis_engine"` | The engine is not installed or not configured. Follow the `remediation` line.               |
| `classification: "config_drift"`            | A skill or agent registration is missing or outdated. Run `rea setup` to fix.               |
| `remediation`                               | Exact next step: env var to set, or `rea setup` to run.                                     |

The GUI Environment tab shows the same data grouped as **Works now (no engine)**, **Needs an engine**, and **Other checks**.

## 3) What works with no engine

Static analysis that reads files without running them needs no native engine. From the README table:

| Target                                           | Command example                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| JavaScript / Electron app (directory or `.asar`) | `rea analyze-javascript-application /absolute/path/to/app --format json` |
| .NET assembly (metadata, CIL)                    | `rea analyze-dotnet-assembly /absolute/path/Assembly.dll --format json`  |
| Go binary (embedded build metadata)              | `rea analyze-go-binary /absolute/path/to/program --format json`          |
| Rust binary (cargo-auditable deps)               | `rea analyze-rust-binary /absolute/path/to/program --format json`        |
| WASM module                                      | `rea analyze-wasm-module /absolute/path/to/module.wasm --format json`    |
| SQLite database                                  | `rea inspect-sqlite-database /absolute/path/to.db --format json`         |
| PE/ELF/Mach-O/DOL headers                        | `rea inspect-pe /absolute/path/to/bin --format json`                     |
| Decompile function (engine-free fallback)        | `rea decompile-function /absolute/path/to/bin 0x1000 --format json`      |
| Compare evidence / ledger / reconstruct / trace  | `rea compare-evidence left.json right.json --format json`                |

**Copy-paste example:**

```bash
rea analyze-javascript-application /absolute/path/to/app --format json
```

Replace the path with your extracted Electron app directory or `.asar` file (e.g., `"D:/apps/example"` on Windows).

## 4) Add a deep-analysis engine

When you need pseudocode, assembly, or Android APK decompilation, configure one provider. The `rea doctor --json` remediation lines give the exact env vars:

| Engine  | Env var                | Value                                                            | Guide                                           |
| ------- | ---------------------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| Ghidra  | `GHIDRA_INSTALL_DIR`   | Extracted Ghidra 12.1.x release directory                        | [Ghidra provider](ghidra-provider.md)           |
| IDA Pro | `REA_IDA_MCP_CONFIG`   | Your upstream IDA MCP registration JSON                          | [IDA provider](ida-provider.md)                 |
| JADX    | `REA_JADX_MCP_JAR`     | Absolute path to `jadx-headless-mcp-0.7.1.jar`                   | [Android guide](android-analysis.md)            |
| Kuna    | `REA_KUNA_COMMAND`     | Absolute path to `kuna` executable (verified 1.833)              | [Kuna provider](kuna-provider.md)               |
| Hopper  | `HOPPER_LAUNCHER_PATH` | Absolute path to Hopper launcher (or run `rea setup` to install) | [Installation — Hopper](installation.md#hopper) |

Set the variable in the shell that starts REA (CLI, MCP, or GUI), then verify:

```bash
export GHIDRA_INSTALL_DIR=/opt/ghidra_12.1_PUBLIC
rea doctor --provider ghidra --json
```

## 5) Connect an agent

Register REA's MCP server and install the matching workflow skill:

```bash
npx rea-agents setup
```

- Select your agents (Claude Code, Codex, Cursor, Gemini CLI, etc.)
- Review the proposed changes and approve
- Restart the agents named in the completion message

For a specific client non-interactively:

```bash
rea setup --client codex --client cursor --yes --json
```

## 6) Try the local GUI

A browser-based command explorer with live forms, progress, and JSON results.

→ [Local GUI](gui.md)
