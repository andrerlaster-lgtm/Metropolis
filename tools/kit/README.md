# Kit models

Models for the 3D views built from Kenney's CC0 kits (Modular Buildings, Tower Defense Kit). Only the
pieces a recipe uses are kept, in `assets/kenney/<kit>/` with each kit's `colormap.png` and licence.

```
node tools/kit/build-kit.mjs   # writes src/view3d/models/<name>.glb for every recipe
```

- `recipes.mjs`: what each model is made of. Pieces are placed in kit units (a modular-building cell is
  1 × 0.63 × 1 with its feature on the +z face), turned in quarter turns and stretched, then the model is
  scaled into game tiles.
- The tool bakes each piece's palette colour into vertex colours, adds soft ambient occlusion toward the
  ground and under ledges, recolours (the recipe's `remap`) and joins everything into one mesh: one draw
  call and no textures to load.
- The game loads models with `view3d/kit.js` and draws its own simpler stand-in until one arrives (or if
  it can't be loaded).

To add a model: copy the kit pieces into `assets/kenney/<kit>/`, add a recipe, run the tool, and use
`kitModel('<name>')` where the structure is drawn. Keep each model under about 1,500 triangles.
