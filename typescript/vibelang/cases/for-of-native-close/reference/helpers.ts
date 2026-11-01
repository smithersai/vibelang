export function boom(error: unknown): never { throw error }
export function make(events: string[], label: string, failure: unknown, close: string): Iterable<any> {
  events.push(label + ":open")
  return {
    [Symbol.iterator]() {
      let i = 0
      return {
        next() {
          events.push(label + ":next:" + i)
          return i++ < 2 ? { done: false, value: undefined } : { done: true, value: undefined }
        },
        get return() {
          events.push(label + ":return")
          if (close === "getter") throw failure
          return () => {
            events.push(label + ":close")
            if (close === "throw") throw failure
            return close === "primitive" ? 1 as any : { done: true, value: undefined }
          }
        }
      }
    }
  }
}
