import assert from "node:assert/strict"
import {Effect} from "effect"
import * as A0 from "./out/guard0.js"
import * as R0 from "./out/reference0.js"
import * as A1 from "./out/guard1.js"
import * as R1 from "./out/reference1.js"
import * as A2 from "./out/guard2.js"
import * as R2 from "./out/reference2.js"
import * as A3 from "./out/guard3.js"
import * as R3 from "./out/reference3.js"
import * as A4 from "./out/guard4.js"
import * as R4 from "./out/reference4.js"
import * as A5 from "./out/guard5.js"
import * as R5 from "./out/reference5.js"
import * as A6 from "./out/guard6.js"
import * as R6 from "./out/reference6.js"
import * as A7 from "./out/guard7.js"
import * as R7 from "./out/reference7.js"
import * as A8 from "./out/guard8.js"
import * as R8 from "./out/reference8.js"
import * as A9 from "./out/guard9.js"
import * as R9 from "./out/reference9.js"
import * as A10 from "./out/guard10.js"
import * as R10 from "./out/reference10.js"
import * as A11 from "./out/guard11.js"
import * as R11 from "./out/reference11.js"
import * as A12 from "./out/guard12.js"
import * as R12 from "./out/reference12.js"
import * as A13 from "./out/guard13.js"
import * as R13 from "./out/reference13.js"
import * as A14 from "./out/guard14.js"
import * as R14 from "./out/reference14.js"
import * as A15 from "./out/guard15.js"
import * as R15 from "./out/reference15.js"
import * as A16 from "./out/guard16.js"
import * as R16 from "./out/reference16.js"
import * as A17 from "./out/guard17.js"
import * as R17 from "./out/reference17.js"
import * as A18 from "./out/guard18.js"
import * as R18 from "./out/reference18.js"
import * as A19 from "./out/guard19.js"
import * as R19 from "./out/reference19.js"
import * as A20 from "./out/guard20.js"
import * as R20 from "./out/reference20.js"
const serial=v=>JSON.parse(JSON.stringify(v))
const pair=(actual,reference)=>assert.deepEqual(serial(Effect.runSyncExit(Effect.sync(actual))),serial(Effect.runSyncExit(Effect.sync(reference))))
pair(A0.witness,R0.witness)
pair(A1.witness,R1.witness)
pair(A2.witness,R2.witness)
pair(A3.witness,R3.witness)
pair(A4.witness,R4.witness)
pair(A5.witness,R5.witness)
pair(A6.witness,R6.witness)
pair(A7.witness,R7.witness)
pair(A8.witness,R8.witness)
pair(A9.witness,R9.witness)
pair(A10.witness,R10.witness)
pair(A11.witness,R11.witness)
pair(A12.witness,R12.witness)
pair(A13.witness,R13.witness)
pair(A14.witness,R14.witness)
pair(A15.witness,R15.witness)
pair(A16.witness,R16.witness)
pair(A17.witness,R17.witness)
pair(A18.witness,R18.witness)
pair(A19.witness,R19.witness)
pair(A20.witness,R20.witness)
console.log("ok")
