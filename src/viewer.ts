import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PartMesh } from './engine/protocol';

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Z-up 3D preview: the XY grid is the print bed. */
export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
  private controls: OrbitControls;
  private model = new THREE.Group();
  private bed = new THREE.Group();
  private material = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
  // For parts that carry a picture: each vertex has its own brightness.
  private pictureMaterial = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, side: THREE.DoubleSide, vertexColors: true });
  private edgeMaterial = new THREE.LineBasicMaterial();
  private frameMaterial = new THREE.LineBasicMaterial();
  private bounds = new THREE.Box3();
  private needsRender = true;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => (this.needsRender = true));

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-0.6, -1, 1.4);
    const fill = new THREE.DirectionalLight(0xffffff, 0.9);
    fill.position.set(1, 0.6, 0.4);
    // Lights ride with the camera so the lit side always faces the viewer.
    this.camera.add(key, fill);
    this.scene.add(this.camera, new THREE.HemisphereLight(0xffffff, 0x8a8f98, 1.1), this.bed, this.model);

    new ResizeObserver(() => this.resize()).observe(container);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
    this.applyTheme();
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      if (!this.needsRender) return;
      this.needsRender = false;
      this.renderer.render(this.scene, this.camera);
    });
  }

  applyTheme() {
    this.material.color.set(css('--model'));
    this.edgeMaterial.color.set(css('--model-edge'));
    this.frameMaterial.color.set(css('--accent'));
    this.drawBed();
    this.needsRender = true;
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  private frame: [number, number] | undefined;

  private drawBed() {
    for (const child of [...this.bed.children]) {
      this.bed.remove(child);
      (child as THREE.LineSegments).geometry?.dispose();
    }
    const size = this.bounds.isEmpty() ? new THREE.Vector3(200, 200, 0) : this.bounds.getSize(new THREE.Vector3());
    const extent = Math.max(200, Math.ceil((Math.max(size.x, size.y) * 1.5) / 100) * 100);
    const grid = new THREE.GridHelper(extent, extent / 10, css('--grid-strong'), css('--grid'));
    grid.rotation.x = Math.PI / 2;
    const centre = this.bounds.isEmpty() ? new THREE.Vector3() : this.bounds.getCenter(new THREE.Vector3());
    grid.position.set(Math.round(centre.x / 10) * 10, Math.round(centre.y / 10) * 10, -0.02);
    this.bed.add(grid);

    if (this.frame) {
      const [w, d] = this.frame;
      const pts = [[-w, -d], [w, -d], [w, d], [-w, d], [-w, -d]].map(([x, y]) => new THREE.Vector3(x / 2, y / 2, 0.05));
      this.bed.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), this.frameMaterial));
    }
  }

  private parts: PartMesh[] = [];
  private assembled = false;

  /** Show parts where they belong in the finished assembly instead of laid out for printing. */
  setAssembled(on: boolean) {
    this.assembled = on;
    this.show(this.parts, this.frame);
  }

  /** Replace the displayed model without moving the camera. */
  show(parts: PartMesh[], frame?: [number, number]) {
    this.parts = parts;
    for (const child of [...this.model.children]) {
      this.model.remove(child);
      (child as THREE.Mesh).geometry.dispose();
    }
    for (const part of parts) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(part.vertices, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(part.triangles, 1));
      if (part.shade) {
        // The warm white of a lit lithophane
        const colours = new Float32Array(3 * part.shade.length);
        for (let i = 0; i < part.shade.length; i++) {
          // Display brightness to the linear light the renderer works in, dimmed to leave room for the lamps.
          const v = 0.62 * part.shade[i] ** 2.2;
          colours.set([v, v * 0.94, v * 0.82], 3 * i);
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
      }
      const edges = new THREE.BufferGeometry();
      edges.setAttribute('position', new THREE.BufferAttribute(part.edges, 3));
      const fitted = this.assembled ? part.assembled : undefined;
      for (const [x, y, z, turn = 0] of fitted ? [fitted.offset] : part.instances) {
        const mesh = new THREE.Mesh(geometry, part.shade ? this.pictureMaterial : this.material);
        const lines = new THREE.LineSegments(edges, this.edgeMaterial);
        for (const object of [mesh, lines]) {
          object.position.set(x, y, z);
          if (fitted?.flip) object.rotation.y = Math.PI;
          object.rotation.z = (turn * Math.PI) / 180;
        }
        this.model.add(mesh, lines);
      }
    }
    this.bounds.setFromObject(this.model);
    this.frame = frame;
    this.drawBed();
    this.needsRender = true;
  }

  /** Frame the whole model from the front-left, slightly above. */
  fit() {
    if (this.bounds.isEmpty()) return;
    const sphere = this.bounds.getBoundingSphere(new THREE.Sphere());
    const fov = (this.camera.fov * Math.PI) / 180;
    const fitFov = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect));
    const distance = (sphere.radius / Math.sin(fitFov / 2)) * 1.05;
    const dir = new THREE.Vector3(-0.55, -1, 0.7).normalize();
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, distance);
    this.camera.near = Math.max(0.5, distance / 200);
    this.camera.far = distance * 20;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  /** Size of the displayed model in mm. */
  size(): [number, number, number] | null {
    if (this.bounds.isEmpty()) return null;
    const s = this.bounds.getSize(new THREE.Vector3());
    return [s.x, s.y, s.z];
  }
}
