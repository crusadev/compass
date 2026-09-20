export const meta = {
  name: 'compass-sweep',
  description: 'Map every domain to a short cited compass file: analyst writes, blind critic re-derives, fixer applies',
  phases: [
    { title: 'Analyse', detail: 'one agent per domain, following the map-domain skill' },
    { title: 'Critique', detail: 'independent critic re-derives every claim from source' },
    { title: 'Fix', detail: 'only where a critic found something' },
    { title: 'Sweep check', detail: 'coverage, cross-file contradictions, duplicated claims' },
  ],
}

// Run the detectors before invoking this. Their output is the evidence every
// analyst starts from:
//
//   node tools/context/scan-coverage.mjs
//   node tools/context/scan-claim-conflicts.mjs
//   node tools/context/scan-schema-usage.mjs     (only if you configured a schema adapter)
//
// scan-claim-conflicts is worth running AFTER a sweep as well as before: it
// compares finished compass files against each other, so it has nothing to say
// until they exist.
//
// DOMAINS come in through `args`, as an array of objects:
//
//   [{ "key": "orders",
//      "about": "a customer order from checkout through fulfilment and refund",
//      "hints": "src/orders/, src/db/orders.ts, the order status enum",
//      "owns": false }]
//
// `key` becomes the filename. `about` and `hints` go into the analyst's prompt;
// hints are starting points, not the boundary, and the agent is told to correct
// them. `owns: true` marks a domain that holds a platform-wide fact the others
// link to rather than re-derive.
//
// Keep the list in `compass.domains.json` and pass it as args. It is not read
// from disk here because a workflow script has no filesystem access.

const DOMAINS = Array.isArray(args) ? args.filter((d) => d && d.key) : []

if (DOMAINS.length === 0) {
  log('No domains passed. See compass.domains.example.json and pass it as args.')
}

// Facts that belong to exactly one compass file. Every other analyst is told to
// link rather than re-derive them. Without this, a platform-wide fact gets
// explained from scratch in every file that touches it.
//
// Populate this from your own codebase. Examples of the shape:
//   'Authentication and the role model are owned by docs/context/auth.md.'
//   'Money rounding rules are owned by docs/context/pricing.md.'
const OWNED_ELSEWHERE = DOMAINS.filter((d) => d.owns && d.ownsFact).map((d) => d.ownsFact)

log(
  `${DOMAINS.length} domain(s). ${OWNED_ELSEWHERE.length} platform-wide fact(s) have a declared owner.`,
)

const ANALYST_SCHEMA = {
  type: 'object',
  properties: {
    domain: { type: 'string' },
    wrote: { type: 'boolean' },
    lines: { type: 'number' },
    duplicatedLogic: { type: 'array', items: { type: 'string' } },
    zombies: { type: 'array', items: { type: 'string' } },
    contradictions: { type: 'array', items: { type: 'string' } },
    couldNotVerify: { type: 'array', items: { type: 'string' } },
    // Facts found in passing that belong to a DIFFERENT domain's file. An
    // analyst owns one file and cannot write a neighbour's, so without this the
    // choice is drop the fact or put it in the wrong place.
    belongsElsewhere: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fact: { type: 'string' },
          domain: { type: 'string' },
          citation: { type: 'string' },
        },
        required: ['fact', 'domain'],
      },
    },
  },
  required: ['domain', 'wrote', 'lines'],
}

const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    domain: { type: 'string' },
    claimsChecked: { type: 'number' },
    problems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          verdict: { type: 'string' },
          why: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['claim', 'verdict', 'why'],
      },
    },
  },
  required: ['domain', 'claimsChecked', 'problems'],
}

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    domain: { type: 'string' },
    applied: { type: 'array', items: { type: 'string' } },
    rejected: { type: 'array', items: { type: 'string' } },
    validatorClean: { type: 'boolean' },
    lines: { type: 'number' },
  },
  required: ['domain', 'applied', 'validatorClean'],
}

const analyst = (d) =>
  agent(
    `You are writing ONE compass file in the repository you are working in.

Read these first, in this order:
  1. .claude/skills/map-domain/SKILL.md - the procedure you must follow, in full
  2. tools/context/README.md - the file format and why it is shaped that way
  3. docs/context/_generated/ - already generated. Evidence, not conclusions. Do not regenerate them.

Your domain is "${d.key}": ${d.about}

Starting points, NOT the boundary. Follow imports outward and correct them if
they are wrong:
${d.hints || '(none given: work the boundary out yourself)'}

${
  d.owns
    ? 'This file OWNS a fact other domains link to. State it fully and well; the others will point here.'
    : OWNED_ELSEWHERE.length
      ? `Do NOT re-explain facts another file owns. Link instead:\n${OWNED_ELSEWHERE.map((x) => `  - ${x}`).join('\n')}`
      : ''
}

Follow the skill exactly. The parts that most often produce wrong output:
  - Answer all five questions before you write a single line.
  - Cite the BINDING, not the expression. If a condition decides something, read
    the variable or function name it is assigned to first. A description of what
    an expression appears to do is worth less than the name its author gave it.
  - Treat existing docs, code comments and anything that sounds settled as a
    LEAD, not evidence. Re-derive from the code. When the code contradicts a
    standing note, report it in "contradictions" rather than repeating the note.
  - State no rule as absolute until you have read every branch. A rule written
    without its branches reads as settled and is wrong.
  - HARD CAP 35 lines. Cut anything you cannot cite.

Write docs/context/${d.key}.md and nothing else.

Then run: node tools/context/check-context.mjs
It checks EVERY compass file while other agents are writing theirs, so it will
report problems that are not yours. Act ONLY on lines naming docs/context/${d.key}.md.
"unverified since" warnings are expected during a full run; ignore them.

Return the structured summary.`,
    { label: `analyse:${d.key}`, phase: 'Analyse', schema: ANALYST_SCHEMA },
  )

// `_prev` is the analyst's result and is deliberately discarded. A critic that
// can see the author's reasoning inherits the author's blind spot.
const critic = (_prev, d) =>
  agent(
    `You are an INDEPENDENT critic in the repository you are working in.

You did not write the file you are reviewing. You have deliberately NOT been given
the author's reasoning. Do not go looking for it. Re-derive the facts yourself.

File under review: docs/context/${d.key}.md
Domain: ${d.about}

Read the file. For EVERY factual claim, open the cited code and decide:
  - CONFIRMED - the cited code says exactly this
  - WRONG - the code contradicts it
  - OVERSTATED - true in the branch cited but written as a general rule, or true of one case and presented as the whole
  - UNCITED - asserted with nothing a reader could check

Weight your attention toward the failure modes that produce confident wrong docs:
  - A rule stated absolutely where the function takes options or branches. Read every branch.
  - A claim citing a bare expression rather than the name it is bound to. If the binding name disagrees with the description, that is WRONG, not a nitpick.
  - A claim that restates another document without independent support.
  - Counts, percentages and "only N of M" claims. Recount them.
  - A "deprecated" claim: grep for live readers before accepting it.
  - A fact that another compass file owns, re-derived here instead of linked.

Be adversarial. Default to reporting when unsure, and say so in "why". A file that
reads as settled and is wrong is worse than one with a gap.

Do NOT edit the file. Report only. Empty problems array if every claim holds.`,
    { label: `critique:${d.key}`, phase: 'Critique', schema: CRITIC_SCHEMA },
  )

// Returns null when the critic found nothing, so no agent is spawned at all.
const fixer = (review, d) => {
  if (!review || !review.problems || review.problems.length === 0) return null
  return agent(
    `Apply a critic's findings to one compass file.

File: docs/context/${d.key}.md
Format: tools/context/README.md. HARD CAP 35 lines.

The critic re-derived every claim from source independently. Their findings:

${JSON.stringify(review.problems, null, 2)}

Verify each finding yourself against the code, then either correct the file or
reject the finding with a reason. The critic can be wrong too. A WRONG or
OVERSTATED verdict that you confirm must be fixed, not softened into vagueness:
write the rule with its branches.

Stay under the cap. If a correction does not fit, cut something lower-value.

Then run node tools/context/check-context.mjs and make sure the lines naming YOUR
file are clean. Ignore other files and ignore "unverified since" warnings.

Edit only docs/context/${d.key}.md.`,
    { label: `fix:${d.key}`, phase: 'Fix', schema: FIX_SCHEMA },
  )
}

const results = DOMAINS.length ? await pipeline(DOMAINS, analyst, critic, fixer) : []

phase('Sweep check')

const misplaced = results
  .filter(Boolean)
  .flatMap((r) => (r && r.belongsElsewhere) || [])
  .filter((f) => f && f.fact && f.domain)

log(
  misplaced.length
    ? `${misplaced.length} fact(s) found for other domains; routing them to their owners.`
    : 'No out-of-domain facts to route.',
)

const routed = misplaced.length
  ? await agent(
      `Route facts to the compass file that owns them.

Each was found by an analyst mapping a DIFFERENT domain. They are true as far as
that analyst could tell, and they belong in the named file rather than the one
that found them.

${JSON.stringify(misplaced, null, 2)}

For each: verify it against the code yourself first - the finder was working on
something else and may have misread it. If it holds and the owning file does not
already say it, add it there. If the file is at the 35-line cap, cut something
lower-value rather than overflowing, and say what you cut.

Reject anything you cannot confirm, and say why. Then run
node tools/context/check-context.mjs and make sure there are no broken citations.

Report which facts you added, to which files, and which you rejected.`,
      { label: 'route-facts', phase: 'Sweep check' },
    )
  : null

const sweep = await agent(
  `Final check on the compass files in docs/context/.

Run: node tools/context/check-context.mjs
Every file must have zero BROKEN CITATIONS. Fix any that do not - format and
citations only, do not invent claims. "unverified since" warnings are expected
after a full run; ignore them.

Then assess the set as a whole and report in plain prose:
  1. Any file that is thin, vague or padded to look substantial. Name it.
  2. Contradictions BETWEEN compass files. Two files describing the same table,
     formula or rule differently is the exact failure this exists to prevent.
  3. Domains that clearly exist in this codebase but still have no compass file.
     Check docs/context/_generated/coverage.md.
  4. Facts still stated in several files that one file should own.
  5. Any "See also" link pointing nowhere useful.

Be specific and cite files.`,
  { label: 'sweep', phase: 'Sweep check' },
)

return {
  domains: DOMAINS.length,
  keys: DOMAINS.map((d) => d.key),
  fixesApplied: results.reduce((n, r) => n + (r && r.applied ? r.applied.length : 0), 0),
  misplacedFacts: misplaced.length,
  routed,
  sweep,
  perDomain: results,
}
