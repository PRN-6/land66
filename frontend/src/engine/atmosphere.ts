import * as THREE from 'three';
import type { Vec3 } from '../types/world';

function lerpColor(a: THREE.Color, b: THREE.Color, t: number, out: THREE.Color): THREE.Color {
  return out.copy(a).lerp(b, Math.max(0, Math.min(1, t)));
}

// Serene pastel diorama sky palette (soft teal-blue sky -> warm peach horizon -> misty teal valley)
const SKY_STOPS = [
  { t: 0.0, top: new THREE.Color('#0c142c'), horizon: new THREE.Color('#23325b'), bottom: new THREE.Color('#131d3b') },
  { t: 0.22, top: new THREE.Color('#344e78'), horizon: new THREE.Color('#c88b87'), bottom: new THREE.Color('#395370') },
  { t: 0.28, top: new THREE.Color('#8db8c8'), horizon: new THREE.Color('#f7d5b6'), bottom: new THREE.Color('#7ca3ad') },
  { t: 0.4, top: new THREE.Color('#8ec3d6'), horizon: new THREE.Color('#f5dfc5'), bottom: new THREE.Color('#7fa9b4') },
  { t: 0.58, top: new THREE.Color('#92c6d9'), horizon: new THREE.Color('#f2dec9'), bottom: new THREE.Color('#82acb7') },
  { t: 0.72, top: new THREE.Color('#6f96b8'), horizon: new THREE.Color('#f5bd90'), bottom: new THREE.Color('#628496') },
  { t: 0.82, top: new THREE.Color('#2d3e66'), horizon: new THREE.Color('#a46a7d'), bottom: new THREE.Color('#263352') },
  { t: 0.9, top: new THREE.Color('#0c142c'), horizon: new THREE.Color('#23325b'), bottom: new THREE.Color('#131d3b') },
  { t: 1.0, top: new THREE.Color('#0c142c'), horizon: new THREE.Color('#23325b'), bottom: new THREE.Color('#131d3b') },
];

export class AtmosphereSystem {
  public readonly group = new THREE.Group();
  public readonly sunLight: THREE.DirectionalLight;
  public readonly rimLight: THREE.DirectionalLight;
  public readonly moonLight: THREE.DirectionalLight;
  public readonly hemiLight: THREE.HemisphereLight;
  public readonly ambientLight: THREE.AmbientLight;

  private skyMat: THREE.ShaderMaterial;
  private hillMat: THREE.MeshBasicMaterial;
  private sunMesh: THREE.Mesh;
  private moonMesh: THREE.Mesh;
  private starPoints: THREE.Points;
  private starMat: THREE.PointsMaterial;
  private clouds: Array<{ mesh: THREE.Group; speed: number; minX: number; maxX: number }> = [];

  private rainPoints: THREE.LineSegments;
  private rainPositions: Float32Array;
  private rainCount = 650;

  private fireflyPoints: THREE.Points;
  private fireflyMat: THREE.PointsMaterial;
  private fireflyCount = 46;
  private fireflyAnchors: Vec3[] = [];
  private fireflyPositions: Float32Array;
  private fireflySeeds: Float32Array;

  private mistPoints: THREE.Points;
  private mistMat: THREE.PointsMaterial;
  private mistCount = 56;
  private mistOrigins: Vec3[] = [];
  private mistPositions: Float32Array;
  private mistAges: Float32Array;

  private torchLights: THREE.PointLight[] = [];
  private waterNormalMap: THREE.Texture | null = null;

  private tmpTop = new THREE.Color();
  private tmpHorizon = new THREE.Color();
  private tmpBottom = new THREE.Color();
  private tmpHill = new THREE.Color();
  private stormTint = new THREE.Color('#5a6a7d');

  constructor(scene: THREE.Scene) {
    this.group.name = 'atmosphere';

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTopColor: { value: new THREE.Color('#8ec3d6') },
        uHorizonColor: { value: new THREE.Color('#f5dfc5') },
        uBottomColor: { value: new THREE.Color('#7fa9b4') },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 uTopColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uBottomColor;
        varying vec3 vWorldPos;
        void main() {
          float h = normalize(vWorldPos - vec3(16.0, 10.0, 16.0)).y;
          vec3 col = h >= 0.0
            ? mix(uHorizonColor, uTopColor, pow(clamp(h, 0.0, 1.0), 0.72))
            : mix(uHorizonColor, uBottomColor, pow(clamp(-h, 0.0, 1.0), 0.45));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const skyDome = new THREE.Mesh(new THREE.SphereGeometry(230, 32, 20), this.skyMat);
    skyDome.position.set(16, 10, 16);
    this.group.add(skyDome);

    // Distant misty layered hill ring surrounding the floating island
    this.hillMat = new THREE.MeshBasicMaterial({
      color: 0x7faab5,
      transparent: true,
      opacity: 0.48,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const hillRingGeo = new THREE.CylinderGeometry(125, 130, 26, 48, 1, true);
    const posAttr = hillRingGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      if (y > 0) {
        const x = posAttr.getX(i);
        const z = posAttr.getZ(i);
        const ang = Math.atan2(z, x);
        const wave = Math.sin(ang * 5) * 7 + Math.cos(ang * 9 + 1.1) * 4.5 + Math.sin(ang * 3) * 5;
        posAttr.setY(i, y + wave);
      }
    }
    hillRingGeo.computeVertexNormals();
    const hillRing = new THREE.Mesh(hillRingGeo, this.hillMat);
    hillRing.position.set(16, -2, 16);
    this.group.add(hillRing);

    // Soft studio-like outdoor diorama illumination
    this.hemiLight = new THREE.HemisphereLight(0xeef6fb, 0x76949f, 0.95);
    this.ambientLight = new THREE.AmbientLight(0xd9e8f0, 0.35);

    this.sunLight = new THREE.DirectionalLight(0xfff5e4, 1.55);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 140;
    const d = 26;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.target.position.set(16, 10, 16);

    this.rimLight = new THREE.DirectionalLight(0xffcf9e, 0.42);
    this.rimLight.position.set(-22, 18, -18);
    this.rimLight.target.position.set(16, 10, 16);

    this.moonLight = new THREE.DirectionalLight(0xa5c4f7, 0.44);
    this.moonLight.target.position.set(16, 10, 16);

    this.group.add(
      this.hemiLight,
      this.ambientLight,
      this.sunLight,
      this.sunLight.target,
      this.rimLight,
      this.rimLight.target,
      this.moonLight,
      this.moonLight.target,
    );

    // Soft round glowing sun & moon discs (matching reference!)
    this.sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(4.8, 20, 16),
      new THREE.MeshBasicMaterial({ color: 0xffe8b5 }),
    );
    this.moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(3.6, 18, 14),
      new THREE.MeshBasicMaterial({ color: 0xe2ecfc }),
    );
    this.group.add(this.sunMesh, this.moonMesh);

    const starPositions = new Float32Array(420 * 3);
    for (let i = 0; i < 420; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.9 + 0.05);
      const r = 180;
      starPositions[i * 3] = 16 + r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = 10 + r * Math.cos(phi);
      starPositions[i * 3 + 2] = 16 + r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xf8fafc, size: 1.25, transparent: true, opacity: 0 });
    this.starPoints = new THREE.Points(starGeo, this.starMat);
    this.group.add(this.starPoints);

    this.buildClouds();

    this.rainPositions = new Float32Array(this.rainCount * 6);
    for (let i = 0; i < this.rainCount; i++) {
      const rx = Math.random() * 44 - 6;
      const ry = Math.random() * 28 + 2;
      const rz = Math.random() * 44 - 6;
      this.rainPositions[i * 6] = rx;
      this.rainPositions[i * 6 + 1] = ry;
      this.rainPositions[i * 6 + 2] = rz;
      this.rainPositions[i * 6 + 3] = rx - 0.1;
      this.rainPositions[i * 6 + 4] = ry - 0.85;
      this.rainPositions[i * 6 + 5] = rz;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
    this.rainPoints = new THREE.LineSegments(
      rainGeo,
      new THREE.LineBasicMaterial({ color: 0xbae6fd, transparent: true, opacity: 0.48 }),
    );
    this.rainPoints.visible = false;
    this.group.add(this.rainPoints);

    this.fireflyPositions = new Float32Array(this.fireflyCount * 3);
    this.fireflySeeds = new Float32Array(this.fireflyCount);
    for (let i = 0; i < this.fireflyCount; i++) {
      this.fireflyPositions[i * 3] = 16 + (Math.random() - 0.5) * 18;
      this.fireflyPositions[i * 3 + 1] = 12 + Math.random() * 4;
      this.fireflyPositions[i * 3 + 2] = 16 + (Math.random() - 0.5) * 18;
      this.fireflySeeds[i] = Math.random() * 100;
    }
    const ffGeo = new THREE.BufferGeometry();
    ffGeo.setAttribute('position', new THREE.BufferAttribute(this.fireflyPositions, 3));
    this.fireflyMat = new THREE.PointsMaterial({
      color: 0xfef08a,
      size: 0.24,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.fireflyPoints = new THREE.Points(ffGeo, this.fireflyMat);
    this.group.add(this.fireflyPoints);

    this.mistPositions = new Float32Array(this.mistCount * 3);
    this.mistAges = new Float32Array(this.mistCount);
    for (let i = 0; i < this.mistCount; i++) {
      this.mistPositions[i * 3] = 16 + (Math.random() - 0.5) * 16;
      this.mistPositions[i * 3 + 1] = 3 - Math.random() * 5;
      this.mistPositions[i * 3 + 2] = 16 + (Math.random() - 0.5) * 16;
      this.mistAges[i] = Math.random();
    }
    const mistGeo = new THREE.BufferGeometry();
    mistGeo.setAttribute('position', new THREE.BufferAttribute(this.mistPositions, 3));
    this.mistMat = new THREE.PointsMaterial({
      color: 0xf1f5f9,
      size: 0.55,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    });
    this.mistPoints = new THREE.Points(mistGeo, this.mistMat);
    this.group.add(this.mistPoints);

    for (let i = 0; i < 6; i++) {
      const pl = new THREE.PointLight(0xffb563, 0, 11, 1.5);
      pl.visible = false;
      this.torchLights.push(pl);
      this.group.add(pl);
    }

    scene.fog = new THREE.FogExp2(0xd9e8ed, 0.0028);
    scene.add(this.group);
  }

  private buildClouds(): void {
    const cloudMat = new THREE.MeshLambertMaterial({
      color: 0xfaf7f2,
      transparent: true,
      opacity: 0.72,
    });
    const puffGeo = new THREE.SphereGeometry(1, 12, 10);

    const configs = [
      { x: -18, y: -6, z: 6, s: 1.4, speed: 0.52 },
      { x: 10, y: -11, z: -14, s: 1.7, speed: 0.4 },
      { x: 38, y: -5, z: 24, s: 1.25, speed: 0.6 },
      { x: -10, y: -9, z: 38, s: 1.55, speed: 0.46 },
      { x: 24, y: -15, z: 12, s: 2.0, speed: 0.32 },
      { x: -28, y: 28, z: -18, s: 1.2, speed: 0.45 },
      { x: 24, y: 31, z: 45, s: 1.35, speed: 0.38 },
    ];

    for (const c of configs) {
      const grp = new THREE.Group();
      const puffs = [
        [0, 0, 0, 2.8, 1.0, 2.0],
        [2.0, 0.25, 0.3, 2.0, 0.9, 1.6],
        [-1.9, 0.15, -0.2, 2.1, 0.85, 1.5],
      ];
      for (const [bx, by, bz, sx, sy, sz] of puffs) {
        const m = new THREE.Mesh(puffGeo, cloudMat);
        m.position.set(bx, by, bz);
        m.scale.set(sx, sy, sz);
        grp.add(m);
      }
      grp.position.set(c.x, c.y, c.z);
      grp.scale.setScalar(c.s);
      this.group.add(grp);
      this.clouds.push({ mesh: grp, speed: c.speed, minX: -55, maxX: 85 });
    }
  }

  public setWaterNormalMap(tex: THREE.Texture): void {
    this.waterNormalMap = tex;
  }

  public setWorldAnchors(torches: Vec3[], foliage: Vec3[], mistOrigins: Vec3[]): void {
    for (let i = 0; i < this.torchLights.length; i++) {
      const pl = this.torchLights[i];
      if (i < torches.length) {
        pl.position.set(torches[i].x, torches[i].y, torches[i].z);
        pl.visible = true;
      } else {
        pl.visible = false;
      }
    }
    this.fireflyAnchors = foliage;
    this.mistOrigins = mistOrigins;
  }

  public update(dt: number, elapsed: number, timeOfDay: number, weather: string, scene: THREE.Scene): void {
    const t = ((timeOfDay % 1) + 1) % 1;
    let s0 = SKY_STOPS[0];
    let s1 = SKY_STOPS[SKY_STOPS.length - 1];
    for (let i = 0; i < SKY_STOPS.length - 1; i++) {
      if (t >= SKY_STOPS[i].t && t <= SKY_STOPS[i + 1].t) {
        s0 = SKY_STOPS[i];
        s1 = SKY_STOPS[i + 1];
        break;
      }
    }
    const span = Math.max(0.0001, s1.t - s0.t);
    const k = (t - s0.t) / span;

    lerpColor(s0.top, s1.top, k, this.tmpTop);
    lerpColor(s0.horizon, s1.horizon, k, this.tmpHorizon);
    lerpColor(s0.bottom, s1.bottom, k, this.tmpBottom);

    const isRain = weather === 'rain' || weather === 'storm';
    if (isRain) {
      const mix = weather === 'storm' ? 0.58 : 0.36;
      this.tmpTop.lerp(this.stormTint, mix);
      this.tmpHorizon.lerp(this.stormTint, mix);
      this.tmpBottom.lerp(this.stormTint, mix);
    }

    this.skyMat.uniforms.uTopColor.value.copy(this.tmpTop);
    this.skyMat.uniforms.uHorizonColor.value.copy(this.tmpHorizon);
    this.skyMat.uniforms.uBottomColor.value.copy(this.tmpBottom);

    this.tmpHill.copy(this.tmpBottom).lerp(this.tmpHorizon, 0.28);
    this.hillMat.color.copy(this.tmpHill);

    if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.color.copy(this.tmpHorizon);
      scene.fog.density = isRain ? 0.0062 : 0.0026;
    }

    const sunAngle = (t - 0.25) * Math.PI * 2;
    const orbitR = 72;
    const sunX = 16 + Math.cos(sunAngle) * orbitR;
    const sunY = 10 + Math.sin(sunAngle) * orbitR;
    const sunZ = 16 + Math.cos(sunAngle * 0.5) * 18;

    this.sunLight.position.set(sunX, sunY, sunZ);
    this.sunMesh.position.set(
      16 + Math.cos(sunAngle) * 145,
      10 + Math.sin(sunAngle) * 145,
      16 + Math.cos(sunAngle * 0.5) * 32,
    );

    const moonAngle = sunAngle + Math.PI;
    this.moonLight.position.set(
      16 + Math.cos(moonAngle) * orbitR,
      10 + Math.sin(moonAngle) * orbitR,
      16 - Math.cos(sunAngle * 0.5) * 18,
    );
    this.moonMesh.position.set(
      16 + Math.cos(moonAngle) * 140,
      10 + Math.sin(moonAngle) * 140,
      16 - Math.cos(sunAngle * 0.5) * 30,
    );

    const daylight = Math.max(0, Math.sin(sunAngle));
    const rainDim = isRain ? 0.65 : 1.0;

    const goldenFactor = Math.max(0, 1 - Math.abs(daylight - 0.25) * 3.0) * (daylight > 0.02 ? 1 : 0);
    this.sunLight.color.setRGB(1.0, 0.96 - goldenFactor * 0.12, 0.9 - goldenFactor * 0.26);
    this.sunLight.intensity = daylight * 1.5 * rainDim;
    this.sunMesh.visible = sunY > -15 && !isRain;
    this.moonMesh.visible = 10 + Math.sin(moonAngle) * orbitR > -15;
    this.moonLight.intensity = Math.max(0, Math.sin(moonAngle)) * 0.45;

    this.rimLight.position.set(32 - sunX + 16, Math.max(14, sunY * 0.6), 32 - sunZ + 16);
    this.rimLight.intensity = (0.24 + goldenFactor * 0.58) * rainDim;

    this.hemiLight.intensity = 0.42 + daylight * 0.62 * rainDim;
    this.ambientLight.intensity = 0.3 + daylight * 0.22;

    const nightOpacity = Math.max(0, Math.min(1, (0.28 - daylight) * 4)) * (isRain ? 0.15 : 0.9);
    this.starMat.opacity = nightOpacity;
    this.starPoints.visible = nightOpacity > 0.02;

    if (this.waterNormalMap) {
      this.waterNormalMap.offset.x = (this.waterNormalMap.offset.x + dt * 0.04) % 1;
      this.waterNormalMap.offset.y = (this.waterNormalMap.offset.y + dt * 0.025) % 1;
    }

    const torchStrength = 1.6 + (1 - daylight) * 2.3;
    for (let i = 0; i < this.torchLights.length; i++) {
      const pl = this.torchLights[i];
      if (pl.visible) {
        pl.intensity = torchStrength + Math.sin(elapsed * 12 + i * 2.1) * 0.25;
      }
    }

    const fireflyVisibility = Math.max(0, Math.min(1, (0.34 - daylight) * 3.5)) * (isRain ? 0.1 : 0.85);
    this.fireflyPoints.visible = fireflyVisibility > 0.02;
    if (this.fireflyPoints.visible) {
      this.fireflyMat.opacity = fireflyVisibility * (0.65 + Math.sin(elapsed * 4.5) * 0.35);
      for (let i = 0; i < this.fireflyCount; i++) {
        const s = this.fireflySeeds[i];
        const anchor =
          this.fireflyAnchors.length > 0
            ? this.fireflyAnchors[i % this.fireflyAnchors.length]
            : { x: 16, y: 12, z: 16 };
        this.fireflyPositions[i * 3] = anchor.x + Math.sin(elapsed * 0.9 + s) * 1.4;
        this.fireflyPositions[i * 3 + 1] = anchor.y + 0.5 + Math.sin(elapsed * 1.4 + s * 1.7) * 0.65;
        this.fireflyPositions[i * 3 + 2] = anchor.z + Math.cos(elapsed * 0.8 + s * 1.3) * 1.4;
      }
      this.fireflyPoints.geometry.attributes.position.needsUpdate = true;
    }

    this.mistMat.opacity = 0.16 + daylight * 0.06;
    for (let i = 0; i < this.mistCount; i++) {
      this.mistAges[i] += dt * 0.22;
      if (this.mistAges[i] >= 1) {
        this.mistAges[i] = 0;
        const origin =
          this.mistOrigins.length > 0
            ? this.mistOrigins[i % this.mistOrigins.length]
            : { x: 16 + (Math.random() - 0.5) * 14, y: 5, z: 16 + (Math.random() - 0.5) * 14 };
        this.mistPositions[i * 3] = origin.x + (Math.random() - 0.5) * 1.6;
        this.mistPositions[i * 3 + 1] = origin.y;
        this.mistPositions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 1.6;
      } else {
        this.mistPositions[i * 3] += dt * 0.28;
        this.mistPositions[i * 3 + 1] -= dt * 1.0;
      }
    }
    this.mistPoints.geometry.attributes.position.needsUpdate = true;

    for (const c of this.clouds) {
      c.mesh.position.x += c.speed * dt;
      if (c.mesh.position.x > c.maxX) {
        c.mesh.position.x = c.minX;
      }
    }

    this.rainPoints.visible = isRain;
    if (isRain) {
      const fallSpeed = weather === 'storm' ? 28 : 19;
      for (let i = 0; i < this.rainCount; i++) {
        const i6 = i * 6;
        this.rainPositions[i6 + 1] -= fallSpeed * dt;
        this.rainPositions[i6 + 4] -= fallSpeed * dt;
        this.rainPositions[i6] -= 2.2 * dt;
        this.rainPositions[i6 + 3] -= 2.2 * dt;
        if (this.rainPositions[i6 + 1] < 0) {
          const rx = Math.random() * 44 - 6;
          const ry = 28 + Math.random() * 6;
          const rz = Math.random() * 44 - 6;
          this.rainPositions[i6] = rx;
          this.rainPositions[i6 + 1] = ry;
          this.rainPositions[i6 + 2] = rz;
          this.rainPositions[i6 + 3] = rx - 0.12;
          this.rainPositions[i6 + 4] = ry - 0.95;
          this.rainPositions[i6 + 5] = rz;
        }
      }
      this.rainPoints.geometry.attributes.position.needsUpdate = true;
    }
  }
}
