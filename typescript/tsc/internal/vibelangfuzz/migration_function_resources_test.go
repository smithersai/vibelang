package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

const migrationFunctionResourcesTarget = "FuzzMigrationFunctionResources"
const migrationFunctionResourcesQuote = "Calls retain ordinary JavaScript evaluation, including receivers, arguments and parameter initialization"
const migrationFunctionKindQuote = "A function's kind is decided by a keyword on the function, never by its body or by a type."

func TestMigrationFunctionResourcesQuoted(t *testing.T) {
	for chapter, quote := range map[string]string{"002-running.md": migrationFunctionResourcesQuote, "001-functions.md": migrationFunctionKindQuote} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}

func migrationFunctionResourcePrograms() map[string][2]string {
	pairs := map[string][2]string{}
	pairs["foldkit-function-resource-cleanup"] = [2]string{"import type { Scope } from \"effect\"\nexport const f = effect (): void!never!Scope.Scope => {\n  try Effect.acquireRelease(\n    Effect.sync((): (() => void) => (): void => {}),\n    release => Effect.sync(release),\n  )\n}\n", "import {Effect} from \"effect\";\nimport type {Scope} from \"effect\";\nexport const f = ():Effect.Effect<void,never,Scope.Scope> => Effect.gen(function*(){yield* Effect.acquireRelease(Effect.sync((): (()=>void) => ():void=>{}),release=>Effect.sync(release));});\n"}
	head := "import {Effect} from \"effect\";\nimport type {Scope} from \"effect\";\n"
	for _, kind := range []string{"number", "void", "object"} {
		result := map[string]string{"number": "number", "void": "void", "object": "{readonly value:number}"}[kind]
		inner := map[string]string{"number": "():number=>1", "void": "():void=>{}", "object": "():{readonly value:number}=>({value:1})"}[kind]
		fn := "(()=>" + result + ")"
		for _, factory := range []string{"inline", "variable", "function"} {
			setup, make := "", "(): "+fn+" => "+inner
			if factory == "variable" {
				setup = "const make = " + make + ";\n"
				make = "make"
			}
			if factory == "function" {
				setup = "function make(): " + fn + " {return " + inner + ";}\n"
				make = "make"
			}
			for _, operation := range []string{"acquire-call", "acquire-discard", "map", "succeed-call"} {
				acquire := "Effect.sync(" + make + ")"
				body := ""
				out := result
				switch operation {
				case "acquire-call":
					body = "const resource = try Effect.acquireRelease(" + acquire + ", resource => Effect.sync(resource)); return resource();"
				case "acquire-discard":
					body = "try Effect.acquireRelease(" + acquire + ", resource => Effect.sync(resource));"
					out = "void"
				case "map":
					body = "return try Effect.map(" + acquire + ", resource => resource());"
				case "succeed-call":
					body = "const resource = try Effect.succeed((" + make + ")()); return resource();"
				}
				vibe := head + setup + "export effect function f(): (" + out + ")!never!Scope.Scope {" + body + "}\n"
				native := head + setup + "export function f():Effect.Effect<" + out + ",never,Scope.Scope>{return Effect.gen(function*(){" + strings.ReplaceAll(body, "try ", "yield* ") + "});}\n"
				pairs[kind+":"+factory+":"+operation] = [2]string{vibe, native}
			}
		}
	}
	return pairs
}

// Foldkit15: ordinary callbacks can return a function as their success value.
// This checks static admission and inference, including unused acquired values.
// Runtime construction/evaluation behavior stays in FuzzVIPDifferential.
func FuzzMigrationFunctionResources(f *testing.F) {
	startShortBudget(f)
	pairs := migrationFunctionResourcePrograms()
	keys := make([]string, 0, len(pairs))
	for key := range pairs {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	for _, key := range keys {
		f.Add(key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestMigrationFunctionResourcesQuoted(t)
		if _, ok := pairs[key]; !ok {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		pair := pairs[key]
		for _, index := range []int{1, 0} {
			file := "main.vibe"
			if index == 1 {
				file = "control.ts"
			}
			var result *Result
			var err error
			within(t, "check function-valued resource", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{file: pair[index]}}) })
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if HasError(result.Diagnostics) {
				if index == 1 {
					t.Fatalf("invalid TypeScript function-resource control: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), pair[index])
				}
				Gap(t, migrationFunctionResourcesTarget, key, "VIP1 keyword kind and Chapter2 ordinary arguments; diagnostics=%v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), pair[index])
			}
		}
		ExpectPending(t, migrationFunctionResourcesTarget, key)
		ExpectPending(t, migrationFunctionResourcesTarget, specCorpusKey(t))
	})
}
