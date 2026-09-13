# Asset register

All art/audio in `public/assets/` is **CC0 unless stated otherwise**.
CC0 = public domain, no attribution legally required. We credit anyway below
and in `public/assets/ATTRIBUTION.md`. CC-BY packs require keeping the
attribution note with the files — do not strip it.

Style target: 16×16 pixel art, dungeon/metroidvania (Terraria × Castlevania).

## Vendored (in this repo)

| Category             | Pack                              | Author | License | Source                                         | Used for                                                                         |
| -------------------- | --------------------------------- | ------ | ------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| Tilemap (starter)    | Tiny Dungeon (130 files, 16×16)   | Kenney | CC0     | https://kenney.nl/assets/tiny-dungeon          | Dungeon tiles, doors, props                                                      |
| Player               | Platformer Characters (150 files) | Kenney | CC0     | https://kenney.nl/assets/platformer-characters | Player + zombie enemies (animated)                                               |
| Monsters (starter)   | Tiny Dungeon (above)              | Kenney | CC0     | —                                              | Slimes/bats placeholders                                                         |
| Projectiles (visual) | Particle Pack (80 files)          | Kenney | CC0     | https://kenney.nl/assets/particle-pack         | Bullets, glows, explosions, magic                                                |
| Particles / lights   | Particle Pack (above)             | Kenney | CC0     | —                                              | Particles + additive-blend light glows (no separate light pack needed; see note) |
| Items                | Tiny Dungeon (above)              | Kenney | CC0     | —                                              | Coins, keys, potions, chests                                                     |
| Tilemap props        | Tiny Dungeon (above)              | Kenney | CC0     | —                                              | —                                                                                |
| Backgrounds          | Background Elements (110 files)   | Kenney | CC0     | https://kenney.nl/assets/background-elements   | Parallax layers, set dressing                                                    |
| SFX weapons/steps    | RPG Audio (50 files)              | Kenney | CC0     | https://kenney.nl/assets/rpg-audio             | Melee, footsteps, pickups                                                        |
| SFX projectiles      | Digital Audio (60 files)          | Kenney | CC0     | https://kenney.nl/assets/digital-audio         | Lasers, shots, zaps                                                              |
| SFX impacts          | Impact Sounds (130 files)         | Kenney | CC0     | https://kenney.nl/assets/impact-sounds         | Hits, explosions, deaths                                                         |
| SFX UI               | UI Audio (50 files)               | Kenney | CC0     | https://kenney.nl/assets/ui-audio              | Clicks, menu, HUD                                                                |
| Music stingers       | Music Jingles (85 files)          | Kenney | CC0     | https://kenney.nl/assets/music-jingles         | Level clear, victory, game over                                                  |

## Planned (not vendored yet — download manually, check license at download time)

| Category           | Pack                                                      | Author                | License                    | Source                                                                              | Note                                                                                                   |
| ------------------ | --------------------------------------------------------- | --------------------- | -------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Tilemap (upgrade)  | 16×16 DungeonTileset II                                   | 0x72                  | CC0                        | https://0x72.itch.io/dungeontileset-ii                                              | Tiles + animated characters + weapons; itch.io download needs a browser session                        |
| Monsters (variety) | Animated Monsters                                         | Stealthix             | CC0                        | https://itch.io (search "Animated Monsters Stealthix")                              | Animated enemy set; verify CC0 tag on the page before vendoring                                        |
| Bosses             | Pixel Art Bosses (6 bosses, 128×128, 15 anims, 78 frames) | Admurin               | **CC-BY 4.0**              | https://opengameart.org/content/pixel-art-bosses (mirror: https://admurin.itch.io/) | Top-down 3-directional; attribution required — keep `ATTRIBUTION.md` entry. Boss AI is ours regardless |
| Bosses (alt)       | Demon Slime / Frost Guardian / Minotaur (free versions)   | chierit               | Unknown — evaluate         | https://itch.io (search "Boss: chierit")                                            | Free versions have limited animations; confirm commercial-use terms before vendoring                   |
| Music BGM          | High Quality 16-bit RPG Music (28 SNES-style tracks)      | HydroGene             | CC0 (per listing — verify) | https://itch.io (search "High Quality 16-bit RPG Music HydroGene")                  | Looping background music; verify license text on page before vendoring                                 |
| Items/UI icons     | game-icons.net set (exported PNGs)                        | Various (Lorc et al.) | **CC-BY 3.0**              | https://game-icons.net                                                              | HUD/inventory icons; attribution required                                                              |

## Notes

- **Lights**: no sprite pack. Technique: radial glow sprites from Particle
  Pack with PixiJS `BLEND_MODES.ADD` + a darkness overlay for dungeons.
  Revisit only if we need normal-mapped lighting.
- **Kenney packs to consider later**: Pixel UI Pack (HUD), 1-Bit Platformer
  Pack (alt biome), Micro Roguelike (minimap icons). All CC0.
- **Never vendor**: packs with NC (non-commercial), ND, or unclear "free for
  personal use" terms. When in doubt, link here as "evaluate", don't download.
