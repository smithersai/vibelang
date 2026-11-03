import type { CodeModeTool } from "fixture/tool"
const create: typeof CodeModeTool.create = (execute: (name: string, index: number) => number) => execute("ok", 1)
console.log(create((name, index) => name.length + index))
