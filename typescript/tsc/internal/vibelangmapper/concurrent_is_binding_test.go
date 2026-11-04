package vibelangmapper

import (
	"strings"
	"testing"
)

func TestConcurrentIsBindingProjection(t *testing.T) {
	for _, source := range []string{
		"effect function home(xs: unknown[]) { const readers: (()=>unknown)[]=[]; for concurrent(1)(const x of xs) (x is {id:let id}) && readers.push(()=>id); return readers; }",
		"effect function home(xs: unknown[]) { const readers: (()=>unknown)[]=[]; for concurrent(1)(const x of xs) {(x is {id:let id}) && readers.push(()=>id);} return readers; }",
		"effect function home(xs: unknown[]) { const readers: (()=>unknown)[]=[]; for try(const x of Stream.fromIterable(xs)) (x is {id:let id}) && readers.push(()=>id); return readers; }",
	} {
		p := lower(source, testContext)
		if _, _, overlap, ok := p.plan.render(checking{names: p.names}, source, func() string { return "" }); !ok {
			for _, edit := range p.plan.edits {
				if edit.pos <= overlap+20 && edit.end >= overlap-20 {
					t.Logf("overlap edit: %+v", edit)
				}
			}
			t.Errorf("overlap at %d: %s", overlap, source)
		}
		for _, projected := range []Projection{Project(source, testContext), Executable(source, testContext)} {
			for _, d := range projected.Diagnostics {
				if strings.Contains(d.Message, "overlapping edits") {
					t.Errorf("invalid projection: %s", d.Message)
				}
			}
			assertValidMap(t, projected, source)
		}
	}
}
