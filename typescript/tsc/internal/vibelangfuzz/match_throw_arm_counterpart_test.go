package vibelangfuzz

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

func TestMatchThrowArmCounterpartQuoted(t *testing.T) {
	chapterSays(t, "004-match.md", "It introduces no function or Effect boundary: its ordered tests and selected arm stay in the enclosing activation")
}

// A runnable reference is insufficient when its TypeScript twin is invalid.
// Check the actual reference printer with stock TypeScript before comparing Exits.
func TestMatchThrowArmCounterpartNative(t *testing.T) {
	TestMatchThrowArmCounterpartQuoted(t)
	p := vipgen.Probe("vip07.throw-arm")
	w := NewWorkspace(t)
	project := Project{
		Files: map[string]string{
			"main.ts":      vipgen.PrintEffect(p),
			"events.d.ts":  "declare module 'vip-events' { export function ev(...values: any[]): any }",
			"package.json": "{\"type\":\"module\"}",
		},
		Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"outDir":"out"},"files":["main.ts","events.d.ts"]}`,
	}
	_ = stockDeclaration(t, w, StockTypeScript(t), project, "out/main.d.ts")
}
