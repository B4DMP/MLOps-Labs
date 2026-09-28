"""Keep the MLOps graph cheap to change: find, rename and retire graph ids across all game config.

Stdlib only, so it runs anywhere:

    python tools/graph_refactor.py refs data.validation       every place that references an id
    python tools/graph_refactor.py usage                      reference count per id, unused ids first
    python tools/graph_refactor.py check                      references to ids the graph does not define
    python tools/graph_refactor.py rename OLD NEW [--dry-run] rewrite every reference, keep an alias
    python tools/graph_refactor.py retire ID [--dry-run]      drop a component (and its edges) or an edge

Renames and retirements are recorded in MlopsGraph.json (`aliases`, `retired`) so players'
logged graph ops keep replaying after the change.
"""

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

GRAPH_FILE = "MlopsGraph.json"
ID_LIKE = re.compile(r"^(?:e\.[a-z0-9_]+|(?:req|data|model|deploy|ops|gov)\.[a-z0-9_]+(?:\.[a-z0-9_]+)?)$")


def default_config_dir() -> Path:
    here = Path(__file__).resolve()
    for candidate in (here.parents[2] / "gameConfig", Path("/gameConfig")):
        if (candidate / GRAPH_FILE).exists():
            return candidate
    raise SystemExit("gameConfig directory not found, pass --config")


@dataclass
class Ref:
    file: str
    path: str
    kind: str  # "value", "key", "attr" (a "component.attr" value)
    text: str


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def graph_ids(config: Path) -> tuple[set[str], set[str]]:
    graph = load_json(config / GRAPH_FILE)
    return {c["id"] for c in graph["components"]}, {e["id"] for e in graph["edges"]}


def _walk(node: Any, path: str = "$") -> Iterator[tuple[str, str, Any]]:
    """Yields (path, "key" | "value", text) for every string key and string value."""
    if isinstance(node, dict):
        for k, v in node.items():
            yield f"{path}.{k}", "key", k
            yield from _walk(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _walk(v, f"{path}[{i}]")
    elif isinstance(node, str):
        yield path, "value", node


def find_refs(config: Path, target: str) -> list[Ref]:
    refs = []
    for file in sorted(config.glob("*.json")):
        for path, kind, text in _walk(load_json(file)):
            if text == target:
                refs.append(Ref(file.name, path, kind, text))
            elif kind == "value" and text.startswith(target + ".") and text.count(".") == target.count(".") + 1:
                refs.append(Ref(file.name, path, "attr", text))
    return refs


def usage(config: Path) -> dict[str, int]:
    components, edges = graph_ids(config)
    counts = {i: 0 for i in components | edges}
    for file in sorted(config.glob("*.json")):
        for path, kind, text in _walk(load_json(file)):
            if file.name == GRAPH_FILE and path.endswith(".id"):
                continue  # the definition itself is not a use
            if text in counts:
                counts[text] += 1
            elif kind == "value" and text.rpartition(".")[0] in components:
                counts[text.rpartition(".")[0]] += 1
    return counts


def check(config: Path) -> list[Ref]:
    """Id-shaped strings that the graph does not define (dangling references)."""
    components, edges = graph_ids(config)
    graph = load_json(config / GRAPH_FILE)
    known = components | edges | set(graph.get("aliases", {})) | set(graph.get("retired", []))
    dangling = []
    for file in sorted(config.glob("*.json")):
        for path, kind, text in _walk(load_json(file)):
            if not ID_LIKE.match(text) or text in known:
                continue
            if text.rpartition(".")[0] in components:
                continue  # component.attr reference
            dangling.append(Ref(file.name, path, kind, text))
    return dangling


def _rewrite(node: Any, old: str, new: str) -> tuple[Any, int]:
    changed = 0
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if k == old:
                k, changed = new, changed + 1
            v, n = _rewrite(v, old, new)
            out[k] = v
            changed += n
        return out, changed
    if isinstance(node, list):
        out_list = []
        for v in node:
            v, n = _rewrite(v, old, new)
            out_list.append(v)
            changed += n
        return out_list, changed
    if isinstance(node, str):
        if node == old:
            return new, 1
        if node.startswith(old + ".") and node.count(".") == old.count(".") + 1:
            return new + node[len(old):], 1
    return node, 0


def rename(config: Path, old: str, new: str, dry_run: bool = False) -> dict[str, int]:
    components, edges = graph_ids(config)
    if old not in components | edges:
        raise SystemExit(f"'{old}' is not a component or edge id")
    if new in components | edges:
        raise SystemExit(f"'{new}' already exists")
    if (old in edges) != new.startswith("e."):
        raise SystemExit("edge ids start with 'e.', component ids must not")

    changes: dict[str, int] = {}
    for file in sorted(config.glob("*.json")):
        data, n = _rewrite(load_json(file), old, new)
        if file.name == GRAPH_FILE:
            aliases = {k: (new if v == old else v) for k, v in data.get("aliases", {}).items()}
            aliases[old] = new
            data["aliases"] = aliases
            if old in components and old.split(".")[0] != new.split(".")[0]:
                for c in data["components"]:
                    if c["id"] == new:
                        c["stage_id"] = new.split(".")[0]
        if n:
            changes[file.name] = n
            if not dry_run:
                write_json(file, data)
        elif file.name == GRAPH_FILE and not dry_run:
            write_json(file, data)
    return changes


def retire(config: Path, target: str, dry_run: bool = False) -> tuple[list[str], list[Ref]]:
    """Removes a component with all its edges, or a single edge. Returns removed ids and the
    references left in other files, which must be fixed by hand (run `check`)."""
    graph = load_json(config / GRAPH_FILE)
    components, edges = graph_ids(config)
    if target in components:
        removed = [target] + [e["id"] for e in graph["edges"] if target in (e["from"], e["to"])]
    elif target in edges:
        removed = [target]
    else:
        raise SystemExit(f"'{target}' is not a component or edge id")

    graph["components"] = [c for c in graph["components"] if c["id"] not in removed]
    graph["edges"] = [e for e in graph["edges"] if e["id"] not in removed]
    graph["retired"] = sorted(set(graph.get("retired", [])) | set(removed))
    graph["aliases"] = {k: v for k, v in graph.get("aliases", {}).items() if v not in removed}

    leftovers = [
        r for rid in removed for r in find_refs(config, rid) if r.file != GRAPH_FILE
    ]
    if not dry_run:
        write_json(config / GRAPH_FILE, graph)
    return removed, leftovers


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", type=Path, default=None, help="gameConfig directory")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("refs").add_argument("id")
    sub.add_parser("usage")
    sub.add_parser("check")
    p_rename = sub.add_parser("rename")
    p_rename.add_argument("old")
    p_rename.add_argument("new")
    p_rename.add_argument("--dry-run", action="store_true")
    p_retire = sub.add_parser("retire")
    p_retire.add_argument("id")
    p_retire.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    config = args.config or default_config_dir()

    if args.cmd == "refs":
        refs = find_refs(config, args.id)
        for r in refs:
            print(f"{r.file:40} {r.kind:5} {r.path}")
        print(f"{len(refs)} references")
    elif args.cmd == "usage":
        for rid, n in sorted(usage(config).items(), key=lambda kv: (kv[1], kv[0])):
            print(f"{n:4}  {rid}")
    elif args.cmd == "check":
        dangling = check(config)
        for r in dangling:
            print(f"{r.file:40} {r.text:40} {r.path}")
        print(f"{len(dangling)} dangling references")
        return 1 if dangling else 0
    elif args.cmd == "rename":
        changes = rename(config, args.old, args.new, args.dry_run)
        for file, n in changes.items():
            print(f"{file:40} {n} rewritten")
        print(("would alias " if args.dry_run else "aliased ") + f"{args.old} -> {args.new}")
    elif args.cmd == "retire":
        removed, leftovers = retire(config, args.id, args.dry_run)
        print(("would retire: " if args.dry_run else "retired: ") + ", ".join(removed))
        for r in leftovers:
            print(f"  still referenced: {r.file} {r.path} ({r.text})")
        return 1 if leftovers else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
