package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"testing"
)

func TestUnresolvedPlatformGlobalsKeepTypeScriptDiagnostics(t *testing.T) {
	files := computedKeyFiles(false)
	source := "export const fetchValue = fetch\nexport const processValue = process\nexport const bufferValue = Buffer\nexport const qualified = globalThis.fetch\nexport const indexed = globalThis[\"fetch\"]\nexport const array = Array\n"
	files["/workspace/x/src/main.vibe"] = source
	files["/workspace/x/src/control.ts"] = source
	files["/workspace/x/src/tsconfig.json"] = "{\"compilerOptions\": {\"strict\": true, \"target\": \"ESNext\", \"module\": \"NodeNext\", \"lib\": [\"esnext\"], \"types\": [], \"noEmit\": true, \"skipLibCheck\": true}, \"files\": [\"main.vibe\", \"control.ts\"]}"
	p := computedKeyProgram(t, files)
	vibe := p.GetSemanticDiagnostics(t.Context(), p.GetSourceFile(tspath.RootedFilePath("/workspace/x/src/main.vibe")))
	control := p.GetSemanticDiagnostics(t.Context(), p.GetSourceFile(tspath.RootedFilePath("/workspace/x/src/control.ts")))
	want := []int32{2304, 2591, 2591, 7017, 7053}
	if len(vibe) != len(want) || len(control) != len(want) {
		t.Fatalf("want five diagnostics per source; VibeLang=%v TypeScript=%v", vibe, control)
	}
	for i, code := range want {
		if control[i].Code() != code || control[i].Source() != "" {
			t.Fatalf("TypeScript control diagnostic %d: %v", i, control[i])
		}
		if vibe[i].Code() != code || vibe[i].Source() != "" {
			t.Errorf("VibeLang must keep TypeScript diagnostic %d, got %v", code, vibe[i])
		}
	}
}
