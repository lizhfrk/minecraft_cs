/**
 * 世界渲染材质：烘焙体素光照 + 玩家火把动态光 + 距离雾。
 * 使用自定义着色器，使方块表面保持 Minecraft 的"纯色 + 烘焙阴影"质感。
 * @module world/materials
 */
import * as THREE from 'three';

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 color;
  varying vec2 vUv;
  varying vec3 vLight;
  varying float vFogDepth;
  varying vec3 vWorldPos;

  void main() {
    vUv = uv;
    vLight = color;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vec4 mvPosition = viewMatrix * worldPos;
    vFogDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  uniform vec3 torchPos;
  uniform vec3 torchColor;
  uniform float torchRadius;
  uniform float ambientFloor;

  varying vec2 vUv;
  varying vec3 vLight;
  varying float vFogDepth;
  varying vec3 vWorldPos;

  void main() {
    vec4 texel = texture2D(map, vUv);
    if (texel.a < 0.02) discard;

    // vLight: 烘焙的光照 * 环境底光
    vec3 baked = vLight * (ambientFloor + (1.0 - ambientFloor));
    vec3 base = texel.rgb * baked;

    // 玩家手持火把的动态光
    float d = distance(vWorldPos, torchPos);
    float att = clamp(1.0 - d / torchRadius, 0.0, 1.0);
    att = att * att * (3.0 - 2.0 * att);
    vec3 torch = torchColor * att;
    vec3 lit = base + torch * (1.0 - base) * 0.5;

    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    vec3 color = mix(lit, fogColor, fogFactor);

    gl_FragColor = vec4(color, texel.a);
    #include <colorspace_fragment>
  }
`;

/**
 * 创建世界材质（不透明 + 半透明两套，共享 uniform）。
 * @param {THREE.Texture} atlasTexture
 */
export function createWorldMaterials(atlasTexture) {
  const uniforms = {
    map: { value: atlasTexture },
    fogColor: { value: new THREE.Color(0x090c12).convertSRGBToLinear() },
    fogNear: { value: 6 },
    fogFar: { value: 48 },
    torchPos: { value: new THREE.Vector3(0, 0, 0) },
    torchColor: { value: new THREE.Color(0xffedd8).convertSRGBToLinear() },
    torchRadius: { value: 8.5 },
    ambientFloor: { value: 0.13 },
  };

  /** @param {boolean} transparent */
  const make = (transparent) =>
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent,
      depthWrite: !transparent,
      side: THREE.FrontSide,
    });

  return {
    uniforms,
    opaque: make(false),
    transparent: make(true),
    /** 设置雾与背景氛围（进入末地时切换为紫色调）。 */
    setAtmosphere(fogHex, fogNear, fogFar, bgHex) {
      uniforms.fogColor.value.set(fogHex).convertSRGBToLinear();
      uniforms.fogNear.value = fogNear;
      uniforms.fogFar.value = fogFar;
      if (bgHex !== undefined) {
        uniforms.fogColor.value.set(fogHex).convertSRGBToLinear();
      }
    },
  };
}
