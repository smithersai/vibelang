package vibelang

import "testing"

// entryRunnerFiles are computedKeyFiles with the runners an entry module may
// call at its top level: effect's Effect.runPromise, which the prelude's
// runPromise re-exports, and Runtime.makeRunMain.
func entryRunnerFiles() map[string]string {
	files := computedKeyFiles(false)
	effect := "/workspace/x/src/node_modules/effect/"
	runtime := "/workspace/x/src/node_modules/vibelang-runtime/"
	files[effect+"package.json"] = `{"name":"effect","type":"module","exports":{".":{"types":"./index.d.ts"},"./Effect":{"types":"./Effect.d.ts"},"./Inspectable":{"types":"./Inspectable.d.ts"},"./Runtime":{"types":"./Runtime.d.ts"}}}`
	files[effect+"index.d.ts"] = `export * as Effect from "./Effect.js"; export * as Inspectable from "./Inspectable.js"; export * as Runtime from "./Runtime.js"`
	files[effect+"Effect.d.ts"] += "\nexport declare const runPromise: <A, E>(effect: Effect<A, E>) => Promise<A>\n"
	files[effect+"Runtime.d.ts"] = `import type { Effect } from "./Effect.js"
export declare const makeRunMain: (f: (options: { readonly fiber: unknown }) => void) => { <E, A>(effect: Effect<A, E>): void }
`
	files[runtime+"index.d.ts"] += `; export { runPromise } from "effect/Effect"`
	return files
}

func TestEntryMainExplicitRunner(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name, setup string
		automatic   bool
	}{
		{"standalone", `runPromise(main())`, false},
		{"initializer", `const pending = runPromise(main())`, false},
		{"exported initializer", `export const pending = runPromise(main())`, false},
		{"nested expression", `const started = { pending: Effect.runPromise(main()) }`, false},
		{"static field", `class Started { static pending = runPromise(main()) }`, false},
		{"static block", `class Started { static { runPromise(main()) } }`, false},
		{"made runner", "const runMain = Runtime.makeRunMain(() => {})\nrunMain(main())", false},
		{"delayed function", `function start() { runPromise(main()) }`, true},
		{"delayed arrow", `const start = () => runPromise(main())`, true},
		{"instance field", `class Start { pending = runPromise(main()) }`, true},
		// A runner is the declaration a call resolves to, not its spelling.
		{"method spelled like a runner", "const helper = { runSync: (n: number) => n + 1 }\nconst result = helper.runSync(1)", true},
		{"function spelled like a runner", "function runMain(n: number) { return n }\nconst started = runMain(1)", true},
		{"runner maker", `const runMain = Runtime.makeRunMain(() => {})`, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			files := entryRunnerFiles()
			files["/workspace/x/src/main.vibe"] = "export function main() { return 1 }\n" + test.setup
			program := computedKeyProgram(t, files)
			file := program.GetSourceFile("/workspace/x/src/main.vibe")
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			if got := entryMain(c, file) != nil; got != test.automatic {
				t.Errorf("automatic main = %v, want %v for %s", got, test.automatic, test.setup)
			}
		})
	}
}
