import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** The repo root. Lives here so repo.mjs can read config without a cycle. */
export const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim()

/**
 * Everything that differs between codebases lives here, not scattered through
 * the scanners.
 *
 * Drop a `compass.config.json` at the repo root to override any of it. Every
 * field is optional; the defaults below work for a plain TypeScript repo with
 * no database layer.
 */

const DEFAULTS = {
  /** Where compass files live. One per domain. */
  contextDir: 'docs/context',

  /** Where generated reports land. Never edited by hand. */
  generatedDir: 'docs/context/_generated',

  /**
   * The hard line cap on a compass file. The point of the whole format: a long
   * context file crowds out the code it describes. Raise it and you will get
   * encyclopedias.
   */
  lineCap: 35,

  /** File extensions a compass file may cite. */
  citable: ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.json', '.sql', '.md', ''],

  /** Extensions the coverage scanner counts as source. */
  source: ['.ts', '.tsx', '.js', '.jsx'],

  /**
   * Paths excluded from "is this code used" counting. Two kinds belong here:
   * the schema definitions themselves (a column appearing in its own
   * definition is not usage), and any generated mirror of the whole codebase -
   * an ORM type dump lists every column whether or not anything reads it, so
   * counting hits there proves nothing.
   */
  excludeFromUsage: [],

  /** Paths never scanned at all: vendored code, build output, frozen copies. */
  exclude: ['node_modules/', 'dist/', 'build/', '.next/', 'coverage/'],

  /**
   * Directories holding generated output. Files here never resolve a bare
   * citation: a report about `orders.ts` is not `orders.ts`, and a report named
   * after a compass file would otherwise make every bare name ambiguous.
   */
  generated: ['docs/context/_generated/'],

  /** Minimum lines before the coverage scanner considers a file a candidate domain. */
  coverageMinLines: 400,

  /**
   * Optional database schema adapter. Only `drizzle` ships here. Set to null
   * to turn off the schema scanner entirely, which is the right choice unless
   * you use Drizzle.
   */
  schema: null,
}

let cached = null

export function config() {
  if (cached) return cached
  const file = path.join(ROOT, 'compass.config.json')
  const user = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  cached = { ...DEFAULTS, ...user }
  return cached
}
