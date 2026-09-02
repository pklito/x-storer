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

Output: an indented tree printout, a list of alias/merge-candidate pairs, a
list of descriptive tags (empty if --force-tree is set), and a list of rare
tags. Also optional JSON dump of the tree structure for use elsewhere (e.g.
to actually build folders).

Usage:
    python3 tag_tree.py export.json
    python3 tag_tree.py export.json --min-count 3 --parent-thresh 0.8 --merge-thresh 0.9 --spread 2
    python3 tag_tree.py export.json --force-tree
    python3 tag_tree.py export.json --json-out tree.json
"""

import argparse
import json
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
    return tag_to_tweets, len(tweets)


def containment(a_set, b_set):
    """Fraction of a_set that is also in b_set: |a ∩ b| / |a|"""
    if not a_set:
        return 0.0
    return len(a_set & b_set) / len(a_set)


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


def build_tree(tag_to_tweets, min_count, parent_thresh, merge_thresh, force_tree=False):
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
            # how many DISTINCT other roots does this tag co-occur with?
            other_root_hits = set()
            for i in tag_to_tweets[r]:
                for other in root_set:
                    if other == r:
                        continue
                    if i in tag_to_tweets[other]:
                        other_root_hits.add(other)
            spread = len(other_root_hits)
            if spread >= 1:  # placeholder, real cutoff applied by caller via --spread
                descriptive.append((r, spread))
            else:
                true_roots.append(r)

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


def finalize_descriptive(result, spread_thresh):
    """Apply the --spread cutoff to decide final descriptive vs true-root split.
    No-op passthrough when force_tree was used (descriptive_raw is already empty)."""
    descriptive = []
    true_roots = list(result["true_roots"])
    for tag, spread in result["descriptive_raw"]:
        if spread >= spread_thresh:
            descriptive.append(tag)
        else:
            true_roots.append(tag)
    return sorted(true_roots, key=lambda t: -result["counts"][t]), sorted(descriptive, key=lambda t: -result["counts"][t])


def print_tree(tag, children_of, counts, depth=0, alias_map=None):
    prefix = "  " * depth + ("└─ " if depth > 0 else "")
    alias_note = ""
    if alias_map and tag in alias_map:
        alias_note = f"  [alias: {alias_map[tag]}]"
    print(f"{prefix}{tag} ({counts[tag]}){alias_note}")
    for child in sorted(children_of.get(tag, []), key=lambda c: -counts[c]):
        print_tree(child, children_of, counts, depth + 1, alias_map)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("json_path")
    ap.add_argument("--min-count", type=int, default=3,
                     help="tags below this count are set aside as rare (default 3)")
    ap.add_argument("--parent-thresh", type=float, default=0.8,
                     help="min fraction of a tag's tweets that must also carry the candidate parent tag (default 0.8)")
    ap.add_argument("--merge-thresh", type=float, default=0.9,
                     help="min MUTUAL containment fraction to flag two tags as aliases/duplicates (default 0.9)")
    ap.add_argument("--spread", type=int, default=2,
                     help="a childless root co-occurring with this many or more OTHER roots is reclassified as descriptive (default 2, ignored if --force-tree is set)")
    ap.add_argument("--force-tree", action="store_true",
                     help="disable the descriptive bucket entirely and allow tags to have MULTIPLE parents "
                          "(e.g. 'minecraft' nested under both 'art' and 'gamedev' if it qualifies as a subset of both)")
    ap.add_argument("--json-out", default=None, help="optional path to dump the tree as JSON")
    args = ap.parse_args()

    tag_to_tweets, n_tweets = load_tagsets(args.json_path)
    print(f"Loaded {n_tweets} tweets, {len(tag_to_tweets)} distinct tags.")

    result = build_tree(tag_to_tweets, args.min_count, args.parent_thresh, args.merge_thresh,
                         force_tree=args.force_tree)
    true_roots, descriptive = finalize_descriptive(result, args.spread)

    alias_map = {}
    for primary, secondary, c1, c2 in result["alias_pairs"]:
        alias_map[primary] = f"{secondary} (mutual containment {c1:.2f}/{c2:.2f})"

    print("\n===== TAG TREE =====")
    if args.force_tree:
        print("(--force-tree: nodes with multiple qualifying parents appear once under EACH parent)")
    for r in true_roots:
        print_tree(r, result["children_of"], result["counts"], alias_map=alias_map)

    if result["alias_pairs"]:
        print("\n===== ALIAS / MERGE CANDIDATES (near-duplicate tags) =====")
        for primary, secondary, c1, c2 in sorted(result["alias_pairs"], key=lambda x: -result["counts"][x[0]]):
            print(f"  {primary} ({result['counts'][primary]})  <->  {secondary} ({result['counts'][secondary]})"
                  f"   containment: {secondary}->{primary}={c1:.2f}, {primary}->{secondary}={c2:.2f}")

    if descriptive:
        print("\n===== DESCRIPTIVE / NON-HIERARCHICAL TAGS =====")
        for tag in descriptive:
            print(f"  {tag} ({result['counts'][tag]})")

    if result["rare"]:
        print(f"\n===== RARE TAGS (< {args.min_count} uses) =====")
        for tag in sorted(result["rare"], key=lambda t: -len(tag_to_tweets[t])):
            print(f"  {tag} ({len(tag_to_tweets[tag])})")

    if args.json_out:
        def node_to_dict(tag):
            return {
                "tag": tag,
                "count": result["counts"][tag],
                "children": [node_to_dict(c) for c in
                             sorted(result["children_of"].get(tag, []), key=lambda c: -result["counts"][c])]
            }
        out = {
            "tree": [node_to_dict(r) for r in true_roots],
            "aliases": [{"primary": p, "secondary": s, "contain_s_to_p": c1, "contain_p_to_s": c2}
                        for p, s, c1, c2 in result["alias_pairs"]],
            "descriptive": descriptive,
            "rare": result["rare"],
            "force_tree": args.force_tree,
        }
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=2)
        print(f"\nWrote tree JSON to {args.json_out}")


if __name__ == "__main__":
    main()