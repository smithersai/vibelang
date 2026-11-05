package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const namespaceServiceBodyQuote = "class Users extends Context.Service<Users, $Users$Shape>()"
const namespaceServiceWholeQuote = "The example's declaration output is byte-identical to its Effect TypeScript twin:"
const namespaceServiceScopeQuote = "TypeScript allows a \x60namespace\x60 only at the top level of a module or namespace (TS1235)."

func namespaceServiceChapter(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{namespaceServiceBodyQuote, namespaceServiceWholeQuote, namespaceServiceScopeQuote} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("chapter 5 no longer says %q", quote)
		}
	}
}

func TestNamespaceServiceRuntimeTypesQuoted(t *testing.T) { namespaceServiceChapter(t) }

// Compile the native TypeScript counterpart and the custom service independently.
// Both must retain the native key's members in every runtime namespace.
func FuzzNamespaceServiceRuntimeTypes(f *testing.F) {
	startShortBudget(f)
	namespaceServiceChapter(f)
	type probe struct{ key, native, custom string }
	var probes []probe
	for _, scope := range []struct{ key, wrap, ref string }{
		{"top", "%s", "S"},
		{"namespace", "export namespace N {%s}", "N.S"},
		{"nested", "export namespace N {export namespace M {%s}}", "N.M.S"},
		{"dotted", "export namespace N.M {%s}", "N.M.S"},
	} {
		for _, whole := range []bool{false, true} {
			for _, explicit := range []bool{false, true} {
				shape, nativeShape, form := "", "{value:number}", "body"
				custom := "export service S {static readonly key=\"namespace/S\";value:number}"
				if whole {
					form = "whole"
					shape = "export interface Shape {value:number};"
					nativeShape = "Shape"
					custom = "export service S: Shape {static readonly key=\"namespace/S\"}"
				}
				native := shape + "export class S extends Context.Service<S," + nativeShape + ">()(\"namespace/S\") {}"
				native = "import * as Context from \"effect/Context\";" + fmt.Sprintf(scope.wrap, native)
				custom = fmt.Sprintf(scope.wrap, shape+custom)
				mode := "implicit"
				if explicit {
					mode = "import"
					custom = "import * as Context from \"effect/Context\";" + custom
				} else {
					custom += ";export const implementation:{value:number}=" + scope.ref + ".of({value:1})"
				}
				native += ";export const implementation:{value:number}=" + scope.ref + ".of({value:1})"
				key := scope.key + "/" + form + "/" + mode
				probes = append(probes, probe{key, native, custom})
				f.Add([]byte(key + "\x00\x00"))
				f.Add([]byte(key + "\x00\x03"))
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		selected := 0
		if len(data) > 0 {
			selected = int(data[0]) % len(probes)
		}
		parts := strings.SplitN(string(data), "\x00", 2)
		for i, p := range probes {
			if parts[0] == p.key {
				selected = i
				break
			}
		}
		p := probes[selected]
		var variant byte
		if len(parts) == 2 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		compile := func(source, file string) []string {
			if variant&1 != 0 {
				source = "// retained trivia\r\n" + strings.ReplaceAll(source, ";", ";\r\n")
			}
			if variant&2 != 0 {
				source = strings.ReplaceAll(source, "\"", "'")
			}
			config := "{\"compilerOptions\":{\"target\":\"ES2022\",\"lib\":[\"ES2022\"],\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"noUnusedLocals\":true,\"types\":[]},\"files\":[\"" + file + "\"]}"
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{file: source, "package.json": servicesPackage}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var errors []string
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					errors = append(errors, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
				}
			}
			return errors
		}
		if errors := compile(p.native, "main.ts"); len(errors) != 0 {
			Gap(t, "FuzzNamespaceServiceRuntimeTypes", "native:"+p.key, "chapter 5: %s; native counterpart fails: %v", namespaceServiceWholeQuote, errors)
			return
		}
		if errors := compile(p.custom, "main.vibe"); len(errors) != 0 {
			Gap(t, "FuzzNamespaceServiceRuntimeTypes", "custom:"+p.key, "chapter 5: %s; equivalent service fails: %v\n%s", namespaceServiceBodyQuote, errors, p.custom)
			return
		}
		ExpectPending(t, "FuzzNamespaceServiceRuntimeTypes", "native:"+p.key)
		ExpectPending(t, "FuzzNamespaceServiceRuntimeTypes", "custom:"+p.key)
		ExpectPending(t, "FuzzNamespaceServiceRuntimeTypes", specCorpusKey(t))
	})
}
