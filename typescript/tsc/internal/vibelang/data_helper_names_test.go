package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func genericDataHelperDeclarations(t *testing.T, source string) string {
	t.Helper()
	_, file, _, _ := editorProgram(t, source)
	configName := filepath.Join(filepath.Dir(file.FileName().AsString()), "tsconfig.json")
	configText := `{"compilerOptions":{"target":"ESNext","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":["main.vibe"]}`
	if err := os.WriteFile(configName, []byte(configText), 0600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(configName)), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config %v", errors)
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("source: %s", d.String())
		}
	}
	var out string
	result := program.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(name.AsString(), "main.d.ts") {
			out = text
		}
		return nil
	}})
	for _, d := range result.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("emit: %s", d.String())
		}
	}
	if out == "" {
		t.Fatal("no declaration")
	}
	return out
}

func TestGenericDataHelperCanonicalNames(t *testing.T) {
	for n := 1; n <= 4; n++ {
		var params, fields []string
		for i := 0; i < n; i++ {
			name := "T" + strconv.Itoa(i)
			params = append(params, name)
			fields = append(fields, "f"+strconv.Itoa(i)+":"+name)
		}
		source := "export data G<" + strings.Join(params, ",") + "> { V {" + strings.Join(fields, ";") + "} }"
		got := genericDataHelperDeclarations(t, source)
		if !strings.Contains(got, "interface $G$Definition extends") {
			t.Errorf("arity%d wrong helper:\n%s", n, got)
		}
	}
}

func TestGenericDataHelperFreshNames(t *testing.T) {
	for _, tc := range []struct{ before, after, want string }{
		{"", "", "$G$Definition"},
		{"type $G$Definition = string\n", "", "$G$Definition$2"},
		{"", "\ntype $G$Definition = string", "$G$Definition$2"},
		{"type $G$Definition = string\n", "\ntype $G$Definition$2 = number", "$G$Definition$3"},
		{"type $G\\u0024Definition = string\n", "", "$G$Definition$2"},
		{"type GDefinition = string\n", "", "$G$Definition"},
		{"// $G$Definition\nconst text = \"$G$Definition\";\n", "", "$G$Definition"},
	} {
		source := tc.before + "\nexport data G<T> { V {value:T} }\n" + tc.after
		got := genericDataHelperDeclarations(t, source)
		if !strings.Contains(got, "interface "+tc.want+" extends") {
			t.Errorf("want%s:\n%s", tc.want, got)
		}
	}
}
