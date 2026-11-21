// Pedestrians and the Solmar Bay Police. Civilians stroll the sidewalks and run from
// gunfire; the police answer the wanted level with patrol cars that chase the player
// and officers on foot who try to make the arrest. A busted player is caught, not killed.
import * as THREE from 'three';
import { newCar, makePoliceMesh } from './vehicles.js';
import { resolveCircle } from './world.js';

const SHIRTS = [0xe8e8e8, 0x4a90d9, 0xd94a6a, 0x4ad97b, 0xe8c84a, 0x9a4ad9, 0xe87b2f, 0x2f9a8a];
const PED_NAMES = ['Mara', 'Tomas', 'Lena', 'Dario', 'Sofia', 'Kiko', 'Ana', 'Bruno', 'Ines', 'Pavel', 'Rosa', 'Felix'];

function makePedMesh(shirt) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.38, 1.0, 8),
    new THREE.MeshLambertMaterial({ color: shirt }),
  );
  body.position.y = 0.95;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0xe8b98a }),
  );
  head.position.y = 1.7;
  const legs = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.5, 0.3),
    new THREE.MeshLambertMaterial({ color: 0x2a2f45 }),
  );
  legs.position.y = 0.25;
  group.add(body, head, legs);
  return group;
}

export function buildPedestrians(scene, rng, count = 26) {
  const peds = [];
  for (let i = 0; i < count; i += 1) {
    const mesh = makePedMesh(SHIRTS[Math.floor(rng() * SHIRTS.length)]);
    const x = -200 + rng() * 400;
    const z = -200 + rng() * 400;
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    peds.push({
      mesh, x, z, angle: rng() * Math.PI * 2,
      speed: 1.2 + rng() * 1.2, name: PED_NAMES[i % PED_NAMES.length],
      state: 'walk', fleeTimer: 0, turnTimer: 1 + rng() * 4, health: 100,
    });
  }
  return peds;
}

export function updatePedestrians(peds, dt, world, scare) {
  for (const ped of peds) {
    if (ped.state === 'down') continue;
    ped.turnTimer -= dt;
    if (ped.state === 'flee') {
      ped.fleeTimer -= dt;
      if (ped.fleeTimer <= 0) ped.state = 'walk';
    } else if (scare && Math.hypot(scare.x - ped.x, scare.z - ped.z) < 25) {
      ped.state = 'flee';
      ped.fleeTimer = 3 + Math.random() * 2;
      ped.angle = Math.atan2(ped.x - scare.x, ped.z - scare.z);
    } else if (ped.turnTimer <= 0) {
      ped.angle += (Math.random() - 0.5) * 2.2;
      ped.turnTimer = 2 + Math.random() * 4;
    }
    const speed = ped.state === 'flee' ? 5.5 : ped.speed;
    ped.x += Math.sin(ped.angle) * speed * dt;
    ped.z += Math.cos(ped.angle) * speed * dt;
    ped.x = Math.max(-215, Math.min(215, ped.x));
    ped.z = Math.max(-215, Math.min(215, ped.z));
    resolveCircle(world.colliders, ped, 0.5);
    ped.mesh.position.set(ped.x, 0, ped.z);
    ped.mesh.rotation.y = ped.angle;
    // A little walk bob so they read as alive.
    ped.mesh.position.y = Math.abs(Math.sin(performance.now() / 180 + ped.x)) * 0.06;
  }
}

// The police force: patrol cars that chase, officers on foot when the player is on foot.
// ctx: { player, wanted, world, scene, onBusted(dt), onRam() }.
export function buildPolice(scene) {
  return { cars: [], officers: [], bustTimer: 0, spawnTimer: 0 };
}

function spawnPoliceCar(police, scene, player) {
  const angle = Math.atan2(player.x, player.z);
  const sx = player.x - Math.sin(angle) * 70;
  const sz = player.z - Math.cos(angle) * 70;
  const car = newCar(scene, sx, sz, angle, 0xf0f0f0, 'police', false);
  car.aiSpeed = 26;
  car.speed = 20;
  police.cars.push(car);
  return car;
}

function spawnOfficer(police, scene, player) {
  const mesh = makePedMesh(0x1a2a5a);
  const a = Math.random() * Math.PI * 2;
  const x = player.x + Math.sin(a) * 25;
  const z = player.z + Math.cos(a) * 25;
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  const officer = { mesh, x, z, angle: a, speed: 6.5, state: 'chase' };
  police.officers.push(officer);
  return officer;
}

export function updatePolice(police, dt, ctx) {
  const { player, wanted, world, scene } = ctx;
  const wantCars = wanted === 0 ? 0 : Math.min(4, wanted + 1);
  police.spawnTimer -= dt;
  while (police.cars.length < wantCars && police.spawnTimer <= 0) {
    spawnPoliceCar(police, scene, player);
    police.spawnTimer = 1.2;
  }
  // Wanted cleared: patrol cars drive off and fade out.
  if (wanted === 0) {
    for (const car of police.cars) {
      car.aiSpeed = 20;
      car.x += Math.sin(car.angle) * car.speed * dt;
      car.z += Math.cos(car.angle) * car.speed * dt;
      car.mesh.position.set(car.x, 0, car.z);
    }
    if (police.cars.length && Math.hypot(police.cars[0].x - player.x, police.cars[0].z - player.z) > 150) {
      const gone = police.cars.shift();
      scene.remove(gone.mesh);
    }
    for (const officer of police.officers) scene.remove(officer.mesh);
    police.officers.length = 0;
    police.bustTimer = 0;
    return;
  }

  // Chase: steer each patrol car toward the player, faster than traffic.
  for (const car of police.cars) {
    const targetAngle = Math.atan2(player.x - car.x, player.z - car.z);
    let diff = targetAngle - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    car.angle += Math.max(-2.4 * dt, Math.min(2.4 * dt, diff));
    const targetSpeed = 26 + wanted * 1.5;
    car.speed += (targetSpeed - car.speed) * Math.min(1, dt * 1.2);
    car.x += Math.sin(car.angle) * car.speed * dt;
    car.z += Math.cos(car.angle) * car.speed * dt;
    resolveCircle(world.colliders, car, 2.2);
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.angle;
    // Flash the light bar.
    car.flashing += dt;
    const bar = car.mesh.getObjectByName('lightbar');
    if (bar) bar.visible = Math.floor(car.flashing * 4) % 2 === 0;
    const dist = Math.hypot(player.x - car.x, player.z - car.z);
    if (!player.inCar && dist < 4) {
      police.bustTimer += dt;
      if (police.bustTimer > 1.6) ctx.onBusted();
    }
    if (player.inCar && dist < 4.4) {
      ctx.onRam();
      car.speed *= 0.4;
      car.x -= Math.sin(car.angle) * 3;
      car.z -= Math.cos(car.angle) * 3;
    }
  }
  if (!player.inCar) police.bustTimer = Math.max(0, police.bustTimer - dt);

  // Foot officers when the player is on foot and the heat is on.
  const wantOfficers = wanted >= 2 && !player.inCar ? Math.min(3, wanted) : 0;
  while (police.officers.length < wantOfficers && police.spawnTimer <= 0) {
    spawnOfficer(police, scene, player);
    police.spawnTimer = 2;
  }
  for (const officer of police.officers) {
    const d = Math.hypot(player.x - officer.x, player.z - officer.z);
    officer.angle = Math.atan2(player.x - officer.x, player.z - officer.z);
    officer.x += Math.sin(officer.angle) * officer.speed * dt;
    officer.z += Math.cos(officer.angle) * officer.speed * dt;
    officer.mesh.position.set(officer.x, 0, officer.z);
    officer.mesh.rotation.y = officer.angle;
    if (d < 1.6) {
      police.bustTimer += dt;
      if (police.bustTimer > 1.2) ctx.onBusted();
    }
  }
  if (police.officers.length > wantOfficers) {
    const extra = police.officers.pop();
    scene.remove(extra.mesh);
  }
}
