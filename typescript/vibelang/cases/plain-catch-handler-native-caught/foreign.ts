/** @throws {Error} */
export function parse(text:string):number {
 if (text==="bad") throw new Error(text)
 return Number(text)
}
