package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// VIP-27: sidecars must describe the selected module, even when a native
// sibling has the same stem. The oracle observes the runtime value, then asks
// stock TypeScript to check both consumers against that exact literal.
const sidecarSourceIdentityQuote = "For each `x.vibe`, the compiler writes `x.d.vibe.ts` beside it, and for each `x.vibex`, `x.d.vibex.ts` (VIP-27, VIP-39)."
const sidecarContentQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

func sidecarSourceIdentityQuoted(tb testing.TB) {
	tb.Helper()
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		tb.Fatal(err)
	}
	for _, quote := range []string{sidecarSourceIdentityQuote, sidecarContentQuote} {
		if !strings.Contains(string(chapter), quote) {
			tb.Fatalf("chapter 1 no longer says %q", quote)
		}
	}
}

func TestSidecarSourceIdentityQuoted(t *testing.T) { sidecarSourceIdentityQuoted(t) }

var sidecarIdentityForms = []struct {
	key, source, expression string
	typed                   bool
}{
	{"inferred", "import { make } from %s\nexport const value = make()\n", "value.tag", false},
	{"named", "export { value } from %s\n", "value", false},
	{"star", "export * from %s\n", "value", false},
	{"namespace", "export * as model from %s\n", "model.value", false},
	{"import-export", "import { value } from %s\nexport { value }\n", "value", false},
	{"import-type", "import type { Marker } from %[1]s\nexport type T = Marker\nexport { value } from %[1]s\n", "value", true},
	{"inline-type", "export type T = typeof import(%[1]s).value\nexport { value } from %[1]s\n", "value", true},
}

// Keyed input: form/sibling-mask/style/quote/target. Unrecognized fuzz bytes
// select the same dimensions numerically, so mutation explores sibling sets
// and spelling without making the saved corpus depend on form order.
func sidecarIdentityLeaf(literal string, declaration bool) string {
	if declaration {
		return fmt.Sprintf("export declare const value: %[1]q\nexport type Marker = typeof value\nexport interface Box { tag: %[1]q }\nexport declare function make(): Box\n", literal)
	}
	return fmt.Sprintf("export const value: %[1]q = %[1]q\nexport type Marker = typeof value\nexport interface Box { tag: %[1]q }\nexport function make(): Box { return { tag: %[1]q } }\n", literal)
}

func FuzzSidecarSourceIdentity(f *testing.F) {
	startShortBudget(f)
	sidecarSourceIdentityQuoted(f)
	w := NewWorkspace(f)
	stock := StockTypeScript(f)
	for _, seed := range []string{
		"inferred/1/.js/double/vibe",
		"inferred/2/.ts/single/vibe",
		"inferred/0/.js/double/js-file",
		"named/0/.js/double/vibe",
		"named/1/.js/double/vibe",
		"named/2/.js/double/vibe",
		"star/7/extensionless/single/vibe",
		"namespace/9/.ts/double/vibe",
		"import-export/15/.js/single/vibe",
		"import-type/1/.js/double/vibe",
		"inline-type/2/.ts/single/vibe",
		"named/0/.js/double/ts",
		"named/0/.js/double/js",
		"named/0/.js/double/js-file",
		"inline-type/0/.ts/single/js-file",
	} {
		f.Add([]byte(seed))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		t.Parallel()
		form, mask, style, quote, target := 0, 0, ".js", "\"", "vibe"
		if len(data) > 0 {
			form = int(data[0]) % len(sidecarIdentityForms)
		}
		if len(data) > 1 {
			mask = int(data[1]) % 16
		}
		if len(data) > 2 {
			style = []string{".js", ".ts", "extensionless"}[int(data[2])%3]
		}
		if len(data) > 3 && data[3]&1 != 0 {
			quote = "'"
		}
		if len(data) > 4 {
			target = []string{"vibe", "vibe", "vibe", "ts", "js", "js-file"}[int(data[4])%6]
		}
		parts := strings.Split(string(data), "/")
		if len(parts) == 5 {
			for i, candidate := range sidecarIdentityForms {
				if candidate.key == parts[0] {
					form = i
				}
			}
			if n, err := strconv.Atoi(parts[1]); err == nil {
				mask = n & 15
			}
			if parts[2] == ".js" || parts[2] == ".ts" || parts[2] == "extensionless" {
				style = parts[2]
			}
			if parts[3] == "single" {
				quote = "'"
			} else {
				quote = "\""
			}
			if parts[4] == "vibe" || parts[4] == "ts" || parts[4] == "js" || parts[4] == "js-file" {
				target = parts[4]
			}
		}
		key := fmt.Sprintf("%s/%d/%s/%s/%s", sidecarIdentityForms[form].key, mask, style, map[string]string{"\"": "double", "'": "single"}[quote], target)
		files := map[string]string{
			"package.json": "{\"type\":\"module\"}",
			"model.vibe":   sidecarIdentityLeaf("vibe", false),
		}
		for i, extension := range []string{"ts", "d.ts", "tsx", "js"} {
			if mask&(1<<i) == 0 || target != "vibe" {
				continue
			}
			text := sidecarIdentityLeaf("unrelated", false)
			if extension == "d.ts" {
				text = sidecarIdentityLeaf("unrelated", true)
			} else if extension == "js" {
				text = "/** @type {\"unrelated\"} */\nexport const value = \"unrelated\"\n"
			}
			files["model."+extension] = text
		}
		if target != "vibe" {
			// A native .js specifier resolves its TypeScript source twin.
			// Keeping model.vibe alongside it checks that sidecar emission
			// preserves that native resolution.
			files["model.ts"] = sidecarIdentityLeaf("native", false)
		}
		specifier := "./model." + target
		listed := `["main.vibe"]`
		if target == "js-file" {
			delete(files, "model.ts")
			files["native/model.js"] = "/** @typedef {{ tag: \"native\" }} Box */\n/** @type {\"native\"} */\nexport const value = \"native\"\n/** @returns {Box} */\nexport function make() { return { tag: \"native\" } }\n"
			files["native/model.d.ts"] = sidecarIdentityLeaf("native", true)
			specifier = "./native/model.js"
			listed = `["main.vibe","native/model.js"]`
		}
		selected := sidecarIdentityForms[form]
		files["main.vibe"] = fmt.Sprintf(selected.source, quote+specifier+quote)
		project := Project{Files: files, Config: fmt.Sprintf(
			`{"compilerOptions":{"target":"es2022","module":"esnext","moduleResolution":"bundler","strict":true,"types":[],"skipLibCheck":true,"rootDir":".","outDir":"out","declaration":true,"rewriteRelativeImportExtensions":true,"allowJs":true},"vibelang":{"declarationImportStyle":%q},"files":%s}`, style, listed)}
		r, err := w.CompileOrdered(t.Context(), project, OrderTsc, true)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		if HasError(r.Diagnostics) {
			Gap(t, "FuzzSidecarSourceIdentity", key, "producer rejected:\n%v\n%s", SortedKeys(Keys(r.Dir, r.Diagnostics)), files["main.vibe"])
		}
		for name, text := range r.Outputs {
			path := filepath.Join(r.Dir, filepath.FromSlash(name))
			if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte(text), 0644); err != nil {
				t.Fatal(err)
			}
		}
		diagnostics := r.Program.EmitDeclarationSidecars(t.Context(), func(name, text string) error {
			return os.WriteFile(name, []byte(text), 0644)
		})
		if HasError(diagnostics) {
			Gap(t, "FuzzSidecarSourceIdentity", key, "sidecar rejected: %v", SortedKeys(Keys(r.Dir, diagnostics)))
		}
		script := "import { pathToFileURL } from \"node:url\"; const m = await import(pathToFileURL(" + strconv.Quote(filepath.Join(r.Dir, "out/main.js")) + ")); console.log(JSON.stringify(m." + selected.expression + "))"
		cmd := exec.CommandContext(t.Context(), "node", "--input-type=module", "-e", script)
		cmd.Dir = r.Dir
		value, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("runtime: %v\n%s", err, value)
		}
		var literal string
		if err := json.Unmarshal([]byte(strings.TrimSpace(string(value))), &literal); err != nil {
			t.Fatalf("runtime literal: %v\n%s", err, value)
		}
		wantRuntime := "vibe"
		if target != "vibe" {
			wantRuntime = "native"
		}
		if literal != wantRuntime {
			Gap(t, "FuzzSidecarSourceIdentity", key, "runtime = %q, want %q", literal, wantRuntime)
		}
		for _, entry := range []string{"./main.vibe", "./out/main.js"} {
			consumer := "import * as m from " + strconv.Quote(entry) + "\n"
			expr := "m." + selected.expression
			consumer += "const correct: " + strconv.Quote(literal) + " = " + expr + "\n"
			consumer += "// @ts-expect-error Reject an unrelated literal, and reject any.\nconst wrong: \"impossible\" = " + expr + "\n"
			if selected.typed {
				consumer += "const typed: m.T = " + expr + "\n"
			}
			path := filepath.Join(r.Dir, "consumer.ts")
			if err := os.WriteFile(path, []byte(consumer), 0644); err != nil {
				t.Fatal(err)
			}
			cmd := exec.CommandContext(t.Context(), stock, "--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "false", "--allowArbitraryExtensions", "--allowImportingTsExtensions", "--module", "esnext", "--moduleResolution", "bundler", "--target", "es2022", path)
			cmd.Dir = r.Dir
			if output, err := cmd.CombinedOutput(); err != nil {
				Gap(t, "FuzzSidecarSourceIdentity", key, "stock consumer of %s disagrees with runtime %q: %v\n%s", entry, literal, err, output)
			}
		}
		ExpectPending(t, "FuzzSidecarSourceIdentity", key)
	})
}
