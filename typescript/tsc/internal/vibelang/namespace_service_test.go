package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestNamespaceServiceRuntimeTypes(t *testing.T) {
	for _, scope := range []struct{ name, wrap, ref string }{
		{"top", "%s", "S"},
		{"namespace", "export namespace N { %s }", "N.S"},
		{"nested", "export namespace N { export namespace M { %s } }", "N.M.S"},
		{"dotted", "export namespace N.M { %s }", "N.M.S"},
	} {
		for _, whole := range []bool{false, true} {
			for _, explicit := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/whole=%t/explicit=%t", scope.name, whole, explicit), func(t *testing.T) {
					declaration := "export service S {static readonly key=\"namespace/S\";value:number}"
					if whole {
						declaration = "export service S: {value:number} {static readonly key=\"namespace/S\"}"
					}
					source := fmt.Sprintf(scope.wrap, declaration)
					if explicit {
						source = "import * as Context from \"effect/Context\";" + source
					} else {
						source += ";export const implementation:{value:number}=" + scope.ref + ".of({value:1})"
					}
					p, file, _, _ := editorProgram(t, source)
					p.Options().NoUnusedLocals = core.TSTrue
					for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() == diagnostics.CategoryError {
							t.Errorf("%s\n%s", d.String(), source)
						}
					}
				})
			}
		}
	}
}

func TestNamespaceServiceImportControls(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		unused       int
	}{
		{"native", "import * as Context from \"effect/Context\";export namespace N {export class S extends Context.Service<S,{value:number}>()(\"namespace/Native\") {}}", 0},
		{"unused", "import * as Context from \"effect/Context\";export namespace N {export const value=1}", 1},
		{"type-only-native", "import * as Context from \"effect/Context\";export type Native=Context.ServiceClass<never,\"namespace/Type\",{value:number}>", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, tc.source)
			p.Options().NoUnusedLocals = core.TSTrue
			unused := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Code() == 6133 && strings.Contains(d.String(), "Context") {
					unused++
				} else {
					t.Errorf("unexpected: %s", d.String())
				}
			}
			if unused != tc.unused {
				t.Errorf("unused Context diagnostics=%d, want %d", unused, tc.unused)
			}
		})
	}
}

func TestNamespaceServiceDetectionBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		want         bool
	}{
		{"ordinary", "export namespace N {export const value=1}", false},
		{"ambient-namespace", "declare namespace N {service S {static readonly key=\"namespace/Ambient\";value:number}}", false},
		{"ambient-module", "declare module \"foreign\" {service S {static readonly key=\"namespace/Foreign\";value:number}}", false},
		{"global-augmentation", "export {};declare global {service S {static readonly key=\"namespace/Global\";value:number}}", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, tc.source)
			if got := declaresService(file); got != tc.want {
				t.Fatalf("declaresService=%t, want %t", got, tc.want)
			}
		})
	}
}
