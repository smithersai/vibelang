package vibelang

import (
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// VIP-58 (Capabilities): a task's static readonly tier defaults to "sealed"
// when omitted, which claims its result is reproducible. A task whose body
// requires HttpClient or ChildProcessSpawner reaches the network or spawns
// processes, so omitting tier is reported as warning EK5801.

// EK5801: a task whose body requires HttpClient or ChildProcessSpawner declares no tier (VIP-58).
// {0} is the task name, {1} is the required service(s).
var EK5801 = message(5801, warningCategory, "Task {0} requires {1} and declares no `tier`, so it defaults to `\"sealed\"`. Declare `static readonly tier` as `\"sealed\"`, `\"compensable\"`, or `\"irreversible\"`.")

func init() {
	registerDiagnostic(EK5801)
	fileChecks = append(fileChecks, checkDurableCapabilities)
}

// checkDurableCapabilities reports EK5801 on any task whose body requires
// HttpClient or ChildProcessSpawner without declaring static readonly tier.
func checkDurableCapabilities(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) || !builtinsOn(c, file) { // EK3013 gates them (experimental_gate.go)
		return
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if durableKind(node) == "task" && len(node.Arguments()) >= 4 {
			checkTaskMissingTier(c, node)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// checkTaskMissingTier inspects a $task call with an implementation body and
// warns with EK5801 when it requires HttpClient or ChildProcessSpawner without
// an explicit static readonly tier.
func checkTaskMissingTier(c *checker.Checker, call *ast.Node) {
	if hasDeclaredTier(call.Arguments()[1]) {
		return
	}
	needed := runnerRequirements(c, c.GetTypeAtLocation(call.Arguments()[3]))
	if needed == nil || needed.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown) != 0 {
		return
	}
	var services []string
	for _, service := range unionMembers(needed) {
		if name := missingTierServiceName(c, service); name != "" && !slices.Contains(services, name) {
			services = append(services, name)
		}
	}
	if len(services) == 0 {
		return
	}
	slices.SortFunc(services, func(a, b string) int {
		return tierServiceOrder(a) - tierServiceOrder(b)
	})
	taskName := "task"
	if tag := call.Arguments()[0]; ast.IsStringLiteral(tag) {
		taskName = tag.Text()
	}
	report(c, call.Arguments()[0], EK5801, taskName, joinServiceNames(services))
}

// hasDeclaredTier reports whether options, the object literal of static
// readonly members on a task, declares a non-undefined tier.
func hasDeclaredTier(options *ast.Node) bool {
	if !ast.IsObjectLiteralExpression(options) {
		return false
	}
	for _, property := range options.AsObjectLiteralExpression().Properties.Nodes {
		if !ast.IsPropertyAssignment(property) || property.Name() == nil {
			continue
		}
		if ast.GetTextOfPropertyName(property.Name()) != "tier" {
			continue
		}
		init := ast.SkipParentheses(property.Initializer())
		if init != nil && ast.IsIdentifier(init) && init.Text() == "undefined" {
			return false
		}
		return true
	}
	return false
}

// missingTierServiceName returns the display name of service when it is
// Effect's HttpClient or ChildProcessSpawner (or Experimental.ChildProcess),
// or "" for any other service (including user-defined services of the same name).
func missingTierServiceName(c *checker.Checker, service *checker.Type) string {
	if service == nil {
		return ""
	}
	symbol := service.Symbol()
	if symbol == nil || len(symbol.Declarations()) == 0 {
		return ""
	}
	file := ast.GetSourceFileOfNode(symbol.Declarations()[0])
	if file == nil {
		return ""
	}
	name := symbol.Name()
	switch pkg := packageOf(c, file); {
	case pkg == "effect" || strings.HasPrefix(pkg, "@effect/"):
		if name == "HttpClient" || name == "ChildProcessSpawner" {
			return name
		}
	case pkg == runtimeModule && strings.Contains(string(file.FileName()), "/experimental/"):
		if name == "ChildProcess" {
			return "Experimental.ChildProcess"
		}
	}
	return ""
}

func tierServiceOrder(name string) int {
	switch name {
	case "HttpClient":
		return 0
	case "ChildProcessSpawner":
		return 1
	case "Experimental.ChildProcess":
		return 2
	default:
		return 3
	}
}

func joinServiceNames(names []string) string {
	switch len(names) {
	case 0:
		return ""
	case 1:
		return names[0]
	case 2:
		return names[0] + " and " + names[1]
	default:
		return strings.Join(names[:len(names)-1], ", ") + " and " + names[len(names)-1]
	}
}
