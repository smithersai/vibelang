import { as as Plain } from "./out/plain.js";
import { as as Generic } from "./out/generic.js";
const plain = Plain.Value();
const generic = Generic.Value({ value: 1 });
console.log(JSON.stringify([plain._tag, generic._tag, generic.value]));
