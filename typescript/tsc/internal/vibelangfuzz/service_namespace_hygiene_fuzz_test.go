package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const serviceDeclarationHygieneQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

func serviceDeclarationHygieneChapter(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("001-functions.md"), serviceDeclarationHygieneQuote) {
		t.Fatal(serviceDeclarationHygieneQuote)
	}
	namespaceServiceChapter(t)
}
func TestServiceNamespaceDeclarationHygieneQuoted(t *testing.T) { serviceDeclarationHygieneChapter(t) }

func FuzzServiceNamespaceDeclarationHygiene(f *testing.F) {
	startShortBudget(f)
	serviceDeclarationHygieneChapter(f)
	type probe struct{ key, source string }
	var probes []probe
	for _, scope := range []struct{ key, wrap, ref string }{
		{"namespace", "export namespace N {%s}", "N"},
		{"nested", "export namespace N {export namespace M {%s}}", "N.M"},
		{"dotted", "export namespace N.M {%s}", "N.M"},
	} {
		for _, prefix := range []struct{ key, text string }{
			{"implicit", ""},
			{"namespace-import", "import * as Context from \"effect/Context\";"},
			{"named-import", "import {Context} from \"effect\";"},
		} {
			for _, form := range []struct{ key, text string }{
				{"body", "export service E {static readonly key=\"hygiene/E\";value:number}"},
				{"whole", "export service E:{value:number} {static readonly key=\"hygiene/E\"}"},
				{"reference", "export service E {static readonly key=\"hygiene/E\";static readonly defaultValue=()=>({value:1});value:number}"},
			} {
				key := scope.key + "/" + prefix.key + "/" + form.key
				source := prefix.text + fmt.Sprintf(scope.wrap, "SHADOW;"+form.text) + ";export const value:{value:number}=" + scope.ref + ".E.of({value:1});"
				probes = append(probes, probe{key, source})
				for _, variant := range []byte{0, 1, 2} {
					f.Add([]byte(key + "\x00" + string([]byte{variant})))
				}
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		selected := 0
		if len(data) > 0 {
			selected = int(data[0]) % len(probes)
		}
		for i, p := range probes {
			if p.key == parts[0] {
				selected = i
				break
			}
		}
		p := probes[selected]
		var variant byte
		if len(parts) > 1 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		shadows := []string{
			"export namespace Context {export const marker=1}",
			"export type Context={marker:number}",
			"export namespace Context {export const marker=1};export namespace Context_1 {export const marker=2};export namespace Context_2 {export const marker=3}",
		}
		shadow := int(variant) % len(shadows)
		source := strings.ReplaceAll(p.source, "SHADOW", shadows[shadow])
		if variant&4 != 0 {
			source = "// retained trivia\r\n" + strings.ReplaceAll(source, ";", ";\r\n")
		}
		if variant&8 != 0 {
			source = strings.ReplaceAll(source, "\"", "'")
		}
		key := fmt.Sprintf("%s/shadow-%d", p.key, shadow)
		config := func(file string) string {
			return fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","lib":["ES2022"],"module":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":[%q]}`, file)
		}
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "package.json": servicesPackage}, Config: config("main.vibe")})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		text, ok := result.Outputs["out/main.d.ts"]
		if HasError(result.Diagnostics) || !ok {
			Gap(t, "FuzzServiceNamespaceDeclarationHygiene", "source:"+key, "%s; source diagnostics=%v; declaration=%q", namespaceServiceWholeQuote, SortedKeys(Keys(result.Dir, result.Diagnostics)), text)
			return
		}
		// Use .ts, not .d.ts: skipLibCheck must not mask invalid emitted names.
		consumer, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.ts": text, "package.json": servicesPackage}, Config: config("main.ts")})
		if err != nil {
			t.Fatal(err)
		}
		defer consumer.Remove()
		if HasError(consumer.Diagnostics) {
			Gap(t, "FuzzServiceNamespaceDeclarationHygiene", "emitted:"+key, "%s; generated qualifier is shadowed: %v\n%s", serviceDeclarationHygieneQuote, SortedKeys(Keys(consumer.Dir, consumer.Diagnostics)), text)
			return
		}
		ExpectPending(t, "FuzzServiceNamespaceDeclarationHygiene", "source:"+key)
		ExpectPending(t, "FuzzServiceNamespaceDeclarationHygiene", "emitted:"+key)
		ExpectPending(t, "FuzzServiceNamespaceDeclarationHygiene", specCorpusKey(t))
	})
}
