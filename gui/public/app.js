import { SUPPORTED, detectLang, translate } from "./i18n.js";

(() => {
  function t(key, vars) {
    return translate(state.lang, key, vars);
  }
  function fillStaticStrings() {
    document.documentElement.lang = state.lang;
    document.title = t("app.title");
    for (let node of document.querySelectorAll("[data-i18n]"))
      node.textContent = t(node.getAttribute("data-i18n"));
    for (const node of document.querySelectorAll("[data-i18n-placeholder]"))
      node.placeholder = t(node.getAttribute("data-i18n-placeholder"));
    for (const node of document.querySelectorAll("[data-i18n-aria]"))
      node.setAttribute("aria-label", t(node.getAttribute("data-i18n-aria")));
  }
  const meta = document.querySelector('meta[name="rea-gui-token"]');
  const metaValue = meta ? meta.getAttribute("content") : "";
  const TOKEN =
    metaValue && "__REA_GUI_TOKEN__" !== metaValue
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
  const CATEGORY_ICONS = {
    "Start here": "★",
    "JavaScript & Electron": "🟨",
    "Web & browser": "🌐",
    "Native binaries": "⚙",
    Android: "🤖",
    ".NET & managed": "⬢",
    "Evidence & compare": "🔍",
    Environments: "🖥",
    Other: "▧",
  };
  const THEME_KEY = "rea-gui-theme";
  const LANG_KEY = "rea-gui-lang";
  function readStoredLang() {
    try {
      return localStorage.getItem(LANG_KEY);
    } catch {
      return null;
    }
  }
  const NAVIGATOR_LANGUAGES =
    Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language || ""];
  const state = {
    lang: detectLang(readStoredLang(), NAVIGATOR_LANGUAGES),
    catalog: null,
    catalogError: null,
    reaVersion: "",
    selected: null,
    fields: [],
    controller: null,
    doctor: null,
    doctorLoaded: false,
    doctorLoading: false,
    doctorError: null,
    engineFree: new Set(),
    lastStep: null,
    resultText: "",
    lastPayload: null,
    gotResult: false,
    bannerKey: null,
    bannerVars: null,
  };
  const openGroups = new Set(["Start here"]);
  function el(tag, className, text) {
    const node = document.createElement(tag);
    className && (node.className = className);
    void 0 !== text && (node.textContent = text);
    return node;
  }
  function setBannerText(message) {
    $("banner").textContent = message;
    $("banner").classList.remove("hidden");
  }
  function showBanner(message) {
    state.bannerKey = null;
    state.bannerVars = null;
    setBannerText(message);
  }
  function showBannerKey(key, vars) {
    setBannerText(t(key, vars));
    state.bannerKey = key;
    state.bannerVars = vars || null;
  }
  function clearBanner() {
    state.bannerKey = null;
    state.bannerVars = null;
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
    if (res.ok) return data;
    throw new Error(
      (data && (data.error || data.message)) ||
        t("error.request", {
          status: res.status,
        }),
    );
  }
  function systemPrefersDark() {
    return Boolean(
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    );
  }
  function readThemePref() {
    try {
      const value = localStorage.getItem(THEME_KEY);
      return "light" === value || "dark" === value ? value : "system";
    } catch {
      return "system";
    }
  }
  function applyTheme(pref) {
    const resolved =
      "light" === pref || "dark" === pref
        ? pref
        : systemPrefersDark()
          ? "dark"
          : "light";
    document.documentElement.setAttribute("data-theme", resolved);
    document.documentElement.style.colorScheme = resolved;
    const button = $("theme-btn");
    if (button) {
      button.textContent = "dark" === resolved ? "☀" : "☾";
      const label = t(
        "theme." + ("light" === pref || "dark" === pref ? pref : "system"),
      );
      button.title = label;
      button.setAttribute("aria-label", label);
    }
  }
  function cycleTheme() {
    const order = ["system", "light", "dark"];
    const next = order[(order.indexOf(readThemePref()) + 1) % order.length];
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
    applyTheme(next);
  }
  function schemaInfo(schema) {
    const properties = {};
    const required = [];
    if (schema && "object" == typeof schema)
      if (Array.isArray(schema)) {
        for (let field of schema)
          if (field && "object" == typeof field && field.name) {
            properties[field.name] =
              field.schema && "object" == typeof field.schema
                ? field.schema
                : field;
            field.required && required.push(field.name);
          }
      } else {
        if (schema.properties && "object" == typeof schema.properties)
          return {
            properties: schema.properties,
            required: Array.isArray(schema.required) ? schema.required : [],
          };
        for (let key of Object.keys(schema)) {
          const value = schema[key];
          value &&
            "object" == typeof value &&
            (value.type || value.enum || value.anyOf || value.items) &&
            (properties[key] = value);
        }
      }
    return {
      properties: properties,
      required: required,
    };
  }
  function getChoices(prop) {
    if (Array.isArray(prop.enum)) return prop.enum;
    const parts = Array.isArray(prop.anyOf) ? prop.anyOf : [];
    const choices = [];
    for (let part of parts) {
      if (!part || "object" != typeof part) return [];
      if (Array.isArray(part.enum)) choices.push(...part.enum);
      else {
        if (void 0 === part.const) return [];
        choices.push(part.const);
      }
    }
    return choices;
  }
  function propKind(prop) {
    return prop
      ? Array.isArray(prop.enum) || (!prop.type && getChoices(prop).length)
        ? "enum"
        : "boolean" === prop.type
          ? "boolean"
          : "integer" === prop.type || "number" === prop.type
            ? "number"
            : "array" === prop.type
              ? "array"
              : "string"
      : "string";
  }
  function flagName(key) {
    return key.includes("_") || key.includes("-") || !/[A-Z]/.test(key)
      ? key
      : key.replace(/[A-Z]/g, (match) => "-" + match.toLowerCase());
  }
  function buildField(kind, key, prop, required) {
    const field = prop && "object" == typeof prop ? prop : {};
    const type = propKind(field);
    const row = el("div", "field");
    const id = "field-" + kind + "-" + key.replace(/[^A-Za-z0-9_-]/g, "-");
    const head = el("div", "field-head");
    const label = el("label", "field-label", flagName(key));
    label.setAttribute("for", id);
    head.appendChild(label);
    required &&
      head.appendChild(el("span", "badge required", t("form.required")));
    row.appendChild(head);
    let input;
    if ("boolean" === type) {
      const wrap = el("label", "switch");
      input = el("input");
      input.type = "checkbox";
      true === field.default && (input.checked = true);
      const track = el("span", "track");
      track.appendChild(el("span", "thumb"));
      wrap.appendChild(input);
      wrap.appendChild(track);
      wrap.appendChild(el("span", "switch-label", t("form.enable")));
      row.appendChild(wrap);
    } else {
      if ("enum" === type) {
        input = el("select");
        if (!required) {
          const none = el("option", null, t("form.noneOption"));
          none.value = "";
          input.appendChild(none);
        }
        for (let choice of getChoices(field)) {
          const option = el("option", null, String(choice));
          option.value = String(choice);
          input.appendChild(option);
        }
        void 0 !== field.default && (input.value = String(field.default));
      } else if ("array" === type) {
        input = el("textarea");
        input.rows = 3;
        input.placeholder =
          void 0 !== field.default
            ? String(field.default)
            : t("form.onePerLine");
      } else {
        input = el("input");
        input.type = "number" === type ? "number" : "text";
        null != field.default && (input.placeholder = String(field.default));
        "number" === type &&
          void 0 !== field.minimum &&
          (input.min = String(field.minimum));
        "number" === type &&
          void 0 !== field.maximum &&
          (input.max = String(field.maximum));
      }
      row.appendChild(input);
    }
    input.id = id;
    field.description && row.appendChild(el("div", "help", field.description));
    const control = {
      kind: kind,
      key: key,
      prop: field,
      input: input,
      required: required,
      getValue() {
        if ("boolean" === type) return input.checked;
        const value = input.value.trim();
        return "array" === type
          ? value
            ? value
                .split(/\r?\n/)
                .map((item) => item.trim())
                .filter(Boolean)
            : []
          : "number" === type
            ? "" === value
              ? ""
              : Number(value)
            : input.value;
      },
      isEmpty() {
        return "boolean" !== type && "" === input.value.trim();
      },
      isChanged() {
        if ("boolean" === type)
          return input.checked !== (true === field.default);
        const value = input.value.trim();
        if ("" === value) return false;
        if ("array" === type) {
          const defaults = Array.isArray(field.default)
            ? field.default.map(String)
            : [];
          const items = value
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean);
          return JSON.stringify(items) !== JSON.stringify(defaults);
        }
        const defaultValue = null == field.default ? "" : String(field.default);
        return value !== defaultValue;
      },
    };
    input.addEventListener("input", updatePreview);
    input.addEventListener("change", updatePreview);
    return {
      row: row,
      control: control,
    };
  }
  function makeFormCard(titleKey, required) {
    const card = el("section", "card form-card");
    const head = el("div", "card-head");
    head.appendChild(el("h2", null, t(titleKey)));
    required &&
      head.appendChild(el("span", "badge required", t("form.required")));
    card.appendChild(head);
    const body = el("div", "card-body");
    card.appendChild(body);
    return {
      card: card,
      body: body,
    };
  }
  function renderCommandChips(command) {
    const box = $("cmd-chips");
    box.textContent = "";
    const category = command.category || "Other";
    box.appendChild(el("span", "chip category-chip", t("cat." + category)));
    state.engineFree.has(command.name) &&
      box.appendChild(el("span", "chip engine-chip", t("chip.engineFree")));
  }
  function snapshotFieldValues() {
    const snapshot = new Map();
    for (const field of state.fields)
      snapshot.set(field.kind + ":" + field.key, {
        value: field.input.value,
        checked: Boolean(field.input.checked),
      });
    return snapshot;
  }
  function restoreFieldValues(snapshot) {
    for (const field of state.fields) {
      const saved = snapshot.get(field.kind + ":" + field.key);
      if (!saved) continue;
      if ("checkbox" === field.input.type) field.input.checked = saved.checked;
      else field.input.value = saved.value;
    }
  }
  function renderCommand(command, renderOptions) {
    const opts = renderOptions || {};
    const snapshot = opts.preserveValues ? snapshotFieldValues() : null;
    state.selected = command;
    $("cmd-name").textContent = command.name;
    $("cmd-desc").textContent = command.description || "";
    renderCommandChips(command);
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
      (key) => "format" !== flagName(key),
    );
    if (!argNames.length && !optionNames.length) {
      const empty = makeFormCard("form.arguments", false);
      empty.body.appendChild(el("p", "placeholder", t("form.none")));
      form.appendChild(empty.card);
    }
    if (argNames.length) {
      const requiredArgs = args.required.filter((name) =>
        argNames.includes(name),
      );
      const section = makeFormCard("form.arguments", 0 < requiredArgs.length);
      for (let key of argNames) {
        const built = buildField(
          "arg",
          key,
          args.properties[key],
          requiredArgs.includes(key),
        );
        section.body.appendChild(built.row);
        state.fields.push(built.control);
      }
      form.appendChild(section.card);
    }
    if (optionNames.length) {
      const requiredOptions = optionNames.filter((key) =>
        options.required.includes(key),
      );
      const optionalOptions = optionNames.filter(
        (key) => !options.required.includes(key),
      );
      const section = makeFormCard("form.options", 0 < requiredOptions.length);
      for (const key of requiredOptions) {
        const built = buildField("option", key, options.properties[key], true);
        section.body.appendChild(built.row);
        state.fields.push(built.control);
      }
      if (optionalOptions.length) {
        const details = el("details", "optional");
        details.appendChild(
          el(
            "summary",
            "optional-summary",
            t("form.optional", {
              n: optionalOptions.length,
            }),
          ),
        );
        const inner = el("div", "optional-body");
        for (const key of optionalOptions) {
          const built = buildField(
            "option",
            key,
            options.properties[key],
            false,
          );
          inner.appendChild(built.row);
          state.fields.push(built.control);
        }
        details.appendChild(inner);
        section.body.appendChild(details);
      }
      form.appendChild(section.card);
    }
    if (snapshot) restoreFieldValues(snapshot);
    $("empty").classList.add("hidden");
    $("command-view").classList.remove("hidden");
    if (false !== opts.resetOutput) {
      resetOutput();
      clearBanner();
    }
    updatePreview();
  }
  function quote(value) {
    const text = String(value);
    return /[^\w@%+=:,./-]/.test(text) ? JSON.stringify(text) : text;
  }
  function updatePreview() {
    if (state.selected) {
      const parts = ["rea", state.selected.name];
      for (let field of state.fields) {
        const value = field.getValue();
        if ("arg" === field.kind)
          "" === value ||
            false === value ||
            (Array.isArray(value) && !value.length) ||
            parts.push(quote(value));
        else {
          const flag = "--" + flagName(field.key);
          if (field.isChanged())
            if ("boolean" == typeof value) value && parts.push(flag);
            else if (Array.isArray(value))
              for (let item of value) parts.push(flag, quote(item));
            else "" !== value && parts.push(flag, quote(value));
        }
      }
      parts.push("--format", "json");
      $("preview").textContent = parts.join(" ");
    }
  }
  function collectBody() {
    const args = {};
    const options = {};
    for (let field of state.fields) {
      const target = "arg" === field.kind ? args : options;
      "option" === field.kind && "boolean" === propKind(field.prop)
        ? field.isChanged() && (target[field.key] = Boolean(field.getValue()))
        : "option" === field.kind
          ? field.isChanged() && (target[field.key] = field.getValue())
          : field.isEmpty() || (target[field.key] = field.getValue());
    }
    return {
      command: state.selected.name,
      args: args,
      options: options,
    };
  }
  function setRunning(running) {
    $("run-btn").disabled = running;
    $("stop-btn").disabled = !running;
    if (running) {
      $("run-status").textContent = t("status.running");
      setProgress(0, null, true);
    }
  }
  function setProgress(completed, total, indeterminate) {
    const bar = $("progress-bar");
    const fill = $("progress-fill");
    bar.classList.toggle("indeterminate", Boolean(indeterminate));
    if (indeterminate) $("progress-label").textContent = "";
    else if ("number" == typeof total && 0 < total) {
      fill.style.width =
        Math.min(100, Math.round((completed / total) * 100)) + "%";
      $("progress-label").textContent = String(completed) + "/" + String(total);
    } else {
      fill.style.width = completed ? "100%" : "0%";
      $("progress-label").textContent = "";
    }
  }
  function resetOutput() {
    $("progress").textContent = "";
    const result = $("result");
    result.textContent = "";
    result.className = "result";
    state.lastStep = null;
    state.resultText = "";
    state.lastPayload = null;
    state.gotResult = false;
    $("result-wrap").classList.add("hidden");
    const exit = $("exit-code");
    exit.textContent = "";
    exit.className = "exit-badge hidden";
    $("run-status").textContent = "";
    setProgress(0, null, false);
  }
  function markDone() {
    if (state.lastStep) {
      state.lastStep.classList.remove("current");
      state.lastStep.classList.add("done");
      state.lastStep = null;
    }
  }
  function addProgress(message, isLog, meta) {
    const list = $("progress");
    const item = el("li", isLog ? "log" : "step current");
    isLog || item.appendChild(el("span", "step-icon"));
    meta &&
      meta.phase &&
      item.appendChild(el("span", "phase", String(meta.phase)));
    item.appendChild(el("span", "msg", String(message)));
    meta &&
      "number" == typeof meta.total &&
      item.appendChild(
        el(
          "span",
          "count",
          String(Number(meta.completed) || 0) + "/" + String(meta.total),
        ),
      );
    if (!isLog) {
      markDone();
      state.lastStep = item;
    }
    list.appendChild(item);
    for (; 300 < list.children.length;) list.removeChild(list.firstChild);
    list.scrollTop = list.scrollHeight;
    $("run-status").textContent = String(message);
    isLog ||
      (meta && "number" == typeof meta.total && 0 < Number(meta.total)
        ? setProgress(Number(meta.completed) || 0, Number(meta.total), false)
        : setProgress(0, null, true));
  }
  function finishProgress() {
    markDone();
    setProgress(1, null, false);
  }
  function jsonBranch(key, value) {
    const isArray = Array.isArray(value);
    const entries = isArray
      ? value.map((item, index) => [String(index), item])
      : Object.entries(value);
    const details = el("details", "json-branch");
    const summary = el("summary", "json-summary");
    if (null != key) {
      summary.appendChild(el("span", "json-key", String(key)));
      summary.appendChild(el("span", "json-punct", ": "));
    }
    summary.appendChild(
      el("span", "json-type", isArray ? t("json.array") : t("json.object")),
    );
    summary.appendChild(
      el(
        "span",
        "json-meta",
        isArray
          ? t("json.items", {
              n: entries.length,
            })
          : t("json.keys", {
              n: entries.length,
            }),
      ),
    );
    details.appendChild(summary);
    let built = false;
    details._build = function () {
      if (!built) {
        built = true;
        const children = el("div", "json-children");
        for (let [childKey, childValue] of entries)
          children.appendChild(jsonValue(childKey, childValue));
        details.appendChild(children);
      }
    };
    details.addEventListener("toggle", () => {
      details.open && details._build();
    });
    return details;
  }
  function jsonValue(key, value) {
    if (null !== value && "object" == typeof value)
      return jsonBranch(key, value);
    const row = el("div", "json-leaf");
    row.appendChild(el("span", "json-key", String(key)));
    row.appendChild(el("span", "json-punct", ": "));
    let cls = "json-null";
    let text = "null";
    if ("string" == typeof value) {
      cls = "json-string";
      text = JSON.stringify(value);
    } else if ("number" == typeof value) {
      cls = "json-number";
      text = String(value);
    } else if ("boolean" == typeof value) {
      cls = "json-boolean";
      text = String(value);
    } else if (null != value) {
      cls = "json-string";
      text = JSON.stringify(String(value));
    }
    row.appendChild(el("span", "json-value " + cls, text));
    return row;
  }
  function showResult(data) {
    const payload =
      data && "object" == typeof data
        ? data
        : {
            stdout: data,
          };
    const exit = $("exit-code");
    if (void 0 === payload.exitCode) {
      exit.textContent = "";
      exit.className = "exit-badge hidden";
    } else {
      const code = Number(payload.exitCode);
      exit.textContent = t("result.exit", { code: String(payload.exitCode) });
      exit.className = "exit-badge " + (0 === code ? "ok" : "bad");
    }
    let output = void 0 !== payload.stdout ? payload.stdout : payload.result;
    if (void 0 === output) {
      const extra = {
        ...payload,
      };
      delete extra.exitCode;
      output = Object.keys(extra).length ? extra : "";
    }
    if ("string" == typeof output)
      try {
        output = JSON.parse(output);
      } catch {}
    let text;
    if ("string" == typeof output) text = output;
    else if (null == output) text = "";
    else
      try {
        text = JSON.stringify(output, null, 2);
      } catch {
        text = String(output);
      }
    state.resultText = text;
    state.lastPayload = payload;
    state.gotResult = true;
    const result = $("result");
    result.textContent = "";
    result.className = "result";
    if (null !== output && "object" == typeof output) {
      result.classList.add("json-tree");
      const root = jsonBranch(null, output);
      root.open = true;
      root._build();
      result.appendChild(root);
    } else {
      result.classList.add("plain");
      result.textContent = text;
    }
    $("result-wrap").classList.remove("hidden");
    finishProgress();
  }
  function setAllBranches(open) {
    const result = $("result");
    if (open) {
      let previous = -1;
      for (let guard = 0; guard < 100; guard++) {
        const branches = result.querySelectorAll("details.json-branch");
        for (const branch of branches) {
          branch._build();
          branch.open = true;
        }
        if (branches.length === previous) break;
        previous = branches.length;
      }
    } else
      for (let branch of result.querySelectorAll("details.json-branch"))
        branch.open = false;
  }
  async function copyText(text, button, defaultKey) {
    try {
      await navigator.clipboard.writeText(text || "");
      button.textContent = t("common.copied");
    } catch {
      button.textContent = t("common.copyFailed");
    }
    setTimeout(() => {
      button.textContent = t(defaultKey);
    }, 1400);
  }
  function handleEventBlock(block) {
    let event = "message";
    const dataLines = [];
    for (let line of block.split("\n"))
      line.startsWith("event:")
        ? (event = line.slice(6).trim())
        : line.startsWith("data:") &&
          dataLines.push(line.slice(5).replace(/^ /, ""));
    if (dataLines.length) {
      const raw = dataLines.join("\n");
      let data = raw;
      try {
        data = JSON.parse(raw);
      } catch {}
      "message" === event &&
        data &&
        "object" == typeof data &&
        "string" == typeof data.type &&
        (event = data.type);
      if ("progress" === event) {
        const info =
          data && data.rea_progress
            ? data.rea_progress
            : data && "object" == typeof data
              ? data
              : null;
        addProgress(info && info.message ? info.message : raw, false, info);
      } else if ("log" === event)
        addProgress("string" == typeof data ? data : raw, true, null);
      else if ("result" === event) {
        showResult(data);
        $("run-status").textContent = "";
      } else
        "error" === event &&
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
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer = (
        buffer +
        decoder.decode(chunk.value, {
          stream: true,
        })
      ).replace(/\r\n/g, "\n");
      let index;
      for (; -1 !== (index = buffer.indexOf("\n\n"));) {
        handleEventBlock(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
      }
    }
    buffer += decoder.decode();
    buffer.trim() && handleEventBlock(buffer);
  }
  async function runCommand() {
    if (state.selected && !state.controller) {
      clearBanner();
      for (let field of state.fields)
        if (field.required && field.isEmpty()) {
          showBannerKey("error.requiredMissing", {
            name: "arg" === field.kind ? field.key : "--" + flagName(field.key),
          });
          field.input.focus && field.input.focus();
          return;
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
          let message = t("error.request", {
            status: res.status,
          });
          try {
            const parsed = JSON.parse(text);
            message = parsed.error || parsed.message || message;
          } catch {}
          throw new Error(message);
        }
        if (!res.body) throw new Error(t("error.noStream"));
        await readStream(res.body);
      } catch (err) {
        err && "AbortError" === err.name
          ? addProgress(t("status.stopped"), true, null)
          : showBanner(err && err.message ? err.message : String(err));
      } finally {
        state.controller = null;
        setRunning(false);
        markDone();
        state.gotResult || setProgress(1, null, false);
      }
    }
  }
  function selectCommand(command) {
    renderCommand(command);
    for (let button of document.querySelectorAll("#command-list .cmd"))
      button.classList.toggle(
        "active",
        Boolean(state.selected) && button.textContent === state.selected.name,
      );
  }
  function renderSidebar() {
    const list = $("command-list");
    list.textContent = "";
    if (state.catalog) {
      const query = $("search").value.trim().toLowerCase();
      const groups = new Map();
      for (let command of state.catalog.commands || [])
        if (
          !query ||
          (command.name + " " + (command.description || ""))
            .toLowerCase()
            .includes(query)
        ) {
          const category = command.category || "Other";
          groups.has(category) || groups.set(category, []);
          groups.get(category).push(command);
        }
      if (groups.size) {
        const categories = [...groups.keys()].sort((a, b) => {
          const ia = CATEGORY_ORDER.indexOf(a);
          const ib = CATEGORY_ORDER.indexOf(b);
          return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
        });
        for (const category of categories) {
          const details = el("details", "group");
          (query || openGroups.has(category)) && (details.open = true);
          const summary = el("summary", "group-title");
          summary.appendChild(
            el("span", "group-icon", CATEGORY_ICONS[category] || "•"),
          );
          summary.appendChild(el("span", "group-name", t("cat." + category)));
          summary.appendChild(
            el("span", "count", String(groups.get(category).length)),
          );
          details.appendChild(summary);
          details.addEventListener("toggle", () => {
            query ||
              (details.open
                ? openGroups.add(category)
                : openGroups.delete(category));
          });
          const items = el("div", "group-items");
          for (const command of groups.get(category)) {
            const button = el("button", "cmd", command.name);
            button.type = "button";
            button.title = command.description || "";
            state.selected &&
              state.selected.name === command.name &&
              button.classList.add("active");
            button.addEventListener("click", () => selectCommand(command));
            items.appendChild(button);
          }
          details.appendChild(items);
          list.appendChild(details);
        }
      } else list.appendChild(el("div", "placeholder", t("sidebar.noMatch")));
    }
  }
  function quickLink(title, subtitle, target) {
    const button = el("button", "quick-link");
    button.type = "button";
    button.appendChild(el("span", "ql-title", title));
    button.appendChild(el("span", "ql-sub", subtitle));
    button.addEventListener("click", () => {
      if ("environment" === target) setView("env");
      else {
        const command = ((state.catalog && state.catalog.commands) || []).find(
          (item) => item.name === target,
        );
        if (command) {
          setView("commands");
          selectCommand(command);
        } else showBannerKey("error.unknownCommand");
      }
    });
    return button;
  }
  function renderEmpty() {
    const root = $("empty");
    root.textContent = "";
    const card = el("section", "card welcome");
    card.appendChild(el("div", "welcome-mark", "REA"));
    card.appendChild(el("h1", null, t("empty.title")));
    card.appendChild(el("p", "desc", t("empty.body")));
    const links = el("div", "quick-links");
    links.appendChild(
      quickLink(t("empty.env"), t("empty.envDesc"), "environment"),
    );
    links.appendChild(
      quickLink(
        "analyze-javascript-application",
        t("empty.analyzeDesc"),
        "analyze-javascript-application",
      ),
    );
    links.appendChild(quickLink("doctor", t("empty.doctorDesc"), "doctor"));
    card.appendChild(links);
    root.appendChild(card);
  }
  function renderVersion() {
    $("rea-version").textContent = state.reaVersion
      ? t("version.label", { version: state.reaVersion })
      : "";
  }
  function renderCatalogError() {
    $("empty").textContent = "";
    $("empty").appendChild(el("div", "placeholder", t("error.catalog")));
  }
  async function loadCatalog() {
    try {
      state.catalog = await requestJSON("/api/catalog");
      state.catalogError = null;
      state.reaVersion = (state.catalog && state.catalog.reaVersion) || "";
      renderVersion();
      renderEmpty();
      renderSidebar();
      state.doctorLoaded && renderDoctor(state.doctor);
    } catch (err) {
      state.catalogError = err;
      renderCatalogError();
      showBannerKey("error.catalogDetail", {
        error: err && err.message ? err.message : String(err),
      });
    }
  }
  function statCard(labelKey, value, tone) {
    const card = el("div", "stat-card card " + tone);
    card.appendChild(el("div", "stat-value", String(value)));
    card.appendChild(el("div", "stat-label", t(labelKey)));
    return card;
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
    const stats = el("div", "stat-row");
    stats.appendChild(statCard("env.ready", ready.length, "green"));
    stats.appendChild(statCard("env.needs", needs.length, "amber"));
    stats.appendChild(statCard("env.other", other.length, "gray"));
    root.appendChild(stats);
    const works = el("section", "env-card card ready");
    works.appendChild(el("h2", null, t("env.worksNow")));
    if (engineFree.length) {
      works.appendChild(el("div", "env-sub", t("env.engineFree")));
      const chips = el("div", "chips");
      const commands = (state.catalog && state.catalog.commands) || [];
      for (let label of engineFree) {
        const name = String(label);
        const command = commands.find((item) => item.name === name);
        if (command) {
          const button = el("button", "chip chip-button", name);
          button.type = "button";
          button.title = t("env.chipTitle", {
            name: name,
          });
          button.addEventListener("click", () => {
            setView("commands");
            selectCommand(command);
          });
          chips.appendChild(button);
        } else chips.appendChild(el("span", "chip", name));
      }
      works.appendChild(chips);
    } else works.appendChild(el("p", "env-empty", t("env.noReady")));
    root.appendChild(works);
    if (needs.length) {
      const grid = el("div", "env-card-grid");
      for (let item of needs) {
        const card = el("section", "env-card card needs");
        card.appendChild(el("h2", null, item.name || ""));
        const detail = item.detail ? String(item.detail) : "";
        const remediation = item.remediation ? String(item.remediation) : "";
        detail &&
          detail !== remediation &&
          card.appendChild(el("p", "env-detail", detail));
        if (remediation) {
          card.appendChild(el("div", "env-sub", t("env.fix")));
          card.appendChild(el("pre", "fix-box", remediation));
        }
        grid.appendChild(card);
      }
      root.appendChild(grid);
    } else {
      const card = el("section", "env-card card needs");
      card.appendChild(el("h2", null, t("env.needsEngine")));
      card.appendChild(el("p", "env-empty", t("env.noNeeds")));
      root.appendChild(card);
    }
    const otherCard = el("section", "env-card card neutral");
    otherCard.appendChild(el("h2", null, t("env.otherChecks")));
    if (other.length) {
      const list = el("ul", "env-list");
      for (const item of other) {
        const li = el("li");
        li.appendChild(el("div", "env-item-name", item.name || ""));
        item.detail &&
          li.appendChild(el("div", "env-detail", String(item.detail)));
        list.appendChild(li);
      }
      otherCard.appendChild(list);
    } else otherCard.appendChild(el("p", "env-empty", t("env.noOther")));
    root.appendChild(otherCard);
  }
  function renderDoctorLoading() {
    const root = $("doctor");
    root.textContent = "";
    root.appendChild(el("div", "placeholder", t("env.loading")));
  }
  function renderDoctorError() {
    const root = $("doctor");
    root.textContent = "";
    const err = state.doctorError;
    root.appendChild(
      el(
        "div",
        "placeholder",
        t("env.failed", {
          error: err && err.message ? err.message : String(err),
        }),
      ),
    );
  }
  async function loadDoctor() {
    if (!state.doctorLoading) {
      state.doctorLoading = true;
      state.doctorError = null;
      renderDoctorLoading();
      try {
        const data = await requestJSON("/api/doctor");
        state.doctor = (data && data.summary) || {};
        state.doctorLoaded = true;
        state.doctorError = null;
        const list = Array.isArray(state.doctor.engineFree)
          ? state.doctor.engineFree
          : [];
        state.engineFree = new Set(list.map(String));
        state.selected && renderCommandChips(state.selected);
        renderDoctor(state.doctor);
      } catch (err) {
        state.doctorError = err;
        renderDoctorError();
      } finally {
        state.doctorLoading = false;
      }
    }
  }
  function renderLangToggle() {
    const slot = $("lang-slot");
    slot.textContent = "";
    const control = el("div", "lang-switch");
    control.setAttribute("role", "group");
    control.setAttribute("aria-label", t("lang.aria"));
    for (const code of SUPPORTED) {
      const active = state.lang === code;
      const button = el(
        "button",
        "lang-opt" + (active ? " active" : ""),
        t("lang." + code),
      );
      button.type = "button";
      button.setAttribute("aria-pressed", String(active));
      button.addEventListener("click", () => {
        if (state.lang !== code) applyLanguage(code);
      });
      control.appendChild(button);
    }
    slot.appendChild(control);
  }
  function applyLanguage(lang) {
    state.lang = SUPPORTED.includes(lang) ? lang : "en";
    try {
      localStorage.setItem(LANG_KEY, state.lang);
    } catch {}
    fillStaticStrings();
    renderLangToggle();
    applyTheme(readThemePref());
    renderVersion();
    renderSidebar();
    if (state.catalogError) renderCatalogError();
    else if (state.catalog) renderEmpty();
    if (state.selected)
      renderCommand(state.selected, {
        preserveValues: true,
        resetOutput: false,
      });
    if (state.gotResult && state.lastPayload) showResult(state.lastPayload);
    if (state.doctorError) renderDoctorError();
    else if (state.doctorLoaded) renderDoctor(state.doctor);
    else if (state.doctorLoading) renderDoctorLoading();
    if (state.bannerKey) setBannerText(t(state.bannerKey, state.bannerVars));
  }
  function setView(view) {
    const isEnv = "env" === view;
    $("tab-commands").classList.toggle("active", !isEnv);
    $("tab-env").classList.toggle("active", isEnv);
    $("tab-commands").setAttribute("aria-selected", String(!isEnv));
    $("tab-env").setAttribute("aria-selected", String(isEnv));
    $("view-commands").classList.toggle("hidden", isEnv);
    $("view-env").classList.toggle("hidden", !isEnv);
    $("sidebar").classList.toggle("hidden", isEnv);
    isEnv && (state.doctorLoaded ? renderDoctor(state.doctor) : loadDoctor());
  }
  function init() {
    fillStaticStrings();
    renderLangToggle();
    applyTheme(readThemePref());
    if (window.matchMedia) {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => {
        "system" === readThemePref() && applyTheme("system");
      };
      media.addEventListener
        ? media.addEventListener("change", onChange)
        : media.addListener && media.addListener(onChange);
    }
    $("tab-commands").addEventListener("click", () => setView("commands"));
    $("tab-env").addEventListener("click", () => setView("env"));
    $("theme-btn").addEventListener("click", cycleTheme);
    $("search").addEventListener("input", renderSidebar);
    $("run-btn").addEventListener("click", runCommand);
    $("stop-btn").addEventListener("click", () => {
      state.controller && state.controller.abort();
    });
    $("refresh-doctor").addEventListener("click", loadDoctor);
    $("copy-btn").addEventListener("click", () =>
      copyText(state.resultText, $("copy-btn"), "common.copy"),
    );
    $("copy-preview").addEventListener("click", () =>
      copyText($("preview").textContent, $("copy-preview"), "common.copy"),
    );
    $("expand-all").addEventListener("click", () => setAllBranches(true));
    $("collapse-all").addEventListener("click", () => setAllBranches(false));
    $("run-form").addEventListener("submit", (event) => {
      event.preventDefault();
      runCommand();
    });
    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && "Enter" === event.key) {
        event.preventDefault();
        runCommand();
      }
    });
    loadCatalog();
    loadDoctor();
  }
  init();
})();
