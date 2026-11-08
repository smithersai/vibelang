export class Plain { constructor(readonly n: number) {} }
export class Throwing {
 /** @throws {RangeError} */
 constructor(readonly n: number) {}
}
export const sample = Object.create(Plain.prototype) as Plain
