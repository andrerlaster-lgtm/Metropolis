// The storybook models for the buildings added in Phase 4. They are built from the same pieces as the
// rest of storybook.js (walls, windows, roofs, gardens), handed in as `H` so this file has no
// import cycle with it. Each builder draws one tile in the building's own frame: its front faces +z.

export function buildersMore(H) {
  const { lin, mul, rand, block, walls, windowAt, doorAt, gableRoof, chimney, garden: gardenAround, bench, storyTree, bushWorld, flowerPatch, wallFrame, wallRect, beam, onWall, archAt, gablePorch, steps, lotGreens, hedge, schoolFence, lantern, timbering, STONE, TIMBER, FLOWERS } = H;

  const withLook = (ctx, v) => ({ ...ctx, v: { ...ctx.v, ...v } });
  const pale = lin('#efe6d2');

  // A gable roof whose ridge runs front to back (z) over block b, gable ends facing front and back.
  function ridgeZ(out, b, y, rise, o) {
    const Ls = [out.layers.roof, out.layers.timber, out.layers[o.endLayer || 'plaster']];
    const go = () => gableRoof(out, { x0: -b.z1, x1: -b.z0, z0: b.x0, z1: b.x1 }, y, rise, o);
    Ls[0].nest(0, 0, 1, () => Ls[1].nest(0, 0, 1, () => Ls[2].nest(0, 0, 1, go)));
  }

  // A flat disc of colour (water, pavement) on a layer, in the building's frame.
  function disc(m, cx, cz, r, y, col, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const c = ((i + 1) / n) * Math.PI * 2;
      m.tri([cx, y, cz], [cx + Math.cos(c) * r, y, cz + Math.sin(c) * r], [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r], col);
    }
  }

  // A pyramid roof over a square tower centred (cx, cz).
  function spire(out, cx, cz, r, y0, y1, col) {
    out.layers.roof.cyl(cx, cz, r, 0.002, y0, y1, 4, col, { a0: Math.PI / 4 });
  }

  function worldAt(out, x, z) {
    return out.layers.wood.tx(x, z);
  }

  // ---- Homes -------------------------------------------------------------------------------------

  function bungalow(out, ctx) {
    const v = ctx.v;
    const b = block(0.5, 0.32, -0.03);
    const h = 0.16;
    const mid = (b.x1 - b.x0) / 2;
    out.layers.stone.box(b.x0 - 0.012, 0, b.z0 - 0.012, b.x1 + 0.012, 0.03, b.z1 + 0.012, lin(STONE), { s: 6 });
    walls(out, b, 0.03, h, lin(v.wall));
    gableRoof(out, b, h, 0.13, { o: 0.07, col: lin(v.roof), wall: v.wall, timbered: false });
    doorAt(out, b, mid + 0.1, 0.075, 0.11, ctx);
    windowAt(out, b, 0, mid - 0.12, 0.06, 0.08, 0.065, ctx, { box: true });
    windowAt(out, b, 0, mid - 0.0, 0.06, 0.06, 0.065, ctx, { shutters: true });
    for (const face of [1, 2, 3]) windowAt(out, b, face, wallFrame(b, face).w / 2, 0.06, 0.06, 0.06, ctx);
    // A little veranda along the front.
    const T = out.layers.timber;
    T.box(b.x0 + 0.04, 0, b.z1, b.x1 - 0.04, 0.012, b.z1 + 0.08, lin('#a98764'), { s: 8 });
    for (const x of [b.x0 + 0.05, b.x1 - 0.05]) T.box(x - 0.007, 0.012, b.z1 + 0.07, x + 0.007, 0.13, b.z1 + 0.083, lin('#efe6d6'), { s: 6 });
    T.box(b.x0 + 0.03, 0.13, b.z1 - 0.005, b.x1 - 0.03, 0.142, b.z1 + 0.09, lin(v.roof));
    chimney(out, b.x1 - 0.08, -0.05, h + 0.06, h + 0.2);
    gardenAround(out, ctx, b, { fence: (ctx.s.shape || 0) % 2 === 0 });
  }

  function rowhouse(out, ctx) {
    const cols = ['#f1d6c2', '#d8e6cf', '#f0dfb2'];
    const roofs = ['#b9583f', '#7a5f9a', '#4f7f7a'];
    const hs = [0.28, 0.32, 0.28];
    const S = out.layers.stone;
    for (let k = 0; k < 3; k++) {
      const cx = -0.205 + k * 0.205;
      const b = { x0: cx - 0.1, x1: cx + 0.1, z0: -0.2, z1: 0.18 };
      const v = { ...ctx.v, wall: cols[k], roof: roofs[k] };
      const c = withLook(ctx, v);
      S.box(b.x0 - 0.004, 0, b.z0, b.x1 + 0.004, 0.03, b.z1 + 0.012, lin(STONE), { s: 6 });
      walls(out, b, 0.03, hs[k], lin(cols[k]));
      ridgeZ(out, b, hs[k], 0.1 + (k % 2) * 0.03, { o: 0.012, col: lin(roofs[k]), wall: cols[k], timbered: false });
      doorAt(out, b, 0.045 + (k % 2) * 0.1, 0.05, 0.1, c);
      windowAt(out, b, 0, k % 2 ? 0.05 : 0.15, 0.07, 0.05, 0.07, c, { box: true });
      windowAt(out, b, 0, 0.05, hs[k] - 0.1, 0.045, 0.06, c);
      windowAt(out, b, 0, 0.15, hs[k] - 0.1, 0.045, 0.06, c);
      if (k === 2) windowAt(out, b, 1, 0.19, 0.12, 0.06, 0.07, c);
      if (k === 0) windowAt(out, b, 3, 0.19, 0.12, 0.06, 0.07, c);
      chimney(out, cx + 0.02, 0, hs[k] + 0.07, hs[k] + 0.2);
    }
    // A shared front path, window boxes of flowers and a low wall.
    const W = out.layers.wood;
    W.box(-0.46, 0, 0.3, 0.46, 0.05, 0.315, lin('#efe6d6'), { s: 10 });
    for (let i = 0; i < 3; i++) {
      const [wx, wz] = worldAt(out, -0.205 + i * 0.205, 0.26);
      flowerPatch(out, wx, wz, 0.05, 5, rand(ctx.x, ctx.y, 400 + i));
    }
    lotGreens(out, ctx, [[-0.4, -0.38, 0, 0.5], [0.4, -0.38, 3, 0.5]], [[0, 0.4, 0.05]]);
  }

  function villa(out, ctx) {
    const v = ctx.v;
    const b = block(0.5, 0.36, -0.08);
    const h = 0.22;
    const mid = (b.x1 - b.x0) / 2;
    const S = out.layers.stone;
    S.box(b.x0 - 0.015, 0, b.z0 - 0.015, b.x1 + 0.015, 0.04, b.z1 + 0.015, pale, { s: 6 });
    walls(out, b, 0.04, h, lin('#f6ecd9'));
    gableRoof(out, b, h, 0.17, { o: 0.05, col: lin(v.roof), wall: '#f6ecd9', timbered: false });
    doorAt(out, b, mid, 0.09, 0.13, ctx);
    for (const du of [-0.17, -0.09, 0.09, 0.17]) windowAt(out, b, 0, mid + du, 0.07, 0.05, 0.1, ctx, { shutters: true });
    for (const du of [-0.13, 0.13]) windowAt(out, b, 0, mid + du, 0.17, 0.05, 0.05, ctx);
    for (const face of [1, 2, 3]) for (const u of [0.1, 0.26]) if (face !== 2 || u < 0.2) windowAt(out, b, face, u * (wallFrame(b, face).w / 0.36), 0.08, 0.055, 0.09, ctx);
    // A round stone tower with a pointed roof at the front corner, and a balcony.
    const tx = b.x0 - 0.02;
    const tz = b.z1 - 0.02;
    S.cyl(tx, tz, 0.075, 0.07, 0.04, 0.33, 10, lin('#e6dcc6'), { s: 3 });
    out.layers.roof.cyl(tx, tz, 0.095, 0.002, 0.33, 0.5, 10, lin(v.roof));
    out.layers.glass.cyl(tx, tz, 0.0755, 0.0705, 0.17, 0.25, 10, lin('#ffd98f'));
    const T = out.layers.timber;
    T.box(b.x1 - 0.2, 0.15, b.z1, b.x1 - 0.04, 0.162, b.z1 + 0.07, lin('#efe6d6'), { s: 6 });
    for (let i = 0; i < 6; i++) T.box(b.x1 - 0.2 + i * 0.03 - 0.004, 0.162, b.z1 + 0.064, b.x1 - 0.2 + i * 0.03 + 0.004, 0.2, b.z1 + 0.072, lin('#efe6d6'));
    chimney(out, b.x1 - 0.1, -0.1, h + 0.06, h + 0.24);
    steps(out, 0, 0.14, b.z1 + 0.01, 3, pale);
    gardenAround(out, ctx, b, { fence: false });
    hedge(out, ctx, -0.44, -0.12, 0.38, 0.035);
    hedge(out, ctx, 0.12, 0.44, 0.38, 0.035);
  }

  // ---- Shops and food -----------------------------------------------------------------------------

  function restaurant(out, ctx) {
    const v = { wall: '#f6dcc4', roof: '#a95a45', trim: '#6b4630', shutter: '#4f7f7a' };
    const rctx = withLook(ctx, v);
    const b = block(0.62, 0.36, -0.1);
    const h = 0.22;
    const S = out.layers.stone;
    S.box(b.x0 - 0.012, 0, b.z0 - 0.012, b.x1 + 0.012, 0.03, b.z1 + 0.012, lin(STONE), { s: 6 });
    walls(out, b, 0.03, h, lin(v.wall));
    timbering(out, b, 0.03, h, ctx, [1, 2, 3]);
    gableRoof(out, b, h, 0.17, { o: 0.05, col: lin(v.roof), wall: v.wall });
    windowAt(out, b, 0, 0.16, 0.06, 0.15, 0.1, rctx);
    doorAt(out, b, 0.36, 0.08, 0.13, rctx);
    windowAt(out, b, 0, 0.52, 0.06, 0.1, 0.1, rctx);
    for (const face of [1, 3]) windowAt(out, b, face, 0.18, 0.08, 0.07, 0.08, rctx);
    windowAt(out, b, 0, 0.36, 0.19, 0.07, 0.05, rctx);
    // A striped awning along the front and a hanging sign.
    const P = out.layers.paint;
    for (let i = 0; i < 8; i++) {
      const xa = b.x0 + 0.03 + i * 0.07;
      const col = lin(i % 2 ? '#f8f1e4' : '#c8483f');
      P.quad([xa, 0.17, b.z1], [xa + 0.07, 0.17, b.z1], [xa + 0.07, 0.135, b.z1 + 0.1], [xa, 0.135, b.z1 + 0.1], col, null, [mul(col, 0.9), mul(col, 0.9), col, col]);
    }
    out.layers.wood.box(b.x1 - 0.05, 0.12, b.z1 + 0.005, b.x1 - 0.03, 0.2, b.z1 + 0.07, lin('#4a3326'));
    out.layers.paint.box(b.x1 - 0.1, 0.15, b.z1 + 0.06, b.x1 - 0.045, 0.2, b.z1 + 0.068, lin('#f4d27a'));
    chimney(out, b.x0 + 0.12, -0.14, h + 0.1, h + 0.26);
    if (!out.winter) {
      const [sx, sz] = S.tx(b.x0 + 0.12, -0.14);
      out.smoke.push({ x: sx, y: h + 0.32, z: sz, big: false });
    }
    // Round tables with parasols out front.
    for (const [tx, tz, col] of [[-0.2, 0.36, '#c8483f'], [0.02, 0.4, '#4f9ac4'], [0.24, 0.36, '#e8b53b']]) {
      out.layers.wood.cyl(tx, tz, 0.045, 0.045, 0.06, 0.068, 10, lin('#f4ead6'), { s: 3 });
      out.layers.timber.cyl(tx, tz, 0.006, 0.006, 0, 0.06, 5, lin('#8a6a52'));
      out.layers.timber.cyl(tx, tz, 0.007, 0.007, 0.06, 0.2, 5, lin('#8a6a52'));
      out.layers.paint.cyl(tx, tz, 0.085, 0.004, 0.17, 0.215, 8, lin(col));
      for (const [dx, dz] of [[-0.06, 0], [0.06, 0]]) out.layers.wood.box(tx + dx - 0.012, 0, tz + dz - 0.012, tx + dx + 0.012, 0.045, tz + dz + 0.012, lin('#9a6b44'));
    }
    lotGreens(out, ctx, [[-0.42, -0.36, 0, 0.5]], [[0.42, 0.42, 0.05], [-0.42, 0.42, 0.05]]);
  }

  function market(out, ctx) {
    const W = out.layers.wood;
    const T = out.layers.timber;
    const P = out.layers.paint;
    const D = out.layers.dirt;
    D.quad([-0.46, 0.006, 0.46], [0.46, 0.006, 0.46], [0.46, 0.006, -0.4], [-0.46, 0.006, -0.4], lin('#d6c4a0'), [[-0.46, -0.46], [0.46, -0.46], [0.46, 0.4], [-0.46, 0.4]]);
    const stalls = [[-0.2, -0.18, '#d94f4f'], [0.2, -0.18, '#4f9ac4'], [-0.2, 0.2, '#79b34e'], [0.2, 0.2, '#e8a53b']];
    stalls.forEach(([sx, sz, col], idx) => {
      const c1 = lin(col);
      const c2 = lin('#f8f4ec');
      for (const [dx, dz] of [[-0.14, -0.1], [0.14, -0.1], [-0.14, 0.1], [0.14, 0.1]]) T.box(sx + dx - 0.006, 0, sz + dz - 0.006, sx + dx + 0.006, 0.17, sz + dz + 0.006, lin('#efe6d6'), { s: 6 });
      for (let k = 0; k < 6; k++) {
        const xa = sx - 0.16 + k * 0.0533;
        P.quad([xa, 0.19, sz - 0.1], [xa + 0.0533, 0.19, sz - 0.1], [xa + 0.0533, 0.15, sz + 0.13], [xa, 0.15, sz + 0.13], k % 2 ? c2 : c1);
        P.quad([xa, 0.15, sz + 0.13], [xa + 0.0533, 0.15, sz + 0.13], [xa + 0.0533, 0.135, sz + 0.13], [xa, 0.135, sz + 0.13], mul(k % 2 ? c2 : c1, 0.85));
      }
      W.box(sx - 0.13, 0, sz - 0.03, sx + 0.13, 0.06, sz + 0.07, lin('#a87848'), { s: 8 });
      const [fx, fz] = W.tx(sx, sz + 0.02);
      for (let k = 0; k < 7; k++) out.flowers.push([fx - 0.1 + k * 0.033, 0.08, fz + ((k % 2) - 0.5) * 0.04, 0.85, ['#e5534b', '#f4b942', '#7fb85c', '#e98a3c', '#f2e8d0', '#c77dff', '#ff8fa3'][(k + idx) % 7]]);
    });
    // Crates, a barrel and lanterns.
    W.box(-0.04, 0, 0.02, 0.04, 0.05, 0.08, lin('#b88a55'), { s: 8 });
    W.box(-0.03, 0.05, 0.03, 0.03, 0.09, 0.07, lin('#c79a63'), { s: 8 });
    out.layers.paint.cyl(0.08, 0.04, 0.03, 0.03, 0, 0.06, 8, lin('#7a5b3c'), { top: lin('#5d4730'), s: 2 });
    for (const [lx, lz] of [[-0.43, 0.43], [0.43, 0.43]]) {
      const [wx, wz] = W.tx(lx, lz);
      lantern(out, wx, wz);
    }
    lotGreens(out, ctx, [[0.42, -0.38, 3, 0.5], [-0.42, -0.38, 0, 0.5]], []);
  }

  // ---- Work ---------------------------------------------------------------------------------------

  function bank(out, ctx) {
    const v = { wall: '#e9e1d2', roof: '#6d6a78', trim: '#f7f1e3', shutter: '#4a4a58' };
    const bctx = withLook(ctx, v);
    const b = block(0.56, 0.4, -0.1);
    const h = 0.3;
    const mid = (b.x1 - b.x0) / 2;
    const S = out.layers.stone;
    S.box(b.x0 - 0.015, 0, b.z0 - 0.015, b.x1 + 0.015, 0.04, b.z1 + 0.015, pale, { s: 6 });
    walls(out, b, 0.04, h, lin(v.wall), 'stone');
    S.box(b.x0 - 0.012, h - 0.025, b.z0 - 0.012, b.x1 + 0.012, h + 0.02, b.z1 + 0.012, pale, { s: 6 }); // cornice
    S.box(b.x0 + 0.02, h + 0.02, b.z0 + 0.02, b.x1 - 0.02, h + 0.045, b.z1 - 0.02, lin('#9a96a4'), { s: 6 });
    for (const du of [-0.2, -0.1, 0.1, 0.2]) windowAt(out, b, 0, mid + du, 0.1, 0.05, 0.13, bctx);
    for (const face of [1, 3]) for (const u of [0.08, 0.2, 0.32]) windowAt(out, b, face, u, 0.1, 0.05, 0.13, bctx);
    for (const u of [0.1, 0.24, 0.38, 0.5]) windowAt(out, b, 2, u, 0.1, 0.05, 0.13, bctx);
    // The portico: four columns under a pediment, with a gold plaque.
    const zf = b.z1 + 0.12;
    S.box(-0.2, 0, b.z1 - 0.01, 0.2, 0.03, zf + 0.015, pale, { s: 6 });
    for (const x of [-0.16, -0.055, 0.055, 0.16]) {
      S.cyl(x, zf - 0.02, 0.02, 0.017, 0.03, 0.23, 8, pale, { s: 3 });
      S.box(x - 0.026, 0.23, zf - 0.046, x + 0.026, 0.24, zf + 0.006, pale, { s: 6 });
    }
    S.box(-0.2, 0.24, b.z1 - 0.01, 0.2, 0.26, zf + 0.015, pale, { s: 6 });
    S.tri([-0.2, 0.26, zf + 0.015], [0.2, 0.26, zf + 0.015], [0, 0.33, zf + 0.015], pale, pale, pale, [-1, 0], [1, 0], [0, 0.3]);
    out.layers.roof.nest(0, 0, 1, () => out.layers.timber.nest(0, 0, 1, () => {
      gableRoof(out, { x0: -zf - 0.015, x1: -b.z1 + 0.01, z0: -0.2, z1: 0.2 }, 0.26, 0.07, { o: 0.012, col: lin(v.roof), wall: v.wall, ends: false });
    }));
    const f = wallFrame(b, 0);
    wallRect(out.layers.wood, f, mid - 0.05, mid + 0.05, 0.04, 0.18, 0.005, lin('#4a3a2e'), 10);
    wallRect(out.layers.paint, f, mid - 0.05, mid + 0.05, 0.2, 0.22, 0.006, lin('#e0b648'));
    steps(out, 0, 0.34, zf + 0.015, 3, pale);
    lotGreens(out, ctx, [[-0.4, -0.36, 1, 0.5], [0.4, -0.36, 0, 0.5]], [[-0.42, 0.4, 0.05], [0.42, 0.4, 0.05]]);
    schoolFence(out);
  }

  function hotel(out, ctx) {
    const v = { wall: '#f3e2d2', roof: '#7d5f9a', trim: '#6b4630', shutter: '#7d5f9a' };
    const hctx = withLook(ctx, v);
    const b = block(0.48, 0.38, -0.08);
    const floors = 4;
    const h = 0.1 + floors * 0.13;
    const mid = (b.x1 - b.x0) / 2;
    const S = out.layers.stone;
    S.box(b.x0 - 0.012, 0, b.z0 - 0.012, b.x1 + 0.012, 0.045, b.z1 + 0.012, pale, { s: 6 });
    walls(out, b, 0.045, h, lin(v.wall));
    for (let fl = 0; fl < floors; fl++) {
      const y = 0.15 + fl * 0.13;
      for (const du of [-0.17, -0.06, 0.06, 0.17]) if (fl > 0 || Math.abs(du) > 0.1) windowAt(out, b, 0, mid + du, y, 0.055, 0.075, hctx, { shutters: fl % 2 === 0 });
      for (const face of [1, 3]) for (const u of [0.1, 0.28]) windowAt(out, b, face, u, y, 0.055, 0.075, hctx);
      for (const u of [0.1, 0.24, 0.38]) windowAt(out, b, 2, u, y, 0.055, 0.075, hctx);
      if (fl < floors - 1) S.box(b.x0 - 0.006, y + 0.088, b.z0 - 0.006, b.x1 + 0.006, y + 0.098, b.z1 + 0.006, pale, { s: 6 });
    }
    gableRoof(out, b, h, 0.14, { o: 0.04, col: lin(v.roof), wall: v.wall, timbered: false });
    for (const du of [-0.12, 0.12]) { // dormers
      const cx = du;
      out.layers.plaster.box(cx - 0.035, h, b.z1 - 0.07, cx + 0.035, h + 0.07, b.z1 - 0.01, lin(v.wall), { s: 3 });
      out.layers.roof.box(cx - 0.045, h + 0.07, b.z1 - 0.08, cx + 0.045, h + 0.085, b.z1 + 0.005, lin(v.roof));
      out.layers.glass.box(cx - 0.02, h + 0.018, b.z1 - 0.008, cx + 0.02, h + 0.058, b.z1 - 0.004, lin('#ffd98f'));
    }
    // Revolving door under a canopy, a lit sign on a post, a luggage cart.
    wallRect(out.layers.glass, wallFrame(b, 0), mid - 0.05, mid + 0.05, 0.045, 0.14, 0.004, lin('#ffd98f'));
    out.layers.paint.box(-0.12, 0.15, b.z1, 0.12, 0.165, b.z1 + 0.12, lin('#7d5f9a'));
    for (const x of [-0.11, 0.11]) out.layers.timber.box(x - 0.007, 0, b.z1 + 0.1, x + 0.007, 0.15, b.z1 + 0.114, lin('#efe6d6'));
    out.layers.glow.box(b.x1 - 0.1, 0.4, b.z1 + 0.02, b.x1 - 0.02, 0.43, b.z1 + 0.03, lin('#f6d56a'));
    steps(out, 0, 0.2, b.z1 + 0.12, 2, pale);
    const [lx, lz] = S.tx(-0.3, 0.36);
    lantern(out, lx, lz);
    const [kx, kz] = S.tx(0.3, 0.36);
    lantern(out, kx, kz);
    lotGreens(out, ctx, [[-0.42, -0.36, 0, 0.5], [0.42, -0.36, 3, 0.5]], [[-0.42, 0.1, 0.05], [0.42, 0.1, 0.05]]);
  }

  function warehouse(out, ctx) {
    const v = { wall: '#c9c2d4', roof: '#7d8296', trim: '#efe6d6', shutter: '#4a4a58' };
    const wctx = withLook(ctx, v);
    const b = block(0.82, 0.46, -0.06);
    const h = 0.2;
    const S = out.layers.stone;
    S.box(b.x0 - 0.01, 0, b.z0 - 0.01, b.x1 + 0.01, 0.025, b.z1 + 0.01, lin('#b3aa9c'), { s: 6 });
    walls(out, b, 0.025, h, lin(v.wall), 'plaster');
    gableRoof(out, b, h, 0.1, { o: 0.04, col: lin(v.roof), wall: v.wall, timbered: false });
    // Three big roller doors, a small door, high windows.
    const f = wallFrame(b, 0);
    for (const u of [0.15, 0.37, 0.59]) {
      wallRect(out.layers.wood, f, u - 0.08, u + 0.08, 0.025, 0.16, 0.005, lin('#8f98b0'), 10);
      for (let k = 1; k < 6; k++) beam(out.layers.timber, f, u - 0.08, 0.025 + k * 0.022, u + 0.08, 0.025 + k * 0.022, 0.005, lin('#737c94'));
      beam(out.layers.timber, f, u - 0.085, 0.025, u - 0.085, 0.165, 0.012, lin(v.trim));
      beam(out.layers.timber, f, u + 0.085, 0.025, u + 0.085, 0.165, 0.012, lin(v.trim));
      beam(out.layers.timber, f, u - 0.09, 0.165, u + 0.09, 0.165, 0.014, lin(v.trim));
    }
    doorAt(out, b, 0.74, 0.06, 0.11, wctx);
    for (const face of [1, 3]) for (const u of [0.08, 0.2, 0.32]) windowAt(out, b, face, u, 0.13, 0.06, 0.04, wctx);
    for (const u of [0.1, 0.25, 0.4, 0.55, 0.7]) windowAt(out, b, 2, u, 0.13, 0.06, 0.04, wctx);
    // A loading dock at the right, crates, pallets and a barrel stack.
    const W = out.layers.wood;
    S.box(b.x1, 0, b.z1 - 0.3, b.x1 + 0.08, 0.05, b.z1 - 0.04, lin('#b8ab94'), { s: 6 });
    for (const [cx, cz, c] of [[0.34, 0.34, '#c79a63'], [0.4, 0.38, '#b88a55'], [0.1, 0.36, '#d3a870'], [-0.1, 0.4, '#c79a63']]) {
      W.box(cx - 0.04, 0, cz - 0.035, cx + 0.04, 0.05, cz + 0.035, lin(c), { s: 8 });
      W.box(cx - 0.036, 0.05, cz - 0.03, cx + 0.036, 0.09, cz + 0.03, mul(lin(c), 1.08), { s: 8 });
    }
    for (const [cx, cz] of [[-0.3, 0.38], [-0.24, 0.4]]) out.layers.paint.cyl(cx, cz, 0.028, 0.028, 0, 0.06, 8, lin('#7a5b3c'), { top: lin('#5d4730'), s: 2 });
    const D = out.layers.dirt;
    D.quad([-0.46, 0.006, 0.47], [0.46, 0.006, 0.47], [0.46, 0.006, b.z1 + 0.01], [-0.46, 0.006, b.z1 + 0.01], lin('#c3b08c'), [[-0.46, -0.47], [0.46, -0.47], [0.46, -b.z1], [-0.46, -b.z1]]);
    lotGreens(out, ctx, [[-0.42, -0.38, 2, 0.5]], [[0.42, 0.42, 0.05]]);
  }

  function workshop(out, ctx) {
    const v = { wall: '#e8d6bc', roof: '#a86a52', trim: '#5a4231', shutter: '#4f7f7a' };
    const wctx = withLook(ctx, v);
    const b = block(0.56, 0.36, -0.06);
    const h = 0.17;
    const S = out.layers.stone;
    S.box(b.x0 - 0.012, 0, b.z0 - 0.012, b.x1 + 0.012, 0.03, b.z1 + 0.012, lin(STONE), { s: 6 });
    walls(out, b, 0.03, h, lin(v.wall));
    timbering(out, b, 0.03, h, ctx, [0, 1, 2, 3]);
    // Two sawtooth roofs: glass faces to the right.
    const G = out.layers.glass;
    const R = out.layers.roof;
    const rise = 0.09;
    for (let i = 0; i < 2; i++) {
      const xa = b.x0 + (i * (b.x1 - b.x0)) / 2;
      const xb = xa + (b.x1 - b.x0) / 2;
      const col = lin(v.roof);
      R.quad([xa, h, b.z1 + 0.025], [xb, h + rise, b.z1 + 0.025], [xb, h + rise, b.z0 - 0.025], [xa, h, b.z0 - 0.025], col, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      G.quad([xb, h + rise, b.z1 + 0.025], [xb, h, b.z1 + 0.025], [xb, h, b.z0 - 0.025], [xb, h + rise, b.z0 - 0.025], lin('#86bccd'));
      S.tri([xa, h, b.z1], [xb, h, b.z1], [xb, h + rise, b.z1], lin(v.wall), lin(v.wall), lin(v.wall), [xa * 5, h * 5], [xb * 5, h * 5], [xb * 5, (h + rise) * 5]);
      S.tri([xb, h, b.z0], [xa, h, b.z0], [xb, h + rise, b.z0], lin(v.wall), lin(v.wall), lin(v.wall), [-xb * 5, h * 5], [-xa * 5, h * 5], [-xb * 5, (h + rise) * 5]);
    }
    doorAt(out, b, 0.14, 0.09, 0.11, wctx);
    windowAt(out, b, 0, 0.32, 0.06, 0.14, 0.07, wctx);
    windowAt(out, b, 0, 0.5, 0.06, 0.07, 0.07, wctx, { shutters: true });
    for (const face of [1, 3]) windowAt(out, b, face, 0.18, 0.06, 0.07, 0.07, wctx);
    // A forge chimney that smokes while people work, an anvil sign and a woodpile.
    chimney(out, b.x1 - 0.1, -0.12, h + 0.09, h + 0.3);
    const [sx, sz] = S.tx(b.x1 - 0.1, -0.12);
    out.smoke.push({ x: sx, y: h + 0.36, z: sz, big: false });
    out.layers.paint.box(b.x0 + 0.02, 0.19, b.z1, b.x0 + 0.1, 0.21, b.z1 + 0.05, lin('#2f2c30'));
    for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) out.layers.bark.cyl(-0.3 + i * 0.026 + r * 0.013, 0.4, 0.012, 0.012, r * 0.024, r * 0.024 + 0.024, 6, lin('#9a6b44'));
    lotGreens(out, ctx, [[0.4, 0.34, 0, 0.5]], [[-0.4, 0.4, 0.05]]);
    schoolFence(out);
  }

  function powerplant(out, ctx) {
    const S = out.layers.stone;
    const brick = lin('#b3a8b8');
    const b = block(0.5, 0.36, 0.06);
    const h = 0.24;
    S.box(b.x0 - 0.012, 0, b.z0 - 0.012, b.x1 + 0.012, 0.03, b.z1 + 0.012, lin('#9a96a4'), { s: 6 });
    walls(out, b, 0.03, h, brick, 'stone');
    S.box(b.x0 - 0.008, h - 0.02, b.z0 - 0.008, b.x1 + 0.008, h, b.z1 + 0.008, lin('#8c8aa0'), { s: 6 });
    gableRoof(out, b, h, 0.09, { o: 0.03, col: lin('#6b6e7a'), wall: '#b3a8b8', endLayer: 'stone', timbered: false });
    const pctx = withLook(ctx, { trim: '#e8dfce' });
    for (const u of [0.08, 0.2, 0.32, 0.44]) windowAt(out, b, 0, u, 0.1, 0.06, 0.1, pctx);
    for (const face of [1, 3]) for (const u of [0.08, 0.2, 0.3]) windowAt(out, b, face, u, 0.1, 0.06, 0.1, pctx);
    wallRect(out.layers.wood, wallFrame(b, 0), 0.5 - 0.05, 0.5 + 0.0, 0.03, 0.14, 0.005, lin('#6a7a6e'), 10);
    wallRect(out.layers.paint, wallFrame(b, 0), 0.19, 0.31, 0.17, 0.2, 0.006, lin('#f6d04a'));
    // Two cooling towers behind: a pinched hyperboloid made of three stacked cones, steam rising.
    for (const [cx, cz] of [[-0.27, -0.27], [0.1, -0.33]]) {
      S.cyl(cx, cz, 0.12, 0.08, 0.0, 0.2, 14, lin('#d6d0dc'), { s: 3 });
      S.cyl(cx, cz, 0.08, 0.105, 0.2, 0.4, 14, lin('#cbc4d4'), { s: 3 });
      S.cyl(cx, cz, 0.108, 0.1, 0.4, 0.405, 14, lin('#8c8aa0'));
      const [sx, sz] = S.tx(cx, cz);
      out.smoke.push({ x: sx, y: 0.46, z: sz, big: true });
    }
    // A striped stack, and a switchyard with pylons and transformers.
    S.cyl(0.36, -0.1, 0.035, 0.024, 0, 0.55, 10, lin('#e6e0ea'), { s: 3 });
    S.cyl(0.36, -0.1, 0.0355, 0.0335, 0.4, 0.44, 10, lin('#e5534b'));
    S.cyl(0.36, -0.1, 0.03, 0.027, 0.5, 0.54, 10, lin('#e5534b'));
    const [sx2, sz2] = S.tx(0.36, -0.1);
    out.smoke.push({ x: sx2, y: 0.6, z: sz2, big: false });
    const T = out.layers.timber;
    for (const [px, pz] of [[-0.38, 0.4], [-0.2, 0.4]]) {
      T.rod([px - 0.03, 0, pz], [px, 0.22, pz], 0.01, lin('#7a7a88'));
      T.rod([px + 0.03, 0, pz], [px, 0.22, pz], 0.01, lin('#7a7a88'));
      T.box(px - 0.05, 0.2, pz - 0.006, px + 0.05, 0.212, pz + 0.006, lin('#7a7a88'));
    }
    T.rod([-0.38, 0.21, 0.4], [-0.2, 0.21, 0.4], 0.004, lin('#2f2c30'));
    for (const px of [0.18, 0.28]) S.box(px, 0, 0.32, px + 0.07, 0.07, 0.4, lin('#8f98a8'), { s: 5 });
    out.layers.paint.box(0.2, 0.08, 0.33, 0.26, 0.085, 0.39, lin('#f6d04a'));
    schoolFence(out);
  }

  // ---- Services ----------------------------------------------------------------------------------

  function kindergarten(out, ctx) {
    const v = { wall: '#fde7a8', roof: '#7fc4ad', trim: '#5a4231', shutter: '#ef7d6d' };
    const kctx = withLook(ctx, v);
    const b = block(0.56, 0.3, -0.12);
    const h = 0.16;
    const S = out.layers.stone;
    S.box(b.x0 - 0.01, 0, b.z0 - 0.01, b.x1 + 0.01, 0.025, b.z1 + 0.01, lin(STONE), { s: 6 });
    walls(out, b, 0.025, h, lin(v.wall));
    gableRoof(out, b, h, 0.13, { o: 0.05, col: lin(v.roof), wall: v.wall, timbered: false });
    // A rainbow of colour bands under the eaves.
    const f = wallFrame(b, 0);
    ['#ff8f8f', '#ffc46b', '#8fd18f', '#78b8e8'].forEach((c, i) => wallRect(out.layers.paint, f, 0, f.w, h - 0.02 - i * 0.012, h - 0.008 - i * 0.012, 0.004, lin(c)));
    doorAt(out, b, 0.44, 0.075, 0.1, kctx);
    for (const u of [0.1, 0.22, 0.36, 0.5]) if (Math.abs(u - 0.44) > 0.05) windowAt(out, b, 0, u, 0.05, 0.08, 0.07, kctx, { box: true });
    for (const face of [1, 3]) windowAt(out, b, face, 0.15, 0.06, 0.07, 0.07, kctx);
    chimney(out, b.x1 - 0.08, -0.14, h + 0.06, h + 0.19);
    // The play yard: a fence, a sandpit, toy blocks, a ball and a tree.
    const W = out.layers.wood;
    const pc = lin('#efe6d6');
    for (let i = 0; i <= 14; i++) W.box(-0.44 + i * 0.0629 - 0.007, 0, 0.44, -0.44 + i * 0.0629 + 0.007, 0.06, 0.454, pc, { s: 10 });
    W.box(-0.45, 0.04, 0.438, 0.45, 0.05, 0.456, pc, { s: 10 });
    W.box(-0.3, 0, 0.18, -0.12, 0.03, 0.34, lin('#a87848'), { s: 8 });
    out.layers.dirt.quad([-0.29, 0.032, 0.33], [-0.13, 0.032, 0.33], [-0.13, 0.032, 0.19], [-0.29, 0.032, 0.19], lin('#e6d3a0'), [[0, 0], [1, 0], [1, 1], [0, 1]]);
    [['#ef6f6f', 0.1], ['#78b8e8', 0.17], ['#8fd18f', 0.24]].forEach(([c, x], i) => out.layers.paint.box(x, 0, 0.26 + (i % 2) * 0.03, x + 0.045, 0.045, 0.305 + (i % 2) * 0.03, lin(c)));
    out.layers.paint.box(0.15, 0.045, 0.27, 0.195, 0.09, 0.315, lin('#ffc46b'));
    out.layers.paint.cyl(0.32, 0.3, 0.025, 0.025, 0, 0.05, 8, lin('#ef6f6f'));
    bench(out, 0.3, 0.38, 0);
    lotGreens(out, ctx, [[0.4, -0.36, 3, 0.5], [-0.42, -0.34, 0, 0.5]], [[-0.4, 0.4, 0.04]]);
  }

  function museum(out, ctx) {
    const v = { wall: '#e8dcd8', roof: '#8a6a7a', trim: '#f7f1e3', shutter: '#8a6a7a' };
    const mctx = withLook(ctx, v);
    const b = block(0.66, 0.4, -0.1);
    const h = 0.26;
    const mid = (b.x1 - b.x0) / 2;
    const S = out.layers.stone;
    S.box(b.x0 - 0.015, 0, b.z0 - 0.015, b.x1 + 0.015, 0.04, b.z1 + 0.015, pale, { s: 6 });
    walls(out, b, 0.04, h, lin(v.wall), 'stone');
    S.box(b.x0 - 0.01, h - 0.02, b.z0 - 0.01, b.x1 + 0.01, h + 0.012, b.z1 + 0.01, pale, { s: 6 });
    S.box(b.x0, h + 0.012, b.z0, b.x1, h + 0.03, b.z1, lin('#a89aa4'), { s: 6 });
    for (const u of [0.1, 0.2, 0.46, 0.56]) windowAt(out, b, 0, u, 0.08, 0.06, 0.13, mctx);
    for (const face of [1, 3]) for (const u of [0.08, 0.2, 0.32]) windowAt(out, b, face, u, 0.08, 0.06, 0.13, mctx);
    for (const u of [0.12, 0.26, 0.4, 0.54]) windowAt(out, b, 2, u, 0.08, 0.06, 0.13, mctx);
    // A drum and dome over the middle: stone drum, copper-green dome and a lantern.
    S.cyl(0, b.z0 + 0.2, 0.13, 0.125, h + 0.03, h + 0.11, 14, lin('#efe6d6'), { s: 3 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      out.layers.glass.box(Math.cos(a) * 0.128 - 0.012, h + 0.05, b.z0 + 0.2 + Math.sin(a) * 0.128 - 0.012, Math.cos(a) * 0.128 + 0.012, h + 0.09, b.z0 + 0.2 + Math.sin(a) * 0.128 + 0.012, lin('#ffd98f'));
    }
    const [dx, dz] = out.layers.roof.tx(0, b.z0 + 0.2);
    out.layers.roof.blob(dx, h + 0.11, dz, 0.13, 0.11, 0.13, lin('#4f8f7a'), lin('#8fc4a8'), 5, 1);
    out.layers.timber.cyl(0, b.z0 + 0.2, 0.012, 0.008, h + 0.2, h + 0.27, 6, lin('#c99a3a'));
    // A pillared entrance, banners and steps.
    for (const x of [-0.12, 0.12]) S.cyl(x, b.z1 + 0.05, 0.016, 0.014, 0.04, 0.22, 8, pale, { s: 3 });
    S.box(-0.14, 0.22, b.z1 - 0.01, 0.14, 0.24, b.z1 + 0.075, pale, { s: 6 });
    const f = wallFrame(b, 0);
    wallRect(out.layers.wood, f, mid - 0.055, mid + 0.055, 0.04, 0.17, 0.005, lin('#5b3f4a'), 10);
    archAt(out, 'wood', b, 0, mid, 0.17, 0.055, lin('#5b3f4a'));
    for (const u of [0.18, 0.48]) wallRect(out.layers.paint, f, u - 0.02, u + 0.02, 0.12, 0.23, 0.007, lin('#a64d5a'));
    steps(out, 0, 0.32, b.z1 + 0.075, 3, pale);
    bench(out, -0.3, b.z1 + 0.12, 0);
    bench(out, 0.3, b.z1 + 0.12, 0);
    lotGreens(out, ctx, [[-0.4, -0.36, 1, 0.5], [0.4, -0.36, 0, 0.5]], [[-0.42, 0.4, 0.05], [0.42, 0.4, 0.05]]);
    schoolFence(out);
  }

  function pharmacy(out, ctx) {
    const v = { wall: '#f2f8f2', roof: '#5aa88a', trim: '#4a6a5a', shutter: '#5aa88a' };
    const pctx = withLook(ctx, v);
    const b = block(0.44, 0.32, -0.06);
    const h = 0.17;
    const mid = (b.x1 - b.x0) / 2;
    out.layers.stone.box(b.x0 - 0.01, 0, b.z0 - 0.01, b.x1 + 0.01, 0.03, b.z1 + 0.01, lin(STONE), { s: 6 });
    walls(out, b, 0.03, h, lin(v.wall));
    gableRoof(out, b, h, 0.13, { o: 0.05, col: lin(v.roof), wall: v.wall, timbered: false });
    windowAt(out, b, 0, 0.12, 0.05, 0.14, 0.09, pctx);
    doorAt(out, b, mid + 0.06, 0.07, 0.11, pctx);
    for (const face of [1, 3]) windowAt(out, b, face, 0.16, 0.06, 0.07, 0.07, pctx);
    windowAt(out, b, 0, 0.36, 0.06, 0.04, 0.09, pctx);
    const P = out.layers.paint;
    for (let i = 0; i < 6; i++) {
      const xa = b.x0 + 0.03 + i * 0.063;
      const col = lin(i % 2 ? '#f4fbf6' : '#5aa88a');
      P.quad([xa, 0.145, b.z1], [xa + 0.063, 0.145, b.z1], [xa + 0.063, 0.115, b.z1 + 0.075], [xa, 0.115, b.z1 + 0.075], col, null, [mul(col, 0.9), mul(col, 0.9), col, col]);
    }
    // A projecting green-cross board on a bracket.
    const G = out.layers.glow;
    out.layers.timber.box(b.x0 - 0.04, 0.14, b.z1 + 0.04, b.x0 + 0.02, 0.15, b.z1 + 0.05, lin('#4a3326'));
    G.box(b.x0 - 0.04 - 0.012, 0.16, b.z1 + 0.04, b.x0 - 0.04 + 0.012, 0.25, b.z1 + 0.05, lin('#7fe0b0'));
    G.box(b.x0 - 0.075, 0.195, b.z1 + 0.04, b.x0 - 0.005, 0.215, b.z1 + 0.05, lin('#7fe0b0'));
    chimney(out, b.x1 - 0.08, -0.08, h + 0.07, h + 0.2);
    gardenAround(out, ctx, b, { fence: false });
    schoolFence(out);
  }

  function hospital(out, ctx) {
    const v = { wall: '#f4f7f5', roof: '#6aa89a', trim: '#8a9a94', shutter: '#6aa89a' };
    const hctx = withLook(ctx, v);
    const S = out.layers.stone;
    const wallc = lin(v.wall);
    const centre = { x0: -0.15, x1: 0.15, z0: -0.3, z1: 0.1 };
    const wl = { x0: -0.45, x1: -0.15, z0: -0.22, z1: 0.06 };
    const wr = { x0: 0.15, x1: 0.45, z0: -0.22, z1: 0.06 };
    for (const b of [wl, wr, centre]) S.box(b.x0 - 0.01, 0, b.z0 - 0.01, b.x1 + 0.01, 0.035, b.z1 + 0.01, pale, { s: 6 });
    walls(out, wl, 0.035, 0.24, wallc);
    walls(out, wr, 0.035, 0.24, wallc);
    walls(out, centre, 0.035, 0.46, wallc);
    for (const b of [wl, wr]) {
      for (let fl = 0; fl < 2; fl++) for (const u of [0.07, 0.15, 0.23]) windowAt(out, b, 0, u, 0.07 + fl * 0.09, 0.05, 0.065, hctx);
      S.box(b.x0 - 0.006, 0.236, b.z0 - 0.006, b.x1 + 0.006, 0.256, b.z1 + 0.006, lin('#9aa9a3'), { s: 6 });
    }
    for (let fl = 0; fl < 4; fl++) for (const u of [0.07, 0.15, 0.23]) if (fl > 0 || Math.abs(u - 0.15) > 0.04) windowAt(out, centre, 0, u, 0.06 + fl * 0.1, 0.05, 0.065, hctx);
    for (const face of [1, 3]) for (const u of [0.1, 0.25]) windowAt(out, centre, face, u, 0.18, 0.055, 0.07, hctx);
    S.box(centre.x0 - 0.008, 0.454, centre.z0 - 0.008, centre.x1 + 0.008, 0.48, centre.z1 + 0.008, lin('#9aa9a3'), { s: 6 });
    // A red cross on the tower, a covered ambulance bay and an ambulance.
    const f = wallFrame(centre, 0);
    wallRect(out.layers.paint, f, 0.09, 0.21, 0.31, 0.43, 0.007, lin('#fbf7ee'));
    wallRect(out.layers.paint, f, 0.135, 0.165, 0.32, 0.42, 0.009, lin('#d8392f'));
    wallRect(out.layers.paint, f, 0.1, 0.2, 0.355, 0.385, 0.009, lin('#d8392f'));
    wallRect(out.layers.wood, f, 0.1, 0.2, 0.035, 0.15, 0.005, lin('#a9d4cc'), 10);
    out.layers.paint.box(-0.11, 0.16, centre.z1, 0.11, 0.175, centre.z1 + 0.1, lin('#6aa89a'));
    for (const x of [-0.1, 0.1]) out.layers.timber.box(x - 0.007, 0, centre.z1 + 0.085, x + 0.007, 0.16, centre.z1 + 0.1, lin('#efe6d6'));
    const A = out.layers.paint;
    A.box(0.2, 0.02, 0.2, 0.34, 0.09, 0.28, lin('#fbf7ee'), { s: 4 });
    A.box(0.3, 0.02, 0.2, 0.37, 0.07, 0.28, lin('#fbf7ee'), { s: 4 });
    A.box(0.2, 0.05, 0.198, 0.34, 0.06, 0.202, lin('#d8392f'));
    out.layers.glow.box(0.24, 0.09, 0.21, 0.28, 0.1, 0.27, lin('#ff6b5e'));
    for (const wx of [0.23, 0.33]) for (const wz of [0.2, 0.28]) out.layers.timber.box(wx - 0.02, 0, wz - 0.01, wx + 0.02, 0.035, wz + 0.01, lin('#2f2c30'));
    // A helipad on the right wing.
    S.cyl(0.3, -0.08, 0.1, 0.1, 0.256, 0.264, 14, lin('#6e7b88'), { s: 2 });
    out.layers.paint.box(0.27, 0.265, -0.1, 0.285, 0.267, -0.06, lin('#fbf7ee'));
    out.layers.paint.box(0.315, 0.265, -0.1, 0.33, 0.267, -0.06, lin('#fbf7ee'));
    out.layers.paint.box(0.285, 0.265, -0.085, 0.315, 0.267, -0.075, lin('#fbf7ee'));
    // Lawn, path, benches and trees.
    S.box(-0.05, 0, 0.1, 0.05, 0.01, 0.46, pale, { s: 6 });
    bench(out, -0.2, 0.3, 0);
    bench(out, -0.34, 0.3, 0);
    lotGreens(out, ctx, [[-0.42, 0.18, 0, 0.5], [0.42, -0.36, 3, 0.5], [-0.42, -0.36, 1, 0.5]], [[0.1, 0.4, 0.05]]);
  }

  function firehut(out, ctx) {
    const v = { wall: '#c1604f', roof: '#5a4f60', trim: '#f4ecdc', shutter: '#3a3f4d' };
    const fctx = withLook(ctx, v);
    const b = block(0.46, 0.32, -0.04);
    const h = 0.18;
    const S = out.layers.stone;
    S.box(b.x0 - 0.01, 0, b.z0 - 0.01, b.x1 + 0.01, 0.03, b.z1 + 0.01, pale, { s: 6 });
    walls(out, b, 0.03, h, lin(v.wall), 'stone');
    gableRoof(out, b, h, 0.12, { o: 0.04, col: lin(v.roof), wall: v.wall, endLayer: 'stone', timbered: false });
    const f = wallFrame(b, 0);
    const u = 0.17;
    wallRect(out.layers.paint, f, u - 0.092, u + 0.092, 0.03, 0.15, 0.004, lin('#f4ecdc'));
    archAt(out, 'paint', b, 0, u, 0.15, 0.092, lin('#f4ecdc'), 0.004);
    wallRect(out.layers.wood, f, u - 0.08, u + 0.08, 0.03, 0.15, 0.007, lin('#a8362d'), 10);
    archAt(out, 'wood', b, 0, u, 0.15, 0.08, lin('#a8362d'), 0.007);
    for (const k of [-0.04, 0, 0.04]) beam(out.layers.timber, f, u + k, 0.035, u + k, 0.2, 0.008, lin('#7d2a24'));
    doorAt(out, b, 0.36, 0.06, 0.11, fctx);
    windowAt(out, b, 0, 0.36, 0.16, 0.055, 0.035, fctx);
    windowAt(out, b, 1, 0.16, 0.08, 0.06, 0.08, fctx);
    // A little bell tower at the back corner.
    const tb = { x0: b.x1 - 0.14, x1: b.x1 - 0.02, z0: b.z0 + 0.02, z1: b.z0 + 0.14 };
    walls(out, tb, 0, 0.36, lin(v.wall), 'stone');
    S.box(tb.x0 - 0.008, 0.33, tb.z0 - 0.008, tb.x1 + 0.008, 0.36, tb.z1 + 0.008, pale, { s: 6 });
    for (const [x, z] of [[tb.x0, tb.z0], [tb.x1, tb.z0], [tb.x0, tb.z1], [tb.x1, tb.z1]]) S.box(x - 0.008, 0.36, z - 0.008, x + 0.008, 0.44, z + 0.008, pale, { s: 6 });
    out.layers.paint.cyl((tb.x0 + tb.x1) / 2, (tb.z0 + tb.z1) / 2, 0.012, 0.022, 0.38, 0.42, 8, lin('#c99a3a'));
    spire(out, (tb.x0 + tb.x1) / 2, (tb.z0 + tb.z1) / 2, 0.1, 0.44, 0.56, lin(v.roof));
    windowAt(out, tb, 0, 0.06, 0.12, 0.035, 0.1, fctx);
    // A parked engine, a lantern and a hose reel.
    const P = out.layers.paint;
    const ex = 0.25;
    const ez = b.z1 + 0.13;
    P.box(ex - 0.11, 0.025, ez - 0.04, ex + 0.04, 0.085, ez + 0.04, lin('#c8392f'), { s: 4 });
    P.box(ex + 0.04, 0.025, ez - 0.04, ex + 0.1, 0.11, ez + 0.04, lin('#c8392f'), { s: 4 });
    out.layers.timber.rod([ex - 0.1, 0.11, ez], [ex + 0.03, 0.11, ez], 0.01, lin('#e8e0cf'));
    for (const wx of [-0.07, 0.07]) for (const wz of [-0.045, 0.045]) out.layers.timber.box(ex + wx - 0.016, 0, ez + wz - 0.007, ex + wx + 0.016, 0.034, ez + wz + 0.007, lin('#2f2c30'));
    out.layers.dirt.quad([-0.3, 0.006, 0.47], [0.46, 0.006, 0.47], [0.46, 0.006, b.z1 + 0.01], [-0.3, 0.006, b.z1 + 0.01], lin('#c9b997'), [[-0.3, -0.47], [0.46, -0.47], [0.46, -b.z1], [-0.3, -b.z1]]);
    const [lx, lz] = S.tx(-0.4, b.z1 + 0.08);
    lantern(out, lx, lz);
    lotGreens(out, ctx, [[-0.4, -0.36, 0, 0.5]], [[0.42, 0.42, 0.05]]);
    schoolFence(out);
  }

  // ---- Leisure ------------------------------------------------------------------------------------

  function fountain(out, ctx) {
    const S = out.layers.stone;
    const D = out.layers.dirt;
    D.quad([-0.46, 0.006, 0.46], [0.46, 0.006, 0.46], [0.46, 0.006, -0.46], [-0.46, 0.006, -0.46], lin('#d9cdb4'), [[-0.46, -0.46], [0.46, -0.46], [0.46, 0.46], [-0.46, 0.46]]);
    // A round basin, a pedestal, a bowl and arcing jets.
    S.cyl(0, 0, 0.27, 0.27, 0.006, 0.07, 18, lin('#cfc8ba'), { s: 3 });
    disc(out.layers.water, 0, 0, 0.245, 0.073, lin('#7fc8e3'), 18);
    S.cyl(0, 0, 0.05, 0.035, 0.07, 0.2, 10, lin('#d9d2c2'), { s: 3 });
    S.cyl(0, 0, 0.13, 0.05, 0.2, 0.235, 12, lin('#cfc8ba'), { s: 3 });
    disc(out.layers.water, 0, 0, 0.12, 0.238, lin('#8fd0e8'), 12);
    S.cyl(0, 0, 0.02, 0.015, 0.235, 0.33, 8, lin('#d9d2c2'));
    S.cyl(0, 0, 0.04, 0.012, 0.33, 0.36, 8, lin('#cfc8ba'));
    const Gl = out.layers.glass;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = 0.2;
      Gl.cyl(Math.cos(a) * r, Math.sin(a) * r, 0.006, 0.003, 0.074, 0.16, 5, lin('#cfeaf5'));
      Gl.cyl(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, 0.005, 0.003, 0.074, 0.12, 5, lin('#cfeaf5'));
    }
    Gl.cyl(0, 0, 0.007, 0.004, 0.36, 0.44, 5, lin('#cfeaf5'));
    // Benches and flower beds around the edge, lanterns at two corners.
    bench(out, -0.36, 0.38, 0);
    bench(out, 0.36, 0.38, 0);
    for (const [fx, fz] of [[-0.4, -0.4], [0.4, -0.4], [-0.44, 0], [0.44, 0]]) {
      const [wx, wz] = S.tx(fx, fz);
      flowerPatch(out, wx, wz, 0.07, 8, rand(ctx.x, ctx.y, 410 + fx * 10 + fz * 7));
    }
    for (const [lx, lz] of [[-0.43, 0.43], [0.43, 0.43]]) {
      const [wx, wz] = S.tx(lx, lz);
      lantern(out, wx, wz);
    }
  }

  function garden(out, ctx) {
    const W = out.layers.wood;
    const D = out.layers.dirt;
    D.quad([-0.46, 0.006, 0.46], [0.46, 0.006, 0.46], [0.46, 0.006, -0.46], [-0.46, 0.006, -0.46], lin('#a98664'), [[-0.46, -0.46], [0.46, -0.46], [0.46, 0.46], [-0.46, 0.46]]);
    const veg = ['#7fb85c', '#e5883c', '#d8566a', '#9fcf6a', '#f2c94c', '#c77dff'];
    for (let r = 0; r < 3; r++) {
      const z = -0.3 + r * 0.24;
      W.box(-0.4, 0.006, z - 0.07, 0.3, 0.05, z + 0.07, lin('#8b6a4a'), { s: 8, top: lin('#6b5036') });
      for (let i = 0; i < 9; i++) {
        const [wx, wz] = W.tx(-0.37 + i * 0.075, z + ((i % 2) - 0.5) * 0.05);
        out.tufts.push([wx, wz, 1.1, '#5f9a3e']);
        out.flowers.push([wx, 0.07, wz, 0.9, veg[(i + r * 2) % veg.length]]);
      }
    }
    // A tool shed, a barrel and a scarecrow.
    const b = { x0: 0.32, x1: 0.46, z0: -0.4, z1: -0.26 };
    walls(out, b, 0, 0.1, lin('#c79a63'), 'plaster');
    gableRoof(out, b, 0.1, 0.07, { o: 0.025, col: lin('#8b6a52'), wall: '#c79a63', timbered: false });
    out.layers.paint.cyl(0.38, 0.08, 0.035, 0.032, 0, 0.08, 8, lin('#7a5b3c'), { top: lin('#6b8fa8'), s: 2 });
    out.layers.timber.rod([0.38, 0, -0.1], [0.38, 0.2, -0.1], 0.012, lin('#8a6a46'));
    out.layers.timber.rod([0.32, 0.17, -0.1], [0.44, 0.17, -0.1], 0.01, lin('#8a6a46'));
    out.layers.paint.cyl(0.38, -0.1, 0.03, 0.002, 0.2, 0.25, 8, lin('#c99a3a'));
    const [hx, hz] = W.tx(0.38, -0.1);
    out.layers.leaf.blob(hx, 0.195, hz, 0.02, 0.02, 0.02, lin('#e8d6a8'), lin('#f4e8c0'), 2, 0);
    for (const [fx, fz] of [[0.36, 0.3], [0.44, 0.36]]) {
      const [wx, wz] = W.tx(fx, fz);
      flowerPatch(out, wx, wz, 0.06, 7, rand(ctx.x, ctx.y, 420 + fx * 10));
    }
    bench(out, -0.1, 0.4, 0);
    const [tx, tz] = W.tx(-0.42, 0.4);
    storyTree(out, tx, tz, 3, 0.45, ctx.x * 3 + ctx.y);
  }

  function pool(out, ctx) {
    const S = out.layers.stone;
    const W = out.layers.wood;
    // A paved deck, a stone rim and the water.
    S.box(-0.47, 0, -0.42, 0.47, 0.014, 0.44, lin('#e8dcc4'), { s: 5 });
    const rim = lin('#cfc8bc');
    S.box(-0.34, 0.014, -0.28, 0.34, 0.04, -0.25, rim, { s: 6 });
    S.box(-0.34, 0.014, 0.17, 0.34, 0.04, 0.2, rim, { s: 6 });
    S.box(-0.34, 0.014, -0.25, -0.31, 0.04, 0.17, rim, { s: 6 });
    S.box(0.31, 0.014, -0.25, 0.34, 0.04, 0.17, rim, { s: 6 });
    out.layers.dirt.quad([-0.31, 0.016, 0.17], [0.31, 0.016, 0.17], [0.31, 0.016, -0.25], [-0.31, 0.016, -0.25], lin('#a9d4de'), [[0, 0], [1, 0], [1, 1], [0, 1]]);
    out.layers.water.quad([-0.31, 0.03, 0.17], [0.31, 0.03, 0.17], [0.31, 0.03, -0.25], [-0.31, 0.03, -0.25], lin('#7fd0ee'), [[0, 0], [1, 0], [1, 1], [0, 1]]);
    // Lane ropes and floats.
    for (let k = -1; k <= 1; k += 2) {
      out.layers.timber.rod([k * 0.1, 0.045, 0.16], [k * 0.1, 0.045, -0.24], 0.004, lin('#f8f4ec'));
      for (let i = 0; i < 8; i++) out.layers.paint.box(k * 0.1 - 0.007, 0.036, 0.14 - i * 0.05, k * 0.1 + 0.007, 0.05, 0.15 - i * 0.05, lin(i % 2 ? '#e5534b' : '#f8f4ec'));
    }
    // A diving board and a ladder.
    W.box(-0.06, 0.014, -0.34, 0.06, 0.1, -0.28, lin('#efe6d6'), { s: 6 });
    W.box(-0.025, 0.1, -0.34, 0.025, 0.108, -0.18, lin('#4f9ac4'));
    for (const x of [0.28, 0.32]) S.box(x - 0.004, 0.036, 0.19, x + 0.004, 0.09, 0.2, lin('#c9c5cc'));
    // A changing hut with a red roof, loungers and parasols.
    const b = { x0: -0.45, x1: -0.2, z0: 0.26, z1: 0.42 };
    walls(out, b, 0.014, 0.14, lin('#fbe3cf'), 'plaster');
    gableRoof(out, b, 0.14, 0.07, { o: 0.025, col: lin('#c8483f'), wall: '#fbe3cf', timbered: false });
    doorAt(out, b, 0.09, 0.05, 0.09, withLook(ctx, { trim: '#6b4630' }));
    for (const [lx, c] of [[0.0, '#f8f1e4'], [0.14, '#e8d0a8'], [0.28, '#f8f1e4']]) W.box(lx - 0.045, 0.014, 0.3, lx + 0.045, 0.034, 0.37, lin(c), { s: 6 });
    for (const [px, col] of [[0.07, '#c8483f'], [0.35, '#4f9ac4']]) {
      out.layers.timber.cyl(px, 0.33, 0.005, 0.005, 0.014, 0.2, 5, lin('#8a6a52'));
      out.layers.paint.cyl(px, 0.33, 0.085, 0.004, 0.17, 0.215, 8, lin(col));
    }
    lotGreens(out, ctx, [[0.42, -0.36, 3, 0.5], [-0.42, -0.36, 0, 0.5]], []);
  }

  function cinema(out, ctx) {
    const v = { wall: '#5a4f78', roof: '#3d3652', trim: '#f4ecdc', shutter: '#d96a7a' };
    const cctx = withLook(ctx, v);
    const b = block(0.6, 0.4, -0.08);
    const h = 0.3;
    const mid = (b.x1 - b.x0) / 2;
    const S = out.layers.stone;
    S.box(b.x0 - 0.012, 0, b.z0 - 0.012, b.x1 + 0.012, 0.035, b.z1 + 0.012, lin('#a89fb8'), { s: 6 });
    walls(out, b, 0.035, h, lin(v.wall), 'plaster');
    S.box(b.x0 - 0.01, h, b.z0 - 0.01, b.x1 + 0.01, h + 0.025, b.z1 + 0.01, lin('#cfc4de'), { s: 6 });
    out.layers.roof.box(b.x0, h + 0.025, b.z0, b.x1, h + 0.04, b.z1, lin(v.roof));
    const f = wallFrame(b, 0);
    // Posters in lit frames either side, a big glowing marquee over the doors.
    for (const u of [0.1, 0.5]) {
      wallRect(out.layers.paint, f, u - 0.045, u + 0.045, 0.1, 0.24, 0.006, lin('#f0d27c'));
      wallRect(out.layers.paint, f, u - 0.036, u + 0.036, 0.11, 0.23, 0.008, lin(u < 0.3 ? '#d96a7a' : '#4f9ac4'));
    }
    for (const face of [1, 3]) for (const u of [0.1, 0.25]) wallRect(out.layers.paint, wallFrame(b, face), u - 0.04, u + 0.04, 0.1, 0.22, 0.006, lin(u < 0.2 ? '#f0d27c' : '#8fd18f'));
    wallRect(out.layers.glass, f, mid - 0.09, mid + 0.09, 0.035, 0.13, 0.004, lin('#ffd98f'));
    const m0 = b.z1;
    out.layers.paint.box(-0.17, 0.14, m0, 0.17, 0.2, m0 + 0.09, lin('#2a2438'));
    out.layers.glow.box(-0.15, 0.155, m0 + 0.088, 0.15, 0.185, m0 + 0.094, lin('#ffe28a'));
    for (let i = 0; i < 9; i++) out.layers.glow.box(-0.165 + i * 0.0412 - 0.005, 0.2, m0 + 0.085, -0.165 + i * 0.0412 + 0.005, 0.21, m0 + 0.095, lin('#ffe28a'));
    for (const x of [-0.16, 0.16]) out.layers.timber.box(x - 0.007, 0, m0 + 0.075, x + 0.007, 0.14, m0 + 0.09, lin('#cfc4de'));
    // A tall vertical sign on the corner, lit up.
    out.layers.timber.box(b.x0 - 0.015, 0.3, b.z1 - 0.045, b.x0 + 0.005, 0.5, b.z1 - 0.03, lin('#2a2438'));
    out.layers.glow.box(b.x0 - 0.01, 0.32, b.z1 - 0.03, b.x0 + 0.0, 0.48, b.z1 - 0.025, lin('#ff7fa8'));
    steps(out, 0, 0.3, m0 + 0.09, 2, lin('#cfc4de'));
    const [lx, lz] = S.tx(-0.4, 0.36);
    lantern(out, lx, lz);
    const [kx, kz] = S.tx(0.4, 0.36);
    lantern(out, kx, kz);
    lotGreens(out, ctx, [[-0.4, -0.38, 0, 0.5], [0.42, -0.38, 3, 0.5]], [[-0.42, 0.1, 0.05], [0.42, 0.1, 0.05]]);
    schoolFence(out);
    void cctx;
  }

  function stadium(out, ctx) {
    const S = out.layers.stone;
    const G = out.layers.grass;
    const P = out.layers.paint;
    // The pitch: mown stripes inside a track.
    const L0 = 0.3;
    S.box(-0.42, 0, -0.3, 0.42, 0.012, 0.3, lin('#c9b997'), { s: 5 });
    for (let i = 0; i < 8; i++) {
      const za = -0.25 + i * 0.0625;
      const c = i % 2 ? lin('#8fc468') : lin('#7fb85c');
      G.quad([-0.32, 0.016, za + 0.0625], [0.32, 0.016, za + 0.0625], [0.32, 0.016, za], [-0.32, 0.016, za], c, [[-0.32 + ctx.x, -za - 0.0625 - ctx.y], [0.32 + ctx.x, -za - 0.0625 - ctx.y], [0.32 + ctx.x, -za - ctx.y], [-0.32 + ctx.x, -za - ctx.y]]);
    }
    const white = lin('#fbf7ee');
    const line = (x0, z0, x1, z1) => P.quad([x0, 0.02, z1], [x1, 0.02, z1], [x1, 0.02, z0], [x0, 0.02, z0], white);
    line(-0.3, -0.24, 0.3, -0.232);
    line(-0.3, 0.232, 0.3, 0.24);
    line(-0.3, -0.24, -0.292, 0.24);
    line(0.292, -0.24, 0.3, 0.24);
    line(-0.004, -0.24, 0.004, 0.24);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const c = ((i + 1) / 14) * Math.PI * 2;
      P.quad([Math.cos(a) * 0.07, 0.021, Math.sin(a) * 0.07], [Math.cos(c) * 0.07, 0.021, Math.sin(c) * 0.07], [Math.cos(c) * 0.078, 0.021, Math.sin(c) * 0.078], [Math.cos(a) * 0.078, 0.021, Math.sin(a) * 0.078], white);
    }
    // Stepped stands on all four sides, in stone with coloured seats.
    const stand = (x0, z0, x1, z1, dir) => {
      for (let i = 0; i < (dir === 'z+' ? 2 : 4); i++) {
        const d = i * 0.045;
        const hh = 0.06 + i * 0.05;
        if (dir === 'z-') S.box(x0, 0, z0 - d - 0.04, x1, hh, z0 - d, lin('#d8cab4'), { s: 5 });
        if (dir === 'z+') S.box(x0, 0, z1 + d, x1, hh, z1 + d + 0.04, lin('#d8cab4'), { s: 5 });
        if (dir === 'x-') S.box(x0 - d - 0.04, 0, z0, x0 - d, hh, z1, lin('#d8cab4'), { s: 5 });
        if (dir === 'x+') S.box(x1 + d, 0, z0, x1 + d + 0.04, hh, z1, lin('#d8cab4'), { s: 5 });
      }
    };
    stand(-0.34, -0.26, 0.34, 0.26, 'z-');
    stand(-0.34, -0.26, 0.34, 0.26, 'z+');
    stand(-0.34, -0.2, 0.34, 0.2, 'x-');
    stand(-0.34, -0.2, 0.34, 0.2, 'x+');
    for (let i = 0; i < 16; i++) {
      const col = lin(i % 3 ? '#e5534b' : '#f4f1e8');
      const x = -0.3 + i * 0.04;
      P.box(x, 0.19, -0.44, x + 0.03, 0.2, -0.41, col);
      P.box(x, 0.065, 0.285, x + 0.03, 0.075, 0.3, col);
    }
    // Four floodlight masts and a roofed gate on the front.
    const T = out.layers.timber;
    for (const [px, pz] of [[-0.44, -0.44], [0.44, -0.44], [-0.44, 0.44], [0.44, 0.44]]) {
      T.cyl(px, pz, 0.012, 0.008, 0, 0.5, 6, lin('#9a96a4'));
      out.layers.glow.box(px - 0.04, 0.5, pz - 0.014, px + 0.04, 0.54, pz + 0.014, lin('#fff4c8'));
      out.lamps.push({ x: out.layers.timber.tx(px, pz)[0], y: 0.52, z: out.layers.timber.tx(px, pz)[1] });
    }
    S.box(-0.12, 0, 0.3, -0.07, 0.17, 0.4, lin('#cfc4b0'), { s: 5 });
    S.box(0.07, 0, 0.3, 0.12, 0.17, 0.4, lin('#cfc4b0'), { s: 5 });
    S.box(-0.14, 0.17, 0.3, 0.14, 0.2, 0.4, lin('#b9a98c'), { s: 5 });
    out.layers.roof.box(-0.15, 0.2, 0.29, 0.15, 0.215, 0.41, lin('#b9583f'));
    P.box(-0.08, 0.17, 0.4, 0.08, 0.2, 0.406, lin('#e0b648'));
    // Flags along the gate.
    for (const x of [-0.2, 0.2]) {
      T.box(x - 0.004, 0, 0.4, x + 0.004, 0.26, 0.408, lin('#efe6d6'));
      P.quad([x + 0.004, 0.26, 0.404], [x + 0.06, 0.245, 0.404], [x + 0.06, 0.2, 0.404], [x + 0.004, 0.2, 0.404], lin(x < 0 ? '#e5534b' : '#4f9ac4'));
    }
  }


  // A farm: ploughed fields with rows of crops, a red barn, a silo, hay bales and a scarecrow.
  function farm(out, ctx) {
    const W = out.layers.wood;
    const D = out.layers.dirt;
    D.quad([-0.47, 0.006, 0.47], [0.47, 0.006, 0.47], [0.47, 0.006, -0.47], [-0.47, 0.006, -0.47], lin('#b8a064'), [[-0.47, -0.47], [0.47, -0.47], [0.47, 0.47], [-0.47, 0.47]]);
    const crops = ['#7fb85c', '#e5883c', '#d8566a', '#f2c94c', '#9fcf6a'];
    for (let r = 0; r < 5; r++) {
      const z = 0.06 + r * 0.08;
      W.box(-0.44, 0.006, z - 0.025, 0.12, 0.03, z + 0.025, lin('#7d5f45'), { s: 8, top: lin('#6b5036') });
      for (let i = 0; i < 12; i++) {
        const [wx, wz] = W.tx(-0.41 + i * 0.047, z);
        out.tufts.push([wx, wz, 1.2, r % 2 ? '#5f9a3e' : '#78b04a']);
        if (i % 3 === 0) out.flowers.push([wx, 0.04, wz, 0.8, crops[(i + r) % crops.length]]);
      }
    }
    // A golden wheat patch on the left.
    for (let i = 0; i < 40; i++) {
      const [wx, wz] = W.tx(-0.43 + (i % 10) * 0.05, -0.43 + Math.floor(i / 10) * 0.05);
      out.tufts.push([wx, wz, 1.6, '#d9b84a']);
    }
    // The barn: red boards, white doors with a cross, a gambrel-ish roof along z, a hayloft window.
    const b = { x0: 0.17, x1: 0.43, z0: -0.4, z1: -0.04 };
    const v = { wall: '#c4574a', roof: '#6d5a52', trim: '#f2e8d8', shutter: '#f2e8d8' };
    const fctx = withLook(ctx, v);
    walls(out, b, 0, 0.14, lin(v.wall), 'plaster');
    ridgeZ(out, b, 0.14, 0.13, { o: 0.02, col: lin(v.roof), wall: v.wall, timbered: false });
    const f = wallFrame(b, 0);
    wallRect(out.layers.paint, f, 0.06, 0.2, 0.0, 0.11, 0.006, lin('#f2e8d8'));
    beam(out.layers.timber, f, 0.06, 0.0, 0.2, 0.11, 0.012, lin('#c4574a'));
    beam(out.layers.timber, f, 0.2, 0.0, 0.06, 0.11, 0.012, lin('#c4574a'));
    windowAt(out, b, 0, 0.13, 0.15, 0.05, 0.05, fctx);
    // The silo and its dome.
    out.layers.stone.cyl(0.1, -0.3, 0.05, 0.05, 0, 0.3, 10, lin('#d9d2c4'), { s: 3 });
    out.layers.stone.cyl(0.1, -0.3, 0.052, 0.052, 0.1, 0.108, 10, lin('#b9b1a2'));
    out.layers.stone.cyl(0.1, -0.3, 0.052, 0.052, 0.2, 0.208, 10, lin('#b9b1a2'));
    const [sx, sz] = W.tx(0.1, -0.3);
    out.layers.roof.blob(sx, 0.3, sz, 0.052, 0.05, 0.052, lin('#8c8478'), lin('#c9c1b2'), 3, 1);
    // Hay bales, a trough, a scarecrow and a fence along the front.
    for (const [hx, hz] of [[0.3, 0.1], [0.38, 0.14], [0.34, 0.2]]) {
      out.layers.thatch.cyl(hx, hz, 0.04, 0.04, 0, 0.055, 10, lin('#d9b45c'), { top: lin('#e6c874'), s: 3 });
    }
    out.layers.timber.rod([-0.3, 0, 0.4], [-0.3, 0.2, 0.4], 0.012, lin('#8a6a46'));
    out.layers.timber.rod([-0.36, 0.17, 0.4], [-0.24, 0.17, 0.4], 0.01, lin('#8a6a46'));
    out.layers.paint.cyl(-0.3, 0.4, 0.03, 0.002, 0.2, 0.25, 8, lin('#c99a3a'));
    const [hx2, hz2] = W.tx(-0.3, 0.4);
    out.layers.leaf.blob(hx2, 0.195, hz2, 0.02, 0.02, 0.02, lin('#e8d6a8'), lin('#f4e8c0'), 4, 0);
    const pc = lin('#efe6d6');
    for (let i = 0; i <= 12; i++) W.box(-0.46 + i * 0.077 - 0.007, 0, 0.45, -0.46 + i * 0.077 + 0.007, 0.07, 0.462, pc, { s: 10 });
    W.box(-0.47, 0.045, 0.447, 0.47, 0.055, 0.465, pc, { s: 10 });
    lotGreens(out, ctx, [[0.42, 0.3, 0, 0.5]], []);
  }

  // A mill: a stone tower windmill with turning sails (set at an angle), a mill house, sacks and a cart.
  function mill(out, ctx) {
    const S = out.layers.stone;
    const T = out.layers.timber;
    const W = out.layers.wood;
    const pale = lin('#e4d9c4');
    const cx = 0.16;
    const cz = -0.18;
    S.cyl(cx, cz, 0.15, 0.13, 0, 0.18, 12, pale, { s: 3 });
    S.cyl(cx, cz, 0.13, 0.1, 0.18, 0.42, 12, lin('#d9cdb4'), { s: 3 });
    S.cyl(cx, cz, 0.132, 0.132, 0.17, 0.18, 12, lin('#b9a98c'));
    out.layers.roof.cyl(cx, cz, 0.125, 0.004, 0.42, 0.56, 12, lin('#8a6a52'));
    out.layers.glass.box(cx - 0.02, 0.26, cz + 0.095, cx + 0.02, 0.32, cz + 0.105, lin('#ffd98f'));
    W.box(cx - 0.035, 0, cz + 0.135, cx + 0.035, 0.09, cz + 0.152, lin('#7a5a3c'), { s: 8 });
    // Four sails on the front, turned a little: each a pole with a pale cloth frame.
    const hz = cz + 0.14;
    const hy = 0.38;
    T.box(cx - 0.012, hy - 0.012, cz + 0.1, cx + 0.012, hy + 0.012, hz + 0.02, lin('#5a4231'));
    for (let k = 0; k < 4; k++) {
      const a = 0.45 + (k * Math.PI) / 2;
      const ex = cx + Math.cos(a) * 0.3;
      const ey = hy + Math.sin(a) * 0.3;
      T.rod([cx, hy, hz + 0.02], [ex, ey, hz + 0.02], 0.012, lin('#7a5a3c'));
      const px = -Math.sin(a) * 0.05;
      const py = Math.cos(a) * 0.05;
      const m0x = cx + Math.cos(a) * 0.08;
      const m0y = hy + Math.sin(a) * 0.08;
      out.layers.paint.quad([m0x, m0y, hz + 0.03], [ex, ey, hz + 0.03], [ex + px, ey + py, hz + 0.03], [m0x + px, m0y + py, hz + 0.03], lin('#f4ecdc'));
      out.layers.paint.quad([m0x, m0y, hz + 0.03], [m0x + px, m0y + py, hz + 0.03], [ex + px, ey + py, hz + 0.03], [ex, ey, hz + 0.03], lin('#e8dcc4'));
    }
    // The mill house at the front left.
    const v = { wall: '#e8d9bc', roof: '#a86a52', trim: '#5a4231', shutter: '#4f7f7a' };
    const mctx = withLook(ctx, v);
    const b = block(0.4, 0.3, 0.18);
    b.x0 -= 0.12;
    b.x1 -= 0.12;
    const mid = (b.x1 - b.x0) / 2;
    S.box(b.x0 - 0.01, 0, b.z0 - 0.01, b.x1 + 0.01, 0.03, b.z1 + 0.01, lin(STONE), { s: 6 });
    walls(out, b, 0.03, 0.17, lin(v.wall));
    timbering(out, b, 0.03, 0.17, ctx, [0, 1, 2, 3]);
    gableRoof(out, b, 0.17, 0.14, { o: 0.05, col: lin(v.roof), wall: v.wall });
    doorAt(out, b, mid - 0.08, 0.08, 0.12, mctx);
    windowAt(out, b, 0, mid + 0.1, 0.06, 0.07, 0.07, mctx, { box: true });
    windowAt(out, b, 1, 0.15, 0.07, 0.06, 0.07, mctx);
    chimney(out, b.x1 - 0.06, b.z0 + 0.1, 0.22, 0.34);
    // Flour sacks, a handcart, a stream of grain sacks on a pallet.
    for (const [sx, sz] of [[0.2, 0.36], [0.26, 0.4], [0.23, 0.32]]) {
      out.layers.paint.cyl(sx, sz, 0.026, 0.022, 0, 0.06, 7, lin('#f4efe2'), { top: lin('#e8dfc8'), s: 2 });
    }
    W.box(0.3, 0.04, 0.3, 0.42, 0.06, 0.4, lin('#a87848'), { s: 8 });
    for (const [wx, wz] of [[0.3, 0.4], [0.42, 0.4]]) T.cyl(wx, wz, 0.03, 0.03, 0, 0.012, 8, lin('#3a2f26'));
    out.layers.dirt.quad([-0.46, 0.006, 0.47], [0.46, 0.006, 0.47], [0.46, 0.006, 0.0], [-0.46, 0.006, 0.0], lin('#c9b997'), [[-0.46, -0.47], [0.46, -0.47], [0.46, 0], [-0.46, 0]]);
    lotGreens(out, ctx, [[-0.4, -0.38, 0, 0.5], [0.42, 0.4, 3, 0.45]], [[-0.4, 0.4, 0.05]]);
  }

  return { mill, farm, bungalow, rowhouse, villa, restaurant, market, bank, hotel, warehouse, workshop, powerplant, kindergarten, museum, pharmacy, hospital, firehut, fountain, garden, pool, cinema, stadium };
}
