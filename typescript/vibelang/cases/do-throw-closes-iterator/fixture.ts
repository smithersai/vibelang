export const rows: any = (log: string[]) => ({
  [Symbol.iterator]() {
    return {
      next() { log.push("next"); return { done: false, value: undefined } },
      return() { log.push("return"); throw "close" }
    }
  }
})
export const quiet: any = (log: string[]) => ({
  [Symbol.iterator]() {
    return {
      next() { log.push("next"); return { done: false, value: 1 } },
      return() { log.push("return"); return { done: true, value: undefined } }
    }
  }
})
export const explosive: any = (log: string[], word: string) => ({
  get value(): number { log.push(word); throw word }
})
