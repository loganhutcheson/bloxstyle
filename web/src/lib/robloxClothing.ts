import * as THREE from "three";

export type ClothingMaterialUniforms = {
  albedo: { value: THREE.Color };
  alpha_shirt: { value: number };
  alpha_pants: { value: number };
  texture_shirt: { value: THREE.Texture | null };
  texture_pants: { value: THREE.Texture | null };
  uv1_scale: { value: THREE.Vector3 };
  uv1_offset: { value: THREE.Vector3 };
  base_brightness: { value: number };
  brightness_gain: { value: number };
  contrast: { value: number };
  gamma: { value: number };
};

// Port of BloxClothViewer shd_Clothing.shader to Three.js ShaderMaterial.
export function createRobloxClothingMaterial(): THREE.ShaderMaterial {
  const uniforms: ClothingMaterialUniforms = {
    // Default to white base, but dimmed by base_brightness for transparent regions
    albedo: { value: new THREE.Color(1, 1, 1) },
    alpha_shirt: { value: 1.0 },
    alpha_pants: { value: 1.0 },
    texture_shirt: { value: null },
    texture_pants: { value: null },
    uv1_scale: { value: new THREE.Vector3(1, 1, 0) },
    uv1_offset: { value: new THREE.Vector3(0, 0, 0) },
    base_brightness: { value: 0.88 },
    // Lift overall output so clothing textures appear brighter in the viewer
    brightness_gain: { value: 1.15 },
    // Perceived contrast around mid-grey (1.0 = no change)
    contrast: { value: 1.0 },
    // Simple gamma correction (1.0 = no change)
    gamma: { value: 1.0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec2 vUv;
      uniform vec3 uv1_scale;
      uniform vec3 uv1_offset;
      void main() {
        vUv = (uv * uv1_scale.xy) + uv1_offset.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform vec3 albedo;
      uniform float base_brightness;
      uniform float brightness_gain;
      uniform float contrast;
      uniform float gamma;
      uniform float alpha_shirt;
      uniform float alpha_pants;
      uniform sampler2D texture_shirt;
      uniform sampler2D texture_pants;
      void main() {
        vec2 base_uv = vUv;
        vec4 shirt_tex = texture2D(texture_shirt, base_uv);
        vec4 pants_tex = texture2D(texture_pants, base_uv);
        float baseFactor = (1.0 - shirt_tex.a * alpha_shirt) * (1.0 - pants_tex.a * alpha_pants);
        vec3 base_rgb = albedo.rgb * base_brightness;
        vec3 mix_rgb = (base_rgb * baseFactor)
                     + mix((pants_tex.rgb * pants_tex.a * alpha_pants),
                           (shirt_tex.rgb * shirt_tex.a * alpha_shirt),
                           alpha_shirt * shirt_tex.a);
        // Apply contrast around 0.5
        vec3 contrasted = (mix_rgb - 0.5) * contrast + 0.5;
        // Apply gamma correction
        vec3 gamma_corrected = pow(max(contrasted, vec3(0.0)), vec3(1.0 / max(gamma, 0.0001)));
        gl_FragColor = vec4(gamma_corrected * brightness_gain, 1.0);
      }
    `,
    transparent: false,
    depthWrite: true,
  });

  // Ensure correct color space for maps assigned later
  material.defines = material.defines || {};
  return material;
}

export async function loadTexture(
  url: string,
  opts?: { flipY?: boolean }
): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        // For OBJ/standard UVs, flipY should generally be true.
        // For GLTF, you'd set flipY=false. Default to true here.
        tex.flipY = opts?.flipY !== undefined ? opts.flipY : true;
        resolve(tex);
      },
      undefined,
      (err) => reject(err)
    );
  });
}

export function applyClothingMaterialToMeshes(
  root: THREE.Object3D,
  material: THREE.ShaderMaterial
): void {
  const targetNameRegex =
    /torso|upper\s*torso|arm|leg|left\s*arm|right\s*arm|left\s*leg|right\s*leg|body/i;
  root.traverse((o: THREE.Object3D) => {
    if (o instanceof THREE.Mesh) {
      const name = (o.name || "").toString();
      if (targetNameRegex.test(name)) {
        o.material = material;
      }
    }
  });
}

export function applyMaterialToMeshesByName(
  root: THREE.Object3D,
  material: THREE.Material,
  nameRegex: RegExp
): void {
  root.traverse((o: THREE.Object3D) => {
    if (o instanceof THREE.Mesh) {
      const name = (o.name || "").toString();
      if (nameRegex.test(name)) {
        o.material = material;
      }
    }
  });
}

export function createShirtOnlyMaterial(shirtTex: THREE.Texture): THREE.ShaderMaterial {
  const mat = createRobloxClothingMaterial();
  mat.uniforms.texture_shirt.value = shirtTex;
  mat.uniforms.alpha_shirt.value = 1.0;
  mat.uniforms.texture_pants.value = null;
  mat.uniforms.alpha_pants.value = 0.0;
  return mat;
}

export function createPantsOnlyMaterial(pantsTex: THREE.Texture): THREE.ShaderMaterial {
  const mat = createRobloxClothingMaterial();
  mat.uniforms.texture_shirt.value = null;
  mat.uniforms.alpha_shirt.value = 0.0;
  mat.uniforms.texture_pants.value = pantsTex;
  mat.uniforms.alpha_pants.value = 1.0;
  return mat;
}


