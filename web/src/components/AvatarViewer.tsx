"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import {
  loadTexture,
  applyMaterialToMeshesByName,
  createShirtOnlyMaterial,
  createPantsOnlyMaterial,
} from "@/lib/robloxClothing";

interface AvatarViewerProps {
  heightPx?: number;
}

export default function AvatarViewer({ heightPx = 420 }: AvatarViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | null>(null);
  const loadedRootRef = useRef<THREE.Object3D | null>(null);
  const [loadingClothes, setLoadingClothes] = useState(false);
  const [shirtFileName, setShirtFileName] = useState<string>("");
  const [pantsFileName, setPantsFileName] = useState<string>("");
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

    setModelStatus("Initializing viewer…");

    // Load the open-source R6 block model (clothCompatBlockR6) from public assets and replace mannequin
    (function loadR6Model() {
      const basePath = "/assets/r6/";
      const mtlName = "clothCompatBlockR6.mtl";
      const objName = "clothCompatBlockR6.obj";
      const mtlLoader = new MTLLoader();
      mtlLoader.setCrossOrigin("anonymous");
      mtlLoader.setPath(basePath);
      mtlLoader.setResourcePath(basePath);
      setModelStatus("Loading R6 model…");
      mtlLoader.load(
        mtlName,
        (materials) => {
          try {
            materials.preload();
          } catch {}
          const objLoader = new OBJLoader();
          objLoader.setMaterials(materials);
          objLoader.setPath(basePath);
          objLoader.load(
            objName,
            (obj) => {
              // Replace mannequin with loaded OBJ
              if (loadedRootRef.current) scene.remove(loadedRootRef.current);
              loadedRootRef.current = obj;
              obj.traverse((o: THREE.Object3D) => {
                if (o instanceof THREE.Mesh) {
                  o.castShadow = true;
                  o.receiveShadow = true;
                  // Set a clean white default material
                  const whiteMat = new THREE.MeshStandardMaterial({
                    color: 0xffffff,
                    roughness: 0.75,
                    metalness: 0.0,
                  });
                  o.material = whiteMat;
                  // Debug: log mesh names and group counts to refine targeting
                  try {
                    console.debug(
                      "[AvatarViewer] mesh",
                      o.name || "(unnamed)",
                      "groups",
                      ((o.geometry as THREE.BufferGeometry).groups?.length ?? 0)
                    );
                  } catch {}
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
              setModelStatus("R6 model loaded");
            },
            undefined,
            () => {
              setModelStatus("Failed to load R6 model (check /assets/r6 files)");
            }
          );
        },
        undefined,
        () => {
          setModelStatus("Failed to load R6 materials (check /assets/r6 files)");
        }
      );
    })();

    // Do not load GLB head; we rely solely on the R6 OBJ model

    // Do not load any external GLB/OBJ models; only the BloxPreview R6 OBJ is used

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

  // Removed single texture preview uploader per request

  // Apply Roblox clothing blending (shirt + pants) based on BloxClothViewer shader
  const applyShirtAndPants = async (shirtFile: File | null, pantsFile: File | null) => {
    if (!loadedRootRef.current) return;
    if (!shirtFile && !pantsFile) return;
    setLoadingClothes(true);
    try {
      // Load textures as needed
      let shirtTex: THREE.Texture | null = null;
      let pantsTex: THREE.Texture | null = null;
      if (shirtFile) {
        const shirtUrl = URL.createObjectURL(shirtFile);
        shirtTex = await loadTexture(shirtUrl, { flipY: true });
        URL.revokeObjectURL(shirtUrl);
      }
      if (pantsFile) {
        const pantsUrl = URL.createObjectURL(pantsFile);
        pantsTex = await loadTexture(pantsUrl, { flipY: true });
        URL.revokeObjectURL(pantsUrl);
      }

      // Apply shirt only to torso + arms; pants only to legs
      if (shirtTex) {
        const shirtMat = createShirtOnlyMaterial(shirtTex);
        applyMaterialToMeshesByName(
          loadedRootRef.current,
          shirtMat,
          /torso|upper\s*torso|arm|left\s*arm|right\s*arm/i
        );
      }
      if (pantsTex) {
        const pantsMat = createPantsOnlyMaterial(pantsTex);
        applyMaterialToMeshesByName(
          loadedRootRef.current,
          pantsMat,
          /leg|left\s*leg|right\s*leg/i
        );
      }
    } catch {
      // ignore errors for now
    } finally {
      setLoadingClothes(false);
    }
  };

  const onShirtChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setShirtFileName(file?.name || "");
    void applyShirtAndPants(file, null);
  };
  const onPantsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setPantsFileName(file?.name || "");
    void applyShirtAndPants(null, file);
  };

  // Removed drag & drop handlers for single texture preview

  return (
    <div className="w-full">
      <div className="mb-3 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">Apply Shirt</span>
          <input type="file" accept="image/png,image/jpeg" onChange={onShirtChange} />
          <span className="text-xs text-sky-500">{shirtFileName || "No file chosen"}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm">Apply Pants</span>
          <input type="file" accept="image/png,image/jpeg" onChange={onPantsChange} />
          <span className="text-xs text-sky-500">{pantsFileName || "No file chosen"}</span>
        </div>
        {loadingClothes ? <span className="text-sm">Applying clothing…</span> : null}
      </div>
      <div
        ref={containerRef}
        style={{ height: `${heightPx}px` }}
        className="w-full rounded-md border border-black/10 dark:border-white/10 overflow-hidden relative"
      >
        <div className="pointer-events-none absolute inset-0 flex items-end justify-between p-2 gap-2">
          <span className="text-[10px] sm:text-xs bg-black/50 text-white px-2 py-1 rounded-md">{modelStatus || "Initializing viewer…"}</span>
        </div>
      </div>
    </div>
  );
}


