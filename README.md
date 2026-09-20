# Compass

Make a codebase's architecture explicit, so that changing one thing does not
silently break another.

A multi-agent workflow that reads your code and writes one short, cited file per
domain, plus deterministic scanners that keep those files honest. Built for
Claude Code. Adapted from Meta's write-up on mapping tribal knowledge in large
data pipelines.

## The problem

A codebase that grew fast carries three things no amount of reading fixes:

- The same business rule implemented in several places, with no way to tell
  which copy is authoritative.
- Schema nobody can safely delete, because nobody can prove it is unused.
- Downstream effects tracked in somebody's head.

The architecture is implicit. An agent can read every line and still not know
that one file is a hand copy of another, or that a column marked deprecated is
still read on a path that matters. It will then make a change that compiles, and
is wrong.

## The idea

Everything splits in two, and the split is the whole design.

| | Owned by | Why |
| --- | --- | --- |
| Facts a script can determine | **Detectors** | Scripts do not rot. Re-run them and the answer is current. |
| Facts a script cannot see | **Compass files** | Why a rule lives where it does, which copy is authoritative, which dead-looking thing is load bearing. |

Anything a scanner can work out is never written into prose. That single rule is
what stops the documentation decaying into confident, outdated sentences.

### The 35 line cap

Each compass file is capped at 35 lines, enforced by the validator. This is not
a style preference. A long context file is worse than none, because it crowds
out the code it describes. The cap forces a compass rather than an encyclopedia:
it names the four places a rule lives and tells you to diff them, it does not
contain them.

The cap does something else useful. When a file is full, adding a fact means
cutting one, which surfaces duplication automatically.

## Install

Requires Node 18+, git, and [Claude Code](https://claude.com/claude-code).

### Ask Claude Code to do it

The install needs judgment about your repository, so this is the better path.
Open Claude Code in your repo and paste:

> Set up https://github.com/crusadev/compass in this repository.
>
> Clone it to a temp directory, read its README, then copy `tools/context/` and
> the two skills in `.claude/skills/` into this repo. Do not copy its README,
> examples or git history.
>
> Then write a `compass.config.json` for THIS codebase rather than copying the
> example: look at the actual layout and work out which extensions are source,
> which paths are vendored or generated, and which paths must be excluded from
> usage counting - the schema definitions and any generated type dump, because
> those list every symbol whether or not anything reads it. If there is a
> Drizzle schema, set the adapter and `schemaDirs`; otherwise leave `schema`
> null.
>
> Set `coverageMinLines` to suit this codebase: the default of 400 assumes large
> files, and on a small repo it reports nothing, which reads as full coverage
> rather than a wrong threshold.
>
> Run `node tools/context/scan-coverage.mjs` and show me the result. Then
> propose a domain list from it and explain your reasoning, but do not write
> `compass.domains.json` until I have agreed to the domains.

The last line matters. Domain boundaries are the one decision the tool cannot
make for you, and a sweep built on a bad list produces files you will throw
away.

### Or do it by hand

Copy two directories into your repository:

```bash
cp -r compass/tools/context      your-repo/tools/context
cp -r compass/.claude/skills/*   your-repo/.claude/skills/
```

Then configure it:

```bash
cd your-repo
cp path/to/compass/compass.config.example.json  compass.config.json
cp path/to/compass/compass.domains.example.json compass.domains.json
mkdir -p docs/context/_generated
```

Edit `compass.config.json`. The fields that matter most:

- **`excludeFromUsage`** — paths that must not count as "something uses this".
  Your schema definitions, and any generated mirror of the codebase. An ORM type
  dump lists every column whether or not anything reads it, so counting hits
  there proves nothing.
- **`source`** — which extensions count as code.
- **`schema`** — leave `null` unless you use Drizzle, and check the contents
  rather than the folder name. A directory called `db/schema/` full of plain
  object literals is not Drizzle, and the adapter will parse nothing.
  Set `schemaDirs` alongside it.
- **`coverageMinLines`** — 400 suits a large codebase. On a smaller one it
  reports nothing, which looks like full coverage and is not.

Check it runs:

```bash
node tools/context/scan-coverage.mjs
```

## Define your domains

This is the one step nobody can do for you.

**A domain is the smallest thing someone would name when they say what they are
working on, that also owns at least one authoritative answer nobody else owns.**
Orders. Billing. Auth. Notifications.

The second half is the test. If the answer to *"what does this own?"* is
nothing, it is not a domain.

Three things that are **not** domains:

- **A layer.** "Frontend" is not a domain. Split by what it does, not where it runs.
- **A table.** Onboarding might span six of them and own none alone.
- **A file**, however large. A 7,000-line route file is a file.

Two tests that work in practice:

- **Can you write the one-line summary?** Every compass file opens with a single
  sentence saying what it owns. If you cannot write that sentence, the boundary
  is wrong.
- **Does 35 lines compress it or strain it?** Too small and it is a detail of
  something else. Too big and it needs splitting.

Seed the list from evidence rather than taste. `scan-coverage.mjs` ranks files
over 400 lines by how many compass files cite them; large-and-uncited is a blind
spot, and cited-by-many-but-named-after-none is a shared dependency nobody owns.
Cluster those into domains yourself. The detector produces the ranked list; the
clustering is a judgment call and stays one.

Expect to revise. Boundaries are a working hypothesis, not a taxonomy you get
right once.

## Run it

**1. Run the detectors.** They produce the evidence every agent starts from.

```bash
node tools/context/scan-coverage.mjs         # which code no compass file owns
node tools/context/scan-claim-conflicts.mjs  # two files, one line, different claims
node tools/context/scan-schema-usage.mjs     # only if you configured a schema adapter
```

Output lands in `docs/context/_generated/`. Nothing runs these automatically.

**2. Run the sweep.** See *Using it with Claude Code* below.

**3. Read the sweep check.** The final agent reports on thin files,
contradictions between files, and domains still uncovered. That report is where
the next round of work comes from.

## Using it with Claude Code

The skills live in `.claude/skills/`, which Claude Code reads from your
repository root. Start a session in the repo:

```bash
cd your-repo
claude
```

Both skills are then available as slash commands. Confirm with `/map-domain` —
if it does not autocomplete, the directory is in the wrong place. It must be
`.claude/skills/map-domain/SKILL.md` relative to the repo root, not nested in a
subfolder.

### One domain at a time

```
/map-domain orders
```

Claude reads the skill, follows the procedure, and writes `docs/context/orders.md`.
This is a single agent doing the analyst's job, with no critic behind it. Good
for starting out, for a domain you know well enough to check by eye, and for
refreshing one file after the code moves.

### The full sweep

The sweep is multi-agent and Claude Code will not start one unless you ask for
it, so say so plainly:

> Run a workflow using `tools/context/sweep.workflow.js`, and pass the contents
> of `compass.domains.json` as args.

Claude reads your domains file, calls the Workflow tool with that script and
those domains, and fans out. Watch it with `/workflows`.

For N domains it spawns roughly 2N agents plus a few, so **start with three or
four domains rather than thirty**. Look at what comes back, adjust your `about`
and `hints`, then run the rest. The agent count and the token cost both scale
linearly, and a bad prompt replicated across thirty domains is thirty files to
redo.

To regenerate a subset later, pass only those domains.

### Pointing everyday work at the results

Add this to your `CLAUDE.md` so agents read the files rather than ignoring them:

```markdown
## Domain context

`docs/context/<domain>.md` holds one short, cited note per domain: what it owns,
its non-obvious rules, and what else must change when you change it. Read the
relevant one BEFORE grepping, before opening files.

They are indexes, not specifications. Each is capped at 35 lines, so it names
the places a rule lives and tells you to read them. Read the compass, then read
the code. Never edit on the strength of a compass file alone.

A compass file is stale the moment you prove it wrong. Fix it in the same commit
as the code, or run `/map-domain <domain>` to rebuild it.
```

Without that, the files exist and nothing reads them.

### Keeping them honest

```
/audit-domain
```

Re-derives claims whose cited code has changed since the claim was written, and
resolves disagreements between files. Nothing schedules it; run it when the
validator starts reporting stale claims.

## What you get

```
docs/context/
  orders.md              one per domain, 35 lines, every claim cited
  billing.md
  auth.md
  _generated/
    coverage.md          which code no compass file owns
    claim-conflicts.md   where two files describe one line differently
    schema-usage.md      dead tables and columns (optional)
```

Each compass file has a fixed shape: what the domain owns, the non-obvious
rules, what else must change when you change it, key files, links to neighbours.

## How the sweep works

```
Step 0: run the detectors (deterministic, no agents)

Then per domain, independently:

  ANALYST  ->  CRITIC  ->  FIXER (only if the critic found something)
                  |
                  +-- all domains -->  ROUTE FACTS  ->  SWEEP CHECK
```

It is a pipeline, not a barrier: one domain can be in critique while another is
still being analysed.

**Analyst.** One per domain. Reads the `map-domain` skill, the format rules and
the detector output. Answers five fixed questions, writes one file under the
cap. Returns what it found, including `belongsElsewhere` — facts that belong to
a different domain's file.

The five questions, each aimed at one failure:

1. What does this domain own? *(source-of-truth confusion)*
2. What is the non-obvious logic, and is it duplicated? *(duplicated rules)*
3. Who outside reads or writes this? *(implicit coupling)*
4. Change X here, what else must change? *(hand-tracked downstream effects)*
5. What is deprecated but load bearing? *(dead-looking code that is not)*

**Critic.** One per domain. Gets the domain name and the file path. **Nothing
else.** Never the analyst's reasoning, and told not to go looking for it. It
re-opens every cited file and grades each claim CONFIRMED, WRONG, OVERSTATED or
UNCITED. It cannot edit.

This blindness is the most important decision in the design. A reviewer who can
see the author's reasoning inherits the author's blind spot. In the codebase
this was built for, self-review passed a file stating a conditional rule as an
absolute one; an independent pass caught it immediately.

**Fixer.** Only spawns where the critic found something — returning `null` means
no agent at all. It verifies each finding itself first, because critics are
wrong too, then edits one file and reports what it rejected.

**Route facts.** An analyst owns one file and cannot write a neighbour's, so a
fact about another domain would otherwise be dropped or put in the wrong place.
This agent verifies each one and files it with the owner.

**Sweep check.** One agent at the end, the only one that sees the whole set.
Contradictions *between* files surface here and nowhere else, because no
per-domain agent can see two domains.

## Keeping it true

`check-context.mjs` does two separate jobs, and the distinction matters:

- **Fails** on a citation that no longer resolves: missing path, line past end
  of file, unknown column, ambiguous bare filename, file over the cap.
- **Warns** when a cited file was committed after the compass file was. The
  claim may still be true; nothing has checked it since the code moved.

```bash
node tools/context/check-context.mjs
```

**It proves citations resolve. It never proves a claim is true.** A sentence can
be flatly false with a perfect citation and pass. That is not a gap to fix:
deciding whether an English sentence correctly describes a program is the same
class of problem as verifying the program.

Truth gets checked a different way. Anyone working in an area with the compass
file open reads both it and the code, so disagreements become visible.
`/audit-domain` makes that deliberate: it re-derives claims whose code has moved
and resolves conflicts between files.

Its most important instruction is the split between *the doc is wrong* (fix it)
and *the code is wrong* (record it, report it, do not fix it). Whether a
divergence should be resolved one way or the other is usually a product
decision, not a documentation task.

Wire `check-context.mjs` into CI if you want a hard gate. Nothing here does that
for you.

## Adapting it

**Another ORM.** `tools/context/lib/schema.mjs` parses Drizzle `pgTable`
declarations by walking braces. Replace `parseTables()` with something that
returns the same shape — `{ symbol, name, columns: [{ key, dbName }] }` — and
`scan-schema-usage.mjs` works unchanged. Set `"schema"` in the config to enable it.

**No ORM.** Leave `"schema": null`. The schema scanner exits quietly and
everything else works.

**A different documentation layout.** `contextDir` and `generatedDir` in the
config. Nothing else hardcodes a path.

**Pointing agents at it.** Add a short section to your `CLAUDE.md` telling
agents to read `docs/context/<domain>.md` before grepping, and that the files
are indexes rather than specifications: read the compass, then read the code.

## Known limits

Worth being honest about these before you adopt it.

- **The validator checks citations, not truth.** See above.
- **Domain clustering is a judgment call.** The coverage detector produces a
  ranked list of files. Grouping them into domains is not mechanical and I do
  not think it can be.
- **Most claims are agent-derived.** A blind critic catches a lot and not
  everything. Treat the files as a strong map, not verified fact.
- **Yield drops over time.** The first sweep reads everything for the first time
  and finds a backlog. Steady state is bounded by how much the code changes. An
  audit that comes back empty is the system working.
- **Nothing is scheduled.** The detectors, the sweep and the audit are all
  manual. The staleness queue refills on its own; noticing it does not.

