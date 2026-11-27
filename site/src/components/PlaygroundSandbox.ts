import type { PreviewMode } from './PlaygroundPresets'

export interface SandboxRunPayload {
  readonly js: string
  readonly previewMode: PreviewMode
  readonly theme: 'light' | 'dark'
  readonly runId: number
}

// Strips ES import/export syntax from compiled VibeLang JS so it runs cleanly
// inside the isolated sandboxed iframe wired to our miniature Effect 4 runtime.
function rewriteModuleForSandbox(rawJs: string): string {
  let code = rawJs
  // Remove static import lines (our sandbox provides Effect, Layer, Console, Data, Schema, Fiber, runtime, sleep, etc.)
  code = code.replace(/^\s*import\s+[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '')
  // Track exported identifiers and rewrite `export` declarations
  const exportedNames: string[] = []
  code = code.replace(/\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, (_m, name: string) => {
    exportedNames.push(name)
    return `function ${name}`
  })
  code = code.replace(/\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g, (_m, name: string) => {
    exportedNames.push(name)
    return `const ${name}`
  })
  code = code.replace(/\bexport\s+class\s+([A-Za-z_$][\w$]*)/g, (_m, name: string) => {
    exportedNames.push(name)
    return `class ${name}`
  })
  code = code.replace(/\bexport\s+\{[^}]*\};?/g, '')
  const returnObj = exportedNames.map((n) => `${n}: typeof ${n} !== "undefined" ? ${n} : undefined`).join(', ')
  return `${code}\nreturn { ${returnObj} };`
}

export function buildSandboxSrcDoc(payload: SandboxRunPayload): string {
  const rewritten = rewriteModuleForSandbox(payload.js)
  const serializedCode = JSON.stringify(rewritten)
  const mode = JSON.stringify(payload.previewMode)
  const isDark = payload.theme === 'dark'

  const bg = isDark ? '#16161a' : '#ffffff'
  const surface = isDark ? '#1e1e24' : '#f8f9fc'
  const border = isDark ? '#2e2e38' : '#e2e6f0'
  const text = isDark ? '#ececf2' : '#1d2433'
  const muted = isDark ? '#9ea3b5' : '#5b6478'
  const accent = isDark ? '#a5a9ff' : '#4f46e5'
  const accentText = isDark ? '#141520' : '#ffffff'
  const okColor = isDark ? '#4ade80' : '#15803d'
  const warnColor = isDark ? '#fbbf24' : '#b45309'
  const errColor = isDark ? '#f87171' : '#b91c1c'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root {
    --bg: ${bg};
    --surface: ${surface};
    --border: ${border};
    --text: ${text};
    --muted: ${muted};
    --accent: ${accent};
    --accent-text: ${accentText};
    --ok: ${okColor};
    --warn: ${warnColor};
    --err: ${errColor};
    --mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    --sans: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    font-size: 13px;
    line-height: 1.5;
  }
  #app { padding: 14px; display: flex; flex-direction: column; gap: 12px; }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px;
  }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .between { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .eyebrow {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .btn {
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text);
    border-radius: 7px;
    padding: 6px 11px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.08s ease, border-color 0.15s ease;
  }
  .btn:hover { border-color: var(--accent); }
  .btn:active { transform: scale(0.97); }
  .btn-primary {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .btn-sm { padding: 4px 8px; font-size: 11px; }
  .btn-active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    border: 1px solid var(--border);
    background: var(--bg);
  }
  .pill-ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, transparent); }
  .pill-warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, transparent); }
  .pill-err { color: var(--err); border-color: color-mix(in srgb, var(--err) 45%, transparent); }
  .pill-accent { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
  .count-big {
    font-family: var(--mono);
    font-size: 40px;
    font-weight: 750;
    letter-spacing: -0.04em;
    line-height: 1;
  }
  .log-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 220px;
    overflow: auto;
    font-family: var(--mono);
    font-size: 11.5px;
  }
  .log-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 6px;
    background: var(--bg);
    border: 1px solid var(--border);
    text-align: left;
    color: var(--text);
  }
  .log-item.clickable { cursor: pointer; width: 100%; }
  .log-item.clickable:hover { border-color: var(--accent); }
  .log-item.selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--bg)); }
  .bar-track {
    height: 7px;
    border-radius: 999px;
    background: var(--border);
    overflow: hidden;
    margin: 7px 0;
  }
  .bar-fill {
    height: 100%;
    border-radius: 999px;
    background: var(--accent);
    transition: width 0.14s linear;
  }
  .bar-fill.done { background: var(--ok); }
  .bar-fill.cancelled { background: var(--warn); }
  .bar-fill.failed { background: var(--err); }
  .console-line {
    font-family: var(--mono);
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 5px;
    background: var(--bg);
    border: 1px solid var(--border);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .console-ts { color: var(--muted); margin-right: 8px; font-size: 11px; }
  pre.result {
    margin: 0;
    padding: 10px;
    border-radius: 7px;
    background: var(--bg);
    border: 1px solid var(--border);
    font-family: var(--mono);
    font-size: 11.5px;
    overflow: auto;
  }
</style>
</head>
<body>
<div id="app"></div>
<script>
(function() {
  const USER_CODE = ${serializedCode};
  const PREVIEW_MODE = ${mode};
  const root = document.getElementById('app');
  const startTime = performance.now();
  const logs = [];

  function parseDuration(input) {
    if (typeof input === 'number') return Math.max(0, input);
    if (typeof input === 'string') {
      const m = /^(\\d+(?:\\.\\d+)?)\\s*(ms|millis?|s|secs?|seconds?)$/i.exec(input.trim());
      if (m) return Number(m[1]) * (m[2].toLowerCase().startsWith('s') ? 1000 : 1);
    }
    return 15;
  }

  function formatVal(v) {
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v); } catch { return String(v); }
  }

  // Miniature Effect 4 + vibelang-runtime execution engine for the sandbox iframe.
  const EFFECT_SYM = Symbol('Effect');
  function makeEffect(run) { return { [EFFECT_SYM]: true, _run: run }; }
  function isEffect(x) { return Boolean(x && typeof x === 'object' && x[EFFECT_SYM]); }

  async function runEffect(eff, ctx, signal) {
    if (signal && signal.aborted) throw { _interrupted: true };
    if (!isEffect(eff)) return eff;
    return eff._run(ctx, signal);
  }

  function genEffect(genFn) {
    return makeEffect(async (ctx, signal) => {
      const iter = genFn();
      let step = iter.next();
      while (!step.done) {
        if (signal && signal.aborted) throw { _interrupted: true };
        const yielded = step.value;
        const val = await runEffect(yielded, ctx, signal);
        step = iter.next(val);
      }
      return step.value;
    });
  }

  const Effect = {
    succeed: (v) => makeEffect(async () => v),
    fail: (e) => makeEffect(async () => { throw { _typedFail: true, error: e }; }),
    die: (e) => makeEffect(async () => { throw e; }),
    sync: (fn) => makeEffect(async () => fn()),
    try: (arg) => makeEffect(async () => {
      try { return typeof arg === 'function' ? arg() : arg.try(); }
      catch (e) { throw { _typedFail: true, error: typeof arg === 'function' ? e : arg.catch(e) }; }
    }),
    sleep: (d) => makeEffect((_ctx, signal) => new Promise((resolve, reject) => {
      const ms = parseDuration(d);
      const t = setTimeout(() => resolve(undefined), ms);
      if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject({ _interrupted: true }); }, { once: true });
    })),
    gen: (fn) => genEffect(fn),
    fnUntraced: (fn) => (...args) => genEffect(() => fn(...args)),
    all: (items) => makeEffect(async (ctx, signal) => Promise.all(items.map((e) => runEffect(e, ctx, signal)))),
    raceAllFirst: (items) => makeEffect(async (ctx, parentSignal) => {
      const controllers = items.map(() => new AbortController());
      if (parentSignal) parentSignal.addEventListener('abort', () => controllers.forEach((c) => c.abort()), { once: true });
      return new Promise((resolve, reject) => {
        let settled = false;
        items.forEach((item, idx) => {
          runEffect(item, ctx, controllers[idx].signal).then(
            (val) => {
              if (settled) return;
              settled = true;
              controllers.forEach((c, i) => { if (i !== idx) c.abort(); });
              resolve(val);
            },
            (err) => {
              if (settled || (err && err._interrupted)) return;
              settled = true;
              controllers.forEach((c, i) => { if (i !== idx) c.abort(); });
              reject(err);
            }
          );
        });
      });
    }),
    forEach: (items, fn, opts) => makeEffect(async (ctx, signal) => {
      const arr = Array.from(items);
      const limit = opts && typeof opts.concurrency === 'number' ? Math.max(1, opts.concurrency) : arr.length || 1;
      const results = new Array(arr.length);
      let cursor = 0;
      async function worker() {
        while (cursor < arr.length) {
          const i = cursor++;
          results[i] = await runEffect(fn(arr[i], i), ctx, signal);
        }
      }
      await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, worker));
      return opts && opts.discard ? undefined : results;
    }),
    forkChild: (eff) => makeEffect(async (ctx, signal) => {
      const controller = new AbortController();
      if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
      const promise = runEffect(eff, ctx, controller.signal);
      return { _fiber: true, promise, interrupt: () => controller.abort() };
    }),
    provide: (eff, layer) => makeEffect(async (ctx, signal) => {
      const nextCtx = new Map(ctx);
      const layers = Array.isArray(layer) ? layer : [layer];
      for (const l of layers) {
        if (l && l._serviceKey) nextCtx.set(l._serviceKey, l._impl);
      }
      return runEffect(eff, nextCtx, signal);
    }),
  };

  const Fiber = {
    join: (fiber) => makeEffect(async () => fiber.promise),
    interrupt: (fiber) => makeEffect(async () => { fiber.interrupt(); return { _tag: 'Failure' }; }),
  };

  const Console = {
    log: (...args) => makeEffect(async () => {
      logs.push({ ms: Math.round(performance.now() - startTime), text: args.map(formatVal).join(' ') });
    }),
  };

  const Layer = {
    succeed: (svc, impl) => ({ _serviceKey: svc._key || svc.name, _impl: impl }),
    effect: (svc, eff) => ({ _serviceKey: svc._key || svc.name, _impl: eff }),
  };

  const Data = {
    TaggedError: (tag) => class extends Error {
      constructor(fields) {
        super(tag);
        this._tag = tag;
        if (fields && typeof fields === 'object') Object.assign(this, fields);
      }
    },
    taggedEnum: () => new Proxy({}, {
      get(_t, prop) {
        if (prop === '$is') return (tag) => (v) => Boolean(v && v._tag === tag);
        if (prop === '$match') return (cases) => (v) => cases[v._tag](v);
        return (fields) => ({ _tag: String(prop), ...(fields || {}) });
      },
    }),
  };

  const Schema = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'Struct' || prop === 'Literals' || prop === 'Union' || prop === 'mutableKey' || prop === 'optionalKey') {
        return (x) => x;
      }
      return { _schema: String(prop) };
    },
  });

  const Equal = {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  };

  const runtime = {
    TaggedError: Data.TaggedError,
    $schemaErrorMatcher: () => {},
    $normal: { kind: 'normal' },
    $service: (key) => {
      class SvcBase {}
      SvcBase._key = key;
      SvcBase[EFFECT_SYM] = true;
      SvcBase._run = async (ctx) => {
        if (ctx.has(key)) return ctx.get(key);
        throw { _typedFail: true, error: new Error('Missing service ' + key) };
      };
      return SvcBase;
    },
    $catch: (eff, handler) => makeEffect(async (ctx, signal) => {
      try {
        return await runEffect(eff, ctx, signal);
      } catch (e) {
        if (e && e._typedFail) {
          const recovered = handler(e.error);
          return runEffect(recovered, ctx, signal);
        }
        throw e;
      }
    }),
    $matchCache: () => ({
      propertyHas: (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key),
      get: (obj, key) => obj[key],
      has: (obj, key) => obj != null && key in obj,
    }),
    $noMatch: (v) => { throw new Error('Non-exhaustive match for ' + formatVal(v)); },
  };

  function evaluateModule() {
    const fn = new Function(
      'Effect', 'Effect_1', 'Fiber', 'Console', 'Layer', 'Data', 'Schema', 'Equal',
      'runtime', '$matchCache', '$schemaErrorMatcher', 'TaggedError', 'sleep', 'all', 'forEach', 'race',
      USER_CODE
    );
    return fn(
      Effect, Effect, Fiber, Console, Layer, Data, Schema, Equal,
      runtime, runtime.$matchCache, runtime.$schemaErrorMatcher, runtime.TaggedError,
      Effect.sleep, Effect.all, Effect.forEach, Effect.raceAllFirst
    );
  }

  function renderCounterUI(mod) {
    const init = (mod && mod.initialModel) || { count: 0, step: 1, transitions: 0 };
    const userUpdate = mod && typeof mod.update === 'function' ? mod.update : (m, msg) => {
      if (msg._tag === 'Increment') return { ...m, count: m.count + m.step, transitions: (m.transitions || 0) + 1 };
      if (msg._tag === 'Decrement') return { ...m, count: m.count - m.step, transitions: (m.transitions || 0) + 1 };
      if (msg._tag === 'SetStep') return { ...m, step: msg.step, transitions: (m.transitions || 0) + 1 };
      if (msg._tag === 'Reset') return { ...m, count: 0, transitions: (m.transitions || 0) + 1 };
      return m;
    };

    const history = [{ id: 0, msg: { _tag: 'Init' }, model: { ...init }, at: '0ms' }];
    let cursor = 0;
    const t0 = performance.now();

    function dispatch(msg) {
      const current = history[cursor].model;
      const next = userUpdate(current, msg);
      history.splice(cursor + 1);
      history.push({
        id: history.length,
        msg,
        model: { ...next },
        at: Math.round(performance.now() - t0) + 'ms',
      });
      cursor = history.length - 1;
      paint();
    }

    function paint() {
      const snap = history[cursor];
      const m = snap.model;
      const summary = mod && typeof mod.viewSummary === 'function' ? mod.viewSummary(m) : ('count=' + m.count + ' (step ' + m.step + ')');
      root.innerHTML = '';

      const hero = document.createElement('div');
      hero.className = 'card';
      hero.innerHTML = \`
        <div class="between">
          <span class="eyebrow">Effect UI · Live Component</span>
          <span class="pill pill-accent">Snapshot #\${snap.id} / \${history.length - 1}</span>
        </div>
        <div class="between" style="margin-top:12px">
          <div>
            <div class="count-big">\${m.count}</div>
            <div style="color:var(--muted);font-family:var(--mono);font-size:11.5px;margin-top:6px">\${summary}</div>
          </div>
          <div class="row">
            <button class="btn" data-act="dec">− \${m.step}</button>
            <button class="btn btn-primary" data-act="inc">+ \${m.step}</button>
            <button class="btn" data-act="reset">Reset</button>
          </div>
        </div>
        <div class="row" style="margin-top:12px">
          <span class="eyebrow" style="margin-right:4px">Step</span>
          \${[1, 5, 10, 25].map((s) => \`<button class="btn btn-sm \${m.step === s ? 'btn-active' : ''}" data-step="\${s}">\${s}</button>\`).join('')}
        </div>
      \`;
      hero.querySelector('[data-act="dec"]').onclick = () => dispatch({ _tag: 'Decrement' });
      hero.querySelector('[data-act="inc"]').onclick = () => dispatch({ _tag: 'Increment' });
      hero.querySelector('[data-act="reset"]').onclick = () => dispatch({ _tag: 'Reset' });
      hero.querySelectorAll('[data-step]').forEach((b) => {
        b.onclick = () => dispatch({ _tag: 'SetStep', step: Number(b.getAttribute('data-step')) });
      });
      root.appendChild(hero);

      const inspector = document.createElement('div');
      inspector.className = 'card';
      inspector.innerHTML = \`
        <div class="between" style="margin-bottom:8px">
          <span class="eyebrow">Time-Travel Message Log (Click any frame)</span>
          <span class="pill pill-ok">\${history.length} states</span>
        </div>
        <div class="log-list"></div>
      \`;
      const list = inspector.querySelector('.log-list');
      history.slice().reverse().forEach((entry) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'log-item clickable' + (entry.id === cursor ? ' selected' : '');
        btn.innerHTML = \`<span>#\${entry.id} \${JSON.stringify(entry.msg)}</span><span style="color:var(--muted)">count=\${entry.model.count} · \${entry.at}</span>\`;
        btn.onclick = () => { cursor = entry.id; paint(); };
        list.appendChild(btn);
      });
      root.appendChild(inspector);
    }

    paint();
  }

  function renderUploadsUI(mod) {
    const seed = (mod && Array.isArray(mod.initialUploads)) ? mod.initialUploads : [
      { id: 'u1', name: 'vibelang-0.0.14.tar.gz', sizeMb: 18, progress: 0, status: 'idle', attempt: 0 },
      { id: 'u2', name: 'effect-ui-demo.mp4', sizeMb: 42, progress: 0, status: 'idle', attempt: 0 },
      { id: 'u3', name: 'playground.wasm', sizeMb: 12, progress: 0, status: 'idle', attempt: 0 },
    ];
    let uploads = seed.map((u) => ({ ...u }));
    const fibers = new Map();
    const trace = [];
    const t0 = performance.now();

    const badgeOf = (u) => {
      if (mod && typeof mod.statusBadge === 'function') {
        try { return mod.statusBadge(u); } catch {}
      }
      const map = {
        idle: { label: 'Ready', tone: 'neutral', action: 'Start' },
        uploading: { label: 'Uploading ' + u.progress + '%', tone: 'accent', action: 'Cancel' },
        done: { label: 'Uploaded', tone: 'success', action: 'Restart' },
        cancelled: { label: 'Cancelled', tone: 'warn', action: 'Restart' },
        failed: { label: 'Failed', tone: 'danger', action: 'Retry' },
      };
      return map[u.status] || map.idle;
    };

    const reduce = (u, msg) => {
      if (mod && typeof mod.updateUpload === 'function') {
        try { return mod.updateUpload(u, msg); } catch {}
      }
      if (msg.id !== u.id) return u;
      if (msg._tag === 'Start') return { ...u, status: 'uploading', progress: 8, attempt: u.attempt + 1 };
      if (msg._tag === 'Progress' && u.status === 'uploading') return { ...u, progress: msg.pct };
      if (msg._tag === 'Complete') return { ...u, status: 'done', progress: 100 };
      if (msg._tag === 'Cancel') return { ...u, status: 'cancelled' };
      if (msg._tag === 'Restart') return { ...u, status: 'uploading', progress: 5, attempt: u.attempt + 1 };
      if (msg._tag === 'Fail') return { ...u, status: 'failed' };
      return u;
    };

    function logTrace(text) {
      trace.unshift({ at: Math.round(performance.now() - t0) + 'ms', text });
      if (trace.length > 18) trace.pop();
    }

    function dispatch(msg) {
      uploads = uploads.map((u) => reduce(u, msg));
      if (msg._tag !== 'Progress') logTrace(JSON.stringify(msg));
      paint();
    }

    function cancelFiber(id, silent) {
      const timer = fibers.get(id);
      if (timer) {
        clearInterval(timer);
        fibers.delete(id);
        if (!silent) logTrace('Command.Service[switch] interrupted fiber ' + id);
      }
    }

    function startFiber(id, isRestart) {
      const hadPrior = fibers.has(id);
      cancelFiber(id, true);
      if (hadPrior) logTrace('Command.Service[switch] interrupted prior fiber ' + id + ' -> restarting');
      dispatch({ _tag: isRestart ? 'Restart' : 'Start', id });
      const timer = setInterval(() => {
        const cur = uploads.find((u) => u.id === id);
        if (!cur || cur.status !== 'uploading') { cancelFiber(id, true); return; }
        const step = Math.max(6, Math.round(140 / Math.max(10, cur.sizeMb)));
        const nextPct = Math.min(100, cur.progress + step);
        if (nextPct >= 100) {
          cancelFiber(id, true);
          dispatch({ _tag: 'Complete', id });
        } else {
          dispatch({ _tag: 'Progress', id, pct: nextPct });
        }
      }, 170);
      fibers.set(id, timer);
    }

    function toneClass(tone) {
      if (tone === 'success') return 'pill-ok';
      if (tone === 'warn') return 'pill-warn';
      if (tone === 'danger') return 'pill-err';
      if (tone === 'accent') return 'pill-accent';
      return '';
    }

    function paint() {
      root.innerHTML = '';
      const header = document.createElement('div');
      header.className = 'card';
      header.innerHTML = \`
        <div class="between">
          <div>
            <div class="eyebrow">Effect UI · Command.Service (switch mode)</div>
            <div style="color:var(--muted);font-size:12px;margin-top:2px">Restarting interrupts the active fiber cleanly with zero stale ticks.</div>
          </div>
          <div class="row">
            <button class="btn btn-primary btn-sm" data-all="start">Start All</button>
            <button class="btn btn-sm" data-all="cancel">Cancel All</button>
          </div>
        </div>
      \`;
      header.querySelector('[data-all="start"]').onclick = () => uploads.forEach((u) => startFiber(u.id, u.attempt > 0));
      header.querySelector('[data-all="cancel"]').onclick = () => uploads.forEach((u) => { cancelFiber(u.id, false); if (u.status === 'uploading') dispatch({ _tag: 'Cancel', id: u.id }); });
      root.appendChild(header);

      uploads.forEach((u) => {
        const badge = badgeOf(u);
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = \`
          <div class="between">
            <div>
              <strong style="font-family:var(--mono);font-size:12.5px">\${u.name}</strong>
              <span style="color:var(--muted);font-size:11.5px;margin-left:6px">\${u.sizeMb} MB · attempt #\${u.attempt}</span>
            </div>
            <span class="pill \${toneClass(badge.tone)}">\${badge.label}</span>
          </div>
          <div class="bar-track"><div class="bar-fill \${u.status}" style="width:\${u.progress}%"></div></div>
          <div class="row">
            <button class="btn btn-sm btn-primary" data-btn="primary">\${badge.action}</button>
            <button class="btn btn-sm" data-btn="restart">Restart (switch)</button>
            <button class="btn btn-sm" data-btn="fail">Simulate Error</button>
          </div>
        \`;
        card.querySelector('[data-btn="primary"]').onclick = () => {
          if (u.status === 'uploading') {
            cancelFiber(u.id, false);
            dispatch({ _tag: 'Cancel', id: u.id });
          } else {
            startFiber(u.id, u.status !== 'idle');
          }
        };
        card.querySelector('[data-btn="restart"]').onclick = () => startFiber(u.id, true);
        card.querySelector('[data-btn="fail"]').onclick = () => {
          cancelFiber(u.id, false);
          dispatch({ _tag: 'Fail', id: u.id, reason: 'network reset' });
        };
        root.appendChild(card);
      });

      const logCard = document.createElement('div');
      logCard.className = 'card';
      logCard.innerHTML = \`
        <div class="between" style="margin-bottom:6px">
          <span class="eyebrow">Fiber &amp; Message Log</span>
          <span class="pill">\${fibers.size} active fibers</span>
        </div>
        <div class="log-list">
          \${trace.length === 0 ? '<div class="log-item" style="color:var(--muted)">Click Start or Start All to watch switch-mode fibers in action.</div>' : trace.map((t) => \`<div class="log-item"><span>\${t.text}</span><span style="color:var(--muted)">\${t.at}</span></div>\`).join('')}
        </div>
      \`;
      root.appendChild(logCard);
    }

    paint();
  }

  async function renderConsoleOutput(mod) {
    let exitKind = 'Success';
    let exitValue = null;
    try {
      if (mod && typeof mod.main === 'function') {
        exitValue = await runEffect(mod.main(), new Map());
      } else {
        exitValue = mod || 'Module evaluated (no exported main() found)';
      }
    } catch (e) {
      exitKind = 'Failure';
      exitValue = e && e._typedFail ? e.error : (e && e.message ? e.message : String(e));
    }
    const elapsed = Math.max(1, Math.round(performance.now() - startTime));

    root.innerHTML = \`
      <div class="card">
        <div class="between">
          <span class="eyebrow">Effect Execution Result</span>
          <div class="row">
            <span class="pill \${exitKind === 'Success' ? 'pill-ok' : 'pill-err'}">Exit.\${exitKind}</span>
            <span class="pill">\${elapsed} ms</span>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="between" style="margin-bottom:8px">
          <span class="eyebrow">Structured Console Output</span>
          <span class="pill">\${logs.length} lines</span>
        </div>
        <div class="log-list">
          \${logs.length === 0
            ? '<div class="console-line" style="color:var(--muted)">No Console.log output emitted.</div>'
            : logs.map((l) => \`<div class="console-line"><span class="console-ts">+\${l.ms}ms</span>\${l.text.replaceAll('&','&amp;').replaceAll('<','&lt;')}</div>\`).join('')}
        </div>
      </div>
      <div class="card">
        <div class="eyebrow" style="margin-bottom:6px">Return Value</div>
        <pre class="result">\${JSON.stringify(exitValue, null, 2)?.replaceAll('&','&amp;').replaceAll('<','&lt;') || 'undefined'}</pre>
      </div>
    \`;
  }

  try {
    const mod = evaluateModule();
    if (PREVIEW_MODE === 'ui-counter') renderCounterUI(mod);
    else if (PREVIEW_MODE === 'ui-uploads') renderUploadsUI(mod);
    else void renderConsoleOutput(mod);
  } catch (err) {
    root.innerHTML = \`
      <div class="card">
        <div class="between" style="margin-bottom:8px">
          <span class="eyebrow">Preview Runtime Notice</span>
          <span class="pill pill-err">Exit.Failure</span>
        </div>
        <pre class="result">\${String(err && err.message ? err.message : err).replaceAll('&','&amp;').replaceAll('<','&lt;')}</pre>
      </div>
    \`;
  }
})();
</script>
</body>
</html>`
}
