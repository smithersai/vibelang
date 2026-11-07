package vibelang

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestCapturedPipeStatementBoundaries(t *testing.T) {
	for _, test := range []struct{ name, source string }{
		{"source", "import * as Effect from 'effect/Effect'\nconst program = Effect.succeed(1)\n// retained pipeline boundary\nprogram.pipe(Effect.asVoid, Effect.runSync)\nexport const marker = 1\n"},
		{"block", "import * as Effect from 'effect/Effect'\n{\nconst program = Effect.succeed(1)\nprogram.pipe(Effect.asVoid, Effect.runSync)\n}\nexport const marker = 1\n"},
		{"case", "import * as Effect from 'effect/Effect'\nswitch (1) { case 1:\nconst program = Effect.succeed(1)\nprogram.pipe(Effect.asVoid, Effect.runSync)\nbreak\n}\nexport const marker = 1\n"},
		{"default", "import * as Effect from 'effect/Effect'\nswitch (0) { default:\nconst program = Effect.succeed(1)\nprogram.pipe(Effect.asVoid, Effect.runSync)\n}\nexport const marker = 1\n"},
		{"if", "import * as Effect from 'effect/Effect'\nconst program = Effect.succeed(1)\nif (false) program.pipe(Effect.asVoid, Effect.runSync)\nexport const marker = 1\n"},
		{"else", "import * as Effect from 'effect/Effect'\nconst program = Effect.succeed(1)\nif (true) {} else program.pipe(Effect.asVoid, Effect.runSync)\nexport const marker = 1\n"},
		{"while", "import * as Effect from 'effect/Effect'\nconst program = Effect.succeed(1)\nwhile (false) program.pipe(Effect.asVoid, Effect.runSync)\nexport const marker = 1\n"},
		{"do", "import * as Effect from 'effect/Effect'\nconst program = Effect.succeed(1)\ndo program.pipe(Effect.asVoid, Effect.runSync); while (false)\nexport const marker = 1\n"},
		{"label", "import * as Effect from 'effect/Effect'\nconst program = Effect.succeed(1)\nboundary: program.pipe(Effect.asVoid, Effect.runSync)\nexport const marker = 1\n"},
		{"return", "import * as Effect from 'effect/Effect'\nfunction use() {\nconst program = Effect.succeed(1)\nreturn program.pipe(Effect.asVoid, Effect.runSync)\n}\nuse()\nexport const marker = 1\n"},
		{"rhs", "import * as Effect from 'effect/Effect'\nconst program = Effect.succeed(1)\nexport const result = program.pipe(Effect.asVoid, Effect.runSync)\nexport const marker = 1\n"},
		{"function", "import * as Effect from 'effect/Effect'\nfunction use() {\nconst program = Effect.succeed(1)\nprogram.pipe(Effect.asVoid, Effect.runSync)\n}\nuse()\nexport const marker = 1\n"},
	} {
		for _, semicolon := range []bool{false, true} {
			t.Run(test.name+map[bool]string{false: "/asi", true: "/semicolon"}[semicolon], func(t *testing.T) {
				source := test.source
				if semicolon {
					source = strings.ReplaceAll(source, "Effect.succeed(1)\n", "Effect.succeed(1);\n")
				}
				if test.name == "source" {
					source = strings.ReplaceAll(source, "\n", "\r\n")
				}
				_, file, _, _ := editorProgram(t, source)
				result := fixCase(t, filepath.Dir(file.FileName().AsString()))
				fixed := result.Files[file.FileName()]
				if result.Err != nil || fixed == nil || strings.Contains(fixed.Text, ".pipe(") {
					t.Fatalf("captured pipeline not repaired: err=%v refused=%+v fixed=%v", result.Err, result.Refused, fixed)
				}
				if test.name == "source" && strings.Count(fixed.Text, "// retained pipeline boundary") != 1 {
					t.Fatal("leading comment changed")
				}
				program, checked, _, _ := editorProgram(t, fixed.Text)
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), checked), program.GetSemanticDiagnostics(t.Context(), checked)...) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("fixed source reports %s\n%s", d.String(), fixed.Text)
					}
				}
				again := fixCase(t, filepath.Dir(checked.FileName().AsString()))
				if again.Err != nil || len(again.Files) != 0 {
					t.Fatalf("repair is not a fixed point: %+v", again)
				}
			})
		}
	}
}
