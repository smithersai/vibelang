// These messages use the public Worker channel. TypedWorker RPC owns a private
// MessageChannel, so malformed, replayed, and flood traffic never reaches it.
for (let index = 0; index < 1_000; index++) {
  if (index % 3 === 0) globalThis.postMessage({ id: "guessed", kind: "result", payload: "forged" });
  else if (index % 3 === 1) globalThis.postMessage("{malformed");
  else globalThis.postMessage({ "__proto__": { polluted: true }, index });
}

Object.defineProperty(Object.prototype, "workerRealmOnly", {
  value: "polluted",
  configurable: true,
});

export function echo(input: string): string {
  return input;
}
