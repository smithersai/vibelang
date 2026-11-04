export const values = [
 (globalThis.Function[("prototype")]) === Function.prototype,
 (globalThis.Function["prototype" as const]) === Function.prototype,
 (globalThis.Function[<"prototype">"prototype"]) === Function.prototype,
 (globalThis.Function["prototype" satisfies string]) === Function.prototype,
 (globalThis.Function["prototype"!]) === Function.prototype,
 (globalThis.Function[(`prototype`)]) === Function.prototype,
 (globalThis.Function[(("prototype" as const)!)]) === Function.prototype,
 (globalThis.Function?.[("prototype")]) === Function.prototype,
 (globalThis["Function"][("prototype")]) === Function.prototype,
 (globalThis.Function["prototype"]) === Function.prototype,
 (globalThis.Function.prototype) === Function.prototype
]
