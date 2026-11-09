package vibelangfuzz

const platformWrapperInputsQuote = "Explicit `sync` inputs stay evaluated at the original call site, in order; the callback still runs only when its Effect runs."

var platformWrapperInputBodies = map[string]string{
	"restore":    "if (value === undefined) delete process.env.COMPLETE; else process.env.COMPLETE = value",
	"write":      "process.env.COMPLETE = value",
	"delete":     "delete process.env.COMPLETE",
	"two-writes": "process.env.COMPLETE = value; process.env.SECOND = value",
}
