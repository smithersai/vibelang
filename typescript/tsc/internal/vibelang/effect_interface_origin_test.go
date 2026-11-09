package vibelang

import (
	"fmt"
	"strings"
	"testing"
)

func TestEffectInterfaceRootArity(t *testing.T) {
	for _, arity := range []int{0, 1, 2, 3, 4} {
		t.Run(fmt.Sprint(arity), func(t *testing.T) {
			files := computedKeyFiles(false)
			base := "/workspace/x/src/"
			if arity != 3 {
				parameters := ""
				if arity > 0 {
					parameters = "<" + strings.Join([]string{"A", "E", "R", "S"}[:arity], ",") + ">"
				}
				files[base+"node_modules/effect/Effect.d.ts"] = "export interface Effect" + parameters + "{readonly \"~effect/Effect\":unknown}"
			}
			files[base+"main.vibe"] = "export effect function main(){return 1}"
			program := computedKeyProgram(t, files)
			source := program.GetSourceFile("/workspace/x/src/main.vibe")
			if source == nil {
				t.Fatal("missing source")
			}
			diagnostics := program.GetSemanticDiagnostics(t.Context(), source)
			if arity == 3 && len(diagnostics) != 0 {
				t.Fatalf("genuine root module rejected: %v", diagnostics)
			}
			if arity != 3 && len(diagnostics) == 0 {
				t.Fatal("incompatible Effect arity must produce a diagnostic")
			}
		})
	}
}

func TestEffectInterfaceModernPriority(t *testing.T) {
	files := computedKeyFiles(false)
	base := "/workspace/x/src/"
	current := base + "node_modules/effect/"
	legacy := base + "node_modules/aaa-sdk/"
	definition := files[current+"Effect.d.ts"]
	delete(files, current+"Effect.d.ts")
	files[current+"dist/Effect.d.ts"] = strings.TrimSuffix(definition, "}") + ";readonly modern:true}"
	files[current+"index.d.ts"] = "export * as Effect from './dist/Effect.js';export * as Inspectable from './Inspectable.js'"
	files[current+"package.json"] = "{\"name\":\"effect\",\"type\":\"module\",\"exports\":{\".\":{\"types\":\"./index.d.ts\"},\"./Effect\":{\"types\":\"./dist/Effect.d.ts\"},\"./Inspectable\":{\"types\":\"./Inspectable.d.ts\"}}}"
	files[legacy+"Effect.d.ts"] = definition
	files[legacy+"package.json"] = "{\"name\":\"effect\",\"type\":\"module\",\"exports\":{\"./Effect\":{\"types\":\"./Effect.d.ts\"}}}"
	files[base+"tsconfig.json"] = "{\"compilerOptions\":{\"strict\":true,\"target\":\"ESNext\",\"module\":\"NodeNext\",\"declaration\":true},\"files\":[\"node_modules/aaa-sdk/Effect.d.ts\",\"main.vibe\"]}"
	files[base+"main.vibe"] = "import type {Effect as Legacy} from 'aaa-sdk/Effect';export effect function main(){return try ({} as Legacy<number>)}"
	program := computedKeyProgram(t, files)
	source := program.GetSourceFile("/workspace/x/src/main.vibe")
	diagnostics := program.GetSemanticDiagnostics(t.Context(), source)
	if len(diagnostics) != 1 || diagnostics[0].Code() != 502 {
		t.Fatalf("root copy must not replace the current operand target: %v", diagnostics)
	}
}
