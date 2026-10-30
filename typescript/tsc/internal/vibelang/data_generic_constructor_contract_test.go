package vibelang

import (
	"os"
	"path/filepath"
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

func genericConstructorProgram(t *testing.T, dir string) *compiler.Program {
	t.Helper()
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 || len(config.Errors) != 0 {
		t.Fatalf("config: %v %v", errors, config.Errors)
	}
	return compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
}

func genericConstructorDeclarations(t *testing.T) string {
	t.Helper()
	source := ""
	for n := 1; n <= 4; n++ {
		var params, fields []string
		for i := 0; i < n; i++ {
			name := string(rune('A' + i))
			params = append(params, name)
			fields = append(fields, "p"+string(rune('0'+i))+":"+name)
		}
		source += "export data G" + string(rune('0'+n)) + "<" + strings.Join(params, ",") + "> { Empty; Value {" + strings.Join(fields, ";") + "} }\n"
	}
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	config := `{"compilerOptions":{"target":"ESNext","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":["main.vibe"]}`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	program := genericConstructorProgram(t, dir)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("producer: %s", d.String())
		}
	}
	var declaration string
	result := program.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(name.AsString(), "main.d.ts") {
			declaration = text
		}
		return nil
	}})
	for _, d := range result.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("emit: %s", d.String())
		}
	}
	if declaration == "" {
		t.Fatal("no emitted declaration")
	}
	return declaration
}

// A declaration is a public constructor contract in its own right (detail42).
// The package manifest must not hide a generic constructor's lost signature.
func TestGenericDataConstructorDeclarationContract(t *testing.T) {
	model := genericConstructorDeclarations(t)
	const source = `import {G1,G2,G3,G4} from "./model.js"
const Alias=G1.Value
const {Value:Destructured}=G2
export effect function direct():G1<number>!never { return G1.Value({p0:1}) }
export effect function alias():G1<number>!never { return Alias({p0:1}) }
export effect function destructured():G2<number,string>!never { return Destructured({p0:1,p1:"x"}) }
export effect function indexed():G3<number,string,boolean>!never { return G3["Value"]({p0:1,p1:"x",p2:true}) }
export effect function four():G4<number,string,boolean,bigint>!never { return G4.Value({p0:1,p1:"x",p2:true,p3:1n}) }
export effect function empty():G1<number>!never { return G1.Empty<number>() }
`
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "model.d.ts"), []byte(model), 0600); err != nil {
		t.Fatal(err)
	}
	program := genericConstructorProgram(t, dir)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("consumer: %s", d.String())
		}
	}
}

func TestGenericDataConstructorDoesNotTrustForeignLookalike(t *testing.T) {
	const source = `import {fake} from "./foreign.js"
export effect function call():{readonly _tag:"Value";readonly p0:number}!never {return fake()}
`
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "foreign.d.ts"), []byte(`export declare function fake():{readonly _tag:"Value";readonly p0:number}`), 0600); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, d := range genericConstructorProgram(t, dir).GetSemanticDiagnostics(t.Context(), nil) {
		if d.Code() == EK4401.Code {
			found = true
		}
	}
	if !found {
		t.Fatal("unannotated foreign callable became trusted")
	}
}
