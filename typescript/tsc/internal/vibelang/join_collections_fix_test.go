package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func repairLegacyCollectionSource(t *testing.T, source string) string {
	t.Helper()
	fixed := source
	for round := 0; round < 4; round++ {
		program, file, _, _ := editorProgram(t, fixed)
		proposal := fileFixes(t.Context(), program, file, nil, []int32{EK1704.Code})
		if len(proposal.fixes) == 0 {
			if round == 0 {
				t.Fatalf("no collection repair:\n%s", fixed)
			}
			return fixed
		}
		fixed = proposal.text()
	}
	t.Fatalf("collection repair did not converge:\n%s", fixed)
	return ""
}

func TestLegacyCollectionJoinRepair(t *testing.T) {
	rows := []struct{ key, typ, operand, result, failure string }{
		{"array", "ReadonlyArray<Fiber.Fiber<number,string>>", "input", "number[]", "string"},
		{"tuple", "readonly [Fiber.Fiber<number,string>,Fiber.Fiber<number,string>]", "input", "[number,number]", "string"},
		{"record", "{readonly first:Fiber.Fiber<number,string>;readonly second:Fiber.Fiber<number,string>}", "input", "{first:number;second:number}", "string"},
		{"index", "Readonly<Record<string,Fiber.Fiber<number,string>>>", "input", "Record<string,number>", "string"},
		{"empty-array", "readonly []", "input", "[]", "never"},
		{"literal-array", "Fiber.Fiber<number,string>", "[input]", "[number]", "string"},
		{"literal-record", "Fiber.Fiber<number,string>", "({value:input})", "{value:number}", "string"},
	}
	for _, row := range rows {
		for wrapper := range 3 {
			t.Run(fmt.Sprintf("%s/%d", row.key, wrapper), func(t *testing.T) {
				operand := row.operand
				if wrapper == 1 {
					operand = "(/* wait 😀 */ " + operand + ")"
				}
				if wrapper == 2 {
					operand = "(flag ? " + operand + " : " + operand + ")"
				}
				source := "import type {Fiber,Effect} from \"effect\";\n" +
					"declare const flag:boolean;export declare function native(input:" + row.typ + "):Effect.Effect<" + row.result + "," + row.failure + ">;\n" +
					"export effect function actual(input:" + row.typ + "){/* café 😀 */ return join " + operand + "}\n" +
					"const forward:typeof native=actual;const backward:typeof actual=native;void forward;void backward;"
				fixed := repairLegacyCollectionSource(t, source)
				if !strings.Contains(fixed, "module $LegacyJoin") {
					t.Fatalf("missing native compatibility module:\n%s", fixed)
				}
				for _, comment := range []string{"/* café 😀 */", "/* wait 😀 */"} {
					if strings.Count(source, comment) != strings.Count(fixed, comment) {
						t.Fatalf("lost source comment %s", comment)
					}
				}
				checked, file, _, _ := editorProgram(t, fixed)
				for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), file), checked.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("repair adds %s\n%s", d.String(), fixed)
					}
				}
			})
		}
	}
}

func TestLegacyCollectionJoinModuleReuse(t *testing.T) {
	source := "import type {Fiber} from \"effect\";declare const input:ReadonlyArray<Fiber.Fiber<number>>;export effect function actual(){const a=join input;const b=join input;const c=join input;return [a,b,c]}"
	fixed := repairLegacyCollectionSource(t, source)
	if got := strings.Count(fixed, "module $LegacyJoin"); got != 1 {
		t.Fatalf("helper count %d, want 1:\n%s", got, fixed)
	}
	program, file, _, _ := editorProgram(t, fixed)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatal(d.String())
		}
	}
}

func TestLegacyCollectionJoinRefusals(t *testing.T) {
	for _, typ := range []string{"number", "unknown", "{}", "ReadonlyArray<number>", "{value:number}", "Promise<number>", "Effect.Effect<number>"} {
		t.Run(typ, func(t *testing.T) {
			source := "declare const input:" + typ + ";export effect function actual(){return join input}"
			program, file, _, _ := editorProgram(t, source)
			proposal := fileFixes(t.Context(), program, file, nil, []int32{EK1704.Code})
			if len(proposal.fixes) != 0 {
				t.Fatalf("invented collection intent:\n%s", proposal.text())
			}
		})
	}
}

// The editor describes the same single-Fiber operation as VIP-17.
func TestLegacyCollectionJoinHover(t *testing.T) {
	const source = "export effect function main(f: Fiber.Fiber<number,string>) { return join f }"
	_, file, service, _ := editorProgram(t, source)
	pos := strings.Index(source, "join f")
	text := hoverText(t, service, lsconv.FileNameToDocumentURI(file.FileName()), lsproto.Position{Line: 0, Character: uint32(pos)})
	if !strings.Contains(text, "Fiber.join") || !strings.Contains(text, "propagates its failure") {
		t.Fatalf("missing native join behavior: %s", text)
	}
	for _, retired := range []string{"every fiber of the array", "failure interrupts the rest"} {
		if strings.Contains(text, retired) {
			t.Fatalf("retired collection promise: %s", text)
		}
	}
}
