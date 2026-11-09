export const sentinel = new RangeError("input")
export const events: string[] = []
export const templates: boolean[] = []
let cjkParts: TemplateStringsArray | undefined
let joinerParts: TemplateStringsArray | undefined
/** @throws {RangeError} */
export function risky(): number { events.push("risky"); throw sentinel }
/** @throws {never} @rethrows \u0063\u0061\u0066\u00e9 */
export function invokeLatin(café:()=>number):number {events.push("latin");return café()}
/** @throws {never} @rethrows \u{10400}\u0078 */
export function invokeAstral(𐐀x:()=>number):number {events.push("astral");return 𐐀x()}
/** @throws {never} @rethrows \u56de\u8c03 */
export function tagCjk(parts:TemplateStringsArray,回调:()=>number):number {
 templates.push(cjkParts === undefined || cjkParts === parts);cjkParts=parts
 events.push("cjk");return 回调()
}
/** @throws {never} @rethrows \u0063\u200d\u0062 */
export function tagJoiner(parts:TemplateStringsArray,c‍b:()=>number):number {
 templates.push(joinerParts === undefined || joinerParts === parts);joinerParts=parts
 events.push("joiner");return c‍b()
}
/** @throws {never} @rethrows \u0063\u0061\u0066\u00e9 */
export function tagLatin(parts:TemplateStringsArray,café:()=>number):number {return café()}
