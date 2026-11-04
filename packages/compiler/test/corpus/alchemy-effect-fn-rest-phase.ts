import { Effect } from "effect"
export const withRest = Effect.fn(function* (
  { news }: { news: string },
  ...suffixes: string[]
) {
  suffixes.push(news)
  return suffixes.join(":")
})
