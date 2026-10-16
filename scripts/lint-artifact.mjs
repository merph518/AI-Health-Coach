#!/usr/bin/env node
// Lints the artifact page (artifact/coach.html): parses its inline <script> and runs app-specific rules.
// Run with `npm run lint:artifact`. Add a rule by appending to RULES: {id, why, check(ast, report)}.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as espree from "espree";

const FILE = fileURLToPath(new URL("../artifact/coach.html", import.meta.url));
const html = readFileSync(FILE, "utf8");

// Walks every node, giving each visitor the node and its ancestors (nearest last).
function walk(node, visit, parents = []) {
  if (!node || typeof node.type !== "string") return;
  visit(node, parents);
  const next = [...parents, node];
  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "loc" || key === "range") continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => walk(c, visit, next));
    else if (v && typeof v.type === "string") walk(v, visit, next);
  }
}
const isCall = (n, name) => n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === name;
const isNothing = (n) => !n || (n.type === "Literal" && n.value == null) || (n.type === "Identifier" && n.name === "undefined");
const insideFunction = (parents, name) => parents.some((p) => p.type === "FunctionDeclaration" && p.id?.name === name);
const stringText = (n) => n.type === "Literal" && typeof n.value === "string" ? n.value
  : n.type === "TemplateLiteral" ? n.quasis.map((q) => q.value.cooked).join(" ") : null;

const RULES = [
  {
    id: "coach-message-timestamp",
    why: "Every chat message, the coach's included, shows its time. Rows are built only by chatRow(role, el, at), and `at` is required.",
    check(ast, report) {
      walk(ast, (n, parents) => {
        if (isCall(n, "chatRow") && (n.arguments.length < 3 || isNothing(n.arguments[2])))
          report(n, "chatRow() needs a timestamp as its third argument (ms), e.g. m.at, Date.now() or seenAt(key).");
        // A chat row assembled by hand would skip the timestamp.
        const text = stringText(n);
        if (text && /(^|\s)(mrow|mwrap)(\s|$)/.test(text) && !insideFunction(parents, "chatRow"))
          report(n, "Build chat rows with chatRow(role, el, at), not by hand (class mrow/mwrap).");
      });
    },
  },
];

// The page's script, with line numbers kept relative to the HTML file.
const problems = [];
for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
  const offset = html.slice(0, m.index + "<script>".length).split("\n").length - 1;
  let ast;
  try {
    ast = espree.parse(m[1], { ecmaVersion: "latest", sourceType: "script", loc: true });
  } catch (e) {
    problems.push({ line: (e.lineNumber || 0) + offset, rule: "syntax", msg: e.message });
    continue;
  }
  for (const rule of RULES) rule.check(ast, (node, msg) => problems.push({ line: node.loc.start.line + offset, rule: rule.id, msg }));
}

for (const p of problems.sort((a, b) => a.line - b.line)) console.log(`artifact/coach.html:${p.line}  ${p.rule}  ${p.msg}`);
if (problems.length) {
  console.log(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}.`);
  for (const r of RULES.filter((r) => problems.some((p) => p.rule === r.id))) console.log(`${r.id}: ${r.why}`);
  process.exit(1);
}
console.log(`artifact/coach.html: ${RULES.length} rule${RULES.length === 1 ? "" : "s"}, no problems.`);
