package vibelang

import (
	"testing"
)

func TestCatchHeadValueTypes(t *testing.T) {
	for _, tc := range []struct{ name, source string }{
		{"direct Effect", `export effect function main(): number!! {
            return Effect.fail("inner" as const) catch (e) => e.length
        }`},
		{"returned Effect", `export effect function main(): number!! {
            return (try Effect.succeed(Effect.fail("inner" as const))) catch (e) => e.length
        }`},
		{"explicit boundary", `export effect function main(): number!! {
            return (effect { return Effect.fail("inner" as const) catch (e) => e.length }) catch () => 0
        }`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if errors := errorsOf(t, tc.source); len(errors) != 0 {
				t.Fatalf("catch head changed the source value or handler channel: %v", errors)
			}
		})
	}
}
