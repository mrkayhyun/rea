import { access, constants } from "node:fs/promises";
import { delimiter, dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

async function findWindowsRea() {
  const pathEntries = (process.env.PATH || process.env.Path || "").split(
    delimiter,
  );
  for (const entry of pathEntries) {
    if (!entry) continue;
    const cmdPath = join(entry, "rea.cmd");
    const scriptPath = join(
      entry,
      "node_modules",
      "rea-agents",
      "scripts",
      "rea.mjs",
    );
    try {
      await access(cmdPath, constants.F_OK);
      await access(scriptPath, constants.F_OK);
      return [process.execPath, scriptPath];
    } catch {}
  }
  return null;
}

export function camelToKebab(str) {
  return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

export async function resolveReaCommand(providedPath) {
  if (providedPath) {
    const isJs = providedPath.endsWith(".js") || providedPath.endsWith(".mjs");
    return isJs ? [process.execPath, providedPath] : [providedPath];
  }

  const envPath = process.env.REA_GUI_REA_BIN;
  if (envPath) {
    const isJs = envPath.endsWith(".js") || envPath.endsWith(".mjs");
    return isJs ? [process.execPath, envPath] : [envPath];
  }

  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = resolve(dirname(__filename), "..");
  const scriptsRea = join(repoRoot, "scripts/rea.mjs");
  const distDir = join(repoRoot, "dist");

  try {
    await access(scriptsRea, constants.F_OK);
    await access(distDir, constants.F_OK);
    return [process.execPath, scriptsRea];
  } catch {}

  if (process.platform === "win32") {
    const windowsRea = await findWindowsRea();
    if (windowsRea) return windowsRea;
    throw new Error(
      "Could not find the rea CLI on Windows. Pass --rea <path to rea.mjs> to point the GUI at your installation.",
    );
  }
  return ["rea"];
}

export function loadCatalog(rawJson) {
  const data = JSON.parse(rawJson);
  const commands = (data.commands || []).map((cmd) => {
    const argsSchema = cmd.schema?.args;
    const optionsSchema = cmd.schema?.options;
    const args = argsSchema?.properties
      ? Object.keys(argsSchema.properties)
      : [];
    const requiredArgs = argsSchema?.required || [];
    const options = optionsSchema?.properties
      ? Object.keys(optionsSchema.properties)
      : [];
    return {
      name: cmd.name,
      description: cmd.description || "",
      args: args.map((key) => ({
        name: key,
        required: requiredArgs.includes(key),
        schema: argsSchema.properties[key],
      })),
      options: options.map((key) => ({
        name: key,
        schema: optionsSchema.properties[key],
      })),
    };
  });
  return { version: data.version || "unknown", commands };
}

export function categorize(name) {
  const lower = name.toLowerCase();
  if (
    lower === "doctor" ||
    lower === "capabilities" ||
    lower === "analyze" ||
    lower === "inspect"
  ) {
    return "Start here";
  }
  if (
    lower.includes("javascript") ||
    lower.includes("electron") ||
    lower.includes("asar") ||
    lower.includes("web-bundle")
  ) {
    return "JavaScript & Electron";
  }
  if (
    lower.includes("web") ||
    lower.includes("browser") ||
    lower.includes("webmcp") ||
    lower.includes("har") ||
    lower.includes("packet") ||
    lower.includes("pcap")
  ) {
    return "Web & browser";
  }
  if (
    lower.includes("adb") ||
    lower.includes("apk") ||
    lower.includes("android") ||
    lower.includes("jadx") ||
    lower.includes("jeb") ||
    lower.includes("dex")
  ) {
    return "Android";
  }
  if (
    lower.includes("managed") ||
    lower.includes("dotnet") ||
    lower.includes("il2cpp")
  ) {
    return ".NET & managed";
  }
  if (
    lower.includes("compare") ||
    lower.includes("evidence") ||
    lower.includes("ledger") ||
    lower.includes("reconstruction") ||
    lower.includes("trace")
  ) {
    return "Evidence & compare";
  }
  if (lower.includes("environment")) {
    return "Environments";
  }
  if (
    lower.includes("native") ||
    lower.includes("binary") ||
    lower.includes("decompile") ||
    lower.includes("function") ||
    lower.includes("ghidra") ||
    lower.includes("ida") ||
    lower.includes("hopper") ||
    lower.includes("kuna") ||
    lower.includes("rizin") ||
    lower.includes("cutter") ||
    lower.includes("gdb") ||
    lower.includes("elf") ||
    lower.startsWith("pe-") ||
    lower.startsWith("inspect-pe") ||
    lower.includes("macho") ||
    lower.includes("dol") ||
    lower.includes("address")
  ) {
    return "Native binaries";
  }
  return "Other";
}

function matchesDefault(value, schema) {
  if (!schema || schema.default === undefined) return false;
  const defaultValue = schema.default;
  if (Array.isArray(defaultValue)) {
    if (!Array.isArray(value) || value.length !== defaultValue.length) {
      return false;
    }
    return value.every(
      (item, index) => String(item) === String(defaultValue[index]),
    );
  }
  if (typeof defaultValue === "boolean") return value === defaultValue;
  return String(value) === String(defaultValue);
}

export function buildArgv(command, values = {}, cmdInfo = null) {
  const argv = [command];
  const args = values.args || {};
  const options = values.options || {};

  if (cmdInfo) {
    const knownArgs = new Set(cmdInfo.args.map((a) => a.name));
    const knownOptions = new Set(cmdInfo.options.map((o) => o.name));

    for (const key of Object.keys(args)) {
      if (!knownArgs.has(key)) {
        throw new Error(`Unknown arg: ${key}`);
      }
    }
    for (const key of Object.keys(options)) {
      if (!knownOptions.has(key)) {
        throw new Error(`Unknown option: ${key}`);
      }
    }
  }

  for (const key of Object.keys(args)) {
    const val = args[key];
    if (val !== undefined && val !== null && val !== "") {
      argv.push(String(val));
    }
  }

  for (const key of Object.keys(options)) {
    const val = options[key];
    if (val === undefined || val === null) continue;

    if (cmdInfo) {
      const optionInfo = cmdInfo.options.find((o) => o.name === key);
      if (optionInfo && matchesDefault(val, optionInfo.schema)) continue;
    }

    const flag = camelToKebab(key);

    if (typeof val === "boolean") {
      if (val) argv.push(`--${flag}`);
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (item !== undefined && item !== null && item !== "") {
          argv.push(`--${flag}`, String(item));
        }
      }
    } else {
      argv.push(`--${flag}`, String(val));
    }
  }

  argv.push("--format", "json");
  return argv;
}

export function classifyDoctor(doctorJson) {
  const data =
    typeof doctorJson === "string" ? JSON.parse(doctorJson) : doctorJson;
  const scopeChecks = data.scope_checks || [];
  const providerInspections = data.providerInspections || [];

  const ready = [];
  const needsEngine = [];
  const other = [];
  const engineFree = [
    "analyze-javascript-application",
    "inspect-sqlite-database",
    "capabilities",
    "doctor",
    "analyze-dotnet-assembly",
    "analyze-go-binary",
    "analyze-rust-binary",
    "analyze-wasm-module",
    "inspect-pe",
    "inspect-elf",
    "inspect-macho",
    "inspect-dol",
    "decompile-function",
    "address-to-file-offset",
    "compare-evidence",
    "evidence-ledger",
    "reconstruct-control-flow",
    "trace-execution",
  ];

  for (const check of scopeChecks) {
    if (check.ok && check.classification === "healthy") {
      ready.push({ name: check.name, detail: check.detail });
    } else if (check.classification === "missing_analysis_engine") {
      needsEngine.push({
        name: check.name,
        detail: check.detail,
        remediation: check.remediation,
      });
    } else {
      other.push({
        name: check.name,
        classification: check.classification,
        detail: check.detail,
      });
    }
  }

  for (const provider of providerInspections) {
    if (!provider.configured && provider.reason) {
      needsEngine.push({
        name: provider.id,
        detail: provider.reason,
        remediation: provider.remediation,
      });
    }
  }

  return { ready, needsEngine, other, engineFree };
}
