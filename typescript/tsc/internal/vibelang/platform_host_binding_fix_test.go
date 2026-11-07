package vibelang

import (
	"encoding/json"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

func TestPlatformHostBindingRepair(t *testing.T) {
	data, err := os.ReadFile("../vibelangfuzz/testdata/platform-host-binding-fixes.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct{ Key, Source string }
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, test := range cases {
		t.Run(test.Key, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, test.Source)
			result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{})
			fixed := result.Files[file.FileName()]
			if result.Err != nil || len(result.Refused) != 0 || len(result.Files) != 1 || fixed == nil {
				t.Fatalf("expected a preserving single-source repair: %+v", result)
			}
			if !strings.Contains(fixed.Text, "module $platformBindings") || !strings.Contains(fixed.Text, "import $platformBindings") {
				t.Fatalf("missing eager native boundary:\n%s", fixed.Text)
			}
			checked, next, _, _ := editorProgram(t, fixed.Text)
			if ds := checked.GetSemanticDiagnostics(t.Context(), next); len(ds) != 0 {
				t.Fatalf("fixed source: %v", ds)
			}
			again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), checked.CommandLine(), FixOptions{})
			if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("not a fixed point: %+v", again)
			}
		})
	}
}

func TestPlatformHostBindingRepairRefusals(t *testing.T) {
	for _, source := range []string{
		"export const { timeout: { name: value } } = AbortSignal\n",
		"let { timeout: { name: value } } = AbortSignal\nexport { value }\n",
		"const { timeout: { name: value } }: typeof AbortSignal = AbortSignal\nexport { value }\n",
		"const { timeout: { name: value } } = (AbortSignal as typeof AbortSignal)\nexport { value }\n",
		"const { ['time'+'out']: { name: value } } = AbortSignal\nexport { value }\n",
		"const { timeout: { name: value = '' } } = AbortSignal\nexport { value }\n",
		"/** Public documentation. */\nconst { timeout: { name: value } } = AbortSignal\nexport { value }\n",
		"// @ts-ignore\nconst { timeout: { name: value } } = AbortSignal\nexport { value }\n",
		"\"use client\";\nconst { timeout: { name: value } } = AbortSignal\nexport { value }\n",
		"const before = 1\nconst { timeout: { name: value } } = AbortSignal\nexport { before, value }\n",
		"function probe() { const { timeout: { name: value } } = AbortSignal; return value }\nexport { probe }\n",
		"const { timeout: { name: value } } = AbortSignal\nimport { Effect } from 'effect'\nexport { value, Effect }\n",
	} {
		t.Run(source, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, source)
			c, done := p.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			at := strings.Index(source, "timeout")
			if at < 0 {
				at = strings.Index(source, "['time'")
			}
			if at < 0 {
				t.Fatal("refusal fixture needs a binding witness")
			}
			if rewrite := platformHostBindingRewrite(c, file, at, at+1); rewrite.fixable() {
				t.Fatalf("cannot prove captures/phase/metadata: %+v", rewrite)
			}
		})
	}
}

func TestPlatformHostBindingRepairLeavesCommonJS(t *testing.T) {
	p, file, _, _ := editorProgram(t, "const { timeout: { name: value } } = AbortSignal\nexport { value }\n")
	if err := os.WriteFile(filepath.Join(filepath.Dir(file.FileName().AsString()), "package.json"), []byte("{\"type\":\"commonjs\"}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	sawCommonJS := false
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{programBuilt: func(program *compiler.Program) {
		fresh := program.GetSourceFile(file.FileName())
		if fresh != nil && program.GetEmitModuleFormatOfFile(fresh) == core.ModuleKindCommonJS {
			sawCommonJS = true
		}
	}})
	if !sawCommonJS {
		t.Fatal("fixture must select CommonJS emit")
	}
	if result.Err != nil || len(result.Files) != 0 {
		t.Fatalf("CommonJS needs an explicit preserving boundary: %+v", result)
	}
}
