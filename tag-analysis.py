#!/usr/bin/env python3
"""
tag_tree.py

Builds a TREE (forest) of your tags based on subset relationships instead of
flat clustering. The idea:

    - If tweets tagged B are almost always ALSO tagged A, but not vice versa,
      then B behaves like a sub-category of A  ->  A is B's parent.
    - If B and A almost always appear together in BOTH directions, they're
      near-duplicate/alias tags (e.g. "art" + "2d-art") -> flagged separately,
      not nested, so you can decide whether to merge them.
    - Tags with no qualifying parent are ROOT CANDIDATES.
    - Among root candidates: if a tag has children, it stays a root (it's a
      real top-level folder). If it has NO children AND it co-occurs across
      many *different* other roots (instead of staying in its own lane), it's
      reclassified as DESCRIPTIVE (e.g. "cute", "see-later") rather than a
      tree node.
    - Tags below --min-count are set aside as RARE before any of this runs.

    - Optional --force-tree flag: disables the descriptive bucket entirely,
      AND switches parent assignment from "single smallest superset" to
      "every qualifying superset". This lets a tag like "minecraft" that's
      genuinely a subset of BOTH "art" and "gamedev" show up as a child under
      both branches (a DAG rendered as a tree, with that node duplicated in
      the printout/JSON once per parent) instead of being pushed off into the
      descriptive list or forced to pick just one parent.

If the export has a settings.tagGroupAssignments map (your existing manual
tag groups), it's loaded automatically and used two ways:

    1. Every tag printed anywhere is annotated with its manual group, e.g.
       "minecraft (563) [Source/Game]", so you can eyeball how well the
       data-driven structure lines up with your existing groups.
    2. A GROUP CONSISTENCY REPORT shows, per manual group, how its member
       tags actually got classified (tree node / descriptive / alias / rare),
       and labels each group "folder-like", "descriptor-like", or "mixed"
       based on that split -- directly answering "which of my groups are
       actually consistent vs. a grab-bag."
    3. Optional --group-roots flag: for groups that come back "folder-like",
       wraps their discovered ROOT tags under a synthetic top-level node
       named after the group (e.g. a "[Source/Game]" node containing
       "minecraft", "zelda", "pokemon", etc. as its children), giving you a
       ready-made top folder layer wherever your manual groups and the data
       already agree. Mixed / descriptor-like groups are left alone rather
       than forced into this.
    4. Optional --group-override / --group-overrides-file: manually force a
       group's verdict instead of trusting the automatic classification --
       e.g. --group-override "Quality=descriptive" pulls every "Quality"
       member tag out of the tree even if some happened to look root-like,
       and --group-override "Source/Game=folder" pulls every member into the
       tree even if some looked too spread-out. Only affects the root-vs-
       descriptive decision, not genuine nested subset relationships found in
       the data. Any tag whose placement was changed this way is marked with
       a "*" next to its group name wherever it's printed.

Output: an indented tree printout, a list of alias/merge-candidate pairs, a
list of descriptive tags (empty if --force-tree is set), a list of rare
tags, and (if group data is present) a group consistency report. Also
optional JSON dump of the tree structure for use elsewhere (e.g. to actually
build folders).

Usage:
    python3 tag_tree.py export.json
    python3 tag_tree.py export.json --min-count 3 --parent-thresh 0.8 --merge-thresh 0.9 --pmi-thresh -0.4
    python3 tag_tree.py export.json --force-tree
    python3 tag_tree.py export.json --group-roots
    python3 tag_tree.py export.json --group-override "Quality=descriptive" --group-override "Source/Game=folder"
    python3 tag_tree.py export.json --group-overrides-file overrides.json --group-roots
    python3 tag_tree.py export.json --json-out tree.json
"""

import argparse
import json
import math
import sys
from collections import defaultdict


def load_tagsets(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    tweets = data.get("tweets", [])
    tag_to_tweets = defaultdict(set)
    for i, t in enumerate(tweets):
        tags = t.get("tags") or []
        for tag in tags:
            tag = str(tag)
            if tag:
                tag_to_tweets[tag].add(i)
    tag_group = dict(data.get("settings", {}).get("tagGroupAssignments", {}) or {})
    return tag_to_tweets, len(tweets), tag_group


def tag_label(tag, counts, tag_group, overridden_tags=None):
    group = tag_group.get(tag)
    star = "*" if overridden_tags and tag in overridden_tags else ""
    group_note = f" [{group}{star}]" if group else ""
    return f"{tag} ({counts[tag]}){group_note}"


def parse_overrides(cli_overrides, overrides_file):
    """
    Build {group_name: 'folder'|'descriptive'} from --group-override entries
    (list of 'Group=folder' strings) and/or a --group-overrides-file JSON
    ({"Group": "folder", ...}). CLI entries win if the same group appears in
    both.
    """
    overrides = {}
    if overrides_file:
        with open(overrides_file, "r", encoding="utf-8") as f:
            file_overrides = json.load(f)
        for k, v in file_overrides.items():
            v = str(v).strip().lower()
            if v not in ("folder", "descriptive"):
                print(f"Warning: unknown override value '{v}' for group '{k}' in {overrides_file}, ignoring",
                      file=sys.stderr)
                continue
            overrides[k] = v
    for item in (cli_overrides or []):
        if "=" not in item:
            print(f"Warning: malformed --group-override '{item}', expected Group=folder|descriptive",
                  file=sys.stderr)
            continue
        k, v = item.split("=", 1)
        k, v = k.strip(), v.strip().lower()
        if v not in ("folder", "descriptive"):
            print(f"Warning: unknown override value '{v}' for group '{k}', ignoring", file=sys.stderr)
            continue
        overrides[k] = v
    return overrides


def apply_group_overrides(true_roots, descriptive, children_of, tag_group, overrides):
    """
    Reclassify root-candidate tags according to manual group overrides:
      - group forced 'folder': any currently-descriptive member becomes a true root.
      - group forced 'descriptive': any currently-root member (with or without
        children) becomes descriptive; if it had children, they're promoted to
        top-level roots rather than orphaned.
    Only touches tags that were root candidates in the first place (i.e. either
    a true root or in the descriptive bucket) -- tags nested via a real subset
    relationship are left untouched, since overriding genuine containment data
    would be arbitrary rather than principled.
    Returns (true_roots, descriptive, children_of, overridden_tags) -- all new
    objects; inputs are not mutated. Note: this is a single pass, so a child
    promoted out of a demoted parent is not itself re-checked against its own
    group's override in the same run (rare edge case; override that child's
    group too if you need the cascade).
    """
    if not overrides:
        return list(true_roots), list(descriptive), children_of, set()

    true_root_set = set(true_roots)
    descriptive_set = set(descriptive)
    new_children_of = defaultdict(list, {k: list(v) for k, v in children_of.items()})
    overridden_tags = set()

    # folder override: promote childless descriptive tags into the tree
    for tag in list(descriptive_set):
        group = tag_group.get(tag)
        if group and overrides.get(group) == "folder":
            descriptive_set.discard(tag)
            true_root_set.add(tag)
            overridden_tags.add(tag)

    # descriptive override: demote roots (promoting any children up) out of the tree
    for tag in list(true_root_set):
        group = tag_group.get(tag)
        if group and overrides.get(group) == "descriptive":
            true_root_set.discard(tag)
            descriptive_set.add(tag)
            overridden_tags.add(tag)
            kids = new_children_of.pop(tag, [])
            for c in kids:
                true_root_set.add(c)

    return list(true_root_set), list(descriptive_set), new_children_of, overridden_tags


def containment(a_set, b_set):
    """Fraction of a_set that is also in b_set: |a ∩ b| / |a|"""
    if not a_set:
        return 0.0
    return len(a_set & b_set) / len(a_set)


def avg_pmi_vs_set(tag, other_tags, tag_to_tweets, n_total, alpha=0.5):
    """
    Average pointwise mutual information between `tag` and every tag in
    `other_tags` (excluding itself), computed over ALL pairs -- including
    pairs that never co-occur, which is the point: a true category tag
    should be strongly UNDER-represented (very negative PMI) against most
    other categories precisely because it almost never co-occurs with them,
    not just among the few tags it happens to share a tweet with.
    Additive smoothing (alpha) avoids log(0) for zero co-occurrence pairs
    while still letting them pull the average sharply negative.
    """
    tset = tag_to_tweets[tag]
    ta = len(tset)
    if ta == 0:
        return 0.0
    pmis = []
    for other in other_tags:
        if other == tag:
            continue
        oset = tag_to_tweets[other]
        oc = len(oset)
        if oc == 0:
            continue
        co = len(tset & oset)
        expected = (ta * oc) / n_total
        pmi = math.log((co + alpha) / (expected + alpha))
        pmis.append(pmi)
    if not pmis:
        return 0.0
    return sum(pmis) / len(pmis)


def outranks(tag_to_tweets, a, b):
    """
    True if 'a' is allowed to be a parent candidate of 'b' from a pure
    size/ordering standpoint: a must be at least as frequent as b, and ties
    are broken alphabetically. This gives a consistent total order (count
    desc, then name asc) that every parent->child edge respects, which is
    what keeps the multi-parent DAG mode (--force-tree) cycle-free even
    with several qualifying parents per tag.
    """
    ca, cb = len(tag_to_tweets[a]), len(tag_to_tweets[b])
    if ca != cb:
        return ca > cb
    return a < b


def build_tree(tag_to_tweets, n_tweets, min_count, parent_thresh, merge_thresh, force_tree=False):
    tags = [t for t, s in tag_to_tweets.items() if len(s) >= min_count]
    rare = [t for t, s in tag_to_tweets.items() if len(s) < min_count]

    # 1. Pairwise containment
    contain = {}  # (b, a) -> fraction of b's tweets that are also a
    for b in tags:
        for a in tags:
            if a == b:
                continue
            contain[(b, a)] = containment(tag_to_tweets[b], tag_to_tweets[a])

    # 2. Alias / merge pairs: mutual high containment. Use unordered pair,
    #    keep the more frequent tag as "primary" for tie-breaking / display.
    alias_pairs = []
    aliased = set()  # tags that are the *secondary* half of an alias pair
    seen_pairs = set()
    for b in tags:
        for a in tags:
            if a == b:
                continue
            pair_key = frozenset((a, b))
            if pair_key in seen_pairs:
                continue
            if contain.get((b, a), 0) >= merge_thresh and contain.get((a, b), 0) >= merge_thresh:
                seen_pairs.add(pair_key)
                primary, secondary = (a, b) if len(tag_to_tweets[a]) >= len(tag_to_tweets[b]) else (b, a)
                alias_pairs.append((primary, secondary,
                                     contain[(secondary, primary)], contain[(primary, secondary)]))
                aliased.add(secondary)

    # 3. Parent candidates for each non-aliased-secondary tag: other tags it's
    #    (mostly) contained in, above threshold, excluding its own alias partner.
    #    Default: pick the smallest qualifying superset as the ONE immediate parent.
    #    --force-tree: keep ALL qualifying supersets as parents (multi-parent DAG).
    parent_of = defaultdict(list)  # tag -> list of parent tags (len 1 unless force_tree)
    alias_partner = {}
    for primary, secondary, _, _ in alias_pairs:
        alias_partner[secondary] = primary
        alias_partner[primary] = secondary

    for b in tags:
        if b in aliased:
            continue  # secondary alias tags don't get their own tree slot
        candidates = []
        for a in tags:
            if a == b or a in aliased:
                continue
            if alias_partner.get(b) == a:
                continue
            score = contain.get((b, a), 0)
            if score >= parent_thresh and outranks(tag_to_tweets, a, b):
                candidates.append((a, score, len(tag_to_tweets[a])))
        if not candidates:
            continue
        if force_tree:
            # keep every qualifying parent
            for a, score, cnt in candidates:
                parent_of[b].append(a)
        else:
            # smallest qualifying superset = most specific single immediate parent
            candidates.sort(key=lambda x: x[2])
            parent_of[b].append(candidates[0][0])

    # 4. Build children map, detect roots
    children_of = defaultdict(list)
    for b, parents in parent_of.items():
        for a in parents:
            children_of[a].append(b)

    all_tree_tags = [t for t in tags if t not in aliased]
    roots = [t for t in all_tree_tags if not parent_of.get(t)]

    # 5. Among roots: split into "true category roots" vs "descriptive".
    #    Skipped entirely when force_tree is set -- every root is kept as a
    #    real tree root, per the --force-tree contract of "no descriptive bucket".
    #
    #    IMPORTANT: this compares each childless root against the FULL root
    #    candidate pool (which, at this point, still includes eventual
    #    descriptors -- they haven't been separated out yet). That's fine
    #    for the PMI check specifically because it's symmetric: a true
    #    category tag ends up with a strongly negative average PMI against
    #    the pool (it rarely co-occurs with almost everything in it, since
    #    most of the pool are OTHER categories it's mutually exclusive
    #    with), while a real descriptor's average PMI sits close to zero
    #    (it co-occurs with everything in the pool at roughly the rate
    #    chance would predict). A naive "count any co-occurrence as spread"
    #    check does NOT have this property -- it can't tell "rarely
    #    co-occurs with almost everything, but happens to touch one
    #    descriptor a few times" apart from "co-occurs broadly" -- which is
    #    exactly the failure mode this PMI version fixes.
    root_set = set(roots)
    descriptive = []
    true_roots = []
    if force_tree:
        true_roots = list(roots)
    else:
        for r in roots:
            if children_of.get(r):
                true_roots.append(r)
                continue
            avg_pmi = avg_pmi_vs_set(r, root_set, tag_to_tweets, n_tweets)
            descriptive.append((r, avg_pmi))  # thresholding happens in finalize_descriptive

    return {
        "tags": tags,
        "rare": rare,
        "alias_pairs": alias_pairs,
        "parent_of": parent_of,
        "children_of": children_of,
        "roots_raw": roots,
        "true_roots": true_roots,
        "descriptive_raw": descriptive,  # (tag, spread) before threshold filter
        "counts": {t: len(s) for t, s in tag_to_tweets.items()},
        "force_tree": force_tree,
    }


def finalize_descriptive(result, pmi_thresh):
    """
    Apply the --pmi-thresh cutoff to decide final descriptive vs true-root
    split. Each childless root candidate carries an avg_pmi score (see
    avg_pmi_vs_set): scores <= pmi_thresh (i.e. clearly under-represented
    against the other root candidates, on average) stay a true root;
    everything else becomes descriptive. No-op passthrough when force_tree
    was used (descriptive_raw is already empty in that case).
    """
    descriptive = []
    true_roots = list(result["true_roots"])
    for tag, avg_pmi in result["descriptive_raw"]:
        if avg_pmi <= pmi_thresh:
            true_roots.append(tag)
        else:
            descriptive.append(tag)
    true_roots = sorted(true_roots, key=lambda t: -result["counts"][t])
    descriptive = sorted(descriptive, key=lambda t: -result["counts"][t])
    # stash for build_group_report to consume without recomputation
    result["_descriptive_final"] = descriptive
    result["true_roots_set"] = set(true_roots)
    return true_roots, descriptive


def print_tree(tag, children_of, counts, depth=0, alias_map=None, tag_group=None,
                synthetic=False, overridden_tags=None):
    prefix = "  " * depth + ("└─ " if depth > 0 else "")
    alias_note = ""
    if alias_map and tag in alias_map:
        alias_note = f"  [alias: {alias_map[tag]}]"
    if synthetic:
        print(f"{prefix}[{tag}]  (synthetic group node)")
    else:
        print(f"{prefix}{tag_label(tag, counts, tag_group or {}, overridden_tags)}{alias_note}")
    for child in sorted(children_of.get(tag, []), key=lambda c: -counts[c]):
        print_tree(child, children_of, counts, depth + 1, alias_map, tag_group,
                   overridden_tags=overridden_tags)


def build_group_report(result, tag_group, true_roots, descriptive, children_of, overrides=None):
    """
    For each manual tag group, classify every member tag (that made it past
    --min-count) as one of: tree (root or nested node), descriptive, alias
    (secondary/duplicate half of a pair), or rare. Then label the group
    folder-like / descriptor-like / mixed based on the tree-vs-descriptive
    split -- unless the group has a manual override, in which case that
    verdict is used directly and flagged "(user override)".
    Tags not present in tag_group, or present but never used, are ignored here.
    """
    overrides = overrides or {}
    tags = set(result["tags"])
    aliased = {s for _, s, _, _ in result["alias_pairs"]}
    in_tree = set(result["parent_of"].keys()) | set(children_of.keys()) | set(true_roots)
    descriptive_set = set(descriptive)

    group_members = defaultdict(list)
    for tag, group in tag_group.items():
        group_members[group].append(tag)

    report = {}
    for group, members in group_members.items():
        buckets = {"tree": [], "descriptive": [], "alias": [], "rare": [], "unused": []}
        for tag in members:
            if tag in aliased:
                buckets["alias"].append(tag)
            elif tag in descriptive_set:
                buckets["descriptive"].append(tag)
            elif tag in in_tree:
                buckets["tree"].append(tag)
            elif tag in tags:
                buckets["tree"].append(tag)
            elif tag in result["rare"]:
                buckets["rare"].append(tag)
            else:
                buckets["unused"].append(tag)  # tag in group map but 0 occurrences in data

        if group in overrides:
            verdict = ("folder-like" if overrides[group] == "folder" else "descriptor-like") + "  [user override]"
        else:
            scored = len(buckets["tree"]) + len(buckets["descriptive"])
            if scored == 0:
                verdict = "n/a (no classified members)"
            else:
                tree_frac = len(buckets["tree"]) / scored
                if tree_frac >= 0.8:
                    verdict = "folder-like"
                elif tree_frac <= 0.2:
                    verdict = "descriptor-like"
                else:
                    verdict = "mixed"
        report[group] = {"buckets": buckets, "verdict": verdict}
    return report


def print_group_report(report, counts, overridden_tags=None):
    overridden_tags = overridden_tags or set()

    def mark(t):
        return t + ("*" if t in overridden_tags else "")

    print("\n===== GROUP CONSISTENCY REPORT =====")
    if overridden_tags:
        print("  (* = this tag's tree/descriptive placement was set via --group-override)")
    for group in sorted(report.keys(), key=lambda g: g):
        info = report[group]
        b = info["buckets"]
        print(f"\n  {group}  ->  {info['verdict']}")
        if b["tree"]:
            print(f"    tree:        {', '.join(mark(t) for t in sorted(b['tree'], key=lambda t: -counts.get(t, 0)))}")
        if b["descriptive"]:
            print(f"    descriptive: {', '.join(mark(t) for t in sorted(b['descriptive'], key=lambda t: -counts.get(t, 0)))}")
        if b["alias"]:
            print(f"    alias:       {', '.join(b['alias'])}")
        if b["rare"]:
            print(f"    rare:        {', '.join(b['rare'])}")
        if b["unused"]:
            print(f"    unused:      {', '.join(b['unused'])}")


def apply_group_roots(true_roots, children_of, tag_group, group_report):
    """
    For groups verdict == 'folder-like', wrap their member tags that are
    currently top-level true_roots under a synthetic '[GroupName]' node.
    Returns a new top-level list mixing real roots (ungrouped/mixed groups)
    and synthetic group nodes, plus an updated children_of map (copy) that
    includes the synthetic node -> real roots edges.
    """
    new_children_of = defaultdict(list, {k: list(v) for k, v in children_of.items()})
    true_root_set = set(true_roots)
    grouped_away = set()
    synthetic_nodes = []

    for group, info in group_report.items():
        if not info["verdict"].startswith("folder-like"):
            continue
        members_in_roots = [t for t in info["buckets"]["tree"] if t in true_root_set]
        if len(members_in_roots) < 2:
            continue  # not worth a synthetic wrapper for a single tag
        synth_name = group
        new_children_of[synth_name] = sorted(members_in_roots)
        synthetic_nodes.append(synth_name)
        grouped_away.update(members_in_roots)

    remaining_top = [t for t in true_roots if t not in grouped_away]
    new_top_level = synthetic_nodes + remaining_top
    return new_top_level, new_children_of, set(synthetic_nodes)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("json_path")
    ap.add_argument("--min-count", type=int, default=3,
                     help="tags below this count are set aside as rare (default 3)")
    ap.add_argument("--parent-thresh", type=float, default=0.8,
                     help="min fraction of a tag's tweets that must also carry the candidate parent tag (default 0.8)")
    ap.add_argument("--merge-thresh", type=float, default=0.9,
                     help="min MUTUAL containment fraction to flag two tags as aliases/duplicates (default 0.9)")
    ap.add_argument("--pmi-thresh", type=float, default=-0.4,
                     help="a childless root with average PMI (vs the other root candidates) at or below this "
                          "is kept as a true category root (it's clearly under-represented against most other "
                          "roots, i.e. mutually exclusive/folder-like); above it, it's reclassified as "
                          "descriptive. More negative = stricter (fewer tags kept as roots). Default -0.4. "
                          "Ignored if --force-tree is set.")
    ap.add_argument("--force-tree", action="store_true",
                     help="disable the descriptive bucket entirely and allow tags to have MULTIPLE parents "
                          "(e.g. 'minecraft' nested under both 'art' and 'gamedev' if it qualifies as a subset of both)")
    ap.add_argument("--group-roots", action="store_true",
                     help="wrap root tags belonging to a 'folder-like' manual tag group under a synthetic "
                          "[GroupName] top-level node (requires settings.tagGroupAssignments in the export)")
    ap.add_argument("--group-override", action="append", default=None, metavar="Group=folder|descriptive",
                     help="force a manual tag group's verdict, overriding the data-driven classification for its "
                          "member tags (e.g. --group-override 'Quality=descriptive'). Repeatable.")
    ap.add_argument("--group-overrides-file", default=None,
                     help="JSON file of {\"GroupName\": \"folder\"|\"descriptive\", ...} for defining many "
                          "overrides at once. Combined with --group-override (CLI wins on conflicts).")
    ap.add_argument("--json-out", default=None, help="optional path to dump the tree as JSON")
    args = ap.parse_args()

    tag_to_tweets, n_tweets, tag_group = load_tagsets(args.json_path)
    print(f"Loaded {n_tweets} tweets, {len(tag_to_tweets)} distinct tags.")
    if tag_group:
        print(f"Found {len(tag_group)} manual tag-group assignments in settings.tagGroupAssignments.")

    overrides = parse_overrides(args.group_override, args.group_overrides_file)
    if overrides:
        print(f"Applying {len(overrides)} group override(s): " +
              ", ".join(f"{g}={v}" for g, v in overrides.items()))

    result = build_tree(tag_to_tweets, n_tweets, args.min_count, args.parent_thresh, args.merge_thresh,
                         force_tree=args.force_tree)
    true_roots, descriptive = finalize_descriptive(result, args.pmi_thresh)
    true_roots, descriptive, children_of, overridden_tags = apply_group_overrides(
        true_roots, descriptive, result["children_of"], tag_group, overrides)
    true_roots = sorted(true_roots, key=lambda t: -result["counts"].get(t, 0))
    descriptive = sorted(descriptive, key=lambda t: -result["counts"].get(t, 0))

    alias_map = {}
    for primary, secondary, c1, c2 in result["alias_pairs"]:
        alias_map[primary] = f"{secondary} (mutual containment {c1:.2f}/{c2:.2f})"

    group_report = build_group_report(result, tag_group, true_roots, descriptive, children_of,
                                       overrides=overrides) if tag_group else {}

    top_level = true_roots
    synthetic_nodes = set()
    if args.group_roots:
        if not tag_group:
            print("\n(--group-roots requested but no settings.tagGroupAssignments found in the export; skipping)")
        else:
            top_level, children_of, synthetic_nodes = apply_group_roots(
                true_roots, children_of, tag_group, group_report)

    print("\n===== TAG TREE =====")
    if args.force_tree:
        print("(--force-tree: nodes with multiple qualifying parents appear once under EACH parent)")
    if synthetic_nodes:
        print("(--group-roots: [GroupName] nodes are synthetic wrappers, not data-derived tags)")
    if overridden_tags:
        print("(* next to a group name = this tag's tree/descriptive placement was set via --group-override)")
    for r in sorted(top_level, key=lambda t: (t not in synthetic_nodes, -result["counts"].get(t, 0))):
        print_tree(r, children_of, result["counts"], alias_map=alias_map, tag_group=tag_group,
                   synthetic=(r in synthetic_nodes), overridden_tags=overridden_tags)

    if result["alias_pairs"]:
        print("\n===== ALIAS / MERGE CANDIDATES (near-duplicate tags) =====")
        for primary, secondary, c1, c2 in sorted(result["alias_pairs"], key=lambda x: -result["counts"][x[0]]):
            print(f"  {tag_label(primary, result['counts'], tag_group)}  <->  "
                  f"{tag_label(secondary, result['counts'], tag_group)}"
                  f"   containment: {secondary}->{primary}={c1:.2f}, {primary}->{secondary}={c2:.2f}")

    if descriptive:
        print("\n===== DESCRIPTIVE / NON-HIERARCHICAL TAGS =====")
        for tag in descriptive:
            print(f"  {tag_label(tag, result['counts'], tag_group, overridden_tags)}")

    if result["rare"]:
        print(f"\n===== RARE TAGS (< {args.min_count} uses) =====")
        for tag in sorted(result["rare"], key=lambda t: -len(tag_to_tweets[t])):
            print(f"  {tag_label(tag, {t: len(tag_to_tweets[t]) for t in [tag]}, tag_group)}")

    if group_report:
        print_group_report(group_report, result["counts"], overridden_tags)

    if args.json_out:
        def node_to_dict(tag, is_synthetic=False):
            return {
                "tag": tag,
                "synthetic_group_node": is_synthetic,
                "count": None if is_synthetic else result["counts"].get(tag),
                "group": None if is_synthetic else tag_group.get(tag),
                "group_override_applied": tag in overridden_tags,
                "children": [node_to_dict(c, c in synthetic_nodes) for c in
                             sorted(children_of.get(tag, []),
                                    key=lambda c: -result["counts"].get(c, 0))]
            }
        out = {
            "tree": [node_to_dict(r, r in synthetic_nodes) for r in top_level],
            "aliases": [{"primary": p, "secondary": s, "contain_s_to_p": c1, "contain_p_to_s": c2}
                        for p, s, c1, c2 in result["alias_pairs"]],
            "descriptive": descriptive,
            "rare": result["rare"],
            "force_tree": args.force_tree,
            "group_overrides_applied": overrides,
            "group_report": {g: {"verdict": info["verdict"], **info["buckets"]}
                              for g, info in group_report.items()},
        }
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=2)
        print(f"\nWrote tree JSON to {args.json_out}")


if __name__ == "__main__":
    main()