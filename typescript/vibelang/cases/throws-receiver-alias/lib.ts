export interface Reader<T> {
 /** @throws {T} */
 read(text:string):number
}
let calls=0
export const reader:Reader<never>={read(text){calls++;return 7}}
/** @throws {never} */
export function count(){return calls}
