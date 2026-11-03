export function ids(xs:unknown[]){const out:number[]=[];for(const x of xs){if(typeof x==="object"&&x!==null&&"id" in x){let id=x.id;out.push(id)}}return out}
