// Finds two compass files describing the same line of code differently.
//
// This catches what a per-domain critic cannot: two files derived the same fact
// independently and disagreed. In the codebase this was built for, that is how a
// wrong source comment was caught - one compass file had copied it, another had
// read the code. Nobody would have looked if they had not disagreed in public.
//
// It cannot tell which file is right, and does not try. It hands over pairs that
// point at the same code and say different things - which is all anyone needed.
//
//   node tools/context/scan-claim-conflicts.mjs [--json]

import { mkdirSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ROOT, read } from './lib/repo.mjs'
import { config } from './lib/config.mjs'
import { citationsIn } from './lib/citations.mjs'

const DIR = config().contextDir
const OUT = `${config().generatedDir}/claim-conflicts.md`

// Two claims sharing most of their content words are saying the same thing.
// Below this they are either disagreeing or duplicating, and both are worth a
// look. Both are worth acting on.
const AGREEMENT = 0.5

// Words that carry no claim.
const NOISE = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its',
  'and', 'or', 'but', 'not', 'no', 'so', 'as', 'at', 'by', 'for', 'from',
  'in', 'into', 'of', 'on', 'to', 'with', 'that', 'this', 'these', 'those',
  'which', 'what', 'when', 'where', 'who', 'whom', 'only', 'also', 'then',
  'than', 'both', 'each', 'every', 'any', 'all', 'one', 'two', 'three',
  'here', 'there', 'they', 'them', 'their', 'has', 'have', 'had', 'does',
  'do', 'did', 'can', 'could', 'will', 'would', 'may', 'might', 'must',
])

const words = (text) =>
  new Set(
    text
      .toLowerCase()
      .replace(/`[^`]*`/g, ' ') // citations and identifiers are the anchor, not the claim
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !NOISE.has(w)),
  )

/**
 * The backticked identifiers in a claim: function names, columns, constants.
 * Two bullets citing one line but naming no symbol in common are making
 * different points about the same code, not contradicting each other - which is
 * most of what a bare line match turns up.
 */
const PATHISH = /[/\\]|\.(ts|tsx|mjs|js|json|sql|md)$/
const GENERIC = new Set([
  'true', 'false', 'null', 'undefined', 'status', 'type', 'name', 'value',
  'user', 'users', 'order', 'orders', 'stock', 'stocks', 'price', 'prices',
])

const symbols = (text) =>
  new Set(
    [...text.matchAll(/`([^`]+)`/g)]
      .map((m) => m[1].trim())
      // A path is the anchor, not the subject. Splitting one yields `backend`,
      // `api`, `utils`, which every bullet in the repo shares.
      .filter((s) => !PATHISH.test(s))
      .flatMap((s) => s.split(/[^A-Za-z0-9_]+/))
      .filter((s) => s.length > 3 && !/^\d+$/.test(s) && !GENERIC.has(s.toLowerCase())),
  )

const shareSubject = (a, b) => {
  const sa = symbols(a)
  const sb = symbols(b)
  for (const s of sa) if (sb.has(s)) return true
  return false
}

const overlap = (a, b) => {
  if (a.size === 0 || b.size === 0) return 1
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  return shared / Math.min(a.size, b.size)
}

const compassFiles = existsSync(path.join(ROOT, DIR))
  ? readdirSync(path.join(ROOT, DIR))
      .filter((n) => n.endsWith('.md'))
      .map((n) => `${DIR}/${n}`)
  : []

// anchor (`file:line`) -> the claims made about it, one per compass file
const anchors = new Map()

for (const compass of compassFiles) {
  read(compass)
    .split('\n')
    .forEach((text, index) => {
      if (!text.trim().startsWith('-') && !text.trim().startsWith('*')) return
      for (const c of citationsIn(text)) {
        // A citation with no line number names a file, not a claim about one
        // specific behaviour - eleven domains cite orders.ts and none of them
        // are disagreeing by doing so.
        if (!c.line || c.error) continue
        // Never anchor on another compass file: those are cross-references.
        if (c.path.startsWith(`${DIR}/`)) continue
        const key = `${c.path}:${c.line}`
        if (!anchors.has(key)) anchors.set(key, new Map())
        // One claim per file per anchor: the first mention is the substantive one.
        if (!anchors.get(key).has(compass)) {
          anchors.get(key).set(compass, { line: index + 1, text: text.trim() })
        }
      }
    })
}

const conflicts = []
for (const [anchor, claims] of anchors) {
  if (claims.size < 2) continue
  const entries = [...claims.entries()]
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [fileA, a] = entries[i]
      const [fileB, b] = entries[j]
      if (!shareSubject(a.text, b.text)) continue
      const score = overlap(words(a.text), words(b.text))
      if (score >= AGREEMENT) continue
      conflicts.push({ anchor, score, a: { file: fileA, ...a }, b: { file: fileB, ...b } })
    }
  }
}

conflicts.sort((x, y) => x.score - y.score)

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(conflicts, null, 2))
  process.exit(0)
}

const lines = []
const say = (l = '') => lines.push(l)
const trim = (t, n = 240) => (t.length > n ? `${t.slice(0, n)}...` : t)

say('# Claim conflicts')
say()
say('Generated by `node tools/context/scan-claim-conflicts.mjs`. Do not edit by hand.')
say()
say(
  `${anchors.size} code lines are cited by a compass file. ${conflicts.length} pair(s) ` +
    'anchor on the same line, name at least one identifier in common, and still ' +
    'describe it differently.',
)
say()
say(
  'Low overlap means the two claims share few content words. That is either a ' +
    'disagreement - one of them is wrong - or a duplication, where one file should ' +
    'own the fact and the other should link. Both are worth acting on. This tool ' +
    'cannot tell which file is right and does not guess.',
)
say()

if (conflicts.length === 0) say('No conflicts.')
for (const c of conflicts) {
  say(`## \`${c.anchor}\` (${Math.round(c.score * 100)}% shared wording)`)
  say()
  say(`- **${path.basename(c.a.file, '.md')}:${c.a.line}** ${trim(c.a.text.replace(/^[-*]\s*/, ''))}`)
  say(`- **${path.basename(c.b.file, '.md')}:${c.b.line}** ${trim(c.b.text.replace(/^[-*]\s*/, ''))}`)
  say()
}

mkdirSync(path.dirname(path.join(ROOT, OUT)), { recursive: true })
writeFileSync(path.join(ROOT, OUT), `${lines.join('\n')}\n`)
console.error(`${OUT}: ${anchors.size} anchored lines, ${conflicts.length} conflicting pair(s)`)
