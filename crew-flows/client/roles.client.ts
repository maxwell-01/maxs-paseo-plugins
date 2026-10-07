import type { Flow, Stage } from "../shared/flows.shared";

const KNOWN_ROLES: { id: string; name: string; blurb: string }[] = [
  { id: "plan", name: "Planner", blurb: "Writes the plan the later stages build from." },
  { id: "plan-review", name: "Plan reviewer", blurb: "Gates the plan before any code is written." },
  { id: "develop", name: "Developer", blurb: "Builds the approved plan test-first and opens the PR." },
  { id: "code-review", name: "Code reviewer", blurb: "Gates the change before it ships." },
  { id: "qa", name: "QA", blurb: "Proves the acceptance criteria on a running environment." },
  { id: "deploy", name: "Deploy", blurb: "Ships to production behind a rollback point." },
  { id: "retro", name: "Retro", blurb: "Records what the run teaches about the process." },
];

export interface RoleVariant {
  flow: Flow;
  stage: Stage;
}

export interface Role {
  id: string;
  name: string;
  blurb: string | null;
  variants: RoleVariant[];
}

const capitalise = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

export function groupRoles(flows: Flow[], repo: string | null): Role[] {
  const roles = new Map<string, Role>();
  for (const known of KNOWN_ROLES) roles.set(known.id, { ...known, variants: [] });
  for (const flow of flows) {
    if (repo !== null && flow.name !== repo) continue;
    for (const stage of flow.stages) {
      const role = roles.get(stage.id)
        ?? { id: stage.id, name: capitalise(stage.id.replace(/-/g, " ")), blurb: null, variants: [] };
      roles.set(stage.id, role);
      role.variants.push({ flow, stage });
    }
  }
  return [...roles.values()].filter((role) => role.variants.length > 0);
}

export function modelLabel(model: string): string {
  const [provider, bare] = model.includes("/") ? model.split("/", 2) : ["claude", model];
  if (provider !== "claude") return `${bare} (${capitalise(provider)})`;
  const [family, ...version] = bare.replace(/^claude-/, "").split("-");
  return `${capitalise(family)} ${version.join(".")}`.trim();
}

export function stageEffects(flow: Flow, stage: Stage) {
  const persistence = stage.persist ? "persistent within a ticket, deleted after" : "fresh agent each time it runs";
  if (stage.always) return { persistence, onFail: "runs after any outcome", onPass: "runs after any outcome" };
  const flowStages = flow.stages.filter((s) => !s.always);
  const next = flowStages[flowStages.indexOf(stage) + 1];
  if (!stage.reviews) {
    return { persistence, onFail: "the run stops: nothing gates it", onPass: next ? `hands over to ${next.id}` : "the run ends" };
  }
  return {
    persistence,
    onFail: `findings go back to ${stage.reviews}; every stage from ${stage.reviews} re-runs, up to ${flow.maxRounds} rounds`,
    onPass: next ? `findings it still names carry to ${next.id}` : "findings it still names have no stage left to action them",
  };
}
