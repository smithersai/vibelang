package vibelang

import (
	"strings"
	"testing"
)

// A head runs before its catch is installed (VIP-5), so a catch head written
// for the earlier boundary loses the recovery of its own run. A head valued
// never or any passes the operand test, so nothing else reports it. --fix
// keeps the earlier boundary: a direct try loses its try, and another head
// moves into an effect block.
func TestCatchUnrunHeadPreservingFix(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"try-call", "export effect function main(){return (try Effect.fail(\"outer\")) catch ()=>9}\n",
			"return (Effect.fail(\"outer\")) catch ()=>9"},
		{"try-effect-block", `error Pending
declare const describe: Effect.Effect<void, { _tag: "NotFound" }>
export effect function poll() {
  return (try effect {
    try describe
    return throw new Pending()
  }) catch effect (e) => match (e) {
    when { _tag: "NotFound" }: 0;
    default: throw e;
  }
}
`, "  return (effect {\n    try describe\n    return throw new Pending()\n  }) catch effect (e)"},
		{"try-retry-pipeline", `declare const describe: Effect.Effect<void, { _tag: "ResourceNotFoundException" }>
export const waitDeleted = effect () =>
  (try (effect {
    try describe
    throw { _tag: "StillExists" as const }
  }
    |> Effect.retry(%, { while: (e: { _tag: string }) => e._tag === "StillExists", times: 1 }))) catch effect (e) => match (e) { when { _tag: "ResourceNotFoundException" }: (undefined as void); default: throw e; }
`, "  ((effect {\n    try describe"},
		{"try-identifier", "declare const poll: Effect.Effect<never, \"gone\">\nexport effect function main(){return (try poll) catch ()=>9}\n",
			"return (poll) catch ()=>9"},
		{"any-value", `declare const read: Effect.Effect<{ doc: string }, { _tag: "NoSuchEntity" }>
declare const parse: (text: string) => any
export effect function policy() {
  return (parse((try read).doc)) catch () => undefined
}
`, "(effect { return (parse((try read).doc)) }) catch"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, result := fixedPipe(t, test.source)
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			if !strings.Contains(got, test.want) {
				t.Fatalf("missing preserved boundary %q (remaining: %+v; sites: %+v):\n%s", test.want, result.Remaining, result.Sites, got)
			}
			if errors := errorsOf(t, got); len(errors) != 0 {
				t.Fatalf("fixed source has errors: %v\n%s", errors, got)
			}
			again, result := fixedPipe(t, got)
			if result.Err != nil || again != got {
				t.Fatalf("fix not idempotent: %v\n%s\n%s", result.Err, got, again)
			}
		})
	}
}

// A head that cannot fail has no recovery to move, and a head whose value
// may be an Effect is caught as written: chapter 2's (try x) catch h catches
// the Effect x succeeds with, and removing its try would catch x's run and
// return that Effect unrun.
func TestCatchHeadKeepsTry(t *testing.T) {
	for _, test := range []struct{ name, source string }{
		{"cannot-fail", "export effect function main(){return (try Effect.never) catch ()=>9}\n"},
		{"effect-valued-identifier", "declare const nested: Effect.Effect<Effect.Effect<number, string>, string>\nexport effect function main(){return (try nested) catch ()=>7}\n"},
		{"effect-valued-call", "declare const make: () => Effect.Effect<Effect.Effect<number, string>, string>\nexport effect function main(){return (try make()) catch ()=>7}\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, result := fixedPipe(t, test.source)
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			if !strings.Contains(got, "(try ") || strings.Contains(got, "effect { return") {
				t.Fatalf("the try head changed:\n%s", got)
			}
		})
	}
}
