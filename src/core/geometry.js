/* =========================================================================
   geometry.js - procedural mesh construction.

   One thing here is load-bearing for the look and is easy to get wrong:
   large surfaces must be *subdivided*. Lighting is computed per vertex, so
   an undivided floor quad has exactly four lit points and a lamp standing on
   it produces no pool of light at all. PS1-era games tessellated their floors
   for precisely this reason, so doing the same is both correct and period
   accurate. `segments` on the plane/box helpers is that control.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG;
const { mat4, vec3 } = SATG;
const { VERTEX_FLOATS } = SATG.gl;
const { clamp, lerp } = SATG.util;

const WHITE = [1, 1, 1];

/* A scratch matrix pool so primitive emission allocates nothing per call. */
const _m = mat4.create();
const _n3 = new Float32Array(9);
const _v = new Float32Array(3);

class Builder {
  constructor() {
    this.verts = [];        // flat, VERTEX_FLOATS per vertex
    this.indices = [];
    this.matrix = mat4.create();
    this._stack = [];
    this.color = WHITE;
  }

  /* ---------------------------------------------------------- transform */

  push() { this._stack.push(mat4.copy(mat4.create(), this.matrix)); return this; }
  pop()  { if (this._stack.length) this.matrix = this._stack.pop(); return this; }

  identity() { mat4.identity(this.matrix); return this; }

  translate(x, y, z) {
    mat4.multiply(this.matrix, this.matrix, mat4.fromTranslation(_m, x, y, z));
    return this;
  }
  rotateX(r) { mat4.multiply(this.matrix, this.matrix, mat4.fromXRotation(_m, r)); return this; }
  rotateY(r) { mat4.multiply(this.matrix, this.matrix, mat4.fromYRotation(_m, r)); return this; }
  rotateZ(r) { mat4.multiply(this.matrix, this.matrix, mat4.fromZRotation(_m, r)); return this; }
  scale(x, y, z) {
    mat4.multiply(this.matrix, this.matrix, mat4.fromScaling(_m, x, y, z === undefined ? x : z));
    return this;
  }

  /* Per-vertex tint applied to everything emitted from here on. Doubles as
     hand-painted ambient occlusion - darkening vertices in corners costs
     nothing and does more for the mood than any real AO pass would. */
  setColor(c) { this.color = c || WHITE; return this; }

  /* ------------------------------------------------------------- emit */

  vertex(px, py, pz, nx, ny, nz, u, v, col) {
    vec3.set(_v, px, py, pz);
    vec3.transformMat4(_v, _v, this.matrix);
    const wx = _v[0], wy = _v[1], wz = _v[2];

    mat4.normalMat3(_n3, this.matrix);
    const tnx = _n3[0] * nx + _n3[3] * ny + _n3[6] * nz;
    const tny = _n3[1] * nx + _n3[4] * ny + _n3[7] * nz;
    const tnz = _n3[2] * nx + _n3[5] * ny + _n3[8] * nz;
    const len = Math.hypot(tnx, tny, tnz) || 1;

    const c = col || this.color;
    const i = this.verts.length;
    this.verts.length = i + VERTEX_FLOATS;
    this.verts[i]     = wx;
    this.verts[i + 1] = wy;
    this.verts[i + 2] = wz;
    this.verts[i + 3] = tnx / len;
    this.verts[i + 4] = tny / len;
    this.verts[i + 5] = tnz / len;
    this.verts[i + 6] = u;
    this.verts[i + 7] = v;
    this.verts[i + 8]  = c[0];
    this.verts[i + 9]  = c[1];
    this.verts[i + 10] = c[2];
    return (i / VERTEX_FLOATS) | 0;
  }

  tri(a, b, c) { this.indices.push(a, b, c); return this; }
  quadIdx(a, b, c, d) { this.indices.push(a, b, c, a, c, d); return this; }

  /* ------------------------------------------------------- primitives */

  /**
   * Subdivided quad in the XY plane facing +Z, centred on the origin.
   * Corner colours let a face carry its own baked gradient.
   */
  grid(w, h, segX, segY, uScale, vScale, cornerColors) {
    segX = Math.max(1, segX | 0);
    segY = Math.max(1, segY | 0);
    uScale = uScale === undefined ? 1 : uScale;
    vScale = vScale === undefined ? 1 : vScale;

    const base = (this.verts.length / VERTEX_FLOATS) | 0;
    for (let j = 0; j <= segY; j++) {
      const ty = j / segY;
      for (let i = 0; i <= segX; i++) {
        const tx = i / segX;
        let col = this.color;
        if (cornerColors) {
          // bilinear blend of the four corner tints
          const top = [
            lerp(cornerColors[0][0], cornerColors[1][0], tx),
            lerp(cornerColors[0][1], cornerColors[1][1], tx),
            lerp(cornerColors[0][2], cornerColors[1][2], tx)];
          const bot = [
            lerp(cornerColors[3][0], cornerColors[2][0], tx),
            lerp(cornerColors[3][1], cornerColors[2][1], tx),
            lerp(cornerColors[3][2], cornerColors[2][2], tx)];
          col = [lerp(top[0], bot[0], ty), lerp(top[1], bot[1], ty), lerp(top[2], bot[2], ty)];
        }
        this.vertex(
          (tx - 0.5) * w, (0.5 - ty) * h, 0,
          0, 0, 1,
          tx * uScale, ty * vScale,
          col
        );
      }
    }
    /* Winding: rows run top-to-bottom (y decreases as j grows), so the
       counter-clockwise order seen from +Z is TL -> BL -> BR -> TR. Taking
       the rows in the other order yields clockwise triangles, and every
       face in the game would be silently backface-culled. */
    const stride = segX + 1;
    for (let j = 0; j < segY; j++) {
      for (let i = 0; i < segX; i++) {
        const a = base + j * stride + i;
        this.quadIdx(a, a + stride, a + stride + 1, a + 1);
      }
    }
    return this;
  }

  /**
   * Axis-aligned box centred on the origin.
   * opts.seg      subdivisions per face (number or [x,y,z])
   * opts.uvScale  texels per world unit
   * opts.inward   flip faces to be seen from inside (rooms)
   * opts.skip     face names to omit: 'px','nx','py','ny','pz','nz'
   */
  box(w, h, d, opts) {
    opts = opts || {};
    const seg = opts.seg === undefined ? 1 : opts.seg;
    const segArr = Array.isArray(seg) ? seg : [seg, seg, seg];
    const uv = opts.uvScale === undefined ? 1 : opts.uvScale;
    const inward = !!opts.inward;
    const skip = opts.skip || [];
    const has = (f) => skip.indexOf(f) === -1;

    const faces = [
      // name, rotation applied before the +Z-facing grid, plane size, segs
      ['pz', (b) => b.translate(0, 0, d / 2),                       w, h, segArr[0], segArr[1]],
      ['nz', (b) => b.translate(0, 0, -d / 2).rotateY(Math.PI),     w, h, segArr[0], segArr[1]],
      ['px', (b) => b.translate(w / 2, 0, 0).rotateY(Math.PI / 2),  d, h, segArr[2], segArr[1]],
      ['nx', (b) => b.translate(-w / 2, 0, 0).rotateY(-Math.PI / 2),d, h, segArr[2], segArr[1]],
      ['py', (b) => b.translate(0, h / 2, 0).rotateX(-Math.PI / 2), w, d, segArr[0], segArr[2]],
      ['ny', (b) => b.translate(0, -h / 2, 0).rotateX(Math.PI / 2), w, d, segArr[0], segArr[2]]
    ];

    for (const [name, place, fw, fh, sx, sy] of faces) {
      if (!has(name)) continue;
      this.push();
      place(this);
      if (inward) this.scale(-1, 1, 1);   // mirror so winding faces inward
      this.grid(fw, fh, sx, sy, fw * uv, fh * uv, opts.cornerColors);
      this.pop();
    }
    return this;
  }

  /**
   * Cylinder along +Y, centred on the origin. Low `sides` on purpose - 6 to 10
   * is the range that reads as PS1 rather than as a smooth modern mesh.
   */
  cylinder(radius, height, sides, opts) {
    opts = opts || {};
    sides = Math.max(3, sides | 0);
    const uv = opts.uvScale === undefined ? 1 : opts.uvScale;
    const capped = opts.capped !== false;
    const rTop = opts.radiusTop === undefined ? radius : opts.radiusTop;

    const base = (this.verts.length / VERTEX_FLOATS) | 0;
    for (let i = 0; i <= sides; i++) {
      const t = i / sides;
      const a = t * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      this.vertex(ca * rTop, height / 2, sa * rTop, ca, 0, sa, t * uv * radius * 6, 0);
      this.vertex(ca * radius, -height / 2, sa * radius, ca, 0, sa, t * uv * radius * 6, height * uv);
    }
    for (let i = 0; i < sides; i++) {
      const a = base + i * 2;
      this.quadIdx(a, a + 2, a + 3, a + 1);
    }

    if (capped) {
      for (const [y, ny, r] of [[height / 2, 1, rTop], [-height / 2, -1, radius]]) {
        const c = this.vertex(0, y, 0, 0, ny, 0, 0.5, 0.5);
        const ring = [];
        for (let i = 0; i <= sides; i++) {
          const a = (i / sides) * Math.PI * 2;
          ring.push(this.vertex(Math.cos(a) * r, y, Math.sin(a) * r, 0, ny, 0,
            0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5));
        }
        for (let i = 0; i < sides; i++) {
          if (ny > 0) this.tri(c, ring[i], ring[i + 1]);
          else this.tri(c, ring[i + 1], ring[i]);
        }
      }
    }
    return this;
  }

  /* A flat quad given by explicit corners, wound a-b-c-d. Useful for the
     odd non-axis-aligned panel without building a whole transform. */
  quad(a, b, c, d, uScale, vScale) {
    uScale = uScale === undefined ? 1 : uScale;
    vScale = vScale === undefined ? 1 : vScale;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const n = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0]
    ];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n[0] /= l; n[1] /= l; n[2] /= l;
    const i0 = this.vertex(a[0], a[1], a[2], n[0], n[1], n[2], 0, 0);
    const i1 = this.vertex(b[0], b[1], b[2], n[0], n[1], n[2], uScale, 0);
    const i2 = this.vertex(c[0], c[1], c[2], n[0], n[1], n[2], uScale, vScale);
    const i3 = this.vertex(d[0], d[1], d[2], n[0], n[1], n[2], 0, vScale);
    this.quadIdx(i0, i1, i2, i3);
    return this;
  }

  /* ------------------------------------------------------------ finish */

  get vertexCount() { return (this.verts.length / VERTEX_FLOATS) | 0; }
  get triangleCount() { return (this.indices.length / 3) | 0; }

  build(gl) {
    return new SATG.gl.Mesh(gl, new Float32Array(this.verts), this.indices);
  }

  /* Bounding box in world space - used for click targets and camera framing. */
  bounds() {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.verts.length; i += VERTEX_FLOATS) {
      for (let k = 0; k < 3; k++) {
        if (this.verts[i + k] < min[k]) min[k] = this.verts[i + k];
        if (this.verts[i + k] > max[k]) max[k] = this.verts[i + k];
      }
    }
    return { min, max };
  }
}

/* --------------------------------------------------------------- exports */

SATG.geom = { Builder };

})(window);
