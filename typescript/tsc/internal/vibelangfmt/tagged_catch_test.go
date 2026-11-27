package vibelangfmt

import (
	"strings"
	"testing"
)

func TestFormatTaggedCatch(t *testing.T) {
	cases := []struct {
		name   string
		source string
		want   []string
	}{
		{
			name:   "single-line-no-semi",
			source: "export effect function f() {\n  const user = users.find(id) catch { when UserNotFound: guest }\n  return user\n}\n",
			want:   []string{"users.find(id) catch { when UserNotFound: guest }"},
		},
		{
			name: "multi-arm-comma-effect",
			source: `export effect function f() {
  const val = fetchItem(id) catch {
    when NotFound: "missing";
    when RateLimited(let e): try sleep(e.retryAfter), "retry";
  }
  return val
}
`,
			want: []string{
				`when NotFound: "missing";`,
				`when RateLimited(let e): try sleep(e.retryAfter), "retry";`,
			},
		},
		{
			name: "with-default",
			source: `export effect function f() {
  return load() catch {
    when NotFound: "missing";
    default: "fallback";
  }
}
`,
			want: []string{`when NotFound: "missing";`, `default: "fallback";`},
		},
	}
	identity := func(text string) (string, error) { return text, nil }
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Format("catch.vibe", tc.source, identity)
			if err != nil {
				t.Fatal(err)
			}
			for _, w := range tc.want {
				if !strings.Contains(got, w) {
					t.Fatalf("formatted output missing %q:\n%s", w, got)
				}
			}
			again, err := Format("catch.vibe", got, identity)
			if err != nil || again != got {
				t.Fatalf("format not idempotent: %v\n%s\n%s", err, got, again)
			}
		})
	}
}
