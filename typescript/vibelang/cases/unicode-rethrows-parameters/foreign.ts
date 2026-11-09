export const sentinel = new RangeError("input")
export const events: string[] = []
export const templates: boolean[] = []
let cjkParts: TemplateStringsArray | undefined
let joinerParts: TemplateStringsArray | undefined
/** @throws {RangeError} */
export function risky(): number { events.push("risky"); throw sentinel }
/** @throws {never} @rethrows café */
export function invokeLatin(café:()=>number):number {events.push("latin");return café()}
/** @throws {never} @rethrows 𐐀x */
export function invokeAstral(𐐀x:()=>number):number {events.push("astral");return 𐐀x()}
/** @throws {never} @rethrows 回调 */
export function tagCjk(parts:TemplateStringsArray,回调:()=>number):number {
 templates.push(cjkParts === undefined || cjkParts === parts);cjkParts=parts
 events.push("cjk");return 回调()
}
/** @throws {never} @rethrows c‍b */
export function tagJoiner(parts:TemplateStringsArray,c‍b:()=>number):number {
 templates.push(joinerParts === undefined || joinerParts === parts);joinerParts=parts
 events.push("joiner");return c‍b()
}
/** @throws {never} @rethrows café */
export function tagLatin(parts:TemplateStringsArray,café:()=>number):number {return café()}
