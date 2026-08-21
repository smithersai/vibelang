import { runTypeScriptCompiler } from "./compiler-process.js";

process.exitCode = runTypeScriptCompiler(process.argv.slice(2));

