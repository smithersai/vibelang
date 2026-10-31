package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsutil"
)

type loopOperandCompletionHost struct{ editorTestHost }

func (h loopOperandCompletionHost) GetPreferences(string) lsutil.UserPreferences {
	var p lsutil.UserPreferences
	p.IncludeCompletionsForModuleExports = core.TSFalse
	return p
}

func TestCompletionDistinguishesLoopOperandsFromParameterLists(t *testing.T) {
	const prefix = "const x = 99\nlet read = (): number => 0\n"
	for _, test := range []struct {
		name, source, marker string
		wantRead             bool
	}{
		{"concurrent operand", prefix + "export effect function run() { for concurrent (let x of (read = (): number => x, [1])) { x = 7 } }\n", "(read =", true},
		{"ordinary operand", prefix + "export function run(): void { for (let x of (read = (): number => x, [1])) { x = 7 } }\n", "(read =", true},
		{"expression", prefix + "export const value = (read())\n", "(read()", true},
		{"arrow default", prefix + "export const value = (argument = (read())): number => argument\n", "(read()", true},
		{"function parameter", prefix + "export function run(argument: number): number { return argument }\n", "(argument", false},
		{"arrow parameter", prefix + "export const run = (argument: number): number => argument\n", "(argument", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			p, file, _, converters := editorProgram(t, test.source)
			service := ls.NewLanguageService(nil, p, loopOperandCompletionHost{editorTestHost{converters: converters}}, string(file.FileName()))
			if ds := p.GetSyntacticDiagnostics(t.Context(), file); len(ds) != 0 {
				t.Fatalf("invalid regression input: %v", ds)
			}
			position := strings.Index(test.source, test.marker) + 1
			if position == 0 {
				t.Fatal("missing completion marker")
			}
			result, err := service.GetCompletionsAtPosition(t.Context(), file, position, nil, true)
			if err != nil {
				t.Fatal(err)
			}
			found := false
			if result != nil {
				for _, item := range result.Items {
					found = found || item.Label == "read"
				}
			}
			if found != test.wantRead {
				t.Fatalf("read completion = %v, want %v (result: %v)", found, test.wantRead, result)
			}
		})
	}
}
