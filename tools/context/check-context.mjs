// Two separate jobs, and it is worth being precise about which is which.
//
// FAILS the run when a citation no longer resolves: a path that is gone, a line
// past the end of its file, a column that was renamed, an ambiguous basename, a
// file over the line cap. That is referential rot.
//
// WARNS, without failing, when a cited file has been committed since the compass
// file last was. That does not mean the claim is wrong - it means nothing has
// checked it since the code moved underneath it.
//
// Neither job verifies that a claim is TRUE. Nothing mechanical can: a sentence
// can be flatly false with a citation that resolves perfectly. Meaning is what
// the critic agents are for, and they sample rather than prove.
//
//   node tools/context/check-context.mjs [--stale-only]

import { execFileSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { ROOT, read } from './lib/repo.mjs'
import { config } from './lib/config.mjs'
import { parseTables } from './lib/schema.mjs'
import { CITATION, FIELD, resolveCitation } from './lib/citations.mjs'

const DIR = config().contextDir
const LINE_CAP = config().lineCap

const tables = parseTables()
const tableByName = new Map(tables.map((t) => [t.name, t]))
const knownColumn = (table, name) =>
  table.columns.some((c) => c.key === name || c.dbName === name)

const problems = []
const fail = (file, line, message) => problems.push({ file, line, message })

const stale = []
const lastCommitted = new Map()
const committedAt = (file) => {
  if (!lastCommitted.has(file)) {
    const out = execFileSync('git', ['log', '-1', '--format=%ct', '--', file], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim()
    lastCommitted.set(file, out ? Number(out) : 0)
  }
  return lastCommitted.get(file)
}

const compassFiles = existsSync(path.join(ROOT, DIR))
  ? readdirSync(path.join(ROOT, DIR))
      .filter((name) => name.endsWith('.md'))
      .map((name) => `${DIR}/${name}`)
  : []

if (compassFiles.length === 0) {
  console.error(`No compass files in ${DIR}/.`)
  process.exit(0)
}

for (const compass of compassFiles) {
  const lines = read(compass).split('\n')
  const citedFiles = new Map()
  if (lines.length > LINE_CAP + 1) {
    fail(compass, 1, `${lines.length} lines, cap is ${LINE_CAP}`)
  }

  lines.forEach((text, index) => {
    const lineNumber = index + 1

    for (const [, cited, citedLine] of text.matchAll(CITATION)) {
      const resolved = resolveCitation(cited)
      if (resolved.error) {
        fail(compass, lineNumber, resolved.error)
        continue
      }
      const target = resolved.path
      if (!existsSync(path.join(ROOT, target))) {
        fail(compass, lineNumber, `${target} does not exist`)
        continue
      }

      // Only citations of CODE can go stale. A link to a sibling compass file is
      // a cross-reference, and the generated reports are rewritten on every scan,
      // so neither timestamp says anything about whether a claim still holds.
      if (!citedFiles.has(target) && !target.startsWith(`${DIR}/`)) {
        citedFiles.set(target, lineNumber)
      }

      if (citedLine) {
        const length = read(target).split('\n').length
        if (Number(citedLine) > length) {
          fail(compass, lineNumber, `${target} has ${length} lines, cited :${citedLine}`)
        }
      }
    }

    for (const [, owner, field] of text.matchAll(FIELD)) {
      const table = tableByName.get(owner)
      if (!table) continue
      if (!knownColumn(table, field)) {
        fail(compass, lineNumber, `${owner} has no column ${field}`)
      }
    }
  })

  // A claim is unverified-since when the code it cites moved after the claim was
  // last written. The citation still resolves, so this is a warning, not a
  // failure - but it is the only signal that a true sentence may have gone stale.
  const compassAt = committedAt(compass)
  if (compassAt > 0) {
    for (const [target, lineNumber] of citedFiles) {
      if (target === compass) continue
      const targetAt = committedAt(target)
      if (targetAt > compassAt) {
        stale.push({ compass, line: lineNumber, target })
      }
    }
  }
}

const staleOnly = process.argv.includes('--stale-only')

if (!staleOnly) {
  for (const { file, line, message } of problems) {
    console.error(`${file}:${line}  ${message}`)
  }
}

for (const { compass, line, target } of stale) {
  console.error(`${compass}:${line}  unverified since ${target} last changed`)
}

const staleFiles = new Set(stale.map((s) => s.compass)).size
console.error(
  `${compassFiles.length} compass file(s): ` +
    `${problems.length} broken citation(s), ` +
    `${stale.length} claim(s) unverified since their code changed` +
    (staleFiles ? ` across ${staleFiles} file(s)` : '')
)

process.exit(staleOnly ? 0 : problems.length === 0 ? 0 : 1)
