#!/usr/bin/env node
// Vendors the shared skills repo (merph518/Overmind) into .claude/att-docs and checks the copy.
//   npm run att-docs:sync [-- <tag>]   copy a tag into .claude/att-docs, stage it, rewrite the lock
//   npm run att-docs:check             fail when the copy differs from the tree the lock records (offline)
// The lock pins the tag, its commit, and the root tree SHA. The vendored copy is never edited by hand:
// a change goes to Overmind, then the pin moves here.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REPO = "merph518/Overmind";
const DIR = ".claude/att-docs";
const LOCK = ".claude/att-docs.lock";

const git = (args, opts = {}) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 26, ...opts }).trim();

const root = git(["rev-parse", "--show-toplevel"], { cwd: fileURLToPath(new URL(".", import.meta.url)) });
const inRoot = (args, opts = {}) => git(args, { cwd: root, ...opts });
const lockPath = join(root, LOCK);

function readLock() {
  if (!existsSync(lockPath)) return null;
  return JSON.parse(readFileSync(lockPath, "utf8"));
}

function fail(message) {
  throw new Error(message);
}

function sync(tagArg) {
  const lock = readLock();
  const repo = lock?.repo ?? DEFAULT_REPO;
  const tag = tagArg ?? lock?.tag;
  if (!tag) fail("no lock to read a tag from; pass one: npm run att-docs:sync -- <tag>");

  const scratch = mkdtempSync(join(tmpdir(), "att-docs-"));
  try {
    git(["init", "-q", "--bare", scratch]);
    // The repository is private; the gh credential helper supplies the token.
    git([
      "-C", scratch, "-c", "credential.helper=!gh auth git-credential",
      "fetch", "-q", "--depth", "1", `https://github.com/${repo}.git`, `refs/tags/${tag}`,
    ]);
    const commit = git(["-C", scratch, "rev-parse", "FETCH_HEAD^{commit}"]);
    const tree = git(["-C", scratch, "rev-parse", "FETCH_HEAD^{tree}"]);
    if (lock && lock.tag === tag && lock.commit !== commit) {
      fail(`tag ${tag} now points at ${commit}, the lock records ${lock.commit}; the tag was moved`);
    }

    inRoot(["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", DIR]);
    rmSync(join(root, DIR), { recursive: true, force: true });
    const archive = execFileSync("git", ["-C", scratch, "archive", `--prefix=${DIR}/`, "FETCH_HEAD"], {
      maxBuffer: 1 << 28,
    });
    execFileSync("tar", ["-x", "-C", root], { input: archive });
    inRoot(["add", "-f", "--", DIR]);

    const staged = inRoot(["write-tree", `--prefix=${DIR}/`]);
    if (staged !== tree) fail(`the staged copy hashes to ${staged}, not the tag's tree ${tree}`);

    writeFileSync(lockPath, `${JSON.stringify({ repo, tag, commit, tree }, null, 2)}\n`);
    inRoot(["add", "--", LOCK]);
    console.log(`att-docs: ${repo} ${tag} (${commit.slice(0, 7)}) vendored, tree ${tree.slice(0, 7)}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function check() {
  const lock = readLock();
  if (!lock) fail(`${LOCK} is missing; run npm run att-docs:sync -- <tag>`);

  let staged;
  try {
    staged = inRoot(["write-tree", `--prefix=${DIR}/`], { stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    fail(`${DIR} is not in the index; run npm run att-docs:sync`);
  }
  const problems = [];
  if (staged !== lock.tree) problems.push(`the staged copy hashes to ${staged}, the lock records ${lock.tree}`);
  try {
    inRoot(["diff", "--quiet", "--", DIR]);
  } catch {
    problems.push("a file under the vendored copy was edited after it was staged");
  }
  if (inRoot(["ls-files", "--others", "--", DIR])) problems.push("an untracked file sits under the vendored copy");

  if (problems.length) {
    fail(`${DIR} does not match ${LOCK} (${lock.repo} ${lock.tag}):\n  - ${problems.join("\n  - ")}`);
  }
  console.log(`att-docs: ${DIR} matches ${LOCK} (${lock.repo} ${lock.tag}, tree ${lock.tree.slice(0, 7)})`);
}

try {
  const [command, tag] = process.argv.slice(2);
  if (command === "sync") sync(tag);
  else if (command === "check") check();
  else fail("usage: att-docs.mjs sync [<tag>] | check");
} catch (error) {
  console.error(`att-docs: ${error.message}`);
  process.exitCode = 1;
}
