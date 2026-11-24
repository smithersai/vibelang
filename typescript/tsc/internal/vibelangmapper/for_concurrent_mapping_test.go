package vibelangmapper

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/spanmap"
	"gotest.tools/v3/assert"
)

// TestForConcurrentHeadMapsToSource checks that a for concurrent loop's
// limit and binding, which the projection moves out of source order, map
// back to their source tokens (#461).
func TestForConcurrentHeadMapsToSource(t *testing.T) {
	t.Parallel()
	// A head names a token by the text around it: before, the token, and
	// after, once in the source and once in the projection.
	type head struct{ before, token, after string }
	for _, tc := range []struct {
		source string
		heads  []head
	}{
		{
			source: "effect function g(xs: number[]) {\n  for concurrent(\"many\") (const x of xs) { try log(x) }\n  return 1\n}\n",
			heads:  []head{{"concurrent(", `"many"`, ")"}, {"const ", "x", " of"}},
		},
		{
			source: "effect function g(xs: { a: number }[], n: number) {\n  for concurrent(n + 1) (const { a: first = 2 } of xs) { try log(first) }\n  return 1\n}\n",
			heads:  []head{{"concurrent(", "n + 1", ")"}, {"const ", "{ a: first = 2 }", " of"}},
		},
	} {
		projection := Project(tc.source, testContext)
		assert.Equal(t, len(projection.Diagnostics), 0, "%v\n%s", projection.Diagnostics, projection.Text)
		assertValidMap(t, projection, tc.source)
		m := spanmap.New(projection.Segments)
		for _, h := range tc.heads {
			want := strings.Index(tc.source, h.before+h.token+h.after)
			assert.Assert(t, want >= 0, "%q", h.token)
			want += len(h.before)
			// The projection spells the limit "= n + 1;" and the binding
			// "const x = $concurrentItem".
			virtual := -1
			for _, around := range [][2]string{{"= ", ";"}, {"const ", " = $concurrentItem"}} {
				if i := strings.Index(projection.Text, around[0]+h.token+around[1]); i >= 0 {
					virtual = i + len(around[0])
				}
			}
			assert.Assert(t, virtual >= 0, "%q missing from %s", h.token, projection.Text)
			original, fidelity := m.VirtualToOriginalSpan(core.NewTextRange(virtual, virtual+len(h.token)))
			assert.Assert(t, fidelity.IsExact(), "%q maps with fidelity %v\n%s", h.token, fidelity, projection.Text)
			assert.Equal(t, original.Pos(), want, "%q", h.token)
			assert.Equal(t, tc.source[original.Pos():original.End()], h.token)
		}
	}
}
