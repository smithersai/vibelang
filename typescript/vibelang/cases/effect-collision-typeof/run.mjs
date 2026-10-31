import * as A from "effect/Array"
import * as S from "effect/String"
import { arrays, head, strings } from "./out/main.js"
console.log(JSON.stringify([arrays === A, strings === S, head === A.head]))
