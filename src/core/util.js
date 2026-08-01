/* =========================================================================
   util.js - namespace root, deterministic RNG, and the small linear-algebra
   kit the renderer runs on. No dependencies; this file loads first.
   ========================================================================= */
(function (global) {
'use strict';

const SATG = global.SATG || (global.SATG = {});

/* Build stamp. Bumped whenever the engine changes in a way worth telling
   apart from a stale cached copy - "it looks like nothing changed" and "the
   change did not work" are different bugs, and this is how they are told
   apart. Printed to the console at boot and shown on the title card. */
SATG.BUILD = '2026.08.01-h';

/* ---------------------------------------------------------------- scalars */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
const smoothstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const smootherstep = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/* Approach `target` framerate-independently. `rate` is roughly "how much of
   the remaining gap closes per second", so it stays stable across hitches. */
function damp(current, target, rate, dt) {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

/* ------------------------------------------------------------------- rng */

/* mulberry32 - tiny, fast, good enough distribution for question generation.
   Seeded so a run can be reproduced exactly when debugging a bad question. */
function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  const next = function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  next.int = (lo, hi) => Math.floor(next() * (hi - lo + 1)) + lo;      // inclusive
  next.float = (lo, hi) => lo + next() * (hi - lo);
  next.bool = (p) => next() < (p === undefined ? 0.5 : p);
  next.sign = () => (next() < 0.5 ? -1 : 1);
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];

  /* Draw from `arr` avoiding values already in `exclude`. Falls back to a
     plain pick rather than looping forever when everything is excluded. */
  next.pickBut = (arr, exclude) => {
    const pool = arr.filter((v) => exclude.indexOf(v) === -1);
    return pool.length ? next.pick(pool) : next.pick(arr);
  };

  /* Non-zero integer in [-mag, mag]; the workhorse for coefficient choice. */
  next.nz = (mag) => {
    const v = next.int(1, mag);
    return next.bool() ? v : -v;
  };

  next.shuffle = (arr) => {
    const a2 = arr.slice();
    for (let i = a2.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      const t = a2[i]; a2[i] = a2[j]; a2[j] = t;
    }
    return a2;
  };

  /* Weighted pick. `items` is [{w, ...}] or paired with a weights array. */
  next.weighted = (items, weightOf) => {
    let total = 0;
    for (const it of items) total += weightOf ? weightOf(it) : it.w;
    let r = next() * total;
    for (const it of items) {
      r -= weightOf ? weightOf(it) : it.w;
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  };

  return next;
}

/* A shared default stream, reseeded per run from the clock. */
const rng = makeRng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);

/* ------------------------------------------------------------------ misc */

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { const t = b; b = a % b; a = t; }
  return a || 1;
}

/* Value noise, 1D - used for lamp flicker and grain drift. Cheap and smooth. */
function noise1(x) {
  const i = Math.floor(x), f = x - i;
  const h = (n) => {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  return lerp(h(i), h(i + 1), smoothstep(f));
}

/* ------------------------------------------------------------------ vec3 */

const vec3 = {
  create: (x, y, z) => new Float32Array([x || 0, y || 0, z || 0]),
  set: (o, x, y, z) => { o[0] = x; o[1] = y; o[2] = z; return o; },
  copy: (o, a) => { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; },
  add: (o, a, b) => { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; },
  sub: (o, a, b) => { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; },
  scale: (o, a, s) => { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; },
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  cross: (o, a, b) => {
    const ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2];
    o[0] = ay * bz - az * by;
    o[1] = az * bx - ax * bz;
    o[2] = ax * by - ay * bx;
    return o;
  },
  normalize: (o, a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l;
    return o;
  },
  lerp: (o, a, b, t) => {
    o[0] = lerp(a[0], b[0], t); o[1] = lerp(a[1], b[1], t); o[2] = lerp(a[2], b[2], t);
    return o;
  },
  /* Transform a point by a column-major mat4 (w assumed 1, no perspective divide). */
  transformMat4: (o, a, m) => {
    const x = a[0], y = a[1], z = a[2];
    o[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    o[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    o[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    return o;
  }
};

/* ------------------------------------------------------------------ mat4
   Column-major, matching what WebGL's uniformMatrix4fv expects with
   transpose=false. Index [col*4 + row].
   ------------------------------------------------------------------------ */

const mat4 = {
  create() {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },

  identity(o) {
    o.fill(0); o[0] = o[5] = o[10] = o[15] = 1;
    return o;
  },

  copy(o, a) { o.set(a); return o; },

  /* o = a * b  (apply b first, then a) */
  multiply(o, a, b) {
    const a00=a[0],a01=a[1],a02=a[2],a03=a[3],
          a10=a[4],a11=a[5],a12=a[6],a13=a[7],
          a20=a[8],a21=a[9],a22=a[10],a23=a[11],
          a30=a[12],a31=a[13],a32=a[14],a33=a[15];
    for (let i = 0; i < 4; i++) {
      const b0 = b[i*4], b1 = b[i*4+1], b2 = b[i*4+2], b3 = b[i*4+3];
      o[i*4]   = b0*a00 + b1*a10 + b2*a20 + b3*a30;
      o[i*4+1] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
      o[i*4+2] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
      o[i*4+3] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
    }
    return o;
  },

  fromTranslation(o, x, y, z) {
    mat4.identity(o); o[12] = x; o[13] = y; o[14] = z;
    return o;
  },

  fromScaling(o, x, y, z) {
    o.fill(0); o[0] = x; o[5] = y; o[10] = z; o[15] = 1;
    return o;
  },

  fromXRotation(o, r) {
    const c = Math.cos(r), s = Math.sin(r);
    mat4.identity(o);
    o[5] = c; o[6] = s; o[9] = -s; o[10] = c;
    return o;
  },

  fromYRotation(o, r) {
    const c = Math.cos(r), s = Math.sin(r);
    mat4.identity(o);
    o[0] = c; o[2] = -s; o[8] = s; o[10] = c;
    return o;
  },

  fromZRotation(o, r) {
    const c = Math.cos(r), s = Math.sin(r);
    mat4.identity(o);
    o[0] = c; o[1] = s; o[4] = -s; o[5] = c;
    return o;
  },

  /* Compose translate * rotateY * rotateX * rotateZ * scale in one shot.
     This is the only composition the scene actually needs. */
  compose(o, pos, rot, scl) {
    const cx = Math.cos(rot[0]), sx = Math.sin(rot[0]);
    const cy = Math.cos(rot[1]), sy = Math.sin(rot[1]);
    const cz = Math.cos(rot[2]), sz = Math.sin(rot[2]);

    // R = Ry * Rx * Rz
    const r00 =  cy * cz + sy * sx * sz;
    const r01 =  cx * sz;
    const r02 = -sy * cz + cy * sx * sz;

    const r10 = -cy * sz + sy * sx * cz;
    const r11 =  cx * cz;
    const r12 =  sy * sz + cy * sx * cz;

    const r20 =  sy * cx;
    const r21 = -sx;
    const r22 =  cy * cx;

    o[0] = r00 * scl[0]; o[1] = r01 * scl[0]; o[2]  = r02 * scl[0]; o[3]  = 0;
    o[4] = r10 * scl[1]; o[5] = r11 * scl[1]; o[6]  = r12 * scl[1]; o[7]  = 0;
    o[8] = r20 * scl[2]; o[9] = r21 * scl[2]; o[10] = r22 * scl[2]; o[11] = 0;
    o[12] = pos[0]; o[13] = pos[1]; o[14] = pos[2]; o[15] = 1;
    return o;
  },

  perspective(o, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    o.fill(0);
    o[0] = f / aspect;
    o[5] = f;
    o[11] = -1;
    const nf = 1 / (near - far);
    o[10] = (far + near) * nf;
    o[14] = 2 * far * near * nf;
    return o;
  },

  ortho(o, left, right, bottom, top, near, far) {
    o.fill(0);
    o[0] = 2 / (right - left);
    o[5] = 2 / (top - bottom);
    o[10] = -2 / (far - near);
    o[12] = -(right + left) / (right - left);
    o[13] = -(top + bottom) / (top - bottom);
    o[14] = -(far + near) / (far - near);
    o[15] = 1;
    return o;
  },

  lookAt(o, eye, center, up) {
    const z = vec3.create(); vec3.normalize(z, vec3.sub(z, eye, center));
    const x = vec3.create(); vec3.normalize(x, vec3.cross(x, up, z));
    const y = vec3.create(); vec3.cross(y, z, x);
    o[0]=x[0]; o[1]=y[0]; o[2]=z[0];  o[3]=0;
    o[4]=x[1]; o[5]=y[1]; o[6]=z[1];  o[7]=0;
    o[8]=x[2]; o[9]=y[2]; o[10]=z[2]; o[11]=0;
    o[12]=-vec3.dot(x,eye); o[13]=-vec3.dot(y,eye); o[14]=-vec3.dot(z,eye); o[15]=1;
    return o;
  },

  invert(o, a) {
    const a00=a[0],a01=a[1],a02=a[2],a03=a[3],
          a10=a[4],a11=a[5],a12=a[6],a13=a[7],
          a20=a[8],a21=a[9],a22=a[10],a23=a[11],
          a30=a[12],a31=a[13],a32=a[14],a33=a[15];
    const b00=a00*a11-a01*a10, b01=a00*a12-a02*a10, b02=a00*a13-a03*a10,
          b03=a01*a12-a02*a11, b04=a01*a13-a03*a11, b05=a02*a13-a03*a12,
          b06=a20*a31-a21*a30, b07=a20*a32-a22*a30, b08=a20*a33-a23*a30,
          b09=a21*a32-a22*a31, b10=a21*a33-a23*a31, b11=a22*a33-a23*a32;
    let det = b00*b11 - b01*b10 + b02*b09 + b03*b08 - b04*b07 + b05*b06;
    if (!det) return null;
    det = 1.0 / det;
    o[0]=(a11*b11-a12*b10+a13*b09)*det;
    o[1]=(a02*b10-a01*b11-a03*b09)*det;
    o[2]=(a31*b05-a32*b04+a33*b03)*det;
    o[3]=(a22*b04-a21*b05-a23*b03)*det;
    o[4]=(a12*b08-a10*b11-a13*b07)*det;
    o[5]=(a00*b11-a02*b08+a03*b07)*det;
    o[6]=(a32*b02-a30*b05-a33*b01)*det;
    o[7]=(a20*b05-a22*b02+a23*b01)*det;
    o[8]=(a10*b10-a11*b08+a13*b06)*det;
    o[9]=(a01*b08-a00*b10-a03*b06)*det;
    o[10]=(a30*b04-a31*b02+a33*b00)*det;
    o[11]=(a21*b02-a20*b04-a23*b00)*det;
    o[12]=(a11*b07-a10*b09-a12*b06)*det;
    o[13]=(a00*b09-a01*b07+a02*b06)*det;
    o[14]=(a31*b01-a30*b03-a32*b00)*det;
    o[15]=(a20*b03-a21*b01+a22*b00)*det;
    return o;
  },

  /* Inverse-TRANSPOSE of the upper 3x3, written into a mat3 (9 floats).
     Needed so non-uniform scaling doesn't skew normals.

     The transpose is not optional and not cosmetic: for a rotation the
     correct normal matrix is the rotation itself, but the bare inverse is its
     transpose - so omitting the final flip points every rotated surface's
     normal the wrong way and the lighting inverts. */
  normalMat3(o3, m) {
    const a00=m[0],a01=m[1],a02=m[2],
          a10=m[4],a11=m[5],a12=m[6],
          a20=m[8],a21=m[9],a22=m[10];
    const b01 =  a22*a11 - a12*a21;
    const b11 = -a22*a10 + a12*a20;
    const b21 =  a21*a10 - a11*a20;
    let det = a00*b01 + a01*b11 + a02*b21;
    if (!det) { o3.fill(0); o3[0]=o3[4]=o3[8]=1; return o3; }
    det = 1.0 / det;

    // inverse, column-major
    const i0 = b01 * det;
    const i1 = (-a22*a01 + a02*a21) * det;
    const i2 = ( a12*a01 - a02*a11) * det;
    const i3 = b11 * det;
    const i4 = ( a22*a00 - a02*a20) * det;
    const i5 = (-a12*a00 + a02*a10) * det;
    const i6 = b21 * det;
    const i7 = (-a21*a00 + a01*a20) * det;
    const i8 = ( a11*a00 - a01*a10) * det;

    // written out transposed
    o3[0]=i0; o3[1]=i3; o3[2]=i6;
    o3[3]=i1; o3[4]=i4; o3[5]=i7;
    o3[6]=i2; o3[7]=i5; o3[8]=i8;
    return o3;
  }
};

/* --------------------------------------------------------------- exports */

SATG.util = {
  clamp, lerp, invLerp, smoothstep, smootherstep, damp,
  TAU, DEG, gcd, noise1, makeRng, rng
};
SATG.vec3 = vec3;
SATG.mat4 = mat4;

})(window);
