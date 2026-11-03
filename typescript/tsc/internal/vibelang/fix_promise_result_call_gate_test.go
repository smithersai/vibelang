package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPromiseResultCallGateFix(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	fixture := filepath.Join(root, "typescript/vibelang/cases/promise-result-call-gate.fail")
	twin := filepath.Join(root, "typescript/vibelang/cases/promise-result-call-gate-fixed")
	result := fixCase(t, copyCompilerFixture(t, fixture, root))
	want, err := os.ReadFile(filepath.Join(twin, "main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	got := ""
	for file, fixed := range result.Files {
		if filepath.Base(file.AsString()) == "main.vibe" {
			got = fixed.Text
		}
	}
	header := "// expect: EK0404 EK0404 EK0404 EK0404\n"
	if got != header+string(want) {
		t.Errorf("--fix writes:\n%s\nwant:\n%s", got, header+string(want))
	}
	if len(result.Refused) != 0 {
		t.Errorf("refused: %v", result.Refused)
	}
	if again := fixCase(t, copyCompilerFixture(t, twin, root)); len(again.Files) != 0 {
		t.Errorf("fixed twin is not idempotent: %v", again.Order)
	}
}

func TestPromiseResultCallGateFixKeepsNativeInvocation(t *testing.T) {
	for _, value := range []string{
		"Promise.resolve(1)",
		`import("effect")`,
		"new Promise<number>((resolve)=>resolve(1))",
		"object.tag\x60a\x24{value()}b\x60",
		"flag ? Promise.resolve(1) : Promise.resolve(2)",
	} {
		t.Run(value, func(t *testing.T) {
			source := "const flag=true; function value(){return 1}; const object={async tag(_p:TemplateStringsArray,n:number){return n}}; export effect function probe(){const held=" + value + ";return held}"
			_, file, _, _ := editorProgram(t, source)
			result := fixCase(t, filepath.Dir(file.FileName().AsString()))
			fixed := result.Files[file.FileName()]
			if fixed == nil || !strings.Contains(fixed.Text, "Effect.orDie(Effect.try(") {
				t.Fatalf("no preserving fix: %+v", result)
			}
			if strings.Contains(fixed.Text, "tryPromise") || strings.Contains(fixed.Text, "async ()") {
				t.Errorf("fix must retain the Promise as data: %s", fixed.Text)
			}
		})
	}
}

func TestPromiseResultCallGateFixRefusesMovingEffectCode(t *testing.T) {
	for _, value := range []string{
		"Promise.resolve(try Effect.sleep(1))",
		"Promise.resolve(do { 1 })",
		"1 |> Promise.resolve(%)",
	} {
		t.Run(value, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, "export effect function probe() { const held = "+value+"; return 0 }")
			result := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if fixed := result.Files[file.FileName()]; fixed != nil && strings.Contains(fixed.Text, "Effect.orDie(Effect.try(") {
				t.Errorf("fix moved code into a plain thunk: %s", fixed.Text)
			}
		})
	}
}

func TestPromiseResultCallGateFixRefusesShadowedEffect(t *testing.T) {
	source := "import {Effect as Fx} from \"effect\"; const Effect={try:Fx.try,orDie:(_value:any)=>Fx.succeed(\"wrong\")}; export effect function probe(){const held=Promise.resolve(1);return held}"
	_, file, _, _ := editorProgram(t, source)
	result := fixCase(t, filepath.Dir(file.FileName().AsString()))
	if fixed := result.Files[file.FileName()]; fixed != nil && strings.Contains(fixed.Text, "Effect.orDie(Effect.try(") {
		t.Errorf("fix invoked a shadowed Effect: %s", fixed.Text)
	}
}

func TestPromiseResultCallGateFixRespectsDisabledGlobals(t *testing.T) {
	_, file, _, _ := editorProgram(t, "export effect function probe(){const held=Promise.resolve(1);return held}")
	dir := filepath.Dir(file.FileName().AsString())
	config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"vibe":{"effectModules":false},"files":["main.vibe"]}`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	result := fixCase(t, dir)
	if fixed := result.Files[file.FileName()]; fixed != nil && strings.Contains(fixed.Text, "Effect.orDie(Effect.try(") {
		t.Errorf("fix introduced a disabled global: %s", fixed.Text)
	}
}
