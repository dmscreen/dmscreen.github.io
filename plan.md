# DM Screen Kit - Project Plan

A free, browser-based Dungeon Master's virtual screen for D&D 5e. Pure HTML, CSS, and JavaScript hosted on GitHub Pages. All user data saves to the browser. No accounts, no server, no build step required to run it.

## 1. Name and Hosting

- **GitHub org/user:** `dmscreen` (account created 2026-08-07)
- **URL:** `https://dmscreen.github.io`
- **Repo:** `dmscreen/dmscreen.github.io` (user/org site, deploys straight from `main`)
- **License:** MIT for code. Bundled rules content comes from the D&D 5e SRD 5.1 under CC-BY-4.0; the site footer and README carry the required attribution.

## 2. Guiding Principles

1. **Zero backend.** Static files only. Works on GitHub Pages, works from a local folder, works offline after first load.
2. **Vanilla stack.** HTML + CSS + ES modules. No framework, no bundler, no npm install to contribute. If a library is truly needed (none anticipated), vendor it into the repo.
3. **Browser-owned data.** Everything the DM creates lives in `localStorage` (settings, small state) and `IndexedDB` (campaigns, encounters, notes). Full JSON export/import so users can back up or move devices.
4. **Fast at the table.** Every tool reachable in two taps or fewer. Large touch targets on mobile. No page reloads between tools (hash-based routing in a single-page shell).
5. **SRD-safe.** Only SRD 5.1 content is bundled. No content from the PHB/MM/DMG beyond what the SRD grants.

## 3. Architecture

### 3.1 File layout

```
/
  index.html            app shell (nav + tool container)
  css/
    base.css            reset, tokens (colors, spacing, dark/light themes)
    layout.css          desktop sidebar / mobile bottom-tab layouts
    components.css      cards, tables, dialogs, forms, stat blocks
  js/
    app.js              boot, hash router, nav rendering
    store.js            storage layer (localStorage + IndexedDB wrapper, export/import)
    dice.js             shared dice expression parser/roller (e.g. "3d6+2", adv/dis)
    srd.js              loader + search index over bundled SRD JSON
    components/         reusable widgets (modal, autocomplete, stat block renderer)
    tools/              one module per tool (initiative.js, encounters.js, ...)
  data/
    monsters.json       SRD monsters (~330 stat blocks) with CR, type, environment tags
    spells.json         SRD spells
    conditions.json     conditions, exhaustion, cover rules
    rules.json          quick-reference chunks (actions in combat, resting, travel pace,
                        light, DCs, jumping, suffocation, falling, etc.)
    tables/             built-in random tables (encounters by terrain/CR, weather,
                        names, quirks, trinkets, loot by CR)
  assets/               icons (inline SVG sprite), favicon, manifest
  manifest.webmanifest  PWA manifest (installable)
  sw.js                 service worker: cache-first so the screen works offline
```

### 3.2 Routing and shell

- Single `index.html`. Tools are sections registered with a tiny hash router (`#/initiative`, `#/encounters`, ...). Deep links work, back button works.
- Each tool module exports `{ id, title, icon, render(container), onEnter, onExit }`. The nav is generated from the registry, so adding a tool is one file plus one registry entry.

### 3.3 Responsive layout

- **Desktop (>= 900px):** persistent left sidebar in the style of chatgpt.com. Top of sidebar: campaign switcher. Middle: tool list grouped by category (Combat, World, Generators, Reference, Linked Tools). Bottom: settings, export/import, theme toggle. Sidebar is collapsible to icons only.
- **Mobile (< 900px):** sidebar disappears. Fixed bottom tab bar, app style, with the 4 most-used tools (Initiative, Dice, Notes, Reference) plus a "More" tab that opens a full-screen grid of all tools. Safe-area insets respected for iOS. Tab order user-configurable in settings.
- **Tablet:** desktop layout with the sidebar starting collapsed.

### 3.4 Storage model

- `localStorage`: UI prefs (theme, tab order, last route, collapsed state), active campaign id.
- `IndexedDB` (via a small promise wrapper in `store.js`), object stores:
  - `campaigns` (name, created, notes)
  - `party` (PCs: name, AC, passive perception, max HP, level, player)
  - `encounters` (saved encounter builds)
  - `combats` (in-progress initiative state, so a refresh mid-fight loses nothing)
  - `npcs`, `notes`, `customTables`, `shops`, `calendarEvents`
- Every record carries `campaignId` so multiple campaigns stay separate.
- **Export/import:** one button dumps everything to a single versioned JSON file; import merges or replaces. Schema version field from day one so future migrations are possible.

## 4. The Tools (full suite, v1)

### Combat

1. **Initiative / Combat Tracker.** Add PCs from the party roster and monsters from the SRD bestiary (or ad hoc). Sort by initiative with dex tiebreak, track HP, temp HP, AC, conditions (with round expiry), concentration, death saves, lair actions on initiative 20, round and elapsed-time counter. Click a monster to see its full stat block in a side panel. Combat state autosaves.
2. **Encounter Builder.** Pick monsters by CR/type/environment with search. Shows XP budget math against the party (easy/medium/hard/deadly thresholds, encounter multiplier), adjusted XP, and per-player XP on completion. Save encounters to a campaign and send any saved encounter straight into the initiative tracker.
3. **Dice Roller.** Expression parser (`4d6kh3`, `2d20kh1` advantage, modifiers), tap-to-build common rolls, roll history log, private "behind the screen" rolls are the default since everything is local anyway.
4. **Party Tracker.** PC roster with AC, passive Perception/Investigation/Insight, saves, languages, and DM notes per PC. Feeds the encounter builder and initiative tracker. Quick group-check view: roll or record a check for the whole party at once.

### Travel and Exploration

5. **Travel Calculator.** Pace (slow/normal/fast) with the SRD effects (passive Perception penalty, stealth, navigation), distance/time solver for foot, mount, vehicle, and ship, forced-march con saves, terrain multipliers.
6. **Random Encounter Engine.** Encounter checks on a configurable die and frequency (per hour/watch/day). Rolls against built-in terrain tables (arctic, coast, desert, forest, grassland, mountain, swamp, underground, urban) filtered by party level band, or against any custom table. One tap re-roll, one tap "run it" to push the result into the initiative tracker.
7. **Weather Generator.** Season + climate in, temperature/wind/precipitation out, with mechanical notes (extreme cold/heat, strong wind, heavy precipitation from the SRD).
8. **Calendar & Time Tracker.** Track in-world date and time of day, advance by watch/day, log events. Ships with a generic 12-month calendar and supports custom calendars (month names/lengths, weekdays, moons).

### Generators

9. **NPC Generator.** Name (by ancestry), personality, ideal/bond/flaw, quirk, occupation, and an optional simple stat line. Save generated NPCs to the campaign with notes.
10. **Name Generator.** People (by ancestry and gender-neutral options), taverns, shops, ships, settlements.
11. **Loot & Treasure Generator.** SRD treasure math: individual and hoard rolls by CR band, coins, gems, art objects, and magic-item table rolls (SRD items only).
12. **Shop Generator.** Shop type + settlement size in, inventory with SRD equipment prices and a few flavor items out. Editable and savable, so party purchases persist.
13. **Quest Hook / Plot Generator.** Table-driven hooks: patron, goal, complication, twist, reward. Good fodder for improvising side content.

### Reference

14. **Rules Quick Reference.** Searchable cards: actions in combat, conditions, cover, light and vision, resting, falling, suffocation, DCs by difficulty, skill/ability cross-reference, mounted combat, underwater combat.
15. **Monster Reference.** Full SRD bestiary browser with filter by CR/type/size/environment and full stat block rendering. Any monster can be added to an encounter or combat from here.
16. **Spell Reference.** SRD spell list with filters (level, school, class, concentration, ritual) and full text.
17. **Condition Tracker Cheatsheet.** One-screen view of all conditions for fast rulings (also surfaced inside the initiative tracker).

### Session

18. **Session Notes.** Per-campaign, per-session markdown-ish notes (headings, lists, bold) with autosave, timestamps, and search. Pin a "recap" note per campaign.
19. **Custom Random Tables.** Create and roll on your own weighted tables (d-anything). Importable/exportable as JSON. Custom tables plug into the Random Encounter Engine.
20. **Session Timer / Break Timer.** Small utility in the header: session elapsed time and an optional break countdown.

### Linked Tools (external, opens in new tab)

A dedicated nav section of curated external links, each with a one-line description. Stored as data (`data/linked-tools.json`) so it is easy to extend.

**Featured project:**
- **[Auto Roll Tables](https://autorolltables.github.io)** - companion random-table project; featured at the top of the section and cross-linked from the Custom Random Tables tool ("want more tables?").

**Community-recommended tools** (regulars in r/DMAcademy, r/DnD, and r/dndnext recommendation threads):
- **[Kobold+ Fight Club](https://koboldplus.club)** - the community-standard encounter balancer.
- **[donjon](https://donjon.bin.sh)** - dungeon, world, name, and loot generators for everything.
- **[Owlbear Rodeo](https://www.owlbear.rodeo)** - lightweight free VTT for maps and tokens.
- **[Dungeon Scrawl](https://www.dungeonscrawl.com)** - fast free dungeon map drawing.
- **[Watabou Procgen Arcana](https://watabou.github.io)** - gorgeous procedural city, village, and dungeon maps.
- **[Azgaar's Fantasy Map Generator](https://azgaar.github.io/Fantasy-Map-Generator/)** - full world/continent map generation.
- **[Improved Initiative](https://improvedinitiative.app)** - alternative combat tracker.
- **[Open5e](https://open5e.com)** - searchable SRD and open content compendium.
- **[Tabletop Audio](https://tabletopaudio.com)** - free ambient soundscapes and music.
- **[Kenku FM](https://www.kenku.fm)** - route game audio into Discord for online play.
- **[Fantasy Name Generators](https://www.fantasynamegenerators.com)** - names for absolutely everything.
- **[Roll20](https://roll20.net)** / **[Foundry VTT](https://foundryvtt.com)** - full virtual tabletops when a map-and-macro platform is needed.

## 5. Data Plan

- **Source:** SRD 5.1 content, pulled once from the Open5e / 5e-bit open datasets (CC-BY / OGL-cleared), normalized into our own JSON schema, and committed to `data/`. No runtime API calls.
- **Size budget:** monsters + spells + rules should compress to well under 1 MB gzipped; loaded lazily per tool and cached by the service worker.
- **Search:** a small prebuilt index (name + tags) loaded up front; full records fetched per file on demand.
- **Attribution:** CC-BY-4.0 notice for SRD 5.1 in footer, README, and an About page.

## 6. Build Order

Full suite ships as v1, built in this order so each layer has what it needs:

1. **Foundation:** repo, app shell, router, nav (desktop sidebar + mobile tabs), theme tokens, dark/light mode, storage layer with export/import, PWA/service worker.
2. **Data:** convert and commit SRD JSON (monsters, spells, conditions, rules, base tables), build `srd.js` loader and search.
3. **Core combat loop:** dice roller, party tracker, monster reference, encounter builder, initiative tracker (in that order; each feeds the next).
4. **Reference:** rules quick reference, spell reference, condition cheatsheet.
5. **Travel and exploration:** travel calculator, random encounter engine, weather, calendar.
6. **Generators:** names, NPCs, loot, shops, quest hooks, custom tables.
7. **Session extras:** notes, timers, linked-tools section.
8. **Polish pass:** mobile ergonomics, keyboard shortcuts on desktop, empty states, print stylesheet for the reference pages, accessibility audit (focus order, ARIA on the tracker, contrast).
9. **Launch:** README with screenshots, About/attribution page, submit to the usual community tool lists.

## 7. Small Decisions Already Made

- Name: `dmscreen` (claim the GitHub org promptly, before building).
- Vanilla JS with ES modules, no framework, no build step.
- Hash routing (works on GitHub Pages with no 404 tricks).
- IndexedDB for records, localStorage for prefs, single-file JSON backup.
- Dark theme default (DMs at dim tables), light theme available.
- PWA from day one so it installs to phone home screens and works offline.
- SRD 5.1 (2014 rules) as the baseline; a later revision can add SRD 5.2 toggles if wanted.
- Bottom tab bar shows Initiative, Dice, Notes, Reference, More by default.

## 8. Open Risks / Later Ideas

- **iOS storage eviction:** Safari can evict IndexedDB for rarely used sites; mitigated by the PWA install prompt and loud export reminders.
- **SRD 5.2 support:** possible v2 toggle; schema keeps a `sourceVersion` field on rules data now to make that cheap.
- **Custom monster/homebrew entry:** likely fast-follow; the bestiary schema doubles as the homebrew schema.
- **Sync between devices:** out of scope (no backend), but export/import plus optional file-based sync (user's own cloud drive) could come later.
