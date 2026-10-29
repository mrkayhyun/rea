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

## 한국어 사용법 (Korean)

- **시작하기**: 저장소 체크아웃에서 `node gui/server.mjs`를 실행한 뒤 출력된 `http://127.0.0.1:7700/` 주소를 엽니다. 전역 설치를 사용한다면 `node gui/server.mjs --rea "$(npm root -g)/rea-agents/scripts/rea.mjs"`로 실행합니다.
- **언어 전환**: 상단 바의 `EN | 한국어` 세그먼트 컨트롤을 누르면 새로고침 없이 모든 UI 문구가 즉시 바뀝니다. 현재 선택한 명령과 입력값은 그대로 유지되며, 선택한 언어는 `localStorage`의 `rea-gui-lang` 키에 저장됩니다. 저장된 값이 없으면 브라우저 언어가 한국어일 때 한국어로 시작합니다.
- **환경 탭**: `rea doctor --format json` 결과를 보여줍니다. **엔진 없이 바로 사용 가능**에는 지금 바로 실행할 수 있는 명령 칩이, **엔진 필요**에는 누락된 엔진과 상세 설명 및 **해결 방법**이, **기타 점검**에는 구성 드리프트 같은 나머지 항목이 표시됩니다. **새로고침**으로 다시 확인할 수 있습니다.

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
node --test gui/test/gui.test.mjs
```

(Tests use the same `startServer` export and exercise catalog, doctor, and run endpoints.)
