package vibelangmapper

import (
	"strings"
	"testing"
)

func TestTaggedCatchProjection(t *testing.T) {
	source := `error NotFound
error RateLimited { retryAfter: number }
export effect function load(id: string) {
  return fetchItem(id) catch {
    when NotFound: "missing";
    when RateLimited(let e): try sleep(e.retryAfter), "retry";
  }
}
`
	projection := Project(source, testContext)
	if len(projection.Diagnostics) != 0 {
		t.Fatalf("unexpected diagnostics: %v", projection.Diagnostics)
	}
	for _, want := range []string{"$catch(", "Effect.gen(function* ()", "Effect.fail("} {
		if !strings.Contains(projection.Text, want) {
			t.Fatalf("projection missing %q:\n%s", want, projection.Text)
		}
	}
	assertValidMap(t, projection, source)
	assertParses(t, projection.Text)
}
