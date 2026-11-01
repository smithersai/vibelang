package vibelangfmt_test

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

func TestFormatFoldkitLabeledArrow(t *testing.T) {
	for _, source := range []string{
		"module handlers { const a = 1; ChangedUrl: (x: number) => x + a }\n",
		"const a = 1\nChangedUrl: ({ url }) => { return { url, a } }\n",
		"const a = 1\nChangedUrl: ({ url }) => ({ url, a })\n",
		"label: (x: number) => x\n",
		"label: /* kept */ (x: number) => x\n",
		"label: // kept\n(x: number) => x\n",
		"label:\n\n(x: number) => x\n",
		"function f() { label: /* kept */ (x: number) => x }\n",
		"label: (x: number): (() => number) => (): number => x\n",
		"label: ((x: number) => x)\n",
		"label: async (x: number) => x\n",
		"outer: inner: (x: number) => x\n",
		"label: ;\n(x: number) => x\n",
		"label: { (x: number) => x }\n",
		"function f() { label: (x: number) => x }\n",
		"one: (x: number) => x\ntwo: (y: string) => y\n",
	} {
		t.Run(strings.Split(source, "\n")[0], func(t *testing.T) {
			once, err := vibelangfmt.Format("labeled.vibe", source, foldkitDprintFormatter(t))
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(source, "kept") && !strings.Contains(once, "kept") {
				t.Fatalf("label comment lost:\n%s", once)
			}
			if err := vibelangfmt.SameProgram(source, once); err != nil {
				t.Fatal(err)
			}
			if got, want := returnTypeGroups(once), returnTypeGroups(source); got != want {
				t.Fatalf("labeled return-type grouping changed: %d -> %d\n%s", want, got, once)
			}
			twice, err := vibelangfmt.Format("labeled.vibe", once, foldkitDprintFormatter(t))
			if err != nil || twice != once {
				t.Fatalf("unstable: %v\n%s\n%s", err, once, twice)
			}
		})
	}
}
