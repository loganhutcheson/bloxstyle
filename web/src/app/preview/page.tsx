"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";

export default function Preview() {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
	const [loadingTex, setLoadingTex] = useState(false);
  const loadedRootRef = useRef<THREE.Object3D | null>(null);

	useEffect(() => {
		if (!containerRef.current) return;

		const container = containerRef.current;
		const width = container.clientWidth;
		const height = container.clientHeight;

		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
		camera.position.set(2.5, 2.5, 2.5);

		const renderer = new THREE.WebGLRenderer({ antialias: true });
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.setSize(width, height);
		container.appendChild(renderer.domElement);

		const ambient = new THREE.AmbientLight(0xffffff, 0.6);
		scene.add(ambient);
		const dir = new THREE.DirectionalLight(0xffffff, 0.9);
		dir.position.set(3, 5, 2);
		scene.add(dir);

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x4f46e5 });
    materialRef.current = material;
    const cube = new THREE.Mesh(geometry, material);
    scene.add(cube);

    // Optional: load a GLB avatar if provided via env or UI
    const presetUrl = (process.env.NEXT_PUBLIC_AVATAR_GLB_URL || "").trim();
    const tryLoadGLB = (url: string) => {
      if (!url) return;
      const loader = new GLTFLoader();
      loader.setCrossOrigin("anonymous");
      loader.load(
        url,
        (gltf) => {
          // Remove cube when model loads
          scene.remove(cube);
          loadedRootRef.current = gltf.scene;
          loadedRootRef.current.traverse((obj: THREE.Object3D) => {
            if (obj instanceof THREE.Mesh) {
              obj.castShadow = true;
              obj.receiveShadow = true;
              // Use the first mesh's material as the target for texture application
              if (!materialRef.current && obj.material) {
                const baseMat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
                if (baseMat) {
                  // clone to avoid mutating shared materials
                  const cloned = baseMat.clone() as THREE.MeshStandardMaterial;
                  obj.material = cloned;
                  materialRef.current = cloned;
                }
              }
            }
          });
          // Center and scale roughly
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
        },
        undefined,
        () => {
          // ignore load errors silently for now
        }
      );
    };
    if (presetUrl) tryLoadGLB(presetUrl);

    // Try loading local OBJ/MTL from public directory
    const objUrl = "/rbx_r15_model.obj";
    const mtlUrl = "/rbx_r15_model.mtl";
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
            // Remove cube if present
            scene.remove(cube);
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
            // Center/scale
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
          },
          undefined,
          () => {
            // silently ignore load errors
          }
        );
      },
      undefined,
      () => {}
    );

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
          if (materialRef.current) {
            materialRef.current.map?.dispose?.();
            materialRef.current.map = tex;
            materialRef.current.color.set(0xffffff);
            materialRef.current.needsUpdate = true;
          }
          // Also try to apply to all meshes of loaded model if present
          if (loadedRootRef.current) {
            loadedRootRef.current.traverse((o: THREE.Object3D) => {
              if (o instanceof THREE.Mesh && o.material) {
                const m = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
                if (m) {
                  m.map = tex;
                  m.color.set(0xffffff);
                  m.needsUpdate = true;
                }
              }
            });
          }
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

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
		if (!file || !containerRef.current || !materialRef.current) return;
    applyTextureFromFile(file);
	};

  // Drag & drop support on the 3D canvas container
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
    <div className="min-h-screen w-full p-6">
      <h1 className="text-2xl font-semibold mb-4">3D Preview (Roblox avatar prototype)</h1>
			<div className="mb-3 flex items-center gap-3">
				<label className="text-sm">Apply texture (PNG/JPG):</label>
				<input type="file" accept="image/png,image/jpeg" onChange={onFileChange} />
				{loadingTex ? <span className="text-sm">Loading texture…</span> : null}
			</div>
      <div className="mb-3 text-sm text-black/60 dark:text-white/60">
        To load a blocky avatar GLB, set NEXT_PUBLIC_AVATAR_GLB_URL in your env and refresh,
        or paste a hotlinkable GLB URL in code. We can wire a UI loader next.
      </div>
      <div ref={containerRef} className="h-[500px] w-full rounded-md border border-black/10 dark:border-white/10 overflow-hidden relative">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-xs sm:text-sm bg-black/50 text-white px-2 py-1 rounded-md">Drag & drop a PNG/JPG onto the viewer to texture the model</span>
        </div>
      </div>
      <p className="text-sm mt-3 text-black/60 dark:text-white/60">Drag & drop or use the file input above. Use your mouse to orbit.</p>
		</div>
	);
}


