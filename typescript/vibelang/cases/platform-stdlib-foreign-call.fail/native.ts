import { readFile } from "node:fs/promises"
export function hostKind() { return typeof readFile }
