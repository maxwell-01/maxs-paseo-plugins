import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { listFlows } from "../shared/flows.shared";

const REFRESH_MS = 60_000;

export function useFlows() {
  const list = useRpc(listFlows);
  return useQuery({ queryKey: ["crew-flows", "flows"], queryFn: () => list({}), refetchInterval: REFRESH_MS });
}
