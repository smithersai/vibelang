package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// fixProjectOf writes files, with effect installed, and runs --fix over them.
func fixProjectOf(t *testing.T, files map[string]string) *FixResult {
	t.Helper()
	dir := t.TempDir()
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "node_modules"), 0755); err != nil {
		t.Fatal(err)
	}
	for name, target := range map[string]string{"effect": "packages/runtime/node_modules/effect", "vibelang-runtime": "packages/runtime"} {
		if err := os.Symlink(filepath.Join(root, target), filepath.Join(dir, "node_modules", name)); err != nil {
			t.Fatal(err)
		}
	}
	var names []string
	for name := range files {
		names = append(names, `"`+name+`"`)
	}
	files["package.json"] = `{"type":"module"}`
	files["tsconfig.json"] = `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowImportingTsExtensions":true},"files":[` + strings.Join(names, ",") + `]}`
	for name, text := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 || len(config.Errors) != 0 {
		t.Fatalf("config: %v %v", errors, config.Errors)
	}
	return FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{})
}

// t3code's contracts: makeEntityId builds a schema, so --fix writes its plain
// return type (EK1001). A test elsewhere already fails to decode a struct of
// those ids for an unrelated reason, and the fix only makes that error's
// message name brand<…> where it named Effect<brand<…>>. The gate compared
// errors by message, so it read the rewritten message as a new error and
// refused the fix, which left every schema built from the helper an Effect.
func TestFixGateKeepsFixThatRewritesAnExistingErrorsMessage(t *testing.T) {
	const helper = "import * as Schema from \"effect/Schema\"\n" +
		"const makeThreadId = () => Schema.String.pipe(Schema.brand(\"ThreadId\"))\n" +
		"export const ThreadId = makeThreadId()\n"
	// The error the program reports before and after the fix, at one place.
	const user = "import { ThreadId } from \"./ids.vibe\"\n" +
		"export const count: number = ThreadId\n"
	result := fixProjectOf(t, map[string]string{"ids.vibe": helper, "user.vibe": user})
	if len(result.Refused) != 0 {
		t.Fatalf("--fix refused the helper's plain return type: %+v", result.Refused)
	}
	var fixed string
	for name, f := range result.Files {
		if strings.HasSuffix(name.AsString(), "ids.vibe") {
			fixed = f.Text
		}
	}
	if !strings.Contains(fixed, "const makeThreadId = (): ") {
		t.Fatalf("--fix did not keep makeThreadId plain:\n%s", fixed)
	}
}

// The same gate still refuses a fix whose program reports an error at a
// place that had none: the fixed helper's id is a string where user.vibe
// passes it to a function that takes an Effect.
func TestFixGateRefusesAnErrorAtANewPlace(t *testing.T) {
	const helper = "import * as Schema from \"effect/Schema\"\n" +
		"const makeThreadId = () => Schema.String.pipe(Schema.brand(\"ThreadId\"))\n" +
		"export const ThreadId = makeThreadId()\n"
	const user = "import { Effect } from \"effect\"\n" +
		"import { ThreadId } from \"./ids.vibe\"\n" +
		"const needsEffect = (e: Effect.Effect<unknown>): string => \"ok\"\n" +
		"export const used: string = needsEffect(ThreadId)\n"
	result := fixProjectOf(t, map[string]string{"ids.vibe": helper, "user.vibe": user})
	if len(result.Refused) == 0 {
		t.Fatalf("--fix wrote a fix that adds an error at a new place: %+v", result.Files)
	}
}

// fixedText returns the text --fix wrote for the file whose name ends in
// suffix, or "".
func fixedText(result *FixResult, suffix string) string {
	for name, f := range result.Files {
		if strings.HasSuffix(name.AsString(), suffix) {
			return f.Text
		}
	}
	return ""
}

// t3code's packages/shared/src/otelEnvironment.ts: a plain function calls two
// unannotated Config helpers, and EK9203 reports its first call. Annotating
// that helper's return type is right, and the edit moves the function's one EK9203, which
// now names the second call; the gate read it as a new error, refused the
// fix, and the module reverted (drive-t3code, inbox migrate-t3code.md,
// 2026-11-01T04:04Z, fix:sibling-diagnostic-refuses-fix).
func TestFixGateKeepsFixThatLeavesASiblingErrorAfterIt(t *testing.T) {
	const settings = "import * as Config from \"effect/Config\"\n" +
		"const endpoint = (name: string) => Config.String(name)\n" +
		"const protocol = (name: string) => Config.String(name)\n" +
		"export interface Settings { readonly endpoint: string; readonly protocol: string }\n" +
		"export const settings = (prefix: string): Config.Config<Settings> =>\n" +
		"  Config.all({ endpoint: endpoint(prefix + \"ENDPOINT\"), protocol: protocol(prefix + \"PROTOCOL\") })\n"
	result := fixProjectOf(t, map[string]string{"settings.vibe": settings})
	if len(result.Refused) != 0 {
		t.Fatalf("--fix refused a Config helper's annotation: %+v", result.Refused)
	}
	fixed := fixedText(result, "settings.vibe")
	// Each helper gets a return annotation, which makes it a plain factory.
	for _, helper := range []string{"const endpoint = (name: string): ", "const protocol = (name: string): "} {
		if !strings.Contains(fixed, helper) {
			t.Fatalf("--fix did not write %q:\n%s", helper, fixed)
		}
	}
}

// An edited file's error after the edit that lies where the file had none is
// still new: the fixed helper's id is a string where the same file passes it
// to a function that takes an Effect.
func TestFixGateRefusesAnErrorAfterTheEditAtANewPlace(t *testing.T) {
	const ids = "import { Effect } from \"effect\"\n" +
		"import * as Schema from \"effect/Schema\"\n" +
		"const makeThreadId = () => Schema.String.pipe(Schema.brand(\"ThreadId\"))\n" +
		"export const ThreadId = makeThreadId()\n" +
		"const needsEffect = (e: Effect.Effect<unknown>): string => \"ok\"\n" +
		"export const used: string = needsEffect(ThreadId)\n"
	result := fixProjectOf(t, map[string]string{"ids.vibe": ids})
	if len(result.Refused) == 0 {
		t.Fatalf("--fix wrote a fix that adds an error after it: %s", fixedText(result, "ids.vibe"))
	}
}
