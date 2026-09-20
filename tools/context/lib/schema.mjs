import { read, tracked } from './repo.mjs'
import { config } from './config.mjs'

const TABLE_DECL = /export\s+const\s+(\w+)\s*=\s*pgTable\(\s*['"]([\w]+)['"]\s*,\s*\{/g
const COLUMN_DECL = /^\s*(\w+)\s*:\s*\w+\(\s*['"]([^'"]+)['"]/

function bodyAfter(source, openBraceIndex) {
  let depth = 0
  for (let i = openBraceIndex; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(openBraceIndex + 1, i)
    }
  }
  return ''
}

function columnsIn(body) {
  const columns = []
  let depth = 0
  for (const line of body.split('\n')) {
    if (depth === 0) {
      const match = COLUMN_DECL.exec(line)
      if (match) columns.push({ key: match[1], dbName: match[2] })
    }
    for (const char of line) {
      if (char === '{' || char === '[' || char === '(') depth++
      else if (char === '}' || char === ']' || char === ')') depth--
    }
    if (depth < 0) depth = 0
  }
  return columns
}

/**
 * Parses Drizzle `pgTable` declarations by walking braces rather than invoking
 * the TypeScript compiler: fast, dependency-free, and good enough because the
 * declarations are conventional. Swap this module to support another ORM.
 */
export function parseTables() {
  const dirs = config().schemaDirs ?? []
  if (!config().schema || dirs.length === 0) return []
  const tables = []
  for (const file of tracked(['.ts']).filter((f) => dirs.some((d) => f.startsWith(d)))) {
    const source = read(file)
    for (const match of source.matchAll(TABLE_DECL)) {
      const openBrace = match.index + match[0].length - 1
      tables.push({
        symbol: match[1],
        name: match[2],
        file,
        columns: columnsIn(bodyAfter(source, openBrace)),
      })
    }
  }
  return tables.sort((a, b) => a.name.localeCompare(b.name))
}
