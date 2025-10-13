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
    let loadedRoot: THREE.Object3D | null = null;
    const tryLoadGLB = (url: string) => {
      if (!url) return;
      const loader = new GLTFLoader();
      loader.setCrossOrigin("anonymous");
      loader.load(
        url,
        (gltf) => {
          // Remove cube when model loads
          scene.remove(cube);
          loadedRoot = gltf.scene;
          loadedRoot.traverse((obj: THREE.Object3D) => {
            if (obj instanceof THREE.Mesh) {
              obj.castShadow = true;
              obj.receiveShadow = true;
            }
          });
          // Center and scale roughly
          const box = new THREE.Box3().setFromObject(loadedRoot);
          const size = new THREE.Vector3();
          box.getSize(size);
          const scale = 1.5 / Math.max(size.x, size.y, size.z);
          loadedRoot.scale.setScalar(scale);
          box.setFromObject(loadedRoot);
          const center = new THREE.Vector3();
          box.getCenter(center);
          loadedRoot.position.sub(center);
          scene.add(loadedRoot);
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
            loadedRoot = obj;
            obj.traverse((o: THREE.Object3D) => {
              if (o instanceof THREE.Mesh) {
                o.castShadow = true;
                o.receiveShadow = true;
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
      if (loadedRoot) {
        scene.remove(loadedRoot);
      }
			if (renderer.domElement.parentElement === container) {
				container.removeChild(renderer.domElement);
			}
		};
	}, []);

	const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file || !containerRef.current || !materialRef.current) return;
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
					materialRef.current!.map?.dispose?.();
					materialRef.current!.map = tex;
					materialRef.current!.color.set(0xffffff);
					materialRef.current!.needsUpdate = true;
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

	return (
		<div className="min-h-screen w-full p-6">
			<h1 className="text-2xl font-semibold mb-4">3D Preview (Cube)</h1>
			<div className="mb-3 flex items-center gap-3">
				<label className="text-sm">Apply texture (PNG/JPG):</label>
				<input type="file" accept="image/png,image/jpeg" onChange={onFileChange} />
				{loadingTex ? <span className="text-sm">Loading texture…</span> : null}
			</div>
      <div className="mb-3 text-sm text-black/60 dark:text-white/60">
        To load a blocky avatar GLB, set NEXT_PUBLIC_AVATAR_GLB_URL in your env and refresh,
        or paste a hotlinkable GLB URL in code. We can wire a UI loader next.
      </div>
			<div ref={containerRef} className="h-[500px] w-full rounded-md border border-black/10 dark:border-white/10 overflow-hidden" />
			<p className="text-sm mt-3 text-black/60 dark:text-white/60">Use your mouse to orbit the cube.</p>
		</div>
	);
}


