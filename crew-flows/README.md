# Crew & Flows

A [Paseo](https://paseo.sh) plugin that shows Max's agent teams: the ticket-loop workflows each repo
declares, the agent roles in them, and the runs and FirstMate crew working now. Requires **Paseo
0.10.3 or newer**.

## Where it reads from

It runs on one daemon and reads that machine only.

- **Workflows.** Every git repo directly under `/workspace` whose `origin/main` has
  `.claude/ticket-loop.json`. It reads `origin/main`, not the working tree, so a stale local checkout
  does not hide a loop. It never fetches; the view is as fresh as the last fetch.
- **Briefs.** A stage's brief from the same `origin/main`. A `skill:` brief, and the shared
  `craft.md`, come from the ticket-loop skill in
  `~/.claude/plugins/marketplaces/max-personal/claudeConfig/skills/ticket-loop`.

A manifest that does not parse, or a brief that is missing, is listed as a problem; the other
workflows still show.

## Develop

```bash
npm install
npm run typecheck
npm test
```
