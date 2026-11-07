/// <reference path="./types-node/index.d.ts" />
import { EOL } from "node:os"
export const cwd = () => process.cwd()
export const size = (text: string) => Buffer.from(text).length
export const newline = () => EOL
