import { db } from "@/db/index";
import { nodes } from "@/db/schema";
import { byIdx } from "@/lib/ordering";

const all = db.select().from(nodes).all();
const byParent = new Map<string | null, typeof all>();
for (const n of all) {
  const k = n.parentId ?? null;
  if (!byParent.has(k)) byParent.set(k, []);
  byParent.get(k)!.push(n);
}
function render(parent: string | null, depth = 0, root?: string) {
  const kids = (byParent.get(parent) ?? []).filter((n) => !root || n.root === root).sort(byIdx);
  for (const k of kids) {
    console.log("  ".repeat(depth) + `- [${k.type}] ${k.title}  (idx=${k.idx}, wc=${k.wordCount})`);
    render(k.id, depth + 1);
  }
}
for (const r of ["manuscript", "world", "planning"]) {
  console.log(`\n### ${r.toUpperCase()}`);
  render(null, 0, r);
}
const orphans = all.filter((n) => n.parentId && !all.some((p) => p.id === n.parentId));
console.log("\norphans:", orphans.length);
console.log("total words:", all.reduce((s, n) => s + n.wordCount, 0));
