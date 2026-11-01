package vibelangfmt

import (
	"regexp"
	"testing"
)

// prefixParenSources hold try, fork and join operands of is, in and
// instanceof, written as a .ts file writes await: bare, and parenthesized
// where the author parenthesized them. smithers agent/fs Command.test.vibe:
// vibelang-format wrote expect((try exit(...)) is Exit.Failure) for
// expect(try exit(...) is Exit.Failure), a test edit a migration must not make.
var prefixParenSources = []string{
	"expect(try exit(CommandLine.lex(command)) is Exit.Failure).toBe(true)\n",
	"const failed = try exit(run()) instanceof Error\n",
	"const has = try lookup(key) in table\n",
	"const fiber = fork work() instanceof Fiber\n",
	"if (join fiber instanceof Done) use(fiber)\n",
	"const kept = (try exit(run())) instanceof Error\n",
	"const keptIs = (try exit(run())) is Exit.Failure\n",
	"const both = (try load()) in table && try load() instanceof Error\n",
}

// unaryBeforeRelational models dprint 0.55's TypeScript plugin, which writes
// (void x) in y and (void x) instanceof y for void x in y and void x
// instanceof y, and leaves await x in y as it is.
var unaryBeforeRelational = regexp.MustCompile(`\bvoid ([\w.]+(?:\([^()]*(?:\([^()]*\))?[^()]*\))?) (in|instanceof) `)

func dprintParenthesizesVoid(text string) (string, error) {
	return unaryBeforeRelational.ReplaceAllString(text, "(void $1) $2 "), nil
}

func TestFormatLeavesPrefixOperandsAsWritten(t *testing.T) {
	for _, source := range prefixParenSources {
		once, err := Format("prefix.vibe", source, dprintParenthesizesVoid)
		if err != nil {
			t.Fatalf("%v\nsource: %s", err, source)
		}
		if once != source {
			t.Errorf("the formatter changed the parentheses of a prefix operand:\n%s\nbecame:\n%s", source, once)
		}
	}
}

// The same sources through the dprint the formatter tests use, which is what
// Smithers' dprint fmt ran.
func TestFormatLeavesPrefixOperandsAsWrittenWithDprint(t *testing.T) {
	formatter := dprintFormatter(t)
	for _, source := range prefixParenSources {
		once, err := Format("prefix.vibe", source, formatter)
		if err != nil {
			t.Fatalf("%v\nsource: %s", err, source)
		}
		if once != source {
			t.Errorf("the formatter changed the parentheses of a prefix operand:\n%s\nbecame:\n%s", source, once)
		}
	}
}
