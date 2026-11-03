package vibelang

import (
	"strings"
	"testing"
)

// A match arm is a source expression even when its parser representation is a
// return or expression statement. Removing the synthetic statement erases the
// required arm value (Alchemy's effect catch handlers, EK4834/TS1109).
func TestFixVoidMatchArms(t *testing.T) {
	for _, tc := range []struct{ name, source, want string }{
		{"catch-when", "error NF { id: string }\ndeclare const op: () => string!NF\nexport const b = effect () => {\n  op() catch effect (e) => match (e) {\n    when { _tag: \"NF\" }: try Effect.void;\n    default: throw e;\n  }\n}\n", "when { _tag: \"NF\" }: (undefined as void);"},
		{"match-statement", "export effect function f(n: boolean): void!! {\n  match (n) { when true: try Effect.void; default: try Effect.void; }\n}\n", "when true: (undefined as void); default: (undefined as void);"},
		{"match-return", "export effect function f(n: boolean): void!! {\n  return match (n) { when true: try Effect.void; default: try Effect.void; }\n}\n", "when true: (undefined as void); default: (undefined as void);"},
		{"inferred-union", "export const f = effect (n: boolean) => match (n) { when true: try Effect.void; default: \"ok\"; }\n", "when true: (undefined as void);"},
		{"undefined-program", "export effect function f(n: boolean): void!! {\n  return match (n) { when true: try Effect.undefined; default: try Effect.undefined; }\n}\n", "when true: undefined; default: undefined;"},
		{"import-alias", "import * as E from \"effect/Effect\"\nexport effect function f(n: boolean): void!! {\n  return match (n) { when true: try E.void; default: try E.undefined; }\n}\n", "when true: (undefined as void); default: undefined;"},
		{"shadowed-undefined", "export effect function f(n: boolean, undefined: number): void!! {\n  return match (n) { when true: try Effect.void; default: try Effect.undefined; }\n}\n", "when true: ((void 0) as void); default: (void 0);"},
		{"inline-comment", "export effect function f(n: boolean): void!! {\n return match (n) { when true: try Effect /* keep operand */ .void; default: try Effect.void; }\n}\n", "when true: try Effect /* keep operand */ .void;"},
		{"evaluated-receiver", "let reads = 0\nfunction read() { reads++; return Effect }\nexport effect function f(n: boolean): void!! {\n return match (n) { when true: try read().void; default: try Effect.void; }\n}\n", "when true: try read().void;"},
		{"arm-comment", "export effect function f(n: boolean): void!! {\n  return match (n) { when true: /* keep arm */ try Effect.void; default: try Effect.void; }\n}\n", "when true: /* keep arm */ (undefined as void); default: (undefined as void);"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, result := fixedPipe(t, tc.source)
			if result.Err != nil || len(result.Refused) != 0 || !strings.Contains(got, tc.want) {
				t.Fatalf("safe arm rewrite missing: error=%v refused=%+v\n%s\nwant %q", result.Err, result.Refused, got, tc.want)
			}
			if again, next := fixedPipe(t, got); again != got || len(next.Refused) != 0 {
				t.Fatalf("not idempotent: %s\nthen %s; refused=%+v", got, again, next.Refused)
			}
		})
	}
}
