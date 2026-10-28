#!/usr/bin/env node
// Builds test packs on the local model, one job at a time.
//
//   node build-pack.mjs run --config <pipeline.json> --issue <n> [--change <m>] [--doc <path>]...
//   node build-pack.mjs run --config <pipeline.json> --suite <code>
//   node build-pack.mjs queue add --config <pipeline.json> (--issue <n> [--change <m>] | --suite <code>)
//   node build-pack.mjs queue run --config <pipeline.json> [--cutoff HH:MM]
//   node build-pack.mjs queue summary --config <pipeline.json>
//
// Console output is the content-free status lines only: phase names, pass or
// fail, reason codes, counts and timings. What the model wrote stays in each
// job's output folder.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { jobId, runJob } from './run.mjs';

const USAGE = `usage:
  build-pack.mjs run --config <file> (--issue <n> [--change <m>] [--doc <path>]... | --suite <code>)
  build-pack.mjs queue add --config <file> (--issue <n> [--change <m>] [--doc <path>]... | --suite <code>)
  build-pack.mjs queue run --config <file> [--cutoff HH:MM]
  build-pack.mjs queue summary --config <file>`;

export function parseArgs(argv) {
  const args = { docs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag.startsWith('--')) {
      (args.words ??= []).push(flag);
      continue;
    }
    i += 1;
    if (flag === '--doc') args.docs.push(value);
    else args[flag.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = value;
  }
  return args;
}

/** The job a command line names, or an error saying what it lacks. */
export function jobFrom(args) {
  if (args.suite && args.issue) throw new Error('a job names an issue or a suite, not both');
  if (args.suite) {
    if (!/^[A-Za-z0-9_-]+$/.test(args.suite)) throw new Error('--suite takes a suite code');
    return { suite: args.suite };
  }
  if (!/^\d+$/.test(args.issue ?? '')) throw new Error('--issue takes a number');
  if (args.change !== undefined && !/^[A-Za-z0-9_-]+$/.test(args.change)) {
    throw new Error('--change takes a change number');
  }
  return { issue: args.issue, ...(args.change ? { change: args.change } : {}),
    ...(args.docs.length ? { docs: args.docs } : {}),
    ...(args.descriptionFile ? { descriptionFile: args.descriptionFile } : {}) };
}

const queuePath = (config) => config.at(config.queue.file);

export function readQueue(config) {
  const file = queuePath(config);
  if (!fs.existsSync(file)) return { jobs: [] };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeQueue(config, queue) {
  const file = queuePath(config);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(queue, null, 1)}\n`);
  fs.renameSync(temp, file);
}

export function addJob(config, job, now = new Date()) {
  const queue = readQueue(config);
  const id = jobId(job);
  if (queue.jobs.some((row) => row.id === id && ['queued', 'running'].includes(row.status))) {
    return { id, added: false };
  }
  queue.jobs.push({ id, ...job, status: 'queued', added: now.toISOString() });
  writeQueue(config, queue);
  return { id, added: true };
}

/** The first moment at or after `from` whose clock reads HH:MM. */
export function cutoffAfter(from, hhmm) {
  const time = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm));
  if (!time) throw new Error('a queue time reads HH:MM');
  const [h, m] = [Number(time[1]), Number(time[2])];
  const at = new Date(from);
  at.setHours(h, m, 0, 0);
  if (at <= from) at.setDate(at.getDate() + 1);
  return at;
}

/** Holds the queue for this process, or returns null when a live process holds it. */
function lockQueue(config) {
  const lock = `${queuePath(config)}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (let tries = 0; tries < 2; tries += 1) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      return () => fs.rmSync(lock, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const holder = Number(fs.readFileSync(lock, 'utf8'));
      try {
        process.kill(holder, 0);
        return null;
      } catch {
        // The process that held the lock is gone.
        fs.rmSync(lock, { force: true });
      }
    }
  }
  return null;
}

/**
 * Works the queue one job at a time, oldest first, until it is empty or the
 * cutoff passes. A job already running when the cutoff passes finishes. A
 * failed job is marked failed with its phase, and the next one starts.
 *
 * With `start` set, the queue runs only in the window from start to cutoff: a
 * run that begins outside it, such as a timer catching up after the machine
 * slept through the night, takes no job. A job left running by a run that
 * died is marked failed as interrupted.
 */
export async function drainQueue(config, { cutoff = config.queue.cutoff, start = null,
  run = runJob, clock = () => new Date() } = {}) {
  const stopAt = cutoffAfter(clock(), cutoff);
  if (start && cutoffAfter(clock(), start) < stopAt) return [];
  const unlock = lockQueue(config);
  if (!unlock) return [];
  try {
    const stale = readQueue(config);
    const interrupted = stale.jobs.filter((row) => row.status === 'running');
    for (const row of interrupted) {
      Object.assign(row, { status: 'failed', finished: clock().toISOString(),
        reason: 'interrupted' });
    }
    if (interrupted.length) writeQueue(config, stale);
    return await drainLocked(config, { stopAt, run, clock });
  } finally {
    unlock();
  }
}

async function drainLocked(config, { stopAt, run, clock }) {
  const done = [];
  for (;;) {
    if (clock() >= stopAt) break;
    const queue = readQueue(config);
    const next = queue.jobs.find((row) => row.status === 'queued');
    if (!next) break;
    next.status = 'running';
    next.started = clock().toISOString();
    writeQueue(config, queue);
    const { id, status, added, started, ...job } = next;
    let result;
    try {
      result = await run(config, { ...job, id });
    } catch (error) {
      result = { ok: false, phase: 'setup', reason: 'error', ms: 0 };
    }
    const after = readQueue(config);
    let row = after.jobs.find((r) => r.id === id && r.status === 'running');
    if (!row) {
      // The row was taken out of the queue file while the job ran.
      row = { id, ...job, added, started };
      after.jobs.push(row);
    }
    Object.assign(row, {
      status: result.ok ? 'passed' : 'failed', finished: clock().toISOString(),
      ms: result.ms, phase: result.ok ? 'done' : result.phase, reason: result.reason ?? null,
      workbook: result.workbook ?? null, outDir: result.outDir ?? null,
    });
    writeQueue(config, after);
    done.push(row);
  }
  return done;
}

/** The morning summary: one content-free line per job. */
export function summaryLines(queue) {
  return queue.jobs.map((row) => {
    const minutes = row.ms ? `${Math.round(row.ms / 60000)} min` : '';
    const where = row.status === 'failed' ? `stopped at ${row.phase} (${row.reason})`
      : row.status === 'passed' ? row.workbook ?? '' : '';
    return [row.id, row.status, minutes, where].filter(Boolean).join('  ');
  });
}

async function main(argv) {
  const args = parseArgs(argv);
  const [command, sub] = args.words ?? [];
  if (!args.config || !command) {
    console.error(USAGE);
    return 2;
  }
  const config = loadConfig(args.config);
  if (command === 'run') {
    const result = await runJob(config, jobFrom(args));
    return result.ok ? 0 : 1;
  }
  if (command === 'queue' && sub === 'add') {
    const { id, added } = addJob(config, jobFrom(args));
    console.log(added ? `queued ${id}` : `${id} is already queued`);
    return 0;
  }
  if (command === 'queue' && sub === 'run') {
    // A cutoff given on the command line is a deliberate run, outside the nightly window.
    const done = await drainQueue(config, args.cutoff ? { cutoff: args.cutoff }
      : { cutoff: config.queue.cutoff, start: config.queue.start });
    console.log(`ran ${done.length} job(s)`);
    for (const line of summaryLines(readQueue(config))) console.log(line);
    return 0;
  }
  if (command === 'queue' && sub === 'summary') {
    for (const line of summaryLines(readQueue(config))) console.log(line);
    return 0;
  }
  console.error(USAGE);
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
    // A setup error names the config field at fault, never document content.
    console.error(error.message);
    process.exitCode = 2;
  });
}
