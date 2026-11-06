import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Container proportions, in world units.
export const W = 4.6;
export const H = 1.85;
export const D = 1.6;
// How far the claw's hub sits above a gripped container's roof.
export const HUB_GAP = 0.17;

const STEEL = 0xe4e1d8;
const POLE = 0xb9bcc0;

/**
 * A ribbed steel sheet: width on X, height on Y, outer face toward +Z.
 * Ribs are real geometry so the light catches them from every angle.
 */
function ribbedSheet(width, height, ribs, depth = 0.045, thickness = 0.03) {
  const pitch = width / ribs;
  const outer = [];
  for (let i = 0; i < ribs; i++) {
    const x = -width / 2 + i * pitch;
    outer.push([x, 0], [x + pitch * 0.14, 0], [x + pitch * 0.3, depth], [x + pitch * 0.7, depth], [x + pitch * 0.86, 0]);
  }
  outer.push([width / 2, 0]);

  const shape = new THREE.Shape();
  outer.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  [...outer].reverse().forEach(([x, z]) => shape.lineTo(x, -(z - thickness)));
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1 });
  geo.rotateX(-Math.PI / 2); // extrusion now runs along +Y, shape's -y along +Z
  geo.translate(0, -height / 2, 0);
  geo.deleteAttribute('uv');
  return geo;
}

function box(w, h, d, x = 0, y = 0, z = 0) {
  // Non-indexed like the extruded sheets, so the two can be merged together.
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  g.deleteAttribute('uv');
  return g;
}

function buildSharedGeometry() {
  const inset = 0.05;
  const hw = W / 2, hh = H / 2, hd = D / 2;

  const back = ribbedSheet(W, H, 30); back.rotateY(Math.PI); back.translate(0, 0, -hd + inset);
  const left = ribbedSheet(D, H, 12); left.rotateY(-Math.PI / 2); left.translate(-hw + inset, 0, 0);
  const right = ribbedSheet(D, H, 12); right.rotateY(Math.PI / 2); right.translate(hw - inset, 0, 0);
  const top = ribbedSheet(W, D, 30); top.rotateX(-Math.PI / 2); top.translate(0, hh - inset, 0);
  const floor = box(W, 0.05, D, 0, -hh + 0.03, 0);
  const shell = mergeGeometries([back, left, right, top, floor]);

  // Corner posts, long rails and the castings at each corner.
  const t = 0.1;
  const frameParts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    frameParts.push(box(t, H, t, sx * (hw - t / 2), 0, sz * (hd - t / 2)));
  }
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) frameParts.push(box(W, t, t, 0, sy * (hh - t / 2), sz * (hd - t / 2)));
    for (const sx of [-1, 1]) frameParts.push(box(t, t, D, sx * (hw - t / 2), sy * (hh - t / 2), 0));
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    frameParts.push(box(0.17, 0.13, 0.17, sx * (hw - 0.075), sy * (hh - 0.055), sz * (hd - 0.075)));
  }
  const frame = mergeGeometries(frameParts);

  // Dark lining, so an open container reads as a deep, shadowy room.
  // It stops just behind the door plane so it can't poke through closed doors.
  const lin = 0.11;
  const deep = D - 0.2;
  const shift = -0.1;
  const liningBack = ribbedSheet(W - lin * 2, H - lin * 2, 26, 0.05); liningBack.translate(0, 0, -hd + lin);
  const liningL = ribbedSheet(deep, H - lin * 2, 9, 0.04); liningL.rotateY(Math.PI / 2); liningL.translate(-hw + lin, 0, shift);
  const liningR = ribbedSheet(deep, H - lin * 2, 9, 0.04); liningR.rotateY(-Math.PI / 2); liningR.translate(hw - lin, 0, shift);
  const liningTop = box(W - lin, 0.02, deep, 0, hh - lin, shift);
  const liningFloor = ribbedSheet(W - lin * 2, deep, 26, 0.03); liningFloor.rotateX(-Math.PI / 2); liningFloor.translate(0, -hh + lin, shift);
  const lining = mergeGeometries([liningBack, liningL, liningR, liningTop, liningFloor]);

  // One door, hinged at x=0, closed along +X. The right door is a mirrored copy.
  const dw = W / 2 - 0.1;
  const dh = H - 0.2;
  const doorSheet = ribbedSheet(dw, dh, 14, 0.04, 0.035);
  doorSheet.translate(dw / 2, 0, 0);
  const door = mergeGeometries([
    doorSheet,
    box(dw, 0.05, 0.05, dw / 2, dh / 2 - 0.025, 0.01),
    box(dw, 0.05, 0.05, dw / 2, -dh / 2 + 0.025, 0.01),
    box(0.05, dh, 0.05, dw - 0.025, 0, 0.01),
    box(0.05, dh, 0.05, 0.025, 0, 0.01),
  ]);

  const rodGeo = new THREE.CylinderGeometry(0.014, 0.014, dh, 6).toNonIndexed();
  rodGeo.deleteAttribute('uv');
  const rodA = rodGeo.clone(); rodA.translate(dw * 0.9, 0, 0.06);
  const rodB = rodGeo.clone(); rodB.translate(dw * 0.62, 0, 0.06);
  const handle = box(0.03, 0.2, 0.03, dw * 0.9, -0.1, 0.085);
  const rods = mergeGeometries([rodA, rodB, handle]);

  return { shell, frame, lining, door, rods, dw, dh, hit: new THREE.BoxGeometry(W, H, D) };
}

let shared;

function labelTexture(lines, renderer) {
  const c = document.createElement('canvas');
  c.width = 720; c.height = 440;
  const ctx = c.getContext('2d');
  const size = 138;
  ctx.font = `900 expanded ${size}px "Archivo Variable", "Arial Black", sans-serif`;
  ctx.fillStyle = '#f6f2e8';
  ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '-5px';
  lines.forEach((line, i) => ctx.fillText(line, 8, 180 + i * (size * 0.94)));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

function plateTexture(number, renderer) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f6f2e8';
  ctx.textAlign = 'right';
  ctx.font = `800 expanded 44px "Archivo Variable", sans-serif`;
  ctx.fillText(number, 248, 56);
  ctx.font = `700 expanded 26px "Archivo Variable", sans-serif`;
  ctx.fillText('OM GUPTA', 248, 100);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

const liningMat = new THREE.MeshStandardMaterial({ color: 0x1b1e25, roughness: 0.85, metalness: 0 });

/** Returns a container with hinged doors. Local origin is its centre; doors face +Z. */
export function makeContainer(item, renderer) {
  shared ??= buildSharedGeometry();
  const body = new THREE.MeshStandardMaterial({ color: item.color, roughness: 0.62, metalness: 0.02 });
  const edge = new THREE.MeshStandardMaterial({
    color: new THREE.Color(item.color).multiplyScalar(0.78), roughness: 0.6, metalness: 0.02,
  });

  const group = new THREE.Group();
  const add = (geo, mat, parent = group, shadows = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    parent.add(m);
    return m;
  };
  add(shared.shell, body);
  add(shared.frame, edge);
  add(shared.lining, liningMat, group, false);

  const hinge = W / 2 - 0.1;
  const hingeZ = D / 2 - 0.04;

  const leftDoor = new THREE.Group();
  leftDoor.position.set(-hinge, 0, hingeZ);
  add(shared.door, body, leftDoor);
  add(shared.rods, edge, leftDoor, false);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(2.05, 1.253),
    new THREE.MeshBasicMaterial({ map: labelTexture(item.label, renderer), transparent: true, depthWrite: false }),
  );
  label.position.set(1.14, 0.03, 0.09);
  leftDoor.add(label);
  group.add(leftDoor);

  const rightDoor = new THREE.Group();
  rightDoor.position.set(hinge, 0, hingeZ);
  const mirrored = new THREE.Group();
  mirrored.scale.x = -1; // same door, flipped to extend toward -X from its hinge
  add(shared.door, body, mirrored);
  add(shared.rods, edge, mirrored, false);
  rightDoor.add(mirrored);
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.46, 0.23),
    new THREE.MeshBasicMaterial({ map: plateTexture(item.number, renderer), transparent: true, depthWrite: false }),
  );
  plate.position.set(-0.36, -0.58, 0.09);
  rightDoor.add(plate);
  group.add(rightDoor);

  // Invisible but still raycastable: simpler and steadier than testing every rib.
  const hit = new THREE.Mesh(shared.hit, new THREE.MeshBasicMaterial({ visible: false }));
  group.add(hit);

  return { group, leftDoor, rightDoor, hit };
}

/** Claw hub with two rigid L-shaped arms that pivot at the hub. */
export function makeClaw() {
  const mat = new THREE.MeshStandardMaterial({ color: STEEL, roughness: 0.55, metalness: 0.05 });
  const head = new THREE.Group();

  const hub = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.22, 0.3, 3, 0.05), mat);
  hub.castShadow = true;
  head.add(hub);
  const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), new THREE.MeshStandardMaterial({ color: 0xa8abaf, roughness: 0.4 }));
  bolt.position.set(0, 0, 0.16);
  head.add(bolt);

  const reach = W / 2 + 0.07;
  const fingerLen = HUB_GAP + 0.85;
  const makeArm = (side) => {
    const arm = new THREE.Group();
    const bar = new THREE.Mesh(new RoundedBoxGeometry(reach + 0.05, 0.1, 0.14, 2, 0.03), mat);
    bar.position.x = (side * (reach + 0.05)) / 2;
    const finger = new THREE.Mesh(new RoundedBoxGeometry(0.1, fingerLen, 0.14, 2, 0.03), mat);
    finger.position.set(side * reach, -fingerLen / 2 + 0.05, 0);
    const pad = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.2, 0.16, 2, 0.03), mat);
    pad.position.set(side * (reach - 0.06), -fingerLen + 0.15, 0);
    for (const m of [bar, finger, pad]) { m.castShadow = true; arm.add(m); }
    head.add(arm);
    return arm;
  };
  return { head, leftArm: makeArm(-1), rightArm: makeArm(1) };
}

/** Overhead rail, sliding trolley and the telescoping pole between trolley and claw. */
export function makeRail() {
  const steel = new THREE.MeshStandardMaterial({ color: STEEL, roughness: 0.55, metalness: 0.05 });
  const poleMat = new THREE.MeshStandardMaterial({ color: POLE, roughness: 0.32, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0xa8abaf, roughness: 0.4 });

  const rail = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.BoxGeometry(120, 0.085, 0.14), steel);
  rail.add(beam);
  const rivets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.022, 8, 6), dark, 100);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 100; i++) {
    m.setPosition(-60 + i * 1.2, 0, 0.075);
    rivets.setMatrixAt(i, m);
  }
  rail.add(rivets);

  const trolley = new THREE.Group();
  const block = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.28, 0.26, 3, 0.06), steel);
  trolley.add(block);
  for (const x of [-0.2, 0.2]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), dark);
    b.position.set(x, 0, 0.13);
    trolley.add(b);
  }
  rail.add(trolley);

  // Unit-length cylinders hanging from their top end; update() stretches and aims them.
  const unit = (r) => {
    const g = new THREE.CylinderGeometry(r, r, 1, 18);
    g.translate(0, -0.5, 0);
    return g;
  };
  const sleeve = new THREE.Mesh(unit(0.052), poleMat);
  const rod = new THREE.Mesh(unit(0.034), poleMat);
  sleeve.castShadow = rod.castShadow = true;

  const down = new THREE.Vector3(0, -1, 0);
  const dir = new THREE.Vector3();
  const top = new THREE.Vector3();
  const update = (headPos) => {
    top.set(trolley.position.x, rail.position.y, 0);
    dir.subVectors(headPos, top);
    const len = dir.length();
    dir.normalize();
    // The up-axis of each cylinder points back at the trolley.
    for (const seg of [sleeve, rod]) {
      seg.position.copy(top);
      seg.quaternion.setFromUnitVectors(down, dir);
    }
    sleeve.scale.y = Math.min(len, Math.max(len * 0.45, 0.4));
    rod.scale.y = len;
  };

  return { rail, trolley, sleeve, rod, update };
}
