package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const inlineModuleArtifactsTarget = "FuzzInlineModuleArtifacts"

var inlineModuleArtifactsQuotes = []struct{ chapter, text string }{
	{"../vips/0040-module-declarations.md", "A body's declarations are TypeScript's own declaration emit of it"},
	{"../vips/0040-module-declarations.md", "\x60include\x60 and default-glob discovery leave it out while \x60main.vibe\x60 declares the body"},
	{"../vips/0040-module-declarations.md", "listed explicitly in \x60files\x60, it stays an input, and the write reports \x60TS5055\x60"},
	{"../vips/0040-module-declarations.md", "changes no diagnostic, type, emitted statement, declaration or run-time observation"},
}

func TestInlineModuleArtifactsQuoted(t *testing.T) {
	for _, quote := range inlineModuleArtifactsQuotes {
		if !strings.Contains(SpecText(quote.chapter), quote.text) {
			t.Fatalf("%s no longer says %q", quote.chapter, quote.text)
		}
	}
}

func inlineModuleArtifactConfig(t *testing.T, dir, source string, declaration, explicit bool) {
	t.Helper()
	options := map[string]any{
		"target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
		"strict": true, "skipLibCheck": false, "types": []string{}, "jsx": "preserve",
		"declaration": declaration, "rewriteRelativeImportExtensions": true,
	}
	config := map[string]any{
		"compilerOptions": options,
		"vibe":            map[string]bool{"effectGlobals": false, "effectModules": false},
		"include":         []string{"*.vibe", "*.vibex", "*.ts"},
	}
	if explicit {
		delete(config, "include")
		config["files"] = []string{source}
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	moduleSidecarWrite(t, dir, "tsconfig.json", string(encoded))
}

func inlineModuleArtifactRun(t *testing.T, binary, dir, stage string) cliRun {
	t.Helper()
	result := cliExec(binary, dir, []string{"-p", "tsconfig.json", "--pretty", "false"}, "", Project{})
	if result.Hung != "" {
		t.Fatalf("%s did not finish: %s", stage, result.Hung)
	}
	return result
}

func FuzzInlineModuleArtifacts(f *testing.F) {
	startShortBudget(f)
	keys := []string{"brand/throwing", "brand/platform", "rebuild/throwing", "rebuild/platform"}
	for _, key := range keys {
		for _, variant := range []uint8{0, 1} {
			f.Add(key, variant)
		}
	}
	binary, stock := cliBuild(f, f.TempDir()), StockTypeScript(f)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestInlineModuleArtifactsQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		kind, name, _ := strings.Cut(key, "/")
		suffix := "vibe"
		if variant&1 != 0 {
			suffix = "vibex"
		}
		body := "export const ReplacementTypeId: unique symbol = Symbol('Replacement');\n" +
			"export class ReplacementValue { readonly [ReplacementTypeId] = true; }\n" +
			"export function make(): ReplacementValue { return new ReplacementValue(); }\n" +
			"export const version = 1 as const;\n"
		exports := "ReplacementTypeId, ReplacementValue, make, version"
		if kind == "brand" {
			body = "export namespace Replacement {\n" + strings.TrimSuffix(body, "export const version = 1 as const;\n") + "}\nexport const version = 1 as const;\n"
			exports = "Replacement, version"
		}
		source := "module " + name + " {\n" + body + "}\nexport {" + exports + "} from " + name + "\n"
		if variant == 0 && (key == "brand/throwing" || key == "rebuild/platform") {
			corpus := "opencode-inline-" + name + "-" + kind + ".vibe"
			original, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", corpus))
			if err != nil {
				t.Fatal(err)
			}
			if string(original) != source {
				t.Fatal("minimized corpus and generated source disagree")
			}
			source = string(original)
		}
		if variant&2 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		dir := t.TempDir()
		file := "main." + suffix
		bodyDeclaration := file + "." + name + ".d.ts"
		moduleSidecarWrite(t, dir, "package.json", "{\"type\":\"module\"}")
		moduleSidecarWrite(t, dir, file, source)
		inlineModuleArtifactConfig(t, dir, file, true, true)
		first := inlineModuleArtifactRun(t, binary, dir, "initial emit")
		if first.Status != 0 {
			t.Fatalf("valid initial module rejected: status%d\n%s%s", first.Status, first.Stdout, first.Stderr)
		}
		before, err := os.ReadFile(filepath.Join(dir, bodyDeclaration))
		if err != nil || !strings.Contains(string(before), "ReplacementValue") {
			t.Fatalf("body declaration missing: %v\n%s", err, before)
		}

		gapKey := key + "/" + suffix
		gaps := &Gaps{Target: inlineModuleArtifactsTarget, Input: fmt.Sprintf("%s/%d", key, variant)}
		if kind == "brand" {
			// Reach the same class through the containing source and its
			// emitted body declaration. An extracted TypeScript body has one identity.
			consumer := fmt.Sprintf("import {Replacement} from './%s';\nimport {Replacement as Other} from './%s.%s.js';\nconst value: Replacement.ReplacementValue = Other.make();\nconst mark: true = value[Replacement.ReplacementTypeId];\n// @ts-expect-error retain the branded member instead of accepting any\nconst invalid: false = value[Replacement.ReplacementTypeId];\n", file, file, name)
			moduleSidecarWrite(t, dir, "consumer.ts", consumer)
			inlineModuleArtifactConfig(t, dir, file, false, false)

			control := t.TempDir()
			moduleSidecarWrite(t, control, "package.json", "{\"type\":\"module\"}")
			moduleSidecarWrite(t, control, "body.ts", body)
			moduleSidecarWrite(t, control, "main.ts", "export {"+exports+"} from './body.js'\n")
			moduleSidecarWrite(t, control, "consumer.ts", strings.ReplaceAll(strings.ReplaceAll(consumer, "./"+file+"."+name+".js", "./body.js"), "./"+file, "./main.js"))
			inlineModuleArtifactConfig(t, control, "main.ts", false, false)
			stockResult := inlineModuleArtifactRun(t, stock, control, "stock extracted-body control")
			if stockResult.Status != 0 {
				t.Fatalf("extracted TypeScript body must keep one class identity: status%d\n%s%s", stockResult.Status, stockResult.Stdout, stockResult.Stderr)
			}
			configText, err := os.ReadFile(filepath.Join(dir, "tsconfig.json"))
			if err != nil {
				t.Fatal(err)
			}
			checked, err := w.Compile(t.Context(), Project{
				Files:  map[string]string{file: source, bodyDeclaration: string(before), "consumer.ts": consumer, "package.json": "{\"type\":\"module\"}"},
				Config: string(configText),
			})
			if err != nil || checked.Program == nil {
				t.Fatalf("identity checker did not create a program: %v", err)
			}
			defer checked.Remove()
			semantic := checked.Program.GetSemanticDiagnostics(t.Context(), nil)
			for _, diagnostic := range semantic {
				if diagnostic.Code() != 2741 {
					t.Fatalf("unexpected diagnostic in branded identity probe: %v", SortedKeys(Keys(checked.Dir, semantic)))
				}
			}
			if HasError(semantic) {
				gaps.Add("identity:"+gapKey, "VIP-40: %q; source and emitted declarations must preserve one unique-symbol identity: %v", inlineModuleArtifactsQuotes[3].text, SortedKeys(Keys(checked.Dir, semantic)))
			} else {
				ExpectPending(t, inlineModuleArtifactsTarget, "identity:"+gapKey)
			}
			result := inlineModuleArtifactRun(t, binary, dir, "source and declaration consumer")
			if result.Status != 0 {
				if result.Status != 1 || !strings.Contains(result.Stdout+result.Stderr, "TS5055") {
					t.Fatalf("unexpected imported-body output failure: status%d\n%s%s", result.Status, result.Stdout, result.Stderr)
				}
				gaps.Add("consumer:"+gapKey, "VIP-40: %q; a source-owned compatibility declaration reached through an import must remain compilable; status%d\n%s%s", inlineModuleArtifactsQuotes[3].text, result.Status, result.Stdout, result.Stderr)
			}
		} else {
			// Include discovery replaces a generated compatibility body.
			// Explicit files retain native overwrite protection.
			moduleSidecarWrite(t, dir, file, strings.ReplaceAll(source, "version = 1", "version = 2"))
			inlineModuleArtifactConfig(t, dir, file, true, false)
			second := inlineModuleArtifactRun(t, binary, dir, "discovered body rebuild")
			after, readErr := os.ReadFile(filepath.Join(dir, bodyDeclaration))
			if second.Status != 0 || readErr != nil || string(after) == string(before) || !strings.Contains(string(after), "version: 2") {
				gaps.Add(gapKey, "VIP-40: %q; discovered compatibility declarations must regenerate; status%d read=%v unchanged=%t\n%s%s\n%s", inlineModuleArtifactsQuotes[1].text, second.Status, readErr, string(after) == string(before), second.Stdout, second.Stderr, after)
			}
			configBytes, err := os.ReadFile(filepath.Join(dir, "tsconfig.json"))
			if err != nil {
				t.Fatal(err)
			}
			var config map[string]any
			if err := json.Unmarshal(configBytes, &config); err != nil {
				t.Fatal(err)
			}
			delete(config, "include")
			config["files"] = []string{file, bodyDeclaration}
			explicit, err := json.Marshal(config)
			if err != nil {
				t.Fatal(err)
			}
			moduleSidecarWrite(t, dir, "tsconfig.json", string(explicit))
			explicitResult := inlineModuleArtifactRun(t, binary, dir, "explicit overwrite control")
			retained, err := os.ReadFile(filepath.Join(dir, bodyDeclaration))
			if explicitResult.Status != 1 || !strings.Contains(explicitResult.Stdout+explicitResult.Stderr, "TS5055") || err != nil || string(retained) != string(after) {
				t.Fatalf("explicit body input must keep TS5055 and unchanged bytes: status%d read=%v\n%s%s", explicitResult.Status, err, explicitResult.Stdout, explicitResult.Stderr)
			}
		}
		if !gaps.Any() {
			if kind == "brand" {
				ExpectPending(t, inlineModuleArtifactsTarget, "consumer:"+gapKey)
			} else {
				ExpectPending(t, inlineModuleArtifactsTarget, gapKey)
			}
		}
		gaps.FinishInput(t, specCorpusKey(t))
	})
}
