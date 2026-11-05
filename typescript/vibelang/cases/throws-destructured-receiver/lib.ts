export interface Reader<T> {
 /** @throws {T} */
 read(text:string):number
}
let calls=0
let reads=0
const reader:Reader<never>={read(text){calls++;return 7}}
export const nested={get reader():Reader<never>{reads++;return reader}}
/** @throws {never} */
export function count(){return [calls,reads]}
