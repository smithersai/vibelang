package vibelang

import (
	"strings"
	"testing"
)

func TestFixVIPForkWithOptionsInMarkedOwner(t *testing.T) {
	prelude := "import { Effect } from \"effect\"\n\nconst call = effect (n: number): number!! => n + 1\n\n"
	for _, test := range []struct{ name, body, want string }{
		{"initializer", "const pending = fork(call(1), { startImmediately: true })\n  return join pending", "const pending = try Effect.forkChild(call(1), { startImmediately: true })\n  return join pending"},
		{"statement", "fork(call(1), { startImmediately: true })\n  return 0", "try Effect.forkChild(call(1), { startImmediately: true })\n  return 0"},
		{"member", "return fork(call(1), { startImmediately: true }).id", "return (try Effect.forkChild(call(1), { startImmediately: true })).id"},
		{"comments", "const pending = fork(/* program */ call(1), /* options */ { startImmediately: true })\n  return join pending", "const pending = try Effect.forkChild(/* program */ call(1), /* options */ { startImmediately: true })\n  return join pending"},
		{"no options", "const pending = fork(call(1))\n  return join pending", "const pending = fork(call(1))\n  return join pending"},
		{"comma program", "const pending = fork (call(1), call(2))\n  return join pending", "const pending = fork (call(1), call(2))\n  return join pending"},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := prelude + "export const go = effect () => {\n  " + test.body + "\n}\n"
			result, got := fixVIPForkSource(t, source)
			want := prelude + "export const go = effect () => {\n  " + test.want + "\n}\n"
			if got != want || (test.name != "comma program" && len(result.Refused) != 0) {
				t.Fatalf("got\n%s\nwant\n%s\nrefused %+v", got, want, result.Refused)
			}
			if strings.Contains(got, "forkChild(try call") {
				t.Fatalf("ran the held operand: %s", got)
			}
		})
	}
}
