package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// oversizeSource is a module whose one export's inferred type prints longer
// than the serializer's limit (1,000,000 characters with NoTruncation), as
// t3code's rpc, environmentHttp and environmentHttpAuth modules do.
func oversizeSource(properties int) string {
	// Through a generic call, so declaration emit prints the inferred type,
	// not the initializer's text.
	var b strings.Builder
	b.WriteString("const id = <T,>(x: T): T => x\nexport const value = id({\n")
	for i := range properties {
		fmt.Fprintf(&b, "  property_with_a_rather_long_name_%05d: \"value_with_a_rather_long_text_%05d\",\n", i, i)
	}
	b.WriteString("} as const)\n")
	return b.String()
}

// emitWith returns the declaration emitted for main.<extension> and the emit's
// error codes.
func emitWith(t *testing.T, files map[string]string) (string, []int32) {
	t.Helper()
	p := computedKeyProgram(t, files)
	var dts string
	result := p.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(string(name), "main.d.ts") {
			dts = text
		}
		return nil
	}})
	var codes []int32
	for _, d := range result.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			codes = append(codes, d.Code())
		}
	}
	return dts, codes
}

// oversizeEmit is what one program writes for main.ts or main.vibe.
type oversizeEmit struct {
	declaration string   // main.d.ts, as tsc writes it
	forced      string   // main.d.ts as forced declaration emit writes it despite errors
	sidecar     string   // main.d.vibe.ts
	errors      []string // emit errors, as "TS<code> <line>:<column>" in main
	readers     []string // sidecar errors, as "TS<code> <file>:<line>:<column>"
}

func errorsAt(ds []*ast.Diagnostic, withFile bool) []string {
	var out []string
	for _, d := range ds {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		at := "global"
		if d.File() != nil {
			line, column := scanner.GetECMALineAndByteOffsetOfPosition(d.File(), d.Pos())
			at = fmt.Sprintf("%d:%d", line+1, column+1)
			if withFile {
				at = tspath.GetBaseFileName(string(d.File().FileName())) + ":" + at
			}
		}
		out = append(out, fmt.Sprintf("TS%d %s", d.Code(), at))
	}
	return out
}

func emitOversize(t *testing.T, files map[string]string) oversizeEmit {
	t.Helper()
	p := computedKeyProgram(t, files)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("source: %s", d.String())
		}
	}
	var out oversizeEmit
	capture := func(into *string) compiler.WriteFile {
		return func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
			if strings.HasSuffix(string(name), "/main.d.ts") {
				*into = text
			}
			return nil
		}
	}
	result := p.Emit(t.Context(), compiler.EmitOptions{WriteFile: capture(&out.declaration)})
	if p.Options().GetEmitDeclarations() {
		out.errors = errorsAt(result.Diagnostics, false)
	}
	p.Emit(t.Context(), compiler.EmitOptions{EmitOnly: compiler.EmitOnlyDts, ForceEmit: true, WriteFile: capture(&out.forced)})
	if sidecars := p.EmitDeclarationSidecars(t.Context(), func(name, text string) error {
		if strings.HasSuffix(name, "/main.d.vibe.ts") {
			out.sidecar = text
		}
		return nil
	}); sidecars != nil {
		out.readers = errorsAt(sidecars.Diagnostics, true)
	}
	return out
}

// TypeScript refuses to serialize an inferred type past its limit: tsc reports
// TS7056 at the export and writes no declaration. A .vibe module's declaration
// output is what tsc writes for its TypeScript twin (chapter 1, "API
// identity"), so the .vibe module reports the same TS7056 at the same place
// and writes no main.d.ts, and its sidecar holds what TypeScript serializes
// for the twin when forced, cut off at the limit: about a megabyte, not the
// full type, which for t3code's environmentHttpAuth was 52 MB.
func TestOversizeTypeDeclaresAsTypeScript(t *testing.T) {
	t.Parallel()
	source := oversizeSource(30000)
	// Past the limit, about 12,500 properties in: the cut type leaves it out.
	middle := `property_with_a_rather_long_name_20000`
	for _, config := range []struct{ name, options string }{
		{"declaration", `"declaration":true`},
		// t3code's packages: no declaration output, so tsc never serializes the
		// twin's types and reports nothing. Only a .ts file that reads the
		// sidecar sees the cut, and the error is reported where it imports the
		// module.
		{"noEmit", `"noEmit":true`},
	} {
		t.Run(config.name, func(t *testing.T) {
			t.Parallel()
			files := computedKeyFiles(false)
			dir := projectDir(files)
			files[dir+"tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext",` + config.options + `},"files":["main.ts"]}`
			files[dir+"main.ts"] = source
			twin := emitOversize(t, files)
			if strings.Contains(twin.forced, middle) {
				t.Fatalf("control: TypeScript's forced declaration of the .ts twin is not cut at the limit (%d bytes)", len(twin.forced))
			}
			if config.name == "declaration" && (len(twin.errors) != 1 || !strings.HasPrefix(twin.errors[0], "TS7056 ")) {
				t.Fatalf("control: the .ts twin's declaration emit reports %v, not one TS7056", twin.errors)
			}

			files = computedKeyFiles(false)
			files[dir+"tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext",` + config.options + `},"files":["main.vibe"]}`
			files[dir+"main.vibe"] = source
			vibe := emitOversize(t, files)
			if fmt.Sprint(vibe.errors) != fmt.Sprint(twin.errors) {
				t.Errorf("the .vibe module's declaration emit reports %v; tsc reports %v for the twin", vibe.errors, twin.errors)
			}
			if vibe.declaration != twin.declaration {
				t.Errorf("the .vibe module writes a %d-byte main.d.ts; tsc writes %d bytes for the twin", len(vibe.declaration), len(twin.declaration))
			}
			if vibe.sidecar != twin.forced {
				t.Errorf("the sidecar has %d bytes (full type: %t); TypeScript's forced declaration of the twin has %d",
					len(vibe.sidecar), strings.Contains(vibe.sidecar, middle), len(twin.forced))
			}
			// Sidecar emit reports the module's own TS7056 where the project emits
			// declarations, and nothing where it does not and no .ts file reads
			// the sidecar.
			var own []string
			for _, e := range twin.errors {
				code, at, _ := strings.Cut(e, " ")
				own = append(own, code+" main.vibe:"+at)
			}
			if fmt.Sprint(vibe.readers) != fmt.Sprint(own) {
				t.Errorf("sidecar emit reports %v, not %v", vibe.readers, own)
			}

			if config.name != "noEmit" {
				return
			}
			// A .ts reader of the module reads the cut sidecar in place of the
			// source, so the error is reported at its import.
			files[dir+"reader.ts"] = "import { value } from \"./main.vibe\"\nexport const first = value.property_with_a_rather_long_name_00000\n"
			files[dir+"tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","allowImportingTsExtensions":true,` + config.options + `},"files":["main.vibe","reader.ts"]}`
			read := emitOversize(t, files)
			if len(read.readers) != 1 || !strings.HasPrefix(read.readers[0], "TS7056 reader.ts:1:") {
				t.Errorf("a .ts reader of the sidecar gets %v, not TS7056 at its import", read.readers)
			}
		})
	}
}

// projectDir is the directory of computedKeyFiles' tsconfig.json.
func projectDir(files map[string]string) string {
	for name := range files {
		if strings.HasSuffix(name, "/src/tsconfig.json") {
			return strings.TrimSuffix(name, "tsconfig.json")
		}
	}
	panic("computedKeyFiles has no src/tsconfig.json")
}
