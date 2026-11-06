package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const inlineModuleSelfBrandTarget = "FuzzInlineModuleSelfBrand"

func FuzzInlineModuleSelfBrand(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"throwing", "platform"} {
		for _, variant := range []uint8{0, 1} {
			f.Add(key, variant)
		}
	}
	binary, stock := cliBuild(f, f.TempDir()), StockTypeScript(f)
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestInlineModuleArtifactsQuoted(t)
		if !slices.Contains([]string{"throwing", "platform"}, key) {
			if key == "" {
				return
			}
			key = []string{"throwing", "platform"}[int(key[0])%2]
		}
		suffix := "vibe"
		if variant&1 != 0 {
			suffix = "vibex"
		}
		file := "main." + suffix
		body := fmt.Sprintf("export * as LayerNode from './%s';\n", file) +
			"const ReplacementTypeId = Symbol('LayerNode.Replacement');\n" +
			"class ReplacementValue { declare private readonly checked: void; readonly [ReplacementTypeId]: true = true; }\n" +
			"export type Replacement = ReplacementValue;\n" +
			"export function make(): Replacement { return new ReplacementValue(); }\n"
		outer := "export {LayerNode, make} from " + key + "\nexport type {Replacement} from " + key + "\n"
		source := "module " + key + " {\n" + body + "}\n" + outer
		if key == "throwing" && variant == 0 {
			corpus, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "opencode-inline-self-namespace-brand.vibe"))
			if err != nil {
				t.Fatal(err)
			}
			if string(corpus) != source {
				t.Fatal("self-namespace corpus no longer matches its generator")
			}
			source = string(corpus)
		}
		if variant&2 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		dir := t.TempDir()
		moduleSidecarWrite(t, dir, "package.json", "{\"type\":\"module\"}")
		moduleSidecarWrite(t, dir, file, source)
		inlineModuleArtifactConfig(t, dir, file, true, true)
		first := inlineModuleArtifactRun(t, binary, dir, "self-namespace initial emit")
		if first.Status != 0 {
			t.Fatalf("initial source rejected: status%d\n%s%s", first.Status, first.Stdout, first.Stderr)
		}
		bodyDeclaration := file + "." + key + ".d.ts"
		sidecar := "main.d." + suffix + ".ts"
		files := map[string]string{file: source, "package.json": "{\"type\":\"module\"}"}
		for _, name := range []string{bodyDeclaration, sidecar} {
			text, err := os.ReadFile(filepath.Join(dir, name))
			if err != nil {
				t.Fatal(err)
			}
			files[name] = string(text)
		}
		consumer := fmt.Sprintf("import {LayerNode, make} from './%s';\nconst value: LayerNode.Replacement = make();\n// @ts-expect-error a plain object must not forge the private and symbol brands\nconst forged: LayerNode.Replacement = {};\n", file)
		files["consumer.ts"] = consumer
		moduleSidecarWrite(t, dir, "consumer.ts", consumer)
		inlineModuleArtifactConfig(t, dir, file, false, false)

		control := t.TempDir()
		moduleSidecarWrite(t, control, "package.json", "{\"type\":\"module\"}")
		moduleSidecarWrite(t, control, "body.ts", strings.ReplaceAll(body, "./"+file, "./main.js"))
		moduleSidecarWrite(t, control, "main.ts", "export {LayerNode, make} from './body.js'\nexport type {Replacement} from './body.js'\n")
		moduleSidecarWrite(t, control, "consumer.ts", strings.ReplaceAll(consumer, "./"+file, "./main.js"))
		inlineModuleArtifactConfig(t, control, "main.ts", false, false)
		stockResult := inlineModuleArtifactRun(t, stock, control, "stock self-namespace control")
		if stockResult.Status != 0 {
			t.Fatalf("stock self-namespace control: status%d\n%s%s", stockResult.Status, stockResult.Stdout, stockResult.Stderr)
		}
		configText, err := os.ReadFile(filepath.Join(dir, "tsconfig.json"))
		if err != nil {
			t.Fatal(err)
		}
		checked, err := w.Compile(t.Context(), Project{Files: files, Config: string(configText)})
		if err != nil || checked.Program == nil {
			t.Fatalf("self-namespace checker: %v", err)
		}
		defer checked.Remove()
		gapKey := key + "/" + suffix
		gaps := &Gaps{Target: inlineModuleSelfBrandTarget, Input: fmt.Sprintf("%s/%d", key, variant)}
		semantic := checked.Program.GetSemanticDiagnostics(t.Context(), nil)
		for _, diagnostic := range semantic {
			if diagnostic.Code() != 2741 && diagnostic.Code() != 2322 && diagnostic.Code() != 2719 {
				t.Fatalf("unexpected self-namespace diagnostic: %v", SortedKeys(Keys(checked.Dir, semantic)))
			}
		}
		if HasError(semantic) {
			gaps.Add("identity:"+gapKey, "VIP-40: %q; a self namespace must expose the same private and unique-symbol class identity: %v", inlineModuleArtifactsQuotes[3].text, SortedKeys(Keys(checked.Dir, semantic)))
		} else {
			ExpectPending(t, inlineModuleSelfBrandTarget, "identity:"+gapKey)
		}
		result := inlineModuleArtifactRun(t, binary, dir, "self-namespace rebuild")
		if result.Status != 0 {
			gaps.Add("consumer:"+gapKey, "VIP-40: %q; self-namespace rebuild must accept the same typed consumer as the extracted TypeScript twin; status%d\n%s%s", inlineModuleArtifactsQuotes[3].text, result.Status, result.Stdout, result.Stderr)
		} else {
			ExpectPending(t, inlineModuleSelfBrandTarget, "consumer:"+gapKey)
		}
		gaps.FinishInput(t, specCorpusKey(t))
	})
}
