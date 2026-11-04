/** @throws {Error} */
export function bad(parts:TemplateStringsArray):number {throw new Error("bad")}
/** @throws {never} */
export function safe(parts:TemplateStringsArray):number{return 1}
