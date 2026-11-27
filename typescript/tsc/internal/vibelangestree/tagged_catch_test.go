package vibelangestree

import "testing"

func TestParseTaggedCatchExpression(t *testing.T) {
	src := `error NotFound
error RateLimited { retryAfter: number }
export effect function load(id: string) {
  return fetchItem(id) catch {
    when NotFound: "missing";
    when RateLimited(let e): try sleep(e.retryAfter), "retry";
  }
}
`
	program := parse(t, "/catch.vibe", src)
	foundCatch := false
	for _, n := range nodes(program) {
		if n["type"] == "VibeCatchExpression" {
			foundCatch = true
		}
	}
	if !foundCatch {
		t.Fatalf("expected VibeCatchExpression node")
	}
}
