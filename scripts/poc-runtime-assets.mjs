/** Source bytes consumed by compiler-owned runtime bundle emission, plus the
 * standalone sandbox/loader runners. These are explicit package build inputs. */
export const pocRuntimeAssets = Object.freeze([
  ["poc/src/agent/deno-runner.js", "poc/dist/agent/deno-runner.js"],
  ["poc/src/build/loader-runner.js", "poc/dist/build/loader-runner.js"],
  ...["errors", "failure", "effect", "lexical", "panic", "result", "values", "wire"].map(name =>
    [`poc/src/runtime/${name}.ts`, `poc/dist/durable/bundle-assets/runtime/${name}.ts.txt`]),
  ["poc/src/durable/keyed-value-core.ts", "poc/dist/durable/bundle-assets/durable/keyed-value-core.ts.txt"],
].map(pair => Object.freeze(pair)));
