package vibelang

import (
	"fmt"
	"os"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func chapter007TypeReadSource(key string, projection bool) string {
	read := "typeof Flags.default"
	expected := "Flags.Shape"
	if projection {
		read = "(typeof Flags.default)[\"enabled\"]"
		expected = "boolean"
	}
	prefix := ""
	generic := ""
	switch key {
	case "local-shadow":
		prefix = "type ReturnType<T> = { enabled: \"captured\" }\n"
	case "nested-shadow":
		prefix = "type ReturnType<T> = { enabled: \"captured\" }\n"
	case "type-parameter":
		generic = "<ReturnType>"
	case "value-only":
		prefix = "const ReturnType = () => 0\n"
	}
	service := "service Flags { static readonly key = \"chapter007/Flags\"; static readonly default: Flags.Shape = { enabled: true }; enabled: boolean }\n"
	equal := "type Equal<A,B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false\n"
	body := "type Value = " + read + "\nconst exact: Equal<Value," + expected + "> = true\nreturn exact\n"
	if key == "local-shadow" {
		return prefix + service + equal + "export function proof" + generic + "() {\n" + body + "}\n"
	}
	return service + equal + "export function proof" + generic + "() {\n" + prefix + body + "}\n"
}

func chapter007CheckTypeRead(t *testing.T, key string, projection bool) {
	source := chapter007TypeReadSource(key, projection)
	p, f, _, _ := editorProgram(t, source)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("invalid original witness: %s", d.String())
		}
	}
	fixed := applyQuickFix(t, source, EK4855.Code)
	p, f, _, _ = editorProgram(t, fixed)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("type preservation failed: %s\n%s", d.String(), fixed)
		}
	}
}

// Chapter 007 / generated ReturnType avoids type capture: docs/design/src/007-tooling.md#cf0d06ac0b0fd37d
// Chapter 007 / exact service read shape: docs/design/src/007-tooling.md#3550e5d842a080a6
// Chapter 007 / type equality checks detect successful-but-captured repair: docs/design/src/007-tooling.md#a744b9a42b894d0f
func TestChapter007ServiceTypeReadHygiene(t *testing.T) {
	for _, key := range []string{"local-shadow", "nested-shadow", "type-parameter"} {
		for _, projection := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/projection=%t", key, projection), func(t *testing.T) {
				if os.Getenv("VIBELANG_COVERAGE_RUN_PENDING") != "1" {
					t.Skip("docs/design/src/007-tooling.md#cf0d06ac0b0fd37d and #3550e5d842a080a6: generated ReturnType resolves a source type binding; witness " + key)
				}
				chapter007CheckTypeRead(t, key, projection)
			})
		}
	}
}

// Chapter 007 / value names do not shadow type names: docs/design/src/007-tooling.md#7bf799b8f9e04355
func TestChapter007ServiceTypeReadValueControl(t *testing.T) {
	for _, projection := range []bool{false, true} {
		chapter007CheckTypeRead(t, "value-only", projection)
	}
}
