# Crew & Flows

A [Paseo](https://paseo.sh) plugin that shows Max's agent teams: the ticket-loop workflows each repo
declares, the agent roles in them, and the runs and FirstMate crew working now. Requires **Paseo
0.10.3 or newer**.

## The three tabs

- **Teams.** Each ticket-loop run, from its state folder: every stage with its latest verdict and
  live agent, what the current agent last said, and the run log. Below that, the FirstMate first
  mate and its crew, each with its last status line. Open jumps to an agent in Paseo; Send a note
  posts a follow-up to it. Refreshes every 5 seconds.
- **Workflows.** Each repo's loop as a diagram: stages in order, persistent or fresh, gates, the
  always stages, and each FAIL loop-back with its round limit.
- **Agents.** Each stage role compared across the repos that run it.

## Where it reads from

It runs on one daemon and reads that machine only. Change the folders in **Settings → Plugins →
crew-flows → Crew & Flows**.

- **Workflows.** Every git repo directly inside the repo folders (default `/workspace`) whose
  `origin/main` has `.claude/ticket-loop.json`. It reads `origin/main`, not the working tree, so a
  stale local checkout does not hide a loop. It never fetches; the view is as fresh as the last fetch.
- **Briefs.** A stage's brief from the same `origin/main`. A `skill:` brief, and the shared
  `craft.md`, come from the ticket-loop skill folder (default
  `~/.claude/plugins/marketplaces/max-personal/claudeConfig/skills/ticket-loop`).
- **Runs.** Each `*-state` folder in the run state folder (default `/workspace/.ticket-loop`). A run
  finds its agents by their `ticket-loop.run` label, or by the agent map in its beacon.
- **Crew.** Agents labelled `firstmate.role`. A crewmate's state is the `<state>: <line>` its last
  turn ended with; reading it follows FirstMate's own `closingText` (MIT).

A manifest that does not parse, a brief that is missing, or a state folder that cannot be read is
listed as a problem; the rest still shows.

## Develop

```bash
npm install
npm run typecheck
npm test
```
