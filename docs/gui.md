# Local GUI

An unofficial, fork-only browser interface for exploring REA commands and running them with live feedback. Not bundled with the npm package; run from a repository checkout.

## What it is

- A local HTTP server (`gui/server.mjs`) serving a single-page app (`gui/public/`)
- Loads the REA command catalog via `--llms-full --format json`
- Groups commands by category with search
- Auto-generates forms from each command's JSON schema
- Shows a live command preview, Run/Stop, streaming progress, and JSON result with copy
- Environment tab runs `rea doctor --format json` and renders the classified summary
- **No shell**, **no custom commands** — only catalog-validated commands run
- Binds `127.0.0.1` only; validates `Host` header (`127.0.0.1:<port>` or `localhost:<port>`); per-session random token

## Requirements

- Node.js `^22.23.4 || ^24.22.1 || >=26.12.1`
- A built REA checkout (`npm ci && npm run build`) or a global `rea-agents` install
- Linux/macOS (Windows untested)

## Start the GUI

**From a built repository checkout:**

```bash
npm ci && npm run build
node gui/server.mjs
```

**With a global `rea-agents` install:**

```bash
node gui/server.mjs --rea "$(npm root -g)/rea-agents/scripts/rea.mjs"
```

**Flags:**

| Flag        | Default     | Description                          |
| ----------- | ----------- | ------------------------------------ |
| `--port`    | `7700`      | TCP port to bind on `127.0.0.1`      |
| `--rea`     | auto-detect | Path to `rea.mjs` or `rea` binary    |
| `--no-open` | false       | Don't open the browser automatically |

**Environment variable:**

- `REA_GUI_REA_BIN` — alternative to `--rea`; same path format

The server prints the local URL:

```
REA GUI server running at http://127.0.0.1:7700/
```

## Three screens

### 1. Commands (default tab)

- **Left sidebar**: searchable command list grouped by category (`Start here`, `JavaScript & Electron`, `Native binaries`, `Android`, `.NET & managed`, `Evidence & compare`, `Environments`, `Web & browser`, `Other`)
- Click a command to open the form on the right
- Categories remember open/closed state

### 2. Command form

- **Auto-generated fields** from the command's JSON schema (args + options, excluding `--format`)
- Input types: text, number, boolean (checkbox), enum (select), array (textarea, one per line)
- Required fields marked with `*`
- **Command preview**: live `rea ... --format json` command line updates as you type
- **Run / Stop**: starts/stops the command via SSE stream
- **Progress**: streaming log/progress lines from stderr (REA progress events parsed)
- **Result**: JSON output with copy button, exit code badge

### 3. Environment tab

- Runs `rea doctor --format json` on demand (Refresh button)
- Renders the classified summary:
  - **Works now (no engine)**: healthy checks + engine-free command chips
  - **Needs an engine**: each missing engine with detail and remediation (Fix: …)
  - **Other checks**: config drift, registration issues, etc.

## Security model

- Binds **only `127.0.0.1`** (never `0.0.0.0`)
- Validates `Host` header: must be `127.0.0.1:<port>` or `localhost:<port>`
- Random token (16-byte hex) generated on every server start, embedded in the served page, and sent only in the `X-REA-GUI-Token` header on POST
- Token changes on every server restart
- `spawn` with `shell: false` — no shell injection
- Command allow-list: only commands from `rea --llms-full --format json` can run
- Only arg/option **names** checked against catalog keys; values are not schema-validated
- Max **2 concurrent runs**; each killed after **10 minutes** (SIGKILL)

## Limitations

- **No engine bundled** — native analysis (Ghidra, Hopper, IDA, Kuna, JADX) requires separate installation and config
- **Windows untested** — process supervision, launcher discovery, and Hopper demo mode may not work
- **Long outputs** shown as JSON text (no paging or structured viewers beyond copy)
- Single-user, local-only; no authentication beyond the per-session token
- No persistence: catalog is cached server-side until restart; only doctor is re-fetched on refresh

## Troubleshooting

| Symptom                                            | Fix                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| `rea not found` / "Could not load the rea catalog" | Start with `--rea /absolute/path/to/rea.mjs` or set `REA_GUI_REA_BIN`          |
| Port 7700 busy                                     | Use `--port 7701` (or any free port)                                           |
| Browser doesn't open                               | Use `--no-open` and paste the printed URL manually                             |
| "Invalid Host header"                              | Access via `http://127.0.0.1:<port>/` or `http://localhost:<port>/` not LAN IP |
| "Invalid token"                                    | Restart the server; token changes every restart                                |
| Command fails with "Unknown arg/option"            | The catalog may be stale; restart the server after `rea update`                |
| Native command hangs / times out                   | Engine not configured; check Environment tab for remediation                   |

## Run the GUI tests

```bash
node --test gui/test/
```

(Tests use the same `startServer` export and exercise catalog, doctor, and run endpoints.)
