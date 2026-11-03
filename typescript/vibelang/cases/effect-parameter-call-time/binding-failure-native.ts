export const sentinel = { reason: "default" }
function failDefault(): number { throw sentinel }
// A native getter can fail while the VibeLang parameter is being bound.
export const bindingDefaults = { get value(): number { return failDefault() } }
