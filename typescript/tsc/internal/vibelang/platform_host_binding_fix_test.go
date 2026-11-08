package vibelang

import (
	"strings"
	"testing"
)

func TestPlatformHostBindingRepairRefusals(t *testing.T) {
	for _, source := range []string{
		"export const { timeout: { name: value } } = AbortSignal\n",
		"let { timeout: { name: value } } = AbortSignal\nexport { value }\n",
		"const { timeout: { name: value } }: typeof AbortSignal = AbortSignal\nexport { value }\n",
		"const { timeout: { name: value } } = (AbortSignal as typeof AbortSignal)\nexport { value }\n",
		"const { ['time'+'out']: { name: value } } = AbortSignal\nexport { value }\n",
		"const { timeout: { name: value = '' } } = AbortSignal\nexport { value }\n",
		"/** Public documentation. */\nconst { timeout: { name: value } } = AbortSignal\nexport { value }\n",
		"// @ts-ignore\nconst { timeout: { name: value } } = AbortSignal\nexport { value }\n",
		"\"use client\";\nconst { timeout: { name: value } } = AbortSignal\nexport { value }\n",
		"const before = 1\nconst { timeout: { name: value } } = AbortSignal\nexport { before, value }\n",
		"function probe() { const { timeout: { name: value } } = AbortSignal; return value }\nexport { probe }\n",
		"const { timeout: { name: value } } = AbortSignal\nimport { Effect } from 'effect'\nexport { value, Effect }\n",
	} {
		t.Run(source, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, source)
			c, done := p.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			at := strings.Index(source, "timeout")
			if at < 0 {
				at = strings.Index(source, "['time'")
			}
			if at < 0 {
				t.Fatal("refusal fixture needs a binding witness")
			}
			if rewrite := platformHostBindingRewrite(c, file, at, at+1); rewrite.fixable() {
				t.Fatalf("cannot prove captures/phase/metadata: %+v", rewrite)
			}
		})
	}
}
