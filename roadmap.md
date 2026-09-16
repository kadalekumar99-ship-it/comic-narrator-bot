# Roadmap

- [x] Clone sparkle-glm-forge into this project and install dependencies
- [x] Store all Pixazo keys + Z.ai key as encrypted secrets (never in code)
- [x] Prompt rebuild: one identity line per character, location/action first,
      candid staging, sheet/portrait guards, cross-batch continuity
- [x] Fix Scene rewrites composition; Reroll only changes the seed
- [x] Automatic image review with GLM-4.6V-Flash (sketch / sheet / wrong scene /
      blank background / front-facing / duplicate / text) + one corrective redraw
- [x] Fix long-run quality threshold: global verification numbering, queued image
      reviews, independent review cooldown, and rejection of known-bad redraws
- [x] Lock the main character as an unmarried 23-year-old adult man in every panel
- [ ] Reference-image character locking — not possible on Flux.1 Schnell (text-only);
      needs an image model with reference/character conditioning
