"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import {
  applyMaterialToMeshesByName,
  createShirtOnlyMaterial,
  loadTexture,
} from "@/lib/robloxClothing";
import type { ShirtTextureSnapshot } from "@/lib/shirtTexture";

interface AvatarViewerProps {
  heightPx?: number;
  shirtTexture?: ShirtTextureSnapshot | null;
}

const VIEWPORT_ASPECT = 4 / 5;
const MODEL_HEIGHT = 2.7;

function composeFaceTexture(src: THREE.Texture): THREE.Texture | null {
  const image = src.image as CanvasImageSource & { width?: number; height?: number };
  const width = image?.width;
  const height = image?.height;
  if (!image || !width || !height) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = src.flipY;
  texture.needsUpdate = true;
  return texture;
}

export default function AvatarViewer({ heightPx = 760, shirtTexture = null }: AvatarViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const loadedRootRef = useRef<THREE.Object3D | null>(null);
  const latestShirtTextureRef = useRef<ShirtTextureSnapshot | null>(shirtTexture);
  const shirtCanvasTextureRef = useRef<THREE.CanvasTexture | null>(null);
  const shirtMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const [displayHeightPx, setDisplayHeightPx] = useState(heightPx);
  const [viewerError, setViewerError] = useState<string | null>(null);

  const applyShirtTexture = useCallback((snapshot: ShirtTextureSnapshot | null) => {
    latestShirtTextureRef.current = snapshot;
    const model = loadedRootRef.current;
    if (!snapshot || !model) return;

    let texture = shirtCanvasTextureRef.current;
    if (!texture || texture.image !== snapshot.canvas) {
      texture?.dispose();
      texture = new THREE.CanvasTexture(snapshot.canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = true;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      shirtCanvasTextureRef.current = texture;
    }
    texture.needsUpdate = true;

    let material = shirtMaterialRef.current;
    if (!material) {
      material = createShirtOnlyMaterial(texture);
      shirtMaterialRef.current = material;
    } else {
      material.uniforms.texture_shirt.value = texture;
      material.needsUpdate = true;
    }
    applyMaterialToMeshesByName(model, material, /(torso|leftarm|rightarm)/i);
  }, []);

  useEffect(() => {
    applyShirtTexture(shirtTexture);
  }, [applyShirtTexture, shirtTexture]);

  useEffect(() => {
    const updateSize = () => {
      const viewportHeight = window.innerHeight - 64;
      const viewportWidth = window.innerWidth - 32;
      const maxHeightFromWidth = viewportWidth / VIEWPORT_ASPECT;
      setDisplayHeightPx(Math.max(320, Math.min(heightPx, viewportHeight, maxHeightFromWidth)));
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, [heightPx]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const probe = document.createElement("canvas");
    if (!probe.getContext("webgl2")) {
      setViewerError("3D preview needs WebGL. The 2D shirt editor is still available.");
      return;
    }
    setViewerError(null);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    );
    camera.position.set(-4.2, 4.2, -4.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0xc3c3c3, 1);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 2.2;
    controls.maxDistance = 8;
    controls.target.set(0, 0, 0);
    controls.update();

    scene.add(new THREE.AmbientLight(0xffffff, 1.8));

    const hemi = new THREE.HemisphereLight(0xffffff, 0xcfcfcf, 1.35);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(4, 6, 5);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xffffff, 0.9);
    fill.position.set(-4, 3, -3);
    scene.add(fill);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(7, 64),
      new THREE.MeshStandardMaterial({ color: 0xc9c9c9, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    scene.add(ground);

    const fitModel = (model: THREE.Object3D) => {
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      const scale = MODEL_HEIGHT / Math.max(size.y, 0.001);
      model.scale.setScalar(scale);

      const scaledBox = new THREE.Box3().setFromObject(model);
      const scaledCenter = new THREE.Vector3();
      scaledBox.getCenter(scaledCenter);
      model.position.x -= scaledCenter.x;
      model.position.z -= scaledCenter.z;
      model.position.y -= scaledBox.min.y;
    };

    const objectLoader = new OBJLoader();
    objectLoader.setPath("/assets/r6/");
    objectLoader.load(
      "clothCompatBlockR6.obj",
      async (model) => {
        const whiteMaterial = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.55,
          metalness: 0,
        });

        let headTexture: THREE.Texture | null = null;
        try {
          const sourceHeadTexture = await loadTexture("/assets/r6/Dummyr61_fulldiff.png", {
            flipY: true,
          });
          headTexture = composeFaceTexture(sourceHeadTexture) || sourceHeadTexture;
        } catch {}

        model.traverse((object: THREE.Object3D) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.castShadow = false;
          object.receiveShadow = false;

          const meshName = (object.name || "").toLowerCase();
          if (meshName.includes("head") && headTexture) {
            object.material = new THREE.MeshStandardMaterial({
              color: 0xffffff,
              map: headTexture,
              roughness: 0.6,
              metalness: 0,
            });
            return;
          }

          object.material = whiteMaterial.clone();
        });

        fitModel(model);
        loadedRootRef.current = model;
        scene.add(model);
        applyShirtTexture(latestShirtTextureRef.current);
      },
      undefined,
      () => {
        const fallback = new THREE.Mesh(
          new THREE.BoxGeometry(1.5, 3, 0.8),
          new THREE.MeshStandardMaterial({ color: 0xffffff })
        );
        fallback.position.y = 1.5;
        scene.add(fallback);
      }
    );

    let frameId = 0;
    const render = () => {
      frameId = window.requestAnimationFrame(render);
      controls.update();
      renderer.render(scene, camera);
    };
    render();

    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      shirtCanvasTextureRef.current?.dispose();
      shirtCanvasTextureRef.current = null;
      shirtMaterialRef.current?.dispose();
      shirtMaterialRef.current = null;
      loadedRootRef.current = null;
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [applyShirtTexture]);

  return (
    <div className="w-full">
      <div
        ref={containerRef}
        style={{
          height: `${displayHeightPx}px`,
          width: `${Math.round(displayHeightPx * VIEWPORT_ASPECT)}px`,
          maxWidth: "100%",
        }}
        className="relative overflow-hidden rounded-md border border-black/10 bg-[#d7d7d7]"
      >
        {viewerError ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-black/60">
            {viewerError}
          </div>
        ) : null}
      </div>
    </div>
  );
}
