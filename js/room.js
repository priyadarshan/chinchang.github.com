/**
 * kushagra.dev — voxel workstation
 * A tiny pixel-art 3D diorama of my actual room, built with three.js.
 * Everything is boxes. No models, no textures except a few hand-drawn
 * pixel maps (posters, screens) painted onto canvases at runtime.
 */
import * as THREE from "/js/vendor/three.module.min.js";
import { audio, pianoNote, playTune, blip, motor, midiName, CHALA_TUNE } from "/js/chiptune.js";

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const C = {
  wall: 0xe9c66c,
  wallDark: 0xd9b55a,
  floorA: 0x8a5a3a,
  floorB: 0x7b4f31,
  floorC: 0x94654a,
  skirting: 0xf3ecd8,
  white: 0xf4f3ee,
  offWhite: 0xe6e3da,
  silver: 0xbfc2c8,
  silverDark: 0x9a9ea6,
  black: 0x15171b,
  dark: 0x23262c,
  charcoal: 0x2e323a,
  deskTop: 0x30384a,
  deskTop2: 0x2a3141,
  screenBlue: 0x1b1fd6,
  laptopKeys: 0x3a3d44,
  purple: 0x6c3fc9,
  purpleLight: 0x8b5cf6,
  red: 0xd7263d,
  blue: 0x2b6be0,
  yellow: 0xf2c531,
  orange: 0xf08a24,
  green: 0x3fb950,
  pink: 0xf59ab5,
  stickyPink: 0xf7a1c4,
  stickyBlue: 0x6cb8f0,
  stickyYellow: 0xf5d76e,
  wood: 0x5a3a22,
  woodDark: 0x442a17,
  woodLight: 0x6e4a2c,
  brass: 0xc9a24a,
  piano: 0x101114,
  pianoTop: 0x1a1b20,
  key: 0xf7f5ef,
  keyBlack: 0x0d0d10,
  curtainBase: 0xa9b8c9,
  glass: 0x2b3d55,
  cloud: 0xfbfaf6,
  rug: 0x35586b,
  rugDark: 0x2c4a5b,
  skin: 0xf0c59c,
  hair: 0xf5d21f,
};

// ---------------------------------------------------------------------------
// Voxel builder — batches boxes into a single InstancedMesh
// ---------------------------------------------------------------------------
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _col = new THREE.Color();

class Vox {
  constructor() {
    this.items = [];
  }
  /** box(x, y, z, w, h, d, color, {rot:[rx,ry,rz], pivot:[px,py,pz]}) */
  box(x, y, z, w, h, d, color, opts) {
    this.items.push({ x, y, z, w, h, d, color, opts });
    return this;
  }
  /** Fill unit voxels inside a sphere */
  sphere(cx, cy, cz, r, color) {
    const R = Math.ceil(r);
    for (let x = -R; x <= R; x++)
      for (let y = -R; y <= R; y++)
        for (let z = -R; z <= R; z++) {
          if (Math.hypot(x, y, z) <= r) this.box(cx + x, cy + y, cz + z, 1, 1, 1, color);
        }
    return this;
  }
  build(material, { shadow = true, receive = true } = {}) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0.5, 0.5, 0.5);
    const mesh = new THREE.InstancedMesh(geo, material, this.items.length);
    this.items.forEach((it, i) => {
      _p.set(it.x, it.y, it.z);
      _s.set(it.w, it.h, it.d);
      _q.identity();
      _m.compose(_p, _q, _s);
      if (it.opts && it.opts.rot) {
        const [rx, ry, rz] = it.opts.rot;
        const [px, py, pz] = it.opts.pivot || [it.x, it.y, it.z];
        const rotM = new THREE.Matrix4().makeRotationFromEuler(_e.set(rx, ry, rz));
        const t1 = new THREE.Matrix4().makeTranslation(px, py, pz);
        const t2 = new THREE.Matrix4().makeTranslation(-px, -py, -pz);
        _m.premultiply(t2).premultiply(rotM).premultiply(t1);
      }
      mesh.setMatrixAt(i, _m);
      mesh.setColorAt(i, _col.set(it.color));
    });
    mesh.castShadow = shadow;
    mesh.receiveShadow = receive;
    return mesh;
  }
}

// Material with a subtle per-voxel grain so large boxes still read as voxels.
function voxelMaterial() {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vWp;\nvarying vec3 vWn;"
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        vec3 wn = normal;
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
          wn = mat3(instanceMatrix) * wn;
        #endif
        vWp = (modelMatrix * wp4).xyz;
        vWn = normalize(mat3(modelMatrix) * wn);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWp;
        varying vec3 vWn;
        float vhash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec3 n = normalize(vWn);
          vec3 cell = floor(vWp - n * 0.02);
          float h = vhash(cell);
          diffuseColor.rgb *= 1.0 + (h - 0.5) * 0.11;
          // faint seams between voxels
          vec3 f = fract(vWp);
          vec3 ed = min(f, 1.0 - f);
          vec3 an = abs(n);
          float e = min(mix(ed.x, 1.0, an.x), min(mix(ed.y, 1.0, an.y), mix(ed.z, 1.0, an.z)));
          diffuseColor.rgb *= 0.94 + 0.06 * smoothstep(0.0, 0.06, e);
          // faces facing down/away get a touch of darkening for depth
          diffuseColor.rgb *= 0.92 + 0.08 * (n.y * 0.5 + 0.5);
        }`
      );
  };
  return mat;
}

// ---------------------------------------------------------------------------
// Pixel-art helpers
// ---------------------------------------------------------------------------
function pixelTexture(rows, palette, bg) {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === "." || ch === " ") continue;
      const col = palette[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  return tex;
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// --- posters ---------------------------------------------------------------
const NARUTO = {
  bg: "#8a2a1f",
  pal: { y: "#f7d23a", Y: "#e0b429", b: "#233b7c", s: "#c9d0da", k: "#f2c9a0", K: "#e0b088", e: "#2c6fd8", w: "#ffffff", r: "#c8371f", R: "#a52a15", d: "#3a2a1a", g: "#f0f0f0" },
  rows: [
    "....y..yy..y..yy..",
    "...yyy.yyy.yyy.yy.",
    "..yyyyyyyyyyyyyyy.",
    "..yYyyyyyyyyyyYyy.",
    "..ybbbbsssssbbbby.",
    "..ybbbbsgsgsbbbby.",
    "...kkkkkkkkkkkkk..",
    "...kwekkkkkkkwek..",
    "...kkkkkkKkkkkkk..",
    "...kddkkkkkkkddk..",
    "...kddkkkgggkddk..",
    "....kkkkkkkkkkk...",
    "..rrRrrrkkkkrrRrr.",
    "..rrrrrrrrrrrrrrr.",
  ],
};
const GOKU = {
  bg: "#5aa7e8",
  pal: { k: "#111318", h: "#3b3d4a", s: "#f0c59c", w: "#ffffff", e: "#111318", m: "#b8443a", o: "#f2891f", b: "#2b4fbf", K: "#7a1c14" },
  rows: [
    "....k....k.k....",
    "...kk...kkkk....",
    "..kkk..kkkkk.k..",
    "k.kkkkkkkkkkkk..",
    ".kkkkkkkkkkkkk..",
    "..kkhkkkkkkkk...",
    "..kkkkkkkkkkkk..",
    "...kssssssssk...",
    "...swesssswes...",
    "...ssssssssss...",
    "....sssmmsss....",
    "....ssssssss....",
    "......ssss......",
    "....bbbbbbbb....",
    "..oooobbbboooo..",
    ".sooooobbooooos.",
    ".soooooooooooos.",
    ".soooooooooKoos.",
    ".bboooooooooobb.",
    "..ss.oooooo.ss..",
    "....bbbbbbbb....",
    "....oooooooo....",
    "....ooo..ooo....",
    "...bbbb..bbbb...",
  ],
};
// Super Saiyan palette swap: gold hair, green eyes, golden aura
const GOKU_SSJ = { ...GOKU, bg: "#ffcf4a", pal: { ...GOKU.pal, k: "#f5d21f", h: "#fff4a8", e: "#1f9e7a" } };
const WOLVERINE = {
  bg: "#8fd0b9",
  pal: { k: "#101216", y: "#f5c518", Y: "#d9a90f", w: "#ffffff", b: "#2a3f9e", B: "#1e2f7a", s: "#f0c59c", c: "#e8e8e8" },
  rows: [
    ".k........k.",
    ".kk......kk.",
    "..kyyyyyyk..",
    "..yyyyyyyy..",
    "..ykwyykwy..",
    "..yyyyyyyy..",
    "..yyysssyy..",
    "...yysssy...",
    "..yyyyyyyy..",
    ".yyybbbbyyy.",
    ".yyybbbbyyy.",
    "cyyyyyyyyyyc",
    "..bbbBBbbb..",
    "..bbb..bbb..",
    "..bbb..bbb..",
    "..yyy..yyy..",
  ],
};
const DEADPOOL_WOLV = {
  bg: "#e58a2b",
  pal: { r: "#c81e2b", R: "#9c1421", k: "#111216", w: "#ffffff", y: "#f5c518", b: "#2a3f9e", s: "#f0c59c", g: "#8c8c8c" },
  rows: [
    "............",
    ".rrrr..k..k.",
    "rrrrrr.kyyk.",
    "rkkrkkryyyyy",
    "rkwrkwrykwyk",
    "rkkrkkryyyyy",
    "rrrrrrryysyy",
    ".rrrr..yyyy.",
    ".rrrrgg.yyyy",
    "rrrrrggyybby",
    "rRrrrg..ybby",
    "rrrrrr..yyyy",
    ".rrrr...bbbb",
    ".rr.rr..bb.b",
    ".rr.rr..bb.b",
    ".kk.kk..yy.y",
  ],
};
const BATMAN = {
  bg: "#c9502a",
  pal: { k: "#111216", K: "#22242c", w: "#ffffff", s: "#f0c59c", b: "#2c3550", B: "#1d2438", y: "#f5c518", c: "#6b4a2a", C: "#4e3620", o: "#f0a04b" },
  rows: [
    ".k....o...k.",
    ".kk...o..kk.",
    ".kkkkkkkkkk.",
    ".kKkkkkkkKk.",
    ".kkwkkkkwkk.",
    ".kkkkkkkkkk.",
    "..kkssssk...",
    "..kssssss...",
    ".bbbbbbbbbb.",
    "bbbbkkkkbbbb",
    "bbbkkkkkkbbb",
    ".yyyyyyyyyy.",
    "..bbbBbbbb..",
    "..bbb..bbb..",
    "c.bbb..bbb.c",
    "CckkkCCkkkcC",
  ],
};
const JOKER = {
  bg: "#2e2e34",
  pal: { g: "#2f9e5b", G: "#237a45", w: "#f4f1ea", W: "#e0dcd2", k: "#1a1a1e", r: "#c8202e", p: "#5b2d8e", P: "#47206f", y: "#f5c518" },
  rows: [
    ".gggggggg.",
    "gggGggGggg",
    "ggwwwwwwgg",
    "gwwwwwwwwg",
    ".wwkwwkww.",
    ".wwwwwwww.",
    ".wrwwwwrw.",
    ".wwrrrrww.",
    "..wWwwWw..",
    ".pppwwppp.",
    "ppppyyppp.",
    "pppPppPppp",
  ],
};
const PHOTO = {
  bg: "#7fb7e6",
  pal: { s: "#f0c59c", k: "#2a1d14", g: "#6fb06a", b: "#3a5fbf", r: "#d8455e", y: "#f2d16b" },
  rows: [
    "........",
    "..k..k..",
    ".ss..ss.",
    "..b..r..",
    "yyyyyyyy",
    "yyyyyyyy",
  ],
};

function curtainTexture(seed) {
  const rnd = seeded(seed);
  const cols = 10;
  const rows = 36;
  const lines = [];
  for (let y = 0; y < rows; y++) {
    let s = "";
    for (let x = 0; x < cols; x++) {
      const v = rnd();
      s += v < 0.5 ? "." : v < 0.62 ? "s" : v < 0.76 ? "o" : v < 0.88 ? "g" : v < 0.95 ? "y" : "r";
    }
    lines.push(s);
  }
  return pixelTexture(lines, { s: "#c9d3dd", o: "#e77c34", g: "#7cb342", y: "#f2c94c", r: "#d4433a" }, "#9fb2c6");
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
function makeMonitorScreen() {
  const W = 400;
  const H = 160;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;

  const LEFT = [
    ["#f7a1c4", "> build a voxel room for my homepage"],
    ["#e8e8ff", "  Read 3 files, ran 2 shell commands"],
    ["#f5d76e", "+ js/room.js"],
    ["#f5d76e", "+ index.html"],
    ["#a8ffb0", "  npx eleventy --serve"],
    ["#e8e8ff", "  [11ty] Wrote 183 files"],
    ["#f7a1c4", "> pay attention to details"],
    ["#e8e8ff", "  Adding rubik's cube, posters,"],
    ["#e8e8ff", "  robots, a purple ball..."],
    ["#a8ffb0", "  done."],
  ];
  const RIGHT = [
    ["#e8e8ff", "$ git status"],
    ["#a8ffb0", "On branch master"],
    ["#f5d76e", "  modified: index.html"],
    ["#f5d76e", "  new file: js/room.js"],
    ["#e8e8ff", "$ git commit -m 'voxel room'"],
    ["#a8ffb0", "[master 3d1c0d3] voxel room"],
    ["#e8e8ff", " 2 files changed, 900 insertions(+)"],
    ["#e8e8ff", "$ git push"],
    ["#a8ffb0", "Fast-forward"],
    ["#f7a1c4", "$ whoami"],
    ["#ffffff", "kushagra"],
    ["#e8e8ff", "$ _"],
  ];

  let progress = 0; // total characters typed so far
  const totalChars = () => LEFT.concat(RIGHT).reduce((n, l) => n + l[1].length, 0);
  const TOTAL = totalChars();

  function drawPane(lines, x0, y0, w, charsAvail) {
    ctx.font = "bold 9px Menlo, Consolas, monospace";
    let y = y0;
    let budget = charsAvail;
    for (const [color, text] of lines) {
      if (budget <= 0) break;
      const shown = text.slice(0, budget);
      ctx.fillStyle = color;
      ctx.fillText(shown, x0, y);
      budget -= text.length;
      y += 12;
      if (y > H - 6) break;
    }
    return { y, done: budget >= 0 };
  }

  function draw(t) {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#1b1fd6";
    ctx.fillRect(0, 0, W, H);
    // menu bar
    ctx.fillStyle = "#2f34e0";
    ctx.fillRect(0, 0, W, 8);
    ctx.fillStyle = "#f7a1c4";
    ctx.fillRect(4, 2, 4, 4);
    ctx.fillStyle = "#e8e8ff";
    for (let i = 0; i < 6; i++) ctx.fillRect(14 + i * 22, 3, 12, 2);
    // pane divider
    ctx.fillStyle = "#3a3ff0";
    ctx.fillRect(W / 2 - 1, 8, 2, H - 8);
    // status bar
    ctx.fillStyle = "#12139a";
    ctx.fillRect(0, H - 8, W, 8);
    ctx.fillStyle = "#a8ffb0";
    ctx.fillRect(4, H - 5, 40, 2);
    ctx.fillStyle = "#f5d76e";
    ctx.fillRect(W - 44, H - 5, 40, 2);

    // typing: left pane first, then right pane
    const leftTotal = LEFT.reduce((n, l) => n + l[1].length, 0);
    const leftChars = Math.min(progress, leftTotal);
    const rightChars = Math.max(0, progress - leftTotal);
    const L = drawPane(LEFT, 10, 24, W / 2 - 20, leftChars);
    const R = drawPane(RIGHT, W / 2 + 10, 24, W / 2 - 20, rightChars);

    // little mascot block (pixel critter) on left pane
    ctx.fillStyle = "#f7a1c4";
    ctx.fillRect(12, 14, 3, 3);
    ctx.fillRect(16, 14, 3, 3);
    ctx.fillRect(10, 17, 11, 3);

    // cursor
    const blink = Math.floor(t * 2.5) % 2 === 0;
    if (blink) {
      ctx.fillStyle = "#ffffff";
      const cx = progress < leftTotal ? 10 : W / 2 + 10;
      const cy = progress < leftTotal ? L.y - 9 : R.y - 9;
      ctx.fillRect(cx + 2, Math.max(16, cy), 5, 9);
    }
    tex.needsUpdate = true;
  }

  return {
    tex,
    typing: false,
    update(t) {
      // type ~26 chars/sec, hold on the finished screen, then start over
      const cycle = t % 40;
      progress = Math.min(TOTAL, Math.floor(cycle * 26));
      this.typing = progress < TOTAL;
      draw(t);
      return this.typing;
    },
  };
}

function makeLaptopScreen() {
  const W = 160;
  const H = 100;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#3a3d44";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#2b2e34";
  ctx.fillRect(0, 0, W, 7);
  ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(4 + i * 6, 2, 3, 3);
  });
  // sidebar thumbnails
  ctx.fillStyle = "#4a4e57";
  ctx.fillRect(0, 7, 26, H - 7);
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = "#ececec";
    ctx.fillRect(6, 12 + i * 14, 14, 10);
  }
  // page
  ctx.fillStyle = "#f7f7f5";
  ctx.fillRect(40, 12, 100, H - 16);
  ctx.fillStyle = "#222";
  ctx.fillRect(58, 20, 64, 3);
  ctx.fillStyle = "#777";
  const rnd = seeded(7);
  for (let i = 0; i < 18; i++) {
    const w = 60 + rnd() * 24;
    ctx.fillRect(46, 30 + i * 4, i % 6 === 5 ? w * 0.5 : w, 1.5);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  return tex;
}

// ---------------------------------------------------------------------------
// Scene assembly
// ---------------------------------------------------------------------------
export function createRoom(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // coarse pointer = phone/tablet: bigger tap targets, cheaper rendering, gyro parallax
  const touchDevice = (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || navigator.maxTouchPoints > 1;
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1530);
  scene.fog = new THREE.Fog(0x1a1530, 170, 260);

  const camera = new THREE.PerspectiveCamera(30, 1, 1, 400);
  const mat = voxelMaterial();

  const ROOM_W = 74;
  const ROOM_D = 50;
  const ROOM_H = 40;

  const hotspots = [];
  const animated = [];

  // ---- room shell ---------------------------------------------------------
  {
    const v = new Vox();
    // back wall (faces +z)
    v.box(-2, 0, -2, ROOM_W + 4, ROOM_H, 2, C.wall);
    // left wall (faces +x)
    v.box(-2, 0, -2, 2, ROOM_H, ROOM_D + 2, C.wall);
    // wall top trim
    v.box(-2, ROOM_H - 1, -2, ROOM_W + 4, 1, 2.2, C.wallDark);
    v.box(-2, ROOM_H - 1, -2, 2.2, 1, ROOM_D + 2, C.wallDark);
    // skirting board
    v.box(0, 0, 0, ROOM_W, 1.4, 0.5, C.skirting);
    v.box(0, 0, 0, 0.5, 1.4, ROOM_D, C.skirting);
    // floor planks
    const rnd = seeded(3);
    const plankW = 2;
    const plankL = 12;
    for (let x = -2; x < ROOM_W + 2; x += plankW) {
      let z = -2 - Math.floor(rnd() * 6);
      while (z < ROOM_D + 2) {
        const len = plankL - Math.floor(rnd() * 4);
        const r = rnd();
        v.box(x, -1, z, plankW - 0.08, 1, len - 0.1, r < 0.33 ? C.floorA : r < 0.66 ? C.floorB : C.floorC);
        z += len;
      }
    }
    // rug under the chair
    v.box(24, 0, 20, 30, 0.35, 26, C.rug);
    v.box(25, 0.02, 21, 28, 0.36, 24, C.rugDark);
    v.box(27, 0.04, 23, 24, 0.37, 20, C.rug);
    scene.add(v.build(mat, { shadow: false }));
  }

  // ---- desk (sit-stand) -----------------------------------------------------
  const DESK = { x: 12, z: 3, w: 48, d: 18, y: 14 };
  const DESK_LIFT = 6;
  const desk = new THREE.Group(); // everything on the desktop rides along when it lifts
  scene.add(desk);
  const deskState = { goal: 0, pos: 0, motor: null }; // 0 = sitting, 1 = standing
  let deskEase = 0; // eased 0..1, also nudges the camera up a touch
  {
    const { x, z, w, d, y } = DESK;
    // fixed: feet + outer leg columns
    const fixed = new Vox();
    for (const lx of [x + 5, x + w - 7]) {
      fixed.box(lx - 1.5, 0, z + 1.5, 5, 1, d - 3, C.white); // foot
      fixed.box(lx - 0.3, 1, z + 6.7, 2.6, 8.5, 3, C.white); // outer column
      fixed.box(lx - 0.1, 9.5, z + 6.9, 2.2, 0.3, 2.6, C.silverDark); // collar
    }
    scene.add(fixed.build(mat));
    // moving: top, rails, inner columns that telescope into the outer ones
    const v = new Vox();
    v.box(x, y - 1, z, w, 1, d, C.deskTop); // top
    v.box(x + 0.3, y - 0.98, z + 0.3, w - 0.6, 1, d - 0.6, C.deskTop2); // subtle inset panel
    v.box(x, y - 2, z + d - 1.2, w, 1, 1.2, C.white); // white front rail
    v.box(x, y - 2, z + 0.5, w, 1, 1.2, C.white); // back rail
    for (const lx of [x + 5, x + w - 7]) {
      v.box(lx, y - 22, z + 7, 2, 20, 2.4, C.white); // inner column (hidden inside the outer one / under the floor)
      v.box(lx - 0.5, y - 2, z + 1.5, 3, 0.8, d - 3, C.white); // top beam
    }
    // height controller mounted on the front rail at the right corner, buttons facing forward
    const px = x + w - 6.2;
    const pz = z + d; // front face of the rail
    v.box(px, y - 2.35, pz, 4.8, 1.5, 0.45, C.charcoal); // housing
    v.box(px + 0.2, y - 2.2, pz + 0.45, 4.4, 1.2, 0.05, C.dark); // face plate
    v.box(px + 0.55, y - 2.0, pz + 0.5, 1.1, 0.8, 0.3, C.offWhite); // up
    v.box(px + 0.85, y - 1.7, pz + 0.8, 0.5, 0.15, 0.05, C.charcoal); // arrow hint
    v.box(px + 2.0, y - 2.0, pz + 0.5, 1.1, 0.8, 0.3, C.offWhite); // down
    v.box(px + 2.3, y - 1.85, pz + 0.8, 0.5, 0.15, 0.05, C.charcoal);
    v.box(px + 3.6, y - 1.8, pz + 0.5, 0.5, 0.4, 0.12, C.green); // led
    desk.add(v.build(mat));
    const panel = new THREE.Group();
    panel.position.set(px + 2.4, y - 1.6, pz + 0.4);
    desk.add(panel);
    hotspots.push({
      obj: panel,
      name: "Stand up",
      label: () => (deskState.goal ? "Sit down" : "Stand up"),
      size: [6.5, 3, 3],
      offset: [0, 0, 0],
      lift: 0,
      wiggle: 0,
      action: () => toggleDesk(),
    });
  }
  function toggleDesk() {
    deskState.goal = deskState.goal ? 0 : 1;
    if (deskState.motor) deskState.motor.stop();
    deskState.motor = motor();
  }

  // ---- ultrawide monitor (curved, 5 segments) ----------------------------
  const monitor = new THREE.Group();
  const monScreen = makeMonitorScreen();
  {
    const v = new Vox();
    const cx = DESK.x + DESK.w / 2 + 4; // center x, nudged right so the laptop clears its left edge
    const segs = 5;
    const segW = 6;
    const sh = 12; // screen height
    const sy = DESK.y + 3; // bottom of screen
    const zc = 7.5; // z of the screen center line
    const radius = 70;
    const totalW = segs * segW;
    monitor.position.set(cx, sy, zc);

    // stand
    v.box(-1.2, -3, -4.5, 2.4, 3.2, 2.5, C.silver, null);
    v.box(-5.5, -3, -6.5, 11, 0.8, 6, C.silverDark);
    v.box(-4.5, -2.2, -5.5, 9, 0.3, 4, C.silver);

    // panel segments arranged on an arc
    const screenGeo = new THREE.PlaneGeometry(segW, sh);
    const screenMat = new THREE.MeshBasicMaterial({ map: monScreen.tex });
    for (let i = 0; i < segs; i++) {
      const u0 = i / segs;
      const u1 = (i + 1) / segs;
      const angle = ((i - (segs - 1) / 2) * segW) / radius; // radians along arc
      const px = Math.sin(angle) * radius;
      const pz = -(Math.cos(angle) * radius - radius); // curve toward viewer at the edges
      // bezel box (rotated about its own center)
      v.box(-segW / 2 - 0.05, -0.6, -0.9, segW + 0.1, sh + 1.2, 0.9, C.black, {
        rot: [0, -angle, 0],
        pivot: [0, 0, 0],
      });
      // we cheat: position the bezel via rot around origin, then translate — do it with a matrix instead
      v.items[v.items.length - 1].x += px;
      v.items[v.items.length - 1].z += pz;
      v.items[v.items.length - 1].opts.pivot = [px, 0, pz];
      const g = screenGeo.clone();
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, u0 + uv.getX(k) * (u1 - u0));
      const m = new THREE.Mesh(g, screenMat);
      m.position.set(px, sh / 2, pz + 0.02);
      m.rotation.y = -angle;
      monitor.add(m);
    }
    // LG-ish logo chip + webcams on top
    v.box(-1, -0.55, 0.02, 2, 0.5, 0.2, C.silverDark);
    v.box(-4.5, sh + 0.6, -1.4, 3, 1.6, 1.8, C.black);
    v.box(-4, sh + 0.9, 0.35, 2, 1, 0.3, C.charcoal);
    v.box(-3.4, sh + 1.1, 0.6, 0.8, 0.6, 0.2, C.blue);
    v.box(2.5, sh + 0.6, -1.2, 2.6, 1.4, 1.6, C.black);
    v.box(3, sh + 0.85, 0.35, 1.6, 0.9, 0.3, C.charcoal);
    // tiny figurine standing on the monitor edge (left)
    v.box(-13.5, sh + 0.6, -0.9, 0.8, 1.2, 0.8, C.blue);
    v.box(-13.5, sh + 1.8, -0.9, 0.8, 0.7, 0.8, C.skin);
    v.box(-13.6, sh + 2.4, -1.0, 1, 0.4, 1, C.black);

    monitor.add(v.build(mat));
    monitor.userData.totalW = totalW;
    desk.add(monitor);
    hotspots.push({ obj: monitor, name: "Lab", href: "/lab/", size: [32, 16, 8], offset: [0, 6, -2], lift: 0.6, wiggle: 0 });
  }

  // ---- MacBook -------------------------------------------------------------
  const laptop = new THREE.Group();
  {
    const v = new Vox();
    const w = 12;
    const d = 8;
    laptop.position.set(DESK.x + 0.4, DESK.y, DESK.z + 10);
    laptop.rotation.y = 0.36;
    v.box(0, 0, 0, w, 0.7, d, C.silver); // base
    v.box(0.2, 0.7, 0.4, w - 0.4, 0.05, d - 0.8, C.silverDark);
    v.box(1.2, 0.7, 0.8, w - 2.4, 0.15, 3.6, C.laptopKeys); // keyboard well
    // keys
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 12; c++) v.box(1.5 + c * 0.8, 0.82, 1 + r * 0.8, 0.6, 0.12, 0.6, C.dark);
    v.box(4, 0.7, 5, 4, 0.1, 2.4, C.silverDark); // trackpad
    // lid
    const lidH = 8;
    v.box(0, 0.7, 0, w, lidH, 0.5, C.silver, { rot: [-0.32, 0, 0], pivot: [0, 0.7, 0] });
    v.box(0.35, 1.0, 0.5, w - 0.7, lidH - 0.6, 0.12, C.black, { rot: [-0.32, 0, 0], pivot: [0, 0.7, 0] });
    laptop.add(v.build(mat));
    // screen plane
    const sc = new THREE.Mesh(
      new THREE.PlaneGeometry(w - 1.2, lidH - 1.2),
      new THREE.MeshBasicMaterial({ map: makeLaptopScreen() })
    );
    const lid = new THREE.Group();
    lid.position.set(0, 0.7, 0);
    lid.rotation.x = -0.32;
    sc.position.set(w / 2, lidH / 2 + 0.3, 0.64);
    lid.add(sc);
    laptop.add(lid);
    desk.add(laptop);
    hotspots.push({ obj: laptop, name: "Apps", href: "/app-store/", size: [13, 9, 9], offset: [6, 4, 4] });
  }

  // ---- keyboard (voxel keys) ---------------------------------------------
  const keyboard = { keys: [], mesh: null };
  {
    const v = new Vox();
    const kx = DESK.x + 15;
    const kz = DESK.z + 12.5;
    v.box(kx, DESK.y, kz, 14, 0.5, 4.4, C.white);
    v.box(kx, DESK.y + 0.5, kz, 14, 0.15, 0.6, C.offWhite); // rear ridge
    const base = v.items.length;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 15; c++) {
        const wide = r === 3 && c >= 5 && c <= 9;
        if (r === 3 && c > 5 && c <= 9) continue;
        v.box(kx + 0.35 + c * 0.9, DESK.y + 0.5, kz + 0.75 + r * 0.9, wide ? 4.4 : 0.75, 0.3, 0.75, C.offWhite);
      }
    }
    keyboard.mesh = v.build(mat);
    keyboard.keyStart = base;
    keyboard.keyCount = v.items.length - base;
    desk.add(keyboard.mesh);
  }

  // ---- desk clutter --------------------------------------------------------
  {
    const v = new Vox();
    const y = DESK.y;
    // vertical mouse (white)
    v.box(DESK.x + 33, y, DESK.z + 12.5, 2.6, 1, 4.2, C.white, { rot: [0, -0.25, 0] });
    v.box(DESK.x + 33.3, y + 1, DESK.z + 13, 2, 1.6, 3.4, C.offWhite, { rot: [0, -0.25, 0] });
    v.box(DESK.x + 33.6, y + 2.6, DESK.z + 13.3, 1.4, 0.8, 2.4, C.white, { rot: [0, -0.25, 0] });
    // power strip + adapters
    v.box(DESK.x + 26, y, DESK.z + 5, 9, 1.2, 2.6, C.white);
    for (let i = 0; i < 4; i++) v.box(DESK.x + 27 + i * 2, y + 1.2, DESK.z + 5.6, 1.2, 0.3, 1.4, C.silverDark);
    v.box(DESK.x + 28.5, y + 1.2, DESK.z + 5.4, 2, 1.6, 1.8, C.black); // wall plug
    v.box(DESK.x + 31, y + 1.2, DESK.z + 5.4, 1.8, 1, 1.6, C.dark);
    // grey retro controller (SN30-ish)
    {
      const gx = DESK.x + 36.8, gz = DESK.z + 15.2, gr = { rot: [0, -0.3, 0], pivot: [DESK.x + 36.8, y, DESK.z + 15.2] };
      v.box(gx, y, gz, 5.4, 1, 2.6, C.silverDark, gr);
      v.box(gx + 0.8, y + 1, gz + 0.7, 0.9, 0.3, 0.9, C.charcoal, gr);
      v.box(gx + 3.5, y + 1, gz + 0.4, 0.45, 0.35, 0.45, C.red, gr);
      v.box(gx + 4.2, y + 1, gz + 1, 0.45, 0.35, 0.45, C.blue, gr);
      v.box(gx + 3.5, y + 1, gz + 1.5, 0.45, 0.35, 0.45, C.green, gr);
      v.box(gx + 2.8, y + 1, gz + 1, 0.45, 0.35, 0.45, C.yellow, gr);
    }
    // cables snaking about
    const cab = [
      [DESK.x + 25, DESK.z + 7.6, 6, 0.35],
      [DESK.x + 31, DESK.z + 7.6, 0.35, 5],
      [DESK.x + 31, DESK.z + 12.6, 5, 0.35],
      [DESK.x + 36, DESK.z + 8, 0.35, 4.6],
      [DESK.x + 14, DESK.z + 6, 0.35, 6],
      [DESK.x + 14, DESK.z + 11.6, 4, 0.35],
      [DESK.x + 18, DESK.z + 7, 0.35, 5],
      [DESK.x + 36, DESK.z + 5.5, 0.35, 2.5],
    ];
    for (const [cx, cz, cw, cd] of cab) v.box(cx, y, cz, cw, 0.35, cd, C.black);
    v.box(DESK.x + 37, y, DESK.z + 3, 0.35, 0.35, 3, C.white);
    // dark tablet + phone on the right
    v.box(DESK.x + 37, y, DESK.z + 7, 6, 0.5, 4, C.black, { rot: [0, 0.12, 0] });
    v.box(DESK.x + 37.4, y + 0.5, DESK.z + 7.4, 5.2, 0.05, 3.2, C.charcoal, { rot: [0, 0.12, 0] });
    v.box(DESK.x + 43, y, DESK.z + 5.5, 2.4, 0.4, 4.6, C.dark, { rot: [0, -0.3, 0] });
    // small photo frame
    v.box(DESK.x + 41.5, y, DESK.z + 10.5, 3.4, 2.8, 0.4, C.black, { rot: [0, -0.35, 0] });
    v.box(DESK.x + 41.8, y + 0.3, DESK.z + 10.86, 2.8, 2.2, 0.08, C.white, { rot: [0, -0.35, 0], pivot: [DESK.x + 41.5, y, DESK.z + 10.5] });
    // notebook
    v.box(DESK.x + 4, y, DESK.z + 2, 5, 0.5, 4, C.blue, { rot: [0, -0.15, 0] });
    // LG desk mat / sticker
    v.box(DESK.x + 44, y - 0.99, DESK.z + 13.5, 3, 1.01, 1.5, C.deskTop2);
    desk.add(v.build(mat));

    // photo texture
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.8), new THREE.MeshLambertMaterial({ map: pixelTexture(PHOTO.rows, PHOTO.pal, PHOTO.bg) }));
    {
      const th = -0.35, lx = 1.7, lz = 0.47;
      photo.position.set(DESK.x + 41.5 + lx * Math.cos(th) + lz * Math.sin(th), y + 1.4, DESK.z + 10.5 - lx * Math.sin(th) + lz * Math.cos(th));
      photo.rotation.y = th;
    }
    desk.add(photo);
  }

  // ---- purple ball (voxel sphere) -------------------------------------------
  {
    const v = new Vox();
    v.sphere(0, 0, 0, 1.55, C.purple);
    // highlight voxels
    v.box(-1, 1, -1, 1, 1, 1, C.purpleLight);
    v.box(0, 1, -1, 1, 1, 1, C.purpleLight);
    const ball = new THREE.Group();
    ball.add(v.build(mat));
    ball.position.set(DESK.x + 17.5, DESK.y + 1.5, DESK.z + 8.5);
    desk.add(ball);
  }

  // ---- gamepad (black, hotspot: games) -------------------------------------
  const gamepad = new THREE.Group();
  {
    const v = new Vox();
    v.box(0, 0, 0, 6, 1.2, 2.6, C.black);
    v.box(-0.3, 0, 1.4, 1.8, 1.4, 2.4, C.black); // left grip
    v.box(4.5, 0, 1.4, 1.8, 1.4, 2.4, C.black); // right grip
    v.box(0.9, 1.2, 0.8, 0.7, 0.35, 0.7, C.charcoal); // dpad
    v.box(0.7, 1.2, 1.0, 1.1, 0.3, 0.3, C.charcoal);
    v.box(2.2, 1.2, 1.5, 0.5, 0.5, 0.5, C.dark); // sticks
    v.box(3.5, 1.2, 1.5, 0.5, 0.5, 0.5, C.dark);
    v.box(4.6, 1.2, 0.5, 0.4, 0.3, 0.4, C.yellow);
    v.box(5.1, 1.2, 0.9, 0.4, 0.3, 0.4, C.red);
    v.box(4.1, 1.2, 0.9, 0.4, 0.3, 0.4, C.blue);
    v.box(4.6, 1.2, 1.3, 0.4, 0.3, 0.4, C.green);
    gamepad.add(v.build(mat));
    gamepad.position.set(DESK.x + 20, DESK.y, DESK.z + 9.4);
    gamepad.rotation.y = 0.18;
    desk.add(gamepad);
    hotspots.push({ obj: gamepad, name: "Games", href: "/games/", size: [8, 3, 6], offset: [3, 1, 1.5] });
  }

  // ---- Rubik's cube (hotspot: bootcamp) ------------------------------------
  const cube = new THREE.Group();
  {
    const v = new Vox();
    const faceCols = [C.red, C.blue, C.yellow, C.green, C.orange, C.white];
    const rnd = seeded(11);
    v.box(0, 0, 0, 3, 3, 3, C.black);
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++) {
        const pick = () => faceCols[Math.floor(rnd() * faceCols.length)];
        v.box(a + 0.12, 3, b + 0.12, 0.76, 0.1, 0.76, pick()); // top
        v.box(a + 0.12, b + 0.12, 3, 0.76, 0.76, 0.1, pick()); // front (+z)
        v.box(3, a + 0.12, b + 0.12, 0.1, 0.76, 0.76, pick()); // right (+x)
        v.box(a + 0.12, b + 0.12, -0.1, 0.76, 0.76, 0.1, pick()); // back
        v.box(-0.1, a + 0.12, b + 0.12, 0.1, 0.76, 0.76, pick()); // left
      }
    cube.add(v.build(mat));
    cube.position.set(DESK.x + 39.5, DESK.y, DESK.z + 12);
    cube.rotation.y = 0.55;
    desk.add(cube);
    hotspots.push({ obj: cube, name: "Bootcamp", href: "/frontend-bootcamp/", size: [4.5, 4, 4.5], offset: [1.5, 1.5, 1.5] });
  }

  // ---- wall art -------------------------------------------------------------
  function poster(def, x, y, w, h, opts = {}) {
    const g = new THREE.Group();
    const v = new Vox();
    const fr = opts.frame || 0;
    if (fr) v.box(-fr, -fr, 0, w + fr * 2, h + fr * 2, 0.6, opts.frameColor || C.black);
    else {
      // paper backing + a strip of tape at the top
      v.box(0, 0, 0, w, h, 0.18, C.white);
      v.box(w * 0.42, h - 0.35, 0.18, w * 0.16, 0.7, 0.05, 0xd8d3c0);
    }
    g.add(v.build(mat));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: opts.texture || pixelTexture(def.rows, def.pal, def.bg) }));
    m.position.set(w / 2, h / 2, fr ? 0.61 : 0.19);
    g.add(m);
    g.userData.art = m;
    g.position.set(x, y, 0);
    if (opts.rot) g.rotation.y = opts.rot;
    scene.add(g);
    return g;
  }
  poster(NARUTO, 4, 18, 13, 9.5);
  const gokuTex = pixelTexture(GOKU.rows, GOKU.pal, GOKU.bg);
  const gokuSSJ = pixelTexture(GOKU_SSJ.rows, GOKU_SSJ.pal, GOKU_SSJ.bg);
  const goku = poster(GOKU, 25, 30.2, 5.4, 8.1, { frame: 0.45, texture: gokuTex });
  let tune = null; // handle from playTune while the theme is playing
  let tuneIdx = 0;
  function toggleTune() {
    if (tune && tune.playing) {
      tune.stop();
      tune = null;
      return;
    }
    tune = playTune(CHALA_TUNE, { onEnd: () => (tune = null) });
    tuneIdx = 0;
  }
  hotspots.push({
    obj: goku,
    name: "Play",
    label: () => (tune && tune.playing ? "Stop" : "Play"),
    size: [7, 10, 2],
    offset: [2.7, 4, 0.5],
    lift: 0.4,
    wiggle: 0,
    action: () => toggleTune(),
  });
  poster(WOLVERINE, 55.5, 28.5, 7, 9.3);
  poster(DEADPOOL_WOLV, 51, 18, 7, 9.3);
  poster(BATMAN, 59, 18, 7, 9.3);

  // sticky notes + tiny bits on the wall
  {
    const v = new Vox();
    const notes = [
      [35, 31.5, C.stickyYellow, 0.06],
      [38.4, 31.2, C.stickyYellow, -0.08],
      [40.6, 33.4, C.stickyBlue, 0.04],
      [46, 34.5, C.stickyPink, -0.05],
      [3.5, 32.5, C.stickyPink, 0.05],
      [36.2, 34.6, C.stickyYellow, -0.03],
    ];
    for (const [x, y, col, r] of notes) {
      v.box(x, y, 0, 2.6, 2.6, 0.12, col, { rot: [0, 0, r] });
      v.box(x + 0.5, y + 1.8, 0.12, 1.5, 0.15, 0.03, 0x555555, { rot: [0, 0, r], pivot: [x, y, 0] });
      v.box(x + 0.5, y + 1.2, 0.12, 1.2, 0.15, 0.03, 0x555555, { rot: [0, 0, r], pivot: [x, y, 0] });
      v.box(x + 0.5, y + 0.6, 0.12, 0.8, 0.15, 0.03, 0x555555, { rot: [0, 0, r], pivot: [x, y, 0] });
    }
    // small wooden bonsai/tree decoration on the far right wall
    v.box(69.5, 30, 0, 0.6, 5, 0.6, C.woodDark);
    v.box(68.1, 33.5, 0, 3.4, 0.5, 0.5, C.woodDark);
    v.box(67.7, 33.9, 0, 1.2, 1.2, 0.8, C.green);
    v.box(70.3, 34.1, 0, 1.2, 1.2, 0.8, C.green);
    v.box(69.1, 34.8, 0, 1.4, 1.2, 0.8, 0x2f9e5b);
    v.box(68.6, 33.4, 0.4, 0.5, 0.5, 0.5, C.pink);
    // switch plate
    v.box(64, 13, 0, 1.6, 2.4, 0.3, C.white);
    scene.add(v.build(mat));
  }

  // ---- window + curtains on the left wall ----------------------------------
  {
    const v = new Vox();
    const z0 = 16;
    const zw = 20;
    const y0 = 15;
    const yh = 17;
    v.box(0, y0, z0, 0.6, yh, zw, C.glass); // glass
    // mesh grid lines
    for (let i = 1; i < 6; i++) v.box(0.6, y0, z0 + (zw / 6) * i, 0.05, yh, 0.12, 0x4a5f7a);
    for (let i = 1; i < 5; i++) v.box(0.6, y0 + (yh / 5) * i, z0, 0.05, 0.12, zw, 0x4a5f7a);
    // frame
    v.box(0, y0 - 0.8, z0 - 0.8, 1.2, 0.8, zw + 1.6, C.white);
    v.box(0, y0 + yh, z0 - 0.8, 1.2, 0.8, zw + 1.6, C.white);
    v.box(0, y0, z0 - 0.8, 1.2, yh, 0.8, C.white);
    v.box(0, y0, z0 + zw, 1.2, yh, 0.8, C.white);
    v.box(0, y0, z0 + zw / 2 - 0.3, 1.0, yh, 0.6, C.white);
    v.box(0.6, y0 + 7, z0 + zw / 2 - 1.2, 0.5, 1.2, 2.4, C.silverDark); // latch
    // sill
    v.box(0, y0 - 1.4, z0 - 1.5, 2.2, 0.6, zw + 3, C.white);
    // curtain rod
    v.box(0.8, y0 + yh + 1.6, z0 - 4, 0.4, 0.4, zw + 8, C.silverDark);
    scene.add(v.build(mat));
    // curtains: stacks of vertical folds with a pixel pattern
    const curtainMat = (seed) => new THREE.MeshLambertMaterial({ map: curtainTexture(seed) });
    const makeCurtain = (zStart, zEnd, seed) => {
      const g = new THREE.Group();
      const rnd = seeded(seed);
      const width = zEnd - zStart;
      const folds = Math.round(width / 1.2);
      const mtl = curtainMat(seed);
      for (let i = 0; i < folds; i++) {
        const depth = 1.2 + rnd() * 1.4;
        const geo = new THREE.BoxGeometry(depth, yh + 5, width / folds + 0.05);
        const box = new THREE.Mesh(geo, mtl);
        box.castShadow = true;
        box.receiveShadow = true;
        box.position.set(1 + depth / 2, y0 - 2 + (yh + 5) / 2, zStart + (i + 0.5) * (width / folds));
        g.add(box);
      }
      scene.add(g);
    };
    makeCurtain(z0 - 3.5, z0 + 2.5, 21);
    makeCurtain(z0 + zw - 2.5, z0 + zw + 4, 42);
  }

  // ---- piano along the left wall ------------------------------------------
  const books = new THREE.Group();
  const robots = [];
  let pianoKeys = null; // InstancedMesh of keys, one instance per key
  let pianoKeyDefs = []; // { midi, baseY } per instance
  const keyByMidi = new Map();
  let robotClock = 0;
  {
    const v = new Vox();
    const z0 = 8;
    const len = 32;
    const x0 = 1.2;
    // cabinet
    v.box(x0, 0, z0, 6.3, 1, len, C.piano); // pedal board / bottom
    v.box(x0, 1, z0, 6.3, 11, 1.4, C.piano); // side panel (near wall side...)
    v.box(x0, 1, z0 + len - 1.4, 6.3, 11, 1.4, C.piano);
    v.box(x0, 1, z0, 1.2, 11, len, C.piano); // back panel
    v.box(x0, 12, z0, 6.3, 2, len, C.pianoTop); // keybed
    v.box(x0, 14, z0, 3.6, 3.2, len, C.pianoTop); // upper cabinet (behind keys)
    v.box(x0, 17.2, z0 - 0.3, 3.9, 0.6, len + 0.6, C.piano); // top lid
    v.box(x0 + 3.6, 14, z0, 0.4, 0.5, len, C.piano); // fallboard lip
    // keys: a separate instanced mesh so each key can be picked and pressed.
    // 33 white keys starting at C2, black keys after C D F G A.
    const white = 33;
    const kz0 = z0 + 1.2;
    const kw = (len - 2.4) / white;
    const kv = new Vox();
    const deg = [0, 2, 4, 5, 7, 9, 11];
    const whiteMidi = (i) => 36 + Math.floor(i / 7) * 12 + deg[i % 7];
    for (let i = 0; i < white; i++) {
      kv.box(x0 + 3.9, 14, kz0 + i * kw, 3.4, 0.7, kw - 0.08, C.key);
      pianoKeyDefs.push({ midi: whiteMidi(i), baseY: 14 });
    }
    const pattern = [1, 1, 0, 1, 1, 1, 0]; // black key after which white keys
    for (let i = 0; i < white - 1; i++) {
      if (!pattern[i % 7]) continue;
      kv.box(x0 + 3.9, 14.7, kz0 + (i + 1) * kw - kw * 0.3, 2.0, 0.55, kw * 0.6, C.keyBlack);
      pianoKeyDefs.push({ midi: whiteMidi(i) + 1, baseY: 14.7 });
    }
    pianoKeys = kv.build(mat);
    pianoKeyDefs.forEach((k, i) => keyByMidi.set(k.midi, i));
    scene.add(pianoKeys);
    // pedals
    v.box(x0 + 5.5, 1, z0 + len / 2 - 2, 1.4, 0.4, 1.2, C.brass);
    v.box(x0 + 5.5, 1, z0 + len / 2 + 0.8, 1.4, 0.4, 1.2, C.brass);
    // music sheets + a loose paper on the top lid
    v.box(x0 + 0.3, 17.8, z0 + 21, 3, 0.15, 4.5, C.white, { rot: [0, 0.12, 0] });
    v.box(x0 + 0.5, 17.95, z0 + 22, 2.5, 0.12, 3.2, C.offWhite);
    // blue toy car
    v.box(x0 + 0.5, 18.3, z0 + 1.5, 2.6, 1.2, 2.8, C.blue);
    v.box(x0 + 1, 19.5, z0 + 2.2, 1.6, 0.7, 1.6, 0x1f4fb8);
    for (const [dx, dz] of [[0.1, 0.1], [2.1, 0.1], [0.1, 2.1], [2.1, 2.1]]) v.box(x0 + 0.5 + dx, 17.8, z0 + 1.5 + dz, 0.6, 0.6, 0.6, C.black);
    // Rock'em Sock'em ring (base only; robots are animated separately)
    const rx = x0 + 0.2;
    const rz = z0 + 12;
    v.box(rx, 17.8, rz, 3.6, 0.7, 6, C.yellow);
    v.box(rx + 0.2, 18.5, rz + 0.2, 3.2, 0.25, 5.6, 0xe3b41c);
    for (const [px, pz, col] of [[0.1, 0.1, C.red], [3.1, 0.1, C.red], [0.1, 5.5, C.blue], [3.1, 5.5, C.blue]])
      v.box(rx + px, 18.5, rz + pz, 0.4, 2.2, 0.4, col);
    // ropes
    for (const ry of [19.4, 20.2]) {
      v.box(rx + 0.3, ry, rz + 0.25, 0.12, 0.12, 5.5, C.white);
      v.box(rx + 3.2, ry, rz + 0.25, 0.12, 0.12, 5.5, C.white);
      v.box(rx + 0.3, ry, rz + 0.25, 3, 0.12, 0.12, C.white);
      v.box(rx + 0.3, ry, rz + 5.5, 3, 0.12, 0.12, C.white);
    }
    scene.add(v.build(mat));

    // robots
    const makeRobot = (col, colDark, z, facing) => {
      const g = new THREE.Group();
      const b = new Vox();
      b.box(-0.6, 0, -0.5, 1.2, 0.9, 1, col); // legs block
      b.box(-0.7, 0.9, -0.55, 1.4, 1.2, 1.1, col); // torso
      b.box(-0.5, 2.1, -0.4, 1, 0.9, 0.8, colDark); // head
      b.box(-0.3, 2.35, 0.4 * facing - 0.05, 0.6, 0.25, 0.1, C.white); // visor
      g.add(b.build(mat));
      const arms = [];
      for (const side of [-1, 1]) {
        const a = new Vox();
        a.box(-0.22, 0, facing > 0 ? 0 : -1.1, 0.45, 0.45, 1.1, col);
        a.box(-0.3, -0.08, facing > 0 ? 1.1 : -1.65, 0.6, 0.6, 0.55, colDark);
        const am = a.build(mat);
        am.position.set(side * 0.95, 1.5, facing > 0 ? 0 : 0);
        g.add(am);
        arms.push(am);
      }
      g.position.set(rx + 1.8, 18.75, z);
      g.userData = { arms, facing, phase: Math.random() * 6 };
      scene.add(g);
      robots.push(g);
    };
    makeRobot(C.red, 0xa51d30, rz + 1.6, 1);
    makeRobot(C.blue, 0x1f4fb8, rz + 4.4, -1);

    // books (hotspot: blog)
    const bv = new Vox();
    const stack = [
      [4.2, 0.9, 5.2, 0x7a2330],
      [3.8, 0.7, 4.8, 0xe9e1cc],
      [4.4, 1.1, 5.4, 0x2d4f8a],
      [3.6, 0.6, 4.4, 0xd9a140],
      [4.0, 0.8, 5.0, 0xf1ece0],
    ];
    let by = 0;
    stack.forEach(([bw, bh, bd, col], i) => {
      const rot = ((i % 2) * 2 - 1) * 0.08 * (i + 1);
      bv.box(-bw / 2, by, -bd / 2, bw, bh, bd, col, { rot: [0, rot, 0], pivot: [0, by, 0] });
      // page edges
      bv.box(-bw / 2 + 0.15, by + 0.1, bd / 2 - 0.05, bw - 0.3, bh - 0.2, 0.1, C.offWhite, { rot: [0, rot, 0], pivot: [0, by, 0] });
      by += bh;
    });
    // a pen lying on top
    bv.box(-1.2, by, -0.2, 2.6, 0.3, 0.3, C.black, { rot: [0, 0.4, 0], pivot: [0, by, 0] });
    books.add(bv.build(mat));
    books.position.set(x0 + 2.1, 17.8, z0 + 9);
    scene.add(books);
    hotspots.push({ obj: books, name: "Blog", href: "/blog/", size: [6, 6, 7], offset: [0, 2.5, 0] });

    // bench in front of the piano
    const bench = new Vox();
    bench.box(7.8, 8, z0 + 10, 5, 1, 12, C.piano);
    bench.box(7.8, 7.5, z0 + 10.2, 5, 0.6, 11.6, 0x25262b);
    for (const [bx, bz] of [[8, z0 + 10.3], [12.2, z0 + 10.3], [8, z0 + 21], [12.2, z0 + 21]]) bench.box(bx, 0, bz, 0.7, 7.5, 0.7, C.piano);
    bench.box(8.6, 9, z0 + 14, 3.6, 0.4, 4.6, C.blue, { rot: [0, -0.1, 0] }); // blue notebook
    scene.add(bench.build(mat));
  }

  // ---- drawer chest on the right ------------------------------------------
  {
    const v = new Vox();
    const x0 = 66;
    const w = 8;
    const d = 7;
    const h = 24;
    v.box(x0, 0, 0, w, h, d, C.wood);
    v.box(x0 - 0.2, h, -0.2, w + 0.4, 0.6, d + 0.4, C.woodLight); // top
    v.box(x0 + 0.2, 0.2, d, w - 0.4, h - 0.6, 0.15, C.woodDark); // front recess
    const drawers = 6;
    const dh = (h - 1.2) / drawers;
    for (let i = 0; i < drawers; i++) {
      const y = 0.6 + i * dh;
      v.box(x0 + 0.4, y + 0.15, d + 0.15, w - 0.8, dh - 0.3, 0.25, i % 2 ? C.woodLight : 0x654226);
      v.box(x0 + w / 2 - 0.8, y + dh / 2 - 0.15, d + 0.4, 1.6, 0.3, 0.3, C.brass);
    }
    // stickers on the front
    v.box(x0 + 1, 10.5, d + 0.4, 0.8, 0.8, 0.05, C.red);
    v.box(x0 + 6, 16.5, d + 0.4, 0.8, 0.8, 0.05, C.silver);
    v.box(x0 + 1.2, 19.4, d + 0.4, 0.7, 0.7, 0.05, C.black);
    // top: Eiffel tower (grey, stepped)
    const ex = x0 + 1.4;
    const ez = 3.8;
    v.box(ex, h + 0.6, ez, 2.2, 0.3, 2.2, 0x8a8f96);
    v.box(ex + 0.2, h + 0.9, ez + 0.2, 1.8, 1.6, 1.8, 0x9a9fa6);
    v.box(ex + 0.45, h + 2.5, ez + 0.45, 1.3, 1.6, 1.3, 0x8a8f96);
    v.box(ex + 0.7, h + 4.1, ez + 0.7, 0.8, 1.8, 0.8, 0x9a9fa6);
    v.box(ex + 0.9, h + 5.9, ez + 0.9, 0.4, 1.4, 0.4, 0x8a8f96);
    // pink pen cup with pens
    v.box(x0 + 4.2, h + 0.6, 1, 1.6, 1.6, 1.6, C.pink);
    v.box(x0 + 4.5, h + 2.2, 1.3, 0.25, 1.6, 0.25, C.blue);
    v.box(x0 + 5, h + 2.2, 1.6, 0.25, 1.9, 0.25, C.black);
    v.box(x0 + 5.3, h + 2.2, 1.2, 0.25, 1.3, 0.25, C.red);
    // spray bottle + jar
    v.box(x0 + 6.4, h + 0.6, 4.5, 1, 2.6, 1, C.white);
    v.box(x0 + 6.6, h + 3.2, 4.7, 0.6, 0.6, 0.6, C.silverDark);
    v.box(x0 + 4.6, h + 0.6, 4.6, 1.2, 1.4, 1.2, C.green);
    // Vegeta-ish figure: blue gi, yellow hair, white boots
    const fx = x0 + 6.2;
    const fz = 1.2;
    v.box(fx, h + 0.6, fz, 0.6, 0.4, 0.8, C.white);
    v.box(fx + 0.8, h + 0.6, fz, 0.6, 0.4, 0.8, C.white);
    v.box(fx, h + 1, fz, 0.6, 1.8, 0.7, C.blue);
    v.box(fx + 0.8, h + 1, fz, 0.6, 1.8, 0.7, C.blue);
    v.box(fx - 0.1, h + 2.8, fz - 0.05, 1.6, 1.9, 0.8, C.blue);
    v.box(fx - 0.6, h + 3.6, fz, 0.5, 0.5, 0.5, C.skin);
    v.box(fx + 1.5, h + 3.6, fz, 0.5, 0.5, 0.5, C.skin);
    v.box(fx - 0.55, h + 3.9, fz + 0.05, 0.45, 0.9, 0.45, C.blue);
    v.box(fx + 1.5, h + 3.9, fz + 0.05, 0.45, 0.9, 0.45, C.blue);
    v.box(fx + 0.15, h + 4.7, fz, 1.1, 0.9, 0.7, C.skin);
    v.box(fx + 0.05, h + 5.6, fz - 0.1, 1.3, 0.9, 0.9, C.hair);
    v.box(fx + 0.3, h + 6.5, fz - 0.05, 0.4, 1.2, 0.4, C.hair);
    v.box(fx + 0.8, h + 6.5, fz + 0.1, 0.4, 0.9, 0.4, C.hair);
    v.box(fx - 0.2, h + 6.3, fz + 0.1, 0.4, 0.7, 0.4, C.hair);
    scene.add(v.build(mat));
    // Joker poster leaning against the wall on top of the chest
    poster(JOKER, x0 + 0.6, h + 0.7, 4.6, 5.6, { rot: 0 });
  }

  // ---- chair ------------------------------------------------------------------
  {
    const v = new Vox();
    const cx = 0;
    const cz = 0;
    v.box(cx - 5, 7.5, cz - 5, 10, 1.6, 10, C.dark); // seat
    v.box(cx - 4.5, 9.1, cz - 4.5, 9, 0.4, 9, C.charcoal);
    v.box(cx - 5, 9, cz - 6.2, 10, 12, 1.6, C.dark); // back
    v.box(cx - 4.4, 9.6, cz - 6.0, 8.8, 10.5, 0.4, C.charcoal);
    v.box(cx - 6.5, 12, cz - 3, 1.2, 0.8, 6, C.dark); // arms
    v.box(cx + 5.3, 12, cz - 3, 1.2, 0.8, 6, C.dark);
    v.box(cx - 6.5, 8, cz - 0.5, 1.2, 4, 1.2, C.dark);
    v.box(cx + 5.3, 8, cz - 0.5, 1.2, 4, 1.2, C.dark);
    v.box(cx - 0.8, 1, cz - 0.8, 1.6, 6.5, 1.6, C.silverDark); // gas lift
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      v.box(cx - 0.5, 0.5, cz - 0.5, 1, 0.8, 6.5, C.dark, { rot: [0, a, 0], pivot: [cx, 0.5, cz] });
      v.box(cx - 0.6, 0, cz + 5.5, 1.2, 1, 1.2, C.black, { rot: [0, a, 0], pivot: [cx, 0.5, cz] });
    }
    const chair = v.build(mat);
    chair.position.set(27, 0, 33);
    chair.rotation.y = 0.95;
    scene.add(chair);
    hotspots.push({ obj: chair, name: "About", href: "/about/", size: [14, 22, 12], offset: [0, 11, -0.5], lift: 0.8, wiggle: 0.1 });
  }

  // ---- cloud lamp floating near the ceiling on the left --------------------
  // Clicking it flips the room between day and night.
  const cloud = new THREE.Group();
  const cloudInner = new THREE.Group(); // bobs; the outer group is what hover/lift moves
  const cloudMat = voxelMaterial();
  let cloudLight;
  {
    const v = new Vox();
    v.box(0, 0, 0, 8, 2, 3, C.cloud);
    v.box(1, 2, 0.3, 3, 1.6, 2.4, C.cloud);
    v.box(4, 1.6, 0.4, 3.2, 2.2, 2.2, C.cloud);
    v.box(-0.8, 0.5, 0.5, 1.2, 1.2, 2, C.cloud);
    v.box(7.5, 0.4, 0.5, 1.2, 1.4, 2, C.cloud);
    v.box(3.5, -0.4, 0.8, 1.8, 0.5, 1.4, 0xe6e2d8);
    v.box(0.5, -0.6, 0.9, 1.6, 0.7, 1.2, 0xe6e2d8);
    cloudInner.add(v.build(cloudMat));
    cloudLight = new THREE.PointLight(0xfff0c0, 60, 30, 2);
    cloudLight.position.set(4, -1, 1.5);
    cloudInner.add(cloudLight);
    cloud.add(cloudInner);
    cloud.position.set(3, 27.5, 5);
    cloud.rotation.y = Math.PI / 2;
    scene.add(cloud);
    hotspots.push({
      obj: cloud,
      name: "Lights",
      size: [11, 6, 5],
      offset: [3.5, 1.4, 1.5],
      lift: 0.5,
      wiggle: 0,
      action: () => toggleLights(),
    });
  }

  // ---- lights ----------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xfff3d6, 0x5a4a44, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe9c4, 1.7);
  sun.position.set(64, 60, 52);
  sun.target.position.set(34, 10, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(touchDevice ? 1024 : 2048, touchDevice ? 1024 : 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 220;
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -50;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xc6d8ff, 0.35);
  fill.position.set(-30, 40, 70);
  scene.add(fill);
  // monitor glow
  const screenLight = new THREE.PointLight(0x4a55ff, 220, 40, 2);
  screenLight.position.set(DESK.x + DESK.w / 2 + 4, DESK.y + 9, DESK.z + 12);
  desk.add(screenLight);
  // laptop screen spill (only noticeable at night)
  const laptopLight = new THREE.PointLight(0xdfe6ff, 0, 18, 2);
  laptopLight.position.set(DESK.x + 7, DESK.y + 5, DESK.z + 15);
  desk.add(laptopLight);

  // ---- day / night themes -----------------------------------------------------
  // Follows the OS colour scheme: light = the sunlit room, dark = lights off,
  // lit only by the monitor, the laptop and the cloud lamp.
  const THEMES = {
    light: {
      bg: new THREE.Color(0x1a1530),
      hemiSky: new THREE.Color(0xfff3d6),
      hemiGround: new THREE.Color(0x5a4a44),
      hemi: 0.75,
      sunColor: new THREE.Color(0xffe9c4),
      sun: 1.7,
      sunPos: new THREE.Vector3(64, 60, 52),
      fill: 0.35,
      screen: 200,
      screenDist: 40,
      cloud: 60,
      laptop: 0,
    },
    dark: {
      bg: new THREE.Color(0x0a0816),
      hemiSky: new THREE.Color(0x4a5aa0),
      hemiGround: new THREE.Color(0x1a1526),
      hemi: 0.5,
      sunColor: new THREE.Color(0x9fb2ff),
      sun: 0.35,
      sunPos: new THREE.Vector3(-30, 60, 70),
      fill: 0.12,
      screen: 720,
      screenDist: 70,
      cloud: 260,
      laptop: touchDevice ? 0 : 45, // one point light fewer on phones
    },
  };
  const theme = { mode: "auto", goal: 0, mix: -1 };
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function resolveTheme() {
    theme.goal = theme.mode === "auto" ? (mq && mq.matches ? 1 : 0) : theme.mode === "dark" ? 1 : 0;
  }
  if (mq) (mq.addEventListener || mq.addListener).call(mq, "change", resolveTheme);
  resolveTheme();
  const _c1 = new THREE.Color();
  const _v1 = new THREE.Vector3();
  function applyTheme(m) {
    const a = THEMES.light;
    const b = THEMES.dark;
    const L = (x, y) => x + (y - x) * m;
    scene.background.lerpColors(a.bg, b.bg, m);
    scene.fog.color.copy(scene.background);
    hemi.color.lerpColors(a.hemiSky, b.hemiSky, m);
    hemi.groundColor.lerpColors(a.hemiGround, b.hemiGround, m);
    hemi.intensity = L(a.hemi, b.hemi);
    sun.color.lerpColors(a.sunColor, b.sunColor, m);
    sun.intensity = L(a.sun, b.sun);
    sun.position.copy(_v1.lerpVectors(a.sunPos, b.sunPos, m));
    fill.intensity = L(a.fill, b.fill);
    screenLight.distance = L(a.screenDist, b.screenDist);
    cloudLight.intensity = L(a.cloud, b.cloud);
    laptopLight.intensity = L(a.laptop, b.laptop);
    theme.screenBase = L(a.screen, b.screen);
    cloudMat.emissive.setHex(0xffd9a0).multiplyScalar(0.9 * m);
    document.documentElement.style.setProperty("--room-night", m.toFixed(3));
    const attr = m > 0.5 ? "dark" : "light";
    if (document.documentElement.dataset.roomTheme !== attr) document.documentElement.dataset.roomTheme = attr;
  }
  function toggleLights() {
    theme.mode = theme.goal > 0.5 ? "light" : "dark";
    resolveTheme();
    blip(theme.goal > 0.5 ? 440 : 720);
  }

  // ---- hotspot proxies -----------------------------------------------------
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const proxies = [];
  for (const h of hotspots) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(...h.size), proxyMat);
    p.position.set(...h.offset);
    if (touchDevice) p.scale.setScalar(1.4); // fingers are wider than cursors
    p.userData.hot = h;
    h.obj.add(p);
    h.proxy = p;
    h.base = h.obj.position.clone();
    h.baseRot = h.obj.rotation.y;
    h.hover = 0;
    proxies.push(p);
  }

  // ---- camera ----------------------------------------------------------------
  const target = new THREE.Vector3(36, 16, 13);
  const camState = {
    yaw: 0.62, // radians around target
    pitch: 0.42,
    dist: 100,
    yawGoal: 0.62,
    pitchGoal: 0.42,
    distGoal: 100,
    intro: 0,
    zoom: 1, // pinch / wheel zoom, multiplies the distance
    zoomGoal: 1,
  };
  const pointer = { x: 0, y: 0, active: false, down: false, dragged: false, lx: 0, ly: 0, sx: 0, sy: 0, id: -1, type: "mouse" };
  // swipe / drag orbit with momentum
  const dragOffset = { yaw: 0, pitch: 0, yawVel: 0, lastMoveT: 0 };
  const YAW_RANGE = touchDevice ? 1.1 : 0.8;
  // gyroscope parallax (phones), calibrated to however the phone is first held
  const gyro = { yaw: 0, pitch: 0, base: null, on: false };
  const lookAt = new THREE.Vector3();

  /** Framing per aspect: phones in portrait zoom in on the desk instead of the whole room. */
  const FRAME_WIDE = { hfov: 47, dist: 96, pitch: 0.42, targetY: 0 }; // whole room
  const FRAME_TALL = { hfov: 52, dist: 57, pitch: 0.45, targetY: -24 }; // portrait phone: desk fills the width
  const frameOut = { hfov: 0, dist: 0, pitch: 0, targetY: 0 };
  function framing(aspect) {
    if (camState.frame) return camState.frame; // runtime override for tuning
    // blend smoothly between the two so odd window shapes get something sensible
    const k = THREE.MathUtils.smoothstep(aspect, 0.62, 1.3);
    for (const key in frameOut) frameOut[key] = FRAME_TALL[key] + (FRAME_WIDE[key] - FRAME_TALL[key]) * k;
    // the downward look-at shift is only needed on really tall screens; fade it out faster
    frameOut.targetY = FRAME_TALL.targetY * Math.pow(1 - k, 2);
    frameOut.dist += k * (1 - k) * 30; // tablets sit a bit further back than the straight blend
    return frameOut;
  }

  function applyCamera(t, dt) {
    // horizontal fov kept constant so the desk always fits the width
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const fr = framing(aspect);
    const hfov = THREE.MathUtils.degToRad(fr.hfov);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / aspect));
    camera.aspect = aspect;

    // swipe momentum
    if (!pointer.down && Math.abs(dragOffset.yawVel) > 0.0005) {
      dragOffset.yaw += dragOffset.yawVel * dt;
      dragOffset.yawVel *= Math.pow(0.03, dt);
      if (Math.abs(dragOffset.yaw) >= YAW_RANGE) {
        dragOffset.yaw = THREE.MathUtils.clamp(dragOffset.yaw, -YAW_RANGE, YAW_RANGE);
        dragOffset.yawVel = 0;
      }
    }

    const idleYaw = Math.sin(t * 0.25) * 0.03;
    const idlePitch = Math.cos(t * 0.19) * 0.015;
    const px = pointer.active ? pointer.x : 0;
    const py = pointer.active ? pointer.y : 0;
    camState.yawGoal = 0.62 + px * 0.12 + dragOffset.yaw + idleYaw + gyro.yaw;
    camState.pitchGoal = THREE.MathUtils.clamp(fr.pitch - py * 0.07 + dragOffset.pitch + idlePitch + gyro.pitch, 0.12, 0.85);
    // intro dolly
    const introT = THREE.MathUtils.clamp(camState.intro, 0, 1);
    const ease = 1 - Math.pow(1 - introT, 3);
    camState.zoom += (camState.zoomGoal - camState.zoom) * 0.12;
    camState.distGoal = fr.dist * camState.zoom + (1 - ease) * 22;
    const yawStart = camState.yawGoal + (1 - ease) * 0.35;
    const pitchStart = camState.pitchGoal + (1 - ease) * 0.25;

    camState.yaw += (yawStart - camState.yaw) * 0.06;
    camState.pitch += (pitchStart - camState.pitch) * 0.06;
    camState.dist += (camState.distGoal - camState.dist) * 0.06;

    const cy = Math.sin(camState.pitch) * camState.dist;
    const r = Math.cos(camState.pitch) * camState.dist;
    camera.position.set(target.x + Math.sin(camState.yaw) * r, target.y + cy, target.z + Math.cos(camState.yaw) * r);
    lookAt.set(target.x, target.y + fr.targetY + deskEase * 2.2, target.z);
    camera.lookAt(lookAt);
    camera.updateProjectionMatrix();
  }

  // gyroscope: needs a permission prompt on iOS, so it is armed from the first tap
  function onOrientation(e) {
    if (e.beta == null || e.gamma == null) return;
    const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    // portrait: gamma = left/right tilt, beta = front/back. landscape swaps them.
    let lr = e.gamma;
    let fb = e.beta;
    if (angle === 90) {
      lr = e.beta;
      fb = -e.gamma;
    } else if (angle === -90 || angle === 270) {
      lr = -e.beta;
      fb = e.gamma;
    }
    if (!gyro.base) gyro.base = { lr, fb, n: 0 };
    // settle the baseline over the first few readings
    if (gyro.base.n < 12) {
      gyro.base.lr += (lr - gyro.base.lr) * 0.3;
      gyro.base.fb += (fb - gyro.base.fb) * 0.3;
      gyro.base.n++;
    }
    const ty = THREE.MathUtils.clamp((lr - gyro.base.lr) * 0.008, -0.18, 0.18);
    const tp = THREE.MathUtils.clamp((fb - gyro.base.fb) * 0.005, -0.1, 0.1);
    gyro.yaw += (ty - gyro.yaw) * 0.15;
    gyro.pitch += (tp - gyro.pitch) * 0.15;
  }
  function armGyro() {
    if (gyro.on || reduced || !touchDevice || !window.DeviceOrientationEvent) return;
    gyro.on = true;
    const start = () => window.addEventListener("deviceorientation", onOrientation);
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      DeviceOrientationEvent.requestPermission()
        .then((r) => r === "granted" && start())
        .catch(() => {});
    } else start();
  }

  // ---- input ------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered = null;
  let linkHover = null;
  const listeners = { hover: [] };

  const pickTargets = pianoKeys ? [...proxies, pianoKeys] : proxies;
  const NOPICK = { hot: null, key: -1 };
  function pick() {
    if (!pointer.active) return NOPICK;
    ndc.set(pointer.x, -pointer.y);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(pickTargets, false)[0];
    if (!hit) return NOPICK;
    if (hit.object === pianoKeys) return { hot: null, key: hit.instanceId ?? -1 };
    return { hot: hit.object.userData.hot, key: -1 };
  }
  const pressedKeys = new Map(); // piano key instance -> press time
  function pressPianoKey(i) {
    pressedKeys.set(i, elapsed);
  }

  // tap flash: on touch there is no hover, so a tap shows the label for a moment
  let flashHot = null;
  let flashUntil = 0;
  const touches = new Map(); // active touch pointers for pinch
  let pinch = null; // { dist, zoom }

  function setPointerNdc(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
  }

  canvas.addEventListener("pointermove", (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size >= 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 0) camState.zoomGoal = THREE.MathUtils.clamp(pinch.zoom * (pinch.dist / d), 0.55, 1.5);
      pointer.dragged = true;
      return;
    }
    if (pointer.down && e.pointerId !== pointer.id) return;
    setPointerNdc(e);
    pointer.active = e.pointerType !== "touch";
    if (pointer.down) {
      const dx = e.clientX - pointer.lx;
      const dy = e.clientY - pointer.ly;
      pointer.lx = e.clientX;
      pointer.ly = e.clientY;
      const threshold = e.pointerType === "touch" ? 8 : 3;
      if (Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy) > threshold) pointer.dragged = true;
      // a full-width swipe turns the camera about 2 radians
      const k = 2.2 / Math.max(1, canvas.clientWidth);
      const now = performance.now();
      const ddt = Math.max(0.004, (now - dragOffset.lastMoveT) / 1000);
      dragOffset.lastMoveT = now;
      dragOffset.yaw = THREE.MathUtils.clamp(dragOffset.yaw + dx * k, -YAW_RANGE, YAW_RANGE);
      dragOffset.yawVel = THREE.MathUtils.clamp((dx * k) / ddt, -6, 6);
      dragOffset.pitch = THREE.MathUtils.clamp(dragOffset.pitch - dy * 0.003, -0.2, 0.25);
    }
  });
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        const [a, b] = [...touches.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: camState.zoomGoal };
        pointer.dragged = true;
        return;
      }
    }
    pointer.down = true;
    pointer.dragged = false;
    pointer.id = e.pointerId;
    pointer.type = e.pointerType;
    pointer.lx = pointer.sx = e.clientX;
    pointer.ly = pointer.sy = e.clientY;
    dragOffset.yawVel = 0;
    dragOffset.lastMoveT = performance.now();
    if (e.pointerType === "touch") setPointerNdc(e);
    canvas.setPointerCapture(e.pointerId);
  });
  function endPointer(e) {
    touches.delete(e.pointerId);
    if (pinch && touches.size < 2) pinch = null;
    if (e.pointerId !== pointer.id) return;
    pointer.down = false;
    // momentum only survives a real flick, not a slow drag that stopped
    if (performance.now() - dragOffset.lastMoveT > 80) dragOffset.yawVel = 0;
  }
  canvas.addEventListener("pointerup", (e) => {
    const wasDrag = pointer.dragged;
    const isMine = e.pointerId === pointer.id;
    endPointer(e);
    if (!isMine || wasDrag) return;
    // tap / click
    const wasActive = pointer.active;
    pointer.active = true;
    const { hot, key } = pick();
    pointer.active = wasActive;
    if (e.pointerType === "touch") armGyro();
    if (key >= 0) {
      pianoNote(pianoKeyDefs[key].midi, { vel: 0.45 });
      pressPianoKey(key);
    } else if (hot) {
      if (e.pointerType === "touch") {
        flashHot = hot;
        flashUntil = elapsed + 0.9;
        if (hot.action) hot.action();
        else setTimeout(() => (window.location.href = hot.href), 260);
      } else if (hot.action) hot.action();
      else window.location.href = hot.href;
    }
  });
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", (e) => {
    pointer.active = false;
    if (e.pointerType !== "touch") endPointer(e);
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      camState.zoomGoal = THREE.MathUtils.clamp(camState.zoomGoal * (1 + e.deltaY * 0.0012), 0.55, 1.5);
    },
    { passive: false }
  );

  // ---- resize ----------------------------------------------------------------
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    // pixel size ~3 css px on desktop, ~2.5 on small screens
    const P = w > 1700 ? 3.5 : w > 900 ? 3 : w > 500 ? 2.5 : 2;
    renderer.setSize(Math.round(w / P), Math.round(h / P), false);
  }
  window.addEventListener("resize", resize);
  resize();

  // ---- animation loop --------------------------------------------------------
  const clock = new THREE.Clock();
  let elapsed = 0;
  let introStart = -1;
  const tip = { el: null, target: null };
  const _v = new THREE.Vector3();
  let lastScreenDraw = -1;
  const keyMat = new THREE.Matrix4();
  const pressed = new Map();
  let running = true;
  let frame = 0;
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    tick(Math.min(0.05, clock.getDelta() || 0.016));
  }
  /** One simulation + render step. Exposed as room.step() for testing. */
  function tick(dt) {
    elapsed += dt;
    const t = elapsed;
    frame++;
    if (introStart < 0) introStart = performance.now();
    camState.intro = (performance.now() - introStart) / 2200;
    applyCamera(reduced ? 1000 : t, dt);

    // ease between day and night when the OS theme flips
    if (theme.mix < 0) {
      theme.mix = theme.goal;
      applyTheme(theme.mix);
    } else if (Math.abs(theme.goal - theme.mix) > 0.001) {
      theme.mix += (theme.goal - theme.mix) * Math.min(1, dt * 2.5);
      if (Math.abs(theme.goal - theme.mix) < 0.001) theme.mix = theme.goal;
      applyTheme(theme.mix);
    }

    // screen typing (redraw at ~12fps, 8 on phones)
    let typing = false;
    if (t - lastScreenDraw > (touchDevice ? 1 / 8 : 1 / 12)) {
      lastScreenDraw = t;
      typing = monScreen.update(t);
      const sb = theme.screenBase;
      screenLight.intensity = sb + Math.sin(t * 9) * sb * 0.06 + (typing ? sb * 0.12 : 0);
    } else {
      typing = monScreen.typing;
    }

    const jamming = !!(tune && tune.playing);

    // keyboard presses while the terminal types
    if (!reduced) {
      if (typing && frame % 5 === 0) {
        const i = keyboard.keyStart + Math.floor(Math.random() * keyboard.keyCount);
        pressed.set(i, t);
      }
      let dirty = false;
      for (const [i, t0] of pressed) {
        const age = t - t0;
        const depth = age < 0.08 ? 0.2 : age < 0.18 ? 0.2 * (1 - (age - 0.08) / 0.1) : 0;
        keyboard.mesh.getMatrixAt(i, keyMat);
        const el = keyMat.elements;
        const baseY = DESK.y + 0.5;
        el[13] = baseY - depth;
        keyboard.mesh.setMatrixAt(i, keyMat);
        dirty = true;
        if (age > 0.2) pressed.delete(i);
      }
      if (dirty) keyboard.mesh.instanceMatrix.needsUpdate = true;

      // robots punching (twice as fast while the music plays)
      robotClock += dt * (jamming ? 2 : 1);
      for (const r of robots) {
        const { arms, phase, facing } = r.userData;
        const p = robotClock * 3.2 + phase;
        arms[0].position.z = Math.max(0, Math.sin(p)) * 0.9 * facing;
        arms[1].position.z = Math.max(0, Math.sin(p + Math.PI)) * 0.9 * facing;
        r.position.y = 18.75 + Math.abs(Math.sin(p * 0.5)) * 0.12;
        r.rotation.z = Math.sin(p * 0.5) * 0.05;
      }
      // cloud bob
      cloudInner.position.y = Math.sin(t * 0.9) * 0.45;
      cloudInner.position.x = Math.cos(t * 0.5) * 0.3;
    }

    // piano keys: pressed by clicks or by the tune
    if (jamming) {
      const ac = audio();
      const now = ac ? ac.currentTime : 0;
      while (tuneIdx < tune.events.length && tune.events[tuneIdx].time <= now + 0.015) {
        const ki = keyByMidi.get(tune.events[tuneIdx++].midi);
        if (ki != null) pressedKeys.set(ki, t);
      }
    }
    if (pianoKeys && pressedKeys.size) {
      for (const [i, t0] of pressedKeys) {
        const age = t - t0;
        const k = pianoKeyDefs[i];
        const depth = age < 0.06 ? 0.3 : age < 0.3 ? 0.3 * (1 - (age - 0.06) / 0.24) : 0;
        pianoKeys.getMatrixAt(i, keyMat);
        keyMat.elements[13] = k.baseY - depth;
        pianoKeys.setMatrixAt(i, keyMat);
        if (age > 0.32) pressedKeys.delete(i);
      }
      pianoKeys.instanceMatrix.needsUpdate = true;
    }
    // Goku goes Super Saiyan while the music plays
    const art = goku.userData.art;
    const wantTex = jamming ? gokuSSJ : gokuTex;
    if (art.material.map !== wantTex) {
      art.material.map = wantTex;
      art.material.needsUpdate = true;
    }
    goku.position.z = jamming ? 0.2 + Math.sin(t * 11) * 0.12 : 0;

    // sit-stand desk
    if (deskState.pos !== deskState.goal) {
      const dir = Math.sign(deskState.goal - deskState.pos);
      deskState.pos = THREE.MathUtils.clamp(deskState.pos + dir * dt * 0.55, 0, 1);
      const q = deskState.pos;
      const e = q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2;
      deskEase = e;
      desk.position.y = e * DESK_LIFT;
      if (deskState.pos === deskState.goal && deskState.motor) {
        deskState.motor.stop();
        deskState.motor = null;
      }
    }

    // hotspot / piano key hover
    const { hot: h, key: hoverKey } = pick();
    if (flashHot && elapsed > flashUntil) flashHot = null;
    const active = h || linkHover || flashHot;
    if (hovered !== active) {
      hovered = active;
      listeners.hover.forEach((fn) => fn(hovered));
    }
    canvas.style.cursor = h || hoverKey >= 0 ? "pointer" : pointer.down ? "grabbing" : "grab";
    for (const hs of hotspots) {
      const goal = hs === hovered ? 1 : 0;
      hs.hover += (goal - hs.hover) * 0.15;
      const lift = hs.lift ?? 1.2;
      const wiggle = hs.wiggle ?? 0.08;
      hs.obj.position.y = hs.base.y + hs.hover * lift + (lift > 0 && hs.hover > 0.01 ? Math.sin(t * 6) * 0.15 * hs.hover : 0);
      hs.obj.rotation.y = hs.baseRot + (wiggle ? Math.sin(t * 2.5) * wiggle * hs.hover : 0);
    }
    if (tip.el) {
      let label = null;
      if (hovered) {
        _v.set(...hovered.offset).applyMatrix4(hovered.obj.matrixWorld);
        _v.y += hovered.size[1] / 2 + 1.5;
        label = hovered.label ? hovered.label() : hovered.name;
      } else if (hoverKey >= 0) {
        pianoKeys.getMatrixAt(hoverKey, keyMat);
        _v.setFromMatrixPosition(keyMat);
        _v.x += 1.7;
        _v.y += 2.2;
        _v.z += 0.4;
        _v.applyMatrix4(pianoKeys.matrixWorld);
        label = midiName(pianoKeyDefs[hoverKey].midi);
      }
      if (label) {
        _v.project(camera);
        const x = (_v.x * 0.5 + 0.5) * canvas.clientWidth;
        const y = (-_v.y * 0.5 + 0.5) * canvas.clientHeight;
        tip.el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
        tip.el.textContent = label;
        tip.el.classList.add("is-visible");
      } else {
        tip.el.classList.remove("is-visible");
      }
    }

    renderer.render(scene, camera);
  }
  document.addEventListener("visibilitychange", () => {
    // if the page was opened in a background tab, replay the intro when it is first seen
    if (!document.hidden && camState.intro < 1) introStart = performance.now();
  });
  loop();

  return {
    scene,
    camera,
    renderer,
    camState,
    hotspots,
    setTooltip(el) {
      tip.el = el;
    },
    toggleLights,
    toggleDesk,
    toggleTune,
    step: tick,
    /** "auto" (follow the OS), "dark" or "light" */
    setTheme(mode) {
      theme.mode = mode;
      resolveTheme();
    },
    onHover(fn) {
      listeners.hover.push(fn);
    },
    /** highlight an object from the outside (nav link hover) */
    highlight(name) {
      linkHover = name ? hotspots.find((h) => h.name === name) || null : null;
    },
    stop() {
      running = false;
    },
  };
}
