# DM Screen

**A free, browser-based virtual screen for D&D 5e Dungeon Masters.**

**Live at [dmscreen.github.io](https://dmscreen.github.io)**

Run your whole session from one tab: initiative, encounter balancing, travel, random encounters, generators, and the SRD reference, with everything saved locally in your browser. No account, no server, no tracking, and it works offline once loaded.

## Features

### Combat
- **Initiative Tracker**: turns and rounds, HP with damage/heal, temp AC display, conditions with round-based expiry, concentration reminders with save DCs, death saves, monster stat blocks one click away. Combat state autosaves, so a refresh loses nothing.
- **Encounter Builder**: search 900+ monsters, build a monster list, and see live XP budget math (easy/medium/hard/deadly thresholds, encounter multiplier, adjusted XP, per-player XP). Save encounters and launch them straight into the tracker.
- **Dice Roller**: full expression parser (`3d6+2`, `4d6kh3`, `2d20kl1` for disadvantage), quick buttons, and a tap-to-reroll history.
- **Party Tracker**: the PC stats a DM actually needs: AC, HP, initiative, passive Perception/Investigation/Insight, plus one-click group checks. Powers the encounter builder and tracker.

### Travel & Exploration
- **Travel Calculator**: pace, terrain, mounts and ships, forced-march DCs, answers "how long does the journey take?"
- **Random Encounters**: encounter checks on your terms, then terrain-filtered, level-appropriate encounters rolled from the full bestiary. One tap to re-roll, one tap to run it in the tracker.
- **Weather Generator**: climate + season in, temperature/wind/precipitation out, with the SRD's mechanical effects attached.
- **Calendar & Time**: track the in-world date and watch, advance time, log events, and customize the whole calendar (months, weekdays) for your setting.

### Generators
- **NPC Generator**: name, occupation, personality, quirk, ideal, bond, flaw, a plot hook, and a stat line, savable to your campaign with notes.
- **Name Generator**: people (8 ancestries), taverns, shops, ships, settlements.
- **Loot Generator**: individual and hoard treasure by CR band, with gems, art objects, and SRD magic items (click any item for its full text).
- **Shop Generator**: stocked shops with prices and a keeper; save a shop and inventory persists as the party buys it out.
- **Quest Hooks**: patron + goal + complication + twist + reward, for improvising side content.
- **Custom Random Tables**: build weighted tables ("3x Nothing but wind"), roll them anywhere, including inside the random encounter tool.

### Reference
One unified Reference browser with a Type selector:
- **Bestiary**: 908 monsters (SRD 5.1 + Monstrous Menagerie) with type/size/environment/source filters and full stat blocks.
- **Spells**: 690 spells (SRD 5.1 + Adventurer's Guide) filterable by level, school, class, source, concentration, and ritual.
- **Items**: 2,009 items, from backpacks and trail rations to legendary artifacts (SRD 5.1 equipment and magic items, Level Up A5E equipment and magic items, Kobold Press Vault of Magic and Tome of Heroes).
- **Rules**: searchable cards for actions, cover, light, resting, travel, jumping, falling, suffocation, exhaustion, mounted and underwater combat, concentration, death.
- **Conditions**: every condition on one screen.
- **Character Options**: 59 feats and 27 backgrounds from the Level Up: Advanced 5th Edition books.

### Session
- **Session Notes**: autosaving per-campaign notes with search and a pinnable recap.
- **Session Timer**: elapsed time plus a break countdown.
- **Multiple campaigns**: all data is scoped per campaign; switch from the sidebar.
- **Backup**: export/import everything as a single JSON file from Settings.

### Linked Tools
A curated page of excellent free companions, featuring **[Auto Roll Tables](https://autorolltables.github.io)** plus community favorites: Kobold+ Fight Club, donjon, Owlbear Rodeo, Dungeon Scrawl, Watabou, Azgaar's, Improved Initiative, Open5e, Tabletop Audio, Kenku FM, Fantasy Name Generators, Roll20, and Foundry VTT.

## Tech

- Plain HTML, CSS, and vanilla JavaScript (ES modules). No framework, no build step: clone and open.
- Data in `IndexedDB` + `localStorage`, only ever on your device.
- Installable PWA with a service worker for offline use at the table.
- Desktop gets a sidebar layout; phones get an app-style bottom tab bar.

### Run locally

Any static file server works:

```bash
python -m http.server 8321
```

Then open `http://localhost:8321`.

## Licensing

- Application code: MIT.
- This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.
- This work also includes material from the Level Up: Advanced 5th Edition (A5E) books by [EN Publishing](https://enpublishingrpg.com): the Adventurer's Guide, Dungeon Delver's Guide, Gate Pass Gazette, and Monstrous Menagerie, used under the terms of the Open Gaming License via the [A5E System Reference Document](https://a5esrd.com). This site is not affiliated with or endorsed by EN Publishing.
- All rules data compiled via the [Open5e](https://open5e.com) project and API. DM Screen is unofficial fan content and is not affiliated with or endorsed by Wizards of the Coast.
