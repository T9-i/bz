/* 源指纹 3d8043599218a7d1 · 仓内输入 24 个（校验见 tests/preview-freshness.test.ts） */
/*#preview-inputs=["prototypes/dock/fake-sim.ts","prototypes/dock/fake/fake-obsidian.ts","src/core/app.ts","src/core/domain-bus.ts","src/core/external-tool.ts","src/core/notice.ts","src/core/settings-provider.ts","src/core/storage-path.ts","src/core/storage.ts","src/core/z-order.ts","src/dock/command.ts","src/dock/exec.ts","src/dock/files.ts","src/dock/host.ts","src/dock/kernel.ts","src/dock/lock.ts","src/dock/parse.ts","src/dock/registry-file.ts","src/dock/registry.ts","src/dock/rules.ts","src/dock/tick-once.ts","src/dock/types.ts","src/dock/ui.ts","src/dock/view.ts"]*/
/* 构建产物（勿手改）：node scripts/build-preview.mjs — prototypes/dock/fake-sim.ts → window.BZW_dock（行为单源预览包，issue 245/ADR-0106） */
var BZW_dock = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // prototypes/dock/fake/fake-obsidian.ts
  function setIcon(container, iconId) {
    var _a;
    const d = typeof window !== "undefined" && ((_a = window.DOCK_ICONS) == null ? void 0 : _a[iconId]) || "";
    if (!d) return;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.innerHTML = d;
    container.replaceChildren(svg);
  }
  var Platform, Notice, FakeVault, FakeApp;
  var init_fake_obsidian = __esm({
    "prototypes/dock/fake/fake-obsidian.ts"() {
      Platform = {
        isMobile: typeof window !== "undefined" && window.innerWidth <= 768,
        isDesktop: true,
        isDesktopApp: true,
        isMobileApp: false
      };
      Notice = class {
        constructor(message) {
          if (typeof document === "undefined") return;
          const el = document.createElement("div");
          el.textContent = message;
          el.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:9999;max-width:320px;padding:8px 12px;border-radius:8px;background:var(--background-secondary,#222);color:var(--text-normal,#eee);font-size:12px;border:1px solid var(--background-modifier-border,#444)";
          document.body.appendChild(el);
          window.setTimeout(() => el.remove(), 3e3);
        }
        hide() {
        }
      };
      FakeVault = class _FakeVault {
        constructor() {
          this.listeners = /* @__PURE__ */ new Map();
          if (typeof window !== "undefined") {
            window.addEventListener("storage", (e) => {
              var _a;
              if (!e.key || !e.key.startsWith("bz-sim:")) return;
              const path = e.key.slice("bz-sim:".length);
              for (const cb of (_a = this.listeners.get("modify")) != null ? _a : []) cb({ path });
            });
          }
        }
        static key(path) {
          return "bz-sim:" + path;
        }
        getAbstractFileByPath(path) {
          const raw = localStorage.getItem(_FakeVault.key(path));
          return raw == null ? null : { path, content: raw };
        }
        async read(f) {
          return f.content;
        }
        async modify(f, content) {
          f.content = content;
          localStorage.setItem(_FakeVault.key(f.path), content);
        }
        async create(path, content) {
          const f = { path, content };
          localStorage.setItem(_FakeVault.key(path), content);
          return f;
        }
        async createFolder(_path) {
          return void 0;
        }
        on(evt, cb) {
          var _a, _b;
          if (!this.listeners.has(evt)) this.listeners.set(evt, []);
          this.listeners.get(evt).push(cb);
          return { ref: (_b = (_a = crypto.randomUUID) == null ? void 0 : _a.call(crypto)) != null ? _b : String(Math.random()) };
        }
        offref(_ref) {
          this.listeners.clear();
        }
      };
      FakeApp = class {
        constructor() {
          this.vault = new FakeVault();
        }
      };
    }
  });

  // src/core/app.ts
  function setApp(app3) {
    _app = app3;
  }
  function getApp() {
    if (!_app) {
      throw new Error("bz: app 未初始化（setApp 未调用）");
    }
    return _app;
  }
  var _app;
  var init_app = __esm({
    "src/core/app.ts"() {
      _app = null;
    }
  });

  // src/core/settings-provider.ts
  function setSettingsProvider(fn) {
    _provider = fn;
  }
  function setSettingsSaver(fn) {
    _saver = fn;
  }
  function saveSettings() {
    return _saver ? _saver() : Promise.resolve();
  }
  function tryGetSettings() {
    return _provider ? _provider() : {};
  }
  var _provider, _saver;
  var init_settings_provider = __esm({
    "src/core/settings-provider.ts"() {
      _provider = null;
      _saver = null;
    }
  });

  // src/dock/types.ts
  var CONTRACT_VERSION, SETTINGS_FILENAME, RUNS_FILENAME, HEARTBEAT_FILENAME, PANEL_FILENAME, INTENT_FILENAME, RUNTIME_FILENAME, LOCK_FILENAME, REGISTRY_FILENAME, REGISTRY_VERSION, SETTINGS_VERSION, INTENT_VERSION, RUNTIME_VERSION, RUNS_TAIL_BYTES, HEARTBEAT_STALE_MS, RUN_TIMEOUT_MS, LOCK_STALE_MS, FAIL_COOLDOWN_MS, BREAKER_THRESHOLD, TOOL_ID_RE, TOOL_ID_MAX_LEN, TRIGGER_KINDS, TRIGGER_LABEL;
  var init_types = __esm({
    "src/dock/types.ts"() {
      CONTRACT_VERSION = 2;
      SETTINGS_FILENAME = "data.json";
      RUNS_FILENAME = "runs.jsonl";
      HEARTBEAT_FILENAME = "heartbeat.json";
      PANEL_FILENAME = "panel.html";
      INTENT_FILENAME = "dock.intent.json";
      RUNTIME_FILENAME = "dock.runtime.json";
      LOCK_FILENAME = "dock.lock";
      REGISTRY_FILENAME = "dock.json";
      REGISTRY_VERSION = 3;
      SETTINGS_VERSION = 2;
      INTENT_VERSION = 1;
      RUNTIME_VERSION = 1;
      RUNS_TAIL_BYTES = 256 * 1024;
      HEARTBEAT_STALE_MS = 6e4;
      RUN_TIMEOUT_MS = 10 * 6e4;
      LOCK_STALE_MS = 9e4;
      FAIL_COOLDOWN_MS = 15 * 6e4;
      BREAKER_THRESHOLD = 3;
      TOOL_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
      TOOL_ID_MAX_LEN = 64;
      TRIGGER_KINDS = [
        "daily",
        "interval",
        "on-launch",
        "panel-open",
        "tool-ok",
        "tool-fail",
        "domain-event",
        "file-change",
        "value-threshold"
      ];
      TRIGGER_LABEL = {
        daily: "每天某时",
        interval: "每隔一段时间",
        "on-launch": "启动 Obsidian 后",
        "panel-open": "打开工具坞时",
        "tool-ok": "某个工具成功后",
        "tool-fail": "某个工具失败后",
        "domain-event": "某个事件发生时",
        "file-change": "某个目录有变动",
        "value-threshold": "某个数值达到条件"
      };
    }
  });

  // src/dock/files.ts
  function setDockFs(fs) {
    injected = fs;
  }
  function defaultFs() {
    if (typeof window === "undefined") return null;
    const w = window;
    if (!w.require) return null;
    try {
      const fs = w.require("fs");
      return {
        readText: (p) => {
          try {
            return fs.readFileSync(p, "utf8");
          } catch (e) {
            return null;
          }
        },
        writeText: (p, d) => fs.writeFileSync(p, d),
        rename: typeof fs.renameSync === "function" ? (a, b) => fs.renameSync(a, b) : void 0,
        createExclusive: typeof fs.openSync === "function" ? (p, d) => {
          try {
            const fd = fs.openSync(p, "wx");
            if (typeof fs.writeSync === "function") fs.writeSync(fd, d);
            if (typeof fs.closeSync === "function") fs.closeSync(fd);
            return true;
          } catch (e) {
            return false;
          }
        } : void 0,
        unlink: typeof fs.unlinkSync === "function" ? (p) => fs.unlinkSync(p) : void 0,
        exists: (() => {
          const existsSync = fs.existsSync;
          if (typeof existsSync !== "function") return void 0;
          return (p) => {
            try {
              if (!existsSync(p)) return false;
              return fs.statSync ? fs.statSync(p).isFile() : true;
            } catch (e) {
              return false;
            }
          };
        })(),
        mkdir: typeof fs.mkdirSync === "function" ? (p) => {
          try {
            fs.mkdirSync(p, { recursive: true });
          } catch (e) {
          }
        } : void 0,
        readTail: (p, bytes) => {
          try {
            const size = fs.statSync(p).size;
            const start = Math.max(0, size - bytes);
            const readSync = fs.readSync;
            if (typeof readSync !== "function" || typeof Buffer === "undefined") return fs.readFileSync(p, "utf8");
            const fd = fs.openSync(p, "r");
            try {
              const buf = Buffer.alloc(size - start);
              readSync(fd, buf, 0, buf.length, start);
              return buf.toString("utf8");
            } finally {
              fs.closeSync(fd);
            }
          } catch (e) {
            return null;
          }
        },
        size: (p) => {
          try {
            return fs.statSync(p).size;
          } catch (e) {
            return void 0;
          }
        }
      };
    } catch (e) {
      return null;
    }
  }
  function currentFs() {
    return injected !== void 0 ? injected : defaultFs();
  }
  function dirOf(p) {
    const s = p.replace(/\\/g, "/");
    const i = s.lastIndexOf("/");
    if (i < 0) return "";
    if (i === 0) return "/";
    if (s[i - 1] === ":") return s.slice(0, i + 1);
    return s.slice(0, i);
  }
  function joinPath(dir, name) {
    const d = dir.replace(/\\/g, "/").replace(/\/+$/, "");
    return d === "" ? name : `${d}/${name}`;
  }
  function pidText() {
    var _a, _b;
    try {
      return String((_b = (_a = globalThis.process) == null ? void 0 : _a.pid) != null ? _b : 0);
    } catch (e) {
      return "0";
    }
  }
  function writeAtomic(fs, target, text) {
    try {
      if (fs.rename) {
        const tmp = `${target}.${pidText()}.${writeSeq++}.tmp`;
        fs.writeText(tmp, text);
        fs.rename(tmp, target);
      } else {
        fs.writeText(target, text);
      }
      return true;
    } catch (e) {
      return false;
    }
  }
  function readTextOf(path, fs = currentFs()) {
    return fs ? fs.readText(path) : null;
  }
  function readRunsText(path, fs = currentFs(), tailBytes = 0) {
    if (!fs) return null;
    if (tailBytes > 0 && fs.readTail) return fs.readTail(path, tailBytes);
    return fs.readText(path);
  }
  function readPanelText(path, fs = currentFs()) {
    if (!fs) return null;
    const t = fs.readText(path);
    return t === null || t.trim() === "" ? null : t;
  }
  function writeSettings(declPath, toolId, values, fs = currentFs()) {
    if (!fs) return false;
    return writeAtomic(fs, pathOf.settings(declPath), JSON.stringify({ v: SETTINGS_VERSION, tool: toolId, values }, null, 2));
  }
  function writeIntent(declPath, intent, fs = currentFs()) {
    if (!fs) return false;
    const payload = { ...intent, v: INTENT_VERSION };
    return writeAtomic(fs, pathOf.intent(declPath), JSON.stringify(payload, null, 2));
  }
  function writeRuntime(declPath, runtime, fs = currentFs()) {
    if (!fs) return false;
    const target = pathOf.runtime(declPath);
    const payload = { ...runtime, v: RUNTIME_VERSION, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    const next = JSON.stringify(payload, null, 2);
    const prev = fs.readText(target);
    if (prev !== null && stripUpdatedAt(prev) === stripUpdatedAt(next)) return false;
    return writeAtomic(fs, target, next);
  }
  function stripUpdatedAt(json) {
    return json.replace(/^\s*"updatedAt":\s*"[^"]*",?\s*$/m, "");
  }
  var injected, pathOf, writeSeq;
  var init_files = __esm({
    "src/dock/files.ts"() {
      init_types();
      pathOf = {
        manifest: (declPath) => declPath,
        settings: (declPath) => joinPath(dirOf(declPath), SETTINGS_FILENAME),
        runs: (declPath) => joinPath(dirOf(declPath), RUNS_FILENAME),
        heartbeat: (declPath) => joinPath(dirOf(declPath), HEARTBEAT_FILENAME),
        panel: (declPath) => joinPath(dirOf(declPath), PANEL_FILENAME),
        intent: (declPath) => joinPath(dirOf(declPath), INTENT_FILENAME),
        runtime: (declPath) => joinPath(dirOf(declPath), RUNTIME_FILENAME)
      };
      writeSeq = 0;
    }
  });

  // src/core/z-order.ts
  function syncAlwaysOnTop() {
    for (const el of alwaysOnTop) {
      if (!el.isConnected) {
        alwaysOnTop.delete(el);
        continue;
      }
      el.style.zIndex = String(zCounter);
    }
  }
  function allocZBlock(n) {
    const base = ++zCounter;
    zCounter += n - 1;
    zCounter++;
    syncAlwaysOnTop();
    return base;
  }
  function allocZ() {
    return allocZBlock(1);
  }
  var zCounter, alwaysOnTop;
  var init_z_order = __esm({
    "src/core/z-order.ts"() {
      zCounter = 1e5;
      alwaysOnTop = /* @__PURE__ */ new Set();
    }
  });

  // src/core/notice.ts
  function maxVisible() {
    const v = Number(noticePref("noticeMaxVisible"));
    return v === 3 || v === 8 ? v : MAX_VISIBLE_DEFAULT;
  }
  function isMobileView() {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(MOBILE_QUERY).matches;
  }
  function defaultVariant() {
    if (isMobileView()) return "drop";
    const pos = noticePref("noticePosition");
    return pos === "top-left" || pos === "bottom-left" ? "slide-left" : "slide-right";
  }
  function noticePref(key) {
    var _a;
    try {
      const v = (_a = tryGetSettings()) == null ? void 0 : _a[key];
      return typeof v === "string" ? v : void 0;
    } catch (e) {
      return void 0;
    }
  }
  function durationGear() {
    const v = noticePref("noticeDuration");
    if (v === "quick") return { base: 2e3, persistent: false };
    if (v === "relaxed") return { base: 5e3, persistent: false };
    if (v === "persistent") return { base: 3e3, persistent: true };
    return { base: 3e3, persistent: false };
  }
  function defaultDuration(type) {
    const base = durationGear().base;
    return type === "error" ? base + 2e3 : base;
  }
  function suppressedByLevel(kind, opts) {
    const level = noticePref("noticeLevel");
    if (level !== "important" && level !== "error") return false;
    if (kind === "progress") return false;
    if (opts && (opts.action || opts.actions && opts.actions.length > 0)) return false;
    if (level === "error") return kind !== "error";
    return kind !== "warning" && kind !== "error";
  }
  function applyPositionClass(container) {
    const pos = noticePref("noticePosition");
    container.classList.remove(...POSITION_CLASSES);
    const cls = pos === "bottom-right" || pos === "bottom-left" || pos === "top-left" ? `bz-notice-pos--${pos}` : "";
    if (cls) container.classList.add(cls);
  }
  function calcDuration(text, base) {
    const len = text.length;
    if (len <= SHORT_THRESHOLD) return base;
    const extra = (len - SHORT_THRESHOLD) * PER_CHAR_MS;
    return Math.min(base + extra, 15e3);
  }
  function ensureContainer() {
    let container = document.getElementById("bz-notice-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "bz-notice-container";
      document.body.appendChild(container);
    }
    return container;
  }
  function removeInternal(n) {
    if (n.timer !== null) {
      window.clearTimeout(n.timer);
      n.timer = null;
    }
    const i = live.indexOf(n);
    if (i !== -1) live.splice(i, 1);
    if (n.el.parentNode) n.el.parentNode.removeChild(n.el);
  }
  function evictOldest() {
    let quota = live.length - maxVisible() + 1;
    for (let i = 0; quota > 0 && i < live.length; ) {
      const candidate = live[i];
      if (candidate.persistent) {
        i++;
        continue;
      }
      removeInternal(candidate);
      quota--;
    }
  }
  function applyTypeToEl(n, kind) {
    const isProgressNow = kind === "progress";
    n.el.classList.remove(
      "bz-notice--info",
      "bz-notice--success",
      "bz-notice--warning",
      "bz-notice--error",
      "bz-notice--pause",
      "bz-notice--delete",
      "bz-notice--restore",
      "bz-notice--archive",
      "bz-notice--progress"
    );
    n.el.classList.add("bz-notice--" + (isProgressNow ? "progress" : kind));
    n.iconEl.innerHTML = "";
    if (isProgressNow) {
      n.iconEl.innerHTML = SPINNER_SVG;
    } else {
      n.iconEl.textContent = ICONS[kind];
    }
    n.isProgress = isProgressNow;
  }
  function hideNow(n) {
    if (n.timer !== null) {
      window.clearTimeout(n.timer);
      n.timer = null;
    }
    if (!n.el.classList.contains("bz-notice--leaving")) {
      n.el.classList.add("bz-notice--leaving");
      const out = OUT_CLASS[n.variant];
      if (out) n.el.classList.add(out);
      window.setTimeout(() => removeInternal(n), LEAVE_MS);
    }
  }
  function armTimer(n, kind, explicitDuration, text) {
    if (n.timer !== null) {
      window.clearTimeout(n.timer);
      n.timer = null;
    }
    n.persistent = false;
    if (kind === "progress") {
      if (explicitDuration !== void 0 && explicitDuration > 0) {
        n.timer = window.setTimeout(() => hideNow(n), explicitDuration);
      } else {
        n.persistent = true;
      }
    } else {
      const base = defaultDuration(kind);
      const dur = explicitDuration !== void 0 ? explicitDuration : text ? calcDuration(text, base) : base;
      if (dur <= 0) {
        n.persistent = true;
      } else if (explicitDuration === void 0 && durationGear().persistent) {
      } else {
        n.timer = window.setTimeout(() => hideNow(n), dur);
      }
    }
  }
  function noopHandle() {
    return {
      el: document.createElement("div"),
      setMessage() {
      },
      setProgress() {
      },
      setType() {
      },
      setAction() {
      },
      hide() {
      }
    };
  }
  function appendActionBtn(n, action) {
    const btn = document.createElement("span");
    btn.className = "bz-notice-action";
    btn.setAttribute("role", "button");
    btn.tabIndex = 0;
    btn.textContent = action.label;
    const fire = (e) => {
      e.stopPropagation();
      if (action.onClick) action.onClick();
      hideNow(n);
    };
    btn.addEventListener("click", fire);
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fire(e);
      }
    });
    n.el.appendChild(btn);
  }
  function makeHandle(n) {
    return {
      el: n.el,
      setMessage(text) {
        n.msgEl.textContent = text;
      },
      setType(t) {
        applyTypeToEl(n, t);
        armTimer(n, t, void 0, n.msgEl.textContent || void 0);
      },
      setProgress(pct) {
        if (!n.progressEl) return;
        if (pct === -1) {
          n.progressEl.classList.add("bz-notice-progress--indeterminate");
          return;
        }
        n.progressEl.classList.remove("bz-notice-progress--indeterminate");
        const clamped = Math.max(0, Math.min(100, pct));
        n.progressEl.style.width = clamped + "%";
        if (clamped >= 100) n.progressEl.classList.add("bz-notice-progress--done");
        else n.progressEl.classList.remove("bz-notice-progress--done");
      },
      setAction(actions) {
        const list = Array.isArray(actions) ? actions : [actions];
        const existing = new Set(
          Array.from(n.el.querySelectorAll(".bz-notice-action")).map((el) => el.textContent || "")
        );
        for (const a of list) {
          if (existing.has(a.label)) continue;
          appendActionBtn(n, a);
          existing.add(a.label);
        }
      },
      hide() {
        hideNow(n);
      }
    };
  }
  function notify(msg, opts) {
    const kind = opts && opts.type || "info";
    if (suppressedByLevel(kind, opts)) return noopHandle();
    const isProgress = kind === "progress";
    const type = isProgress ? "info" : kind;
    const variant = opts && opts.variant || defaultVariant();
    const container = ensureContainer();
    applyPositionClass(container);
    if (opts && opts.dedupeKey) {
      const key = opts.dedupeKey;
      const r = recent[key];
      const now = Date.now();
      if (r && r.n && r.n.el.isConnected) {
        r.n.msgEl.textContent = msg;
        if (r.n.isProgress !== isProgress || r.n.el.classList.contains("bz-notice--" + type) === false) {
          applyTypeToEl(r.n, kind);
        }
        const mergeActions = [];
        if (opts.action) mergeActions.push(opts.action);
        if (opts.actions) mergeActions.push(...opts.actions);
        armTimer(r.n, kind, opts.duration, msg);
        const merged = makeHandle(r.n);
        if (mergeActions.length) merged.setAction(mergeActions);
        return merged;
      }
      if (r && now - r.at < DEDUPE_WINDOW_MS) {
        return noopHandle();
      }
      recent[key] = { at: now, n: null };
    }
    evictOldest();
    const el = document.createElement("div");
    el.className = "bz-notice bz-notice--" + (isProgress ? "progress" : type) + " bz-notice--in-" + variant;
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
    const icon = document.createElement("div");
    icon.className = "bz-notice-icon";
    if (isProgress) {
      icon.innerHTML = SPINNER_SVG;
    } else {
      icon.textContent = ICONS[type];
    }
    el.appendChild(icon);
    const body = document.createElement("div");
    body.className = "bz-notice-body";
    if (opts && opts.title) {
      const titleEl2 = document.createElement("div");
      titleEl2.className = "bz-notice-title";
      titleEl2.textContent = opts.title;
      body.appendChild(titleEl2);
    }
    const msgEl = document.createElement("div");
    msgEl.className = "bz-notice-msg";
    msgEl.textContent = msg;
    body.appendChild(msgEl);
    el.appendChild(body);
    let progressEl = null;
    if (isProgress) {
      progressEl = document.createElement("div");
      progressEl.className = "bz-notice-progress";
      el.appendChild(progressEl);
    }
    const n = { el, timer: null, msgEl, progressEl, iconEl: icon, variant, isProgress, persistent: false };
    const actions = [];
    if (opts && opts.action) actions.push(opts.action);
    if (opts && opts.actions) {
      for (const a of opts.actions) {
        if (!actions.some((x) => x.label === a.label)) actions.push(a);
      }
    }
    for (const a of actions) appendActionBtn(n, a);
    el.addEventListener("click", () => hideNow(n));
    container.style.zIndex = String(allocZ());
    container.appendChild(el);
    live.push(n);
    if (opts && opts.dedupeKey) {
      const r = recent[opts.dedupeKey];
      if (r) r.n = n;
    }
    const fullText = (opts && opts.title ? opts.title + " " : "") + msg;
    armTimer(n, kind, opts && opts.duration, fullText);
    return makeHandle(n);
  }
  var MAX_VISIBLE_DEFAULT, LEAVE_MS, DEDUPE_WINDOW_MS, MOBILE_QUERY, ICONS, SPINNER_SVG, OUT_CLASS, POSITION_CLASSES, PER_CHAR_MS, SHORT_THRESHOLD, live, recent;
  var init_notice = __esm({
    "src/core/notice.ts"() {
      init_z_order();
      init_settings_provider();
      MAX_VISIBLE_DEFAULT = 5;
      LEAVE_MS = 200;
      DEDUPE_WINDOW_MS = 3e4;
      MOBILE_QUERY = "(max-width: 768px)";
      ICONS = {
        info: "ℹ️",
        success: "✅",
        warning: "⚠️",
        error: "❌",
        pause: "⏸️",
        delete: "🗑️",
        restore: "↩️",
        archive: "📁"
      };
      SPINNER_SVG = '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9"/></svg>';
      OUT_CLASS = {
        drop: "bz-notice--out-drop",
        pop: "bz-notice--out-pop",
        "slide-left": "bz-notice--out-left",
        "slide-right": "bz-notice--out-right",
        bounce: "bz-notice--out-fade",
        shake: "bz-notice--out-fade"
      };
      POSITION_CLASSES = ["bz-notice-pos--bottom-right", "bz-notice-pos--bottom-left", "bz-notice-pos--top-left"];
      PER_CHAR_MS = 60;
      SHORT_THRESHOLD = 20;
      live = [];
      recent = {};
    }
  });

  // src/dock/parse.ts
  function isObj(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }
  function str(v) {
    if (typeof v !== "string") return void 0;
    const s = v.trim();
    return s === "" ? void 0 : s;
  }
  function num(v, min, max) {
    if (typeof v !== "number" || !Number.isFinite(v)) return void 0;
    const n = Math.floor(v);
    return n < min || n > max ? void 0 : n;
  }
  function bool(v) {
    return typeof v === "boolean" ? v : void 0;
  }
  function parseJsonObjectText(text) {
    if (typeof text !== "string" || text.trim() === "") return null;
    try {
      const v = JSON.parse(text);
      return isObj(v) ? v : null;
    } catch (e) {
      return null;
    }
  }
  function isToolId(v) {
    return typeof v === "string" && v.length <= TOOL_ID_MAX_LEN && TOOL_ID_RE.test(v);
  }
  function parseParam(raw) {
    if (!isObj(raw)) return null;
    const key = str(raw.key);
    if (!key || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) return null;
    const type = PARAM_TYPES.includes(raw.type) ? raw.type : "text";
    const out = { key, type };
    const label = str(raw.label);
    if (label) out.label = label;
    const hint = str(raw.hint);
    if (hint) out.hint = hint;
    const req = bool(raw.required);
    if (req !== void 0) out.required = req;
    if (raw.default !== void 0 && (typeof raw.default === "string" || typeof raw.default === "number" || typeof raw.default === "boolean" || Array.isArray(raw.default))) {
      out.default = raw.default;
    }
    if (Array.isArray(raw.options)) {
      const opts = raw.options.filter((o) => typeof o === "string");
      if (opts.length) out.options = opts;
    }
    if ((type === "choice" || type === "multichoice") && !out.options) return null;
    return out;
  }
  function parseParams(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const item of raw) {
      const p = parseParam(item);
      if (!p || seen.has(p.key)) continue;
      seen.add(p.key);
      out.push(p);
    }
    return out;
  }
  function parseEntry(raw) {
    if (!isObj(raw)) return null;
    const cmd = str(raw.cmd);
    if (!cmd) return null;
    const out = { cmd };
    if (Array.isArray(raw.args)) {
      const args = raw.args.filter((a) => typeof a === "string");
      if (args.length) out.args = args;
    }
    const cwd = str(raw.cwd);
    if (cwd) out.cwd = cwd;
    const shell = bool(raw.shell);
    if (shell !== void 0) out.shell = shell;
    return out;
  }
  function parseManifest(raw) {
    if (!isObj(raw)) return null;
    if (raw.v !== CONTRACT_VERSION) return null;
    if (!isToolId(raw.id)) return null;
    const name = str(raw.name);
    if (!name) return null;
    const out = { v: CONTRACT_VERSION, id: raw.id, name };
    const desc = str(raw.description);
    if (desc) out.description = desc;
    const icon = str(raw.icon);
    if (icon) out.icon = icon;
    const entry = parseEntry(raw.entry);
    if (entry) out.entry = entry;
    const params = parseParams(raw.params);
    if (params.length) out.params = params;
    const rules = parseRules(raw.defaultRules);
    if (rules.length) out.defaultRules = rules;
    return out;
  }
  function atSecondsOf(at) {
    if (!at) return void 0;
    const m = /^(\d{1,2}):(\d{1,2})$/.exec(at.trim());
    if (!m) return void 0;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) return void 0;
    return h * 3600 + mi * 60;
  }
  function parseTrigger(raw) {
    if (!isObj(raw)) return null;
    switch (raw.kind) {
      case "daily": {
        const at = str(raw.at);
        const sec = atSecondsOf(at);
        if (sec === void 0) return null;
        const h = String(Math.floor(sec / 3600)).padStart(2, "0");
        const mi = String(Math.floor(sec % 3600 / 60)).padStart(2, "0");
        return { kind: "daily", at: `${h}:${mi}` };
      }
      case "interval": {
        const m = num(raw.everyMin, 1, 43200);
        return m === void 0 ? null : { kind: "interval", everyMin: m };
      }
      case "on-launch": {
        const m = num(raw.delayMin, 0, 1440);
        return m === void 0 ? null : { kind: "on-launch", delayMin: m };
      }
      case "panel-open":
        return { kind: "panel-open" };
      case "tool-ok": {
        const id = str(raw.toolId);
        return id ? { kind: "tool-ok", toolId: id } : null;
      }
      case "tool-fail": {
        const id = str(raw.toolId);
        return id ? { kind: "tool-fail", toolId: id } : null;
      }
      case "domain-event": {
        const ch = str(raw.channel);
        return ch ? { kind: "domain-event", channel: ch } : null;
      }
      case "file-change": {
        const t = str(raw.target);
        return t ? { kind: "file-change", target: t.replace(/\/+$/, "") } : null;
      }
      case "value-threshold": {
        const op = raw.op;
        if (op !== ">" && op !== "<" && op !== "=") return null;
        const value = raw.value;
        if (typeof value !== "number" || !Number.isFinite(value)) return null;
        const path = str(raw.path);
        const key = str(raw.key);
        if (!path || !key) return null;
        return { kind: "value-threshold", path, key, op, value };
      }
      default:
        return null;
    }
  }
  function parseAction(raw) {
    if (!isObj(raw)) return { kind: "run" };
    return raw.kind === "remind" ? { kind: "remind" } : { kind: "run" };
  }
  function parseRule(raw) {
    if (!isObj(raw)) return null;
    const id = str(raw.id);
    if (!id) return null;
    const trigger = parseTrigger(raw.trigger);
    if (!trigger) return null;
    const out = { id, trigger, action: parseAction(raw.action) };
    const name = str(raw.name);
    if (name) out.name = name;
    const enabled = bool(raw.enabled);
    if (enabled !== void 0) out.enabled = enabled;
    const jitter = num(raw.jitterMin, 0, 720);
    if (jitter !== void 0) out.jitterMin = jitter;
    return out;
  }
  function parseRules(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const item of raw) {
      const r = parseRule(item);
      if (!r || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
    return out;
  }
  function makeRunId(now = Date.now()) {
    return `r${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  function emptyIntent(tool) {
    return { v: INTENT_VERSION, tool };
  }
  function parseIntent(raw, toolId) {
    if (!isObj(raw) || raw.v !== INTENT_VERSION || raw.tool !== toolId) return emptyIntent(toolId);
    const out = emptyIntent(toolId);
    const enabled = bool(raw.enabled);
    if (enabled !== void 0) out.enabled = enabled;
    const auto = bool(raw.autoRun);
    if (auto !== void 0) out.autoRun = auto;
    const rules = parseRules(raw.rules);
    if (rules.length) out.rules = rules;
    return out;
  }
  function parseRuleRuntime(raw) {
    if (!isObj(raw)) return null;
    const out = {};
    const lastFired = str(raw.lastFiredAt);
    if (lastFired) out.lastFiredAt = lastFired;
    const lastRunId = str(raw.lastRunId);
    if (lastRunId) out.lastRunId = lastRunId;
    const lastStatus = str(raw.lastStatus);
    if (lastStatus) out.lastStatus = lastStatus;
    if (isObj(raw.pending)) {
      const runId = str(raw.pending.runId);
      const dueAt = str(raw.pending.dueAt);
      const claimedAt = str(raw.pending.claimedAt);
      if (runId && dueAt && claimedAt) {
        const pending = { runId, dueAt, claimedAt };
        const startedAt = str(raw.pending.startedAt);
        if (startedAt) pending.startedAt = startedAt;
        const attempts = num(raw.pending.attempts, 0, 1e3);
        if (attempts) pending.attempts = attempts;
        out.pending = pending;
      }
    }
    return Object.keys(out).length ? out : null;
  }
  function parseRunFacts(raw) {
    if (!isObj(raw)) return null;
    const out = {};
    const at = str(raw.lastAttemptAt);
    if (at) out.lastAttemptAt = at;
    const ok = bool(raw.lastAttemptOk);
    if (ok !== void 0) out.lastAttemptOk = ok;
    const fails = num(raw.consecutiveFailures, 0, 1e3);
    if (fails) out.consecutiveFailures = fails;
    const paused = str(raw.pausedAt);
    if (paused) out.pausedAt = paused;
    return Object.keys(out).length ? out : null;
  }
  function emptyRuntime(tool) {
    return { v: RUNTIME_VERSION, tool };
  }
  function parseRuntime(raw, toolId) {
    if (!isObj(raw) || raw.v !== RUNTIME_VERSION || raw.tool !== toolId) return emptyRuntime(toolId);
    const out = emptyRuntime(toolId);
    const updatedAt = str(raw.updatedAt);
    if (updatedAt) out.updatedAt = updatedAt;
    if (isObj(raw.rules)) {
      const rules = {};
      for (const [id, v] of Object.entries(raw.rules)) {
        const r = parseRuleRuntime(v);
        if (r) rules[id] = r;
      }
      if (Object.keys(rules).length) out.rules = rules;
    }
    const run = parseRunFacts(raw.run);
    if (run) out.run = run;
    return out;
  }
  function parseRegistryEntry(raw) {
    if (!isObj(raw)) return null;
    if (!isToolId(raw.id)) return null;
    const path = str(raw.path);
    if (!path) return null;
    return { id: raw.id, path };
  }
  function emptyRegistry() {
    return { v: REGISTRY_VERSION, tools: [], autoRun: true, watchdog: true, notifyMissed: true };
  }
  function parseRegistry(raw) {
    const errors = [];
    const base = emptyRegistry();
    if (!isObj(raw)) {
      if (raw !== null && raw !== void 0) errors.push("登记表不是 JSON 对象，已按空处理");
      return { registry: base, errors };
    }
    if (raw.v !== REGISTRY_VERSION) {
      errors.push(`登记表版本是 ${String(raw.v)}，本版认 ${REGISTRY_VERSION} —— 已按空处理`);
      return { registry: base, errors };
    }
    const tools = [];
    const seen = /* @__PURE__ */ new Set();
    if (Array.isArray(raw.tools)) {
      for (const item of raw.tools) {
        const e = parseRegistryEntry(item);
        if (!e) continue;
        if (seen.has(e.id)) {
          errors.push(`登记表里有重复的 id：${e.id}（只留第一条）`);
          continue;
        }
        seen.add(e.id);
        tools.push(e);
      }
    }
    const autoRun = bool(raw.autoRun);
    const watchdog = bool(raw.watchdog);
    const notifyMissed = bool(raw.notifyMissed);
    return {
      registry: {
        v: REGISTRY_VERSION,
        tools,
        autoRun: autoRun != null ? autoRun : true,
        watchdog: watchdog != null ? watchdog : true,
        notifyMissed: notifyMissed != null ? notifyMissed : true
      },
      errors
    };
  }
  function parseStep(raw) {
    var _a;
    if (!isObj(raw)) return null;
    const text = str(raw.text);
    if (!text) return null;
    const at = (_a = str(raw.at)) != null ? _a : (/* @__PURE__ */ new Date(0)).toISOString();
    const status = raw.status === "failed" ? "failed" : "ok";
    return { text, at, status };
  }
  function parseRunRecord(raw, expectTool) {
    var _a, _b, _c;
    if (!isObj(raw)) return null;
    const runId = str(raw.runId);
    const status = str(raw.status);
    if (!runId || !status) return null;
    if (expectTool && raw.tool !== void 0 && raw.tool !== expectTool) return null;
    const STATUSES = ["ok", "failed", "timeout", "stopped", "abandoned", "running"];
    if (!STATUSES.includes(status)) return null;
    const startedAt = (_a = str(raw.startedAt)) != null ? _a : (/* @__PURE__ */ new Date(0)).toISOString();
    const out = {
      runId,
      tool: (_c = (_b = str(raw.tool)) != null ? _b : expectTool) != null ? _c : "",
      trigger: raw.trigger === "auto" ? "auto" : "manual",
      status,
      startedAt
    };
    const finishedAt = str(raw.finishedAt);
    if (finishedAt) out.finishedAt = finishedAt;
    if (typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs)) out.durationMs = raw.durationMs;
    if (typeof raw.exitCode === "number" || raw.exitCode === null) out.exitCode = raw.exitCode;
    const message = str(raw.message);
    if (message) out.message = message;
    if (isObj(raw.error)) {
      const kind = str(raw.error.kind);
      const KINDS = ["auth", "network", "config", "timeout", "aborted", "unknown"];
      const picked = kind && KINDS.includes(kind) ? kind : "unknown";
      out.error = { kind: picked, detail: str(raw.error.detail), stderr: str(raw.error.stderr) };
    }
    if (Array.isArray(raw.steps)) {
      const steps = raw.steps.map(parseStep).filter((s) => s !== null);
      if (steps.length) out.steps = steps;
    }
    if (Array.isArray(raw.info)) out.info = raw.info;
    if (raw.result !== void 0) out.result = raw.result;
    if (isObj(raw.metrics)) {
      const m = {};
      for (const [k, v] of Object.entries(raw.metrics)) {
        if (typeof v === "number" && Number.isFinite(v)) m[k] = v;
      }
      if (Object.keys(m).length) out.metrics = m;
    }
    if (Array.isArray(raw.artifacts)) {
      const a = raw.artifacts.filter((x) => isObj(x) && typeof x.path === "string").map((x) => ({ path: String(x.path), label: typeof x.label === "string" ? x.label : void 0 }));
      if (a.length) out.artifacts = a;
    }
    return out;
  }
  function parseRunLines(text, expectTool) {
    if (!text) return [];
    const out = [];
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const rec = parseRunRecord(JSON.parse(t), expectTool);
        if (rec) out.push(rec);
      } catch (e) {
      }
    }
    return out;
  }
  function parseHeartbeat(raw) {
    if (!isObj(raw)) return null;
    const at = str(raw.at);
    if (!at || !Number.isFinite(Date.parse(at))) return null;
    const out = { at };
    const runId = str(raw.runId);
    if (runId) out.runId = runId;
    const step = str(raw.step);
    if (step) out.step = step;
    return out;
  }
  function findByRunId(records, runId) {
    for (let i = records.length - 1; i >= 0; i--) {
      if (records[i].runId === runId) return records[i];
    }
    return void 0;
  }
  function latestRun(records) {
    let best;
    let bestAt = -Infinity;
    for (const r of records) {
      const t = Date.parse(r.startedAt);
      if (!Number.isFinite(t)) continue;
      if (t >= bestAt) {
        bestAt = t;
        best = r;
      }
    }
    return best;
  }
  function parseSettingsText(text, toolId) {
    if (text === null || text === void 0) return null;
    const raw = parseJsonObjectText(text);
    if (!raw) return {};
    if (raw.v !== SETTINGS_VERSION || raw.tool !== toolId) return {};
    return isObj(raw.values) ? { ...raw.values } : {};
  }
  function buildArgs(manifest2, values) {
    var _a;
    const args = [];
    for (const p of (_a = manifest2.params) != null ? _a : []) {
      if (p.type === "secret") continue;
      const v = values[p.key];
      if (v === void 0 || v === null) continue;
      if (p.type === "bool") {
        if (v === true) args.push(`--${p.key}`);
        continue;
      }
      if (p.type === "multichoice") {
        const list = Array.isArray(v) ? v : [v];
        for (const item of list) {
          const s2 = String(item);
          if (s2 !== "") args.push(`--${p.key}=${s2}`);
        }
        continue;
      }
      const s = String(v);
      if (s === "" && !p.required) continue;
      args.push(`--${p.key}=${s}`);
    }
    return args;
  }
  function secretEnvOf(manifest2, values) {
    var _a;
    const env = {};
    for (const p of (_a = manifest2.params) != null ? _a : []) {
      if (p.type !== "secret") continue;
      const v = values[p.key];
      if (v === void 0 || v === null || String(v) === "") continue;
      const name = `BZ_DOCK_SECRET_${p.key.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
      env[name] = String(v);
    }
    return env;
  }
  function runSignature(entry) {
    var _a, _b;
    if (!entry) return "";
    return [entry.cmd, entry.shell === true ? "shell" : "raw", (_a = entry.cwd) != null ? _a : "", ...(_b = entry.args) != null ? _b : []].join("\0");
  }
  var PARAM_TYPES;
  var init_parse = __esm({
    "src/dock/parse.ts"() {
      init_types();
      PARAM_TYPES = [
        "text",
        "number",
        "bool",
        "choice",
        "path",
        "secret",
        "multiline",
        "multichoice"
      ];
    }
  });

  // src/dock/view.ts
  function readManifestFile(path, fs) {
    const text = readTextOf(path, fs);
    if (text === null) return { manifest: null, error: "读不到 manifest.json" };
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return { manifest: null, error: "manifest.json 不是合法 JSON" };
    }
    const manifest2 = parseManifest(raw);
    if (!manifest2) {
      return { manifest: null, error: "manifest.json 校验不过（需要 v:2、合法 id、非空 name）" };
    }
    return { manifest: manifest2 };
  }
  function loadToolView(entry, opts = {}) {
    var _a, _b, _c, _d, _e, _f, _g;
    const fs = opts.fs === void 0 ? currentFs() : opts.fs;
    const { manifest: manifest2, error } = readManifestFile(entry.path, fs != null ? fs : null);
    const intentRaw = fs ? readTextOf(pathOf.intent(entry.path), fs) : null;
    const intent = parseIntent(safeJson(intentRaw), entry.id);
    const runtimeRaw = fs ? readTextOf(pathOf.runtime(entry.path), fs) : null;
    const runtime = parseRuntime(safeJson(runtimeRaw), entry.id);
    const settingsRaw = fs ? readTextOf(pathOf.settings(entry.path), fs) : null;
    const parsedValues = parseSettingsText(settingsRaw, entry.id);
    const values = parsedValues != null ? parsedValues : {};
    const records = fs ? parseRunLines(readRunsText(pathOf.runs(entry.path), fs, RUNS_TAIL_BYTES), entry.id) : [];
    const heartbeat = heartbeatOf(entry.path, fs);
    const trust = (_a = opts.trust) == null ? void 0 : _a[entry.id];
    const signature = runSignature((_b = manifest2 == null ? void 0 : manifest2.entry) != null ? _b : null);
    const trusted = !!trust && !!signature && trust.run === signature;
    const rules = ((_c = intent.rules) == null ? void 0 : _c.length) ? intent.rules : (_d = manifest2 == null ? void 0 : manifest2.defaultRules) != null ? _d : [];
    return {
      id: entry.id,
      path: entry.path,
      dir: dirOf(entry.path),
      manifest: manifest2,
      error: error != null ? error : manifest2 && manifest2.id !== entry.id ? `声明的 id 是 ${manifest2.id}，登记的是 ${entry.id}` : void 0,
      entry: (_e = manifest2 == null ? void 0 : manifest2.entry) != null ? _e : null,
      params: (_f = manifest2 == null ? void 0 : manifest2.params) != null ? _f : [],
      values,
      intent,
      runtime,
      rules,
      trusted,
      trustStale: !!trust && !!signature && trust.run !== signature,
      lastRun: latestRun(records),
      heartbeat: heartbeat != null ? heartbeat : void 0,
      runnable: ((_g = opts.canRun) != null ? _g : true) && !!(manifest2 == null ? void 0 : manifest2.entry)
    };
  }
  function loadToolViews(entries, opts = {}) {
    return entries.map((e) => loadToolView(e, opts));
  }
  function recentRunsOf(declPath, toolId, limit = 20, fs = currentFs()) {
    const all = parseRunLines(readRunsText(pathOf.runs(declPath), fs, RUNS_TAIL_BYTES), toolId);
    return all.slice().sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0)).slice(0, limit);
  }
  function heartbeatOf(declPath, fs = currentFs()) {
    if (!fs) return null;
    return parseHeartbeat(safeJson(readTextOf(pathOf.heartbeat(declPath), fs)));
  }
  function panelOf(declPath, fs = currentFs()) {
    return readPanelText(pathOf.panel(declPath), fs);
  }
  function safeJson(text) {
    if (text === null) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }
  function displayNameOf(view2) {
    var _a, _b;
    return ((_b = (_a = view2.manifest) == null ? void 0 : _a.name) == null ? void 0 : _b.trim()) || view2.id;
  }
  var init_view = __esm({
    "src/dock/view.ts"() {
      init_parse();
      init_files();
      init_parse();
      init_types();
    }
  });

  // src/dock/registry-file.ts
  function readRegistryAt(path, fs) {
    const text = readTextOf(path, fs);
    if (text === null) return { registry: emptyRegistry() };
    let raw = null;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return { registry: emptyRegistry(), error: "登记表不是合法 JSON，已按空处理" };
    }
    const parsed = parseRegistry(raw);
    return { registry: parsed.registry, error: parsed.errors[0] };
  }
  function writeRegistryAt(path, reg, fs) {
    if (!fs) return false;
    return writeAtomic(fs, path, JSON.stringify(reg, null, 2));
  }
  function upsertToolAt(path, entry, fs) {
    const { registry } = readRegistryAt(path, fs);
    const i = registry.tools.findIndex((t) => t.id === entry.id);
    const tools = registry.tools.slice();
    if (i >= 0) tools[i] = entry;
    else tools.push(entry);
    const next = { ...registry, tools };
    writeRegistryAt(path, next, fs);
    return next;
  }
  function removeToolAt(path, id, fs) {
    const { registry } = readRegistryAt(path, fs);
    const next = { ...registry, tools: registry.tools.filter((t) => t.id !== id) };
    writeRegistryAt(path, next, fs);
    return next;
  }
  var init_registry_file = __esm({
    "src/dock/registry-file.ts"() {
      init_parse();
      init_files();
    }
  });

  // src/core/storage-path.ts
  function normalizeStorageDir(value) {
    let dir = (value || DEFAULT_STORAGE_DIR).trim().replace(/\\/g, "/").replace(/\/+$/, "");
    if (/\.json$/i.test(dir)) {
      const idx = dir.lastIndexOf("/");
      dir = idx >= 0 ? dir.slice(0, idx) : "";
    }
    return dir || DEFAULT_STORAGE_DIR;
  }
  var DEFAULT_STORAGE_DIR;
  var init_storage_path = __esm({
    "src/core/storage-path.ts"() {
      DEFAULT_STORAGE_DIR = "CONFIG/STORAGE";
    }
  });

  // src/core/storage.ts
  function storageDir() {
    const s = tryGetSettings();
    return normalizeStorageDir(s && s.storagePath);
  }
  function storageFile(name, base) {
    const dir = (base || storageDir()).trim().replace(/\/+$/, "");
    return `${dir}/${name}`;
  }
  var init_storage = __esm({
    "src/core/storage.ts"() {
      init_app();
      init_settings_provider();
      init_notice();
      init_storage_path();
    }
  });

  // src/dock/registry.ts
  function vaultRoot() {
    var _a;
    try {
      const a = getApp();
      const adapter = a.vault.adapter;
      const base = (_a = adapter == null ? void 0 : adapter.getBasePath) == null ? void 0 : _a.call(adapter);
      return typeof base === "string" ? base.replace(/\\/g, "/").replace(/\/+$/, "") : "";
    } catch (e) {
      return "";
    }
  }
  function registryPath() {
    const rel = storageFile(REGISTRY_FILENAME);
    const root2 = vaultRoot();
    return root2 ? `${root2}/${rel}` : rel;
  }
  function readRegistry(fs = currentFs()) {
    return readRegistryAt(registryPath(), fs);
  }
  function upsertTool(entry, fs) {
    return upsertToolAt(registryPath(), entry, fs === void 0 ? currentFs() : fs);
  }
  function removeTool(id, fs) {
    return removeToolAt(registryPath(), id, fs === void 0 ? currentFs() : fs);
  }
  function readTrust() {
    const raw = tryGetSettings()[DOCK_TRUST_KEY];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [id, v] of Object.entries(raw)) {
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      const r = v;
      const at = typeof r.at === "string" ? r.at : "";
      const run = typeof r.run === "string" ? r.run : "";
      if (!at) continue;
      out[id] = { at, run };
    }
    return out;
  }
  async function trustTool(id, entry) {
    const trust = readTrust();
    trust[id] = { at: (/* @__PURE__ */ new Date()).toISOString(), run: runSignature(entry) };
    const settings = tryGetSettings();
    settings[DOCK_TRUST_KEY] = trust;
    await saveSettings();
  }
  async function untrustTool(id) {
    const trust = readTrust();
    if (!(id in trust)) return;
    delete trust[id];
    const settings = tryGetSettings();
    settings[DOCK_TRUST_KEY] = trust;
    await saveSettings();
  }
  var DOCK_TRUST_KEY;
  var init_registry = __esm({
    "src/dock/registry.ts"() {
      init_types();
      init_parse();
      init_registry_file();
      init_files();
      init_storage();
      init_app();
      init_settings_provider();
      DOCK_TRUST_KEY = "dockTrust";
    }
  });

  // src/dock/rules.ts
  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  function todayAt(trigger, now) {
    const m = /^(\d{1,2}):(\d{1,2})$/.exec(trigger.at);
    if (!m) return void 0;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) return void 0;
    return startOfDay(now) + (h * 3600 + mi * 60) * 1e3;
  }
  function ruleDue(rule, ctx) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const t = rule.trigger;
    switch (t.kind) {
      case "daily": {
        const at = todayAt(t, ctx.now);
        if (at === void 0) return false;
        if (ctx.now < at) return false;
        return ((_a = ctx.lastFiredAt) != null ? _a : 0) < at;
      }
      case "interval": {
        if (!(t.everyMin > 0)) return false;
        if (ctx.lastFiredAt === void 0) return true;
        return ctx.now - ctx.lastFiredAt >= t.everyMin * 6e4;
      }
      case "on-launch": {
        if (ctx.sessionStart === void 0) return false;
        if (ctx.now < ctx.sessionStart + t.delayMin * 6e4) return false;
        return ((_b = ctx.lastFiredAt) != null ? _b : 0) < ctx.sessionStart;
      }
      case "panel-open":
        return ((_c = ctx.event) == null ? void 0 : _c.kind) === "panel-open";
      case "tool-ok":
        return ((_d = ctx.event) == null ? void 0 : _d.kind) === "tool-ok" && ctx.event.toolId === t.toolId;
      case "tool-fail":
        return ((_e = ctx.event) == null ? void 0 : _e.kind) === "tool-fail" && ctx.event.toolId === t.toolId;
      case "domain-event":
        return ((_f = ctx.event) == null ? void 0 : _f.kind) === "domain-event" && ctx.event.channel === t.channel;
      case "file-change": {
        if (((_g = ctx.event) == null ? void 0 : _g.kind) !== "file-change") return false;
        const p = (_h = ctx.event.path) != null ? _h : "";
        if (!p) return false;
        return p === t.target || p.startsWith(`${t.target}/`);
      }
      case "value-threshold": {
        if (ctx.value === void 0) return false;
        if (t.op === ">") return ctx.value > t.value;
        if (t.op === "<") return ctx.value < t.value;
        return ctx.value === t.value;
      }
    }
  }
  function isEventTrigger(kind) {
    return kind !== "daily" && kind !== "interval" && kind !== "on-launch";
  }
  function nextDueOf(rule, ctx) {
    var _a, _b;
    const t = rule.trigger;
    switch (t.kind) {
      case "daily": {
        const today = todayAt(t, ctx.now);
        if (today === void 0) return null;
        if (ctx.now < today && ((_a = ctx.lastFiredAt) != null ? _a : 0) < today) return today;
        return today + 864e5;
      }
      case "interval": {
        if (!(t.everyMin > 0)) return null;
        if (ctx.lastFiredAt === void 0) return ctx.now;
        return ctx.lastFiredAt + t.everyMin * 6e4;
      }
      case "on-launch": {
        if (ctx.sessionStart === void 0) return null;
        const at = ctx.sessionStart + t.delayMin * 6e4;
        return ((_b = ctx.lastFiredAt) != null ? _b : 0) < ctx.sessionStart ? at : null;
      }
      default:
        return null;
    }
  }
  function clockText(at) {
    const m = /^(\d{1,2}):(\d{1,2})$/.exec(at);
    if (!m) return at;
    return `${pad2(Number(m[1]))}:${pad2(Number(m[2]))}`;
  }
  function durationText(min) {
    if (min >= 60 && min % 60 === 0) return `${min / 60} 小时`;
    return `${min} 分钟`;
  }
  function triggerText(t, nameOf) {
    const name = (id) => nameOf ? nameOf(id) : id;
    switch (t.kind) {
      case "daily":
        return `每天 ${clockText(t.at)}`;
      case "interval":
        return `每 ${durationText(t.everyMin)}`;
      case "on-launch":
        return `启动后 ${durationText(t.delayMin)}`;
      case "panel-open":
        return "打开工具坞时";
      case "tool-ok":
        return `${name(t.toolId)} 成功后`;
      case "tool-fail":
        return `${name(t.toolId)} 失败后`;
      case "domain-event":
        return `事件 ${t.channel}`;
      case "file-change":
        return `${t.target} 有变动`;
      case "value-threshold":
        return `${t.path} 的 ${t.key} ${t.op} ${t.value}`;
    }
  }
  function actionText(a) {
    return a.kind === "remind" ? "只提醒" : "运行";
  }
  function ruleName(rule, index) {
    var _a;
    return ((_a = rule.name) == null ? void 0 : _a.trim()) || `规则 ${index + 1}`;
  }
  function defaultRule(now = Date.now()) {
    return {
      id: `r${now.toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`,
      trigger: { kind: "daily", at: "09:00" },
      action: { kind: "run" }
    };
  }
  var pad2;
  var init_rules = __esm({
    "src/dock/rules.ts"() {
      pad2 = (n) => String(n).padStart(2, "0");
    }
  });

  // src/dock/kernel.ts
  function missingParams(view2) {
    var _a;
    const out = [];
    for (const p of view2.params) {
      if (!p.required) continue;
      const v = view2.values[p.key];
      const empty = v === void 0 || v === null || typeof v === "string" && v.trim() === "" || Array.isArray(v) && v.length === 0;
      if (empty) out.push((_a = p.label) != null ? _a : p.key);
    }
    return out;
  }
  function planTick(input) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    const decisions = [];
    const ready = [];
    for (const view2 of input.views) {
      for (const rule of view2.rules) {
        const ruleState = (_b = (_a = view2.runtime.rules) == null ? void 0 : _a[rule.id]) != null ? _b : {};
        const action = rule.action.kind === "remind" ? "remind" : "run";
        const push = (kind, reason, dueAt2) => {
          decisions.push({ toolId: view2.id, ruleId: rule.id, action, kind, reason, dueAt: dueAt2 });
        };
        const pending = ruleState.pending;
        if (pending) {
          const due = Date.parse(pending.dueAt);
          if (Number.isFinite(due) && due <= input.now) {
            ready.push({ view: view2, rule, runId: pending.runId });
            push("run");
          } else {
            push("skip", "waiting", pending.dueAt);
          }
          continue;
        }
        if (rule.enabled === false) {
          push("skip", "disabled");
          continue;
        }
        if (!input.globalAutoRun) {
          push("skip", "global-off");
          continue;
        }
        if (view2.intent.enabled === false) {
          push("skip", "disabled");
          continue;
        }
        if (view2.intent.autoRun === false) {
          push("skip", "tool-auto-off");
          continue;
        }
        if ((_c = view2.runtime.run) == null ? void 0 : _c.pausedAt) {
          push("skip", "paused");
          continue;
        }
        if (!view2.trusted) {
          push("skip", view2.trustStale ? "untrusted" : "untrusted");
          continue;
        }
        if (!view2.entry || !view2.runnable) {
          push("skip", "no-entry");
          continue;
        }
        if (action === "run" && missingParams(view2).length > 0) {
          push("skip", "missing-params");
          continue;
        }
        if (action === "run" && input.liveIds.has(view2.id)) {
          push("skip", "running");
          continue;
        }
        const lastAttempt = Date.parse((_e = (_d = view2.runtime.run) == null ? void 0 : _d.lastAttemptAt) != null ? _e : "");
        if (action === "run" && ((_f = view2.runtime.run) == null ? void 0 : _f.lastAttemptOk) === false && Number.isFinite(lastAttempt) && input.now - lastAttempt < FAIL_COOLDOWN_MS) {
          push("skip", "cooldown");
          continue;
        }
        const ctx = {
          now: input.now,
          lastFiredAt: Number.isFinite(Date.parse((_g = ruleState.lastFiredAt) != null ? _g : "")) ? Date.parse(ruleState.lastFiredAt) : void 0,
          sessionStart: input.sessionStart
        };
        const hit = ruleDue(rule, ctx) || ((_h = input.events) != null ? _h : []).some((e) => {
          if ((e.kind === "tool-ok" || e.kind === "tool-fail") && e.toolId === view2.id) return false;
          return ruleDue(rule, { ...ctx, event: e });
        });
        if (!hit) continue;
        const jitterMin = (_i = rule.jitterMin) != null ? _i : 0;
        const delayMs = jitterMin > 0 ? Math.floor(Math.random() * jitterMin * 6e4) : 0;
        const dueAt = new Date(input.now + delayMs).toISOString();
        push("queue", delayMs > 0 ? "jitter" : void 0, dueAt);
      }
    }
    return { decisions, ready };
  }
  async function runTick(deps2) {
    var _a, _b;
    const plan = planTick({
      views: deps2.views,
      now: deps2.now,
      sessionStart: deps2.sessionStart,
      events: deps2.events,
      globalAutoRun: deps2.registry.autoRun,
      liveIds: deps2.liveIds
    });
    const ran = [];
    let executed = 0;
    const jobs = plan.ready.map((r) => ({
      toolId: r.view.id,
      ruleId: r.rule.id,
      runId: r.runId
    }));
    for (const d of plan.decisions) {
      if (d.kind !== "queue" || !d.dueAt) continue;
      const view2 = deps2.views.find((v) => v.id === d.toolId);
      if (!view2) continue;
      const rule = view2.rules.find((r) => r.id === d.ruleId);
      if (!rule) continue;
      if (d.action === "remind") {
        (_a = deps2.remind) == null ? void 0 : _a.call(deps2, view2, rule);
        patchRule(view2, rule.id, { lastFiredAt: new Date(deps2.now).toISOString(), lastStatus: "ok" }, deps2.fs);
        continue;
      }
      const runId = makeRunId(deps2.now);
      patchRule(
        view2,
        rule.id,
        { pending: { runId, dueAt: d.dueAt, claimedAt: new Date(deps2.now).toISOString() } },
        deps2.fs
      );
      if (Date.parse(d.dueAt) <= deps2.now) jobs.push({ toolId: view2.id, ruleId: rule.id, runId });
    }
    while (jobs.length && executed < MAX_RUNS_PER_TICK) {
      if ((_b = deps2.shouldStop) == null ? void 0 : _b.call(deps2)) break;
      const job = jobs.shift();
      const view2 = deps2.views.find((v) => v.id === job.toolId);
      if (!view2) continue;
      const rule = view2.rules.find((r) => r.id === job.ruleId);
      if (!rule) continue;
      markStarted(view2, rule.id, job.runId, deps2.now, deps2.fs);
      executed += 1;
      const startedAt = (/* @__PURE__ */ new Date()).toISOString();
      let outcome;
      try {
        outcome = await deps2.execute(view2, rule, job.runId);
      } catch (e) {
        outcome = {
          ok: false,
          status: "failed",
          runId: job.runId,
          code: null,
          stderr: "",
          error: e instanceof Error ? e : new Error(String(e)),
          kind: "config",
          startedAt,
          finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
          durationMs: 0,
          recordMissing: "bz 自己出错，没跑起来"
        };
      }
      settle(view2, job.ruleId, job.runId, outcome, deps2.fs);
      ran.push({ toolId: view2.id, ruleId: job.ruleId, runId: job.runId, status: outcome.status });
    }
    return { decisions: plan.decisions, ran, executed };
  }
  function patchRule(view2, ruleId, patch, fs) {
    var _a, _b;
    const runtime = view2.runtime;
    const rules = { ...(_a = runtime.rules) != null ? _a : {} };
    rules[ruleId] = { ...(_b = rules[ruleId]) != null ? _b : {}, ...patch };
    view2.runtime = { ...runtime, rules };
    writeRuntime(view2.path, view2.runtime, fs != null ? fs : null);
  }
  function settle(view2, ruleId, runId, outcome, fs) {
    var _a, _b, _c;
    const now = outcome.finishedAt || (/* @__PURE__ */ new Date()).toISOString();
    const runtime = { ...view2.runtime, rules: { ...(_a = view2.runtime.rules) != null ? _a : {} } };
    const rules = runtime.rules;
    rules[ruleId] = { lastFiredAt: now, lastRunId: runId, lastStatus: outcome.status };
    const facts = { ...(_b = runtime.run) != null ? _b : {} };
    facts.lastAttemptAt = now;
    facts.lastAttemptOk = outcome.ok;
    if (outcome.ok) {
      delete facts.consecutiveFailures;
      delete facts.pausedAt;
    } else if (outcome.status !== "stopped") {
      const fails = ((_c = facts.consecutiveFailures) != null ? _c : 0) + 1;
      facts.consecutiveFailures = fails;
      if (fails >= BREAKER_THRESHOLD) facts.pausedAt = now;
    }
    runtime.run = facts;
    view2.runtime = runtime;
    writeRuntime(view2.path, runtime, fs != null ? fs : null);
  }
  function clearBreaker(view2, fs) {
    const runtime = { ...view2.runtime };
    if (runtime.run) {
      const facts = { ...runtime.run };
      delete facts.pausedAt;
      delete facts.consecutiveFailures;
      runtime.run = facts;
    }
    view2.runtime = runtime;
    writeRuntime(view2.path, runtime, fs != null ? fs : null);
  }
  function markStarted(view2, ruleId, runId, now, fs) {
    var _a, _b, _c, _d, _e;
    const pending = (_b = (_a = view2.runtime.rules) == null ? void 0 : _a[ruleId]) == null ? void 0 : _b.pending;
    const at = new Date(now).toISOString();
    patchRule(
      view2,
      ruleId,
      {
        pending: {
          runId,
          dueAt: (_c = pending == null ? void 0 : pending.dueAt) != null ? _c : at,
          claimedAt: (_d = pending == null ? void 0 : pending.claimedAt) != null ? _d : at,
          startedAt: at,
          attempts: ((_e = pending == null ? void 0 : pending.attempts) != null ? _e : 0) + 1
        }
      },
      fs
    );
  }
  function reclaimStale(view2, now, fs) {
    var _a, _b, _c, _d;
    const rules = { ...(_a = view2.runtime.rules) != null ? _a : {} };
    let verdict = null;
    for (const [id, st] of Object.entries(rules)) {
      const pending = st.pending;
      if (!(pending == null ? void 0 : pending.startedAt)) continue;
      const started = Date.parse(pending.startedAt);
      if (!Number.isFinite(started) || now - started <= RUN_TIMEOUT_MS + 6e4) continue;
      if (((_b = pending.attempts) != null ? _b : 1) < MAX_ATTEMPTS) {
        rules[id] = { ...st, pending: { ...pending, startedAt: void 0 } };
        verdict = "requeue";
      } else {
        const facts = { ...(_c = view2.runtime.run) != null ? _c : {} };
        facts.lastAttemptAt = new Date(now).toISOString();
        facts.lastAttemptOk = false;
        facts.consecutiveFailures = ((_d = facts.consecutiveFailures) != null ? _d : 0) + 1;
        if (facts.consecutiveFailures >= BREAKER_THRESHOLD) facts.pausedAt = new Date(now).toISOString();
        rules[id] = { ...st, lastFiredAt: new Date(now).toISOString(), lastStatus: "abandoned" };
        delete rules[id].pending;
        view2.runtime = { ...view2.runtime, run: facts };
        verdict = "abandon";
      }
    }
    if (verdict) {
      view2.runtime = { ...view2.runtime, rules };
      writeRuntime(view2.path, view2.runtime, fs != null ? fs : null);
    }
    return verdict;
  }
  var MAX_RUNS_PER_TICK, MAX_ATTEMPTS;
  var init_kernel = __esm({
    "src/dock/kernel.ts"() {
      init_types();
      init_rules();
      init_parse();
      init_files();
      MAX_RUNS_PER_TICK = 8;
      MAX_ATTEMPTS = 3;
    }
  });

  // src/core/external-tool.ts
  function parseAskBody(body) {
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return null;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return null;
    const raw = typeof body.body === "string" ? body.body : "";
    const html = typeof body.bodyHtml === "string" ? body.bodyHtml.trim() : "";
    const sec = Number(body.timeoutSec);
    const timeoutSec = Number.isFinite(sec) ? Math.min(ASK_TIMEOUT_MAX_SEC, Math.max(ASK_TIMEOUT_MIN_SEC, Math.floor(sec))) : ASK_TIMEOUT_DEFAULT_SEC;
    return {
      id,
      title,
      body: raw,
      bodyHtml: html,
      confirmText: typeof body.confirmText === "string" && body.confirmText.trim() ? body.confirmText.trim() : "确认",
      cancelText: typeof body.cancelText === "string" && body.cancelText.trim() ? body.cancelText.trim() : "取消",
      timeoutSec
    };
  }
  function parseBzLine(line) {
    const text = line.endsWith("\r") ? line.slice(0, -1) : line;
    const m = text.match(BZ_LINE_PREFIX_RE);
    if (!m) {
      if (!text.trim()) return null;
      return { kind: "raw", text };
    }
    const body = text.slice(m[0].length).trim();
    switch (m[1]) {
      case "step":
        return body ? { kind: "step", text: body } : null;
      case "p": {
        const p = parseJsonObject(body);
        if (!p) return null;
        return {
          kind: "progress",
          phase: typeof p.phase === "string" ? p.phase : null,
          // pct 允许 null = 该阶段不可估；缺失/非有限数一律归 null（绝不假报）
          pct: Number.isFinite(p.pct) ? Number(p.pct) : null
        };
      }
      case "info": {
        const info = parseJsonObject(body);
        return info ? { kind: "info", data: info } : null;
      }
      case "ask": {
        const b = parseJsonObject(body);
        const ask = b ? parseAskBody(b) : null;
        return ask ? { kind: "ask", ask } : null;
      }
      default: {
        const r = parseJsonObject(body);
        return r ? { kind: "result", data: r } : null;
      }
    }
  }
  function parseJsonObject(body) {
    try {
      const v = JSON.parse(body);
      return v && typeof v === "object" && !Array.isArray(v) ? v : null;
    } catch (e) {
      return null;
    }
  }
  function defaultChildProcess() {
    if (typeof window === "undefined") return null;
    const w = window;
    if (!w.require) return null;
    try {
      return w.require("child_process");
    } catch (e) {
      return null;
    }
  }
  function runExternalTool(spec, cb, deps2) {
    var _a, _b;
    const cp = deps2 && deps2.cp ? deps2.cp : defaultChildProcess();
    const splitter = new BzLineSplitter();
    let stderrTail = "";
    let settled = false;
    let stopped = false;
    let child = null;
    let exitSeen = false;
    let exitCode = null;
    let forceTimer = null;
    let resolveDone;
    const done = new Promise((r) => {
      resolveDone = r;
    });
    const settle2 = (o) => {
      if (settled) return;
      settled = true;
      if (forceTimer !== null) {
        clearTimeout(forceTimer);
        forceTimer = null;
      }
      resolveDone(o);
    };
    const collectStderr = (d) => {
      stderrTail += String(d);
      if (stderrTail.length > STDERR_TAIL_CHARS) stderrTail = stderrTail.slice(-STDERR_TAIL_CHARS);
    };
    const dispatchLine = (line) => {
      var _a2;
      const ev = parseBzLine(line);
      if (!ev) return;
      switch (ev.kind) {
        case "step":
          cb.onStep(ev.text);
          break;
        case "progress":
          cb.onProgress(ev.phase, ev.pct);
          break;
        case "info":
          cb.onInfo(ev.data);
          break;
        case "result":
          cb.onResult(ev.data);
          break;
        case "ask":
          (_a2 = cb.onAsk) == null ? void 0 : _a2.call(cb, ev.ask);
          break;
        case "raw":
          if (cb.onRaw) cb.onRaw(ev.text);
          break;
      }
    };
    if (!cp) {
      settle2({ ok: false, stopped: false, code: null, stderr: "", error: new Error("仅桌面端可用：外部工具需要 Node.js 子进程") });
      return { stop: () => {
      }, answer: () => {
      }, done };
    }
    const spawnOpts = {
      shell: !!spec.shell,
      windowsHide: true,
      // stdin 只在交互运行下开 pipe（见 spec.interactive 的说明）：给所有工具无差别开管道，
      // 等于让一个「顺手读了 stdin」的工具凭空挂住——而它本来只是想要 /dev/null。
      stdio: [spec.interactive ? "pipe" : "ignore", "pipe", "pipe"]
    };
    if (spec.cwd) spawnOpts.cwd = spec.cwd;
    if (spec.env) spawnOpts.env = spec.env;
    try {
      child = cp.spawn(spec.cmd, spec.args || [], spawnOpts);
    } catch (e) {
      settle2({ ok: false, stopped: false, code: null, stderr: stderrTail.trim(), error: new Error(`外部工具启动失败：${(e == null ? void 0 : e.message) || String(e)}`) });
      return { stop: () => {
      }, answer: () => {
      }, done };
    }
    (_a = child.stdout) == null ? void 0 : _a.on("data", (d) => {
      for (const line of splitter.push(d)) dispatchLine(line);
    });
    (_b = child.stderr) == null ? void 0 : _b.on("data", collectStderr);
    child.on("error", (e) => {
      if (settled) return;
      settle2({ ok: false, stopped: false, code: null, stderr: stderrTail.trim(), error: new Error(`外部工具启动失败：${e.message}`) });
    });
    child.on("exit", (code) => {
      exitSeen = true;
      exitCode = code;
    });
    child.on("close", (code) => {
      if (settled) return;
      const rest = splitter.flush();
      if (rest !== null) dispatchLine(rest);
      const stderr = stderrTail.trim();
      if (stopped) {
        settle2({ ok: false, stopped: true, code, stderr, error: null });
        return;
      }
      if (code === 0) {
        settle2({ ok: true, stopped: false, code: 0, stderr, error: null });
        return;
      }
      const err = new Error(code === null ? `外部工具异常退出（无退出码）${stderr ? "：" + stderr : ""}` : `外部工具异常退出（退出码 ${code}）${stderr ? "：" + stderr : ""}`);
      err.stderr = stderr;
      settle2({ ok: false, stopped: false, code, stderr, error: err });
    });
    const isWindows = () => process.platform === "win32";
    const spawnSuppressed = (cmd, args) => {
      var _a2;
      try {
        const killer = cp.spawn(cmd, args, { stdio: "ignore", windowsHide: true });
        (_a2 = killer.on) == null ? void 0 : _a2.call(killer, "error", () => {
        });
      } catch (e) {
      }
    };
    const escalateForceKill = () => {
      forceTimer = null;
      if (settled) return;
      const pid = child == null ? void 0 : child.pid;
      if (typeof pid !== "number" || pid <= 0) return;
      if (exitSeen) {
        settle2({ ok: false, stopped: true, code: exitCode, stderr: stderrTail.trim(), error: null });
        return;
      }
      if (isWindows()) {
        spawnSuppressed("taskkill", ["/pid", String(pid), "/T", "/F"]);
        return;
      }
      try {
        process.kill(pid, "SIGKILL");
      } catch (e) {
      }
    };
    const stopChild = () => {
      var _a2;
      const pid = child == null ? void 0 : child.pid;
      if (spec.shell && isWindows() && typeof pid === "number" && pid > 0) {
        spawnSuppressed("taskkill", ["/pid", String(pid), "/T"]);
      } else {
        try {
          (_a2 = child == null ? void 0 : child.kill) == null ? void 0 : _a2.call(child);
        } catch (e) {
        }
      }
      if (typeof pid === "number" && pid > 0) {
        forceTimer = setTimeout(escalateForceKill, FORCE_KILL_GRACE_MS);
      }
    };
    return {
      stop: () => {
        if (settled || stopped) return;
        stopped = true;
        stopChild();
      },
      answer: (id, ok) => {
        const s = child == null ? void 0 : child.stdin;
        if (!s || s.destroyed || s.writableEnded) return;
        try {
          s.write(`[bz-answer] ${JSON.stringify({ id, ok: !!ok })}
`);
        } catch (e) {
        }
      },
      done
    };
  }
  var ASK_TIMEOUT_DEFAULT_SEC, ASK_TIMEOUT_MIN_SEC, ASK_TIMEOUT_MAX_SEC, BZ_LINE_PREFIX_RE, MAX_LINE_BYTES, BzLineSplitter, STDERR_TAIL_CHARS, FORCE_KILL_GRACE_MS;
  var init_external_tool = __esm({
    "src/core/external-tool.ts"() {
      ASK_TIMEOUT_DEFAULT_SEC = 300;
      ASK_TIMEOUT_MIN_SEC = 10;
      ASK_TIMEOUT_MAX_SEC = 600;
      BZ_LINE_PREFIX_RE = /^\[bz-(step|p|info|result|ask)\]/;
      MAX_LINE_BYTES = 1024 * 1024;
      BzLineSplitter = class {
        constructor(maxLineBytes = MAX_LINE_BYTES) {
          this.maxLineBytes = maxLineBytes;
          this.parts = [];
          this.len = 0;
          this.overflowed = false;
        }
        /** 喂一段 stdout（Buffer 或 string），返回其中切出的完整行（不含行尾符） */
        push(chunk) {
          const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
          const lines = [];
          let pos = 0;
          while (pos < buf.length) {
            const nl = buf.indexOf(10, pos);
            if (nl === -1) {
              this.accumulate(buf.subarray(pos));
              break;
            }
            this.accumulate(buf.subarray(pos, nl));
            lines.push(this.takeLine());
            pos = nl + 1;
          }
          return lines;
        }
        /** 进程终结时冲刷残留半行（无残留返回 null）——无尾换行的最后一行靠这里出列 */
        flush() {
          return this.len > 0 || this.overflowed ? this.takeLine() : null;
        }
        /** 累积字节；超出单行上限后丢弃后续字节（截断语义，待换行时一并出列） */
        accumulate(part) {
          if (this.overflowed) return;
          const room = this.maxLineBytes - this.len;
          if (part.length <= room) {
            this.parts.push(part);
            this.len += part.length;
          } else {
            this.parts.push(part.subarray(0, room));
            this.len = this.maxLineBytes;
            this.overflowed = true;
          }
        }
        /** 出列一行（overflow 时为截断行）；CRLF 的 \r 在此剥除 */
        takeLine() {
          const s = Buffer.concat(this.parts).toString("utf8");
          this.parts = [];
          this.len = 0;
          this.overflowed = false;
          return s.endsWith("\r") ? s.slice(0, -1) : s;
        }
      };
      STDERR_TAIL_CHARS = 2048;
      FORCE_KILL_GRACE_MS = 3e3;
    }
  });

  // src/dock/exec.ts
  function dockEnv(input) {
    const env = {
      BZ_DOCK_CONTRACT: String(CONTRACT_VERSION),
      BZ_DOCK_TOOL: input.toolId,
      BZ_DOCK_RUN_ID: input.runId,
      BZ_DOCK_TRIGGER: input.trigger,
      BZ_DOCK_RUNS_FILE: pathOf.runs(input.declPath),
      BZ_DOCK_HEARTBEAT_FILE: pathOf.heartbeat(input.declPath)
    };
    if (input.vaultPath) env.BZ_DOCK_VAULT = input.vaultPath.replace(/[\\/]+$/, "");
    if (input.manifest) Object.assign(env, secretEnvOf(input.manifest, input.values));
    return env;
  }
  function judgeRun(input, records) {
    var _a, _b;
    const base = {
      runId: input.runId,
      code: input.code,
      signal: input.signal,
      stderr: input.stderr,
      error: input.error,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      durationMs: input.durationMs
    };
    if (input.stopped) {
      return { ...base, ok: false, status: "stopped", kind: "aborted", record: findByRunId(records, input.runId) };
    }
    if (input.timedOut) {
      return { ...base, ok: false, status: "timeout", kind: "timeout", record: findByRunId(records, input.runId) };
    }
    const record = findByRunId(records, input.runId);
    if (record) {
      const status = record.status === "running" ? "abandoned" : record.status;
      return {
        ...base,
        ok: status === "ok",
        status,
        kind: (_b = (_a = record.error) == null ? void 0 : _a.kind) != null ? _b : status === "ok" ? "unknown" : "unknown",
        record: { ...record, status }
      };
    }
    const ok = input.code === 0 && !input.error;
    const kind = input.code === null ? "config" : "unknown";
    return {
      ...base,
      ok,
      status: ok ? "ok" : "failed",
      kind,
      recordMissing: input.code === null ? "进程没能启动（命令或工作目录配错了）" : "工具没写这次运行的记录，多半没跑到写记录那一步"
    };
  }
  function liveOf(toolId) {
    return live2.get(toolId);
  }
  function liveAll() {
    return Array.from(live2.values()).sort((a, b) => (Date.parse(a.startedAt) || 0) - (Date.parse(b.startedAt) || 0));
  }
  function onLiveChanged(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function fireLive() {
    for (const fn of listeners) {
      try {
        fn();
      } catch (e) {
      }
    }
  }
  function stopLive(toolId) {
    var _a;
    (_a = live2.get(toolId)) == null ? void 0 : _a.handle.stop();
  }
  function runToolNow(args) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    const runId = (_a = args.runId) != null ? _a : makeRunId();
    const trigger = (_b = args.trigger) != null ? _b : "manual";
    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    const rawTail = [];
    const steps = [];
    const spec = {
      cmd: args.entry.cmd,
      args: [...(_c = args.entry.args) != null ? _c : [], ...buildArgs((_d = args.manifest) != null ? _d : { params: [] }, args.values), ...(_e = args.extraArgs) != null ? _e : []],
      shell: (_f = args.entry.shell) != null ? _f : /\.(cmd|bat)$/i.test(args.entry.cmd),
      /**
       * 工作目录，契约写的是「缺省 = 声明所在目录」。
       *
       * 这一句必须显式给：不给的话子进程继承宿主进程的 cwd —— 插件里是 Obsidian 的目录，
       * 值守里是仓库根。两种都不是工具目录，「`args: ['main.mjs']` 的相对路径」当场失效，
       * 症状是「面板上跑得起来、值守里报找不到文件」。
       */
      cwd: (_g = args.entry.cwd) != null ? _g : dirOf(args.declPath),
      env: dockEnv({
        toolId: args.toolId,
        declPath: args.declPath,
        runId,
        trigger,
        vaultPath: args.vaultPath,
        manifest: args.manifest,
        values: args.values
      }),
      interactive: typeof ((_h = args.cb) == null ? void 0 : _h.onAsk) === "function"
    };
    let phase = null;
    let pct = null;
    let timedOut = false;
    let handleRef = null;
    const handle = runExternalTool(
      spec,
      {
        onStep: (text) => {
          var _a2, _b2;
          steps.push({ text, at: (/* @__PURE__ */ new Date()).toISOString(), status: "ok" });
          (_b2 = (_a2 = args.cb) == null ? void 0 : _a2.onStep) == null ? void 0 : _b2.call(_a2, text);
        },
        onProgress: (p, v) => {
          var _a2, _b2;
          phase = p;
          pct = v;
          (_b2 = (_a2 = args.cb) == null ? void 0 : _a2.onProgress) == null ? void 0 : _b2.call(_a2, p, v);
        },
        onInfo: (d) => {
          var _a2, _b2;
          return (_b2 = (_a2 = args.cb) == null ? void 0 : _a2.onInfo) == null ? void 0 : _b2.call(_a2, d);
        },
        onResult: (d) => {
          var _a2, _b2;
          return (_b2 = (_a2 = args.cb) == null ? void 0 : _a2.onResult) == null ? void 0 : _b2.call(_a2, d);
        },
        onRaw: (t) => {
          rawTail.push(t);
          if (rawTail.length > 200) rawTail.shift();
        },
        onAsk: (req) => {
          var _a2, _b2;
          const ask = (_a2 = args.cb) == null ? void 0 : _a2.onAsk;
          if (!ask) {
            (_b2 = handleRef == null ? void 0 : handleRef.answer) == null ? void 0 : _b2.call(handleRef, req.id, false);
            return;
          }
          void Promise.resolve().then(() => ask(req)).then((yes) => {
            var _a3;
            return (_a3 = handleRef == null ? void 0 : handleRef.answer) == null ? void 0 : _a3.call(handleRef, req.id, !!yes);
          }).catch(() => {
            var _a3;
            return (_a3 = handleRef == null ? void 0 : handleRef.answer) == null ? void 0 : _a3.call(handleRef, req.id, false);
          });
        }
      },
      deps
    );
    handleRef = handle;
    const run = {
      runId,
      toolId: args.toolId,
      trigger,
      startedAt,
      steps,
      phase,
      pct,
      rawTail,
      handle,
      done: Promise.resolve(void 0)
    };
    const timeoutMs = (_i = args.timeoutMs) != null ? _i : RUN_TIMEOUT_MS;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      handle.stop();
    }, timeoutMs) : null;
    run.done = handle.done.then((o) => {
      var _a2, _b2;
      if (timer) clearTimeout(timer);
      const finishedAt = (/* @__PURE__ */ new Date()).toISOString();
      const outcome = judgeRun(
        {
          runId,
          toolId: args.toolId,
          startedAt,
          finishedAt,
          durationMs: Date.parse(finishedAt) - startedMs,
          code: o.code,
          stopped: o.stopped && !timedOut,
          timedOut,
          error: o.error,
          stderr: o.stderr
        },
        args.records()
      );
      live2.delete(args.toolId);
      fireLive();
      (_b2 = (_a2 = args.cb) == null ? void 0 : _a2.onDone) == null ? void 0 : _b2.call(_a2, outcome);
      return outcome;
    });
    live2.set(args.toolId, run);
    fireLive();
    return run;
  }
  var deps, live2, listeners;
  var init_exec = __esm({
    "src/dock/exec.ts"() {
      init_external_tool();
      init_parse();
      init_files();
      init_types();
      live2 = /* @__PURE__ */ new Map();
      listeners = /* @__PURE__ */ new Set();
    }
  });

  // src/core/domain-bus.ts
  var init_domain_bus = __esm({
    "src/core/domain-bus.ts"() {
    }
  });

  // src/dock/lock.ts
  function pidAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    const proc = globalThis.process;
    if (!(proc == null ? void 0 : proc.kill)) return true;
    try {
      proc.kill(pid, 0);
      return true;
    } catch (e) {
      return (e == null ? void 0 : e.code) === "EPERM";
    }
  }
  function newToken() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  function readLock(fs, path) {
    const text = fs.readText(path);
    if (!text) return null;
    try {
      const v = JSON.parse(text);
      if (typeof v.owner !== "string" || typeof v.token !== "string" || typeof v.at !== "string") return null;
      return {
        owner: v.owner,
        pid: typeof v.pid === "number" ? v.pid : 0,
        bootId: typeof v.bootId === "string" ? v.bootId : "",
        at: v.at,
        token: v.token
      };
    } catch (e) {
      return null;
    }
  }
  function lockPathOf(dataDir2) {
    return joinPath(dataDir2, LOCK_FILENAME);
  }
  function acquireLock(dataDir2, owner, opts = {}) {
    var _a, _b, _c, _d, _e, _f, _g;
    const fs = (_a = opts.fs) != null ? _a : currentFs();
    if (!fs) return null;
    const path = lockPathOf(dataDir2);
    const staleMs = (_b = opts.staleMs) != null ? _b : LOCK_STALE_MS;
    const now = (_c = opts.now) != null ? _c : Date.now();
    const token = newToken();
    const info = {
      owner,
      pid: (_e = (_d = globalThis.process) == null ? void 0 : _d.pid) != null ? _e : 0,
      bootId: (_f = opts.bootId) != null ? _f : "",
      at: new Date(now).toISOString(),
      token
    };
    const text = JSON.stringify(info);
    if (fs.mkdir) fs.mkdir(dataDir2);
    const take = () => {
      const ok = fs.createExclusive ? fs.createExclusive(path, text) : false;
      if (ok) return handleOf(fs, path, token);
      if (!fs.createExclusive && fs.readText(path) === null) {
        fs.writeText(path, text);
        return handleOf(fs, path, token);
      }
      return null;
    };
    const first = take();
    if (first) return first;
    const held = readLock(fs, path);
    const expiredByTime = !held || now - Date.parse(held.at) > staleMs || !Number.isFinite(Date.parse((_g = held == null ? void 0 : held.at) != null ? _g : ""));
    const expiredByPid = !!held && held.pid > 0 && !pidAlive(held.pid);
    if (!expiredByTime && !expiredByPid) return null;
    const saved = `${path}.stale.${token}`;
    if (fs.rename) {
      try {
        fs.rename(path, saved);
      } catch (e) {
        return null;
      }
      if (fs.unlink) {
        try {
          fs.unlink(saved);
        } catch (e) {
        }
      }
    } else if (fs.unlink) {
      try {
        fs.unlink(path);
      } catch (e) {
        return null;
      }
    } else {
      return null;
    }
    return take();
  }
  function handleOf(fs, path, token) {
    let lost = false;
    return {
      token,
      lost() {
        return lost;
      },
      renew() {
        const held = readLock(fs, path);
        if (!held || held.token !== token) {
          lost = true;
          return false;
        }
        const next = JSON.stringify({ ...held, at: (/* @__PURE__ */ new Date()).toISOString() });
        if (fs.rename) {
          const tmp = `${path}.${token}.tmp`;
          try {
            fs.writeText(tmp, next);
            fs.rename(tmp, path);
          } catch (e) {
            return false;
          }
        } else {
          fs.writeText(path, next);
        }
        const after = readLock(fs, path);
        const mine = !!after && after.token === token;
        if (!mine) lost = true;
        return mine;
      },
      release() {
        const held = readLock(fs, path);
        if (held && held.token === token && fs.unlink) {
          try {
            fs.unlink(path);
          } catch (e) {
          }
        }
      }
    };
  }
  async function withLock(dataDir2, owner, fn, opts = {}) {
    const lock = acquireLock(dataDir2, owner, opts);
    if (!lock) return null;
    const hb = opts.keepAliveMs && opts.keepAliveMs > 0 ? setInterval(() => {
      lock.renew();
    }, opts.keepAliveMs) : null;
    try {
      return await fn(lock);
    } finally {
      if (hb) clearInterval(hb);
      lock.release();
    }
  }
  var init_lock = __esm({
    "src/dock/lock.ts"() {
      init_types();
      init_files();
    }
  });

  // src/dock/tick-once.ts
  async function tickOnce(opts) {
    var _a, _b, _c;
    const fs = opts.fs === void 0 ? currentFs() : opts.fs;
    if (!fs) return { skipped: "no-fs" };
    const now = (_a = opts.now) != null ? _a : Date.now();
    let inner;
    try {
      inner = await withLock(
        opts.dataDir,
        opts.owner,
        async (lock) => {
          var _a2, _b2, _c2, _d;
          const { registry } = readRegistryAt(opts.registryPath, fs);
          if (!registry.autoRun) return { skip: "auto-run-off", registry, views: [] };
          if (opts.respectWatchdog && !registry.watchdog) return { skip: "watchdog-off", registry, views: [] };
          const views2 = loadToolViews(registry.tools, { trust: opts.trust, fs });
          for (const view2 of views2) {
            try {
              reclaimStale(view2, now, fs);
            } catch (e) {
              (_a2 = opts.onError) == null ? void 0 : _a2.call(opts, e);
            }
          }
          const result = await runTick({
            dataDir: opts.dataDir,
            registry,
            views: views2,
            now,
            sessionStart: opts.sessionStart,
            events: (_b2 = opts.events) != null ? _b2 : [],
            liveIds: (_c2 = opts.liveIds) != null ? _c2 : /* @__PURE__ */ new Set(),
            fs,
            execute: (view2, rule, runId) => executeOne(view2, rule, runId, opts, fs),
            remind: (view2, rule) => {
              var _a3;
              return (_a3 = opts.onRemind) == null ? void 0 : _a3.call(opts, view2, rule);
            },
            shouldStop: () => lock.lost()
          });
          (_d = opts.onPlan) == null ? void 0 : _d.call(opts, result.decisions, result);
          return { registry, views: views2, result };
        },
        { fs, now, keepAliveMs: (_b = opts.keepAliveMs) != null ? _b : KEEP_ALIVE_MS }
      );
    } catch (e) {
      (_c = opts.onError) == null ? void 0 : _c.call(opts, e);
      return { skipped: "error" };
    }
    if (inner === null) return { skipped: "locked" };
    return { skipped: inner.skip, registry: inner.registry, views: inner.views, result: inner.result };
  }
  async function executeOne(view2, rule, runId, opts, fs) {
    var _a;
    const at = (/* @__PURE__ */ new Date()).toISOString();
    if (!view2.entry) {
      return {
        ok: false,
        status: "failed",
        runId,
        code: null,
        stderr: "",
        error: new Error("没有可执行的启动命令"),
        kind: "config",
        startedAt: at,
        finishedAt: at,
        durationMs: 0,
        recordMissing: "声明里没有 entry，跑不起来"
      };
    }
    const live3 = runToolNow({
      toolId: view2.id,
      declPath: view2.path,
      entry: view2.entry,
      manifest: view2.manifest,
      values: view2.values,
      vaultPath: opts.vaultPath,
      trigger: "auto",
      // 工单号由内核定（pending 里已经记下），这里必须原样传
      runId,
      records: () => parseRunLines(readRunsText(pathOf.runs(view2.path), fs, RUNS_TAIL_BYTES), view2.id)
    });
    const outcome = await live3.done;
    (_a = opts.onOutcome) == null ? void 0 : _a.call(opts, view2, outcome);
    return outcome;
  }
  var KEEP_ALIVE_MS;
  var init_tick_once = __esm({
    "src/dock/tick-once.ts"() {
      init_kernel();
      init_lock();
      init_view();
      init_registry_file();
      init_files();
      init_parse();
      init_exec();
      init_types();
      KEEP_ALIVE_MS = 2e4;
    }
  });

  // src/dock/host.ts
  function vaultBasePath(a) {
    var _a;
    const adapter = a.vault.adapter;
    try {
      return (_a = adapter == null ? void 0 : adapter.getBasePath) == null ? void 0 : _a.call(adapter);
    } catch (e) {
      return void 0;
    }
  }
  function dataDir() {
    return dirOf(registryPath());
  }
  function kickDockScheduler() {
    return tick();
  }
  function notifyDockEvent(ev) {
    if (app === null) return;
    pendingEvents.push(ev);
    if (pendingEvents.length > 200) pendingEvents = pendingEvents.slice(-200);
    void kickDockScheduler();
  }
  async function tick() {
    const a = app;
    if (a === null || unloaded === null || ticking) return;
    if (unloaded()) return;
    ticking = true;
    try {
      const res = await tickOnce({
        dataDir: dataDir(),
        registryPath: registryPath(),
        trust: readTrust(),
        sessionStart,
        events: pendingEvents,
        vaultPath: vaultBasePath(a),
        owner: "plugin",
        liveIds: new Set(liveAll().map((r) => r.toolId)),
        onOutcome: announce,
        onRemind: remindOf
      });
      if (!res.result) return;
      pendingEvents = [];
      if (res.views) reportMissingParams(res.result.decisions, res.views);
    } catch (e) {
    } finally {
      ticking = false;
    }
  }
  function announce(view2, outcome) {
    var _a, _b, _c;
    const name = (_b = (_a = view2.manifest) == null ? void 0 : _a.name) != null ? _b : view2.id;
    if (outcome.ok) {
      notify(`${name} 跑完了`, { type: "success" });
      return;
    }
    if (outcome.status === "stopped") {
      notify(`${name} 已中止`, { type: "warning" });
      return;
    }
    notify(`${name} 失败：${(_c = outcome.recordMissing) != null ? _c : "看运行记录里的 stderr 尾部"}`, { type: "error" });
  }
  function remindOf(view2, rule) {
    var _a, _b, _c;
    const why = ((_a = rule.name) == null ? void 0 : _a.trim()) || "规则";
    notify(`${(_c = (_b = view2.manifest) == null ? void 0 : _b.name) != null ? _c : view2.id}：该手动跑一次了（${why}）`, { type: "info" });
  }
  function reportMissingParams(decisions, views2) {
    var _a, _b;
    for (const d of decisions) {
      if (d.reason !== "missing-params" || warned.has(d.toolId)) continue;
      warned.add(d.toolId);
      const v = views2.find((x) => x.id === d.toolId);
      if (v) notify(`${(_b = (_a = v.manifest) == null ? void 0 : _a.name) != null ? _b : v.id} 没自动跑：必填参数还没填`, { type: "warning" });
    }
  }
  async function runToolManually(view2, opts = {}) {
    const a = app;
    if (!a) return null;
    if (liveOf(view2.id)) return null;
    const outcome = await withLock(dataDir(), "plugin", async () => {
      if (!view2.entry) return null;
      const live3 = runToolNow({
        toolId: view2.id,
        declPath: view2.path,
        entry: view2.entry,
        manifest: view2.manifest,
        values: view2.values,
        vaultPath: vaultBasePath(a),
        trigger: "manual",
        extraArgs: opts.extraArgs,
        runId: makeRunId(),
        records: () => parseRunLines(readRunsText(pathOf.runs(view2.path), currentFs(), RUNS_TAIL_BYTES), view2.id),
        cb: { onStep: opts.onStep }
      });
      return live3.done;
    }, { keepAliveMs: KEEP_ALIVE_MS });
    if (outcome) announce(view2, outcome);
    return outcome;
  }
  async function clearBreakerSafely(view2) {
    const ok = await withLock(dataDir(), "plugin", () => {
      clearBreaker(view2);
      return true;
    }, { keepAliveMs: KEEP_ALIVE_MS });
    return ok === true;
  }
  var app, unloaded, sessionStart, ticking, pendingEvents, warned;
  var init_host = __esm({
    "src/dock/host.ts"() {
      init_fake_obsidian();
      init_notice();
      init_domain_bus();
      init_files();
      init_kernel();
      init_exec();
      init_lock();
      init_tick_once();
      init_view();
      init_registry();
      init_files();
      init_parse();
      init_types();
      app = null;
      unloaded = null;
      sessionStart = 0;
      ticking = false;
      pendingEvents = [];
      warned = /* @__PURE__ */ new Set();
    }
  });

  // prototypes/dock/fake-sim.ts
  var fake_sim_exports = {};
  __export(fake_sim_exports, {
    boot: () => boot,
    closeDock: () => closeDock,
    openDock: () => openDock,
    unloadDock: () => unloadDock
  });
  init_fake_obsidian();
  init_app();
  init_settings_provider();
  init_files();

  // src/dock/ui.ts
  init_fake_obsidian();
  init_notice();
  init_view();
  init_registry();
  init_files();
  init_parse();
  init_rules();
  init_kernel();

  // src/dock/command.ts
  init_fake_obsidian();
  init_notice();
  init_view();
  init_registry();
  init_kernel();
  init_exec();
  function judgeRunGate(view2, canRun) {
    if (!view2) return { ok: false, reason: "no-tool", text: "这个工具没登记" };
    if (!canRun) return { ok: false, reason: "mobile", text: "手机上只能看，不能跑" };
    if (!view2.entry) return { ok: false, reason: "no-entry", text: "声明里没有启动命令（entry）" };
    if (!view2.trusted) return { ok: false, reason: "untrusted", text: "这条命令还没授权，先在面板里确认" };
    if (liveOf(view2.id)) return { ok: false, reason: "running", text: "它正在跑" };
    const missing = missingParams(view2);
    if (missing.length) return { ok: false, reason: "params", text: `还有必填参数没填：${missing.join("、")}` };
    return { ok: true };
  }

  // src/dock/ui.ts
  init_exec();
  init_host();
  init_types();
  var root = null;
  var bodyEl = null;
  var titleEl = null;
  var app2 = null;
  var view = "list";
  var detailId = "";
  var pollTimer = null;
  var detailKey = "";
  var liveOff = null;
  function ensureDock(a) {
    app2 = a;
    if (root) return;
    root = document.body.createDiv({ cls: "bz-dock-overlay" });
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "工具坞");
    const sheet = root.createDiv({ cls: "bz-dock-sheet" });
    const head = sheet.createDiv({ cls: "bz-dock-head" });
    titleEl = head.createSpan({ cls: "bz-dock-title", text: "工具坞" });
    const tools = head.createDiv({ cls: "bz-dock-head-tools" });
    iconBtn(tools, "folder-input", "导入工具", () => pickFolder());
    iconBtn(tools, "refresh-cw", "刷新", () => render());
    iconBtn(tools, "x", "关闭", () => closeDock());
    bodyEl = sheet.createDiv({ cls: "bz-dock-body" });
    root.addEventListener("click", (e) => {
      if (e.target === root) closeDock();
    });
    document.addEventListener("keydown", onKey);
    liveOff = onLiveChanged(() => {
      if (view === "detail") renderDetail();
      else renderListMeta();
    });
  }
  function onKey(e) {
    if (!root || root.hasClass("is-hidden")) return;
    if (e.key === "Escape") {
      if (view === "detail") showList();
      else closeDock();
    }
  }
  function openDock(a) {
    ensureDock(a);
    if (!root) return;
    root.removeClass("is-hidden");
    showList();
    notifyDockEvent({ kind: "panel-open" });
    startPoll();
  }
  function closeDock() {
    if (!root) return;
    root.addClass("is-hidden");
    stopPoll();
  }
  function unloadDock() {
    stopPoll();
    document.removeEventListener("keydown", onKey);
    liveOff == null ? void 0 : liveOff();
    liveOff = null;
    root == null ? void 0 : root.remove();
    root = null;
    bodyEl = null;
    titleEl = null;
    app2 = null;
    view = "list";
    detailId = "";
  }
  function startPoll() {
    stopPoll();
    pollTimer = setInterval(() => {
      if (!root || root.hasClass("is-hidden")) return;
      if (view === "detail") {
        const v = viewOf(detailId);
        if (!v || detailSignature(v) !== detailKey) renderDetail();
      } else {
        renderListMeta();
      }
    }, 3e3);
  }
  function detailSignature(v) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    return [
      v.id,
      v.path,
      v.trusted ? "1" : "0",
      v.trustStale ? "1" : "0",
      (_b = (_a = v.runtime.run) == null ? void 0 : _a.lastAttemptAt) != null ? _b : "",
      (_d = (_c = v.runtime.run) == null ? void 0 : _c.pausedAt) != null ? _d : "",
      (_f = (_e = v.lastRun) == null ? void 0 : _e.runId) != null ? _f : "",
      (_h = (_g = v.lastRun) == null ? void 0 : _g.status) != null ? _h : "",
      // 运行态也算「变了」：不然开始跑/跑完的那一刻，详情页不会重绘那块「正在跑」
      liveOf(v.id) ? "live" : freshOf(v.heartbeat) ? "ext" : "",
      String(v.rules.length)
    ].join("|");
  }
  function stopPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }
  function views() {
    const { registry } = readRegistry();
    return loadToolViews(registry.tools, {
      trust: readTrust(),
      canRun: !Platform.isMobile,
      fs: currentFs()
    });
  }
  function viewOf(id) {
    const { registry } = readRegistry();
    const entry = registry.tools.find((t) => t.id === id);
    if (!entry) return void 0;
    return loadToolView(entry, { trust: readTrust(), canRun: !Platform.isMobile, fs: currentFs() });
  }
  function showList() {
    view = "list";
    detailId = "";
    if (titleEl) titleEl.setText("工具坞");
    render();
  }
  function render() {
    if (!bodyEl) return;
    bodyEl.empty();
    if (view === "detail") {
      renderDetail();
      return;
    }
    const all = views();
    renderSummary(all);
    if (!all.length) {
      const empty = bodyEl.createDiv({ cls: "bz-dock-empty" });
      empty.createDiv({ cls: "bz-dock-empty-title", text: "还没有登记任何工具" });
      empty.createDiv({
        cls: "bz-dock-empty-desc",
        text: "选一个含 manifest.json 的文件夹。bz 只读它、不执行 —— 看清它要跑什么，再决定授不授权。"
      });
      const btn = btnOf(empty, "导入工具文件夹", "mod-cta");
      btn.addEventListener("click", () => pickFolder());
      return;
    }
    const auto = all.filter((v) => v.rules.some((r) => r.enabled !== false));
    const manual = all.filter((v) => !v.rules.some((r) => r.enabled !== false));
    if (auto.length) section("自动运行", auto);
    if (manual.length) section("手动", manual);
  }
  function externalRunOf(v) {
    if (liveOf(v.id)) return null;
    return freshOf(v.heartbeat);
  }
  function freshOf(hb) {
    if (!hb) return null;
    const at = Date.parse(hb.at);
    if (!Number.isFinite(at)) return null;
    return Date.now() - at <= HEARTBEAT_STALE_MS ? hb : null;
  }
  function renderListMeta() {
    var _a;
    if (!bodyEl) return;
    const fs = currentFs();
    const beats = new Map(readRegistry().registry.tools.map((e) => [e.id, heartbeatOf(e.path, fs)]));
    for (const card2 of Array.from(bodyEl.querySelectorAll(".bz-dock-card"))) {
      const id = (_a = card2.dataset.toolId) != null ? _a : "";
      const live3 = liveOf(id);
      const hb = beats.get(id);
      const ext = live3 || !hb ? null : freshOf(hb);
      const running = !!live3 || !!ext;
      card2.toggleClass("is-running", running);
      const dot = card2.querySelector(".bz-dock-dot");
      if (dot) {
        dot.dataset.state = running ? "running" : lastStateOf(id);
      }
    }
  }
  function renderSummary(all) {
    if (!bodyEl) return;
    const row = bodyEl.createDiv({ cls: "bz-dock-summary" });
    const running = liveAll().length;
    const today = all.filter((v) => v.lastRun && isToday(v.lastRun.startedAt)).length;
    const failed = all.filter((v) => {
      var _a, _b;
      return ((_a = v.lastRun) == null ? void 0 : _a.status) === "failed" || ((_b = v.lastRun) == null ? void 0 : _b.status) === "timeout";
    }).length;
    cell(row, "正在跑", running ? String(running) : "—");
    cell(row, "今天跑过", String(today));
    cell(row, "最近失败", failed ? String(failed) : "—");
    cell(row, "工具", String(all.length));
  }
  function cell(parent, label, value) {
    const c = parent.createDiv({ cls: "bz-dock-kpi" });
    c.createDiv({ cls: "bz-dock-kpi-value", text: value });
    c.createDiv({ cls: "bz-dock-kpi-label", text: label });
  }
  function section(name, list) {
    if (!bodyEl) return;
    bodyEl.createDiv({ cls: "bz-dock-section", text: name });
    const grid = bodyEl.createDiv({ cls: "bz-dock-grid" });
    for (const v of list) card(grid, v);
  }
  function card(grid, v) {
    var _a, _b, _c, _d;
    const el = grid.createDiv({ cls: "bz-dock-card" });
    el.dataset.toolId = v.id;
    el.tabIndex = 0;
    if (liveOf(v.id)) el.addClass("is-running");
    const top = el.createDiv({ cls: "bz-dock-card-top" });
    const icon = top.createDiv({ cls: "bz-dock-card-icon" });
    setIcon(icon, ((_a = v.manifest) == null ? void 0 : _a.icon) || "box");
    const name = top.createDiv({ cls: "bz-dock-card-name" });
    name.setText(displayNameOf(v));
    const dot = name.createSpan({ cls: "bz-dock-dot" });
    dot.dataset.state = liveOf(v.id) ? "running" : lastStateOf(v.id);
    el.createDiv({
      cls: "bz-dock-card-desc",
      text: (_d = (_c = v.error) != null ? _c : (_b = v.manifest) == null ? void 0 : _b.description) != null ? _d : "（这份声明里没有描述）"
    });
    const meta = el.createDiv({ cls: "bz-dock-card-meta" });
    const trigger = v.rules.find((r) => r.enabled !== false);
    meta.createSpan({
      cls: "bz-dock-tag",
      text: trigger ? triggerText(trigger.trigger, (id) => id) : "手动"
    });
    if (!v.trusted) meta.createSpan({ cls: "bz-dock-tag is-warn", text: "待授权" });
    const strip = el.createDiv({ cls: "bz-dock-strip" });
    const runs = recentRunsOf(v.path, v.id, 7);
    for (let i = 6; i >= 0; i--) {
      const r = runs[6 - i];
      const tick2 = strip.createDiv({ cls: "bz-dock-tick" });
      if (r) tick2.dataset.state = r.status;
    }
    const open = () => showDetail(v.id);
    el.addEventListener("click", open);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  }
  function lastStateOf(id) {
    var _a, _b;
    const v = viewOf(id);
    return (_b = (_a = v == null ? void 0 : v.lastRun) == null ? void 0 : _a.status) != null ? _b : "never";
  }
  function isToday(iso) {
    const d = new Date(iso);
    const n = /* @__PURE__ */ new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  }
  function showDetail(id) {
    view = "detail";
    detailId = id;
    const v = viewOf(id);
    if (titleEl) titleEl.setText(v ? displayNameOf(v) : "工具");
    renderDetail();
  }
  function renderDetail() {
    var _a;
    if (!bodyEl) return;
    const v = viewOf(detailId);
    detailKey = v ? detailSignature(v) : "";
    bodyEl.empty();
    if (!v) {
      bodyEl.createDiv({ cls: "bz-dock-empty-desc", text: "这个工具已经不在登记表里了" });
      backBtn();
      return;
    }
    const bar = bodyEl.createDiv({ cls: "bz-dock-detail-bar" });
    const back = bar.createDiv({ cls: "bz-dock-back" });
    setIcon(back, "arrow-left");
    back.createSpan({ text: "返回" });
    back.addEventListener("click", () => showList());
    const acts = bar.createDiv({ cls: "bz-dock-actions" });
    const gate = judgeRunGate(v, !Platform.isMobile);
    const live3 = liveOf(v.id);
    const external = externalRunOf(v);
    if (live3) {
      const stop = btnOf(acts, "停止");
      stop.addEventListener("click", () => stopLive(v.id));
    } else {
      const run = btnOf(acts, "运行", "mod-cta");
      run.disabled = !gate.ok || !!external;
      if (external) run.setAttribute("title", "后台值守正在跑它，等它跑完");
      else if (!gate.ok) run.setAttribute("title", (_a = gate.text) != null ? _a : "");
      run.addEventListener("click", () => void doRun(v));
    }
    if (!v.trusted) {
      const trust = btnOf(acts, v.trustStale ? "重新授权" : "授权这条命令");
      trust.addEventListener("click", () => void doTrust(v));
    } else {
      const untrust = btnOf(acts, "撤销授权");
      untrust.addEventListener("click", () => void doUntrust(v));
    }
    renderProblem(v);
    renderPanelBoard(v);
    renderParams(v);
    renderRules(v);
    renderLive(v);
    renderHistory(v);
    renderFooter(v);
  }
  function backBtn() {
    if (!bodyEl) return;
    const b = bodyEl.createDiv({ cls: "bz-dock-back" });
    setIcon(b, "arrow-left");
    b.createSpan({ text: "返回" });
    b.addEventListener("click", () => showList());
  }
  function renderProblem(v) {
    var _a, _b;
    if (!bodyEl) return;
    const problems = [];
    if (v.error) problems.push(v.error);
    if (!v.entry) problems.push("声明里没有 entry，跑不起来（只能看）");
    if (!v.trusted) problems.push(v.trustStale ? "声明里的启动命令改过了，需要重新授权" : "这条命令还没授权，跑不了");
    const missing = missingParams(v);
    if (missing.length) problems.push(`必填参数还没填：${missing.join("、")}`);
    if ((_a = v.runtime.run) == null ? void 0 : _a.pausedAt) problems.push("连续失败太多次，自动运行已经暂停（下面可以恢复）");
    if (!problems.length) return;
    const box = bodyEl.createDiv({ cls: "bz-dock-problem" });
    for (const p of problems) box.createDiv({ cls: "bz-dock-problem-line", text: p });
    if ((_b = v.runtime.run) == null ? void 0 : _b.pausedAt) {
      const btn = btnOf(box, "恢复自动运行");
      btn.addEventListener("click", () => {
        void clearBreakerSafely(v).then((ok) => {
          if (!ok) {
            new Notice("有工具正在跑，等它跑完再恢复");
            return;
          }
          renderDetail();
        });
      });
    }
  }
  var FRAME_SCROLLBAR_CSS = "<style>html{scrollbar-width:none;-ms-overflow-style:none}html::-webkit-scrollbar{display:none;width:0;height:0}</style>";
  function renderPanelBoard(v) {
    if (!bodyEl) return;
    const html = panelOf(v.path, currentFs());
    if (!html) return;
    const box = bodyEl.createDiv({ cls: "bz-dock-board" });
    const frame = box.createEl("iframe", { cls: "bz-dock-frame" });
    frame.setAttribute("sandbox", "allow-same-origin allow-popups allow-popups-to-escape-sandbox");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.srcdoc = html.toLowerCase().includes("<head>") ? html.replace(/<head([^>]*)>/i, `<head$1>${FRAME_SCROLLBAR_CSS}`) : `<!DOCTYPE html><html><head>${FRAME_SCROLLBAR_CSS}</head><body>${html}</body></html>`;
  }
  function renderParams(v) {
    var _a, _b;
    if (!bodyEl || !v.params.length) return;
    block("参数");
    const form = bodyEl.createDiv({ cls: "bz-dock-form" });
    const values = { ...v.values };
    for (const p of v.params) {
      const row = form.createDiv({ cls: "bz-dock-field" });
      row.createDiv({ cls: "bz-dock-label", text: ((_a = p.label) != null ? _a : p.key) + (p.required ? " *" : "") });
      const input = fieldOf(row, p, (_b = values[p.key]) != null ? _b : p.default);
      const commit = () => {
        values[p.key] = readField(p, input);
        writeSettings(v.path, v.id, values);
      };
      input.addEventListener("change", commit);
      if (p.type === "text" || p.type === "number" || p.type === "multiline") input.addEventListener("blur", commit);
      if (p.hint) row.createDiv({ cls: "bz-dock-hint", text: p.hint });
      if (p.type === "secret") row.createDiv({ cls: "bz-dock-hint", text: "凭据不进 vault、不写运行记录，只在本机工具目录里" });
    }
  }
  function fieldOf(row, p, value) {
    var _a;
    if (p.type === "bool") {
      const input2 = row.createEl("input", { type: "checkbox" });
      input2.checked = value === true;
      return input2;
    }
    if (p.type === "choice" || p.type === "multichoice") {
      const sel = row.createEl("select", { cls: p.type === "multichoice" ? "is-multi" : "" });
      if (p.type === "multichoice") sel.multiple = true;
      const opts = (_a = p.options) != null ? _a : [];
      const picked = p.type === "multichoice" ? Array.isArray(value) ? value.map(String) : [] : [String(value != null ? value : "")];
      for (const o of opts) {
        const opt = sel.createEl("option", { text: o, value: o });
        if (picked.includes(o)) opt.selected = true;
      }
      return sel;
    }
    if (p.type === "multiline") {
      const input2 = row.createEl("textarea", { cls: "bz-dock-textarea" });
      input2.value = value === void 0 ? "" : String(value);
      return input2;
    }
    const input = row.createEl("input", {
      type: p.type === "secret" ? "password" : p.type === "number" ? "number" : "text",
      cls: "bz-dock-input"
    });
    input.value = value === void 0 ? "" : String(value);
    return input;
  }
  function readField(p, input) {
    if (p.type === "bool") return input.checked;
    if (p.type === "multichoice") {
      return Array.from(input.selectedOptions).map((o) => o.value);
    }
    if (p.type === "number") {
      const n = Number(input.value);
      return Number.isFinite(n) ? n : void 0;
    }
    return input.value;
  }
  function renderRules(v) {
    if (!bodyEl) return;
    block("规则");
    const list = bodyEl.createDiv({ cls: "bz-dock-rules" });
    if (!v.rules.length) {
      list.createDiv({ cls: "bz-dock-hint", text: "没有规则 —— 只能手动点运行" });
    }
    v.rules.forEach((rule, i) => ruleRow(list, v, rule, i));
    const add = btnOf(list, "加一条规则");
    add.addEventListener("click", () => {
      const next = v.rules.concat(defaultRule());
      saveRules(v, next);
      renderDetail();
    });
  }
  function ruleRow(parent, v, rule, index) {
    var _a;
    const row = parent.createDiv({ cls: "bz-dock-rule" });
    const head = row.createDiv({ cls: "bz-dock-rule-head" });
    const toggle = head.createEl("input", { type: "checkbox" });
    toggle.checked = rule.enabled !== false;
    toggle.addEventListener("change", () => {
      const next = v.rules.slice();
      next[index] = { ...rule, enabled: toggle.checked };
      saveRules(v, next);
    });
    head.createSpan({ cls: "bz-dock-rule-name", text: ruleName(rule, index) });
    head.createSpan({ cls: "bz-dock-rule-text", text: `${triggerText(rule.trigger, (id) => id)} · ${actionText(rule.action)}` });
    const del = head.createSpan({ cls: "bz-dock-rule-del" });
    setIcon(del, "trash-2");
    del.addEventListener("click", () => {
      saveRules(v, v.rules.filter((r) => r.id !== rule.id));
      renderDetail();
    });
    const edit = row.createDiv({ cls: "bz-dock-rule-edit" });
    const trig = edit.createEl("select");
    for (const kind of TRIGGER_KINDS) {
      const o = trig.createEl("option", { text: TRIGGER_LABEL[kind], value: kind });
      if (rule.trigger.kind === kind) o.selected = true;
    }
    trig.addEventListener("change", () => {
      const next = v.rules.slice();
      next[index] = { ...rule, trigger: blankTrigger(trig.value) };
      saveRules(v, next);
      renderDetail();
    });
    const arg = triggerArgInput(rule.trigger);
    if (arg) {
      edit.appendChild(arg.el);
      arg.el.addEventListener("change", () => {
        const next = v.rules.slice();
        const t = patchTrigger(rule.trigger, arg.el.value);
        if (!t) return;
        next[index] = { ...rule, trigger: t };
        saveRules(v, next);
      });
    }
    const jitter = edit.createEl("input", { type: "number", cls: "bz-dock-jitter" });
    jitter.min = "0";
    jitter.max = "720";
    jitter.value = String((_a = rule.jitterMin) != null ? _a : 0);
    jitter.setAttribute("title", "错峰：到点后再随机等这么多分钟");
    jitter.addEventListener("change", () => {
      const next = v.rules.slice();
      const n = Number(jitter.value);
      next[index] = { ...rule, jitterMin: Number.isFinite(n) && n > 0 ? Math.floor(n) : void 0 };
      saveRules(v, next);
    });
    const act = edit.createEl("select");
    for (const k of ["run", "remind"]) {
      const o = act.createEl("option", { text: k === "run" ? "运行" : "只提醒", value: k });
      if (rule.action.kind === k) o.selected = true;
    }
    act.addEventListener("change", () => {
      const next = v.rules.slice();
      next[index] = { ...rule, action: { kind: act.value === "remind" ? "remind" : "run" } };
      saveRules(v, next);
    });
    const due = nextDueOf(rule, { now: Date.now() });
    if (due && !isEventTrigger(rule.trigger.kind)) {
      edit.createSpan({ cls: "bz-dock-hint", text: `下次 ${new Date(due).toLocaleString()}` });
    }
  }
  function blankTrigger(kind) {
    switch (kind) {
      case "daily":
        return { kind: "daily", at: "09:00" };
      case "interval":
        return { kind: "interval", everyMin: 60 };
      case "on-launch":
        return { kind: "on-launch", delayMin: 5 };
      case "tool-ok":
        return { kind: "tool-ok", toolId: "" };
      case "tool-fail":
        return { kind: "tool-fail", toolId: "" };
      case "domain-event":
        return { kind: "domain-event", channel: "" };
      case "file-change":
        return { kind: "file-change", target: "" };
      case "value-threshold":
        return { kind: "value-threshold", path: "", key: "", op: ">", value: 0 };
      default:
        return { kind: "panel-open" };
    }
  }
  function triggerArgInput(t) {
    if (t.kind === "daily") {
      const el = document.createElement("input");
      el.type = "time";
      el.className = "bz-dock-trigger-arg";
      el.value = t.at;
      return { el };
    }
    if (t.kind === "interval") {
      const el = document.createElement("input");
      el.type = "number";
      el.className = "bz-dock-trigger-arg";
      el.min = "1";
      el.value = String(t.everyMin);
      el.setAttribute("title", "每隔多少分钟");
      return { el };
    }
    if (t.kind === "on-launch") {
      const el = document.createElement("input");
      el.type = "number";
      el.className = "bz-dock-trigger-arg";
      el.min = "0";
      el.value = String(t.delayMin);
      el.setAttribute("title", "启动后多少分钟");
      return { el };
    }
    if (t.kind === "tool-ok" || t.kind === "tool-fail") {
      const el = document.createElement("input");
      el.className = "bz-dock-trigger-arg";
      el.value = t.toolId;
      el.setAttribute("title", "工具 id");
      return { el };
    }
    if (t.kind === "file-change") {
      const el = document.createElement("input");
      el.className = "bz-dock-trigger-arg";
      el.value = t.target;
      el.setAttribute("title", "vault 里的目录");
      return { el };
    }
    return null;
  }
  function patchTrigger(t, value) {
    if (t.kind === "daily") {
      if (!/^\d{1,2}:\d{2}$/.test(value)) return null;
      return { kind: "daily", at: value };
    }
    if (t.kind === "interval") {
      const n = Number(value);
      return Number.isFinite(n) && n >= 1 ? { kind: "interval", everyMin: Math.floor(n) } : null;
    }
    if (t.kind === "on-launch") {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? { kind: "on-launch", delayMin: Math.floor(n) } : null;
    }
    if (t.kind === "tool-ok" || t.kind === "tool-fail") return { ...t, toolId: value.trim() };
    if (t.kind === "file-change") return { kind: "file-change", target: value.trim() };
    return null;
  }
  function saveRules(v, rules) {
    const intent = { ...v.intent, v: 1, tool: v.id, rules };
    writeIntent(v.path, intent);
    void kickDockScheduler();
  }
  function renderLive(v) {
    var _a, _b;
    if (!bodyEl) return;
    const live3 = liveOf(v.id);
    const external = externalRunOf(v);
    if (!live3 && !external) return;
    block("正在跑");
    const box = bodyEl.createDiv({ cls: "bz-dock-log" });
    if (live3) {
      box.createDiv({ cls: "bz-dock-log-run", text: `工单 ${live3.runId} · ${(_a = live3.phase) != null ? _a : "进行中"}${live3.pct !== null ? ` ${live3.pct}%` : ""}` });
      for (const s of live3.steps.slice(-40)) box.createDiv({ cls: "bz-dock-log-line", text: s.text });
      if (!live3.steps.length) box.createDiv({ cls: "bz-dock-hint", text: "还没有输出" });
      return;
    }
    box.createDiv({ cls: "bz-dock-log-run", text: `后台进程在跑 · 工单 ${(_b = external == null ? void 0 : external.runId) != null ? _b : "（未标注）"}` });
    if (external == null ? void 0 : external.step) box.createDiv({ cls: "bz-dock-log-line", text: external.step });
    box.createDiv({
      cls: "bz-dock-hint",
      text: "这一轮不是 Obsidian 拉起的，看不到实时输出；跑完会出现在下面的记录里"
    });
  }
  function renderHistory(v) {
    if (!bodyEl) return;
    block("最近");
    const runs = recentRunsOf(v.path, v.id, 12);
    const box = bodyEl.createDiv({ cls: "bz-dock-history" });
    if (!runs.length) {
      box.createDiv({ cls: "bz-dock-hint", text: "还没跑过" });
      return;
    }
    for (const r of runs) historyRow(box, r);
  }
  function historyRow(parent, r) {
    var _a, _b, _c;
    const row = parent.createDiv({ cls: "bz-dock-history-row" });
    row.dataset.state = r.status;
    row.createSpan({ cls: "bz-dock-history-when", text: new Date(r.startedAt).toLocaleString() });
    row.createSpan({ cls: "bz-dock-history-status", text: statusWord(r.status) });
    row.createSpan({ cls: "bz-dock-history-msg", text: (_c = (_b = r.message) != null ? _b : (_a = r.error) == null ? void 0 : _a.detail) != null ? _c : "" });
    if (r.durationMs) row.createSpan({ cls: "bz-dock-history-dur", text: `${Math.round(r.durationMs / 1e3)}s` });
  }
  function statusWord(s) {
    switch (s) {
      case "ok":
        return "成功";
      case "failed":
        return "失败";
      case "timeout":
        return "超时";
      case "stopped":
        return "中止";
      case "abandoned":
        return "没收尾";
      case "running":
        return "在跑";
      default:
        return s;
    }
  }
  function renderFooter(v) {
    if (!bodyEl) return;
    const foot = bodyEl.createDiv({ cls: "bz-dock-footer" });
    foot.createDiv({ cls: "bz-dock-path", text: v.path });
    const enable = btnOf(foot, v.intent.enabled === false ? "启用" : "停用");
    enable.addEventListener("click", () => {
      writeIntent(v.path, { ...v.intent, v: 1, tool: v.id, enabled: v.intent.enabled === false });
      renderDetail();
    });
    const auto = btnOf(foot, v.intent.autoRun === false ? "允许自动运行" : "只手动跑");
    auto.addEventListener("click", () => {
      writeIntent(v.path, { ...v.intent, v: 1, tool: v.id, autoRun: v.intent.autoRun === false });
      renderDetail();
    });
    const del = btnOf(foot, "移除登记", "mod-warning");
    del.addEventListener("click", () => {
      const sure = window.confirm(`从工具坞移除「${displayNameOf(v)}」？
只删登记，不动磁盘上的文件。`);
      if (!sure) return;
      removeTool(v.id);
      showList();
    });
  }
  function block(title) {
    if (!bodyEl) return;
    bodyEl.createDiv({ cls: "bz-dock-block-title", text: title });
  }
  async function doRun(v) {
    await runToolManually(v);
    if (view === "detail" && detailId === v.id) renderDetail();
  }
  async function doTrust(v) {
    if (!v.entry) return;
    await trustTool(v.id, v.entry);
    notify(`${displayNameOf(v)} 已授权`, { type: "success" });
    renderDetail();
  }
  async function doUntrust(v) {
    const sure = window.confirm(`撤销「${displayNameOf(v)}」的授权？
撤销后它不能再跑，直到重新授权。`);
    if (!sure) return;
    await untrustTool(v.id);
    renderDetail();
  }
  function pickFolder() {
    const input = document.createElement("input");
    input.type = "file";
    input.webkitdirectory = true;
    input.addEventListener("change", () => {
      var _a;
      const files = Array.from((_a = input.files) != null ? _a : []);
      const manifest2 = files.find((f) => f.name === "manifest.json");
      if (!manifest2) {
        new Notice("这个文件夹里没有 manifest.json");
        return;
      }
      const abs = manifest2.path;
      if (!abs) {
        new Notice("读不到文件夹路径（这个平台不支持）");
        return;
      }
      void importFrom(abs);
    });
    input.click();
  }
  async function importFrom(manifestPath) {
    const fs = currentFs();
    if (!fs) {
      new Notice("桌面端才能导入");
      return;
    }
    const text = fs.readText(manifestPath);
    if (text === null) {
      new Notice("读不到这个文件");
      return;
    }
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      new Notice("manifest.json 不是合法 JSON");
      return;
    }
    const manifest2 = parseManifest(raw);
    if (!manifest2) {
      new Notice("声明校验不过（需要 v:2、合法 id、非空 name）");
      return;
    }
    upsertTool({ id: manifest2.id, path: manifestPath });
    notify(`已登记「${manifest2.name}」，先看一眼它会跑什么，再授权`, { type: "info" });
    render();
    showDetail(manifest2.id);
  }
  function btnOf(parent, text, cls) {
    return parent.createEl("button", { text, cls: cls ? `bz-dock-btn ${cls}` : "bz-dock-btn" });
  }
  function iconBtn(parent, icon, label, onClick) {
    const b = parent.createDiv({ cls: "bz-dock-icon-btn" });
    b.setAttribute("aria-label", label);
    b.setAttribute("title", label);
    setIcon(b, icon);
    b.addEventListener("click", onClick);
  }

  // prototypes/dock/fake-sim.ts
  var PREFIX = "bz-sim:";
  var ROOT = "/sim-vault/CONFIG/SCRIPTS/DockTools";
  var SEED_FLAG = "bz-dock-sim-seeded-v2";
  function keyOf(p) {
    return PREFIX + p;
  }
  var simFs = {
    readText: (p) => localStorage.getItem(keyOf(p)),
    writeText: (p, d) => localStorage.setItem(keyOf(p), d),
    rename: (a, b) => {
      const v = localStorage.getItem(keyOf(a));
      if (v === null) throw new Error(`no such file: ${a}`);
      localStorage.removeItem(keyOf(a));
      localStorage.setItem(keyOf(b), v);
    },
    createExclusive: (p, d) => {
      if (localStorage.getItem(keyOf(p)) !== null) return false;
      localStorage.setItem(keyOf(p), d);
      return true;
    },
    unlink: (p) => localStorage.removeItem(keyOf(p)),
    exists: (p) => localStorage.getItem(keyOf(p)) !== null,
    mkdir: () => void 0
  };
  function manifest(id, name, description, icon, at) {
    return JSON.stringify(
      {
        v: 2,
        id,
        name,
        description,
        icon,
        entry: { cmd: "node", args: ["main.mjs"] },
        params: [{ key: "cookie", label: "登录凭据", type: "secret", required: false }],
        defaultRules: [{ id: `r-${id}`, trigger: { kind: "daily", at }, action: { kind: "run" } }]
      },
      null,
      2
    );
  }
  function seed() {
    var _a;
    if (localStorage.getItem(SEED_FLAG)) return;
    const tools = [
      { id: "demo-signin", name: "每日签到", desc: "把签到和分享做完，记下积分", icon: "calendar-check", at: "09:30" },
      { id: "demo-radar", name: "比价雷达", desc: "挑十元内的好评游戏，比一遍渠道价", icon: "radar", at: "12:00" }
    ];
    for (const t of tools) {
      const dir = `${ROOT}/${t.id}`;
      localStorage.setItem(keyOf(`${dir}/manifest.json`), manifest(t.id, t.name, t.desc, t.icon, t.at));
    }
    const runs = [
      { runId: "r-seed-1", tool: "demo-signin", trigger: "auto", status: "ok", startedAt: new Date(Date.now() - 36e5).toISOString(), durationMs: 42e3, message: "签到成功，积分 +12" },
      { runId: "r-seed-2", tool: "demo-signin", trigger: "auto", status: "failed", startedAt: new Date(Date.now() - 864e5).toISOString(), durationMs: 9e3, message: "凭据过期", error: { kind: "auth" } },
      { runId: "r-seed-3", tool: "demo-radar", trigger: "manual", status: "ok", startedAt: new Date(Date.now() - 72e5).toISOString(), durationMs: 61e3, message: "捡到 3 款" }
    ];
    for (const r of runs) {
      const p = `${ROOT}/${r.tool}/runs.jsonl`;
      const prev = (_a = localStorage.getItem(keyOf(p))) != null ? _a : "";
      localStorage.setItem(keyOf(p), prev + JSON.stringify(r) + "\n");
    }
    localStorage.setItem(
      keyOf("/sim-vault/CONFIG/STORAGE/dock.json"),
      JSON.stringify(
        {
          v: 3,
          tools: tools.map((t) => ({ id: t.id, path: `${ROOT}/${t.id}/manifest.json` })),
          autoRun: true,
          watchdog: true,
          notifyMissed: true
        },
        null,
        2
      )
    );
    localStorage.setItem(SEED_FLAG, "1");
  }
  function boot() {
    seed();
    setApp(new FakeApp());
    setSettingsProvider(() => ({}));
    setSettingsSaver(async () => void 0);
    setDockFs(simFs);
  }
  window.BZW_dock = {
    boot,
    openDock: () => openDock(getApp()),
    closeDock,
    unloadDock
  };
  return __toCommonJS(fake_sim_exports);
})();
