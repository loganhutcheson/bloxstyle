"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { CSSProperties } from "react";
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

// Generate a light grey Roblox-like baseplate texture with stud pattern
function createBaseplateTexture(
  sizePx = 512,
  studsPerTile = 8,
  baseColor = "#D9D9D9",
  studColor = "#BEBEBE"
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = sizePx;
  canvas.height = sizePx;
  const ctx = canvas.getContext("2d")!;
  // Background
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, sizePx, sizePx);
  // Stud grid
  const cell = sizePx / studsPerTile;
  const radius = Math.max(1, Math.floor(cell * 0.22));
  ctx.fillStyle = studColor;
  for (let y = 0; y < studsPerTile; y++) {
    for (let x = 0; x < studsPerTile; x++) {
      const cx = Math.round(x * cell + cell * 0.5);
      const cy = Math.round(y * cell + cell * 0.5);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      // subtle highlight ring
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = Math.max(1, Math.floor(radius * 0.2));
      ctx.arc(cx, cy, radius * 0.7, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
 
 // Generate a simple "sunny" sky texture (vertical gradient)
 function createSunnySkyTexture(
   width = 1024,
   height = 512,
   topColor = "#5BA4FF", // bright sky blue
   midColor = "#9BD3FF", // lighter near horizon
   bottomColor = "#E9F6FF" // very light at bottom
 ): THREE.CanvasTexture {
   const canvas = document.createElement("canvas");
   canvas.width = width;
   canvas.height = height;
   const ctx = canvas.getContext("2d")!;
   const g = ctx.createLinearGradient(0, 0, 0, height);
   g.addColorStop(0.0, topColor);
   g.addColorStop(0.6, midColor);
   g.addColorStop(1.0, bottomColor);
   ctx.fillStyle = g;
   ctx.fillRect(0, 0, width, height);
   const tex = new THREE.CanvasTexture(canvas);
   tex.colorSpace = THREE.SRGBColorSpace;
   tex.needsUpdate = true;
   return tex;
 }

type FitMode = "max" | "height" | "width" | "depth";
type AlignMode = "center" | "feet";

interface AvatarViewerProps {
  heightPx?: number;
}

export default function AvatarViewer({ heightPx = 720 }: AvatarViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const raycasterRef = useRef<THREE.Raycaster | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | null>(null);
  const loadedRootRef = useRef<THREE.Object3D | null>(null);
  const [loadingClothes, setLoadingClothes] = useState(false);
  const [shirtFileName, setShirtFileName] = useState<string>("");
  const [pantsFileName, setPantsFileName] = useState<string>("");
  const [modelStatus, setModelStatus] = useState<string>("");
  const shirtInputRef = useRef<HTMLInputElement | null>(null);
  const pantsInputRef = useRef<HTMLInputElement | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const PANEL_WIDTH_PCT = 0.525; // 30% less than previous 75%
  const PANEL_HEIGHT_PCT = 0.85;
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null);
  // Mask panel (new)
  const [maskPanelOpen, setMaskPanelOpen] = useState(false);
  const [maskPanelPos, setMaskPanelPos] = useState<{ x: number; y: number } | null>(null);
  const [isDraggingMaskPanel, setIsDraggingMaskPanel] = useState(false);
  const maskDragRef = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null);
  const GRID_ROWS = 6;
  const GRID_COLS = 5;
  const PANEL_GAP_PX = 8;
  const panelContentRef = useRef<HTMLDivElement | null>(null);
  const [buttonSizePx, setButtonSizePx] = useState<number>(28);
  // Video-style aspect ratio (width = height * ratio), 16:9
  const PORTRAIT_ASPECT = 16 / 9;
  // Responsive height: adapt to viewport width for mobile while respecting aspect ratio
  const [displayHeightPx, setDisplayHeightPx] = useState<number>(heightPx);
  // Preview URL for applied shirt texture (for mask panel)
  const [shirtPreviewUrl, setShirtPreviewUrl] = useState<string | null>(null);
  // Flux inline integration
  const [maskPrompt, setMaskPrompt] = useState<string>("roblox shirt texture, high quality, clean edges");
  const [generating, setGenerating] = useState<boolean>(false);
  const [generatedFluxUrls, setGeneratedFluxUrls] = useState<string[]>([]);
  // Painting state/refs
  const [paintEnabled, setPaintEnabled] = useState<boolean>(false);
  const paintingActiveRef = useRef<boolean>(false);
  const brushSizeRef = useRef<number>(14);
  // Qwen edit status
  const [qwenActive, setQwenActive] = useState<boolean>(false);
  const [qwenElapsedMs, setQwenElapsedMs] = useState<number>(0);
  const [qwenStatus, setQwenStatus] = useState<string | null>(null);
  const qwenStartRef = useRef<number | null>(null);
  const QWEN_MAX_MS = 180000; // 3 minutes
  const [qwenPrompt, setQwenPrompt] = useState<string>("Add a banana logo, keep same design");
  const shirtMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const pantsMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const shirtCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const shirtCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const shirtCanvasTexRef = useRef<THREE.CanvasTexture | null>(null);
  const pantsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pantsCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const pantsCanvasTexRef = useRef<THREE.CanvasTexture | null>(null);
  // Mask panel painting
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const maskBaseImgRef = useRef<HTMLImageElement | null>(null);
  const maskPaintingActiveRef = useRef<boolean>(false);
  const colorButtons: Array<[number, number, number]> = [
    // Row 1
    [88, 77, 67], [119, 94, 73], [171, 149, 133], [195, 145, 111], [226, 186, 151],
    // Row 2
    [83, 67, 56], [99, 66, 44], [183, 156, 102], [195, 173, 127], [212, 198, 159],
    // Row 3
    [145, 122, 120], [152, 80, 78], [206, 138, 126], [247, 203, 202], [241, 157, 217],
    // Row 4
    [120, 134, 155], [91, 123, 170], [141, 186, 217], [176, 168, 249], [157, 98, 152],
    // Row 5
    [62, 141, 154], [106, 153, 85], [131, 155, 112], [168, 195, 146], [216, 158, 82],
    // Row 6
    [239, 207, 83], [243, 218, 125], [99, 95, 98], [205, 205, 205], [248, 248, 248],
  ];

  // Track current skin color (no persistence; defaults to white on refresh)
  const [skinColor, setSkinColorState] = useState<THREE.Color>(new THREE.Color(1, 1, 1));
  // Slightly darken body (torso/legs) compared to head to match perceived tone
  const BODY_SKIN_DARKEN = 0.82; // increased darkening for higher contrast

  // Debug panel state
  const [debugOpen, setDebugOpen] = useState<boolean>(false);
  const [fitTarget, setFitTarget] = useState<number>(1.8);
  const [fitMode, setFitMode] = useState<FitMode>("max");
  const [alignMode, setAlignMode] = useState<AlignMode>("center");
  const [yawDeg, setYawDeg] = useState<number>(180);
  const [yOffset, setYOffset] = useState<number>(0);
  const [fov, setFov] = useState<number>(50);
  const [faceCamera, setFaceCamera] = useState<boolean>(false);
  const [xFrameOffset, setXFrameOffset] = useState<number>(0.15);
  const [yawOffsetDeg, setYawOffsetDeg] = useState<number>(0);
  // Clothing brightness controls
  const [clothBaseBrightness, setClothBaseBrightness] = useState<number>(0.88);
  const [clothBrightnessGain, setClothBrightnessGain] = useState<number>(1.15);
  // Clothing tone controls
  const [clothContrast, setClothContrast] = useState<number>(1.0);
  const [clothGamma, setClothGamma] = useState<number>(2.0);
  // Debug camera orbit controls
  const [useDebugCamAngles, setUseDebugCamAngles] = useState<boolean>(false);
  const [camYawDeg, setCamYawDeg] = useState<number>(0);
  const [camTiltDeg, setCamTiltDeg] = useState<number>(20);

  // Face overlay uses alpha transparency only; base head shows skin color
  const headOverlayRef = useRef<THREE.Mesh | null>(null);
  const headBaseRef = useRef<THREE.Mesh | null>(null);
  const headFaceTexRef = useRef<THREE.Texture | null>(null);

  const composeFaceTexture = (srcTex: THREE.Texture, skin: THREE.Color): THREE.Texture | null => {
    const img = srcTex.image as unknown as CanvasImageSource & { width?: number; height?: number };
    const width = img?.width as number | undefined;
    const height = img?.height as number | undefined;
    if (!img || !width || !height) return null;
    const canvas = document.createElement("canvas");
    canvas.width = width!;
    canvas.height = height!;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // Fill with skin color
    ctx.fillStyle = `rgb(${Math.round(skin.r * 255)}, ${Math.round(skin.g * 255)}, ${Math.round(skin.b * 255)})`;
    ctx.fillRect(0, 0, width!, height!);
    // Draw face texture on top (alpha respected)
    ctx.drawImage(img as CanvasImageSource, 0, 0, width!, height!);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  };

  const updateHeadMaterialsAndOverlay = useCallback((retryIfNeeded = true) => {
    // Update base color
    if (headBaseRef.current) {
      const m = headBaseRef.current.material as THREE.MeshStandardMaterial;
      if (m && !m.map) {
        m.color = skinColor.clone();
        m.needsUpdate = true;
      }
    }
    // Update overlay composed map
    if (headOverlayRef.current && headFaceTexRef.current) {
      const composed = composeFaceTexture(headFaceTexRef.current, skinColor);
      if (composed) {
        const mat = headOverlayRef.current.material as THREE.MeshStandardMaterial;
        mat.map = composed;
        mat.transparent = false;
        mat.needsUpdate = true;
      } else if (retryIfNeeded) {
        // Try again shortly in case the source image wasn't ready
        setTimeout(() => updateHeadMaterialsAndOverlay(false), 50);
      }
    }
  }, [skinColor]);

  const setSkinColor = (r: number, g: number, b: number) => {
    if (!loadedRootRef.current) return;
    const color = new THREE.Color(r / 255, g / 255, b / 255);
    setSkinColorState(color.clone());
    const bodyColor = color.clone().multiplyScalar(BODY_SKIN_DARKEN);
    loadedRootRef.current.traverse((o: THREE.Object3D) => {
      if (o instanceof THREE.Mesh) {
        const name = (o.name || "").toString().toLowerCase();
        const mat = o.material as THREE.Material | THREE.Material[];
        const applyToMat = (m: THREE.Material) => {
          // MeshStandardMaterial branch
          if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
            const mm = m as THREE.MeshStandardMaterial;
            // For head/face: if this is the base (no map), set color; if it's the overlay (has map), leave it
            if (/head|face/.test(name)) {
              if (!mm.map) {
                mm.color = color.clone();
                mm.needsUpdate = true;
              }
              return;
            }
            // For torso/legs, bias slightly darker to match head appearance
            if (/torso|upper\s*torso|leg|left\s*leg|right\s*leg/.test(name)) {
              if (!mm.map) {
                mm.color = bodyColor.clone();
                mm.needsUpdate = true;
              }
              return;
            }
            // For other meshes without a map, set the base color
            if (!mm.map) {
              mm.color = color.clone();
              mm.needsUpdate = true;
            }
          }
          // Clothing shader branch (update albedo for exposed skin)
          if ((m as THREE.ShaderMaterial).isShaderMaterial) {
            const sm = m as THREE.ShaderMaterial;
            const uniforms = sm.uniforms as Record<string, THREE.IUniform>;
            if (uniforms && uniforms.albedo && uniforms.albedo.value instanceof THREE.Color) {
              // Darken torso/legs albedo slightly
              if (/torso|upper\s*torso|leg|left\s*leg|right\s*leg/.test(name)) {
                uniforms.albedo.value = bodyColor.clone();
              } else {
                uniforms.albedo.value = color.clone();
              }
              sm.needsUpdate = true;
              return;
            }
            // Face overlay shader: update uSkinColor
            const uSkin = uniforms ? (uniforms["uSkinColor"] as THREE.IUniform | undefined) : undefined;
            if (uSkin) {
              uSkin.value = color.clone();
              sm.needsUpdate = true;
            }
          }
        };
        if (Array.isArray(mat)) mat.forEach(applyToMat);
        else if (mat) applyToMat(mat);
      }
    });
    // Re-compose face overlay texture with the new skin tone
    if (headOverlayRef.current && headFaceTexRef.current) {
      const newTex = composeFaceTexture(headFaceTexRef.current, color);
      const mat = headOverlayRef.current.material as THREE.MeshStandardMaterial;
      if (newTex) {
        mat.map = newTex;
        mat.transparent = false;
        mat.needsUpdate = true;
      }
    }
  };

  const applyWhiteToMeshesByName = (nameRegex: RegExp) => {
    if (!loadedRootRef.current) return;
    const whiteMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.4,
      metalness: 0.0,
    });
    loadedRootRef.current.traverse((o: THREE.Object3D) => {
      if (o instanceof THREE.Mesh) {
        const name = (o.name || "").toString();
        if (nameRegex.test(name)) {
          o.material = whiteMat;
        }
      }
    });
  };

  // Recompute model transform (scale/center/align/yaw) based on debug panel knobs
  const updateModelPlacement = useCallback(() => {
    const obj = loadedRootRef.current;
    if (!obj) return;
    // Reset translation so centering uses a stable baseline each time
    obj.position.set(0, 0, 0);
    // Scale to fit target based on fit mode (works from current size)
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box.getSize(size);
    const dim =
      fitMode === "height" ? size.y : fitMode === "width" ? size.x : fitMode === "depth" ? size.z : Math.max(size.x, size.y, size.z);
    if (dim > 0) {
      const scaleMul = fitTarget / dim;
      obj.scale.multiplyScalar(scaleMul);
    }
    // Recenter and optional feet alignment
    box.setFromObject(obj);
    const center = new THREE.Vector3();
    box.getCenter(center);
    obj.position.sub(center);
    if (alignMode === "feet") {
      box.setFromObject(obj);
      obj.position.y -= box.min.y;
    }
    // Y offset
    obj.position.y += yOffset;
    // Horizontal framing offset (screen-right) when facing camera
    if (faceCamera && cameraRef.current && xFrameOffset !== 0) {
      const cam = cameraRef.current;
      const forward = new THREE.Vector3();
      cam.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() > 0) {
        forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
        obj.position.addScaledVector(right, xFrameOffset);
      }
    }
    // Orientation
    let yaw = THREE.MathUtils.degToRad(yawDeg);
    if (faceCamera && cameraRef.current) {
      const cam = cameraRef.current;
      const camPos = cam.position.clone();
      camPos.y = 0;
      const modelPos = obj.position.clone();
      modelPos.y = 0;
      const dir = camPos.sub(modelPos);
      yaw = Math.atan2(dir.x, dir.z) + Math.PI;
    }
    // Apply additional world-relative yaw offset
    yaw += THREE.MathUtils.degToRad(yawOffsetDeg);
    obj.rotation.set(0, yaw, 0);
  }, [fitTarget, fitMode, alignMode, yawDeg, yOffset, faceCamera, xFrameOffset, yawOffsetDeg]);

 

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    // Use default renderer clear color (explicit black) and no skybox
    scene.background = null;
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    // Revert to original default camera position
    camera.position.set(-2.5, 2.5, -2.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    // Default clear color: black
    renderer.setClearColor(0x000000, 1);
    renderer.toneMappingExposure = 1.15; // brighten output
    renderer.shadowMap.enabled = false; // no shadows
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    raycasterRef.current = new THREE.Raycaster();

    // Lighting tuned brighter for clothing
    const ambient = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambient);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xeeeeee, 1.0);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(3, 6, 2);
    dir.castShadow = false;
    scene.add(dir);
    const fill = new THREE.DirectionalLight(0xffffff, 0.8);
    fill.position.set(-3, 4, -2);
    fill.castShadow = false;
    scene.add(fill);

    // Flat neutral grey ground (no texture)
    const groundGeo = new THREE.PlaneGeometry(20, 20);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x808080,
      roughness: 1.0,
      metalness: 0.0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.2;
    ground.receiveShadow = false;
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
                  o.castShadow = false;
                  o.receiveShadow = false;
                  // Set a clean white default material
                  const whiteMat = new THREE.MeshStandardMaterial({
                    color: 0xffffff,
                    roughness: 0.4,
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
              // Apply default face/head texture from open source assets, composited over a skin-colored base
              (async () => {
                try {
                  const headTex = await loadTexture("/assets/r6/Dummyr61_fulldiff.png", { flipY: true });
                  headFaceTexRef.current = headTex;
                  const makeBaseMat = () =>
                    new THREE.MeshStandardMaterial({
                      color: skinColor.clone(),
                      roughness: 0.75,
                      metalness: 0.0,
                    });
                  const makeOverlayMat = () => {
                    const composed = composeFaceTexture(headTex, skinColor);
                    const mat = new THREE.MeshStandardMaterial({
                      map: composed || headTex,
                      transparent: !composed, // if failed to compose, fall back to alpha
                      depthWrite: false,
                      roughness: 0.75,
                      metalness: 0.0,
                    });
                    // Schedule a post-create sync to ensure latest skin color is applied
                    setTimeout(() => updateHeadMaterialsAndOverlay(true), 0);
                    return mat;
                  };
                  obj.traverse((o: THREE.Object3D) => {
                    if (o instanceof THREE.Mesh) {
                      const n = (o.name || "").toString().toLowerCase();
                      if (/head|face/.test(n)) {
                        // Base skin-colored material on the head mesh
                        o.material = makeBaseMat();
                        headBaseRef.current = o;
                        // Overlay face texture as a child mesh
                        const overlay = new THREE.Mesh(o.geometry, makeOverlayMat());
                        overlay.renderOrder = (o.renderOrder || 0) + 1;
                        // Ensure transforms align with parent head mesh
                        overlay.matrixAutoUpdate = true;
                        o.add(overlay);
                        headOverlayRef.current = overlay;
                  }
                }
              });
                } catch {
                  // ignore if texture missing
                }
              })();
              const box = new THREE.Box3().setFromObject(obj);
              const size = new THREE.Vector3();
              box.getSize(size);
              const scale = 1.8 / Math.max(size.x, size.y, size.z);
              obj.scale.setScalar(scale);
              box.setFromObject(obj);
              // Centering will be handled by updateModelPlacement()
              // Revert body vertical offset
              scene.add(obj);
              // Apply initial placement based on debug settings
              updateModelPlacement();
              // Run once more on the next frame so bounding boxes/material updates settle
              requestAnimationFrame(() => {
                updateModelPlacement();
              });
              
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
    controls.enablePan = false; // disable right-click/drag panning
    // Default target at origin
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;
    // Adjust initial camera orbit: yaw 0° and tilt down by 20°
    {
      const target = controls.target.clone();
      const offset = camera.position.clone().sub(target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta = 0; // yaw 0°
      spherical.phi = Math.min(Math.max(0.0001, spherical.phi + THREE.MathUtils.degToRad(20)), Math.PI - 0.0001); // tilt down 20°
      offset.setFromSpherical(spherical);
      camera.position.copy(target).add(offset);
      camera.lookAt(target);
    }
    controls.update();

    let rafId = 0;
    const animate = () => {
      rafId = requestAnimationFrame(animate);
      cube.rotation.x += 0.005;
      cube.rotation.y += 0.01;
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Set initial panel position when opened (centered)
    if (panelOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const panelW = rect.width * PANEL_WIDTH_PCT;
      const panelH = rect.height * PANEL_HEIGHT_PCT;
      setPanelPos({ x: (rect.width - panelW) / 2, y: (rect.height - panelH) / 2 });
    }
    if (maskPanelOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const panelW = rect.width * PANEL_WIDTH_PCT;
      const panelH = rect.height * PANEL_HEIGHT_PCT;
      setMaskPanelPos({ x: (rect.width - panelW) / 2, y: (rect.height - panelH) / 2 });
    }

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      // Re-fit and center model after canvas size changes
      try {
        updateModelPlacement();
        requestAnimationFrame(() => updateModelPlacement());
      } catch {}
    };
    window.addEventListener("resize", onResize);

    // Painting handlers on renderer DOM
    const dom = renderer.domElement;
    const getPointerNDC = (ev: MouseEvent | PointerEvent) => {
      const rect = dom.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
      return new THREE.Vector2(x, y);
    };
    const ensureCanvasForTexture = (which: "shirt" | "pants") => {
      const mat = which === "shirt" ? shirtMatRef.current : pantsMatRef.current;
      if (!mat || !mat.uniforms) return;
      const uniforms = mat.uniforms as Record<string, THREE.IUniform>;
      const uniformName = which === "shirt" ? "texture_shirt" : "texture_pants";
      const currentTex: THREE.Texture | null = (uniforms[uniformName]?.value as THREE.Texture) || null;
      if (!currentTex || !currentTex.image) return;
      // If already set up, skip
      const alreadyCanvas =
        (which === "shirt" ? shirtCanvasTexRef.current : pantsCanvasTexRef.current) !== null;
      if (alreadyCanvas) return;
      const img = currentTex.image as HTMLImageElement | HTMLCanvasElement | ImageBitmap;
      const getSize = (im: HTMLImageElement | HTMLCanvasElement | ImageBitmap) => {
        if ("naturalWidth" in (im as HTMLImageElement)) {
          const tag = im as HTMLImageElement;
          return {
            w: tag.naturalWidth || tag.width || 1024,
            h: tag.naturalHeight || tag.height || 1024,
          };
        }
        const anyImg = im as HTMLCanvasElement | ImageBitmap;
        return {
          w: (anyImg as ImageBitmap).width || (anyImg as HTMLCanvasElement).width || 1024,
          h: (anyImg as ImageBitmap).height || (anyImg as HTMLCanvasElement).height || 1024,
        };
      };
      const { w, h } = getSize(img);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      try {
        ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
      } catch {}
      const canvasTex = new THREE.CanvasTexture(canvas);
      canvasTex.colorSpace = THREE.SRGBColorSpace;
      canvasTex.flipY = currentTex.flipY ?? true;
      canvasTex.needsUpdate = true;
      uniforms[uniformName].value = canvasTex;
      mat.needsUpdate = true;
      if (which === "shirt") {
        shirtCanvasRef.current = canvas;
        shirtCtxRef.current = ctx;
        shirtCanvasTexRef.current = canvasTex;
      } else {
        pantsCanvasRef.current = canvas;
        pantsCtxRef.current = ctx;
        pantsCanvasTexRef.current = canvasTex;
      }
    };
    const paintAt = (ev: MouseEvent | PointerEvent) => {
      if (!paintEnabled || !raycasterRef.current || !cameraRef.current || !loadedRootRef.current) return;
      const ndc = getPointerNDC(ev);
      const ray = raycasterRef.current;
      ray.setFromCamera(ndc, cameraRef.current);
      const intersects = ray.intersectObject(loadedRootRef.current, true) as THREE.Intersection<THREE.Object3D>[];
      if (!intersects || intersects.length === 0) return;
      const hit = intersects.find((i) => !!i.uv && i.object instanceof THREE.Mesh);
      if (!hit || !hit.uv) return;
      const mesh = hit.object as THREE.Mesh;
      const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const uv: THREE.Vector2 = hit.uv.clone();
      // Target which canvas
      let ctx: CanvasRenderingContext2D | null = null;
      let tex: THREE.CanvasTexture | null = null;
      let flipY = true;
      if (m && (m as THREE.ShaderMaterial).isShaderMaterial && (m as THREE.ShaderMaterial).uniforms) {
        const uniforms = (m as THREE.ShaderMaterial).uniforms as Record<string, THREE.IUniform>;
        if (uniforms.texture_shirt && uniforms.texture_shirt.value) {
          ensureCanvasForTexture("shirt");
          ctx = shirtCtxRef.current;
          tex = shirtCanvasTexRef.current;
          flipY = !!(tex && (tex.flipY ?? true));
        } else if (uniforms.texture_pants && uniforms.texture_pants.value) {
          ensureCanvasForTexture("pants");
          ctx = pantsCtxRef.current;
          tex = pantsCanvasTexRef.current;
          flipY = !!(tex && (tex.flipY ?? true));
        }
      }
      if (!ctx || !tex) return;
      const canvas = ctx.canvas;
      const x = uv.x * canvas.width;
      const y = (flipY ? (1 - uv.y) : uv.y) * canvas.height;
      const r = brushSizeRef.current;
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,1)";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      tex.needsUpdate = true;
    };
    const onPointerDown = (ev: PointerEvent) => {
      if (!paintEnabled) return;
      paintingActiveRef.current = true;
      paintAt(ev);
    };
    const onPointerMove = (ev: PointerEvent) => {
      if (!paintEnabled || !paintingActiveRef.current) return;
      paintAt(ev);
    };
    const onPointerUp = () => {
      paintingActiveRef.current = false;
    };
    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("mouseleave", onPointerUp);

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
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("mouseleave", onPointerUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compute a responsive display height based on viewport width and target aspect
  useEffect(() => {
    const computeDisplayHeight = () => {
      const vw = typeof window !== "undefined" ? window.innerWidth : undefined;
      if (!vw) {
        setDisplayHeightPx(heightPx);
        return;
      }
      const SCALE = 0.8; // 20% smaller
      // Compute a target width responsive to viewport:
      // - Small screens: cap near viewport
      // - Larger screens: allow a wider viewer up to a reasonable max
      const smallCap = Math.max(260, Math.floor(vw * 0.95));
      const defaultWidth = Math.round(heightPx * PORTRAIT_ASPECT);
      const desktopCap = Math.min(Math.floor(vw * 0.85), 960);
      const targetWidth = vw < 640 ? Math.min(defaultWidth, smallCap) : Math.max(defaultWidth, desktopCap);
      const h = Math.round((targetWidth / PORTRAIT_ASPECT) * SCALE);
      setDisplayHeightPx(h);
    };
    computeDisplayHeight();
    window.addEventListener("resize", computeDisplayHeight);
    return () => window.removeEventListener("resize", computeDisplayHeight);
  }, [heightPx, PORTRAIT_ASPECT]);

  // Re-apply placement when debug knobs change
  useEffect(() => {
    updateModelPlacement();
  }, [fitTarget, fitMode, alignMode, yawDeg, yOffset, faceCamera, xFrameOffset, yawOffsetDeg]);

  // When the responsive viewer height changes (e.g., after first mount),
  // re-sync camera aspect and renderer size so the scene is centered without a manual resize.
  useEffect(() => {
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    const container = containerRef.current;
    if (!camera || !renderer || !container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w > 0 && h > 0) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      try {
        updateModelPlacement();
      } catch {}
    }
  }, [displayHeightPx, updateModelPlacement]);

  // Apply FOV updates to camera
  useEffect(() => {
    if (!cameraRef.current) return;
    cameraRef.current.fov = fov;
    cameraRef.current.updateProjectionMatrix();
  }, [fov]);

  // Apply debug camera yaw/tilt like dragging does (OrbitControls orbit)
  useEffect(() => {
    if (!useDebugCamAngles) return;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const target = controls.target.clone();
    const offset = camera.position.clone().sub(target);
    const radius = offset.length();
    const spherical = new THREE.Spherical(radius);
    // Map UI degrees to spherical angles
    const theta = THREE.MathUtils.degToRad(camYawDeg);
    const phi = Math.min(Math.max(0.0001, THREE.MathUtils.degToRad(camTiltDeg)), Math.PI - 0.0001);
    spherical.theta = theta;
    spherical.phi = phi;
    const newOffset = new THREE.Vector3().setFromSpherical(spherical);
    camera.position.copy(target).add(newOffset);
    camera.lookAt(target);
    controls.update();
  }, [useDebugCamAngles, camYawDeg, camTiltDeg]);

  // Update clothing brightness uniforms when sliders change
  useEffect(() => {
    const mats: THREE.ShaderMaterial[] = [];
    if (shirtMatRef.current) mats.push(shirtMatRef.current);
    if (pantsMatRef.current) mats.push(pantsMatRef.current);
    mats.forEach((m) => {
      try {
        const u = m.uniforms as Record<string, THREE.IUniform>;
        if (u.base_brightness) u.base_brightness.value = clothBaseBrightness;
        if (u.brightness_gain) u.brightness_gain.value = clothBrightnessGain;
        if (u.contrast) u.contrast.value = clothContrast;
        if (u.gamma) u.gamma.value = clothGamma;
        m.needsUpdate = true;
      } catch {}
    });
  }, [clothBaseBrightness, clothBrightnessGain, clothContrast, clothGamma]);

  // Compute button size to evenly fit the 6x5 grid within the panel content area
  useEffect(() => {
    const computeSize = () => {
      if (!panelOpen || !panelContentRef.current) return;
      const cw = panelContentRef.current.clientWidth;
      const ch = panelContentRef.current.clientHeight;
      const cellW = (cw - PANEL_GAP_PX * (GRID_COLS - 1)) / GRID_COLS;
      const cellH = (ch - PANEL_GAP_PX * (GRID_ROWS - 1)) / GRID_ROWS;
      const sz = Math.max(20, Math.floor(Math.min(cellW, cellH) * 0.8));
      setButtonSizePx(sz);
    };
    computeSize();
    window.addEventListener("resize", computeSize);
    return () => window.removeEventListener("resize", computeSize);
  }, [panelOpen]);

  // No persistence; default skin color remains white on refresh

  // Keep head overlay/base synced to latest skin color
  useEffect(() => {
    updateHeadMaterialsAndOverlay(true);
  }, [updateHeadMaterialsAndOverlay]);

  // Set initial panel positions when toggled open
  useEffect(() => {
    if (panelOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const panelW = rect.width * PANEL_WIDTH_PCT;
      const panelH = rect.height * PANEL_HEIGHT_PCT;
      setPanelPos({ x: (rect.width - panelW) / 2, y: (rect.height - panelH) / 2 });
    }
  }, [panelOpen, PANEL_HEIGHT_PCT, PANEL_WIDTH_PCT]);
  useEffect(() => {
    if (maskPanelOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const panelW = rect.width * PANEL_WIDTH_PCT;
      const panelH = rect.height * PANEL_HEIGHT_PCT;
      setMaskPanelPos({ x: (rect.width - panelW) / 2, y: (rect.height - panelH) / 2 });
    }
  }, [maskPanelOpen, PANEL_HEIGHT_PCT, PANEL_WIDTH_PCT]);

  // Initialize mask canvas when mask panel opens or shirt preview changes
  useEffect(() => {
    if (!maskPanelOpen || !shirtPreviewUrl) return;
    const img = new Image();
    img.onload = () => {
      const canvas = maskCanvasRef.current;
      if (!canvas) return;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      maskCtxRef.current = ctx;
      maskBaseImgRef.current = img;
      // Draw base shirt template
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(img, 0, 0);
    };
    img.src = shirtPreviewUrl;
  }, [maskPanelOpen, shirtPreviewUrl]);

  // Mask canvas pointer handlers (erase to transparency)
  const onMaskPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!maskPanelOpen || !maskCanvasRef.current || !maskCtxRef.current) return;
    maskPaintingActiveRef.current = true;
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    paintOnMaskCanvas(e);
  };
  const onMaskPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!maskPaintingActiveRef.current) return;
    paintOnMaskCanvas(e);
  };
  const onMaskPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    maskPaintingActiveRef.current = false;
    try {
      (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId);
    } catch {}
  };
  const paintOnMaskCanvas = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = maskCanvasRef.current;
    const ctx = maskCtxRef.current;
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const r = brushSizeRef.current;
    ctx.save();
    // Erase to transparency
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fill();
    ctx.restore();
  };

  // Export current mask canvas as PNG
  const exportMaskPng = () => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "mask.png";
    a.click();
  };

  // Send mask PNG to Flux inline API via Next.js proxy
  const sendMaskToFlux = async () => {
    if (!maskCanvasRef.current) return;
    try {
      setGenerating(true);
      const canvas = maskCanvasRef.current;
      const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b as Blob), "image/png"));
      const form = new FormData();
      form.append("prompt", maskPrompt || "roblox shirt texture, high quality, clean edges");
      form.append("image", new File([blob], "input.png", { type: "image/png" }));
      const res = await fetch("/api/flux_inline", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        console.error("Flux request failed", await res.text());
        setGenerating(false);
        return;
      }
      const outBlob = await res.blob();
      const url = URL.createObjectURL(outBlob);
      setGeneratedFluxUrls((prev) => [url, ...prev].slice(0, 6));
    } catch (err) {
      console.error(err);
    } finally {
      setGenerating(false);
    }
  };

  // Removed single texture preview uploader per request
  // Progress ticker for Qwen status bar
  useEffect(() => {
    if (!qwenActive) {
      qwenStartRef.current = null;
      return;
    }
    qwenStartRef.current = performance.now();
    setQwenElapsedMs(0);
    const id = setInterval(() => {
      if (!qwenStartRef.current) return;
      setQwenElapsedMs(performance.now() - qwenStartRef.current);
    }, 200);
    return () => clearInterval(id);
  }, [qwenActive]);

  // Helper: capture currently applied shirt as a PNG blob
  const getCurrentShirtBlob = async (): Promise<Blob | null> => {
    // Prefer live canvas if painting is active
    if (shirtCanvasRef.current) {
      const blob: Blob = await new Promise((resolve) =>
        shirtCanvasRef.current!.toBlob((b) => resolve((b as Blob) || new Blob()), "image/png")
      );
      return blob;
    }
    // Try pulling from current shirt texture on shader uniforms
    try {
      const mat = shirtMatRef.current;
      if (mat && mat.uniforms && (mat.uniforms as Record<string, THREE.IUniform>).texture_shirt) {
        const tex = (mat.uniforms as Record<string, THREE.IUniform>).texture_shirt.value as THREE.Texture;
        const img = tex?.image as HTMLImageElement | HTMLCanvasElement | ImageBitmap | null;
        if (img) {
          const w =
            "naturalWidth" in (img as HTMLImageElement)
              ? ((img as HTMLImageElement).naturalWidth || (img as HTMLImageElement).width || 0)
              : ((img as HTMLCanvasElement | ImageBitmap).width || 0);
          const h =
            "naturalHeight" in (img as HTMLImageElement)
              ? ((img as HTMLImageElement).naturalHeight || (img as HTMLImageElement).height || 0)
              : ((img as HTMLCanvasElement | ImageBitmap).height || 0);
          if (w > 0 && h > 0) {
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const ctx = c.getContext("2d");
            if (ctx) {
              try {
                ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
                const blob: Blob = await new Promise((resolve) =>
                  c.toBlob((b) => resolve((b as Blob) || new Blob()), "image/png")
                );
                return blob;
              } catch {}
            }
          }
        }
      }
    } catch {}
    // Fallback to preview data URL if present
    if (shirtPreviewUrl) {
      try {
        const res = await fetch(shirtPreviewUrl);
        if (res.ok) return await res.blob();
      } catch {}
    }
    return null;
  };

  // Trigger Qwen image edit using current shirt texture; apply result to avatar
  const runQwenEdit = async () => {
    try {
      const blob = await getCurrentShirtBlob();
      if (!blob) {
        setModelStatus("No shirt texture to edit. Please apply a shirt first.");
        return;
      }
      setQwenActive(true);
      setQwenStatus("Submitting to Magic (Qwen)...");
      // Build form-data
      const form = new FormData();
      form.append("image", new File([blob], "shirt.png", { type: "image/png" }));
      if (qwenPrompt && qwenPrompt.trim()) form.append("prompt", qwenPrompt.trim());
      // Wait up to 3 minutes for response
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), QWEN_MAX_MS);
      const res = await fetch("/api/qwen_edit", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        try {
          const errTxt = await res.text();
          setModelStatus(`Magic failed: ${errTxt.slice(0, 140)}`);
        } catch {
          setModelStatus("Magic failed.");
        }
        return;
      }
      setQwenStatus("Applying edited texture…");
      const outBlob = await res.blob();
      const fileName = "qwen_edited.png";
      const outFile = new File([outBlob], fileName, { type: outBlob.type || "image/png" });
      // Apply to avatar
      await applyShirtAndPants(outFile, null);
      setShirtFileName(fileName);
      setModelStatus("Edited texture applied.");
    } catch (e) {
      setModelStatus("Magic request interrupted or failed.");
    } finally {
      setQwenActive(false);
      setQwenStatus(null);
    }
  };

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
        // Update mask panel preview from loaded shirt texture
        try {
          const img = shirtTex.image as HTMLImageElement | HTMLCanvasElement | ImageBitmap;
          const w =
            "naturalWidth" in (img as HTMLImageElement)
              ? ((img as HTMLImageElement).naturalWidth || (img as HTMLImageElement).width || 0)
              : ((img as HTMLCanvasElement | ImageBitmap).width || 0);
          const h =
            "naturalHeight" in (img as HTMLImageElement)
              ? ((img as HTMLImageElement).naturalHeight || (img as HTMLImageElement).height || 0)
              : ((img as HTMLCanvasElement | ImageBitmap).height || 0);
          if (w > 0 && h > 0) {
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const ctx = c.getContext("2d");
            if (ctx) {
              try {
                ctx.drawImage(img, 0, 0, w, h);
                const dataUrl = c.toDataURL("image/png");
                setShirtPreviewUrl(dataUrl);
              } catch {}
            }
          }
        } catch {}
      }
      if (pantsFile) {
        const pantsUrl = URL.createObjectURL(pantsFile);
        pantsTex = await loadTexture(pantsUrl, { flipY: true });
        URL.revokeObjectURL(pantsUrl);
      }

      // Apply shirt only to torso + arms; pants only to legs
      if (shirtTex) {
        const shirtMat = createShirtOnlyMaterial(shirtTex);
        shirtMatRef.current = shirtMat;
        // Apply current debug brightness values
        try {
          const u = shirtMat.uniforms as Record<string, THREE.IUniform>;
          if (u.base_brightness) u.base_brightness.value = clothBaseBrightness;
          if (u.brightness_gain) u.brightness_gain.value = clothBrightnessGain;
          if (u.contrast) u.contrast.value = clothContrast;
          if (u.gamma) u.gamma.value = clothGamma;
          shirtMat.needsUpdate = true;
        } catch {}
        applyMaterialToMeshesByName(
          loadedRootRef.current,
          shirtMat,
          /torso|upper\s*torso|arm|left\s*arm|right\s*arm/i
        );
        if (paintEnabled) {
          // Ensure canvas-based painting if enabled
          try {
            const uniforms = shirtMat.uniforms as Record<string, THREE.IUniform>;
            if (uniforms?.texture_shirt?.value) {
              // Trigger prepare via temporary call; actual ensure is inside useEffect handler
            }
          } catch {}
        }
      }
      if (pantsTex) {
        const pantsMat = createPantsOnlyMaterial(pantsTex);
        pantsMatRef.current = pantsMat;
        // Apply current debug brightness values
        try {
          const u = pantsMat.uniforms as Record<string, THREE.IUniform>;
          if (u.base_brightness) u.base_brightness.value = clothBaseBrightness;
          if (u.brightness_gain) u.brightness_gain.value = clothBrightnessGain;
          if (u.contrast) u.contrast.value = clothContrast;
          if (u.gamma) u.gamma.value = clothGamma;
          pantsMat.needsUpdate = true;
        } catch {}
        applyMaterialToMeshesByName(
          loadedRootRef.current,
          pantsMat,
          /leg|left\s*leg|right\s*leg/i
        );
        if (paintEnabled) {
          try {
            const uniforms = pantsMat.uniforms as Record<string, THREE.IUniform>;
            if (uniforms?.texture_pants?.value) {
              // see above
            }
          } catch {}
        }
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

  const onClearShirt = () => {
    setShirtFileName("");
    // Reset torso and arms back to white
    applyWhiteToMeshesByName(/torso|upper\s*torso|arm|left\s*arm|right\s*arm/i);
    shirtMatRef.current = null;
    shirtCanvasRef.current = null;
    shirtCtxRef.current = null;
    shirtCanvasTexRef.current = null;
  };
  const onClearPants = () => {
    setPantsFileName("");
    // Reset legs back to white
    applyWhiteToMeshesByName(/leg|left\s*leg|right\s*leg/i);
    pantsMatRef.current = null;
    pantsCanvasRef.current = null;
    pantsCtxRef.current = null;
    pantsCanvasTexRef.current = null;
  };

  // Toggle painting via keyboard (B)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "b") {
        setPaintEnabled((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Removed drag & drop handlers for single texture preview

  return (
    <div className="w-full">
      {/* moved file inputs to overlay container */}
      <div
        ref={containerRef}
        style={{
          height: `${displayHeightPx}px`,
          width: `${Math.round(displayHeightPx * PORTRAIT_ASPECT)}px`,
          maxWidth: "100%",
        }}
        className="rounded-md border border-black/10 dark:border-white/10 overflow-hidden relative"
        onMouseMove={(e) => {
          if (!containerRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          const panelW = rect.width * PANEL_WIDTH_PCT;
          const panelH = rect.height * PANEL_HEIGHT_PCT;
          // Drag skin tone panel
          if (isDraggingPanel && dragRef.current) {
            const dx = e.clientX - dragRef.current.startX;
            const dy = e.clientY - dragRef.current.startY;
            let newLeft = dragRef.current.startLeft + dx;
            let newTop = dragRef.current.startTop + dy;
            newLeft = Math.max(0, Math.min(newLeft, rect.width - panelW));
            newTop = Math.max(0, Math.min(newTop, rect.height - panelH));
            setPanelPos({ x: newLeft, y: newTop });
          }
          // Drag mask panel
          if (isDraggingMaskPanel && maskDragRef.current) {
            const dx = e.clientX - maskDragRef.current.startX;
            const dy = e.clientY - maskDragRef.current.startY;
            let newLeft = maskDragRef.current.startLeft + dx;
            let newTop = maskDragRef.current.startTop + dy;
            newLeft = Math.max(0, Math.min(newLeft, rect.width - panelW));
            newTop = Math.max(0, Math.min(newTop, rect.height - panelH));
            setMaskPanelPos({ x: newLeft, y: newTop });
          }
        }}
        onMouseUp={() => {
          setIsDraggingPanel(false);
          dragRef.current = null;
          setIsDraggingMaskPanel(false);
          maskDragRef.current = null;
        }}
        onMouseLeave={() => {
          setIsDraggingPanel(false);
          dragRef.current = null;
          setIsDraggingMaskPanel(false);
          maskDragRef.current = null;
        }}
      >
        {/* Magic button at top-right */}
        <button
          type="button"
          onClick={runQwenEdit}
          className="absolute top-2 right-2 h-8 w-8 rounded-full border border-black/60 dark:border-white/60 bg-transparent hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center"
          aria-label="Magic"
          title="Magic"
          style={{ zIndex: 7 }}
        >
          <span aria-hidden>✨</span>
        </button>
        {/* Prompt input for Magic (top-right, left of Magic button) */}
        <input
          type="text"
          value={qwenPrompt}
          onChange={(e) => setQwenPrompt(e.target.value)}
          placeholder="Describe your edit…"
          className="absolute top-2 right-12 max-w-[60%] sm:max-w-[70%] md:max-w-[75%] rounded-md border border-black/20 dark:border-white/20 bg-white/80 dark:bg-black/60 px-2 py-1 text-xs sm:text-sm"
          style={{ zIndex: 7 }}
        />
        {/* Apply buttons group (top-right) */}
        <div
          className="absolute top-20 right-2 flex flex-col gap-2 items-stretch"
          style={{ zIndex: 6 }}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => shirtInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-md border border-black/10 dark:border-white/10 px-3 py-1.5 text-xs sm:text-sm bg-white/80 dark:bg-black/60 hover:bg-white/90 dark:hover:bg-black/50 backdrop-blur"
              aria-label="Apply Shirt"
              title="Apply Shirt"
            >
              <span aria-hidden>🧥</span>
              <span>{shirtFileName || "Apply Shirt"}</span>
            </button>
            <button
              type="button"
              onClick={onClearShirt}
              className="rounded-md px-2 py-1 text-[11px] border border-black/10 dark:border-white/10 bg-white/70 dark:bg-black/50 hover:bg-white/90 dark:hover:bg-black/40"
              aria-label="Clear shirt"
              title="Clear shirt"
            >
              ✕
            </button>
          </div>
          <input
            ref={shirtInputRef}
            type="file"
            accept="image/png,image/jpeg"
            onChange={onShirtChange}
            className="hidden"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => pantsInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-md border border-black/10 dark:border-white/10 px-3 py-1.5 text-xs sm:text-sm bg-white/80 dark:bg-black/60 hover:bg-white/90 dark:hover:bg-black/50 backdrop-blur"
              aria-label="Apply Pants"
              title="Apply Pants"
            >
              <span aria-hidden>👖</span>
              <span>{pantsFileName || "Apply Pants"}</span>
            </button>
            <button
              type="button"
              onClick={onClearPants}
              className="rounded-md px-2 py-1 text-[11px] border border-black/10 dark:border-white/10 bg-white/70 dark:bg-black/50 hover:bg-white/90 dark:hover:bg-black/40"
              aria-label="Clear pants"
              title="Clear pants"
            >
              ✕
            </button>
          </div>
          <input
            ref={pantsInputRef}
            type="file"
            accept="image/png,image/jpeg"
            onChange={onPantsChange}
            className="hidden"
          />
          {/* Optional small filename indicators */}
          <div className="flex flex-col gap-1">
            {shirtFileName ? <span className="text-[10px] text-sky-600 dark:text-sky-300">{shirtFileName}</span> : null}
            {pantsFileName ? <span className="text-[10px] text-sky-600 dark:text-sky-300">{pantsFileName}</span> : null}
            {loadingClothes ? <span className="text-[10px] opacity-80">Applying clothing…</span> : null}
          </div>
        </div>
        {/* Debug panel toggle (bottom-left) */}
        <button
          type="button"
          onClick={() => setDebugOpen((v) => !v)}
          className="absolute bottom-2 left-2 h-7 w-7 rounded-full border border-black/60 dark:border-white/60 bg-transparent hover:bg-black/5 dark:hover:bg-white/10"
          aria-label="Open debug"
          title="Open debug"
          style={{ zIndex: 6 }}
        />

        {/* Panel overlay (75% of container) */}
        {panelOpen ? (
          <div
            className="absolute rounded-md border border-black/20 dark:border-white/20 shadow-xl bg-white/95 dark:bg-black/80"
            style={{
              top: panelPos ? `${panelPos.y}px` : "12.5%",
              left: panelPos ? `${panelPos.x}px` : "12.5%",
              width: `${PANEL_WIDTH_PCT * 100}%`,
              height: `${PANEL_HEIGHT_PCT * 100}%`,
              zIndex: 10,
            }}
          >
            {/* Drag handle (top area only) */}
            <div
              className="w-full cursor-move select-none text-xs opacity-70 px-3 py-2"
              onMouseDown={(e) => {
                // Only start dragging when grabbing the handle
                if ((e.target as HTMLElement).closest("button")) return;
                if (!containerRef.current) return;
                const rect = containerRef.current.getBoundingClientRect();
                const panelW = rect.width * PANEL_WIDTH_PCT;
                const panelH = rect.height * PANEL_HEIGHT_PCT;
                const currentLeft = panelPos?.x ?? (rect.width - panelW) / 2;
                const currentTop = panelPos?.y ?? (rect.height - panelH) / 2;
                dragRef.current = {
                  startX: e.clientX,
                  startY: e.clientY,
                  startLeft: currentLeft,
                  startTop: currentTop,
                };
                setIsDraggingPanel(true);
                e.preventDefault();
              }}
            >
              Skin Tone
            </div>
            {/* Panel content: 6 rows x 5 columns of circular color buttons */}
            <div ref={panelContentRef} className="w-full h-full p-4 overflow-hidden">
              <div
                className="grid place-items-center"
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
                  gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)`,
                  gap: `${PANEL_GAP_PX}px`,
                  width: "100%",
                  height: "100%",
                }}
              >
                {colorButtons.map(([r, g, b], idx) => (
                  <button
                    key={`${r}-${g}-${b}-${idx}`}
                    type="button"
                    className="rounded-full border border-neutral-600 dark:border-neutral-400 shadow-sm"
                    style={{
                      backgroundColor: `rgb(${r}, ${g}, ${b})`,
                      width: `${buttonSizePx}px`,
                      height: `${buttonSizePx}px`,
                    }}
                    title={`#${idx + 1} rgb(${r}, ${g}, ${b})`}
                    aria-label={`Color ${idx + 1}`}
                    onClick={() => setSkinColor(r, g, b)}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {/* Mask Panel overlay */}
        {maskPanelOpen ? (
          <div
            className="absolute rounded-md border border-black/20 dark:border-white/20 shadow-xl bg-white/95 dark:bg-black/80"
            style={{
              top: maskPanelPos ? `${maskPanelPos.y}px` : "12.5%",
              left: maskPanelPos ? `${maskPanelPos.x}px` : "12.5%",
              width: `${PANEL_WIDTH_PCT * 100}%`,
              height: `${PANEL_HEIGHT_PCT * 100}%`,
              zIndex: 11,
            }}
          >
            {/* Drag handle (top area only) */}
            <div
              className="w-full cursor-move select-none text-xs opacity-70 px-3 py-2"
              onMouseDown={(e) => {
                if ((e.target as HTMLElement).closest("button")) return;
                if (!containerRef.current) return;
                const rect = containerRef.current.getBoundingClientRect();
                const panelW = rect.width * PANEL_WIDTH_PCT;
                const panelH = rect.height * PANEL_HEIGHT_PCT;
                const currentLeft = maskPanelPos?.x ?? (rect.width - panelW) / 2;
                const currentTop = maskPanelPos?.y ?? (rect.height - panelH) / 2;
                maskDragRef.current = {
                  startX: e.clientX,
                  startY: e.clientY,
                  startLeft: currentLeft,
                  startTop: currentTop,
                };
                setIsDraggingMaskPanel(true);
                e.preventDefault();
              }}
            >
              Mask Editor
            </div>
            <div className="w-full h-full p-4 overflow-auto flex flex-col gap-3 items-center justify-start">
              <div className="w-full flex items-center justify-between">
                <span className="text-xs opacity-80">Magic brush: erase to transparency</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-500">Brush</span>
                  <input
                    type="range"
                    min={4}
                    max={64}
                    step={1}
                    defaultValue={brushSizeRef.current}
                    onChange={(e) => (brushSizeRef.current = parseInt(e.target.value || "14", 10))}
                  />
                </div>
              </div>
              <div className="w-full flex items-center gap-2">
                <input
                  type="text"
                  value={maskPrompt}
                  onChange={(e) => setMaskPrompt(e.target.value)}
                  className="flex-1 rounded-md border border-black/10 dark:border-white/10 px-3 py-1.5 text-sm bg-transparent"
                  placeholder="Prompt (optional)"
                />
                <button
                  type="button"
                  onClick={exportMaskPng}
                  className="inline-flex items-center gap-2 rounded-md border border-black/10 dark:border-white/10 px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10"
                  title="Export mask as PNG"
                >
                  ⬇️ Export
                </button>
                <button
                  type="button"
                  onClick={sendMaskToFlux}
                  disabled={generating || !shirtPreviewUrl}
                  className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${
                    generating
                      ? "bg-purple-400/60 text-white"
                      : "bg-purple-600 hover:bg-purple-700 text-white"
                  }`}
                  title="Send to Flux inline"
                >
                  {generating ? "Generating…" : "Flux"}
                </button>
              </div>
              <div className="w-full h-full flex items-center justify-center">
                {shirtPreviewUrl ? (
                  <canvas
                    ref={maskCanvasRef}
                    style={{
                      maxWidth: "100%",
                      maxHeight: "100%",
                      cursor: "crosshair",
                      imageRendering: "pixelated" as CSSProperties["imageRendering"],
                    }}
                    onPointerDown={onMaskPointerDown}
                    onPointerMove={onMaskPointerMove}
                    onPointerUp={onMaskPointerUp}
                    onContextMenu={(e) => e.preventDefault()}
                  />
                ) : (
                  <div className="text-sm opacity-80">Load a shirt to preview its template here.</div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* Debug Panel overlay */}
        {debugOpen ? (
          <div
            className="absolute rounded-md border border-black/20 dark:border-white/20 shadow-xl bg-white/95 dark:bg-black/80 p-3 text-xs"
            style={{
              bottom: "48px",
              left: "8px",
              width: "260px",
              zIndex: 12,
            }}
          >
            <div className="mb-2 font-medium opacity-80">Viewer Debug</div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="opacity-70">Target size</label>
              <input
                type="range"
                min={0.8}
                max={3.0}
                step={0.05}
                value={fitTarget}
                onChange={(e) => setFitTarget(parseFloat(e.target.value))}
              />
              <span className="tabular-nums w-10 text-right">{fitTarget.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="opacity-70">Fit</label>
              <select
                className="flex-1 bg-transparent border border-black/10 dark:border-white/10 rounded px-1 py-0.5"
                value={fitMode}
                onChange={(e) => setFitMode(e.target.value as FitMode)}
              >
                <option value="max">Max</option>
                <option value="height">Height</option>
                <option value="width">Width</option>
                <option value="depth">Depth</option>
              </select>
            </div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="opacity-70">Align</label>
              <select
                className="flex-1 bg-transparent border border-black/10 dark:border-white/10 rounded px-1 py-0.5"
                value={alignMode}
                onChange={(e) => setAlignMode(e.target.value as AlignMode)}
              >
                <option value="center">Center</option>
                <option value="feet">Feet on ground</option>
              </select>
            </div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="opacity-70">Yaw</label>
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={yawDeg}
                onChange={(e) => setYawDeg(parseInt(e.target.value || "0", 10))}
                disabled={faceCamera}
              />
              <span className="tabular-nums w-10 text-right">{yawDeg.toFixed(0)}°</span>
            </div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="opacity-70">Yaw offset</label>
              <input
                type="range"
                min={-90}
                max={90}
                step={1}
                value={yawOffsetDeg}
                onChange={(e) => setYawOffsetDeg(parseInt(e.target.value || "45", 10))}
              />
              <span className="tabular-nums w-10 text-right">{yawOffsetDeg.toFixed(0)}°</span>
            </div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="opacity-70">Auto face cam</label>
              <input
                type="checkbox"
                checked={faceCamera}
                onChange={(e) => setFaceCamera(e.target.checked)}
              />
            </div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="opacity-70">Y offset</label>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={yOffset}
                onChange={(e) => setYOffset(parseFloat(e.target.value))}
              />
              <span className="tabular-nums w-10 text-right">{yOffset.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="opacity-70">X screen offset</label>
              <input
                type="range"
                min={-0.5}
                max={0.5}
                step={0.01}
                value={xFrameOffset}
                onChange={(e) => setXFrameOffset(parseFloat(e.target.value))}
              />
              <span className="tabular-nums w-10 text-right">{xFrameOffset.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="opacity-70">FOV</label>
              <input
                type="range"
                min={30}
                max={80}
                step={1}
                value={fov}
                onChange={(e) => setFov(parseInt(e.target.value || "50", 10))}
              />
              <span className="tabular-nums w-10 text-right">{fov}</span>
            </div>
            <div className="mt-3 mb-1 font-medium opacity-80">Camera (Debug)</div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="opacity-70">Use camera angles</label>
              <input
                type="checkbox"
                checked={useDebugCamAngles}
                onChange={(e) => {
                  const checked = e.target.checked;
                  if (checked && cameraRef.current && controlsRef.current) {
                    // Seed from current camera orientation
                    const camera = cameraRef.current;
                    const controls = controlsRef.current;
                    const target = controls.target.clone();
                    const offset = camera.position.clone().sub(target);
                    const spherical = new THREE.Spherical().setFromVector3(offset);
                    setCamYawDeg(THREE.MathUtils.radToDeg(spherical.theta));
                    setCamTiltDeg(THREE.MathUtils.radToDeg(spherical.phi));
                  }
                  setUseDebugCamAngles(checked);
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="opacity-70">Yaw</label>
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={camYawDeg}
                onChange={(e) => setCamYawDeg(parseInt(e.target.value || "0", 10))}
                disabled={!useDebugCamAngles}
              />
              <span className="tabular-nums w-10 text-right">{camYawDeg.toFixed(0)}°</span>
            </div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="opacity-70">Tilt</label>
              <input
                type="range"
                min={1}
                max={179}
                step={1}
                value={camTiltDeg}
                onChange={(e) => setCamTiltDeg(parseInt(e.target.value || "20", 10))}
                disabled={!useDebugCamAngles}
              />
              <span className="tabular-nums w-10 text-right">{camTiltDeg.toFixed(0)}°</span>
            </div>
            <div className="mt-3 mb-1 font-medium opacity-80">Clothing Brightness</div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="opacity-70">Base brightness</label>
              <input
                type="range"
                min={0.5}
                max={1.4}
                step={0.01}
                value={clothBaseBrightness}
                onChange={(e) => setClothBaseBrightness(parseFloat(e.target.value))}
              />
              <span className="tabular-nums w-10 text-right">{clothBaseBrightness.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="opacity-70">Brightness gain</label>
              <input
                type="range"
                min={0.8}
                max={1.8}
                step={0.01}
                value={clothBrightnessGain}
                onChange={(e) => setClothBrightnessGain(parseFloat(e.target.value))}
              />
              <span className="tabular-nums w-10 text-right">{clothBrightnessGain.toFixed(2)}</span>
            </div>
            <div className="mt-3 mb-1 font-medium opacity-80">Clothing Tone</div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="opacity-70">Contrast</label>
              <input
                type="range"
                min={0.5}
                max={1.8}
                step={0.01}
                value={clothContrast}
                onChange={(e) => setClothContrast(parseFloat(e.target.value))}
              />
              <span className="tabular-nums w-10 text-right">{clothContrast.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="opacity-70">Gamma</label>
              <input
                type="range"
                min={0.6}
                max={3.0}
                step={0.01}
                value={clothGamma}
                onChange={(e) => setClothGamma(parseFloat(e.target.value))}
              />
              <span className="tabular-nums w-10 text-right">{clothGamma.toFixed(2)}</span>
            </div>
          </div>
        ) : null}

        {/* Qwen status bar overlay */}
        {qwenActive ? (
          <div className="absolute left-0 right-0 top-0 p-2" style={{ zIndex: 8 }}>
            <div className="h-2 rounded bg-black/30">
              <div
                className="h-2 rounded bg-purple-600"
                style={{
                  width: `${Math.max(
                    0,
                    Math.min(100, Math.round((qwenElapsedMs / QWEN_MAX_MS) * 100))
                  )}%`,
                }}
              />
            </div>
            <div className="mt-1 text-[10px] sm:text-xs text-white/90 drop-shadow">
              {qwenStatus || "Waiting for edited image… (up to 3 minutes)"}
            </div>
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-0 flex items-end justify-between p-2 gap-2">
          <span className="text-[10px] sm:text-xs bg-black/50 text-white px-2 py-1 rounded-md">{modelStatus || "Initializing viewer…"}</span>
        </div>
      </div>
      {/* Generated Flux outputs */}
      {generatedFluxUrls.length > 0 ? (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {generatedFluxUrls.map((u, i) => (
            <div key={i} className="border border-black/10 dark:border-white/10 rounded-md overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={`Flux output ${i + 1}`} className="w-full h-auto block" />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}



