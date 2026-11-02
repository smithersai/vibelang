package vibelangfuzz

import "strings"

// A narrow parent's incompatible tag already reports EK2117 under the old
// family rules. Extensible native parents distinguish that check from the
// Chapter 3 prohibition on the extends clause itself.
func failuresErrorFamilyCases() []*failCase {
	const quote = "| an `extends` clause, `error UserNotFound extends NotFound { … }`, in either error form | `EK2117` |"
	var cases []*failCase
	for _, form := range []struct {
		prefix string
		vip    int
	}{{"error", 13}, {"schema error", 29}} {
		for _, tag := range []struct{ name, text string }{
			{"string", `"Base" as string`},
			{"union", `"Base" as "Base" | "Child"`},
		} {
			for _, body := range []struct{ name, text string }{
				{"empty", "{}"},
				{"field", "{ value: number }"},
				{"optional", "{ value?: number }"},
				{"getter", "{ get label(): string { return this.id } }"},
			} {
				base := "class Base extends Data.TaggedError(" + tag.text + ")<{ readonly id: string }> {}"
				if form.prefix == "schema error" {
					base = "class Base extends Schema.TaggedError<Base>()(" + tag.text + ", { id: Schema.String }) {}"
				}
				name := strings.ReplaceAll(form.prefix, " ", "-") + "-extends-native-" + tag.name + "-" + body.name
				cases = append(cases, &failCase{
					Name: name, Quote: quote, VIP: form.vip, Owner: "impl-hunt-fail", Host: "none", Code: 2117,
					Decls: "import { Data, Schema } from \"effect\"\n" + base + "\nexport " + form.prefix + " Child ⟦extends Base⟧ " + body.text + "\n",
				})
			}
		}
	}
	return cases
}
