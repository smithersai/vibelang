package vibelang

import (
	"fmt"
	"strings"
	"testing"
)

func TestCauseCatchFixPreservesLiteralResult(t *testing.T) {
	for _, pair := range [][2]string{
		{"1", "2"}, {"\"one\"", "\"two\""}, {"1n", "2n"}, {"-1", "-2"},
	} {
		t.Run(pair[0], func(t *testing.T) {
			source := fmt.Sprintf("export effect function main() { try { return %s } catch (cause: Cause) { return %s } }", pair[0], pair[1])
			program, file, _, _ := editorProgram(t, source)
			proposed := fileFixes(t.Context(), program, file, nil, []int32{EK2113.Code})
			if got := proposed.text(); got != source {
				t.Fatalf("literal result must refuse the widening repair:\n%s", got)
			}
			found := false
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == "EK" && d.Code() == EK2113.Code {
					found = true
					if !strings.Contains(notesOf(d), "literal return type") {
						t.Fatalf("refusal has no explanation: %s", notesOf(d))
					}
				}
			}
			if !found {
				t.Fatal("lost the migration diagnostic")
			}
		})
	}
}

func TestCauseCatchFixKeepsWrittenReturnContract(t *testing.T) {
	source := "export effect function main(): number!! { try { return 1 } catch (cause: Cause) { return 2 } }"
	program, file, _, _ := editorProgram(t, source)
	proposed := fileFixes(t.Context(), program, file, nil, []int32{EK2113.Code})
	if got := proposed.text(); got == source || !strings.Contains(got, "match") {
		t.Fatalf("written contract should retain its safe fix:\n%s", got)
	}
}

func TestCauseCatchFixKeepsMixedAndWrittenLiteralTypes(t *testing.T) {
	for _, source := range []string{
		"export effect function main(other: string) { try { return 1 } catch (cause: Cause) { return other } }",
		"export effect function main(other: number) { try { return \"one\" } catch (cause: Cause) { return other } }",
		"export effect function main(): Effect.Effect<1 | 2> { try { return 1 } catch (cause: Cause) { return 2 } }",
	} {
		program, file, _, _ := editorProgram(t, source)
		if got := fileFixes(t.Context(), program, file, nil, []int32{EK2113.Code}).text(); got != source {
			t.Fatalf("literal result must refuse the widening repair:\n%s", got)
		}
	}
}
func TestCauseCatchFixKeepsAlreadyWideUnion(t *testing.T) {
	source := "export effect function main(other: number) { try { return 1 } catch (cause: Cause) { return other } }"
	program, file, _, _ := editorProgram(t, source)
	if got := fileFixes(t.Context(), program, file, nil, []int32{EK2113.Code}).text(); got == source {
		t.Fatal("number already absorbs the literal's widening")
	}
}
