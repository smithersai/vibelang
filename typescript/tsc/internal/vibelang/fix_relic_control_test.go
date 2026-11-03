package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

const relicServiceSource = `control Ask { ask(x: number): number!! }
export effect function probe() {
 try { return try Ask.ask(4) } handle Ask.ask(x) { return try resume(x + 2) }
}`

func TestRelicControlFix(t *testing.T) {
	for _, source := range []string{relicServiceSource,
		strings.Replace(relicServiceSource, "control Ask", "control class Ask", 1),
		`control Ask {ask(): number!!} export effect function probe(){try {return try Ask.ask()} handle Ask.ask(){return try resume(6)}}`,
		`control Ask { ask(x: string): boolean!! }
export effect function probe() { try { return try Ask.ask("deploy") } handle Ask.ask(x) { return try resume(true) } }`,
		`control Ask { ask(x: number, y: number): number!! }
export effect function probe() { try { return try Ask.ask(4, 2) } handle Ask.ask(x, y) { return try resume(x + y) } }`,
	} {
		result := fixProjectOf(t, map[string]string{"main.vibe": source})
		got := fixedText(result, "main.vibe")
		if !strings.Contains(strings.Join(strings.Fields(got), " "), "service Ask") || !strings.Contains(got, "provide Ask") || strings.Contains(got, "resume(") {
			t.Fatalf("missing service migration: %s; refusals: %+v", got, result.Refused)
		}
		if len(result.Refused) != 0 {
			t.Fatalf("safe service migration refused: %+v", result.Refused)
		}
	}
}

func TestRelicControlRefusesContinuationAndABI(t *testing.T) {
	for _, source := range []string{
		"export " + relicServiceSource,
		strings.ReplaceAll(relicServiceSource, "ask", "__proto__"),
		strings.Replace(relicServiceSource, "handle Ask.ask(x)", "handle Ask.ask(...x)", 1),
		strings.Replace(relicServiceSource, "handle Ask.ask(x)", "handle Ask.ask(x = 4)", 1),
		relicServiceSource + "\nexport { Ask }",
		relicServiceSource + "\nexport { Ask as default }",
		relicServiceSource + "\nconst observed = { Ask }; export const observe = () => Object.keys(observed.Ask)",
		relicServiceSource + "\nexport const observe = () => eval(\"Ask\")",
		strings.Replace(relicServiceSource, "return try resume(x + 2)", "return resume(x + 2)", 1),
		"function resume(...xs: unknown[]) { return Effect.succeed(0) }\n" + relicServiceSource,
		strings.Replace(relicServiceSource, "return try resume(x + 2)", "const result = try resume(x + 2); return result + 1", 1),
		strings.Replace(relicServiceSource, "return try resume(x + 2)", "return try abandon()", 1),
		strings.Replace(relicServiceSource, "Ask.ask(4)", "Ask.ask(Math.random())", 1),
		strings.Replace(relicServiceSource, "resume(x + 2)", "resume(x.valueOf())", 1),
	} {
		program, file, _, _ := editorProgram(t, source)
		program.GetSemanticDiagnostics(t.Context(), file)
		c, done := program.GetTypeCheckerForFile(t.Context(), file)
		var control *ast.Node
		for _, statement := range file.Statements.Nodes {
			if ast.IsClassDeclaration(statement) && declarationWord(statement) == "control" {
				control = statement
				break
			}
		}
		if control == nil {
			t.Fatal("missing control declaration")
		}
		rewrite := relicControlRewrite(c, file, control)
		done()
		if rewrite == nil || rewrite.fixable() || !strings.Contains(rewrite.why, "No general preserving") {
			t.Fatalf("unsafe rewrite: %+v\n%s", rewrite, source)
		}
	}
}
