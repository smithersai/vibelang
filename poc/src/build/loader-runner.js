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
if (initial?.kind !== "init" || initial.protocol !== 1) {
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

const RealDate = Date;
const parseDate = RealDate.parse.bind(RealDate);
const utcDate = RealDate.UTC.bind(RealDate);
function HermeticDate() { throw new Error("Date construction is unavailable in a hermetic comptime loader"); }
defineProperties(HermeticDate, {
  now: { value: deny("Date.now"), configurable: false, writable: false },
  parse: { value: parseDate, configurable: false, writable: false },
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

function toStable(value, path = "comptime result", seen = new Set()) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!isFiniteNumber(value)) throw new SafeTypeError(`${path} is not stable JSON: non-finite number`);
    return objectIs(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") throw new SafeTypeError(`${path} is not stable JSON: ${typeof value}`);
  if (seen.has(value)) throw new SafeTypeError(`${path} is not stable JSON: cyclic value`);
  seen.add(value);
  try {
    if (isArray(value)) {
      if (getPrototypeOf(value) !== Array.prototype) throw new SafeTypeError(`${path} is not stable JSON: exotic array`);
      const result = [];
      for (let index = 0; index < value.length; index++) {
        if (!hasOwn(value, index)) throw new SafeTypeError(`${path}[${index}] is not stable JSON: sparse array`);
        result.push(toStable(value[index], `${path}[${index}]`, seen));
      }
      if (ownKeys(value).some((key) => key !== "length" &&
        (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) {
        throw new SafeTypeError(`${path} is not stable JSON: unsupported array property`);
      }
      return result;
    }
    const prototype = getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new SafeTypeError(`${path} is not stable JSON: exotic object`);
    }
    const result = createObject(null);
    const keys = ownKeys(value).sort((left, right) => compareText(String(left), String(right)));
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      if (typeof key !== "string") throw new SafeTypeError(`${path} is not stable JSON: symbol property`);
      const descriptor = getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new SafeTypeError(`${path}.${key} is not stable JSON: accessor or hidden property`);
      }
      result[key] = toStable(descriptor.value, `${path}.${key}`, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

deepFreeze(initial.context.options);
if (initial.invocation?.mode === "comptime") deepFreeze(initial.invocation.args);

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
  } else if (initial.invocation?.mode === "comptime" && Array.isArray(initial.invocation.args)) {
    const callArguments = new Array(initial.invocation.args.length + 1);
    for (let index = 0; index < initial.invocation.args.length; index++) callArguments[index] = initial.invocation.args[index];
    callArguments[callArguments.length - 1] = context;
    value = await applyFunction(loader, undefined, callArguments);
  } else {
    throw new TypeError("sandbox invocation is invalid");
  }
  await send({ kind: "result", value: toStable(value) });
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
