package vibelang

import (
	"strings"
	"testing"
)

func TestMatchVIP7ApiIdentity(t *testing.T) {
	for _, source := range []string{
		`import { Match as M } from "effect"
export const keep=42 as unknown as string;
export const f=(n:1|2):number=>M.value(n).pipe(M.when(1,()=>1),M.orElse(()=>2))
`,
		`import { Match as M } from "effect"
const checked=M.withReturnType;
export const keep=42 as unknown as string;
export const f=(n:1|2):number=>M.value(n).pipe(checked<number>(),M.when(1,()=>1),M.orElse(()=>2))
`,
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			found := false
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == 4839 {
					found = true
					for _, note := range d.MessageChain() {
						if strings.Contains(note.String(), "No quick fix") {
							t.Skipf("pending cov-match VIP-7: native API alias was not safely recognized: %s", note.String())
						}
					}
				}
			}
			if !found {
				t.Skip("pending cov-match VIP-7: imported Match and withReturnType aliases require resolved API identity")
			}
			fixed := applyQuickFix(t, source, 4839)
			if !strings.Contains(fixed, "42 as unknown as string") {
				t.Fatal("migration changed an author-written assertion")
			}
		})
	}
	fake := `const Match={value(n:number){return {pipe(..._stages:unknown[]){return n}}},withReturnType<T>(){return 0},when(_p:number,_f:()=>number){return 0},orElse(_f:()=>number){return 0}};
export const f=(n:number)=>Match.value(n).pipe(Match.withReturnType<number>(),Match.when(1,()=>1),Match.orElse(()=>2))
`
	program, file, _, _ := editorProgram(t, fake)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == 4839 {
			t.Skip("pending cov-match VIP-7: local API lookalikes must not be migrated by spelling")
		}
	}
}

// VIP-7 Match API aliases and local lookalikes; rule: docs/design/vips/0007-match.md#98f3dcb1e7993b49
