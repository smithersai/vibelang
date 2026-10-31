package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// oversizeSource is a module whose one export's inferred type prints longer
// than the serializer's limit (1,000,000 characters with NoTruncation), as
// t3code's rpc, environmentHttp and guestStream schemas do.
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

// A .vibe module's declarations are its sidecar, which stock checkers read in
// place of the source, so an inferred type prints in full, however long, as
// the source gives it to a checker that reads it (t3code agent, 2026-10-31).
// The same module as .ts still draws TS7056, stock TypeScript's limit.
func TestSidecarPrintsOversizeTypeInFull(t *testing.T) {
	t.Parallel()
	source := oversizeSource(30000)
	files := computedKeyFiles(false)
	dir := projectDir(files)
	files[dir+"main.ts"] = source
	files[dir+"tsconfig.json"] = strings.Replace(files[dir+"tsconfig.json"], `"main.vibe"`, `"main.ts"`, 1)
	if _, codes := emitWith(t, files); !containsCode(codes, 7056) {
		t.Fatalf("control: the .ts module emits %v, not TS7056; the type is not over the limit", codes)
	}
	files = computedKeyFiles(false)
	files[dir+"main.vibe"] = source
	dts, codes := emitWith(t, files)
	if len(codes) != 0 {
		t.Fatalf("the .vibe module's declaration emit reports %v", codes)
	}
	if !strings.Contains(dts, `readonly property_with_a_rather_long_name_29999: "value_with_a_rather_long_text_29999";`) {
		t.Fatalf("the declaration does not print the type in full:\n%.300s", dts)
	}
	// A stock TypeScript consumer of the declaration reads the precise type, not any.
	files[dir+"main.d.ts"] = dts
	delete(files, dir+"main.vibe")
	files[dir+"consumer.ts"] = `import { value } from "./main.js"; export const last: "value_with_a_rather_long_text_29999" = value.property_with_a_rather_long_name_29999;
// @ts-expect-error a missing key is an error, not any
export const missing = value.property_with_a_rather_long_name_30000`
	files[dir+"tsconfig.json"] = `{"compilerOptions":{"strict":true,"skipLibCheck":false,"module":"NodeNext","noEmit":true},"files":["consumer.ts"]}`
	p := computedKeyProgram(t, files)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("declaration consumer: %s", d.String())
		}
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

func containsCode(codes []int32, code int32) bool {
	for _, c := range codes {
		if c == code {
			return true
		}
	}
	return false
}
