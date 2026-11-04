export const checks = [
 Function[("prototype")] === Function.prototype,
 Function[("prototype" as const)] === Function.prototype,
 Function[("prototype" satisfies string)] === Function.prototype,
 Function["prototype"!] === Function.prototype,
]
