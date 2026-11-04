package vibelang

import (
	"strings"
	"testing"
)

// Minimized from t3code desktopCliCommand and desktopNetworkAccess.
func TestFixT3CodeSchemaError(t *testing.T) {
	for _, tc := range []struct{ name, fields, body string }{
		{"getter", "", "override get message(): string { return \"The t3 command is unavailable.\" }"},
		{"defect getter", "cause: Schema.Defect(),", "override get message(): string { return \"Failed to load.\" }"},
		{"getter comment", "reason: Schema.String,", "// IPC preserves only the message.\n override get message(): string { return this.reason }\n // closing member comment\n"},
		{"empty body comment", "", "/* keep the empty body explanation */"},
		{"comment before comma", "reason: Schema.String /* before comma */, cause: Schema.Defect() // after last field\n", ""},
		{"comments", "// explain the reason\n reason: Schema.String, // keep this too\n /* cause */ cause: Schema.Defect(),\n // closing explanation\n", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "import * as Schema from \"effect/Schema\"\nexport class Failed extends Schema.TaggedError<Failed>()(\"Failed\", {\n" + tc.fields + "\n}) { " + tc.body + " }\n"
			got, result := fixedPipe(t, source)
			if !strings.Contains(got, "schema error Failed") {
				t.Fatalf("schema error was not written:\n%s\nrefusals: %+v", got, result.Refused)
			}
			for _, text := range append(strings.Split(tc.body, "\n"), "// explain the reason", "// keep this too", "/* cause */", "// closing explanation") {
				text = strings.TrimSpace(text)
				if strings.Contains(source, text) && !strings.Contains(got, text) {
					t.Fatalf("lost %q:\n%s", text, got)
				}
			}
		})
	}
}

// Chapter 3 rejects static members; chapter 6 explicitly keeps optionalKey
// native without exactOptionalPropertyTypes. No spread Field is defined.
func TestFixT3CodeSchemaErrorUnsupported(t *testing.T) {
	for _, tc := range []struct{ name, prefix, fields, body string }{
		{"spread", "const fields = { reason: Schema.String }\n", "...fields", ""},
		{"optional key", "", "reason: Schema.optionalKey(Schema.String)", ""},
		{"static tag", "", "", "static readonly _tag = \"Failed\""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "import * as Schema from \"effect/Schema\"\n" + tc.prefix + "export class Failed extends Schema.TaggedError<Failed>()(\"Failed\", {" + tc.fields + "}) {" + tc.body + "}\n"
			got, result := fixedPipe(t, source)
			if !strings.Contains(got, "class Failed extends Schema.TaggedError") || !strings.Contains(got, tc.fields) || !strings.Contains(got, tc.body) {
				t.Fatalf("unsupported declaration changed:\n%s\n%+v", got, result.Refused)
			}
		})
	}
}

// The getter/EK1101 association in the t3code report was provisional.
// Preserve the original multiline class and a following generator as a control.
func TestFixT3CodeOriginalGetter(t *testing.T) {
	source := `import * as Schema from "effect/Schema"
import * as Effect from "effect/Effect"
class DesktopCliCommandLoadError extends Schema.TaggedError<DesktopCliCommandLoadError>()(
  "DesktopCliCommandLoadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to load the t3 command state.";
  }
}
export const load = Effect.fn("loadDesktopCliCommandState")(function* () {
  return yield* Effect.fail(new DesktopCliCommandLoadError({ cause: "offline" }));
});
`
	got, result := fixedPipe(t, source)
	if !strings.Contains(got, "schema error DesktopCliCommandLoadError") || strings.Contains(got, "function*") {
		t.Fatalf("original getter shape refused: %+v\n%s", result.Refused, got)
	}
}

func TestFixT3CodeSchemaErrorUnattachedJSDoc(t *testing.T) {
	for _, fields := range []string{"cause: Schema.Defect()", "reason: Schema.String", "reason: Schema.String, /** trailing */"} {
		body := " /** context */\n"
		if strings.Contains(fields, "/**") {
			body = "\n"
		}
		source := "import * as Schema from \"effect/Schema\"\nexport class Failed extends Schema.TaggedError<Failed>()(\"Failed\", {" + fields + "}) {" + body + " override get message(): string { return \"Unavailable.\" } }\n"
		got, result := fixedPipe(t, source)
		if strings.Contains(got, "schema error Failed") {
			t.Fatalf("JSDoc gained an attachment: %+v\n%s", result.Refused, got)
		}
		found := false
		for _, site := range result.Sites {
			if site.Code == "EK4837" && strings.Contains(site.Reason, "JSDoc") {
				found = true
			}
		}
		if !found {
			t.Fatalf("missing JSDoc refusal: %+v", result.Sites)
		}
	}
}
