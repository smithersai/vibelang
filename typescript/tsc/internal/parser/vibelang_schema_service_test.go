package parser_test

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// rpcOptions returns the option names of each Rpc.make call of group, a
// schema service's Rpc group class, by the Rpc's tag.
func rpcOptions(t *testing.T, group *ast.Node) (tags []string, options map[string][]string, payloads map[string][]string) {
	t.Helper()
	options, payloads = map[string][]string{}, map[string][]string{}
	call := parser.SchemaServiceGroupCall(group)
	if call == nil {
		t.Fatal("the group extends RpcGroup.make(…)")
	}
	for _, rpc := range call.Arguments() {
		if !ast.IsCallExpression(rpc) || rpc.Expression().Expression().Text() != "Rpc" || rpc.Expression().Name().Text() != "make" ||
			rpc.Expression().Expression().Flags&ast.NodeFlagsVibeLangIntrinsic == 0 {
			t.Fatal("each argument is a call of the intrinsic Rpc.make")
		}
		tag := rpc.Arguments()[0].Text()
		tags = append(tags, tag)
		for _, option := range rpc.Arguments()[1].AsObjectLiteralExpression().Properties.Nodes {
			options[tag] = append(options[tag], option.Name().Text())
			if option.Name().Text() == "payload" {
				payloads[tag] = []string{}
				for _, field := range option.Initializer().AsObjectLiteralExpression().Properties.Nodes {
					payloads[tag] = append(payloads[tag], field.Name().Text())
				}
			}
		}
	}
	return tags, options, payloads
}

// TestSchemaServiceParsesAsServiceAndGroup pins VIP-57's tree: the statement
// list holds the Rpc group class, then the service, which parses exactly as
// service does.
func TestSchemaServiceParsesAsServiceAndGroup(t *testing.T) {
	t.Parallel()
	source := `export schema service Stats {
  summarize(values: readonly number[]): Summary!EmptySample
  count(values: readonly number[], floor?: number): number!!
  ticks(upTo: number): Stream<number, EmptySample>
  reset(): void!!
}
const after = 1
`
	file := parseVibe(t, source)
	if diagnostics := file.Diagnostics(); len(diagnostics) != 0 {
		t.Fatalf("unexpected diagnostics: %v", diagnostics[0].String())
	}
	statements := file.Statements.Nodes
	if len(statements) != 3 {
		t.Fatalf("got %d statements, want the group, the service, and const after", len(statements))
	}
	group, service := statements[0], statements[1]
	if !parser.IsSchemaServiceGroup(group) || group.Name().Text() != "StatsRpcs" || group.Flags&ast.NodeFlagsReparsed == 0 {
		t.Fatalf("first statement is %v, want the synthesized class StatsRpcs", group.Kind)
	}
	if !ast.IsClassDeclaration(service) || service.Name().Text() != "Stats" || !ast.HasSyntacticModifier(service, ast.ModifierFlagsAbstract) || parser.IsSchemaServiceGroup(service) {
		t.Fatal("second statement is the service Stats, the abstract class a service is")
	}
	if !ast.HasSyntacticModifier(group, ast.ModifierFlagsExport) || !ast.HasSyntacticModifier(service, ast.ModifierFlagsExport) {
		t.Fatal("export applies to both the service and its group")
	}
	if len(service.Members()) != 4 {
		t.Fatalf("the service keeps its %d members, want 4", len(service.Members()))
	}
	tags, options, payloads := rpcOptions(t, group)
	if want := []string{"summarize", "count", "ticks", "reset"}; !slices.Equal(tags, want) {
		t.Fatalf("Rpc tags are %v, want %v", tags, want)
	}
	for tag, want := range map[string][]string{
		"summarize": {"payload", "success", "error"},
		"count":     {"payload", "success"},
		"ticks":     {"payload", "success", "error", "stream"},
		"reset":     {"payload"},
	} {
		if !slices.Equal(options[tag], want) {
			t.Errorf("Rpc %s has options %v, want %v", tag, options[tag], want)
		}
	}
	for tag, want := range map[string][]string{"summarize": {"values"}, "count": {"values", "floor"}, "ticks": {"upTo"}, "reset": {}} {
		if !slices.Equal(payloads[tag], want) {
			t.Errorf("Rpc %s has payload fields %v, want %v", tag, payloads[tag], want)
		}
	}
	// An optional parameter is Schema.optional(…).
	count := parser.SchemaServiceGroupCall(group).Arguments()[1]
	floor := count.Arguments()[1].AsObjectLiteralExpression().Properties.Nodes[0].Initializer().AsObjectLiteralExpression().Properties.Nodes[1].Initializer()
	if !ast.IsCallExpression(floor) || floor.Expression().Name().Text() != "optional" {
		t.Error("an optional parameter's field is Schema.optional(…)")
	}
}

// TestSchemaServiceKeepsItsOwnTypes checks that the group's schemas are
// written from copies: every type node of the service still belongs to it.
func TestSchemaServiceKeepsItsOwnTypes(t *testing.T) {
	t.Parallel()
	file := parseVibe(t, "schema service Stats { summarize(values: Sample, limit?: \"a\" | \"b\"): Summary!EmptySample }\n")
	service := file.Statements.Nodes[1]
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		for parent := node; parent != service; parent = parent.Parent {
			if parent == nil || parent.Kind == ast.KindSourceFile {
				t.Fatalf("a %v node of the service is no longer under it", node.Kind)
			}
		}
		return node.ForEachChild(visit)
	}
	service.ForEachChild(visit)
}

// TestSchemaServiceMembersWithoutAnRpc checks the members the mapping cannot
// read: they stay members of the service, for the checker's EK5701, and get
// no Rpc.
func TestSchemaServiceMembersWithoutAnRpc(t *testing.T) {
	t.Parallel()
	source := `schema service Bad {
  readonly region: string
  find(id: string): Point!!
  find(id: number): Point!!
  pick<T>(value: T): T!!
  plain(id: string): string
  aliased(id: string): Later
  rest(...ids: string[]): number!!
  spread({ id }: { id: string }): number!!
  ok(id: string): Point!!
}
`
	file := parseVibe(t, source)
	if diagnostics := file.Diagnostics(); len(diagnostics) != 0 {
		t.Fatalf("unexpected diagnostics: %v", diagnostics[0].String())
	}
	tags, _, _ := rpcOptions(t, file.Statements.Nodes[0])
	if want := []string{"ok"}; !slices.Equal(tags, want) {
		t.Fatalf("Rpc tags are %v, want %v", tags, want)
	}
	if got := len(file.Statements.Nodes[1].Members()); got != 9 {
		t.Fatalf("the service keeps its %d members, want 9", got)
	}
}

// TestSchemaServiceTransportError checks that Effect's RpcClientError in an
// error type is left out of the wire schema: no server sends it.
func TestSchemaServiceTransportError(t *testing.T) {
	t.Parallel()
	file := parseVibe(t, `schema service Remote {
  only(id: string): number!RpcClientError
  both(id: string): number!(Missing | RpcClientError.RpcClientError)
  none(id: string): number!Missing
}
`)
	if diagnostics := file.Diagnostics(); len(diagnostics) != 0 {
		t.Fatalf("unexpected diagnostics: %v", diagnostics[0].String())
	}
	_, options, _ := rpcOptions(t, file.Statements.Nodes[0])
	if want := []string{"payload", "success"}; !slices.Equal(options["only"], want) {
		t.Errorf("only has options %v, want %v", options["only"], want)
	}
	for _, tag := range []string{"both", "none"} {
		if want := []string{"payload", "success", "error"}; !slices.Equal(options[tag], want) {
			t.Errorf("%s has options %v, want %v", tag, options[tag], want)
		}
	}
	both := parser.SchemaServiceGroupCall(file.Statements.Nodes[0]).Arguments()[1].Arguments()[1].AsObjectLiteralExpression().Properties.Nodes[2].Initializer()
	if !ast.IsIdentifier(both) || both.Text() != "Missing" {
		t.Errorf("both's wire error is Missing alone, got %v", both.Kind)
	}
	declares := map[string]bool{}
	for _, member := range file.Statements.Nodes[1].Members() {
		_, failure, _, ok := parser.SchemaServiceReturn(member.Type())
		if !ok {
			t.Fatalf("%s returns an Effect", member.Name().Text())
		}
		declares[member.Name().Text()] = parser.SchemaServiceDeclaresTransportError(failure)
	}
	if !declares["only"] || !declares["both"] || declares["none"] {
		t.Errorf("members that declare RpcClientError: %v", declares)
	}
}

// TestSchemaServiceLeavesOtherSpellings checks that service, a schema named
// service, and schema as an ordinary name parse as before, with no group.
func TestSchemaServiceLeavesOtherSpellings(t *testing.T) {
	t.Parallel()
	for _, source := range []string{
		"service Users { find(id: string): string!! }",
		"schema service { id: string }",
		"schema error Missing { id: string }",
		"let schema = 1\nschema = 2",
		"const service = 1\nconst schema = service",
		"schema\nservice\nUsers",
	} {
		file := parseVibe(t, source)
		for _, statement := range file.Statements.Nodes {
			if parser.IsSchemaServiceGroup(statement) {
				t.Errorf("%q: unexpected Rpc group", source)
			}
		}
	}
	// A whole-shape schema service has no members to read: its group is empty.
	file := parseVibe(t, "schema service Whole: { run(): void!! } {}")
	if group := file.Statements.Nodes[0]; !parser.IsSchemaServiceGroup(group) || len(parser.SchemaServiceGroupCall(group).Arguments()) != 0 {
		t.Error("schema service Name: Type has an empty Rpc group")
	}
}

// TestSchemaServiceSyntaxForm checks the recorded form: a service whose head
// starts at schema, so the formatter keeps both words.
func TestSchemaServiceSyntaxForm(t *testing.T) {
	t.Parallel()
	source := "export schema service Stats { ping(): void!! }\n"
	_, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
	for _, form := range forms {
		if form.Kind == parser.VibeSyntaxDeclaration && form.Name == "service" {
			if got := strings.TrimSpace(source[form.Head.Pos():form.Head.End()]); got != "schema service Stats" {
				t.Fatalf("the form's head is %q, want %q", got, "schema service Stats")
			}
			return
		}
	}
	t.Fatal("no service form recorded")
}
