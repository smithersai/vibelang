package vibelangfuzz

import (
	"fmt"
	"testing"
)

// Ordinary finite reverse mappings keep the current TypeScript declaration.
func TestReverseMappedFiniteDeclarations(t *testing.T) {
	recursiveDeclarationsChapter(t)
	w := NewWorkspace(t)
	stock := StockTypeScript(t)
	for _, depth := range []int{0, 1, 2, 4, 8} {
		for _, named := range []bool{false, true} {
			t.Run(fmt.Sprintf("depth-%d-named-%t", depth, named), func(t *testing.T) {
				body := "type Deep<T> = { [K in keyof T]: Deep<T[K]> }\ndeclare function deep<T>(x: Deep<T>): T\n"
				shape := "{ value: number }"
				if named {
					body += "interface Part0 " + shape + "\n"
					shape = "Part0"
				}
				for i := 1; i <= depth; i++ {
					next := "{ item: " + shape + "; count: number }"
					if named {
						body += fmt.Sprintf("interface Part%d %s\n", i, next)
						shape = fmt.Sprintf("Part%d", i)
					} else {
						shape = next
					}
				}
				body += "declare const input: " + shape + "\nexport const result = deep(input)\n"
				CheckParity(t, w, stock, "TestReverseMappedFiniteDeclarations", Archive(map[string]string{"main.ts": body, "package.json": `{"type":"module"}`, "tsconfig.json": recursiveConfig}))
			})
		}
	}
	t.Run("excluded-source-cycle", func(t *testing.T) {
		source := "type Deep<T> = { [K in keyof T]: Deep<T[K]> }\n" +
			"type Only<T> = { [K in keyof T & \"n\"]: Deep<T[K]> }\n" +
			"declare function select<T>(x: Only<T>): T\n" +
			"declare const node: { n: number; self: typeof node }\n" +
			"export const finite = select(node)\n"
		CheckParity(t, w, stock, "TestReverseMappedFiniteDeclarations", Archive(map[string]string{"main.ts": source, "package.json": `{"type":"module"}`, "tsconfig.json": recursiveConfig}))
	})

}
