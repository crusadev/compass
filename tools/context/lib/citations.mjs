import path from 'node:path'
import { config } from './config.mjs'
import { tracked, isGenerated } from './repo.mjs'

/**
 * How a compass file points at code, and how that pointer resolves.
 *
 * Shared, because more than one tool reads citations and a second copy of this
 * regex would drift from the first. That is the exact failure this project
 * exists to catch, so it would be a poor place to commit it.
 */

/** `src/pricing.ts:46`, `Dockerfile:42`, `pricing.ts` */
export const CITATION =
  /`?\b([\w./[\]-]*[\w[\]-]\.(?:ts|tsx|mjs|js|jsx|json|sql|md)|[\w./-]*Dockerfile)(?::(\d+))?\b`?/g

/** `orders.totalAmount`, `orders.total_amount` */
export const FIELD = /`([a-z][\w]*)\.([a-zA-Z][\w]*)/g

let byBasename = null

const index = () => {
  if (byBasename) return byBasename
  byBasename = new Map()
  for (const file of tracked(config().citable)) {
    // Generated output never resolves a bare name. A report about `orders.ts`
    // is not `orders.ts`, and a report named after a compass file would make
    // every bare mention of that name ambiguous.
    if (isGenerated(file)) continue
    const base = path.basename(file)
    if (!byBasename.has(base)) byBasename.set(base, [])
    byBasename.get(base).push(file)
  }
  return byBasename
}

/**
 * Resolve one cited path against the tracked tree.
 *
 * A bare basename is accepted only when it names exactly one file. That is
 * deliberate: if a reader cannot tell which `pricing.ts` is meant, neither can
 * the next agent. Ambiguity is reported, never guessed at.
 */
export function resolveCitation(cited) {
  if (cited.includes('/')) return { path: cited }
  const candidates = index().get(cited) ?? []
  if (candidates.length === 0) return { error: `no file named ${cited}` }
  if (candidates.length > 1) {
    return {
      error: `${cited} is ambiguous, write the full path: ${candidates.join(', ')}`,
      candidates,
    }
  }
  return { path: candidates[0] }
}

/** Every citation on one line, resolved. Unresolvable ones carry `error`. */
export function citationsIn(text) {
  const found = []
  for (const [, cited, line] of text.matchAll(CITATION)) {
    found.push({ cited, line: line ? Number(line) : null, ...resolveCitation(cited) })
  }
  return found
}
