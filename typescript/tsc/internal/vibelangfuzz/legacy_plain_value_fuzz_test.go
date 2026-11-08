package vibelangfuzz

import ()

var legacyPlainOperators = map[string]string{
	"catchTag-topic": "export function g(p: string!Boom): string!! {\n  return p |> Effect.catchTag(%, \"Boom\", HANDLER)\n}\n",
	"catchTag-first": "export const g = (p: string!Boom): string!! => Effect.catchTag(p, \"Boom\", HANDLER)\n",
	"catch-first":    "export const g = (p: string!Boom): string!! => Effect.catch(p, HANDLER)\n",
	"flatMap-first":  "export const g = (p: Boom!!): string!! => Effect.flatMap(p, HANDLER)\n",
}

var legacyPlainHandlers = map[string]string{
	"member":   "(caught) => caught.message",
	"template": "(caught) => `b:${caught.message}`",
	"literal":  "() => \"fallback\"",
	"block":    "(caught) => {\n    return caught.message\n  }",
}

const legacyPlainHandlerHelpers = `import { Effect } from "effect"

class Boom extends Error {
  readonly _tag = "Boom"
}

`
