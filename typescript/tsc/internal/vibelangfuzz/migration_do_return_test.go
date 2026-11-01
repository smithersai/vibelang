package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const migrationDoReturnTarget = "FuzzMigrationDoReturn"
const migrationDoReturnQuote = "Their outward returns and typed failures are still checked at the enclosing activation."
const migrationDoFunctionQuote = "`return` is allowed when the `do` is within a function"
const migrationDoParameterQuote = "`return` is allowed even within function parameter lists"

func TestMigrationDoReturnQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), migrationDoReturnQuote) {
		t.Fatal("Chapter2 outward-return rule changed")
	}
	text, err := os.ReadFile(SpecPath("../vips/tc39-do-expressions/explainer.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{migrationDoFunctionQuote, migrationDoParameterQuote} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("pinned TC39 explainer no longer says %q", quote)
		}
	}
}

type migrationDoReturnPair struct {
	vibe, native string
	reject       bool
}

func migrationDoReturnPrograms() map[string]migrationDoReturnPair {
	pairs := map[string]migrationDoReturnPair{}
	for _, home := range []string{"function", "arrow", "concise", "method", "effect", "async", "generator", "module", "static"} {
		for _, form := range []string{"direct", "conditional", "match"} {
			for depth := range 3 {
				expression := "do {if (n > 0) return 7; 9}"
				switch form {
				case "conditional":
					expression = "n > 0 ? do {return 7} : 9"
				case "match":
					expression = "match (n) {when 1: do {return 7}; default: 9;}"
				}
				for range depth {
					expression = "do {(" + expression + ")}"
				}
				wrap := func(expr string, native bool) string {
					switch home {
					case "function":
						return "export function f(n:number):number {return " + expr + "}\n"
					case "arrow":
						return "export const f=(n:number):number=>{return " + expr + "};\n"
					case "concise":
						return "export const f=(n:number):number=>" + expr + ";\n"
					case "method":
						return "export const factory={f(n:number):number{return " + expr + "}};\n"
					case "effect":
						if native {
							return "import {Effect} from \"effect\";\nexport function f(n:number):Effect.Effect<number>{return Effect.succeed(" + expr + ")}\n"
						}
						return "export effect function f(n:number):number!! {return " + expr + "}\n"
					case "async":
						return "export async function f(n:number):Promise<number>{return " + expr + "}\n"
					case "generator":
						return "export function* f(n:number):Generator<never,number,unknown>{return " + expr + "}\n"
					case "module":
						if native {
							return "export {};\nreturn 7;\n"
						}
						return "export const n=1; export const result=" + expr + ";\n"
					case "static":
						if native {
							return "export class C {static {return 7;}}\n"
						}
						return "export class C {static {const n=1; const result=" + expr + "; void result;}}\n"
					}
					panic("unknown home")
				}
				key := fmt.Sprintf("%s:%s:depth=%d", home, form, depth)
				pairs[key] = migrationDoReturnPair{wrap(expression, false), wrap("n > 0 ? 7 : 9", true), home == "module" || home == "static"}
			}
		}
	}
	for _, home := range []string{"function", "async", "effect"} {
		for depth := range 3 {
			expression := "do {if (true) return 7; 0}"
			for range depth {
				expression = "do {(" + expression + ")}"
			}
			vibe := "export function f(n:number=" + expression + "):number {return n;}\n"
			native := "export function f(n:number=0):number {return n;}\n"
			if home == "async" {
				vibe = "export async function f(n:number=" + expression + "):Promise<number> {return n;}\n"
				native = "export async function f(n:number=0):Promise<number> {return n;}\n"
			}
			if home == "effect" {
				vibe = "export effect function f(n:number=" + expression + "):number!! {return n;}\n"
				native = "import {Effect} from \"effect\";\nexport function f(n:number=0):Effect.Effect<number>{return Effect.succeed(n);}\n"
			}
			pairs[fmt.Sprintf("parameter:%s:depth=%d", home, depth)] = migrationDoReturnPair{vibe, native, false}
		}
	}
	pairs["foldkit-match-arrow-do-return"] = migrationDoReturnPair{"export const f = (n: number): number => match (n) { when 1: do { return 7 }; default: 9; }\n", "export const f=(n:number):number=>n===1?7:9;\n", false}
	pairs["foldkit-direct-arrow-do-return"] = migrationDoReturnPair{"export const f = (n: number): number => do { if (n > 0) return 7; 9 }\n", "export const f=(n:number):number=>n>0?7:9;\n", false}
	pairs["foldkit-block-arrow-do-return"] = migrationDoReturnPair{"export const f = (n: number): number => { return match (n) { when 1: do { return 7 }; default: 9; } }\n", "export const f=(n:number):number=>{return n===1?7:9};\n", false}
	return pairs
}

// This target checks static admission of outward returns, not their runtime
// value. Existing VIP2/VIP7 differential constructs retain runtime ownership.
// Ordinary TypeScript controls validate every callable kind; module and
// static-block controls require the native outside-return diagnostics (TS1108 or TS18041).
func FuzzMigrationDoReturn(f *testing.F) {
	startShortBudget(f)
	pairs := migrationDoReturnPrograms()
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
		TestMigrationDoReturnQuoted(t)
		if _, ok := pairs[key]; !ok {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		pair := pairs[key]
		for _, native := range []bool{true, false} {
			file, source := "main.vibe", pair.vibe
			if native {
				file, source = "control.ts", pair.native
			}
			var result *Result
			var err error
			within(t, "check do return activation", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{file: source}}) })
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			count, unrelated := 0, 0
			for _, d := range result.Diagnostics {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if !IsEK(d) && (d.Code() == 1108 || d.Code() == 18041) {
					count++
				} else {
					unrelated++
				}
			}
			valid := count == 0 && unrelated == 0
			if pair.reject {
				valid = count > 0 && unrelated == 0
			}
			if !valid {
				if native {
					t.Fatalf("invalid TypeScript context control: reject=%t diagnostics=%v\n%s", pair.reject, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
				}
				Gap(t, migrationDoReturnTarget, key, "VIP2 TC39 enclosing activation: reject=%t; diagnostics=%v\n%s", pair.reject, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
			}
		}
		ExpectPending(t, migrationDoReturnTarget, key)
		ExpectPending(t, migrationDoReturnTarget, specCorpusKey(t))
	})
}
