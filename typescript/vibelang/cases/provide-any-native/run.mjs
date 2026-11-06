import {Effect,Layer} from "effect";
import {inspect} from "./out/main.js";
const exit=Effect.runSyncExit(inspect(Layer.empty));
console.log(JSON.stringify({tag:exit._tag,value:exit.value}));
