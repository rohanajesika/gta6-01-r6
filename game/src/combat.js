// Combat — fists and a pistol, kept simple and readable. A punch hits the nearest
// person in front of the player; a shot hits the nearest person or police car in a
// cone ahead of the camera. Every violent act raises the wanted level: the Bay notices.
import * as THREE from 'three';

export function punch(player, peds, police, ctx) {
  const range = 2.6;
  const fx = Math.sin(player.angle);
  const fz = Math.cos(player.angle);
  let best = null; let bestD = range;
  const consider = (obj, x, z, isOfficer) => {
    const dx = x - player.x; const dz = z - player.z;
    const d = Math.hypot(dx, dz);
    if (d > bestD) return;
    if (d > 0.5 && (dx * fx + dz * fz) / d < 0.5) return; // must be roughly ahead
    bestD = d; best = { obj, isOfficer };
  };
  for (const ped of peds) if (ped.state !== 'down') consider(ped, ped.x, ped.z, false);
  for (const officer of police.officers) consider(officer, officer.x, officer.z, true);
  if (!best) return false;
  const target = best.obj;
  target.state = 'down';
  target.mesh.rotation.x = -Math.PI / 2;
  target.mesh.position.y = 0.4;
  if (target.fleeTimer !== undefined) target.fleeTimer = 0;
  ctx.onCrime(1, 'You knocked someone out. The Bay noticed.');
  return true;
}

export function shoot(player, camera, peds, police, ctx) {
  if (player.ammo <= 0) { ctx.toast('Out of ammo — find a car and keep moving.'); return false; }
  player.ammo -= 1;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const ox = player.inCar && player.car ? player.car.x : player.x;
  const oz = player.inCar && player.car ? player.car.z : player.z;
  const oy = player.inCar ? 1.4 : 1.6;
  let best = null; let bestT = 45;
  const rayHit = (x, z, y, radius) => {
    const dx = x - ox; const dz = z - oz; const dy = y - oy;
    const t = dx * dir.x + dz * dir.z + dy * dir.y;
    if (t < 0 || t > bestT) return;
    const cx = ox + dir.x * t; const cz = oz + dir.z * t; const cy = oy + dir.y * t;
    if (Math.hypot(x - cx, z - cz) < radius + 0.6 && Math.abs(y - cy) < 1.6) bestT = t;
  };
  let hitPed = null;
  for (const ped of peds) {
    if (ped.state === 'down') continue;
    const before = bestT;
    rayHit(ped.x, ped.z, 1.2, 0.6);
    if (bestT < before) hitPed = ped;
  }
  let hitOfficer = null;
  for (const officer of police.officers) {
    const before = bestT;
    rayHit(officer.x, officer.z, 1.2, 0.6);
    if (bestT < before) hitOfficer = officer;
  }
  if (hitPed) {
    hitPed.state = 'down';
    hitPed.mesh.rotation.x = -Math.PI / 2;
    hitPed.mesh.position.y = 0.4;
    ctx.onCrime(2, 'Shots fired in Solmar Bay!');
    ctx.scareAt = { x: hitPed.x, z: hitPed.z };
    return true;
  }
  if (hitOfficer) {
    hitOfficer.state = 'down';
    hitOfficer.mesh.rotation.x = -Math.PI / 2;
    ctx.onCrime(2, 'You shot an officer — the whole department is coming.');
    return true;
  }
  // A stray shot still draws attention.
  ctx.onCrime(1, 'Gunfire echoes across the Bay.');
  ctx.scareAt = { x: ox + dir.x * 10, z: oz + dir.z * 10 };
  return true;
}
