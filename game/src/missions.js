// Missions — Madame Vela's three jobs for Rico Marlin, chained: finish one to unlock
// the next. Each step has a place to reach (shown by a beacon and the HUD), a time
// limit where it matters, and a cash reward. The last job ends the story.
import * as THREE from 'three';

export const MISSION_REWARDS = [500, 800, 1500];

const DEFINITIONS = [
  {
    title: 'Mission 1 — Sunset Courier',
    steps: [
      { text: 'Pick up the sealed parcel from the Marina kiosk (follow the gold beacon).', x: -160, z: -160, radius: 7 },
      { text: 'Deliver it to the Downtown plaza drop-off before the buyer leaves. Watch the clock.', x: 40, z: 40, radius: 7, time: 150 },
    ],
  },
  {
    title: 'Mission 2 — Hot Wheels',
    steps: [
      { text: 'A yellow Sunset GT is parked by the Port containers. Take it — the owner will not miss it tonight.', x: 76, z: 156, radius: 6, needsCar: true },
      { text: 'Drive the GT to Vela\u2019s garage in the Hills. No scratches, if you can help it.', x: 160, z: -120, radius: 8, needsCar: true },
    ],
  },
  {
    title: 'Mission 3 — Bay Escape',
    steps: [
      { text: 'The Port job drew the whole department. Survive 60 seconds with 3 stars and lose them.', x: 0, z: 0, radius: 999, survive: 60 },
    ],
  },
];

export function createMissions() {
  return { index: 0, step: 0, timer: 0, done: false, failed: false, beacon: null };
}

export function currentMission(missions) {
  if (missions.done || missions.index >= DEFINITIONS.length) return null;
  return DEFINITIONS[missions.index];
}

export function currentStep(missions) {
  const mission = currentMission(missions);
  return mission ? mission.steps[missions.step] : null;
}

export function missionTarget(missions) {
  const step = currentStep(missions);
  return step ? { x: step.x, z: step.z } : null;
}

// ctx: { player, wanted, targetCar, setWanted(n), toast(msg), onReward(amount), onAllDone(), onFail(reason) }.
export function updateMissions(missions, dt, ctx) {
  if (missions.done || missions.failed) return;
  const mission = currentMission(missions);
  if (!mission) return;
  const step = mission.steps[missions.step];
  const px = ctx.player.inCar && ctx.player.car ? ctx.player.car.x : ctx.player.x;
  const pz = ctx.player.inCar && ctx.player.car ? ctx.player.car.z : ctx.player.z;

  if (step.survive) {
    if (missions.timer === 0) {
      missions.timer = step.survive;
      ctx.setWanted(3);
      ctx.toast('The whole department is after you — lose them!');
    }
    missions.timer -= dt;
    if (ctx.wanted === 0) missions.timer -= dt * 2; // losing the heat hurries the escape
    if (missions.timer <= 0) completeStep(missions, ctx, mission);
    return;
  }
  if (step.time !== undefined) {
    if (missions.timer === 0) missions.timer = step.time;
    missions.timer -= dt;
    if (missions.timer <= 0) {
      missions.failed = true;
      ctx.onFail('Too slow — the buyer left. Madame Vela will call again.');
      return;
    }
  }
  if (step.needsCar) {
    if (missions.step === 0) {
      // Step 0 of Hot Wheels: the player must be driving the yellow GT itself.
      if (ctx.player.inCar && ctx.player.car === ctx.targetCar) completeStep(missions, ctx, mission);
    } else if (ctx.player.inCar && ctx.player.car === ctx.targetCar) {
      const d = Math.hypot(step.x - px, step.z - pz);
      if (d < step.radius) completeStep(missions, ctx, mission);
    }
    return;
  }
  const d = Math.hypot(step.x - px, step.z - pz);
  if (d < step.radius) completeStep(missions, ctx, mission);
}

function completeStep(missions, ctx, mission) {
  missions.timer = 0;
  if (missions.step + 1 < mission.steps.length) {
    missions.step += 1;
    ctx.toast('Objective complete — next stop marked.');
    return;
  }
  const reward = MISSION_REWARDS[missions.index];
  ctx.onReward(reward);
  ctx.toast(`${mission.title} complete — +$${reward}`);
  missions.index += 1;
  missions.step = 0;
  if (missions.index >= DEFINITIONS.length) {
    missions.done = true;
    ctx.onAllDone();
  }
}

// The gold beacon marking the current objective: a glowing pillar and a ring on the ground.
export function makeBeacon(scene) {
  const group = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.2, 60, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
  );
  beam.position.y = 30;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3, 4.5, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.15;
  group.add(beam, ring);
  group.visible = false;
  scene.add(group);
  return group;
}

export function moveBeacon(beacon, target, time) {
  if (!target) { beacon.visible = false; return; }
  beacon.visible = true;
  beacon.position.set(target.x, 0, target.z);
  const s = 1 + Math.sin(time * 3) * 0.12;
  beacon.scale.set(s, 1, s);
}
