// Solmar Bay — boot, the one loop, input, camera, HUD, minimap, save and screens.
// The game moves between title, play, paused and ended screens. The world advances in
// fixed 1/60 s steps; the camera follows the player on foot or in the car; the HUD
// (cash, wanted stars, health, minimap, mission) is plain DOM updated every frame.
// ?shot=cover|city|chase|mission stages a screenshot scene instead of the loop and
// sets window.__shotReady when it has painted twice.
import * as THREE from 'three';
import { buildWorld, districtAt, resolveCircle, CITY_HALF } from './world.js';
import { buildTraffic, updateTrafficCar, driveCar, nearestCar } from './vehicles.js';
import { buildPedestrians, updatePedestrians, buildPolice, updatePolice } from './pedestrians.js';
import { createMissions, currentMission, currentStep, missionTarget, updateMissions, makeBeacon, moveBeacon } from './missions.js';
import { punch, shoot } from './combat.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;
const SAVE_KEY = 'solmar-bay-save-v1';
const START_POS = { x: -6, z: 4 };

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 20261122;

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const hud = document.getElementById('hud');
const minimap = document.getElementById('minimap');
const mapCtx = minimap.getContext('2d');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);

const world = buildWorld(scene, seed);
const traffic = buildTraffic(scene, world, Math.random, 14);
const peds = buildPedestrians(scene, Math.random, 26);
const police = buildPolice(scene);
const missions = createMissions();
const beacon = makeBeacon(scene);
const audio = createAudio();

// The yellow Sunset GT for Mission 2: the parked car by the Port containers.
let targetCar = null;
for (const car of traffic.parked) {
  if (Math.hypot(car.x - 76, car.z - 156) < 3) {
    targetCar = car;
    car.kind = 'sport';
    car.name = 'Sunset GT';
    car.mesh.children[0].material.color.set(0xd8c23b);
  }
}

function makePlayerMesh() {
  const group = new THREE.Group();
  const jacket = new THREE.MeshLambertMaterial({ color: 0x1f8a8a });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 1.0, 8), jacket);
  body.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), new THREE.MeshLambertMaterial({ color: 0xe8b98a }));
  head.position.y = 1.7;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.1, 10), new THREE.MeshLambertMaterial({ color: 0xffd23e }));
  cap.position.y = 1.92;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.3), new THREE.MeshLambertMaterial({ color: 0x24304a }));
  legs.position.y = 0.25;
  group.add(body, head, cap, legs);
  return group;
}

const playerMesh = makePlayerMesh();
scene.add(playerMesh);

const player = {
  x: START_POS.x, z: START_POS.z, angle: Math.PI, speed: 0,
  health: 100, cash: 0, ammo: 24, inCar: false, car: null, mesh: playerMesh,
};

const G = {
  started: false, screen: 'title', wanted: 0, player, traffic, police, missions,
  world, peds, targetCar, scareAt: null, time: 0, scene,
};
window.__game = G;

let camYaw = Math.PI;
let camPitch = 0.32;
let camDist = 9;
let dragCooldown = 0;
let crimeTimer = 0;
let decayTimer = 0;
let toastTimer = 0;
let ramCooldown = 0;
let bustedOnce = false;

const keys = new Set();
let mouseDown = false;
let lastMouse = { x: 0, y: 0 };

function announce(message) { statusEl.textContent = message; }
function toast(message, seconds = 4) {
  const el = document.getElementById('toast');
  el.textContent = message;
  toastTimer = seconds;
  announce(message);
}

function saveGame() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: player.cash, ammo: player.ammo, health: player.health,
      missionIndex: missions.index, missionStep: missions.step,
      x: player.x, z: player.z, wanted: G.wanted,
    }));
    return true;
  } catch { return false; }
}

function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function applySave(data) {
  player.cash = data.cash ?? 0;
  player.ammo = data.ammo ?? 24;
  player.health = data.health ?? 100;
  missions.index = data.missionIndex ?? 0;
  missions.step = data.missionStep ?? 0;
  player.x = data.x ?? START_POS.x;
  player.z = data.z ?? START_POS.z;
  G.wanted = data.wanted ?? 0;
}

function setWanted(n) {
  G.wanted = Math.max(0, Math.min(5, n));
  crimeTimer = 0;
  decayTimer = 0;
}

function onCrime(stars, message) {
  setWanted(G.wanted + stars);
  toast(message);
}

function addCash(amount) {
  player.cash += amount;
  audio.cash();
  saveGame();
}

function exitCar() {
  if (!player.inCar || !player.car) return;
  const car = player.car;
  player.inCar = false;
  player.car = null;
  player.x = car.x - Math.sin(car.angle + Math.PI / 2) * 2.5;
  player.z = car.z - Math.cos(car.angle + Math.PI / 2) * 2.5;
  player.angle = car.angle;
  playerMesh.visible = true;
  playerMesh.position.set(player.x, 0, player.z);
}

function tryEnterCar() {
  if (player.inCar) { exitCar(); return; }
  const car = nearestCar(traffic.cars, player.x, player.z, 5);
  if (!car) { toast('No car close enough — walk up to one and press E.'); return; }
  const stolen = !car.parked;
  car.parked = false;
  car.ai = false;
  car.speed = 0;
  player.car = car;
  player.inCar = true;
  playerMesh.visible = false;
  if (stolen) onCrime(1, `You stole the ${car.name}! The owner called the police.`);
  else toast(`You got into the ${car.name}. Drive!`);
  audio.pickup();
}

function endGame(kind, text) {
  G.screen = kind;
  G.started = false;
  audio.busted();
  saveGame();
  document.getElementById('end-title').textContent = kind === 'busted' ? 'BUSTED' : kind === 'wasted' ? 'WASTED' : 'SOLMAR BAY IS YOURS';
  document.getElementById('end-text').textContent = text;
  hud.classList.add('hidden');
  document.getElementById('end-screen').classList.remove('hidden');
  announce(text);
}

function onBusted() {
  if (bustedOnce || G.screen !== 'play') return;
  bustedOnce = true;
  const fine = Math.floor(player.cash * 0.2);
  player.cash -= fine;
  player.health = 100;
  setWanted(0);
  if (player.inCar) exitCar();
  player.x = START_POS.x; player.z = START_POS.z;
  playerMesh.position.set(player.x, 0, player.z);
  endGame('busted', `The Solmar Bay PD caught Rico. Bail and fines cost you $${fine}. You walk out of the station — and Madame Vela is still waiting.`);
}

function onWasted() {
  endGame('wasted', 'Rico went down in the streets of Solmar Bay. The Bay is unforgiving — but it always gives a second chance.');
}

function onAllDone() {
  endGame('done', `All three jobs done. $${player.cash} in your pocket, the GT in Vela's garage, and the whole Bay knows the name Rico Marlin. Solmar Bay is yours.`);
}

function startGame(fromSave) {
  const data = fromSave ? loadSave() : null;
  if (data) applySave(data);
  else {
    player.cash = 0; player.ammo = 24; player.health = 100;
    missions.index = 0; missions.step = 0; missions.done = false; missions.failed = false; missions.timer = 0;
    player.x = START_POS.x; player.z = START_POS.z;
    setWanted(0);
  }
  if (player.inCar) exitCar();
  playerMesh.visible = true;
  playerMesh.position.set(player.x, 0, player.z);
  bustedOnce = false;
  G.screen = 'play';
  G.started = true;
  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('end-screen').classList.add('hidden');
  document.getElementById('pause-menu').classList.add('hidden');
  hud.classList.remove('hidden');
  audio.resume();
  audio.startPad();
  const mission = currentMission(missions);
  toast(mission ? mission.title : 'Free roam — Solmar Bay is yours.', 5);
  announce('Playing Solmar Bay.');
}

function togglePause() {
  if (G.screen === 'play') {
    G.screen = 'paused';
    document.getElementById('pause-stats').textContent =
      `Cash $${player.cash} · ${currentMission(missions) ? currentMission(missions).title : 'All missions done'} · Wanted ${G.wanted} star${G.wanted === 1 ? '' : 's'}`;
    document.getElementById('pause-menu').classList.remove('hidden');
    announce('Paused.');
  } else if (G.screen === 'paused') {
    G.screen = 'play';
    document.getElementById('pause-menu').classList.add('hidden');
    announce('Playing.');
  }
}

// --- Input ---
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyM') { const muted = audio.toggleMute(); toast(muted ? 'Sound muted.' : 'Sound on.'); }
  if (G.screen === 'play') {
    if (e.code === 'KeyE') tryEnterCar();
    if (e.code === 'KeyF') {
      if (punch(player, peds, police, { onCrime })) audio.punch();
    }
    if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  } else if (G.screen === 'paused' && (e.code === 'KeyP' || e.code === 'Escape')) {
    togglePause();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('mousedown', (e) => {
  mouseDown = true;
  lastMouse = { x: e.clientX, y: e.clientY };
  if (G.screen === 'play' && e.button === 0) {
    const ctx = { onCrime, toast, scareAt: null };
    if (shoot(player, camera, peds, police, ctx)) audio.gunshot();
    if (ctx.scareAt) G.scareAt = ctx.scareAt;
  }
});
window.addEventListener('mouseup', () => { mouseDown = false; });
window.addEventListener('mousemove', (e) => {
  if (!mouseDown) return;
  camYaw -= (e.clientX - lastMouse.x) * 0.005;
  camPitch = Math.max(0.12, Math.min(1.1, camPitch + (e.clientY - lastMouse.y) * 0.004));
  dragCooldown = 1.2;
  lastMouse = { x: e.clientX, y: e.clientY };
});
window.addEventListener('wheel', (e) => {
  camDist = Math.max(5, Math.min(18, camDist + Math.sign(e.deltaY)));
}, { passive: true });
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && G.screen === 'play') togglePause();
});

document.getElementById('btn-start').addEventListener('click', () => startGame(false));
document.getElementById('btn-continue').addEventListener('click', () => startGame(true));
document.getElementById('btn-resume').addEventListener('click', togglePause);
document.getElementById('btn-save').addEventListener('click', () => {
  toast(saveGame() ? 'Game saved.' : 'Could not save (storage unavailable).');
});
document.getElementById('btn-quit').addEventListener('click', () => {
  saveGame();
  G.screen = 'title';
  document.getElementById('pause-menu').classList.add('hidden');
  hud.classList.add('hidden');
  document.getElementById('start-screen').classList.remove('hidden');
  refreshTitleButtons();
});
document.getElementById('btn-restart').addEventListener('click', () => startGame(false));
document.getElementById('btn-title').addEventListener('click', () => {
  G.screen = 'title';
  document.getElementById('end-screen').classList.add('hidden');
  document.getElementById('start-screen').classList.remove('hidden');
  refreshTitleButtons();
});

function refreshTitleButtons() {
  document.getElementById('btn-continue').classList.toggle('hidden', !loadSave());
}
refreshTitleButtons();

// --- Simulation step ---
function readInput() {
  return {
    forward: keys.has('KeyW') || keys.has('ArrowUp'),
    back: keys.has('KeyS') || keys.has('ArrowDown'),
    left: keys.has('KeyA') || keys.has('ArrowLeft'),
    right: keys.has('KeyD') || keys.has('ArrowRight'),
    handbrake: keys.has('Space'),
  };
}

function step(dt) {
  G.time += dt;
  dragCooldown = Math.max(0, dragCooldown - dt);
  ramCooldown = Math.max(0, ramCooldown - dt);
  const input = readInput();

  if (player.inCar && player.car) {
    driveCar(player.car, input, dt, world, traffic.cars);
    player.x = player.car.x; player.z = player.car.z;
    player.angle = player.car.angle;
    audio.setEngine(player.car.speed, true);
  } else {
    const fwd = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const speed = 6;
    if (fwd !== 0 || strafe !== 0) {
      const moveAngle = camYaw + Math.atan2(strafe, fwd);
      player.x += Math.sin(moveAngle) * speed * dt;
      player.z += Math.cos(moveAngle) * speed * dt;
      player.angle = moveAngle;
    }
    player.x = Math.max(-218, Math.min(218, player.x));
    player.z = Math.max(-218, Math.min(218, player.z));
    resolveCircle(world.colliders, player, 0.6);
    playerMesh.position.set(player.x, 0, player.z);
    playerMesh.rotation.y = player.angle;
    playerMesh.position.y = (fwd !== 0 || strafe !== 0) ? Math.abs(Math.sin(G.time * 10)) * 0.08 : 0;
    audio.setEngine(0, false);
  }

  for (const car of traffic.cars) {
    if (car !== player.car) updateTrafficCar(car, dt, traffic.cars);
  }
  updatePedestrians(peds, dt, world, G.scareAt);
  G.scareAt = null;

  updatePolice(police, dt, {
    player, wanted: G.wanted, world, scene,
    onBusted,
    onRam: () => {
      if (ramCooldown > 0) return;
      ramCooldown = 1;
      player.health -= 6;
      audio.punch();
      toast('The police rammed your car!');
      if (player.health <= 0) onWasted();
    },
  });

  // Wanted decay: lay low and the heat cools off.
  if (G.wanted > 0) {
    crimeTimer += dt;
    if (crimeTimer > 12) {
      decayTimer += dt;
      if (decayTimer > 8) { G.wanted -= 1; decayTimer = 0; crimeTimer = 0; }
    }
  }

  updateMissions(missions, dt, {
    player, wanted: G.wanted, targetCar, setWanted,
    toast,
    onReward: addCash,
    onAllDone,
    onFail: (reason) => {
      toast(reason, 6);
      missions.index = 0; missions.step = 0; missions.failed = false; missions.timer = 0;
      toast('Madame Vela calls again — the courier job is back on.', 6);
    },
  });

  // Health regen when calm.
  if (G.wanted === 0 && player.health < 100) player.health = Math.min(100, player.health + dt * 1.5);
  if (player.health <= 0) onWasted();

  audio.siren(dt, G.wanted);
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) document.getElementById('toast').textContent = '';
  }
  moveBeacon(beacon, missionTarget(missions), G.time);
}

// --- Camera ---
function updateCamera(dt) {
  const target = player.inCar && player.car ? player.car : player;
  const wantDist = player.inCar ? camDist + 2 : camDist;
  if (dragCooldown <= 0) {
    let diff = target.angle - camYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    camYaw += diff * Math.min(1, dt * 1.6);
  }
  // Pull the camera in (and, if needed, up) so it never sits inside a building:
  // the trail behind the player runs along the road, but a tall block can still
  // swallow it at an intersection.
  let dist = wantDist;
  let cx = target.x - Math.sin(camYaw) * dist * Math.cos(camPitch);
  let cz = target.z - Math.cos(camYaw) * dist * Math.cos(camPitch);
  let cy = 2.2 + dist * Math.sin(camPitch);
  const insideBuilding = (x, z) => world.colliders.some(
    (c) => x > c.minX - 1 && x < c.maxX + 1 && z > c.minZ - 1 && z < c.maxZ + 1,
  );
  for (let attempt = 0; attempt < 3 && insideBuilding(cx, cz); attempt += 1) {
    dist *= 0.6;
    cx = target.x - Math.sin(camYaw) * dist * Math.cos(camPitch);
    cz = target.z - Math.cos(camYaw) * dist * Math.cos(camPitch);
    cy = 2.2 + dist * Math.sin(camPitch);
  }
  if (insideBuilding(cx, cz)) cy = 26;
  camera.position.set(cx, cy, cz);
  camera.lookAt(target.x, 2.0, target.z);
}

// --- HUD + minimap ---
function drawMinimap() {
  const S = 180;
  const scale = S / (CITY_HALF * 2 + 60);
  const toMap = (v) => (v + CITY_HALF + 30) * scale;
  mapCtx.clearRect(0, 0, S, S);
  mapCtx.fillStyle = '#101830';
  mapCtx.fillRect(0, 0, S, S);
  mapCtx.fillStyle = '#c9a86a';
  mapCtx.fillRect(0, 0, toMap(-CITY_HALF) - toMap(-CITY_HALF - 30), S);
  mapCtx.fillStyle = '#1d5f8a';
  mapCtx.fillRect(0, 0, toMap(-CITY_HALF - 30), S);
  mapCtx.strokeStyle = '#3a3f52';
  mapCtx.lineWidth = 4;
  for (let c = -160; c <= 160; c += 40) {
    mapCtx.beginPath(); mapCtx.moveTo(toMap(c), 0); mapCtx.lineTo(toMap(c), S); mapCtx.stroke();
    mapCtx.beginPath(); mapCtx.moveTo(0, toMap(c)); mapCtx.lineTo(S, toMap(c)); mapCtx.stroke();
  }
  mapCtx.fillStyle = '#5a6278';
  for (const col of world.colliders) {
    mapCtx.fillRect(toMap(col.minX), toMap(col.minZ), (col.maxX - col.minX) * scale, (col.maxZ - col.minZ) * scale);
  }
  const target = missionTarget(missions);
  if (target) {
    mapCtx.fillStyle = '#ffd23e';
    mapCtx.beginPath(); mapCtx.arc(toMap(target.x), toMap(target.z), 5, 0, Math.PI * 2); mapCtx.fill();
  }
  if (targetCar && missions.index === 1) {
    mapCtx.fillStyle = '#ffe95c';
    mapCtx.beginPath(); mapCtx.arc(toMap(targetCar.x), toMap(targetCar.z), 4, 0, Math.PI * 2); mapCtx.fill();
  }
  for (const car of police.cars) {
    mapCtx.fillStyle = '#ff4040';
    mapCtx.beginPath(); mapCtx.arc(toMap(car.x), toMap(car.z), 3, 0, Math.PI * 2); mapCtx.fill();
  }
  const px = toMap(player.x); const pz = toMap(player.z);
  mapCtx.fillStyle = '#7dff9a';
  mapCtx.save();
  mapCtx.translate(px, pz);
  mapCtx.rotate(Math.PI - player.angle);
  mapCtx.beginPath(); mapCtx.moveTo(0, -6); mapCtx.lineTo(4, 5); mapCtx.lineTo(-4, 5); mapCtx.closePath(); mapCtx.fill();
  mapCtx.restore();
}

function updateHUD() {
  document.getElementById('cash').textContent = `$${player.cash}`;
  const wantedEl = document.getElementById('wanted');
  wantedEl.innerHTML = '★'.repeat(G.wanted) + `<span class="off">${'★'.repeat(5 - G.wanted)}</span>`;
  document.getElementById('district').textContent = districtAt(player.x, player.z);
  document.getElementById('health-fill').style.width = `${Math.max(0, player.health)}%`;
  document.getElementById('ammo-label').textContent = `AMMO ${player.ammo}`;
  const speedEl = document.getElementById('speed');
  if (player.inCar && player.car) {
    speedEl.classList.remove('hidden');
    speedEl.innerHTML = `${Math.round(Math.abs(player.car.speed) * 3.6)} <small>km/h</small>`;
  } else speedEl.classList.add('hidden');
  const mission = currentMission(missions);
  const step = currentStep(missions);
  document.getElementById('mission-title').textContent = mission ? mission.title : 'Solmar Bay — all missions done';
  document.getElementById('mission-text').textContent = step ? step.text : 'Free roam. Enjoy the sunset.';
  let dist = '';
  if (step && !step.survive) {
    const px = player.inCar && player.car ? player.car.x : player.x;
    const pz = player.inCar && player.car ? player.car.z : player.z;
    dist = `${Math.round(Math.hypot(step.x - px, step.z - pz))} m to objective`;
  } else if (step && step.survive) {
    dist = `Survive: ${Math.ceil(missions.timer)} s — wanted ${G.wanted}★`;
  } else if (step && step.time !== undefined) {
    dist = `${Math.ceil(missions.timer)} s left`;
  }
  document.getElementById('mission-dist').textContent = dist;
  document.getElementById('crosshair').classList.toggle('hidden', player.inCar);
  drawMinimap();
}

// --- Frames ---
function render() {
  updateCamera(STEP);
  renderer.render(scene, camera);
}

let last = performance.now();
let accumulator = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (G.screen !== 'play') {
    // Title screen: slow cinematic orbit over the city.
    if (G.screen === 'title') {
      const t = now / 1000;
      camera.position.set(Math.sin(t * 0.05) * 150, 70, Math.cos(t * 0.05) * 150);
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    }
    return;
  }
  accumulator += Math.min((now - last) / 1000, MAX_FRAME);
  last = now;
  while (accumulator >= STEP) {
    step(STEP);
    accumulator -= STEP;
    if (G.screen !== 'play') break;
  }
  if (G.screen === 'play') {
    render();
    updateHUD();
  }
}

function runShot(name) {
  stageShot(name, G);
  G.screen = 'play';
  G.started = true;
  hud.classList.remove('hidden');
  document.getElementById('start-screen').classList.add('hidden');
  moveBeacon(beacon, missionTarget(missions), 0);
  updateHUD();
  let painted = 0;
  function paint() {
    render();
    updateHUD();
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

if (shotName) runShot(shotName);
else requestAnimationFrame(frame);
