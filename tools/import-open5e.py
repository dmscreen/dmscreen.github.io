#!/usr/bin/env python3
"""Merge Open5e third-party sources into data/monsters.json and data/spells.json.

The bundled SRD and Level Up A5E data was fetched the same way; this script
exists so the reference can be regenerated or extended rather than hand-edited.

    python tools/import-open5e.py            # merge everything listed below
    python tools/import-open5e.py --dry-run  # report what would change

Which API version to use is per book, decided by which one actually carries
the data (checked against the live API, not assumed):

  * Tome of Beasts 3 is effectively empty in v2 -- 396 of its 397 creatures
    have no actions at all -- but complete in v1, so the Tomes read from v1.
  * Creature Codex does not exist in v1, so it reads from v2.
  * Deep Magic and Spells That Don't Suck have no v1 spells at all, so the
    spells read from v2.

Tome of Beasts ships as two editions whose contents overlap by ~326 names.
The 2023 revision wins on a name clash and the older edition contributes only
what the revision dropped, so the bestiary gains every distinct creature
without listing hundreds of near-identical twins.
"""

import argparse
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request

ROOT = "https://api.open5e.com"
UA = {"User-Agent": "dmscreen.github.io data build (https://github.com/dmscreen)"}
DATA = pathlib.Path(__file__).resolve().parent.parent / "data"

# (document key, source label shown in the app, api version). Order matters
# for creatures: tob-2023 is imported before tob so the revision wins a clash.
CREATURE_SOURCES = [
    ("tob-2023", "Tome of Beasts (2023)", 1),
    ("tob", "Tome of Beasts", 1),
    ("tob2", "Tome of Beasts 2", 1),
    ("tob3", "Tome of Beasts 3", 1),
    ("ccdx", "Creature Codex", 2),
]
SPELL_SOURCES = [
    ("deepm", "Deep Magic", 2),
    ("deepmx", "Deep Magic Extended", 2),
    ("spells-that-dont-suck", "Spells That Don't Suck", 2),
]

ABIL = {
    "strength": "str", "dexterity": "dex", "constitution": "con",
    "intelligence": "int", "wisdom": "wis", "charisma": "cha",
}


def fetch_all(endpoint, doc_key, version=2):
    """Every page of one document's entries, politely.

    The two API versions differ in both path and filter parameter.
    """
    out = []
    if version == 1:
        url = f"{ROOT}/v1/{endpoint}/?document__slug={doc_key}&limit=200"
    else:
        url = f"{ROOT}/v2/{endpoint}/?document__key={doc_key}&limit=200"
    while url:
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, headers=UA)
                with urllib.request.urlopen(req, timeout=60) as resp:
                    page = json.load(resp)
                break
            except (urllib.error.URLError, TimeoutError) as err:
                if attempt == 3:
                    raise SystemExit(f"giving up on {url}: {err}")
                time.sleep(2 * (attempt + 1))
        out.extend(page["results"])
        url = page.get("next")
        time.sleep(0.2)
    return out


def cr_text(cr):
    if cr is None:
        return ""
    return {0.125: "1/8", 0.25: "1/4", 0.5: "1/2"}.get(cr, str(int(cr)) if float(cr).is_integer() else str(cr))


def senses_string(c):
    parts = []
    for label, field in (("blindsight", "blindsight_range"), ("darkvision", "darkvision_range"),
                         ("tremorsense", "tremorsense_range"), ("truesight", "truesight_range")):
        rng = c.get(field)
        if rng:
            parts.append(f"{label} {rng} ft.")
    pp = c.get("passive_perception")
    if pp is not None:
        parts.append(f"passive Perception {pp}")
    return ", ".join(parts)


def actions_of(c, kind):
    return [{"name": a.get("name") or "", "desc": (a.get("desc") or "").strip()}
            for a in (c.get("actions") or []) if a.get("action_type") == kind]


def convert_creature(c, source):
    ri = c.get("resistances_and_immunities") or {}
    speed = {k: v for k, v in (c.get("speed") or {}).items() if k != "unit"}
    scores = c.get("ability_scores") or {}
    legendary = actions_of(c, "LEGENDARY_ACTION")
    out = {
        "slug": c["key"],
        "name": c["name"],
        "size": (c.get("size") or {}).get("name", ""),
        "type": (c.get("type") or {}).get("name", ""),
        "subtype": c.get("subcategory") or "",
        "alignment": c.get("alignment") or "",
        "ac": c.get("armor_class") or 10,
        "acDesc": c.get("armor_detail") or "",
        "hp": c.get("hit_points") or 1,
        "hitDice": c.get("hit_dice") or "",
        "speed": speed or {"walk": 30},
        **{short: scores.get(long_, 10) for long_, short in ABIL.items()},
        "saves": {short: (c.get("saving_throws") or {}).get(long_) for long_, short in ABIL.items()},
        "skills": dict(c.get("skill_bonuses") or {}),
        "vulnerabilities": ri.get("damage_vulnerabilities_display", ""),
        "resistances": ri.get("damage_resistances_display", ""),
        "immunities": ri.get("damage_immunities_display", ""),
        "conditionImmunities": ri.get("condition_immunities_display", ""),
        "senses": senses_string(c),
        "languages": (c.get("languages") or {}).get("as_string", ""),
        "cr": c.get("challenge_rating"),
        "crText": cr_text(c.get("challenge_rating")),
        "abilities": [{"name": t.get("name") or "", "desc": (t.get("desc") or "").strip()}
                      for t in (c.get("traits") or [])],
        "actions": actions_of(c, "ACTION"),
        "bonusActions": actions_of(c, "BONUS_ACTION"),
        "reactions": actions_of(c, "REACTION"),
        "legendaryDesc": (
            f"The {c['name'].split(',')[0].lower()} can take 3 legendary actions, choosing from the "
            "options below. Only one legendary action can be used at a time and only at the end of "
            "another creature's turn. It regains spent legendary actions at the start of its turn."
            if legendary else ""
        ),
        "legendaryActions": legendary,
        "mythicActions": actions_of(c, "MYTHIC_ACTION"),
        "spellList": [],
        # v2 carries no environment tags for these books; an empty list keeps
        # them out of terrain-filtered rolls but present under "Any terrain".
        "environments": [e if isinstance(e, str) else (e or {}).get("name", "")
                         for e in (c.get("environments") or [])],
        "source": source,
    }
    if not out["mythicActions"]:
        del out["mythicActions"]
    return out


def convert_creature_v1(c, source):
    """v1 monster shape. Its field names already mirror the app's schema."""
    named = lambda key: [{"name": a.get("name") or "", "desc": (a.get("desc") or "").strip()}
                         for a in (c.get(key) or [])]
    speed = {k: v for k, v in (c.get("speed") or {}).items()}
    cr = c.get("cr")
    return {
        "slug": f"{c.get('document__slug', 'o5e')}_{c['slug']}",
        "name": c["name"],
        "size": c.get("size") or "",
        "type": (c.get("type") or "").title(),
        "subtype": c.get("subtype") or "",
        "alignment": c.get("alignment") or "",
        "ac": c.get("armor_class") or 10,
        "acDesc": c.get("armor_desc") or "",
        "hp": c.get("hit_points") or 1,
        "hitDice": c.get("hit_dice") or "",
        "speed": speed or {"walk": 30},
        **{short: c.get(long_) or 10 for long_, short in ABIL.items()},
        "saves": {short: c.get(f"{long_}_save") for long_, short in ABIL.items()},
        "skills": dict(c.get("skills") or {}),
        "vulnerabilities": c.get("damage_vulnerabilities") or "",
        "resistances": c.get("damage_resistances") or "",
        "immunities": c.get("damage_immunities") or "",
        "conditionImmunities": c.get("condition_immunities") or "",
        "senses": c.get("senses") or "",
        "languages": c.get("languages") or "",
        "cr": float(cr) if cr is not None else None,
        "crText": c.get("challenge_rating") or cr_text(cr),
        "abilities": named("special_abilities"),
        "actions": named("actions"),
        "bonusActions": named("bonus_actions"),
        "reactions": named("reactions"),
        "legendaryDesc": c.get("legendary_desc") or "",
        "legendaryActions": named("legendary_actions"),
        "spellList": c.get("spell_list") or [],
        "environments": c.get("environments") or [],
        "source": source,
    }


def convert_spell(s, source):
    comp = "".join(letter for flag, letter in
                   (("verbal", "V"), ("somatic", "S"), ("material", "M")) if s.get(flag))
    casting = (s.get("casting_time") or "").strip()
    if casting and casting.split()[0].isalpha() and not casting[0].isdigit():
        casting = f"1 {casting}"  # API says "action"; the app's data says "1 action"
    duration = (s.get("duration") or "").strip()
    return {
        "slug": s["key"],
        "name": s["name"],
        "level": s.get("level") or 0,
        "school": (s.get("school") or {}).get("name", ""),
        "classes": sorted({(c or {}).get("name", "") for c in (s.get("classes") or [])} - {""}),
        "castingTime": casting,
        "range": s.get("range_text") or (f"{s['range']} feet" if s.get("range") else "Self"),
        "components": ", ".join(comp),
        "material": s.get("material_specified") or "",
        "duration": duration[:1].upper() + duration[1:],
        "concentration": bool(s.get("concentration")),
        "ritual": bool(s.get("ritual")),
        "desc": (s.get("desc") or "").strip(),
        "higherLevel": (s.get("higher_level") or "").strip(),
        "source": source,
    }


def merge(path, sources, endpoints, converters, dry_run):
    existing = json.loads(path.read_text(encoding="utf-8"))
    have_slugs = {e["slug"] for e in existing}
    have_names = {e["name"] for e in existing}
    added, report = [], []

    for doc_key, label, version in sources:
        raw = fetch_all(endpoints[version], doc_key, version)
        kept, skipped = [], 0
        for entry in raw:
            converted = converters[version](entry, label)
            if converted["slug"] in have_slugs or converted["name"] in have_names:
                skipped += 1
                continue
            have_slugs.add(converted["slug"])
            have_names.add(converted["name"])
            kept.append(converted)
        added.extend(kept)
        report.append(f"  {label:<26} v{version}  {len(raw):>4} fetched, {len(kept):>4} added, {skipped:>4} already present")

    print(f"{path.name}:")
    print("\n".join(report))
    merged = sorted(existing + added, key=lambda e: e["name"].lower())
    print(f"  {'TOTAL':<30} {len(existing):>4} before -> {len(merged):>4} after (+{len(added)})")
    if not dry_run:
        path.write_text(json.dumps(merged, ensure_ascii=False), encoding="utf-8")
        print(f"  wrote {path} ({path.stat().st_size / 1_048_576:.1f} MB)")
    return len(added)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="report the merge without writing files")
    args = ap.parse_args()

    total = merge(
        DATA / "monsters.json", CREATURE_SOURCES,
        endpoints={1: "monsters", 2: "creatures"},
        converters={1: convert_creature_v1, 2: convert_creature},
        dry_run=args.dry_run,
    )
    print()
    total += merge(
        DATA / "spells.json", SPELL_SOURCES,
        endpoints={1: "spells", 2: "spells"},
        converters={1: convert_spell, 2: convert_spell},
        dry_run=args.dry_run,
    )
    print(f"\n{total} entries {'would be ' if args.dry_run else ''}added.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
