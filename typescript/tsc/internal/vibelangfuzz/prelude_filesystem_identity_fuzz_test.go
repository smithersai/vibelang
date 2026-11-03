package vibelangfuzz

import (
	"context"
	"encoding/json"
	"os/exec"
	"slices"
	"strings"
	"testing"
)

const fileSystemIdentityTarget = "FuzzPreludeFileSystemIdentity"
const fileSystemIdentityQuote = "In a value or namespace position the table below decides."
const fileSystemIdentityRootQuote = "`FileSystem` and `Path` are root modules."

func TestPreludeFileSystemIdentityQuoted(t *testing.T) { fileSystemIdentityCheckQuoted(t) }

func fileSystemIdentityCheckQuoted(t testing.TB) {
	t.Helper()
	chapter := SpecText("005-services.md")
	for _, quote := range []string{domTypeOnlyQuote, fileSystemIdentityQuote, fileSystemIdentityRootQuote} {
		if !strings.Contains(chapter, quote) {
			t.Fatalf("chapter 5 no longer says %q", quote)
		}
	}
}

type fileSystemIdentityRule struct {
	key, form           string
	dom, ambient, roots bool
}

func fileSystemIdentityRules() []fileSystemIdentityRule {
	var rules []fileSystemIdentityRule
	for _, form := range []string{"function", "alias-arrow", "layer"} {
		for _, lib := range []string{"esnext", "esnext-dom"} {
			for _, ambient := range []string{"plain", "ambient"} {
				for _, roots := range []string{"adjacent", "rootdirs"} {
					rules = append(rules, fileSystemIdentityRule{
						key:  form + "/" + lib + "/" + ambient + "/" + roots,
						form: form, dom: lib == "esnext-dom", ambient: ambient == "ambient", roots: roots == "rootdirs",
					})
				}
			}
		}
	}
	return rules
}

func fileSystemIdentityPick(data []byte, rules []fileSystemIdentityRule) fileSystemIdentityRule {
	key := strings.TrimSuffix(strings.TrimPrefix(string(data), "key:"), "\x00")
	if i := slices.IndexFunc(rules, func(r fileSystemIdentityRule) bool { return r.key == key }); i >= 0 {
		return rules[i]
	}
	if len(data) == 0 {
		return rules[0]
	}
	return rules[int(data[0])%len(rules)]
}

// The explicit native import is an independent namespace/type-identity oracle.
// The .vibe form must keep qualified FileSystem members on that same module,
// while a bare ambient FileSystem type retains its distinct host meaning.
func fileSystemIdentityProject(rule fileSystemIdentityRule, native, wrong bool) Project {
	headers := "import * as E from \"effect/Effect\"\nimport * as NativeFS from \"effect/FileSystem\"\nimport * as L from \"effect/Layer\"\nimport * as C from \"effect/Context\"\nimport type { ExternalFS } from \"./env.js\"\n"
	var body string
	switch rule.form {
	case "function":
		body = "export effect function read() { const fs: FileSystem.FileSystem = try FileSystem.FileSystem; return fs }\nexport const exact: E.Effect<NativeFS.FileSystem, never, NativeFS.FileSystem> = read()\n"
		if native {
			body = "export function read() { return E.gen(function* () { const fs: NativeFS.FileSystem = yield* NativeFS.FileSystem; return fs }) }\nexport const exact: E.Effect<NativeFS.FileSystem, never, NativeFS.FileSystem> = read()\n"
		}
	case "alias-arrow":
		body = "type FS = FileSystem.FileSystem\nexport const read = effect () => { const fs: FS = try FileSystem.FileSystem; return fs }\nexport const exact: E.Effect<NativeFS.FileSystem, never, NativeFS.FileSystem> = read()\n"
		if native {
			body = "type FS = NativeFS.FileSystem\nexport const read = () => E.gen(function* () { const fs: FS = yield* NativeFS.FileSystem; return fs })\nexport const exact: E.Effect<NativeFS.FileSystem, never, NativeFS.FileSystem> = read()\n"
		}
	case "layer":
		body = "interface Box { readonly fs: NativeFS.FileSystem }\nconst Box: C.Service<Box, Box> = C.Service<Box, Box>(\"test/Box\")\nexport const layer: L.Layer<Box, never, FileSystem.FileSystem> = L.effect(Box, effect { const fs = try FileSystem.FileSystem; return { fs } })\n"
		if native {
			body = "interface Box { readonly fs: NativeFS.FileSystem }\nconst Box: C.Service<Box, Box> = C.Service<Box, Box>(\"test/Box\")\nexport const layer: L.Layer<Box, never, NativeFS.FileSystem> = L.effect(Box, E.gen(function* () { const fs = yield* NativeFS.FileSystem; return { fs } }))\n"
		}
	default:
		panic("unknown FileSystem identity form")
	}
	body += "export const external: ExternalFS = undefined as unknown as NativeFS.FileSystem\n"
	if rule.ambient {
		if native {
			body += "export type Host = globalThis.FileSystem\n"
		} else {
			body += "export type Host = FileSystem\n"
		}
	}
	extension := ".vibe"
	if native {
		extension = ".ts"
	}
	envFile := "src/env.d.ts"
	if rule.roots {
		envFile = ".sidecars/env.d.ts"
	}
	files := map[string]string{
		"src/main" + extension: headers + body,
		envFile:                "export type ExternalFS = import(\"effect/FileSystem\").FileSystem\n",
	}
	if rule.ambient {
		files["host.d.ts"] = "export {}\ndeclare global { interface FileSystem { readonly hostBrand: \"host\" } }\n"
	}
	if wrong {
		files["src/negative.ts"] = "import * as NativeFS from \"effect/FileSystem\"\nexport const polluted: globalThis.FileSystem = undefined as unknown as NativeFS.FileSystem\n"
	}
	var config map[string]any
	if err := json.Unmarshal([]byte(DefaultConfig), &config); err != nil {
		panic(err)
	}
	options := config["compilerOptions"].(map[string]any)
	options["exactOptionalPropertyTypes"] = true
	libs := []string{"esnext"}
	if rule.dom {
		libs = append(libs, "dom")
	}
	options["lib"] = libs
	if rule.roots {
		options["rootDirs"] = []string{"src", ".sidecars"}
	}
	var names []string
	for name := range files {
		names = append(names, name)
	}
	slices.Sort(names)
	config["files"] = names
	data, err := json.Marshal(config)
	if err != nil {
		panic(err)
	}
	return Project{Files: files, Config: string(data)}
}

func TestPreludeFileSystemIdentityStock(t *testing.T) {
	fileSystemIdentityCheckQuoted(t)
	w := NewWorkspace(t)
	stock := StockTypeScript(t)
	positive, negative := 0, 0
	for _, rule := range fileSystemIdentityRules() {
		if !rule.ambient || !rule.roots {
			continue
		}
		t.Run(rule.key, func(t *testing.T) {
			for _, wrong := range []bool{false, true} {
				project := fileSystemIdentityProject(rule, true, wrong)
				r, err := w.Compile(t.Context(), project)
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(r.Remove)
				ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
				defer cancel()
				cmd := exec.CommandContext(ctx, stock, "-p", r.Dir+"/tsconfig.json", "--noEmit", "--pretty", "false")
				cmd.Dir = r.Dir
				output, err := cmd.CombinedOutput()
				if !wrong {
					if err != nil {
						t.Fatalf("invalid native twin: %v\n%s", err, output)
					}
					positive++
				} else {
					if err == nil || !strings.Contains(string(output), "negative.ts") || !strings.Contains(string(output), "hostBrand") {
						t.Fatalf("ambient identity knockout did not fail at its declared brand: %v\n%s", err, output)
					}
					negative++
				}
			}
		})
	}
	if positive != 6 || negative != 6 {
		t.Fatalf("native controls: %d positive, %d negative", positive, negative)
	}
	t.Logf("native TypeScript identity controls: %d positive and %d intended negative verdicts", positive, negative)
}

func FuzzPreludeFileSystemIdentity(f *testing.F) {
	startShortBudget(f)
	fileSystemIdentityCheckQuoted(f)
	rules := fileSystemIdentityRules()
	for _, rule := range rules {
		f.Add([]byte(rule.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		rule := fileSystemIdentityPick(data, rules)
		native := fileSystemIdentityProject(rule, true, false)
		control, err := w.Compile(t.Context(), native)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(control.Remove)
		if errors := r4Errors(control.Diagnostics); len(errors) != 0 {
			t.Fatalf("invalid native twin %s: %v\n%s", rule.key, errors, Archive(native.Files))
		}
		project := fileSystemIdentityProject(rule, false, false)
		r, err := w.Compile(t.Context(), project)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(r.Remove)
		g := &Gaps{Target: fileSystemIdentityTarget, Input: Archive(project.Files)}
		if errors := r4Errors(r.Diagnostics); len(errors) != 0 {
			slices.Sort(errors)
			g.Add(rule.key+":"+strings.Join(errors, ","), "VIP-14: %s %s Qualified module type/value identity disagrees with explicit native imports; got %v", fileSystemIdentityQuote, fileSystemIdentityRootQuote, errors)
		}
		g.FinishInput(t, specCorpusKey(t))
	})
}
