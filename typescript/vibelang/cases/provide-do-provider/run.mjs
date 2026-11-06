import {Effect} from "effect";
import {skipped,built} from "./out/main.js";
console.log(JSON.stringify(Effect.runSync(skipped([1,2,3]))));
console.log(JSON.stringify(Effect.runSync(built())));
