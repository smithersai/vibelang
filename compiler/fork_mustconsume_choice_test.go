package compiler

import "testing"

// A union with a scalar must not erase an outstanding Result. The matched
// controls pin semantic success extraction rather than the TS non-null type.
func TestPinnedForkMustConsumeChoice(t *testing.T) {
	const header = `class Missing extends Error {}
function read(): Result<number, Missing> { return 1 }
async function work(): Promise<number> { return 1 }
`
	for _, expression := range []string{
		`flag && read()`, `flag || read()`, `flag ? read() : false`,
		`flag ? false : read()`, `nullable ?? read()`,
		`flag && (nullable ?? read())`,
	} {
		t.Run("lost "+expression, func(t *testing.T) {
			result := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang,
				Text: header + `function main(flag:boolean, nullable:number|null):void { const lost=` + expression + `; }`}})
			found := false
			for _, diagnostic := range result.Diagnostics {
				if diagnostic.Code == "VIBE1302" {
					found = true
				}
			}
			if !found {
				t.Fatalf("mixed Result binding lost its obligation: %v", ambientChargeMessages(result))
			}
		})
	}
	for _, expression := range []string{
		`flag && read()!`, `flag || read()!`, `flag ? read()! : false`,
		`flag ? false : read()!`, `nullable ?? read()!`,
		`flag && (nullable ?? read()!)`,
	} {
		t.Run("extracted "+expression, func(t *testing.T) {
			result := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang,
				Text: header + `function main(flag:boolean, nullable:number|null):Result<void,Missing> { const plain=` + expression + `; }`}})
			requireCleanCompile(t, result)
		})
	}
	t.Run("awaited scalar Promise choice", func(t *testing.T) {
		result := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang,
			Text: header + `async function main(flag:boolean):Promise<void> { const started=flag ? work() : 0; await started; }`}})
		requireCleanCompile(t, result)
	})
}
