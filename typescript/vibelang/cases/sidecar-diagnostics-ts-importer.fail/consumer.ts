// expect: TS4094
import { value } from "./main.vibe"
// Every checker but VibeLang reads main.vibe through its sidecar, which cannot
// print the class's private member, so the error is reported here, at the
// import, even though the project asks for no declarations (the foldkit migration).
export const read = value.read()
