package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestTaggedCatchTypingAndNarrowing(t *testing.T) {
	packages := map[string]string{
		"effect":           "packages/runtime/node_modules/effect",
		"vibelang-runtime": "packages/runtime",
	}
	opts := `{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[]}`
	source := `
error UserNotFound { id: string }
error RateLimited { retryAfter: number }
error DbDown

effect function find(id: string): string!(UserNotFound | RateLimited | DbDown) {
  if (id === "missing") throw new UserNotFound({ id })
  if (id === "slow") throw new RateLimited({ retryAfter: 1 })
  if (id === "down") throw new DbDown()
  return "ok:" + id
}

effect function wait(ms: number): void!! {
  try Effect.succeed(ms)
}

// Single arm, no trailing semicolon; residual E narrows to RateLimited | DbDown.
export effect function single(id: string): string!(RateLimited | DbDown) {
  return find(id) catch { when UserNotFound: "guest" }
}

// Multi-arm with extractor binding and effectful comma arm; residual E narrows to DbDown.
export effect function multi(id: string): string!DbDown {
  return find(id) catch {
    when UserNotFound: "missing";
    when RateLimited(let e): try wait(e.retryAfter), "retry";
  }
}

// Exhaustive tagged catch narrows E to never.
export effect function allHandled(id: string): string!! {
  return find(id) catch {
    when UserNotFound: "missing";
    when RateLimited(let e): try wait(e.retryAfter), "retry";
    when DbDown: "offline";
  }
}

// Default arm handles remaining failures and narrows E to never.
export effect function withDefault(id: string): string!! {
  return find(id) catch {
    when UserNotFound: "missing";
    default: "fallback";
  }
}

// Object-tag pattern matching (e.g. AWS / third-party tagged errors).
export effect function byTag(id: string): string!(RateLimited | DbDown) {
  return find(id) catch {
    when { _tag: "UserNotFound", let id }: "missing:" + id;
  }
}
`
	program, file, _, _ := editorProgramAt(t, "main.vibe", opts, source, editorPackageJSON, packages)
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("unexpected diagnostic %s%d: %s", d.Source(), d.Code(), d.MessageText())
		}
	}
}

func TestTaggedCatchDiagnostics(t *testing.T) {
	packages := map[string]string{
		"effect":           "packages/runtime/node_modules/effect",
		"vibelang-runtime": "packages/runtime",
	}
	opts := `{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"types":[]}`
	cases := []struct {
		name   string
		source string
		want   int32
	}{
		{
			name: "unhandled-residual-error",
			source: `
error NotFound
error DbDown
effect function load(): string!(NotFound | DbDown) { throw new DbDown() }
export effect function strict(): string!! {
  return load() catch { when NotFound: "guest" }
}
`,
			want: 9201,
		},
		{
			name: "outside-effect-code",
			source: `
error NotFound
effect function load(): string!NotFound { throw new NotFound() }
export function plain() {
  return load() catch { when NotFound: "guest" }
}
`,
			want: 504,
		},
		{
			name: "object-literal-stays-ek0509",
			source: `
error NotFound
effect function load(): string!NotFound { throw new NotFound() }
export effect function bad() {
  return load() catch { a: 1 }
}
`,
			want: 509,
		},
		{
			name: "when-property-object-stays-ek0509",
			source: `
error NotFound
effect function load(): string!NotFound { throw new NotFound() }
export effect function bad() {
  return load() catch { when: 1 }
}
`,
			want: 509,
		},
		{
			name: "closed-handler-continuation-ek0512",
			source: `
error NotFound
effect function load(): number!NotFound { throw new NotFound() }
export effect function bad() {
  return load() catch { when NotFound: 1 } + 2
}
`,
			want: 512,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgramAt(t, "main.vibe", opts, tc.source, editorPackageJSON, packages)
			all := append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...)
			found := false
			for _, d := range all {
				if d.Source() == "EK" && d.Code() == tc.want {
					found = true
				}
			}
			if !found {
				t.Fatalf("expected EK%d, got %v", tc.want, all)
			}
		})
	}
}
