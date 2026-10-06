import type { Flow, Stage } from "../shared/flows.shared";

export interface LoopBack {
  gate: string;
  target: string;
  from: number;
  to: number;
  lane: number;
}

// Short spans take the inner lanes, so a long loop-back is drawn around the short ones it spans.
export function loopBacks(stages: Stage[]): LoopBack[] {
  const flow = stages.filter((stage) => !stage.always);
  const spans = flow.flatMap((stage, to) => {
    const from = flow.findIndex((target) => target.id === stage.reviews);
    return stage.reviews && from >= 0 ? [{ gate: stage.id, target: stage.reviews, from, to }] : [];
  });
  const lanes: { from: number; to: number }[][] = [];
  const placed = [...spans].sort((a, b) => (a.to - a.from) - (b.to - b.from)).map((span) => {
    let lane = lanes.findIndex((taken) => taken.every((other) => span.to < other.from || span.from > other.to));
    if (lane < 0) lane = lanes.push([]) - 1;
    lanes[lane].push(span);
    return { ...span, lane };
  });
  return placed.sort((a, b) => a.to - b.to);
}

export function queueSummary({ queue }: Pick<Flow, "queue">): string {
  if (!queue) return "no queue: run one issue at a time";
  return [
    `queue: ${queue.repo}`,
    queue.labels.length ? `labelled ${queue.labels.join(", ")}` : null,
    queue.order ? `${queue.order} first` : null,
    queue.maxTickets === null ? null : `max ${queue.maxTickets} tickets`,
    queue.excludeLabels.length ? `skips ${queue.excludeLabels.join(", ")}` : null,
  ].filter(Boolean).join(", ");
}
