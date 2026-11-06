import { $direct, $plainSync } from "vibelang-runtime/internal"; 
import { name } from "./names.js"; export { name } from "./names.js"; export function value(...$args) { return $plainSync(value$direct, this, $args) } value[$direct] = value$direct;
function value$direct() { return name }