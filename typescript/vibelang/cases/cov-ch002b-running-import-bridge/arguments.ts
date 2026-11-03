/** @throws {string} */
export function badSpecifier(events:string[]):string{events.push("specifier");throw "specifier"}
/** @throws {string} */
export function badOptions(events:string[]):ImportCallOptions{events.push("options");throw "options"}
/** @throws {never} */
export function badCoercion(events:string[]):string{return {toString(){events.push("coerce");throw "coerce"}} as unknown as string}
