import * as THREE from 'three';
import gsap from 'gsap';
import { D, H, HUB_GAP, W, makeClaw, makeContainer, makeRail } from './models.js';

const FOV = 24;
const TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
const DOOR_OPEN = THREE.MathUtils.degToRad(106);
const CLAW_SPREAD = THREE.MathUtils.degToRad(24);

// Where each container rests, by item order. sx/sy are viewport fractions (-1..1) at the slot's depth.
const SLOTS_WIDE = [
  { sx: -0.04, sy: -0.27, z: -1.4, rx: 0.3, ry: 0.2, rz: -0.08 }, // PORT FOLIO
  { sx: -0.49, sy: -0.31, z: -1.2, rx: 0.3, ry: -0.3, rz: 0.2 }, // WHAT I DO
  { sx: -0.74, sy: -0.66, z: 1.2, rx: 0.32, ry: 0.28, rz: -0.13 }, // THE WORK
  { sx: -0.27, sy: -0.74, z: 1.6, rx: 0.3, ry: -0.2, rz: 0.1 }, // ABOUT ME
  { sx: 0.2, sy: -0.7, z: 1.5, rx: 0.32, ry: 0.22, rz: -0.1 }, // PROCESS
  { sx: 0.71, sy: -0.68, z: 1.3, rx: 0.3, ry: -0.28, rz: 0.08 }, // TOOL KIT
  { sx: 0.43, sy: -0.32, z: -1.3, rx: 0.3, ry: 0.28, rz: -0.24 }, // SAY HELLO
];
const SLOTS_NARROW = [
  { sx: -0.48, sy: -0.1, z: -1.4, rx: 0.3, ry: 0.2, rz: -0.08 },
  { sx: 0.48, sy: -0.14, z: -1.2, rx: 0.3, ry: -0.26, rz: 0.14 },
  { sx: -0.5, sy: -0.33, z: 0, rx: 0.32, ry: -0.22, rz: 0.1 },
  { sx: 0.49, sy: -0.37, z: 0.2, rx: 0.3, ry: 0.2, rz: -0.1 },
  { sx: -0.46, sy: -0.56, z: 1, rx: 0.32, ry: 0.22, rz: -0.1 },
  { sx: 0.48, sy: -0.59, z: 1.2, rx: 0.3, ry: -0.24, rz: 0.08 },
  { sx: 0, sy: -0.78, z: 2.2, rx: 0.3, ry: 0.14, rz: -0.05 },
];

export class Depot {
  constructor(canvas, items, { onReveal, onConceal, onHover, onFetch, reducedMotion = false }) {
    this.items = items;
    this.onReveal = onReveal;
    this.onConceal = onConceal;
    this.onHover = onHover;
    this.onFetch = onFetch;
    this.reducedMotion = reducedMotion;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    // The camera never pitches, so anything facing it stays a true rectangle
    // and the HTML contents can sit exactly on the container's back wall.
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xa9bbe6, 2.35));
    const sun = new THREE.DirectionalLight(0xfff6e8, 2.3);
    sun.position.set(-10, 24, 22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 80 });
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 5;
    this.scene.add(sun);

    const railKit = makeRail();
    this.railKit = railKit;
    this.scene.add(railKit.rail, railKit.sleeve, railKit.rod);

    const claw = makeClaw();
    this.claw = claw;
    this.scene.add(claw.head);

    this.containers = items.map((item) => {
      const c = makeContainer(item, this.renderer);
      c.item = item;
      c.base = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
      c.pose = { lift: 0, drop: 0 };
      c.held = false;
      c.doorAngle = 0;
      c.hit.userData.container = c;
      this.scene.add(c.group);
      return c;
    });

    // Everything the choreography tweens lives here; tick() turns it into transforms.
    this.rig = { x: 0, y: 0, z: 0, open: 1, qT: 0, swayGain: 1 };
    this.qFrom = new THREE.Quaternion();
    this.qTo = new THREE.Quaternion();
    this.sway = 0;
    this.swayV = 0;
    this.prevRigX = 0;
    this.prevVx = 0;

    this.state = 'idle'; // idle | busy | open
    this.current = null;
    this.pending = undefined;
    this.needsSync = false;
    this.hovered = null;

    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hits = this.containers.map((c) => c.hit);

    this.layout();
    this.rig.x = this.view.width * 0.14;
    this.rig.y = this.idleY;
    this.prevRigX = this.rig.x;

    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.hover(this.pick(e));
    });
    canvas.addEventListener('pointerleave', () => this.hover(null));
    canvas.addEventListener('click', (e) => {
      const c = this.pick(e);
      if (c) this.go(c.item.id);
      else if (this.state === 'open') this.go(null);
    });

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  // ─── Layout ───────────────────────────────────────────────────────────

  layout() {
    const w = innerWidth, h = innerHeight;
    const a = w / h;
    const narrow = a < 1.05;
    this.renderer.setSize(w, h, false);

    const wantWidth = narrow ? 10.8 : 24;
    const camD = Math.max(wantWidth / (2 * TAN * a), 13.5 / (2 * TAN));
    this.camera.aspect = a;
    this.camera.position.set(0, 0, camD);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    const halfH = (z) => TAN * (camD - z);
    const halfW = (z) => halfH(z) * a;
    this.view = { width: halfW(0) * 2, height: halfH(0) * 2 };

    const railFrac = Math.max(70 / h, 0.095);
    const railY = halfH(0) * (1 - 2 * railFrac);
    this.railKit.rail.position.set(0, railY, 0);
    document.documentElement.style.setProperty('--rail-y', `${railFrac * h}px`);
    this.idleY = halfH(0) * (narrow ? 0.34 : 0.28);
    this.hoistY = halfH(0) * 0.12;

    // Stage: hanging close to the camera, sized so the opening is comfortably readable.
    // Squarer screens have height to spare, so the container can hang larger and stay readable.
    const stageFill = narrow ? 0.92 : a < 1.5 ? 0.8 : 0.68;
    const dist = Math.max(W / (2 * TAN * a * stageFill), H / (2 * TAN * 0.6));
    this.stageZ = camD - dist - D / 2;
    const stageTop = railFrac + 0.085;
    const openingHalf = TAN * dist;
    const roof = openingHalf * (1 - 2 * stageTop);
    this.stageY = roof + HUB_GAP;

    (narrow ? SLOTS_NARROW : SLOTS_WIDE).forEach((s, i) => {
      const c = this.containers[i];
      c.base.pos.set(s.sx * halfW(s.z), s.sy * halfH(s.z), s.z);
      c.base.quat.setFromEuler(new THREE.Euler(s.rx, s.ry, s.rz));
      if (!c.held) this.applyRestPose(c);
    });

    if (this.state === 'busy') {
      this.needsSync = true;
    } else {
      this.sync();
    }
  }

  /** Snap the rig to wherever the current state says it belongs under the current layout. */
  sync() {
    this.needsSync = false;
    if (this.state === 'open') {
      Object.assign(this.rig, { x: 0, y: this.stageY, z: this.stageZ });
    } else if (this.state === 'idle') {
      this.rig.y = this.idleY;
      this.rig.x = THREE.MathUtils.clamp(this.rig.x, -this.view.width / 2 + 1, this.view.width / 2 - 1);
    }
    this.prevRigX = this.rig.x;
    this.prevVx = 0;
  }

  applyRestPose(c) {
    c.group.position.copy(c.base.pos);
    c.group.position.y += c.pose.lift + c.pose.drop;
    c.group.quaternion.copy(c.base.quat);
  }

  /** Screen rectangle of the door opening when a container hangs open on stage. */
  stageRect() {
    const z = this.stageZ + D / 2;
    const cy = this.stageY - HUB_GAP - H / 2;
    const hw = W / 2 - 0.13;
    const hh = H / 2 - 0.12;
    const toPx = (x, y) => {
      const v = new THREE.Vector3(x, y, z).project(this.camera);
      return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
    };
    const [l, t] = toPx(-hw, cy + hh);
    const [r, b] = toPx(hw, cy - hh);
    return { left: l, top: t, width: r - l, height: b - t };
  }

  // ─── Pointer ──────────────────────────────────────────────────────────

  pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.camera);
    const hit = this.ray.intersectObjects(this.hits, false).find((h) => !h.object.userData.container.held);
    return hit ? hit.object.userData.container : null;
  }

  hover(c) {
    if (c === this.hovered) return;
    const prev = this.hovered;
    this.hovered = c;
    this.renderer.domElement.style.cursor = c ? 'pointer' : '';
    if (prev && !prev.held) gsap.to(prev.pose, { lift: 0, duration: 0.3, ease: 'power2.out', overwrite: 'auto' });
    if (c) {
      gsap.to(c.pose, { lift: 0.16, duration: 0.3, ease: 'back.out(2)', overwrite: 'auto' });
      // Idle crane drifts along the rail toward whatever you're eyeing.
      if (this.state === 'idle') gsap.to(this.rig, { x: c.base.pos.x, duration: 1.1, ease: 'power2.inOut', overwrite: 'auto' });
    }
    if (this.state === 'idle') this.onHover?.(c ? c.item : null);
  }

  /** Keyboard route into hover, by container id. */
  hoverId(id) {
    this.hover(this.containers.find((c) => c.item.id === id) ?? null);
  }

  // ─── Choreography ─────────────────────────────────────────────────────

  /** Request a container by id, or null to put the current one back. Requests made mid-move queue up. */
  go(id) {
    if (this.state === 'busy') { this.pending = id; return; }
    if (id === (this.current?.item.id ?? null)) return;
    if (this.current) this.putBack(id);
    else this.fetch(id);
  }

  grabPoint(c) {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(c.base.quat);
    return c.base.pos.clone().addScaledVector(up, H / 2 + HUB_GAP);
  }

  timeline(onComplete) {
    const tl = gsap.timeline({ onComplete });
    if (this.reducedMotion) tl.timeScale(5);
    return tl;
  }

  fetch(id) {
    const c = this.containers.find((x) => x.item.id === id);
    if (!c) return;
    this.state = 'busy';
    gsap.killTweensOf(this.rig);
    this.current = c;
    this.onFetch?.(c.item);
    const grab = this.grabPoint(c);
    const { rig } = this;
    const travel = 0.55 + (Math.abs(rig.x - grab.x) / this.view.width) * 1.1;

    const tl = this.timeline(() => this.settle('open'));
    tl.call(() => {
      this.qFrom.identity();
      this.qTo.copy(c.base.quat);
      rig.qT = 0;
      this.hover(null);
    })
      .to(c.pose, { lift: 0, duration: 0.2 }, 0)
      // Along the rail, over the target.
      .to(rig, { open: 1, swayGain: 1, duration: 0.25 }, 0)
      .to(rig, { x: grab.x, y: this.idleY, z: 0, duration: travel, ease: 'power2.inOut' }, 0)
      // Down, with the claw turning to match the way the container is lying.
      .to(rig, { swayGain: 0, duration: 0.35, ease: 'power1.in' }, '-=0.1')
      .to(rig, { y: grab.y, z: grab.z, qT: 1, duration: 0.8, ease: 'power2.inOut' }, '>-0.1')
      // Clamp.
      .to(rig, { open: 0, duration: 0.3, ease: 'power3.in' })
      .call(() => {
        this.claw.head.attach(c.group);
        c.held = true;
      })
      // Up and level.
      .to(rig, { y: this.hoistY, qT: 0, z: 0, duration: 0.85, ease: 'power2.inOut' }, '+=0.06')
      .to(rig, { swayGain: 1, duration: 0.3 }, '<')
      // Across to centre and forward, toward the viewer.
      .to(rig, { x: 0, y: this.stageY, z: this.stageZ, duration: 1.3, ease: 'power2.inOut' }, '>-0.15')
      .to(rig, { swayGain: 0, duration: 0.45, ease: 'power1.inOut' }, '>-0.2')
      // Doors. Contents appear while they swing, once there is a gap to see through.
      .to(c, { doorAngle: DOOR_OPEN, duration: 1, ease: 'back.out(1.25)' }, '>-0.1')
      .call(() => this.onReveal?.(c.item), null, '<0.32');
  }

  putBack(nextId) {
    const c = this.current;
    this.state = 'busy';
    gsap.killTweensOf(this.rig);
    const grab = this.grabPoint(c);
    const { rig } = this;
    this.onConceal?.();
    const switching = nextId != null;

    const tl = this.timeline(() => {
      this.current = null;
      this.settle('idle', nextId);
    });
    if (switching && !this.reducedMotion) tl.timeScale(1.35);

    tl.to(c, { doorAngle: 0, duration: 0.6, ease: 'power2.in' }, 0.12)
      .call(() => {
        this.qFrom.identity();
        this.qTo.copy(c.base.quat);
        rig.qT = 0;
      })
      .to(rig, { swayGain: 1, duration: 0.3 }, '>')
      .to(rig, { x: grab.x, y: this.hoistY, z: 0, duration: 1.2, ease: 'power2.inOut' }, '<')
      .to(rig, { swayGain: 0, duration: 0.3 }, '>-0.15')
      .to(rig, { y: grab.y, z: grab.z, qT: 1, duration: 0.8, ease: 'power2.inOut' }, '>-0.1')
      .call(() => {
        this.scene.attach(c.group);
        c.held = false;
        c.pose.lift = 0;
        this.applyRestPose(c);
      })
      .to(rig, { open: 1, duration: 0.25, ease: 'power2.out' })
      .to(rig, { y: this.idleY, z: 0, qT: 0, duration: 0.65, ease: 'power2.inOut' })
      .to(rig, { swayGain: 1, duration: 0.2 }, '<');
  }

  settle(state, queued) {
    this.state = state;
    if (this.needsSync) this.sync();
    let next = queued;
    if (this.pending !== undefined) { next = this.pending; this.pending = undefined; }
    if (next !== undefined && next !== null && next !== (this.current?.item.id ?? null)) this.go(next);
    else if (next === null && this.current) this.go(null);
  }

  /** Containers tumble in on first load. Requests made meanwhile wait until they've landed. */
  intro() {
    if (this.reducedMotion) return;
    this.state = 'busy';
    this.containers.forEach((c) => (c.pose.drop = this.view.height));
    gsap.to(this.containers.map((c) => c.pose), {
      drop: 0,
      duration: 0.95,
      ease: 'bounce.out',
      stagger: { each: 0.09, from: 'random' },
      delay: 0.1,
      onComplete: () => this.settle('idle'),
    });
  }

  // ─── Frame ────────────────────────────────────────────────────────────

  tick() {
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    const t = this.clock.elapsedTime;
    const { rig, claw, railKit } = this;

    // Pendulum: the trolley's acceleration swings the load, which then rings down.
    if (dt > 0) {
      const vx = (rig.x - this.prevRigX) / dt;
      const ax = (vx - this.prevVx) / dt;
      this.prevRigX = rig.x;
      this.prevVx = vx;
      if (this.reducedMotion) {
        this.sway = 0;
      } else {
        this.swayV += (-34 * this.sway - 3.1 * this.swayV - THREE.MathUtils.clamp(ax, -60, 60) * 0.34) * dt;
        this.sway = THREE.MathUtils.clamp(this.sway + this.swayV * dt, -0.32, 0.32);
      }
    }
    const s = this.sway * rig.swayGain;

    railKit.trolley.position.x = rig.x;
    const length = Math.max(railKit.rail.position.y - rig.y, 0.1);
    const bob = this.state === 'idle' && !this.reducedMotion ? Math.sin(t * 1.3) * 0.035 : 0;
    claw.head.position.set(rig.x + Math.sin(s) * length, rig.y + bob, rig.z);
    claw.head.quaternion.copy(this.qFrom).slerp(this.qTo, rig.qT);
    claw.head.rotateZ(s * 0.65);

    const spread = rig.open * CLAW_SPREAD;
    claw.leftArm.rotation.z = -spread;
    claw.rightArm.rotation.z = spread;
    railKit.update(claw.head.position);

    for (const c of this.containers) {
      c.leftDoor.rotation.y = -c.doorAngle;
      c.rightDoor.rotation.y = c.doorAngle;
      if (!c.held) this.applyRestPose(c);
    }

    this.renderer.render(this.scene, this.camera);
  }
}
