package vibelangfuzz

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const effectBareReturnTarget = "FuzzEffectBareReturnDiagnostics"
const effectBareReturnQuote = "| `effect function f(p) { B }` | `function f(p) { return Effect.gen(function* () { B }) }` |"
const effectBareMethodQuote = "| `effect m(p) { B }`, `effect #m(p) { B }` |"
const effectBareArrowQuote = "| `effect (p) => { B }` | `(p) => Effect.gen(function* () { B })` |"

//go:embed testdata/corpus/foldkit-bare-effect-return.vibe
var effectBareReturnWitness string

//go:embed testdata/corpus/foldkit-bare-effect-return.ts
var effectBareReturnTwin string

var effectBareReturnKeys = []string{
	"foldkit-bare-effect-return", "bare-effect-arrow", "bare-effect-method",
	"foldkit-finalizer-bare-return", "nested-bare-return", "explicit-undefined",
	"all-paths-bare-return", "valued-partial-return",
}

func TestEffectBareReturnDiagnosticsQuoted(t *testing.T) {
	r4Quoted(t, "001-functions.md", effectBareReturnQuote, effectBareArrowQuote, effectBareMethodQuote)
}

func effectBareReturnProject(key string, noImplicitReturns, stock bool) Project {
	prefix := "import { Effect } from \"effect\";\n"
	body := "if (flag) return; try Effect.void;"
	switch key {
	case "nested-bare-return":
		body = "if (flag) { if (flag) return; } try Effect.void;"
	case "explicit-undefined":
		body = "if (flag) return undefined; try Effect.void;"
	case "all-paths-bare-return":
		body = "if (flag) return; try Effect.void; return;"
	case "valued-partial-return":
		body = "if (flag) return 1; try Effect.void;"
	}
	source := prefix + "export effect function bare(flag: boolean) { " + body + " }\n"
	twin := prefix + "export function bare(flag: boolean) { return Effect.gen(function* () { " + strings.ReplaceAll(body, "try Effect.void", "yield* Effect.void") + " }); }\n"
	if key == "foldkit-bare-effect-return" {
		source, twin = effectBareReturnWitness, effectBareReturnTwin
	}
	switch key {
	case "bare-effect-arrow":
		source = prefix + "export const bare = effect (flag: boolean) => { " + body + " };\n"
		twin = prefix + "export const bare = (flag: boolean) => Effect.gen(function* () { " + strings.ReplaceAll(body, "try Effect.void", "yield* Effect.void") + " });\n"
	case "bare-effect-method":
		source = prefix + "export class Cleanup { effect bare(flag: boolean) { " + body + " } }\n"
		twin = prefix + "export class Cleanup { bare(flag: boolean) { return Effect.gen(function* () { " + strings.ReplaceAll(body, "try Effect.void", "yield* Effect.void") + " }); } }\n"
	case "foldkit-finalizer-bare-return":
		source = prefix + "export const cleanup = Effect.addFinalizer(effect (exit) => { if (exit._tag === \"Failure\") return; try Effect.void; });\n"
		twin = prefix + "export const cleanup = Effect.addFinalizer((exit) => Effect.gen(function* () { if (exit._tag === \"Failure\") return; yield* Effect.void; }));\n"
	}
	main := "main.vibe"
	if stock {
		main, source = "main.ts", twin
	}
	config := fmt.Sprintf(`{"compilerOptions":{"target":"ESNext","module":"ESNext","moduleResolution":"Bundler","strict":true,"noImplicitReturns":%t,"noEmit":true,"types":[],"skipLibCheck":true},"files":[%q],"vibe":{"effectGlobals":false,"effectModules":false}}`, noImplicitReturns, main)
	return Project{Files: map[string]string{main: source}, Config: config}
}

// All generated twins form a finite keyed family. Batch each compiler-option
// setting so stock tsc parses the pinned Effect declarations once per setting,
// while retaining each file's diagnostics as that input's independent oracle.
func effectBareReturnStockOracles(tb testing.TB, w *Workspace, tsc string) map[bool]map[string][]string {
	tb.Helper()
	result := map[bool]map[string][]string{}
	for _, flag := range []bool{false, true} {
		p := effectBareReturnProject(effectBareReturnKeys[0], flag, true)
		p.Files = map[string]string{}
		names, byFile := []string{}, map[string]string{}
		result[flag] = map[string][]string{}
		for i, key := range effectBareReturnKeys {
			name := fmt.Sprintf("case-%d.ts", i)
			names = append(names, name)
			byFile[name] = key
			result[flag][key] = nil
			p.Files[name] = effectBareReturnProject(key, flag, true).Files["main.ts"]
		}
		var config map[string]any
		if err := json.Unmarshal([]byte(p.Config), &config); err != nil {
			tb.Fatal(err)
		}
		config["files"] = names
		encoded, err := json.Marshal(config)
		if err != nil {
			tb.Fatal(err)
		}
		p.Config = string(encoded)
		dir, err := toolsWrite(w, p)
		if err != nil {
			tb.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(tb.Context(), HangLimit)
		cmd := exec.CommandContext(ctx, "node", tsc, "-p", filepath.Join(dir, "tsconfig.json"), "--pretty", "false")
		output, runErr := cmd.CombinedOutput()
		contextErr := ctx.Err()
		cancel()
		os.RemoveAll(dir)
		count := 0
		for line := range strings.SplitSeq(string(output), "\n") {
			if m := stockDiagnostic.FindStringSubmatch(line); m != nil && m[4] == "error" {
				key, found := byFile[filepath.Base(m[1])]
				if !found || m[5] != "7030" {
					tb.Fatalf("unexpected stock diagnostic: %s", line)
				}
				result[flag][key] = append(result[flag][key], "TS"+m[5])
				count++
			}
		}
		if contextErr != nil || runErr != nil && count == 0 {
			tb.Fatalf("stock batch failed: %v; %v\n%s", contextErr, runErr, output)
		}
		for _, key := range effectBareReturnKeys {
			var want []string
			if flag && key == "valued-partial-return" {
				want = []string{"TS7030"}
			}
			if !slices.Equal(result[flag][key], want) {
				tb.Fatalf("stock control %s noImplicitReturns=%t: got %v, want %v", key, flag, result[flag][key], want)
			}
		}
		tb.Logf("stock TypeScript 5.9.3 batch: %d twins, noImplicitReturns=%t, %d diagnostics", len(names), flag, count)
	}
	return result
}

func FuzzEffectBareReturnDiagnostics(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "001-functions.md", effectBareReturnQuote, effectBareArrowQuote, effectBareMethodQuote)
	tsc := effectAliasStock(f)
	f.Add("foldkit-bare-effect-return", false)
	w := NewWorkspace(f)
	stockCodes := effectBareReturnStockOracles(f, w, tsc)
	f.Fuzz(func(t *testing.T, key string, noImplicitReturns bool) {
		if !slices.Contains(effectBareReturnKeys, key) {
			key = effectBareReturnKeys[r4Pick([]byte(key), effectBareReturnKeys)]
		}
		stock := effectBareReturnProject(key, noImplicitReturns, true)
		want := stockCodes[noImplicitReturns][key]
		for _, code := range want {
			if code != "TS7030" {
				t.Fatalf("%s: unexpected stock diagnostics %v", key, want)
			}
		}
		t.Logf("stock TypeScript 5.9.3: %s: noImplicitReturns=%t: %v", key, noImplicitReturns, want)
		p := effectBareReturnProject(key, noImplicitReturns, false)
		r, err := w.Compile(t.Context(), p)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got := r4Errors(r.Diagnostics)
		for _, code := range got {
			if code != "TS7030" {
				t.Fatalf("%s: unexpected native diagnostics %v\n%s", key, got, Archive(p.Files))
			}
		}
		gapKey := fmt.Sprintf("diagnostics:%s:noImplicitReturns=%t", key, noImplicitReturns)
		if !slices.Equal(got, want) {
			Gap(t, effectBareReturnTarget, gapKey, "Chapter 1: %s; %s\nstock twin: %v; native: %v\n%s\n%s", effectBareReturnQuote, effectBareArrowQuote, want, got, Archive(stock.Files), Archive(p.Files))
		}
		ExpectPending(t, effectBareReturnTarget, gapKey)
		ExpectPending(t, effectBareReturnTarget, specCorpusKey(t))
	})
}
