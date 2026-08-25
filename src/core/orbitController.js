// src/core/orbitController.js
//
// Refactored into a class: it owns a camera + OrbitControls pair for its
// entire lifetime and exposes update()/handleResize() methods meant to be
// called every frame -- state-plus-repeated-methods is exactly what a
// class models better than a closure-returning factory.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export class OrbitCameraController {
  constructor(domElement, options = {}) {
    const {
      fov = 40,
      near = 1,
      far = 1000,
      position = [0, 1, -5],
      target = [0, 1, 0],
      enableDamping = true,
      minPolarAngle = 0.01,
      maxPolarAngle = Math.PI / 2,
      minDistance = 1,
      maxDistance = 24,
      autoRotateSpeed = 6,
      enablePan = false,
    } = options;

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      fov,
      window.innerWidth / window.innerHeight,
      near,
      far,
    );
    this.camera.position.set(...position);

    // Controls
    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.target.set(...target);
    this.controls.enableDamping = enableDamping;
    this.controls.minPolarAngle = minPolarAngle;
    this.controls.maxPolarAngle = maxPolarAngle;
    this.controls.minDistance = minDistance;
    this.controls.maxDistance = maxDistance;
    this.controls.autoRotateSpeed = autoRotateSpeed;
    this.controls.enablePan = enablePan;
  }

  update() {
    this.controls.update();
  }

  handleResize(width, height) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}

// Thin factory wrapper for drop-in compatibility with code that still
// calls createOrbitController(...) instead of `new OrbitCameraController(...)`.
export function createOrbitController(domElement, options = {}) {
  return new OrbitCameraController(domElement, options);
}
