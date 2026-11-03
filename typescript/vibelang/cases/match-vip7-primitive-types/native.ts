/// <reference path="./native-vm.d.ts" />
import { runInNewContext } from "node:vm"
/** @throws {never} */
export function boxes():unknown[] {return runInNewContext("[new String('x'),new Number(2),new Boolean(false),Object(3n),Object(Symbol.for('x'))]") as unknown[]}
