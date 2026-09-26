# Credits

Every third-party asset used on the Starcrop site and in its brand renders. Everything not listed here was built for this project.

## Textures and lighting

| Asset | File | Source | Author | License |
|---|---|---|---|---|
| Paper 001 (color, 1K), converted to webp | `tex/paper001-color-1k.webp` | https://ambientcg.com/view?id=Paper001 | Lennart Demes (ambientCG) | CC0 1.0 |
| Paper 001 (normal GL, 1K), converted to webp | `tex/paper001-normal-1k.webp` | https://ambientcg.com/view?id=Paper001 | Lennart Demes (ambientCG) | CC0 1.0 |
| Studio Small 09 HDRI (1K .hdr) | `tex/studio_small_09_1k.hdr` | https://polyhaven.com/a/studio_small_09 | Sergej Majboroda (Poly Haven) | CC0 1.0 |

## Models (built for this project, no third-party geometry)

| Asset | File | How it was made | License |
|---|---|---|---|
| Starcrop mark, extruded | `models/starcrop-mark.glb` | the vector mark (`site/src/assets/logo.svg`) → three.js SVGLoader → ExtrudeGeometry (mark depth 10, flag depth 13, bevel 0.8, svg units × 0.03) → GLTFExporter | project original (MIT with the repo) |
| ClashDesk crop field (meshes only) | `models/field-clashdesk.glb` | `buildField()` (the drawing code in `site/src/scene/field.js`) run on the recorded ClashDesk report (measured GitHub data, 2026-09-25; the recording is `test/fixtures/raw.planted.clashdesk.json` at the repo root) → GLTFExporter. No lines are exported; use `field.js` for linework | project original (MIT with the repo) |

## Fonts (`fonts/`, each with its SIL Open Font License text next to it)

| Family | File | Source | Designers | License |
|---|---|---|---|---|
| Zalando Sans Expanded (variable wght 200–900, latin) | `zalando-sans-expanded-normal.woff2` ([OFL-zalando-sans.txt](fonts/OFL-zalando-sans.txt)) | https://fonts.google.com/specimen/Zalando+Sans+Expanded · https://github.com/zalando/sans | Jakob Ekelund, KH Type, Zalando | SIL Open Font License 1.1 |
| Geologica (variable wght 100–900, SHRP 0–100, latin) | `geologica-normal.woff2` ([OFL-geologica.txt](fonts/OFL-geologica.txt)) | https://fonts.google.com/specimen/Geologica · https://github.com/googlefonts/geologica | Monokrom (Sindre Bremnes, Frode Helland) | SIL Open Font License 1.1 |
| Overpass Mono (variable wght 300–700, latin) | `overpass-mono-normal.woff2` ([OFL-overpass.txt](fonts/OFL-overpass.txt)) | https://fonts.google.com/specimen/Overpass+Mono · https://github.com/RedHatOfficial/Overpass | Delve Withrington, Dave Bailey, Thomas Jockin | SIL Open Font License 1.1 |

## Data shown in the drawings

The field, roots, strata and anchors come from public GitHub REST responses recorded on 2026-09-25 (the farm recording is `test/fixtures/raw.planted.clashdesk.json` at the repo root; its accounts and repos have since returned 404). Public GitHub data only. A pattern, not an accusation: a repo can be starred by a farm without asking for it.

GitHub is a trademark of GitHub, Inc. Starcrop is not affiliated with GitHub, and it uses no GitHub logo, octicon or trade dress.
