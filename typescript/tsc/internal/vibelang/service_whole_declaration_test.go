package vibelang

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func wholeDeclaration(t *testing.T, source string) string {
	t.Helper()
	p, _, _, _ := editorProgram(t, source)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("source: %s\n%s", d.String(), source)
		}
	}
	var text string
	result := p.Emit(t.Context(), compiler.EmitOptions{EmitOnly: compiler.EmitOnlyDts, ForceEmit: true, WriteFile: func(name tspath.RootedFilePath, data string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(name.AsString(), "main.d.ts") {
			text = data
		}
		return nil
	}})
	for _, d := range result.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			t.Fatal(d.String())
		}
	}
	if text == "" {
		t.Fatal("no declaration")
	}
	return text
}
func TestWholeServiceDeclarationIdentity(t *testing.T) {
	for _, shape := range []struct{ name, head, typ, value string }{
		{"interface", "interface Shape { readonly value: number }", "Shape", "{value:7}"},
		{"generic", "type Shape<A> = { readonly value: A }", "Shape<number>", "{value:7}"},
		{"intersection", "type A={readonly value:number};type B={readonly flag:boolean}", "A & B", "{value:7,flag:true}"},
		{"primitive", "", "number", "7"},
		{"callable", "type Shape=()=>number", "Shape", "()=>7"},
		{"unknown", "", "unknown", "undefined"},
		{"empty", "type Shape={}", "Shape", "{}"},
		{"readonly-array", "", "ReadonlyArray<number>", "[1]"},
		{"nested-readonly-array", "", "ReadonlyArray<ReadonlyArray<number>>", "[[1]]"},
		{"array-alias", "type Shape=ReadonlyArray<number>", "Shape", "[1]"},
		{"shadowed-array", "type ReadonlyArray<A>={readonly value:A}", "ReadonlyArray<number>", "{value:7}"},
	} {
		for _, reference := range []bool{false, true} {
			t.Run(shape.name+map[bool]string{false: "/service", true: "/reference"}[reference], func(t *testing.T) {
				prefix := "import { Context } from \"effect\"\n" + shape.head + "\n"
				body := "static readonly key = \"alchemy/Port\""
				native := "export class Port extends Context.Service<Port, " + shape.typ + ">()(\"alchemy/Port\") {}"
				if reference {
					body += "; static readonly defaultValue: () => " + shape.typ + " = () => (" + shape.value + ")"
					native = "export const Port = Context.Reference<" + shape.typ + ">(\"alchemy/Port\", {defaultValue: () => (" + shape.value + ")})"
				}
				source := prefix + "export service Port: " + shape.typ + " { " + body + " }\n"
				got, want := wholeDeclaration(t, source), wholeDeclaration(t, prefix+native)
				if got != want {
					t.Fatalf("whole annotation changed declaration:\ngot:\n%s\nwant:\n%s", got, want)
				}
				if strings.Contains(got, "Port_shape") || strings.Contains(got, "namespace Port") {
					t.Fatalf("whole annotation gained helper or namespace:\n%s", got)
				}
			})
		}
	}
}
func TestWholeServiceShapeScope(t *testing.T) {
	for _, reference := range []bool{false, true} {
		prefix := "import { Context } from \"effect\"\ninterface Shape { readonly value:number }\n"
		body := "static readonly key=\"alchemy/Port\""
		native := "export class Port extends Context.Service<Port,Shape>()(\"alchemy/Port\") {}"
		if reference {
			body += "; static readonly defaultValue:()=>Port.Shape=()=>({value:7})"
			native = "export const Port=Context.Reference<Shape>(\"alchemy/Port\",{defaultValue:()=>({value:7})})"
		}
		source := prefix + "export service Port:Shape { " + body + " }\n"
		wholeDeclaration(t, source)
		codes := func(code string, nativeTS bool) []int32 {
			p, file, _, _ := editorProgram(t, code)
			if nativeTS {
				dir := filepath.Dir(file.FileName().AsString())
				if err := os.Rename(file.FileName().AsString(), filepath.Join(dir, "main.ts")); err != nil {
					t.Fatal(err)
				}
				configText := "{\"compilerOptions\": {\"target\": \"ES2022\", \"module\": \"NodeNext\", \"strict\": true, \"skipLibCheck\": true, \"noEmit\": true}, \"files\": [\"main.ts\"]}"
				if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(configText), 0600); err != nil {
					t.Fatal(err)
				}
				fs := bundled.WrapFS(osvfs.FS())
				config, errs := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
				if len(errs) != 0 {
					t.Fatalf("native config: %v", errs)
				}
				p = compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
			}
			out := []int32{}
			for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
				if d.Category() == diagnostics.CategoryError {
					out = append(out, d.Code())
				}
			}
			slices.Sort(out)
			return slices.Compact(out)
		}
		got, want := codes(source+"export type Bad=Port.Shape\n", false), codes(prefix+native+"\nexport type Bad=Port.Shape\n", true)
		if len(want) == 0 || !slices.Equal(got, want) {
			t.Fatalf("outside Shape scope reference=%v: got%v want%v\n%s", reference, got, want, source)
		}
	}
	// Existing body-only service declarations retain their public namespace.
	dts := wholeDeclaration(t, "import {Context} from \"effect\"\nexport service Body {static readonly key=\"alchemy/Body\";readonly value:number}")
	if !strings.Contains(dts, "namespace Body") {
		t.Fatalf("body-only namespace lost:\n%s", dts)
	}
}
