interface NoteLike {
  id: string;
  target?: string | null;
  debug?: { target?: string | null };
}

/**
 * The graph targets (components or edges) behind the notes lit elsewhere, and the stages they sit
 * on. `stageOf` resolves a target id to its stage; an edge belongs to its `from` component's stage.
 */
export function litTargets(
  litIds: ReadonlyMap<string, string>,
  pages: ReadonlyArray<{ intel_items?: ReadonlyArray<NoteLike> }>,
  stageOf: (targetId: string) => string | undefined
): { targets: Set<string>; stages: Set<string> } {
  const targets = new Set<string>();
  const stages = new Set<string>();
  if (litIds.size === 0) return { targets, stages };
  pages.forEach((page) =>
    (page.intel_items ?? []).forEach((item) => {
      const target = item.target || item.debug?.target;
      if (!target || !litIds.has(item.id)) return;
      targets.add(target);
      const stage = stageOf(target);
      if (stage) stages.add(stage);
    })
  );
  return { targets, stages };
}
