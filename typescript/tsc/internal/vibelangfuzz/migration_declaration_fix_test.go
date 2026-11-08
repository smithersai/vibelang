package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const migrationDeclarationFixTarget = "FuzzMigrationDeclarationFix"
const migrationDeclarationFixQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

// These are minimized migration witnesses, not snapshots of today's compiler.
// Chapter 7 requires equality before and after a safe fix. Compare through the
// migration gate's canonicalization, including imports that assignability alone
// cannot distinguish. Runtime equivalence remains in FuzzVIPDifferential.
func migrationDeclarationWitnesses() map[string]string {
	return map[string]string{
		"t3code-unattached-getter-jsdoc":       "import * as Schema from \"effect/Schema\"\nexport class Failed extends Schema.TaggedError<Failed>()(\"Failed\", {\n/** context */\ncause: Schema.Defect(),\n}) { /** context */\noverride get message(): \"Unavailable.\" { return \"Unavailable.\" } }\n",
		"t3code-private-schema-error-getter":   "import * as Schema from \"effect/Schema\"\nclass Failed extends Schema.TaggedError<Failed>()(\"Failed\", { cause: Schema.Defect() }) {\n override get message(): string { return \"Unavailable.\" }\n}\nexport const failed = new Failed({ cause: \"offline\" })\n",
		"t3code-browser-import-getter-comment": "import * as Schema from \"effect/Schema\"\nexport class Failed extends Schema.TaggedError<Failed>()(\"Failed\", { reason: Schema.String }) {\n // IPC preserves only the message.\n override get message(): string { return this.reason }\n}\n",
		"t3code-schema-error-comments":         "import * as Schema from \"effect/Schema\"\nexport class Failed extends Schema.TaggedError<Failed>()(\"Failed\", {\n // reason\n reason: Schema.String, // keep\n /* cause */ cause: Schema.Defect()\n}) {}\n",
		"t3code-schema-error-getter":           "import * as Schema from \"effect/Schema\"\nexport class Failed extends Schema.TaggedError<Failed>()(\"Failed\", {}) { override get message(): string { return \"Unavailable.\" } }\n",
		"alchemy-conditional-alias":            "import * as DateTime from \"effect/DateTime\"\ntype NonNull<V> = V extends DateTime.Utc ? string : V\nexport type FieldFilter<V> = { eq: NonNull<V> }\n",
		"alchemy-metric-module":                "import * as Metric from \"effect/Metric\"\nexport interface Tracked<M extends Metric.Metric<number, any>> { readonly metric: M }\n",
		"opencode-type-modifier":               "import type { HttpClientResponse } from \"effect/http\"\nexport interface Options { readonly response: HttpClientResponse.HttpClientResponse }\n",
		"foldkit-type-only":                    "import type { Duration, Scope } from \"effect\"\nexport interface Options { readonly duration: Duration.Duration; readonly scope: Scope.Scope }\n",
		// EK4831 on an exported Context.Service class: alchemy's Domain
		// Correlation and Platform, and t3code's server services, which an
		// export list exports.
		"alchemy-domain-service-class":       "import * as Context from \"effect/Context\"\n/** The flow work belongs to. */\nexport class Correlation extends Context.Service<Correlation, { readonly id: string }>()(\n  \"alchemy/Domain/Correlation\",\n) {}\n",
		"alchemy-domain-service-class-lines": "import * as Context from \"effect/Context\"\nimport * as Effect from \"effect/Effect\"\nexport interface Kit { readonly name: string }\nexport class Platform extends Context.Service<\n  Platform,\n  {\n    readonly aggregate: (name: string, kit: Kit) => Effect.Effect<number>\n    readonly view: (name: string) => Effect.Effect<string>\n  }\n>()(\"alchemy/Domain/Platform\") {}\n",
		"t3code-server-service-export-list":  "import * as Context from \"effect/Context\"\nimport * as Effect from \"effect/Effect\"\nclass WorkspacePaths extends Context.Service<WorkspacePaths, { readonly root: string; resolve(path: string): Effect.Effect<string> }>()(\"t3/WorkspacePaths\") {}\nexport { WorkspacePaths }\n",
	}
}

// Vary import form, namespace alias, type operation and nesting. Every generated
// source is checked against the same preservation rule, rather than predicting
// which import the implementation decides is removable.
func migrationDeclarationVariants() []string {
	var sources []string
	for _, module := range []string{"DateTime", "Duration"} {
		member := "Utc"
		if module == "Duration" {
			member = "Duration"
		}
		for _, alias := range []string{module, "ClockValue"} {
			for _, typeOnly := range []bool{false, true} {
				kind := ""
				if typeOnly {
					kind = "type "
				}
				prefix := fmt.Sprintf("import %s* as %s from \"effect/%s\"\n", kind, alias, module)
				typ := alias + "." + member
				for _, body := range []string{
					"export type Result<V> = V extends " + typ + " ? true : false\n",
					"export type Result = keyof " + typ + "\n",
					"type Hidden<V> = V extends " + typ + " ? string : V\nexport interface Result<V> { readonly nested: { value: Hidden<V> } }\n",
				} {
					sources = append(sources, prefix+body)
				}
			}
		}
	}
	// Vary the t3code neighbourhood independently of import-only examples:
	// field shape, comment placement, and getter return annotation.
	for _, fields := range []string{"", "reason: Schema.String,", "cause: Schema.Defect(),"} {
		for _, comment := range []string{"// context\n", "/** context */\n"} {
			for _, result := range []string{"string", "\"Unavailable.\""} {
				sources = append(sources, "import * as Schema from \"effect/Schema\"\nexport class Failed extends Schema.TaggedError<Failed>()(\"Failed\", {\n"+comment+fields+"\n}) { "+comment+"override get message(): "+result+" { return \"Unavailable.\" } }\n")
			}
		}
	}
	for _, field := range []string{"cause: Schema.Defect()", "cause: Schema.Defect(), detail: Schema.optional(Schema.String)"} {
		for _, comment := range []string{"", "// IPC message\n"} {
			sources = append(sources, "import * as Schema from \"effect/Schema\"\nclass Failed extends Schema.TaggedError<Failed>()(\"Failed\", {"+field+"}) {\n"+comment+"override get message(): string { return \"Unavailable.\" }\n}\nexport const failed = new Failed({ cause: \"offline\" })\n")
		}
	}
	return sources
}

// EK4831 variants: every way a module exports a Context.Service class, by
// every member kind its written shape may hold. Chapter 7 holds each fix to
// the class's declaration output, whichever service form it writes.
func migrationServiceClassVariants() []string {
	var sources []string
	for _, export := range []struct{ modifier, list string }{
		{"export ", ""},
		{"", "export { Port }\n"},
		{"", "export { Port as Gate }\n"},
		{"", "export type { Port }\n"},
	} {
		for _, shape := range []string{
			"{ readonly value: string }",
			"{ value: number; readonly label: string }",
			"{ find(id: string): Effect.Effect<number> }",
			"{\n    readonly read: (id: string) => Effect.Effect<string>\n    count: number\n  }",
		} {
			sources = append(sources, "import * as Context from \"effect/Context\"\nimport * as Effect from \"effect/Effect\"\n/** A port. */\n"+
				export.modifier+"class Port extends Context.Service<Port, "+shape+">()(\"app/Port\") {}\n"+export.list)
		}
	}
	return sources
}

func TestMigrationDeclarationFixQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), migrationDeclarationFixQuote) {
		t.Fatalf("Chapter 7 no longer says %q; update the oracle", migrationDeclarationFixQuote)
	}
}
