import { modules, result } from "./out/main.js"
const expected = await Promise.all(["Array", "String", "Number", "Boolean", "BigInt", "Symbol", "Function", "RegExp", "Record", "Iterable"].map(name => import("effect/" + name)))
console.log(result && modules.every((module, index) => module === expected[index]))
