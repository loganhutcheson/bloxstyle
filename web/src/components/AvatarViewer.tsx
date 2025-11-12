"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";

interface AvatarViewerProps {
  heightPx?: number;
}

export default function AvatarViewer({ heightPx = 420 }: AvatarViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | null>(null);
  const loadedRootRef = useRef<THREE.Object3D | null>(null);
  const [loadingTex, setLoadingTex] = useState(false);
  // Track original materials so we can restore before re-applying
  const originalMaterialsRef = useRef<Map<THREE.Mesh, THREE.Material | THREE.Material[]>>(new Map());
  const [modelStatus, setModelStatus] = useState<string>("");

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2f2f33); // neutral grey background
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    camera.position.set(2.5, 2.5, 2.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x2f2f33, 1);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const hemi = new THREE.HemisphereLight(0x999999, 0x3a3a3a, 0.5);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(3, 6, 2);
    dir.castShadow = true;
    scene.add(dir);

    // Grey ground to avoid floating-in-black feel
    const groundGeo = new THREE.PlaneGeometry(20, 20);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x393c40, roughness: 1 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.2;
    ground.receiveShadow = true;
    scene.add(ground);

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x4f46e5 });
    materialRef.current = material;
    const cube = new THREE.Mesh(geometry, material);
    cube.visible = false; // keep as hidden fallback if needed
    scene.add(cube);

    // Procedural R6-style blocky mannequin so something is always visible
    const buildR6Mannequin = (): THREE.Group => {
      const group = new THREE.Group();
      const mk = (w: number, h: number, d: number, color: number, name: string, y: number, x = 0) => {
        const g = new THREE.BoxGeometry(w, h, d);
        const m = new THREE.MeshStandardMaterial({ color });
        const mesh = new THREE.Mesh(g, m);
        mesh.name = name;
        mesh.position.set(x, y, 0);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      };
      // Basic proportions (meters): torso 2, head 1, arms/legs 2
      mk(1.6, 2.0, 0.8, 0xffffff, "Torso", 1.0);
      mk(1.2, 1.0, 1.0, 0xf0f0f0, "Head", 2.5);
      mk(0.7, 2.0, 0.7, 0xdddddd, "Left Arm", 1.0, -1.15);
      mk(0.7, 2.0, 0.7, 0xdddddd, "Right Arm", 1.0, 1.15);
      mk(0.8, 2.0, 0.8, 0xcccccc, "Left Leg", -0.5, -0.4);
      mk(0.8, 2.0, 0.8, 0xcccccc, "Right Leg", -0.5, 0.4);
      return group;
    };

    const mannequin = buildR6Mannequin();
    loadedRootRef.current = mannequin;
    // Center and scale nicely
    const mbox = new THREE.Box3().setFromObject(mannequin);
    const msize = new THREE.Vector3();
    mbox.getSize(msize);
    const mscale = 1.8 / Math.max(msize.x, msize.y, msize.z);
    mannequin.scale.setScalar(mscale);
    mbox.setFromObject(mannequin);
    const mcenter = new THREE.Vector3();
    mbox.getCenter(mcenter);
    mannequin.position.sub(mcenter);
    scene.add(mannequin);
    setModelStatus("R6 mannequin ready");

    const presetUrl = (process.env.NEXT_PUBLIC_AVATAR_GLB_URL || "").trim();
    const shouldLoadExternal = (process.env.NEXT_PUBLIC_LOAD_EXTERNAL || "").trim().toLowerCase() === "true";
    const tryLoadGLB = (url: string) => {
      if (!url) return;
      const loader = new GLTFLoader();
      loader.setCrossOrigin("anonymous");
      loader.load(
        url,
        (gltf) => {
          // Replace mannequin with loaded GLB
          if (loadedRootRef.current) scene.remove(loadedRootRef.current);
          loadedRootRef.current = gltf.scene;
          loadedRootRef.current.traverse((obj: THREE.Object3D) => {
            if (obj instanceof THREE.Mesh) {
              obj.castShadow = true;
              obj.receiveShadow = true;
              if (!materialRef.current && obj.material) {
                const baseMat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
                if (baseMat) {
                  const cloned = baseMat.clone() as THREE.MeshStandardMaterial;
                  obj.material = cloned;
                  materialRef.current = cloned;
                }
              }
            }
          });
          const box = new THREE.Box3().setFromObject(loadedRootRef.current);
          const size = new THREE.Vector3();
          box.getSize(size);
          const scale = 1.5 / Math.max(size.x, size.y, size.z);
          loadedRootRef.current.scale.setScalar(scale);
          box.setFromObject(loadedRootRef.current);
          const center = new THREE.Vector3();
          box.getCenter(center);
          loadedRootRef.current.position.sub(center);
          scene.add(loadedRootRef.current);
          setModelStatus("GLB avatar loaded");
        },
        undefined,
        () => {}
      );
    };
    if (shouldLoadExternal && presetUrl) tryLoadGLB(presetUrl);

    // Try loading local OBJ/MTL from public directory
    const objUrl = "/rbx_r15_model.obj";
    const mtlUrl = "/rbx_r15_model.mtl";
    if (shouldLoadExternal) {
      const mtlLoader = new MTLLoader();
      mtlLoader.load(
        mtlUrl,
        (materials) => {
          materials.preload();
          const objLoader = new OBJLoader();
          objLoader.setMaterials(materials);
          objLoader.load(
            objUrl,
            (obj) => {
              // Replace mannequin with loaded OBJ/MTL
              if (loadedRootRef.current) scene.remove(loadedRootRef.current);
              loadedRootRef.current = obj;
              obj.traverse((o: THREE.Object3D) => {
                if (o instanceof THREE.Mesh) {
                  o.castShadow = true;
                  o.receiveShadow = true;
                  if (!materialRef.current && o.material) {
                    const baseMat = Array.isArray(o.material) ? o.material[0] : o.material;
                    if (baseMat) {
                      const cloned = baseMat.clone() as THREE.MeshStandardMaterial;
                      o.material = cloned;
                      materialRef.current = cloned;
                    }
                  }
                }
              });
              const box = new THREE.Box3().setFromObject(obj);
              const size = new THREE.Vector3();
              box.getSize(size);
              const scale = 1.8 / Math.max(size.x, size.y, size.z);
              obj.scale.setScalar(scale);
              box.setFromObject(obj);
              const center = new THREE.Vector3();
              box.getCenter(center);
              obj.position.sub(center);
              scene.add(obj);
              setModelStatus("OBJ avatar loaded");
            },
            undefined,
            () => {}
          );
        },
        undefined,
        () => {}
      );
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    let rafId = 0;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      cube.rotation.x += 0.005;
      cube.rotation.y += 0.01;
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(rafId);
      controls.dispose();
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      if (loadedRootRef.current) {
        scene.remove(loadedRootRef.current);
      }
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  const applyTextureFromFile = (file: File) => {
    if (!file || !containerRef.current) return;
    setLoadingTex(true);
    try {
      const url = URL.createObjectURL(file);
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin("anonymous");
      loader.load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.flipY = false; // helps with GLTF UV orientation

          // Use lighting-independent material so textures never appear black
          const previewMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
          materialRef.current = previewMat;

          // R6 torso-only targeting (also allow R15 UpperTorso)
          const torsoOnlyRegex = /^(torso|upper\s*torso)$/i;

          // Restore any previously replaced materials before applying again
          if (loadedRootRef.current && originalMaterialsRef.current.size > 0) {
            loadedRootRef.current.traverse((o: THREE.Object3D) => {
              if (o instanceof THREE.Mesh) {
                const orig = originalMaterialsRef.current.get(o);
                if (orig) o.material = orig;
              }
            });
          }

          if (loadedRootRef.current) {
            loadedRootRef.current.traverse((o: THREE.Object3D) => {
              if (o instanceof THREE.Mesh) {
                const n = (o.name || "").toString();
                if (torsoOnlyRegex.test(n)) {
                  // Save original material for future restores
                  if (!originalMaterialsRef.current.has(o)) {
                    originalMaterialsRef.current.set(o, o.material);
                  }
                  o.material = previewMat;
                }
              }
            });
          }
          // If no torso mesh names were found, do nothing rather than applying to all.

          // Also replace cube material if present
          // (materialRef initially held cube's MeshStandardMaterial)
          setLoadingTex(false);
          URL.revokeObjectURL(url);
        },
        undefined,
        () => {
          setLoadingTex(false);
          URL.revokeObjectURL(url);
        }
      );
    } catch {
      setLoadingTex(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/image\/png|image\/jpeg/.test(file.type)) return;
    applyTextureFromFile(file);
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const prevent = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onDrop = (e: DragEvent) => {
      prevent(e);
      const file = e.dataTransfer?.files?.[0];
      if (file && (/image\/png|image\/jpeg/).test(file.type)) {
        applyTextureFromFile(file);
      }
    };
    el.addEventListener("dragover", prevent);
    el.addEventListener("dragenter", prevent);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", prevent);
      el.removeEventListener("dragenter", prevent);
      el.removeEventListener("drop", onDrop);
    };
  }, []);

  return (
    <div className="w-full">
      <div className="mb-3 flex items-center gap-3">
        <label className="text-sm">Apply texture (PNG/JPG):</label>
        <input type="file" accept="image/png,image/jpeg" onChange={onFileChange} />
        {loadingTex ? <span className="text-sm">Loading texture…</span> : null}
      </div>
      <div
        ref={containerRef}
        style={{ height: `${heightPx}px` }}
        className="w-full rounded-md border border-black/10 dark:border-white/10 overflow-hidden relative"
      >
        <div className="pointer-events-none absolute inset-0 flex items-end justify-between p-2 gap-2">
          <span className="text-[10px] sm:text-xs bg-black/50 text-white px-2 py-1 rounded-md">{modelStatus || "Initializing viewer…"}</span>
          <span className="text-[10px] sm:text-xs bg-black/50 text-white px-2 py-1 rounded-md">Drag & drop PNG/JPG</span>
        </div>
      </div>
    </div>
  );
}


