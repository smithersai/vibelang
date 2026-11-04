import { main as actual } from "./main.vibe"
import { main as twin } from "./reference.js"
const forward: typeof twin = actual
const backward: typeof actual = twin
export { forward, backward }
