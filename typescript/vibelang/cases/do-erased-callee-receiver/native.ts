type Fn = (x: number) => number;
export function probe(): unknown[] {
  const out: unknown[] = [];
  { const trace: string[] = []; const obj = { n: 5, m(x: number): number { trace.push("method"); return this.n + x } };
    const value = obj.m!((() => { trace.push("arg"); obj.n = 10; return 2 })()); out.push([value, trace]); }
  { const trace: string[] = []; const obj = { n: 5, m(x: number): number { trace.push("method"); return this.n + x } };
    const value = (obj.m as Fn)((() => { trace.push("arg"); obj.n = 10; return 2 })()); out.push([value, trace]); }
  { const trace: string[] = []; const obj = { n: 5, m(x: number): number { trace.push("method"); return this.n + x } };
    const value = (obj.m satisfies Fn)((() => { trace.push("arg"); obj.n = 10; return 2 })()); out.push([value, trace]); }
  { const trace: string[] = []; const obj = { n: 5, m(x: number): number { trace.push("method"); return this.n + x } };
    const value = (<Fn>obj.m)((() => { trace.push("arg"); obj.n = 10; return 2 })()); out.push([value, trace]); }
  { const trace: string[] = []; const obj = { n: 5, m(x: number): number { trace.push("method"); return this.n + x } };
    const value = ((obj.m! as Fn) satisfies Fn)((() => { trace.push("arg"); obj.n = 10; return 2 })()); out.push([value, trace]); }
  { const trace: string[] = []; const obj = { n: 5, m(x: number): number { trace.push("method"); return this.n + x } };
    const value = (obj["m"] as Fn)((() => { trace.push("arg"); obj.n = 10; return 2 })()); out.push([value, trace]); }
  { const trace: string[] = []; const obj = { n: 5, m(x: number): number { trace.push("method"); return this.n + x } };
    const value = obj["m"]!((() => { trace.push("arg"); obj.n = 10; return 2 })()); out.push([value, trace]); }
  { const trace: string[] = []; const obj = { n: 5, m(x: number): number { trace.push("method"); return this.n + x } };
    const value = obj.m((() => { trace.push("arg"); obj.n = 10; return 2 })()); out.push([value, trace]); }
  { const trace: string[] = []; const obj = { n: 5, m(x: number): number { trace.push("method"); return this.n + x } };
    const value = (obj.m)((() => { trace.push("arg"); obj.n = 10; return 2 })()); out.push([value, trace]); }
  {
    const trace: string[] = [];
    let obj = { n: 5, get m(): Fn { trace.push("get"); return function(this: {n: number}, x: number): number { trace.push("method"); return this.n + x } } };
    const original = obj;
    const value = obj.m!((() => { trace.push("arg"); original.n = 10; obj = { n: 99, get m(): Fn { return () => 99 } }; return 2 })());
    out.push([value, trace]);
  }
  {
    const trace: string[] = [];
    const obj = { n: 5, m(x: number): number { trace.push("method"); return this.n + x } };
    try { out.push((trace.push("detach"), obj.m)((() => { trace.push("arg"); return 2 })())); }
    catch(e) { out.push([e instanceof Error ? e.name : String(e), trace]); }
  }
  {
    const obj = { n: 5, m<T>(x: T): [number, T] { return [this.n, x] } };
    const value: [number, string] = obj.m!((() => "ok")());
    out.push(value);
  }
  {
    const obj = { n: 5, tag(parts: TemplateStringsArray, x: number): number { return this.n + x } };
    out.push(obj.tag!`x${(() => 2)()}`);
  }
  {
    const obj = { n: 5, m(x: number): number { return this.n + x } };
    const value: string = (obj.m as unknown as (x: number) => string)((() => 2)());
    out.push(value);
  }
  return out;
}
