package vibelangfuzz

import (
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const foreignCallbackCallsTarget = "FuzzMigrationForeignCallbackCalls"
const foreignCallbackCallsQuote = "An effectful callable's thrown type is `never`, and it never rethrows a callback: its failures are its Effect's error channel."
const foreignCallbackFixQuote = "One `vibelang --fix` run applies fixes until none applies; running it again changes nothing."
const foreignCallbackScopeQuote = "Dependencies, `typeRoots`, bundled libraries, foreign `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, declarations"

func TestMigrationForeignCallbackCallsQuoted(t *testing.T) {
	for _, quote := range []struct{ chapter, text string }{
		{"003-failures.md", foreignCallbackCallsQuote},
		{"003-failures.md", "| no tag | `unknown` |"},
		{"003-failures.md", "Tags attach to call signatures: each overload and a returned callable's own signature carry their own."},
		{"007-tooling.md", foreignCallbackFixQuote},
		{"007-tooling.md", foreignCallbackScopeQuote},
	} {
		if !strings.Contains(SpecText(quote.chapter), quote.text) {
			t.Fatalf("%s no longer says %q", quote.chapter, quote.text)
		}
	}
}

func foreignCallbackCallFiles(carrier, callee string, mode int) map[string]string {
	prefix := "import * as Effect from \"effect/Effect\";\n"
	if mode&1 != 0 {
		prefix += "import { die } from \"effect/Effect\";\n"
	}
	if mode&16 != 0 {
		prefix = strings.TrimPrefix(prefix, "import * as Effect from \"effect/Effect\";\n")
	}
	imported, call := "import { foreign } from \"./foreign.js\";\n", "foreign"
	switch callee {
	case "alias":
		imported, call = "import { foreign as invoke } from \"./foreign.js\";\n", "invoke"
	case "namespace":
		imported, call = "import * as native from \"./foreign.js\";\n", "native.foreign"
	case "method":
		imported, call = "import { native } from \"./foreign.js\";\n", "native.foreign"
	}
	annotation := ""
	if mode&8 != 0 {
		annotation = "/** @throws {never} */ "
	}
	foreign := annotation + "export declare function foreign(error: unknown): { readonly errorType: \"object\" };\n"
	if callee == "method" {
		foreign = "export declare const native: {\n" + annotation + "foreign(error: unknown): { readonly errorType: \"object\" };\n};\n"
	}
	body := call + "(\"failure\"); return Effect.void;"
	if mode&2 != 0 {
		body = "/* retain call */ " + body
	}
	callback := "() => { " + body + " }"
	if mode&32 != 0 {
		callback = "function () { " + body + " }"
	}
	expression := "Effect.suspend(" + callback + ")"
	if carrier == "catch" {
		expression = "Effect.fail(1).pipe(Effect.catch(" + callback + "))"
	}
	source := prefix + imported + "export const program = " + expression + ";\n"
	if mode&4 != 0 {
		source = strings.ReplaceAll(source, "\n", "\r\n")
		foreign = strings.ReplaceAll(foreign, "\n", "\r\n")
	}
	return map[string]string{"main.vibe": source, "foreign.d.ts": foreign}
}

func checkForeignCallbackCalls(t *testing.T, w *Workspace, carrier, callee string, mode int, files map[string]string, corpus bool) {
	t.Helper()
	TestMigrationForeignCallbackCallsQuoted(t)
	toolsGuard(t, foreignCallbackCallsTarget, func() {
		twin := maps.Clone(files)
		twin["main.ts"] = twin["main.vibe"]
		delete(twin, "main.vibe")
		if mode&16 != 0 {
			twin["main.ts"] = "import * as Effect from \"effect/Effect\";\n" + twin["main.ts"]
		}
		reference := toolsCompile(t, w, foreignCallbackCallsTarget, twin)
		defer reference.Remove()
		if !toolsErrorFree(reference) {
			t.Fatalf("invalid native TypeScript twin: %v\n%s", SortedKeys(Keys(reference.Dir, reference.Diagnostics)), Archive(twin))
		}
		before := toolsCompile(t, w, foreignCallbackCallsTarget, files)
		defer before.Remove()
		originalErrors := 0
		for _, d := range before.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			originalErrors++
			if !IsEK(d) || d.Code() != 401 {
				t.Fatalf("unexpected input diagnostic: %v\n%s", d.String(), Archive(files))
			}
		}
		if mode&8 != 0 && originalErrors != 0 {
			t.Fatalf("never-throwing control rejected: %v\n%s", SortedKeys(Keys(before.Dir, before.Diagnostics)), Archive(files))
		}
		if mode&8 == 0 && originalErrors == 0 {
			t.Fatal("unannotated foreign call lost its effectful callback contract")
		}
		config := toolsConfig(w, before.Dir)
		if config == nil || len(config.Errors) != 0 {
			t.Fatal("invalid callback project")
		}
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
		if result.Err != nil {
			Gap(t, foreignCallbackCallsTarget, "converge:"+carrier+":"+callee, "%s: %v", foreignCallbackFixQuote, result.Err)
		}
		fixed := maps.Clone(files)
		for name, file := range result.Files {
			rel := strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")
			if rel != "main.vibe" {
				t.Fatalf("repair wrote outside the owned source: %s", rel)
			}
			fixed[rel] = file.Text
		}
		after := toolsCompile(t, w, foreignCallbackCallsTarget, fixed)
		defer after.Remove()
		remaining := 0
		for _, d := range after.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if !IsEK(d) || d.Code() != 401 {
				Gap(t, foreignCallbackCallsTarget, fmt.Sprintf("diagnostic:%s:%s:%s:%d", carrier, callee, d.Source(), d.Code()), "repair introduced %s\n%s", d.String(), Archive(fixed))
			}
			remaining++
		}
		repairKey := "repair:" + carrier + ":" + callee
		if remaining != 0 {
			if mode&8 != 0 {
				t.Fatal("never-throwing control acquired EK0401")
			}
			Gap(t, foreignCallbackCallsTarget, repairKey, "%s: foreign callee remains unrepaired; %v\n%s", foreignCallbackCallsQuote, SortedKeys(Keys(after.Dir, after.Diagnostics)), Archive(fixed))
		}
		if !toolsErrorFree(after) {
			t.Fatal("fixed callback did not emit")
		}
		if mismatch := toolsContractMismatch(t, w, reference, after, false); mismatch != "" {
			Gap(t, foreignCallbackCallsTarget, "contract:"+carrier+":"+callee, "%s\n%s", mismatch, Archive(fixed))
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
		if again.Err != nil {
			t.Fatal(again.Err)
		}
		for name, file := range again.Files {
			rel := strings.TrimPrefix(name.AsString(), filepath.ToSlash(after.Dir)+"/")
			if fixed[rel] != file.Text {
				Gap(t, foreignCallbackCallsTarget, "fixed-point:"+carrier+":"+callee, "%s\n%s", foreignCallbackFixQuote, Archive(fixed))
			}
		}
		if corpus {
			ExpectPending(t, foreignCallbackCallsTarget, "corpus:t3code-effectful-foreign-callee")
		}
	})
}

func TestMigrationForeignCallbackCallsCorpus(t *testing.T) {
	files := map[string]string{}
	for name, path := range map[string]string{"main.vibe": "t3code-effectful-foreign-callee.vibe", "foreign.d.ts": "t3code-effectful-foreign-callee.d.ts"} {
		data, err := os.ReadFile(filepath.Join("testdata", "corpus", path))
		if err != nil {
			t.Fatal(err)
		}
		files[name] = string(data)
	}
	generated := foreignCallbackCallFiles("suspend", "direct", 0)
	if files["main.vibe"] != generated["main.vibe"] || files["foreign.d.ts"] != generated["foreign.d.ts"] {
		t.Fatal("minimized original diverged from its named model")
	}
	checkForeignCallbackCalls(t, NewWorkspace(t), "suspend", "direct", 0, files, true)
}

// These originals must also be accepted by the unmodified TypeScript compiler;
// a skipped baseline cannot qualify a minimized source or its typed controls.
func TestMigrationForeignCallbackCallsStockTwins(t *testing.T) {
	w := NewWorkspace(t)
	tsc := StockTypeScript(t)
	for _, tc := range []struct {
		carrier, callee string
		mode            int
	}{
		{"suspend", "direct", 0},
		{"catch", "namespace", 1},
		{"suspend", "method", 8},
		{"catch", "alias", 57},
	} {
		var child *testing.T
		t.Run(fmt.Sprintf("%s-%s-%d", tc.carrier, tc.callee, tc.mode), func(t *testing.T) {
			child = t
			files := foreignCallbackCallFiles(tc.carrier, tc.callee, tc.mode)
			files["main.ts"] = files["main.vibe"]
			delete(files, "main.vibe")
			if tc.mode&16 != 0 {
				files["main.ts"] = "import * as Effect from \"effect/Effect\";\n" + files["main.ts"]
			}
			dir := emitDeclarationIdentityStock(t, w, tsc, Project{Files: files, Config: DefaultConfig})
			defer os.RemoveAll(dir)
		})
		if child.Skipped() {
			t.Fatal("stock TypeScript rejected an intended original")
		}
	}
}

func FuzzMigrationForeignCallbackCalls(f *testing.F) {
	startShortBudget(f)
	if testing.Short() && !toolsFuzzing() {
		for _, carrier := range []string{"suspend", "catch"} {
			for _, callee := range []string{"direct", "alias", "namespace", "method"} {
				f.Add(carrier + ":" + callee + ":0")
			}
		}
		for _, key := range []string{"suspend:method:8", "catch:direct:25", "catch:namespace:57", "suspend:alias:40"} {
			f.Add(key)
		}
	} else {
		for _, carrier := range []string{"suspend", "catch"} {
			for _, callee := range []string{"direct", "alias", "namespace", "method"} {
				for mode := range 64 {
					f.Add(carrier + ":" + callee + ":" + strconv.Itoa(mode))
				}
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		carrier, callee, mode := "suspend", "direct", 0
		parts := strings.Split(key, ":")
		if len(parts) == 3 {
			if parts[0] == "catch" {
				carrier = "catch"
			}
			for _, known := range []string{"direct", "alias", "namespace", "method"} {
				if parts[1] == known {
					callee = known
				}
			}
			if n, err := strconv.ParseUint(parts[2], 10, 8); err == nil {
				mode = int(n) % 64
			}
		} else if len(key) > 0 {
			if key[0]&1 != 0 {
				carrier = "catch"
			}
			callee = []string{"direct", "alias", "namespace", "method"}[int(key[0]/2)%4]
			if len(key) > 1 {
				mode = int(key[1]) % 64
			}
		}
		checkForeignCallbackCalls(t, w, carrier, callee, mode, foreignCallbackCallFiles(carrier, callee, mode), false)
	})
}
