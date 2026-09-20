import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ROOT, config } from './config.mjs'

export { ROOT }

export function tracked(extensions) {
  const files = execFileSync('git', ['ls-files'], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
    .split('\n')
    .filter(Boolean)
  if (!extensions) return files
  return files.filter((f) => extensions.includes(path.extname(f)))
}

export function read(file) {
  return readFileSync(path.join(ROOT, file), 'utf8')
}

/**
 * Which top-level package a file belongs to. In a monorepo this is the first
 * path segment; in a single-package repo everything returns the same value and
 * the cross-package comparisons simply find nothing, which is correct.
 */
export function packageOf(file) {
  return file.split('/')[0]
}

const under = (file, dirs) => dirs.some((d) => file === d.replace(/\/$/, '') || file.startsWith(d))

export function isExcluded(file) {
  return under(file, config().exclude)
}

export function isGenerated(file) {
  return under(file, config().generated)
}

/**
 * Files whose contents count as USING a symbol.
 *
 * Excludes the schema definitions themselves and any generated mirror of the
 * codebase. A column appearing in its own definition is not a reader, and a
 * generated type dump lists everything whether or not anything reads it.
 */
export function consumerFiles() {
  const c = config()
  return tracked().filter((f) => !under(f, c.exclude) && !under(f, c.excludeFromUsage))
}
