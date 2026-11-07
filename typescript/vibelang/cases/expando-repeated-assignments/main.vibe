export function f(): number { return 1 }
function g(): number { return 2 }
function g2(): string { return "two" }
f.constructor = g;
f["constructor"] = g;
f.same = g;
f.same = g;
f.mixed = g;
f["mixed"] = 3;
f.aliases = g;
f.aliases = g2;
f.count = 1;
f.count = 2;
f.label = () => "a";
f["label"] = () => "b";
export const result = [f(), f.mixed, f.count, f.label()]
