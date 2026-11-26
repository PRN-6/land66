import * as THREE from 'three';
import type { Vec3 } from '../types/world';

interface ParticleItem {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

export class WorldEffects {
  public readonly group = new THREE.Group();
  private particles: ParticleItem[] = [];
  private particleGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  private dropletGeo = new THREE.BoxGeometry(0.07, 0.1, 0.07);
  private dropletMat = new THREE.MeshStandardMaterial({
    color: 0x60a5fa,
    transparent: true,
    opacity: 0.85,
    roughness: 0.1,
  });
  private targetWireframe: THREE.LineSegments;
  private pathGroup = new THREE.Group();
  private pathGeo = new THREE.BoxGeometry(0.18, 0.06, 0.18);
  private pathMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.65,
  });

  constructor(scene: THREE.Scene) {
    this.group.name = 'world_effects';

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.03, 1.03, 1.03));
    this.targetWireframe = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.85 }),
    );
    this.targetWireframe.visible = false;

    this.group.add(this.targetWireframe, this.pathGroup);
    scene.add(this.group);
  }

  public spawnBlockBurst(x: number, y: number, z: number, colorHex: number, count = 7): void {
    const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.8 });
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.particleGeo, mat);
      m.position.set(x + 0.25 + Math.random() * 0.5, y + 0.25 + Math.random() * 0.5, z + 0.25 + Math.random() * 0.5);
      this.group.add(m);
      this.particles.push({
        mesh: m,
        vel: new THREE.Vector3((Math.random() - 0.5) * 2.8, 1.4 + Math.random() * 2.4, (Math.random() - 0.5) * 2.8),
        life: 0,
        maxLife: 0.55 + Math.random() * 0.3,
      });
    }
  }

  public spawnWaterDroplets(origin: THREE.Vector3, count = 2): void {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.dropletGeo, this.dropletMat);
      m.position.set(
        origin.x + (Math.random() - 0.5) * 0.12,
        origin.y,
        origin.z + (Math.random() - 0.5) * 0.12,
      );
      this.group.add(m);
      this.particles.push({
        mesh: m,
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, -0.4, (Math.random() - 0.5) * 0.6),
        life: 0,
        maxLife: 0.45,
      });
    }
  }

  public setTargetBlock(target: Vec3 | null): void {
    if (!target) {
      this.targetWireframe.visible = false;
      return;
    }
    this.targetWireframe.visible = true;
    this.targetWireframe.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
  }

  public setPath(path: Vec3[], show: boolean): void {
    this.pathGroup.visible = show;
    if (!show) return;
    while (this.pathGroup.children.length > 0) {
      this.pathGroup.remove(this.pathGroup.children[0]);
    }
    for (const p of path.slice(0, 24)) {
      const dot = new THREE.Mesh(this.pathGeo, this.pathMat);
      dot.position.set(p.x + 0.5, p.y + 0.05, p.z + 0.5);
      this.pathGroup.add(dot);
    }
  }

  public update(dt: number, elapsed: number): void {
    if (this.targetWireframe.visible) {
      const mat = this.targetWireframe.material as THREE.LineBasicMaterial;
      mat.opacity = 0.55 + Math.sin(elapsed * 5) * 0.3;
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.group.remove(p.mesh);
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= 9.8 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const s = 1 - p.life / p.maxLife;
      p.mesh.scale.setScalar(Math.max(0.05, s));
    }
  }
}
