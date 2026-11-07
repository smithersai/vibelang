import { Effect } from "effect"
import { greet } from "./greet.vibe"
import source from "./greet.vibe?raw"

document.querySelector("#code")!.textContent = source
Effect.runPromise(greet("Ada")).then(message => {
  document.querySelector("#result")!.textContent = message
})
