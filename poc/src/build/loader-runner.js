const runtime = Deno;
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const safeParse = JSON.parse.bind(JSON);
const safeStringify = JSON.stringify.bind(JSON);
const decode = decoder.decode.bind(decoder);
const encode = encoder.encode.bind(encoder);
const stdoutWrite = runtime.stdout.write.bind(runtime.stdout);
const stdinRead = runtime.stdin.read.bind(runtime.stdin);
const freeze = Object.freeze.bind(Object);
const getPrototypeOf = Object.getPrototypeOf.bind(Object);
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor.bind(Object);
const defineProperty = Object.defineProperty.bind(Object);
const defineProperties = Object.defineProperties.bind(Object);
const createObject = Object.create.bind(Object);
const hasOwn = Object.hasOwn.bind(Object);
const ownKeys = Reflect.ownKeys.bind(Reflect);
const isArray = Array.isArray.bind(Array);
const isFiniteNumber = Number.isFinite.bind(Number);
const objectIs = Object.is.bind(Object);
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const decodeBase64 = atob.bind(globalThis);
const applyFunction = Reflect.apply.bind(Reflect);
const uint8Slice = Uint8Array.prototype.slice;
const SafePromise = Promise;
const SafeError = Error;
const SafeTypeError = TypeError;
const SafeMap = Map;
const SafeSet = Set;
const safeMapGet = Map.prototype.get;
const safeMapSet = Map.prototype.set;
const safeSetHas = Set.prototype.has;
const safeSetAdd = Set.prototype.add;
const safeSetDelete = Set.prototype.delete;
const isSafeInteger = Number.isSafeInteger.bind(Number);
const mapGet = (map, key) => applyFunction(safeMapGet, map, [key]);
const mapSet = (map, key, value) => applyFunction(safeMapSet, map, [key, value]);
let buffered = new Uint8Array();

async function readLine() {
  while (true) {
    const newline = buffered.indexOf(10);
    if (newline >= 0) {
      const line = decode(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
      return line.endsWith("\r") ? line.slice(0, -1) : line;
    }
    const chunk = new Uint8Array(64 * 1024);
    const count = await stdinRead(chunk);
    if (count === null) {
      if (buffered.length === 0) return undefined;
      const line = decode(buffered);
      buffered = new Uint8Array();
      return line;
    }
    const combined = new Uint8Array(buffered.length + count);
    combined.set(buffered);
    combined.set(chunk.subarray(0, count), buffered.length);
    buffered = combined;
  }
}

let writeTail = Promise.resolve();
function send(message) {
  const bytes = encode(`${safeStringify(message)}\n`);
  const next = writeTail.then(async () => {
    let offset = 0;
    while (offset < bytes.length) offset += await stdoutWrite(bytes.subarray(offset));
  });
  writeTail = next.catch(() => {});
  return next;
}

const initialLine = await readLine();
if (initialLine === undefined) runtime.exit(2);
const initial = safeParse(initialLine);
if (initial?.kind !== "init" || initial.protocol !== 2) {
  await send({ kind: "error", name: "ProtocolError", message: "unsupported loader protocol" });
  runtime.exit(2);
}

const pending = new Map();
let nextRequestId = 0;
let reading = true;
const responses = (async () => {
  while (reading) {
    const line = await readLine();
    if (line === undefined) break;
    const message = safeParse(line);
    if (message?.kind !== "response" || !Number.isSafeInteger(message.id)) {
      throw new SafeError("host sent an invalid loader response");
    }
    const waiter = pending.get(message.id);
    if (!waiter) throw new SafeError("host responded to an unknown loader request");
    pending.delete(message.id);
    if (message.ok) waiter.resolve(message.value);
    else waiter.reject(new SafeError(String(message.error ?? "loader dependency request failed")));
  }
  pending.forEach((waiter) => waiter.reject(new SafeError("loader host protocol closed")));
  pending.clear();
})();

function request(method, specifier, options) {
  if (typeof specifier !== "string") return SafePromise.reject(new SafeTypeError("loader specifier must be a string"));
  const id = nextRequestId++;
  return new SafePromise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ kind: "request", id, method, specifier, ...(options === undefined ? {} : { options }) })
      .catch((error) => {
        pending.delete(id);
        reject(error);
      });
  });
}

function deny(name) {
  return () => { throw new Error(`${name} is unavailable in a hermetic comptime loader`); };
}

/**
 * The loader module is evaluated from a `data:` URL, but every frame beneath it
 * belongs to this file and carries its absolute host path. A loader that reads
 * `error.stack` — its own, or one of the `deny(...)` errors above — therefore
 * observed where the toolchain happens to be checked out, which is host state
 * the implementation digest cannot see. Only `data:` frames name the loader
 * itself; everything else is redacted to one stable token. Installed before
 * `Error` is frozen below, so a loader can neither replace nor remove it.
 */
const stackFrame = (frame) => {
  try {
    const file = frame.getFileName();
    const shown = typeof file === "string" && file.startsWith("data:") ? file : "vibelang:loader-runner";
    const name = frame.getFunctionName();
    const position = `${shown}:${String(frame.getLineNumber())}:${String(frame.getColumnNumber())}`;
    return typeof name === "string" && name !== "" ? `\n    at ${name} (${position})` : `\n    at ${position}`;
  } catch {
    return "\n    at vibelang:loader-runner";
  }
};
defineProperty(Error, "prepareStackTrace", {
  value: (error, frames) => {
    let text = `${String(error?.name ?? "Error")}: ${String(error?.message ?? "")}`;
    if (isArray(frames)) for (let index = 0; index < frames.length; index++) text += stackFrame(frames[index]);
    return text;
  },
  configurable: false,
  writable: false,
});

const RealDate = Date;
const parseDate = RealDate.parse.bind(RealDate);
const utcDate = RealDate.UTC.bind(RealDate);
/**
 * The subset of the ECMA-262 Date Time String Format whose result does not
 * depend on the host time zone: a date-only form (which the specification fixes
 * to UTC) or a date-time carrying an explicit offset. Every other spelling —
 * `2020-01-01T00:00:00`, `Jan 1 2020`, `2020/01/01` — is interpreted in the
 * host's local time zone, so the same loader produced different bytes on
 * different machines under one implementation digest.
 */
const OFFSET_QUALIFIED_DATE =
  /^(?:[+-]\d{6}|\d{4})(?:-\d{2}(?:-\d{2})?)?(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;
function hermeticParseDate(value) {
  const text = String(value);
  if (!OFFSET_QUALIFIED_DATE.test(text)) {
    throw new Error(
      "Date.parse is available in a hermetic comptime loader only for an ISO-8601 date " +
      "(YYYY, YYYY-MM, YYYY-MM-DD) or a date-time with an explicit UTC offset " +
      "(YYYY-MM-DDTHH:mm[:ss[.sss]] followed by Z or +HH:mm); every other spelling is " +
      "interpreted in the host time zone",
    );
  }
  return parseDate(text);
}
function HermeticDate() { throw new Error("Date construction is unavailable in a hermetic comptime loader"); }
defineProperties(HermeticDate, {
  now: { value: deny("Date.now"), configurable: false, writable: false },
  parse: { value: hermeticParseDate, configurable: false, writable: false },
  UTC: { value: utcDate, configurable: false, writable: false },
});
freeze(HermeticDate.prototype);
freeze(HermeticDate);
function lockGlobal(name, value) {
  defineProperty(globalThis, name, { value, configurable: false, writable: false });
}
lockGlobal("Date", HermeticDate);
defineProperty(Math, "random", { value: deny("Math.random"), configurable: false, writable: false });
for (const name of ["createObjectURL", "revokeObjectURL"]) {
  if (name in URL) defineProperty(URL, name, { value: deny(`URL.${name}`), configurable: false, writable: false });
}
defineProperty(String.prototype, "localeCompare", {
  value: function localeCompare(other) { return compareText(String(this), String(other)); },
  configurable: false,
  writable: false,
});
for (const [prototype, name] of [
  [String.prototype, "toLocaleLowerCase"], [String.prototype, "toLocaleUpperCase"],
  [Number.prototype, "toLocaleString"], [BigInt.prototype, "toLocaleString"],
  [Array.prototype, "toLocaleString"],
]) {
  defineProperty(prototype, name, { value: deny(name), configurable: false, writable: false });
}
lockGlobal("Deno", undefined);
lockGlobal("process", undefined);
lockGlobal("Buffer", undefined);
lockGlobal("caches", undefined);
lockGlobal("location", undefined);
lockGlobal("fetch", deny("fetch"));
lockGlobal("setTimeout", deny("setTimeout"));
lockGlobal("setInterval", deny("setInterval"));
lockGlobal("setImmediate", deny("setImmediate"));
lockGlobal("clearTimeout", undefined);
lockGlobal("clearInterval", undefined);
lockGlobal("clearImmediate", undefined);
lockGlobal("queueMicrotask", queueMicrotask);
lockGlobal("performance", freeze({ now: deny("performance.now"), timeOrigin: 0 }));
lockGlobal("Performance", undefined);
lockGlobal("PerformanceEntry", undefined);
lockGlobal("PerformanceMark", undefined);
lockGlobal("PerformanceMeasure", undefined);
lockGlobal("crypto", undefined);
lockGlobal("navigator", undefined);
lockGlobal("Intl", undefined);
lockGlobal("Temporal", undefined);
lockGlobal("File", undefined);
lockGlobal("FormData", undefined);
lockGlobal("Request", undefined);
lockGlobal("Response", undefined);
lockGlobal("Headers", undefined);
lockGlobal("AbortController", undefined);
lockGlobal("AbortSignal", undefined);
lockGlobal("Atomics", undefined);
lockGlobal("SharedArrayBuffer", undefined);
lockGlobal("MessageChannel", undefined);
lockGlobal("MessagePort", undefined);
lockGlobal("WeakRef", undefined);
lockGlobal("FinalizationRegistry", undefined);
lockGlobal("reportError", undefined);
lockGlobal("Worker", undefined);
lockGlobal("SharedWorker", undefined);
lockGlobal("WebSocket", undefined);
lockGlobal("EventSource", undefined);
lockGlobal("BroadcastChannel", undefined);
lockGlobal("localStorage", undefined);
lockGlobal("sessionStorage", undefined);
lockGlobal("alert", deny("alert"));
lockGlobal("confirm", deny("confirm"));
lockGlobal("prompt", deny("prompt"));
lockGlobal("console", freeze({
  log: deny("console.log"), info: deny("console.info"), warn: deny("console.warn"),
  error: deny("console.error"), debug: deny("console.debug"), trace: deny("console.trace"),
}));

function deepFreeze(value, seen = new Set()) {
  if (value === null || (typeof value !== "object" && typeof value !== "function") || seen.has(value)) return value;
  seen.add(value);
  const keys = ownKeys(value);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    const descriptor = getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return freeze(value);
}

function base64Bytes(source) {
  const binary = decodeBase64(source);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) output[index] = binary.charCodeAt(index);
  return output;
}

function toStable(value, path = "comptime result", seen = new SafeSet(), copies = new SafeMap(), budget = { nodes: 0 }, depth = 0) {
  if (++budget.nodes > 1_000_000 || depth > 512) throw new SafeTypeError(`${path} exceeds the data depth or expanded-size budget`);
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!isFiniteNumber(value)) throw new SafeTypeError(`${path} is not stable JSON: non-finite number`);
    // The in-sandbox mirror of `stable.ts`'s `stableClone`, and it has to make
    // the same choice: coercing here would silently normalize -0 to 0 before
    // `stableClone` ever saw it, so the sandboxed comptime path would keep the
    // behaviour the in-process path refuses. One -0 policy, both sides.
    if (objectIs(value, -0)) throw new SafeTypeError(`${path} is not stable JSON: negative zero`);
    return value;
  }
  if (typeof value !== "object") throw new SafeTypeError(`${path} is not stable JSON: ${typeof value}`);
  if (applyFunction(safeSetHas, seen, [value])) throw new SafeTypeError(`${path} is not stable JSON: cyclic value`);
  applyFunction(safeSetAdd, seen, [value]);
  try {
    if (isArray(value)) {
      if (getPrototypeOf(value) !== Array.prototype) throw new SafeTypeError(`${path} is not stable JSON: exotic array`);
      const result = [];
      for (let index = 0; index < value.length; index++) {
        if (!hasOwn(value, index)) throw new SafeTypeError(`${path}[${index}] is not stable JSON: sparse array`);
        const descriptor = getOwnPropertyDescriptor(value, index);
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          throw new SafeTypeError(`${path}[${index}] is not stable JSON: accessor or hidden property`);
        }
        result[index] = toStable(descriptor.value, `${path}[${index}]`, seen, copies, budget, depth + 1);
      }
      if (ownKeys(value).some((key) => key !== "length" &&
        (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) {
        throw new SafeTypeError(`${path} is not stable JSON: unsupported array property`);
      }
      const previous = mapGet(copies, value);
      mapSet(copies, value, previous ?? result);
      return previous ?? result;
    }
    const prototype = getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new SafeTypeError(`${path} is not stable JSON: exotic object`);
    }
    const result = createObject(null);
    // Transport the program value, including property order. Canonicalizing
    // metadata on the host must not change JSON.stringify/Object.keys here.
    const keys = ownKeys(value);
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      if (typeof key !== "string") throw new SafeTypeError(`${path} is not stable JSON: symbol property`);
      const descriptor = getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new SafeTypeError(`${path}.${key} is not stable JSON: accessor or hidden property`);
      }
      result[key] = toStable(descriptor.value, `${path}.${key}`, seen, copies, budget, depth + 1);
    }
    const previous = mapGet(copies, value);
    mapSet(copies, value, previous ?? result);
    return previous ?? result;
  } finally {
    applyFunction(safeSetDelete, seen, [value]);
  }
}

// The bounded postorder graph protocol in comptime-value.ts. This runner is a
// standalone sandbox bootstrap; shared identity vectors exercise both codecs
// across the real process boundary. Reflection and collection methods used
// after the authored module returns were captured before importing that module.
function encodeValueGraph(value) {
  const snapshot = toStable(value);
  const ids = new SafeMap();
  const nodes = [];
  function visit(current) {
    if (current === null || typeof current !== "object") return current;
    const prior = mapGet(ids, current);
    if (prior !== undefined) return ["ref", prior];
    let node;
    if (isArray(current)) {
      const items = [];
      for (let index = 0; index < current.length; index++) items[index] = visit(current[index]);
      node = { kind: "array", items };
    } else {
      const keys = ownKeys(current);
      const entries = [];
      for (let index = 0; index < keys.length; index++) entries[index] = [keys[index], visit(current[keys[index]])];
      node = { kind: "object", entries };
    }
    const index = nodes.length;
    nodes[index] = node;
    mapSet(ids, current, index);
    return ["ref", index];
  }
  const root = visit(snapshot);
  return { version: 1, nodes, root };
}

function decodeValueGraph(value) {
  const graph = toStable(value);
  const keys = (node) => ownKeys(node).sort(compareText).join(",");
  if (!graph || typeof graph !== "object" || isArray(graph) || keys(graph) !== "nodes,root,version" ||
    graph.version !== 1 || !isArray(graph.nodes)) throw new SafeTypeError("Invalid comptime value graph envelope");
  const values = [];
  const resolve = (reference) => {
    if (reference === null || typeof reference !== "object") return reference;
    if (!isArray(reference) || reference.length !== 2 || reference[0] !== "ref" ||
      !isSafeInteger(reference[1]) || reference[1] < 0 || reference[1] >= values.length) {
      throw new SafeTypeError("Invalid or forward comptime value reference");
    }
    return values[reference[1]];
  };
  for (const node of graph.nodes) {
    if (!node || typeof node !== "object" || isArray(node)) throw new SafeTypeError("Invalid comptime value node");
    if (node.kind === "array" && keys(node) === "items,kind" && isArray(node.items)) {
      values.push(node.items.map(resolve));
    } else if (node.kind === "object" && keys(node) === "entries,kind" && isArray(node.entries)) {
      // Inputs have ordinary JSON object prototypes, as they did under the
      // previous JSON transport. Define own keys so __proto__ is still data.
      const object = {};
      for (const entry of node.entries) {
        if (!isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || hasOwn(object, entry[0])) {
          throw new SafeTypeError("Invalid or duplicate comptime object entry");
        }
        defineProperty(object, entry[0], { value: resolve(entry[1]), enumerable: true, writable: true, configurable: true });
      }
      values.push(object);
    } else throw new SafeTypeError("Invalid comptime value node shape");
  }
  const result = resolve(graph.root);
  // The compiler emits exactly this field order. Matching the complete graph
  // also refuses unreachable definitions and noncanonical alias/entry order.
  if (safeStringify(encodeValueGraph(result)) !== safeStringify(graph)) {
    throw new SafeTypeError("Noncanonical comptime value graph");
  }
  return result;
}

deepFreeze(initial.context.options);
if (initial.invocation?.mode === "comptime") {
  initial.invocation.args = decodeValueGraph(initial.invocation.args);
  if (!isArray(initial.invocation.args)) throw new SafeTypeError("Comptime arguments must be an array");
  deepFreeze(initial.invocation.args);
}

if (typeof initial.sourceBase64 !== "string") {
  await send({ kind: "error", name: "ProtocolError", message: "loader source was missing" });
  runtime.exit(2);
}
const sourceUrl = `data:text/javascript;base64,${initial.sourceBase64}`;

for (const intrinsic of [
  Object, Function, Array, Map, Set, WeakMap, WeakSet, Promise, JSON, Reflect, Math,
  Number, String, Boolean, BigInt, Symbol, RegExp, Error, TypeError, RangeError,
  SyntaxError, EvalError, ReferenceError, URIError, AggregateError,
  Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, URL, URLSearchParams,
]) {
  if (intrinsic?.prototype) freeze(intrinsic.prototype);
  freeze(intrinsic);
}
freeze(getPrototypeOf(Uint8Array.prototype));
for (const [name, intrinsic] of [
  ["Object", Object], ["Function", Function], ["Array", Array], ["Map", Map], ["Set", Set],
  ["WeakMap", WeakMap], ["WeakSet", WeakSet], ["Promise", Promise],
  ["JSON", JSON], ["Reflect", Reflect], ["Math", Math], ["Number", Number],
  ["String", String], ["Boolean", Boolean], ["BigInt", BigInt], ["Symbol", Symbol],
  ["RegExp", RegExp], ["Error", Error], ["TypeError", TypeError],
  ["RangeError", RangeError], ["SyntaxError", SyntaxError], ["Uint8Array", Uint8Array],
  ["ArrayBuffer", ArrayBuffer], ["TextEncoder", TextEncoder], ["TextDecoder", TextDecoder],
  ["URL", URL], ["URLSearchParams", URLSearchParams],
]) lockGlobal(name, intrinsic);
try {
  const imported = await import(sourceUrl);
  const loader = imported[initial.exportName];
  if (typeof loader !== "function") {
    throw new TypeError(`loader module does not export function '${initial.exportName}'`);
  }
  const context = freeze({
    target: initial.context.target,
    options: freeze(initial.context.options),
    readText: (specifier) => request("readText", specifier),
    readBytes: async (specifier) => {
      const value = await request("readBytes", specifier);
      return base64Bytes(value.base64);
    },
    import: (specifier, options = {}) => request("import", specifier, options),
  });
  let value;
  if (initial.invocation?.mode === "loader") {
    const bytes = base64Bytes(initial.invocation.asset.bytes);
    const asset = freeze({
      path: initial.invocation.asset.path,
      get bytes() { return applyFunction(uint8Slice, bytes, []); },
      text: () => decode(bytes),
    });
    value = await loader(asset, context);
  } else if (initial.invocation?.mode === "comptime" && isArray(initial.invocation.args)) {
    const callArguments = new Array(initial.invocation.args.length + 1);
    for (let index = 0; index < initial.invocation.args.length; index++) callArguments[index] = initial.invocation.args[index];
    callArguments[callArguments.length - 1] = context;
    value = await applyFunction(loader, undefined, callArguments);
  } else {
    throw new TypeError("sandbox invocation is invalid");
  }
  await send({ kind: "result", value: initial.invocation.mode === "comptime" ? encodeValueGraph(value) : toStable(value) });
  reading = false;
  await writeTail;
  runtime.exit(0);
} catch (error) {
  reading = false;
  await send({
    kind: "error",
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  await writeTail;
  runtime.exit(1);
}

await responses;
