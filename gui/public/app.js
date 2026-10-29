"use strict";
(function () {
  const meta = document.querySelector('meta[name="rea-gui-token"]');
  const metaValue = meta ? meta.getAttribute("content") : "";
  const TOKEN =
    metaValue && metaValue !== "__REA_GUI_TOKEN__"
      ? metaValue
      : new URLSearchParams(location.search).get("token") || "";
  const $ = (id) => document.getElementById(id);
  const CATEGORY_ORDER = [
    "Start here",
    "JavaScript & Electron",
    "Web & browser",
    "Native binaries",
    "Android",
    ".NET & managed",
    "Evidence & compare",
    "Environments",
    "Other",
  ];
  const state = {
    catalog: null,
    selected: null,
    fields: [],
    controller: null,
    doctorLoaded: false,
  };
  const openGroups = new Set(["Start here"]);
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function showBanner(message) {
    $("banner").textContent = message;
    $("banner").classList.remove("hidden");
  }
  function clearBanner() {
    $("banner").textContent = "";
    $("banner").classList.add("hidden");
  }
  async function requestJSON(url, options) {
    const res = await fetch(url, options);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok)
      throw new Error(
        (data && (data.error || data.message)) ||
          "Request failed (" + res.status + ")",
      );
    return data;
  }
  function schemaInfo(schema) {
    const properties = {};
    const required = [];
    if (!schema || typeof schema !== "object") return { properties, required };
    if (Array.isArray(schema)) {
      for (const field of schema) {
        if (!field || typeof field !== "object" || !field.name) continue;
        properties[field.name] =
          field.schema && typeof field.schema === "object"
            ? field.schema
            : field;
        if (field.required) required.push(field.name);
      }
      return { properties, required };
    }
    if (schema.properties && typeof schema.properties === "object") {
      return {
        properties: schema.properties,
        required: Array.isArray(schema.required) ? schema.required : [],
      };
    }
    for (const key of Object.keys(schema)) {
      const value = schema[key];
      if (
        value &&
        typeof value === "object" &&
        (value.type || value.enum || value.anyOf || value.items)
      )
        properties[key] = value;
    }
    return { properties, required };
  }
  function getChoices(prop) {
    if (Array.isArray(prop.enum)) return prop.enum;
    const parts = Array.isArray(prop.anyOf) ? prop.anyOf : [];
    const choices = [];
    for (const part of parts) {
      if (!part || typeof part !== "object") return [];
      if (Array.isArray(part.enum)) choices.push(...part.enum);
      else if (part.const !== undefined) choices.push(part.const);
      else return [];
    }
    return choices;
  }
  function propKind(prop) {
    if (!prop) return "string";
    if (Array.isArray(prop.enum)) return "enum";
    if (!prop.type && getChoices(prop).length) return "enum";
    if (prop.type === "boolean") return "boolean";
    if (prop.type === "integer" || prop.type === "number") return "number";
    return prop.type === "array" ? "array" : "string";
  }
  function flagName(key) {
    if (!key.includes("_") && !key.includes("-") && /[A-Z]/.test(key)) {
      return key.replace(/[A-Z]/g, (match) => "-" + match.toLowerCase());
    }
    return key;
  }
  function buildField(kind, key, prop, required) {
    const field = prop && typeof prop === "object" ? prop : {};
    const type = propKind(field);
    const row = el("div", "field");
    const id = "field-" + kind + "-" + key.replace(/[^A-Za-z0-9_-]/g, "-");
    const label = el(
      "label",
      "field-label",
      flagName(key) + (required ? " *" : ""),
    );
    label.setAttribute("for", id);
    if (required) label.title = "Required";
    row.appendChild(label);
    let input;
    if (type === "boolean") {
      const wrap = el("label", "check");
      input = el("input");
      input.type = "checkbox";
      if (field.default === true) input.checked = true;
      wrap.appendChild(input);
      wrap.appendChild(el("span", null, "Enable"));
      row.appendChild(wrap);
    } else if (type === "enum") {
      input = el("select");
      if (!required) {
        const none = el("option", null, "—");
        none.value = "";
        input.appendChild(none);
      }
      for (const choice of getChoices(field)) {
        const option = el("option", null, String(choice));
        option.value = String(choice);
        input.appendChild(option);
      }
      if (field.default !== undefined) input.value = String(field.default);
      row.appendChild(input);
    } else if (type === "array") {
      input = el("textarea");
      input.rows = 3;
      input.placeholder =
        field.default !== undefined
          ? String(field.default)
          : "One item per line";
      row.appendChild(input);
    } else {
      input = el("input");
      input.type = type === "number" ? "number" : "text";
      if (field.default !== undefined && field.default !== null)
        input.placeholder = String(field.default);
      if (type === "number" && field.minimum !== undefined)
        input.min = String(field.minimum);
      if (type === "number" && field.maximum !== undefined)
        input.max = String(field.maximum);
      row.appendChild(input);
    }
    input.id = id;
    if (field.description)
      row.appendChild(el("div", "help", field.description));
    const control = {
      kind,
      key,
      prop: field,
      input,
      required,
      getValue() {
        if (type === "boolean") return input.checked;
        const value = input.value.trim();
        if (type === "array")
          return value
            ? value
                .split(/\r?\n/)
                .map((item) => item.trim())
                .filter(Boolean)
            : [];
        if (type === "number") return value === "" ? "" : Number(value);
        return input.value;
      },
      isEmpty() {
        return type === "boolean" ? false : input.value.trim() === "";
      },
    };
    input.addEventListener("input", updatePreview);
    input.addEventListener("change", updatePreview);
    return { row, control };
  }
  function renderCommand(command) {
    state.selected = command;
    $("cmd-name").textContent = command.name;
    $("cmd-desc").textContent = command.description || "";
    const form = $("run-form");
    form.textContent = "";
    state.fields = [];
    const args = schemaInfo(
      command.args || (command.schema && command.schema.args),
    );
    const options = schemaInfo(
      command.options || (command.schema && command.schema.options),
    );
    const argNames = Object.keys(args.properties);
    const optionNames = Object.keys(options.properties).filter(
      (key) => flagName(key) !== "format",
    );
    if (!argNames.length && !optionNames.length)
      form.appendChild(el("p", "placeholder", "This command takes no inputs."));
    for (const [kind, names, info, title] of [
      ["arg", argNames, args, "Arguments"],
      ["option", optionNames, options, "Options"],
    ]) {
      if (!names.length) continue;
      form.appendChild(el("h2", "form-section", title));
      for (const key of names) {
        const built = buildField(
          kind,
          key,
          info.properties[key],
          info.required.includes(key),
        );
        form.appendChild(built.row);
        state.fields.push(built.control);
      }
    }
    $("empty").classList.add("hidden");
    $("command-view").classList.remove("hidden");
    resetOutput();
    clearBanner();
    updatePreview();
  }
  function quote(value) {
    const text = String(value);
    return /[^\w@%+=:,./-]/.test(text) ? JSON.stringify(text) : text;
  }
  function updatePreview() {
    if (!state.selected) return;
    const parts = ["rea", state.selected.name];
    for (const field of state.fields) {
      const value = field.getValue();
      if (field.kind === "arg") {
        if (
          value === "" ||
          value === false ||
          (Array.isArray(value) && !value.length)
        )
          continue;
        parts.push(quote(value));
        continue;
      }
      const flag = "--" + flagName(field.key);
      if (typeof value === "boolean") {
        if (value) parts.push(flag);
      } else if (Array.isArray(value)) {
        for (const item of value) parts.push(flag, quote(item));
      } else if (value !== "") parts.push(flag, quote(value));
    }
    parts.push("--format", "json");
    $("preview").textContent = parts.join(" ");
  }
  function collectBody() {
    const args = {};
    const options = {};
    for (const field of state.fields) {
      const target = field.kind === "arg" ? args : options;
      if (field.kind === "option" && propKind(field.prop) === "boolean")
        target[field.key] = Boolean(field.getValue());
      else if (!field.isEmpty()) target[field.key] = field.getValue();
    }
    return { command: state.selected.name, args, options };
  }
  function setRunning(running) {
    $("run-btn").disabled = running;
    $("stop-btn").disabled = !running;
    if (running) $("run-status").textContent = "Running…";
  }
  function resetOutput() {
    $("progress").textContent = "";
    $("result").textContent = "";
    $("exit-code").textContent = "";
    $("exit-code").classList.remove("bad");
    $("result-wrap").classList.add("hidden");
    $("run-status").textContent = "";
  }
  function addProgress(message, isLog, meta) {
    const list = $("progress");
    const item = el("li", isLog ? "log" : "progress-item");
    if (meta && meta.phase)
      item.appendChild(el("span", "phase", String(meta.phase)));
    item.appendChild(el("span", "msg", String(message)));
    if (meta && typeof meta.total === "number") {
      item.appendChild(
        el(
          "span",
          "count",
          String(Number(meta.completed) || 0) + "/" + String(meta.total),
        ),
      );
    }
    list.appendChild(item);
    while (list.children.length > 200) list.removeChild(list.firstChild);
    list.scrollTop = list.scrollHeight;
    $("run-status").textContent = String(message);
  }
  function showResult(data) {
    const payload = data && typeof data === "object" ? data : { stdout: data };
    const exit = $("exit-code");
    exit.textContent =
      payload.exitCode === undefined ? "" : "exit " + String(payload.exitCode);
    exit.classList.toggle(
      "bad",
      payload.exitCode !== undefined && payload.exitCode !== 0,
    );
    let output = payload.stdout !== undefined ? payload.stdout : payload.result;
    if (output === undefined) {
      const extra = { ...payload };
      delete extra.exitCode;
      output = Object.keys(extra).length ? extra : "";
    }
    if (typeof output === "string") {
      try {
        output = JSON.parse(output);
      } catch {
        /* keep text */
      }
    }
    let text;
    if (typeof output === "string") text = output;
    else if (output === undefined || output === null) text = "";
    else {
      try {
        text = JSON.stringify(output, null, 2);
      } catch {
        text = String(output);
      }
    }
    $("result").textContent = text;
    $("result-wrap").classList.remove("hidden");
  }
  function handleEventBlock(block) {
    let event = "message";
    const dataLines = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:"))
        dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (!dataLines.length) return;
    const raw = dataLines.join("\n");
    let data = raw;
    try {
      data = JSON.parse(raw);
    } catch {
      /* keep raw */
    }
    if (
      event === "message" &&
      data &&
      typeof data === "object" &&
      typeof data.type === "string"
    )
      event = data.type;
    if (event === "progress") {
      const info =
        data && data.rea_progress
          ? data.rea_progress
          : data && typeof data === "object"
            ? data
            : null;
      addProgress(info && info.message ? info.message : raw, false, info);
    } else if (event === "log") {
      addProgress(typeof data === "string" ? data : raw, true, null);
    } else if (event === "result") {
      showResult(data);
      $("run-status").textContent = "";
    } else if (event === "error") {
      showBanner(
        String(
          data && (data.error || data.message)
            ? data.error || data.message
            : raw,
        ),
      );
    }
  }
  async function readStream(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replace(
        /\r\n/g,
        "\n",
      );
      let index;
      while ((index = buffer.indexOf("\n\n")) !== -1) {
        handleEventBlock(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleEventBlock(buffer);
  }
  async function runCommand() {
    if (!state.selected || state.controller) return;
    clearBanner();
    for (const field of state.fields) {
      if (field.required && field.isEmpty()) {
        showBanner(
          "Required value missing: " +
            (field.kind === "arg" ? field.key : "--" + flagName(field.key)),
        );
        if (field.input.focus) field.input.focus();
        return;
      }
    }
    const body = collectBody();
    state.controller = new AbortController();
    resetOutput();
    setRunning(true);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
          "X-REA-GUI-Token": TOKEN,
        },
        signal: state.controller.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        let message = "Request failed (" + res.status + ")";
        try {
          const parsed = JSON.parse(text);
          message = parsed.error || parsed.message || message;
        } catch {
          /* keep */
        }
        throw new Error(message);
      }
      if (!res.body)
        throw new Error("This browser cannot read streaming responses.");
      await readStream(res.body);
    } catch (err) {
      if (err && err.name === "AbortError") addProgress("Stopped", true, null);
      else showBanner(err && err.message ? err.message : String(err));
    } finally {
      state.controller = null;
      setRunning(false);
    }
  }

  async function copyResult() {
    const button = $("copy-btn");
    try {
      await navigator.clipboard.writeText($("result").textContent || "");
      button.textContent = "Copied!";
    } catch {
      button.textContent = "Copy failed";
    }
    setTimeout(() => {
      button.textContent = "Copy";
    }, 1400);
  }

  function renderSidebar() {
    const list = $("command-list");
    list.textContent = "";
    if (!state.catalog) return;
    const query = $("search").value.trim().toLowerCase();
    const groups = new Map();
    for (const command of state.catalog.commands || []) {
      if (
        query &&
        !(command.name + " " + (command.description || ""))
          .toLowerCase()
          .includes(query)
      )
        continue;
      const category = command.category || "Other";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(command);
    }
    if (!groups.size) {
      list.appendChild(el("div", "placeholder", "No matching commands"));
      return;
    }
    const categories = [...groups.keys()].sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a),
        ib = CATEGORY_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    for (const category of categories) {
      const details = el("details", "group");
      if (query || openGroups.has(category)) details.open = true;
      const summary = el("summary", "group-title");
      summary.appendChild(el("span", null, category));
      summary.appendChild(
        el("span", "count", String(groups.get(category).length)),
      );
      details.appendChild(summary);
      details.addEventListener("toggle", () => {
        if (query) return;
        if (details.open) openGroups.add(category);
        else openGroups.delete(category);
      });
      const items = el("div", "group-items");
      for (const command of groups.get(category)) {
        const button = el("button", "cmd", command.name);
        button.type = "button";
        button.title = command.description || "";
        if (state.selected && state.selected.name === command.name)
          button.classList.add("active");
        button.addEventListener("click", () => {
          for (const active of list.querySelectorAll(".cmd.active"))
            active.classList.remove("active");
          button.classList.add("active");
          renderCommand(command);
        });
        items.appendChild(button);
      }
      details.appendChild(items);
      list.appendChild(details);
    }
  }

  async function loadCatalog() {
    try {
      state.catalog = await requestJSON("/api/catalog");
      const version = state.catalog && state.catalog.reaVersion;
      $("rea-version").textContent = version ? "rea " + version : "";
      renderSidebar();
    } catch (err) {
      $("empty").textContent = "Could not load commands.";
      showBanner(
        "Could not load the rea catalog: " +
          (err.message || err) +
          ". Make sure rea is installed, or start the server with --rea <path>.",
      );
    }
  }

  function doctorLabel(item) {
    if (item && typeof item === "object")
      return item.name || item.label || item.id || "";
    return item === undefined || item === null ? "" : String(item);
  }
  function doctorDetail(item) {
    return item && typeof item === "object"
      ? item.detail || item.description || ""
      : "";
  }
  function itemSection(title, cls, items, withRemediation) {
    const section = el("section", "doctor-section" + (cls ? " " + cls : ""));
    section.appendChild(el("h2", null, title));
    if (!items.length) return section;
    const list = el("ul", "doctor-list");
    for (const item of items) {
      const entry = el("li");
      entry.appendChild(el("div", "doctor-name", doctorLabel(item)));
      const detail = doctorDetail(item);
      if (detail) entry.appendChild(el("div", "doctor-detail", detail));
      const fix =
        withRemediation && item && typeof item === "object"
          ? item.remediation
          : "";
      if (fix) {
        const fixRow = el("div", "doctor-fix");
        fixRow.appendChild(el("strong", null, "Fix: "));
        fixRow.appendChild(document.createTextNode(String(fix)));
        entry.appendChild(fixRow);
      }
      list.appendChild(entry);
    }
    section.appendChild(list);
    return section;
  }
  function renderDoctor(summary) {
    const root = $("doctor");
    root.textContent = "";
    const ready = Array.isArray(summary.ready) ? summary.ready : [];
    const needs = Array.isArray(summary.needsEngine) ? summary.needsEngine : [];
    const other = Array.isArray(summary.other) ? summary.other : [];
    const engineFree = Array.isArray(summary.engineFree)
      ? summary.engineFree
      : [];
    const readySection = itemSection(
      "Works now (no engine)",
      "ready",
      ready,
      false,
    );
    if (engineFree.length) {
      readySection.appendChild(
        el("div", "doctor-fix", "Engine-free commands:"),
      );
      const chips = el("div", "chips");
      for (const label of engineFree)
        chips.appendChild(el("span", "chip", String(label)));
      readySection.appendChild(chips);
    } else if (!ready.length) {
      readySection.appendChild(
        el("p", "doctor-detail", "No engine-free capabilities were reported."),
      );
    }
    root.appendChild(readySection);
    const needsSection = itemSection("Needs an engine", "needs", needs, true);
    if (!needs.length)
      needsSection.appendChild(
        el("p", "doctor-detail", "No missing engines were reported."),
      );
    root.appendChild(needsSection);
    if (other.length)
      root.appendChild(itemSection("Other checks", "", other, true));
  }

  async function loadDoctor() {
    const root = $("doctor");
    root.textContent = "";
    root.appendChild(el("div", "placeholder", "Checking environment…"));
    try {
      const data = await requestJSON("/api/doctor");
      state.doctorLoaded = true;
      renderDoctor((data && data.summary) || {});
    } catch (err) {
      root.textContent = "";
      root.appendChild(
        el(
          "div",
          "placeholder",
          "Doctor check failed: " + (err.message || err),
        ),
      );
    }
  }

  function setView(view) {
    const isEnv = view === "env";
    $("tab-commands").classList.toggle("active", !isEnv);
    $("tab-env").classList.toggle("active", isEnv);
    $("tab-commands").setAttribute("aria-selected", String(!isEnv));
    $("tab-env").setAttribute("aria-selected", String(isEnv));
    $("view-commands").classList.toggle("hidden", isEnv);
    $("view-env").classList.toggle("hidden", !isEnv);
    $("sidebar").classList.toggle("hidden", isEnv);
    if (isEnv && !state.doctorLoaded) loadDoctor();
  }

  function init() {
    $("tab-commands").addEventListener("click", () => setView("commands"));
    $("tab-env").addEventListener("click", () => setView("env"));
    $("search").addEventListener("input", renderSidebar);
    $("run-btn").addEventListener("click", runCommand);
    $("stop-btn").addEventListener("click", () => {
      if (state.controller) state.controller.abort();
    });
    $("refresh-doctor").addEventListener("click", loadDoctor);
    $("copy-btn").addEventListener("click", copyResult);
    $("run-form").addEventListener("submit", (event) => {
      event.preventDefault();
      runCommand();
    });
    loadCatalog();
  }

  init();
})();
