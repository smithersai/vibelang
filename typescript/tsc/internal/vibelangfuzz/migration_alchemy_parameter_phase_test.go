package vibelangfuzz

// Extend the existing migration phase oracle: the observer stays TypeScript,
// and only the generator factory migrates. Mutation between construction and
// repeated executions makes eager destructuring and shared rest arrays visible.
func init() {
	factory := `import { Effect } from "effect"
export const make = Effect.fn(function* ({news, output}: {news:string; output:boolean}) {
  return output ? news : undefined
})
`
	for _, output := range []string{"true", "false"} {
		body := `let current = "before"
const reads: string[] = []
const input = {get news() { reads.push("news:" + current); return current }, get output() { reads.push("output"); return ` + output + ` }}
const operation = Factory.make(input)
const before = [...reads]
current = "after"
const first = yield* operation
current = "again"
const second = yield* operation
return [before, reads, first, second, Factory.make.length]
`
		migrationFactoryBindingPrograms = append(migrationFactoryBindingPrograms, struct{ key, factory, body string }{"alchemy-fn-getter-" + output, factory, body})
		contextual := `import { Effect } from "effect"
interface Provider { diff(input: {news:string;output:boolean}): Effect.Effect<string | undefined> }
const provider: Provider = { diff: Effect.fn(function* ({news, output}) { return output ? news : undefined }) }
export const make = provider.diff
`
		migrationFactoryBindingPrograms = append(migrationFactoryBindingPrograms, struct{ key, factory, body string }{"alchemy-fn-context-getter-" + output, contextual, body})

	}
	migrationFactoryBindingPrograms = append(migrationFactoryBindingPrograms, struct{ key, factory, body string }{
		"alchemy-fn-rest-repeated",
		`import { Effect } from "effect"
export const make = Effect.fn(function* ({news}: {news:string}, ...suffixes:string[]) {
  suffixes.push(news)
  return suffixes.join(":")
})
`,
		`const input = {news:"before"}
const operation = Factory.make(input, "prefix")
input.news = "after"
const first = yield* operation
const second = yield* operation
return [first, second, Factory.make.length]
`,
	})
	for _, factory := range []struct{ key, source string }{
		{"named-default", "export const make = Effect.fn(function* ({news}: {news:string}, suffix:string = news) { return news+suffix })"},
		{"label-capture", "const args_0 = \"outer:\"; export const make = Effect.fn(function* ({news}: {news:string}) { return args_0+news })"},
	} {
		migrationFactoryBindingPrograms = append(migrationFactoryBindingPrograms, struct{ key, factory, body string }{
			"alchemy-fn-" + factory.key,
			"import { Effect } from \"effect\"\n" + factory.source + "\n",
			`const input={news:"before"}
const operation=Factory.make(input)
input.news="after"
const first=yield* operation
input.news="again"
const second=yield* operation
return [first,second,Factory.make.length]
`,
		})
	}

}
