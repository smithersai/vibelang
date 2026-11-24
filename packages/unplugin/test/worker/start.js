// The bundle's entry: prints the answer the worker pool computes.
import { main } from "./main.vibe"
import { Effect } from "effect"

Effect.runPromise(main()).then((summary) => console.log(JSON.stringify(summary)))
