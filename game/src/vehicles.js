// Vehicles — the cars of Solmar Bay. A car is a small group of boxes (body, cabin,
// four wheels, headlights) with a plain state object: position, heading, speed, and
// whether it is parked, in traffic or driven by the player. Traffic cars follow the
// road grid and turn at intersections; the player's car uses simple arcade physics.
import * as THREE from 'three';
import { resolveCircle } from './world.js';

const CAR_COLORS = [0xc23b3b, 0x3b6dc2, 0xd8c23b, 0x3bc25a, 0x8a3bc2, 0xd8d8d8, 0x222222, 0xe07b2f, 0x2fb8c2];
const CAR_NAMES = ['Solmar Comet', 'Bay Runner', 'Sunset GT', 'Marina Cruiser', 'Port Hauler', 'Hills Coupe'];

export function makeCarMesh(color, kind = 'sedan') {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x1a2436 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, 4.4), bodyMat);
  body.position.y = 0.55;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.2), glassMat);
  cabin.position.set(0, 1.1, -0.2);
  group.add(cabin);
  if (kind === 'sport') {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.4), bodyMat);
    spoiler.position.set(0, 1.0, -2.1);
    group.add(spoiler);
  }
  if (kind === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 0.4), new THREE.MeshBasicMaterial({ color: 0xffd23e }));
    sign.position.set(0, 1.5, -0.2);
    group.add(sign);
  }
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.38, wz);
    group.add(wheel);
  }
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  for (const lx of [-0.65, 0.65]) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.1), lightMat);
    light.position.set(lx, 0.6, 2.22);
    group.add(light);
  }
  return group;
}

export function makePoliceMesh() {
  const group = makeCarMesh(0xf0f0f0, 'sedan');
  const bar = new THREE.Group();
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.5), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  red.position.x = -0.4;
  const blue = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.5), new THREE.MeshBasicMaterial({ color: 0x2040ff }));
  blue.position.x = 0.4;
  bar.add(red, blue);
  bar.position.y = 1.5;
  bar.name = 'lightbar';
  group.add(bar);
  return group;
}

export function newCar(scene, x, z, angle, color, kind = 'sedan', parked = false) {
  const mesh = kind === 'police' ? makePoliceMesh() : makeCarMesh(color, kind);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = angle;
  scene.add(mesh);
  return {
    mesh, x, z, angle, speed: 0, parked, kind, color,
    name: CAR_NAMES[Math.floor(Math.random() * CAR_NAMES.length)],
    ai: !parked, aiSpeed: 8 + Math.random() * 6, turnCooldown: 0, flashing: 0,
  };
}

export function buildTraffic(scene, world, rng, count = 14) {
  const cars = [];
  const lines = [];
  for (let c = -160; c <= 160; c += 40) lines.push(c);
  for (let i = 0; i < count; i += 1) {
    const along = lines[Math.floor(rng() * lines.length)];
    const across = -200 + rng() * 400;
    const horizontal = rng() < 0.5;
    const x = horizontal ? across : along + (rng() < 0.5 ? -2.5 : 2.5);
    const z = horizontal ? along + (rng() < 0.5 ? -2.5 : 2.5) : across;
    const angle = horizontal ? (rng() < 0.5 ? 0 : Math.PI) : (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    const color = CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)];
    const car = newCar(scene, x, z, angle, color, rng() < 0.15 ? 'sport' : 'sedan', false);
    car.speed = car.aiSpeed;
    cars.push(car);
  }
  // Parked cars the player can steal, lined up on the roads themselves so a new
  // driver can pull straight out onto the street.
  const parkedSpots = [[-2, 4, 0], [42, -116, Math.PI / 2], [-116, 78, 0], [76, 156, -Math.PI / 2], [156, -36, Math.PI], [-36, -156, Math.PI / 2]];
  const parked = [];
  for (const [x, z, a] of parkedSpots) {
    const color = CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)];
    const car = newCar(scene, x, z, a, color, rng() < 0.3 ? 'taxi' : 'sedan', true);
    parked.push(car);
    cars.push(car);
  }
  return { cars, parked };
}

// One traffic car: cruise along its road, turn at an intersection sometimes, slow for
// the car ahead. Wrap around the city edge instead of leaving the map.
export function updateTrafficCar(car, dt, others) {
  if (car.parked) return;
  car.turnCooldown -= dt;
  const aheadX = car.x + Math.sin(car.angle) * 9;
  const aheadZ = car.z + Math.cos(car.angle) * 9;
  let blocked = false;
  for (const other of others) {
    if (other === car) continue;
    if (Math.hypot(other.x - aheadX, other.z - aheadZ) < 4) { blocked = true; break; }
  }
  const target = blocked ? 0 : car.aiSpeed;
  car.speed += (target - car.speed) * Math.min(1, dt * 1.5);
  car.x += Math.sin(car.angle) * car.speed * dt;
  car.z += Math.cos(car.angle) * car.speed * dt;
  const nearGrid = (v) => Math.abs(((v + 20) % 40) - 20) < 1.2;
  if (car.turnCooldown <= 0 && (nearGrid(car.x) || nearGrid(car.z)) && Math.random() < 0.02) {
    car.angle += (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
    car.turnCooldown = 4;
  }
  if (car.x > 215) car.x = -215;
  if (car.x < -215) car.x = 215;
  if (car.z > 215) car.z = -215;
  if (car.z < -215) car.z = 215;
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.angle;
}

// Arcade driving: W/S throttle and brake/reverse, A/D steer harder the slower you go,
// Space handbrakes, buildings push the car out, other cars slow it down.
export function driveCar(car, input, dt, world, others) {
  const accel = input.forward ? 16 : 0;
  const brake = input.back ? 22 : 0;
  car.speed += (accel - brake) * dt;
  if (!input.forward && !input.back) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 8 * dt);
  if (input.handbrake) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 30 * dt);
  car.speed = Math.max(-10, Math.min(38, car.speed));
  const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const steerAmount = steer * 1.9 * dt * Math.min(1, Math.abs(car.speed) / 8 + 0.25) * (car.speed < 0 ? -1 : 1);
  car.angle += steerAmount;
  const nx = car.x + Math.sin(car.angle) * car.speed * dt;
  const nz = car.z + Math.cos(car.angle) * car.speed * dt;
  const before = { x: car.x, z: car.z };
  car.x = Math.max(-218, Math.min(218, nx));
  car.z = Math.max(-218, Math.min(218, nz));
  resolveCircle(world.colliders, car, 2.2);
  let hitOther = false;
  for (const other of others) {
    if (other === car || other.parked) continue;
    if (Math.hypot(other.x - car.x, other.z - car.z) < 4.2) { hitOther = true; break; }
  }
  if (hitOther || (Math.hypot(car.x - before.x, car.z - before.z) < Math.abs(car.speed) * dt * 0.4 && Math.abs(car.speed) > 4)) {
    car.speed *= 0.45;
  }
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.angle;
}

export function nearestCar(cars, x, z, maxDist = 5) {
  let best = null; let bestD = maxDist;
  for (const car of cars) {
    const d = Math.hypot(car.x - x, car.z - z);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}
