// Solmar Bay — the procedural city. Builds the ground, sea and beach, the road grid,
// the buildings with lit windows, palms, lamps and parks, and answers where the player
// is (district) and what blocks movement (building colliders). No external assets: the
// window texture is painted on a canvas at runtime.
import * as THREE from 'three';

export const CITY_HALF = 220;
export const ROAD_SPACING = 40;
export const ROAD_WIDTH = 10;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

// Paint a small facade texture: warm plaster with a grid of lit and dark windows.
function facadeTexture(baseColor, rng) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = baseColor; ctx.fillRect(0, 0, 128, 256);
  for (let row = 0; row < 12; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const lit = rng() < 0.45;
      ctx.fillStyle = lit ? (rng() < 0.7 ? '#ffd98a' : '#9fd8ff') : '#1c2438';
      ctx.fillRect(4 + col * 15, 6 + row * 21, 10, 13);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const PALETTE = ['#e8b48a', '#d9a06f', '#c98f7a', '#b7c4ce', '#e5d3ae', '#a8b8c8', '#d97b6c', '#f0c98a'];

export function districtAt(x, z) {
  if (x < -150) return 'Marina';
  if (z > 140) return 'Port';
  if (x > 120 && z < -60) return 'Hills';
  if (z < -120) return 'Old Town';
  return 'Downtown';
}

export function buildWorld(scene, seed) {
  const rng = mulberry32(seed);
  const colliders = [];
  const roads = [];
  const group = new THREE.Group();
  group.name = 'city';

  // Sunset sky, fog and light.
  scene.background = new THREE.Color(0x2b1547);
  scene.fog = new THREE.Fog(0x3a1e52, 180, 520);
  const sun = new THREE.DirectionalLight(0xffb36b, 2.6);
  sun.position.set(-120, 90, 60);
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0x9a7fe0, 0x3a2418, 1.15);
  scene.add(hemi);
  const amb = new THREE.AmbientLight(0x604a80, 0.6);
  scene.add(amb);

  // Ground: grass-ish base, sand on the west edge, sea beyond it.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY_HALF * 2 + 80, CITY_HALF * 2 + 80),
    new THREE.MeshLambertMaterial({ color: 0x4a7a40 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.x = 20;
  group.add(ground);

  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(36, CITY_HALF * 2 + 80),
    new THREE.MeshLambertMaterial({ color: 0xe8cf9a }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(-CITY_HALF - 16, 0.05, 0);
  group.add(sand);

  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(160, CITY_HALF * 2 + 200),
    new THREE.MeshLambertMaterial({ color: 0x1d5f8a }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-CITY_HALF - 110, 0.02, 0);
  group.add(sea);

  // Road grid: dark strips along every grid line, plus pale centre dashes.
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x46464f });
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8c98a });
  const roadLines = [];
  for (let c = -160; c <= 160; c += ROAD_SPACING) roadLines.push(c);
  for (const c of roadLines) {
    const h = new THREE.Mesh(new THREE.PlaneGeometry(CITY_HALF * 2, ROAD_WIDTH), roadMat);
    h.rotation.x = -Math.PI / 2; h.position.set(0, 0.1, c);
    group.add(h);
    const v = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, CITY_HALF * 2), roadMat);
    v.rotation.x = -Math.PI / 2; v.position.set(c, 0.1, 0);
    group.add(v);
    roads.push({ axis: 'x', at: c });
    roads.push({ axis: 'z', at: c });
    for (let d = -200; d <= 200; d += 16) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.5), dashMat);
      dash.rotation.x = -Math.PI / 2; dash.position.set(d, 0.12, c);
      group.add(dash);
      const dash2 = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 3), dashMat);
      dash2.rotation.x = -Math.PI / 2; dash2.position.set(c, 0.12, d);
      group.add(dash2);
    }
  }

  // Buildings: one or two per block, taller near the centre (Downtown towers).
  const geoBox = new THREE.BoxGeometry(1, 1, 1);
  const blocks = [];
  for (let bx = -160; bx < 160; bx += ROAD_SPACING) {
    for (let bz = -160; bz < 160; bz += ROAD_SPACING) {
      blocks.push([bx, bz]);
    }
  }
  // Two park blocks stay green.
  const parks = new Set(['-80,40', '40,-80']);
  let buildingCount = 0;
  for (const [bx, bz] of blocks) {
    const key = `${bx},${bz}`;
    const cx = bx + ROAD_SPACING / 2;
    const cz = bz + ROAD_SPACING / 2;
    if (parks.has(key)) {
      const park = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 30),
        new THREE.MeshLambertMaterial({ color: 0x4d8a3f }),
      );
      park.rotation.x = -Math.PI / 2; park.position.set(cx, 0.08, cz);
      group.add(park);
      for (let i = 0; i < 5; i += 1) addTree(group, cx - 10 + rng() * 20, cz - 10 + rng() * 20, rng);
      continue;
    }
    if (cx < -170) continue; // beach blocks stay empty
    const distCentre = Math.hypot(cx, cz);
    const tall = distCentre < 70 ? 26 + rng() * 26 : 8 + rng() * 14;
    const w = 14 + rng() * 10;
    const d = 14 + rng() * 10;
    const color = pick(rng, PALETTE);
    const mat = new THREE.MeshLambertMaterial({ map: facadeTexture(color, rng) });
    const b = new THREE.Mesh(geoBox, mat);
    b.scale.set(w, tall, d);
    b.position.set(cx, tall / 2, cz);
    group.add(b);
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
    buildingCount += 1;
    // A low annex on some blocks, kept inside its own block so it never blocks a road.
    if (rng() < 0.4) {
      const aw = 8 + rng() * 5; const ah = 5 + rng() * 4; const ad = 8 + rng() * 5;
      let ax = cx + (rng() < 0.5 ? -1 : 1) * (w / 2 + aw / 2 + 2);
      // The block's buildable strip is bx+5..bx+35: roads run on its edges.
      ax = Math.max(bx + 5 + aw / 2, Math.min(bx + 35 - aw / 2, ax));
      const annex = new THREE.Mesh(geoBox, new THREE.MeshLambertMaterial({ color: pick(rng, PALETTE) }));
      annex.scale.set(aw, ah, ad);
      annex.position.set(ax, ah / 2, cz);
      group.add(annex);
      colliders.push({ minX: ax - aw / 2, maxX: ax + aw / 2, minZ: cz - ad / 2, maxZ: cz + ad / 2 });
    }
  }

  // Palms along the beach and the Marina promenade.
  for (let z = -200; z <= 200; z += 18) {
    addPalm(group, -CITY_HALF - 6 + rng() * 4, z + rng() * 6, rng);
    if (rng() < 0.6) addPalm(group, -168 + rng() * 4, z + rng() * 8, rng);
  }

  // Street lamps at road corners.
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x30323a });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  for (const c of roadLines) {
    for (const d of roadLines) {
      if (rng() < 0.5) continue;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 6), poleMat);
      pole.position.set(c + 6, 3, d + 6);
      group.add(pole);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), lampMat);
      lamp.position.set(c + 6, 6.2, d + 6);
      group.add(lamp);
    }
  }

  // The pier reaching into the sea, and the Port cranes in the south-east.
  const pier = new THREE.Mesh(new THREE.BoxGeometry(50, 1, 8), new THREE.MeshLambertMaterial({ color: 0x8a6a4a }));
  pier.position.set(-CITY_HALF - 55, 0.6, 40);
  group.add(pier);
  for (let i = 0; i < 3; i += 1) {
    const crane = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.BoxGeometry(2, 22, 2), new THREE.MeshLambertMaterial({ color: 0xd8a03a }));
    mast.position.y = 11;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(18, 1.5, 1.5), new THREE.MeshLambertMaterial({ color: 0xd8a03a }));
    arm.position.set(6, 20, 0);
    crane.add(mast, arm);
    crane.position.set(150 + i * 30, 0, 180);
    group.add(crane);
  }
  // Shipping containers near the Port.
  const containerColors = [0xb8442f, 0x2f6db8, 0x3f8a4d, 0xd8a03a];
  for (let i = 0; i < 10; i += 1) {
    const cont = new THREE.Mesh(geoBox, new THREE.MeshLambertMaterial({ color: containerColors[i % 4] }));
    cont.scale.set(10, 3, 3);
    cont.position.set(120 + (i % 5) * 14, 1.5, 160 + Math.floor(i / 5) * 8);
    group.add(cont);
    colliders.push({ minX: cont.position.x - 5, maxX: cont.position.x + 5, minZ: cont.position.z - 1.5, maxZ: cont.position.z + 1.5 });
  }

  scene.add(group);
  return { group, colliders, roads, buildingCount, bounds: CITY_HALF };
}

function addTree(group, x, z, rng) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.35, 2.5, 6),
    new THREE.MeshLambertMaterial({ color: 0x6a4a2a }),
  );
  trunk.position.set(x, 1.25, z);
  const top = new THREE.Mesh(
    new THREE.SphereGeometry(1.8 + rng(), 8, 6),
    new THREE.MeshLambertMaterial({ color: 0x2f7a33 }),
  );
  top.position.set(x, 3.4, z);
  group.add(trunk, top);
}

function addPalm(group, x, z, rng) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.3, 5 + rng() * 2, 6),
    new THREE.MeshLambertMaterial({ color: 0x7a5a34 }),
  );
  trunk.position.set(x, 2.8, z);
  trunk.rotation.z = (rng() - 0.5) * 0.25;
  const fronds = new THREE.Mesh(
    new THREE.ConeGeometry(2.2, 2.2, 7),
    new THREE.MeshLambertMaterial({ color: 0x3f9a44 }),
  );
  fronds.position.set(x, 6, z);
  group.add(trunk, fronds);
}

// Push a circle (player or car) out of every building it overlaps; returns true on a hit.
export function collideCircle(colliders, x, z, radius) {
  let hit = false;
  for (const c of colliders) {
    const nx = Math.max(c.minX, Math.min(x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
    const dx = x - nx; const dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) hit = true;
  }
  return hit;
}

export function resolveCircle(colliders, pos, radius) {
  for (const c of colliders) {
    const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    let dx = pos.x - nx; let dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 < 0.0001) {
      // Centre inside the box: push out along the smallest penetration axis.
      const left = pos.x - c.minX; const right = c.maxX - pos.x;
      const top = pos.z - c.minZ; const bottom = c.maxZ - pos.z;
      const m = Math.min(left, right, top, bottom);
      if (m === left) pos.x = c.minX - radius;
      else if (m === right) pos.x = c.maxX + radius;
      else if (m === top) pos.z = c.minZ - radius;
      else pos.z = c.maxZ + radius;
      continue;
    }
    const d = Math.sqrt(d2);
    dx /= d; dz /= d;
    pos.x = nx + dx * radius;
    pos.z = nz + dz * radius;
  }
}
