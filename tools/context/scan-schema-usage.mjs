// Reference-counts every Drizzle table and column against the rest of the repo.
// Anything with zero hits in application code is a zombie candidate.
//
//   node tools/context/scan-schema-usage.mjs [--json]

import { mkdirSync,  writeFileSync } from 'node:fs'
import path from 'node:path'
import { ROOT, consumerFiles, read } from './lib/repo.mjs'
import { config } from './lib/config.mjs'
import { parseTables } from './lib/schema.mjs'

const OUT = `${config().generatedDir}/schema-usage.md`

if (!config().schema) {
  console.error(
    'No `schema` adapter configured. Set "schema": "drizzle" in compass.config.json,\n' +
      'or leave it null if this repo has no ORM schema to scan.',
  )
  process.exit(0)
}

// Matched against raw source, so a name is found whether it is written as an
// identifier, a property, or inside a string such as `.select('id, user_id')`.
const IDENTIFIER = /[A-Za-z_$][\w$]*/g
const QUALIFIED = /([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g

function classify(file) {
  if (/__tests__|\.test\.|\.spec\./.test(file)) return 'test'
  if (/^(backend\/scripts|tools|infrastructure)\//.test(file)) return 'script'
  return 'app'
}

const tables = parseTables()

// A name carrying an underscore is specific enough to trust anywhere in the
// repo. A bare word like `name` or `status` is not, so those only count inside
// a file that already touches the table.
const isSpecific = (name) => name.includes('_')

const interestingIdentifiers = new Set()
const interestingPairs = new Set()

for (const table of tables) {
  interestingIdentifiers.add(table.symbol)
  interestingIdentifiers.add(table.name)
  for (const column of table.columns) {
    interestingIdentifiers.add(column.key)
    interestingIdentifiers.add(column.dbName)
    interestingPairs.add(`${table.symbol}.${column.key}`)
  }
}

const files = consumerFiles().filter((f) => classify(f) !== 'other')
const kinds = files.map(classify)

// token -> set of file indexes that mention it
const mentions = new Map()

const note = (token, index) => {
  let set = mentions.get(token)
  if (!set) mentions.set(token, (set = new Set()))
  set.add(index)
}

files.forEach((file, index) => {
  const source = read(file)
  for (const [token] of source.matchAll(IDENTIFIER)) {
    if (interestingIdentifiers.has(token)) note(token, index)
  }
  for (const [, object, property] of source.matchAll(QUALIFIED)) {
    const pair = `${object}.${property}`
    if (interestingPairs.has(pair)) note(pair, index)
  }
})

const EMPTY = new Set()
const where = (token) => mentions.get(token) ?? EMPTY

function tally(indexes) {
  const counts = { app: 0, test: 0, script: 0 }
  for (const index of indexes) counts[kinds[index]]++
  return counts
}

const total = (counts) => counts.app + counts.test + counts.script

const report = tables.map((table) => {
  const tableFiles = new Set([...where(table.symbol), ...where(table.name)])
  const tableHits = tally(tableFiles)

  const columns = table.columns.map((column) => {
    // Unambiguous: written as `table.column`, or as a raw name distinctive
    // enough that a hit anywhere means this column.
    const explicit = new Set(where(`${table.symbol}.${column.key}`))
    if (isSpecific(column.dbName)) for (const index of where(column.dbName)) explicit.add(index)

    // Ambiguous alone, but a bare `salesPrice` or `status` inside a file that
    // already touches `stocks` is almost certainly this column - an insert
    // payload, a `columns: { ... }` projection, a destructure, a JSON field.
    const contextual = new Set()
    for (const name of new Set([column.key, column.dbName])) {
      for (const index of where(name)) {
        if (tableFiles.has(index) && !explicit.has(index)) contextual.add(index)
      }
    }

    const explicitHits = tally(explicit)
    const contextualHits = tally(contextual)
    const all = { ...explicitHits }
    for (const kind of ['app', 'test', 'script']) all[kind] += contextualHits[kind]

    let verdict = 'used'
    if (total(all) === 0) verdict = 'dead'
    else if (all.app === 0) verdict = 'non-app-only'

    return { ...column, explicit: explicitHits, contextual: contextualHits, verdict }
  })

  let verdict = 'used'
  if (total(tableHits) === 0) verdict = 'dead'
  else if (tableHits.app === 0) verdict = 'non-app-only'

  return { ...table, hits: tableHits, verdict, columns }
})

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(0)
}

const lines = []
const say = (line = '') => lines.push(line)

const deadTables = report.filter((t) => t.verdict === 'dead')
const nonAppTables = report.filter((t) => t.verdict === 'non-app-only')
const pick = (verdict) =>
  report.flatMap((table) =>
    table.columns.filter((c) => c.verdict === verdict).map((column) => ({ table, column }))
  )
const deadColumns = pick('dead')
const nonAppColumns = pick('non-app-only')

const columnCount = report.reduce((n, t) => n + t.columns.length, 0)

say('# Schema usage')
say()
say('Generated by `node tools/context/scan-schema-usage.mjs`. Do not edit by hand.')
say()
say(`${report.length} tables, ${columnCount} columns.`)
say(
  'Counts are files outside `shared/db` and the migration folders, split into ' +
    'application code / tests / scripts.'
)
say()
say('A column counts as used when it appears as `table.column`, as its raw')
say('`snake_case` name, or as a bare key inside a file that already touches the table.')
say()
say(
  `| | dead | referenced only by tests or scripts |\n| --- | --- | --- |\n` +
    `| tables | ${deadTables.length} | ${nonAppTables.length} |\n` +
    `| columns | ${deadColumns.length} | ${nonAppColumns.length} |`
)
say()

say('## Dead tables')
say()
say('No reference anywhere, in any form.')
say()
if (deadTables.length === 0) say('None.')
else for (const t of deadTables) say(`- \`${t.name}\` (\`${t.symbol}\`, ${t.file})`)
say()

say('## Tables referenced only by tests or scripts')
say()
if (nonAppTables.length === 0) say('None.')
else
  for (const t of nonAppTables)
    say(`- \`${t.name}\` - ${t.hits.test} test, ${t.hits.script} script (${t.file})`)
say()

say('## Dead columns')
say()
if (deadColumns.length === 0) say('None.')
else
  for (const { table, column } of deadColumns)
    say(`- \`${table.name}.${column.dbName}\` (\`${table.symbol}.${column.key}\`)`)
say()

say('## Columns referenced only by tests or scripts')
say()
if (nonAppColumns.length === 0) say('None.')
else {
  say('| Column | Tests | Scripts |')
  say('| --- | --- | --- |')
  for (const { table, column } of nonAppColumns) {
    const test = column.explicit.test + column.contextual.test
    const script = column.explicit.script + column.contextual.script
    say(`| \`${table.name}.${column.dbName}\` | ${test} | ${script} |`)
  }
}
say()

mkdirSync(path.dirname(path.join(ROOT, OUT)), { recursive: true })
writeFileSync(path.join(ROOT, OUT), `${lines.join('\n')}\n`)
console.error(
  `${OUT}: ${deadTables.length} dead tables, ${nonAppTables.length} test/script-only tables, ` +
    `${deadColumns.length} dead columns, ${nonAppColumns.length} test/script-only columns`
)
