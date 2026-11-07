package vibelangmapper

import (
	"strings"
	"testing"
)

func TestForkOwnerProjection(t *testing.T) {
	for _, c := range []struct{ name, form, want string }{
		{"in", "fork.in(s) Effect.succeed(1)", ".forkIn(s)(Effect.succeed(1))"},
		{"in-spaced", "fork . in (s) Effect.succeed(1)", ".forkIn(s)(Effect.succeed(1))"},
		{"in-lines", "fork\n.\nin(s) Effect.succeed(1)", ".forkIn(s)(Effect.succeed(1))"},
		{"scoped", "fork.scoped Effect.succeed(1)", ".forkScoped(Effect.succeed(1))"},
		{"detached", "fork.detached Effect.succeed(1)", ".forkDetach(Effect.succeed(1))"},
		{"detached-lines", "fork\n.detached Effect.succeed(1)", ".forkDetach(Effect.succeed(1))"},
		{"try-in-scope", "fork.in(try make()) Effect.succeed(1)", ".forkIn("},
		{"in-block", "fork.in(s) effect { return 1 }", ".forkIn(s)("},
		{"scoped-block", "fork.scoped effect { return 1 }", ".forkScoped("},
		{"detached-block", "fork.detached effect { return 1 }", ".forkDetach("},
		{"keyword-block", "fork effect { return 1 }", "$gen(function* ()"},
		{"scoped-parenthesized", "fork.scoped (effect { return 1 })", ".forkScoped("},
		{"in-parenthesized", "fork.in(s) (Effect.succeed(1))", ".forkIn(s)("},
	} {
		t.Run(c.name, func(t *testing.T) {
			source := `import { Effect } from "effect"; export effect function sample(s, make) { const f = ` + c.form + `; return join f }`
			for _, p := range []Projection{Project(source, testContext), Executable(source, testContext)} {
				if len(p.Diagnostics) != 0 {
					t.Fatalf("a named owner must project without diagnostics: %v\n%s", p.Diagnostics, p.Text)
				}
				if !strings.Contains(p.Text, c.want) {
					t.Fatalf("missing %q:\n%s", c.want, p.Text)
				}
				assertValidMap(t, p, source)
				assertParses(t, p.Text)
			}
		})
	}
}
