// Screenshot scenes behind ?shot=cover|city|chase|mission. Each one stages a real
// game state — a live world, real traffic and pedestrians, a real mission and real
// wanted level — then lets the main loop's camera settle on it, so the frame is what
// playing the game actually looks like. The same seed always gives the same frame.
import { updateTrafficCar, newCar } from './vehicles.js';
import { updatePedestrians } from './pedestrians.js';

// Run the traffic and pedestrians forward a little so the street is alive, not frozen.
function settle(G, seconds) {
  const steps = Math.floor(seconds * 60);
  for (let i = 0; i < steps; i += 1) {
    for (const car of G.traffic.cars) {
      if (car !== G.player.car) updateTrafficCar(car, 1 / 60, G.traffic.cars);
    }
    updatePedestrians(G.peds, 1 / 60, G.world, null);
  }
}

function putPlayerInCar(G, car) {
  car.parked = false;
  car.ai = false;
  car.speed = 14;
  G.player.car = car;
  G.player.inCar = true;
  G.player.x = car.x;
  G.player.z = car.z;
  G.player.angle = car.angle;
  G.player.mesh.visible = false;
  // The mesh only follows the logical position in the live loop, which does not
  // run in shot mode — sync it here so the car is where the camera expects it.
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.angle;
}

function placePlayer(G, x, z, angle) {
  if (G.player.inCar && G.player.car) {
    G.player.car.parked = true;
    G.player.car = null;
    G.player.inCar = false;
  }
  G.player.x = x; G.player.z = z; G.player.angle = angle;
  G.player.mesh.visible = true;
  G.player.mesh.position.set(x, 0, z);
  G.player.mesh.rotation.y = angle;
}

// Stage the named scene on the live game object and return it.
export function stageShot(name, G) {
  const scene = name || 'cover';
  G.missions.index = 0;
  G.missions.step = 0;
  G.missions.done = false;
  G.missions.failed = false;
  G.missions.timer = 0;
  G.player.health = 100;
  G.player.ammo = 24;
  G.player.cash = 1250;

  if (scene === 'city') {
    // On foot at the Marina promenade, pedestrians around, mission 1 pointing downtown.
    placePlayer(G, -156, -140, Math.PI * 0.75);
    G.wanted = 0;
    G.missions.index = 0; G.missions.step = 0;
    settle(G, 2);
    return G;
  }
  if (scene === 'chase') {
    // Behind the wheel with 3 stars: two patrol cars closing in on a downtown avenue.
    // The car runs down the x=0 avenue so the trailing camera stays on the road, and
    // the patrol cars come at it head-on down the same avenue, lights flashing.
    const car = G.traffic.cars.find((c) => c.parked) || G.traffic.cars[0];
    car.x = 0; car.z = -40; car.angle = Math.PI;
    putPlayerInCar(G, car);
    G.wanted = 3;
    G.missions.index = 2; G.missions.step = 0; G.missions.timer = 42;
    const cop1 = newCar(G.scene, -3, -72, 0, 0xf0f0f0, 'police', false);
    const cop2 = newCar(G.scene, 4, -82, 0, 0xf0f0f0, 'police', false);
    cop1.speed = 24; cop2.speed = 22;
    G.police.cars.push(cop1, cop2);
    settle(G, 1.5);
    return G;
  }
  if (scene === 'mission') {
    // Mission 2: Rico on foot beside the yellow Sunset GT at the Port, beacon on the garage.
    placePlayer(G, 84, 156, -Math.PI / 2);
    G.wanted = 1;
    G.missions.index = 1; G.missions.step = 0;
    G.player.cash = 500;
    settle(G, 2);
    return G;
  }
  // cover: driving through Downtown at sunset, traffic ahead, 2 stars, mission 1 live.
  const car = G.traffic.cars.find((c) => c.parked) || G.traffic.cars[0];
  car.x = 0; car.z = 80; car.angle = Math.PI;
  putPlayerInCar(G, car);
  G.wanted = 2;
  G.missions.index = 0; G.missions.step = 1;
  const cop = newCar(G.scene, 4, 58, 0, 0xf0f0f0, 'police', false);
  cop.speed = 20;
  G.police.cars.push(cop);
  settle(G, 2);
  return G;
}
