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

> **Note:** With npm 11 you may see a warning that the frida package install script was not run (allowScripts); static analysis does not need Frida.

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

Static analysis that reads files without running them needs no native engine. Commands verified to exist (from `engine-free-verified.json`) with targets from the README analysis table:

| Target                                           | Command example                                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| JavaScript / Electron app (directory or `.asar`) | `rea analyze-javascript-application /absolute/path/to/app --format json`                      |
| .NET assembly (metadata, CIL)                    | `rea inspect-managed-artifact /absolute/path/Assembly.dll --format json`                      |
| Go binary (embedded build metadata)              | `rea inspect-go-binary /absolute/path/to/program --format json`                               |
| Rust binary (cargo-auditable deps)               | `rea inspect-rust-binary /absolute/path/to/program --format json`                             |
| WASM module                                      | `rea inspect-wasm-artifact /absolute/path/to/module.wasm --format json` (needs WABT 1.0.42)   |
| SQLite database                                  | `rea inspect-sqlite-database /absolute/path/to.db --format json` (Node.js 24.x ≥24.15 or 26+) |
| PE certificates                                  | `rea inspect-pe-certificates /absolute/path/to/bin --format json`                             |
| PE imports                                       | `rea inspect-pe-imports /absolute/path/to/bin --format json`                                  |
| ELF notes                                        | `rea inspect-elf-notes /absolute/path/to/bin --format json`                                   |
| Desktop application                              | `rea inspect-desktop-application /absolute/path/to/app --format json`                         |
| IL2CPP metadata                                  | `rea inspect-il2cpp-metadata /absolute/path/to/global-metadata.dat --format json`             |
| APK signature                                    | `rea inspect-apk-signature /absolute/path/to/app.apk --format json`                           |
| Flutter app                                      | `rea identify-flutter-build /absolute/path/to/app.apk --format json`                          |
| GPU code object                                  | `rea inspect-gpu-code-objects /absolute/path/to/bin --format json`                            |
| Model artifact (GGUF/safetensors)                | `rea inspect-model-artifact /absolute/path/to/model --format json`                            |
| Apple IPS crash                                  | `rea inspect-apple-ips /absolute/path/to.ips --format json`                                   |
| Linux kernel module                              | `rea inspect-kernel-module /absolute/path/to.ko --format json`                                |
| Erlang BEAM                                      | `rea inspect-erlang-beam /absolute/path/to/module.beam --format json`                         |

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
