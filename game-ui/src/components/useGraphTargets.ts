import { useEffect, useState } from "react";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";

export type GraphTargets = Record<string, { name: string; icon?: string; edge?: boolean }>;

interface GraphStateSlice {
  technical?: Record<string, {
    components?: Array<{ id: string; name: string; icon?: string }>;
    edges?: Array<{ id: string; from_id: string; to_id: string }>;
  }>;
}

/** What each graph target is called and looks like, so a note can show the step it is about. */
export function useGraphTargets(enabled: boolean, phase: number): GraphTargets {
  const { emit, subscribe } = useGameWebSocket();
  const [targets, setTargets] = useState<GraphTargets>({});

  useEffect(() => {
    if (!enabled) return;
    emit("graph:state_request", { phase_id: phase });
    return subscribe("graph:state", (data: GraphStateSlice) => {
      const stages = Object.values(data?.technical ?? {});
      const names: Record<string, string> = {};
      const next: GraphTargets = {};
      stages.forEach((s) => (s.components ?? []).forEach((c) => {
        names[c.id] = c.name;
        next[c.id] = { name: c.name, icon: c.icon };
      }));
      stages.forEach((s) => (s.edges ?? []).forEach((e) => {
        next[e.id] = {
          name: `Hand-over from ${names[e.from_id] ?? e.from_id} to ${names[e.to_id] ?? e.to_id}`,
          icon: "ph:flow-arrow-bold",
          edge: true,
        };
      }));
      setTargets((prev) => ({ ...prev, ...next }));
    });
  }, [enabled, phase, emit, subscribe]);

  return targets;
}
