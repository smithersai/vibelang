package vibelangfuzz

// Chapter 003, Quick fixes: "move the code to a .ts file"; "An exported function of a published package
// offers the .ts fix first, because effect changes its declaration." The generator varies declaration kind,
// captured cells, publication status and filename collisions. A safe move preserves the exact TypeScript body,
// creates without overwriting, keeps the local binding/re-export, and removes EK0401 without new errors.
var nothrowMoveQuotes = []string{
	"or move the code to a `.ts` file.",
	"make the function `effect`, so `throw` is `Effect.fail`",
	"An exported function of a published package offers the `.ts` fix first, because `effect` changes its declaration.",
}
