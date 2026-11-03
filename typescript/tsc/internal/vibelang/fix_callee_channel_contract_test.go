package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

const calleeChannelFixHead = `import { Effect } from "effect"
class ApiError extends Error { readonly _tag = "ApiError"; readonly status = 503 }
declare const hostname: () => Effect.Effect<string | undefined, Error | ApiError>
const quiet = effect (n: number) => n
export const program = effect (n: number) => { try quiet(n); try hostname() }
`

func TestCalleeChannelContractFix(t *testing.T) {
	for _, test := range []struct{ name, call string }{
		{"data-first", `Effect.catchTag(program(1), "ApiError", (e) => Effect.succeed(e.status))`},
		{"pipe", `program(1).pipe(Effect.catchTag("ApiError", (e) => Effect.succeed(e.status)))`},
	} {
		t.Run(test.name, func(t *testing.T) {
			for _, options := range []FixOptions{{}, {MigrationOnly: true}, {VIPOnly: true}} {
				source := calleeChannelFixHead + "export const recovered = " + test.call + "\n"
				if len(errorsOf(t, source)) == 0 {
					t.Fatal("the unannotated reduced channel must reject the legacy tagged catch")
				}
				p, file, _, _ := editorProgram(t, source)
				fixed := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), options)
				text := source
				if f := fixed.Files[file.FileName()]; f != nil {
					text = f.Text
				}
				if !strings.Contains(text, "program = effect (n: number):") || text == source || !strings.Contains(text, "=> { try quiet(n); try hostname() }") {
					t.Fatalf("missing preserving contract or changed body:\n%s", text)
				}
				if ds := errorsOf(t, text); len(ds) != 0 {
					t.Fatalf("preserved contract does not compile: %v\n%s", ds, text)
				}
				next, nextFile, _, _ := editorProgram(t, text)
				again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), next.CommandLine(), options)
				if f := again.Files[nextFile.FileName()]; f != nil && f.Text != text {
					t.Fatalf("second --fix changes the preserved contract:\n%s", f.Text)
				}
			}
		})
	}
}

func TestCalleeChannelContractFixLeavesInference(t *testing.T) {
	for _, source := range []string{
		calleeChannelFixHead,
		strings.Replace(calleeChannelFixHead, "const quiet = effect (n: number) => n", "const quiet = (n: number) => Effect.succeed(n)", 1) + `export const recovered = Effect.catchTag(program(1), "ApiError", (e) => Effect.succeed(e.status))`,
		strings.Replace(calleeChannelFixHead, "try quiet(n); try hostname()", "try quiet(n); try Effect.succeed(n); try hostname()", 1) + `export const recovered = Effect.catchTag(program(1), "ApiError", (e) => Effect.succeed(e.status))`,
		strings.Replace(calleeChannelFixHead, "export const program = effect (n: number) => { try quiet(n); try hostname() }", "export effect function program(n: number): void!Error!;\nexport effect function program(n: number) { try quiet(n); try hostname() }", 1) + `export const recovered = Effect.catchTag(program(1), "ApiError", (e) => Effect.succeed(e.status))`,
		calleeChannelFixHead + `export const recovered = Effect.catchTag("ApiError", (e) => Effect.succeed(e.status))(program(1))`,
		calleeChannelFixHead + `export const bad = Effect.catchTag(program(1), "Unrelated", () => Effect.succeed(0))`,
		strings.Replace(calleeChannelFixHead, "try quiet(n); ", "", 1) + `export const recovered = Effect.catchTag(program(1), "ApiError", (e) => Effect.succeed(e.status))`,
	} {
		p, file, _, _ := editorProgram(t, source)
		proposal := calleeChannelContractFixes(t.Context(), p, file, map[string]bool{})
		if len(proposal.fixes) != 0 {
			t.Fatalf("unrelated source was annotated:\n%s", source)
		}
	}
}
