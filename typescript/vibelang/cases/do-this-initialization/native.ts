export function array(trace: string[], initialized: boolean, lexical: boolean): void {
  const take = (receiver: object, value: number): void => { trace.push("call", String(value)) }
  class Base { x = 1; constructor() { trace.push("super") } }
  class Derived extends Base {
    constructor() {
      if (initialized) super()
      if (lexical) {
        const read = (): void => { const value = [this, (() => { trace.push("do"); if (!initialized) super(); return 2 })()]; trace.push(String(value[0] === this), String(value[1])) }
        read()
      } else {
        const value = [this, (() => { trace.push("do"); if (!initialized) super(); return 2 })()]; trace.push(String(value[0] === this), String(value[1]))
      }
      trace.push("done")
    }
  }
  new Derived()
}

export function call(trace: string[], initialized: boolean, lexical: boolean): void {
  const take = (receiver: object, value: number): void => { trace.push("call", String(value)) }
  class Base { x = 1; constructor() { trace.push("super") } }
  class Derived extends Base {
    constructor() {
      if (initialized) super()
      if (lexical) {
        const read = (): void => { take(this, (() => { trace.push("do"); if (!initialized) super(); return 2 })()) }
        read()
      } else {
        take(this, (() => { trace.push("do"); if (!initialized) super(); return 2 })())
      }
      trace.push("done")
    }
  }
  new Derived()
}

export function element(trace: string[], initialized: boolean, lexical: boolean): void {
  const take = (receiver: object, value: number): void => { trace.push("call", String(value)) }
  class Base { x = 1; constructor() { trace.push("super") } }
  class Derived extends Base {
    constructor() {
      if (initialized) super()
      if (lexical) {
        const read = (): void => { const value = this[(() => { trace.push("do"); if (!initialized) super(); return "x" as const })()]; trace.push(String(value)) }
        read()
      } else {
        const value = this[(() => { trace.push("do"); if (!initialized) super(); return "x" as const })()]; trace.push(String(value))
      }
      trace.push("done")
    }
  }
  new Derived()
}

export function propertyAssign(trace: string[], initialized: boolean, lexical: boolean): void {
  const take = (receiver: object, value: number): void => { trace.push("call", String(value)) }
  class Base { x = 1; constructor() { trace.push("super") } }
  class Derived extends Base {
    constructor() {
      if (initialized) super()
      if (lexical) {
        const read = (): void => { this.x = (() => { trace.push("do"); if (!initialized) super(); return 2 })(); trace.push(String(this.x)) }
        read()
      } else {
        this.x = (() => { trace.push("do"); if (!initialized) super(); return 2 })(); trace.push(String(this.x))
      }
      trace.push("done")
    }
  }
  new Derived()
}

export function elementAssign(trace: string[], initialized: boolean, lexical: boolean): void {
  const take = (receiver: object, value: number): void => { trace.push("call", String(value)) }
  class Base { x = 1; constructor() { trace.push("super") } }
  class Derived extends Base {
    constructor() {
      if (initialized) super()
      if (lexical) {
        const read = (): void => { this[(() => { trace.push("do"); if (!initialized) super(); return "x" as const })()] = 2; trace.push(String(this.x)) }
        read()
      } else {
        this[(() => { trace.push("do"); if (!initialized) super(); return "x" as const })()] = 2; trace.push(String(this.x))
      }
      trace.push("done")
    }
  }
  new Derived()
}

export function method(trace: string[]): void {
  class Receiver {
    run(): void {
      const value = [this, (() => { trace.push("do"); return 2 })()]
      trace.push(String(value[0] === this), String(value[1]))
    }
  }
  new Receiver().run()
}
