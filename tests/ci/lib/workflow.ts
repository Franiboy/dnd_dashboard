/**
 * Minimal indentation-based reader for the workflow files in this repository.
 *
 * It is deliberately not a full YAML parser: the invariant tests only need the
 * job/step structure, the step conditions and the raw text of each step, and
 * adding a YAML dependency to the test suite for that would be worse than the
 * small amount of parsing below. Anything this reader cannot understand makes a
 * test fail instead of guessing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface WorkflowStep {
  /** Step name, or an empty string for an unnamed step. */
  name: string;
  /** The action reference, or an empty string when the step only runs code. */
  uses: string;
  /** The step condition, folded onto one line. Empty means "always". */
  condition: string;
  /** The full `run:` script, or an empty string. */
  run: string;
  /** The complete step text, including `with:` and `env:` blocks. */
  raw: string;
  /** 1-based line number of the step, for readable failures. */
  line: number;
}

export interface WorkflowJob {
  id: string;
  condition: string;
  steps: WorkflowStep[];
}

interface Line {
  number: number;
  indent: number;
  text: string;
}

interface Field {
  key: string;
  value: string;
  end: number;
}

const FIELD = /^([A-Za-z0-9_-]+):(?:[ ]+(.*))?$/;
const BLOCK_MARKER = new Set(['|', '|-', '|+', '>', '>-', '>+']);

function toLines(source: string): Line[] {
  return source.split('\n').map((raw, index) => {
    const text = raw.replace(/\s+$/, '');
    return {
      number: index + 1,
      indent: text.length - text.replace(/^ +/, '').length,
      text: text.trim(),
    };
  });
}

/** Collects the lines of a block scalar below `start`, in order and unindented. */
function readBlockScalar(
  lines: Line[],
  start: number,
  keyIndent: number
): { body: string; end: number } {
  const body: string[] = [];
  let end = start;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.text === '') {
      body.push('');
      continue;
    }
    if (line.indent <= keyIndent) break;
    body.push(line.text);
    end = index;
  }
  while (body.length > 0 && body[body.length - 1] === '') body.pop();
  return { body: body.join('\n'), end };
}

/** Reads `key: value` at `keyIndent`, following a block scalar when present. */
function readField(lines: Line[], start: number, keyIndent: number): Field {
  const match = FIELD.exec(lines[start].text);
  if (!match) return { key: '', value: '', end: start };
  const [, key, rest = ''] = match;
  if (BLOCK_MARKER.has(rest)) {
    const block = readBlockScalar(lines, start, keyIndent);
    return { key, value: block.body, end: block.end };
  }
  return { key, value: rest, end: start };
}

function parseSteps(lines: Line[], first: number, last: number): WorkflowStep[] {
  const steps: WorkflowStep[] = [];
  for (let start = first; start <= last; start += 1) {
    const line = lines[start];
    if (line.indent !== 6 || !line.text.startsWith('- ')) continue;
    const fields = new Map<string, string>();
    // The first key of a step shares the line with the `- ` marker.
    const head = FIELD.exec(line.text.slice(2));
    if (head) fields.set(head[1], head[2] ?? '');
    let end = start;
    for (let index = start + 1; index <= last; index += 1) {
      const current = lines[index];
      if (current.text === '') continue;
      if (current.indent <= 6) break;
      if (current.indent === 8) {
        const field = readField(lines, index, 8);
        if (field.key !== '') fields.set(field.key, field.value);
        end = field.end;
        index = field.end;
        continue;
      }
      end = index;
    }
    steps.push({
      name: fields.get('name') ?? '',
      uses: fields.get('uses') ?? '',
      condition: fields.get('if') ?? '',
      run: fields.get('run') ?? '',
      raw: lines
        .slice(start, end + 1)
        .map((entry) => entry.text)
        .join('\n'),
      line: start + 1,
    });
  }
  return steps;
}

export function parseWorkflow(source: string): Record<string, WorkflowJob> {
  const lines = toLines(source);
  const jobs: Record<string, WorkflowJob> = {};
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.indent !== 2) continue;
    const header = /^([A-Za-z0-9_-]+):$/.exec(line.text);
    if (!header) continue;

    let last = index;
    for (let scan = index + 1; scan < lines.length; scan += 1) {
      if (lines[scan].text !== '' && lines[scan].indent <= 2) {
        last = scan - 1;
        break;
      }
      last = scan;
    }

    let condition = '';
    let stepsFrom = last + 1;
    for (let scan = index + 1; scan <= last; scan += 1) {
      const current = lines[scan];
      if (current.indent !== 4) continue;
      if (current.text.startsWith('if:')) {
        condition = readField(lines, scan, 4).value;
      } else if (current.text === 'steps:') {
        stepsFrom = scan + 1;
        break;
      }
    }

    jobs[header[1]] = {
      id: header[1],
      condition,
      steps: parseSteps(lines, stepsFrom, last),
    };
    index = last;
  }
  return jobs;
}

export function workflowPath(name: string): string {
  return fileURLToPath(new URL(`../../../${name}`, import.meta.url));
}

export function readWorkflow(name = '.github/workflows/ci-cd.yml'): string {
  return readFileSync(workflowPath(name), 'utf8');
}

/**
 * True when a step condition admits the trusted `pull_request_target` run. A
 * step without a condition always runs, so this only expresses the step's own
 * guard and has to be combined with the job condition.
 */
export function admitsTrustedEvent(condition: string): boolean {
  return !condition.includes("github.event_name != 'pull_request_target'");
}
