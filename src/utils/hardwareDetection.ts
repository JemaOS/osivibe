// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Comprehensive Hardware Detection System
 * 
 * Detects GPU and processor capabilities to optimize video decoding and rendering.
 * Supports:
 * - Mobile GPUs: ARM Mali, Qualcomm Adreno, Apple GPU, PowerVR
 * - Desktop GPUs: NVIDIA GeForce, AMD Radeon, Intel (Iris Xe, Arc, UHD)
 * - Apple Silicon: M1, M2, M3, M4, M5 (and Pro/Max/Ultra variants)
 * - Mobile Processors: Snapdragon, MediaTek Dimensity, Samsung Exynos
 * - Desktop Processors: Intel Core, AMD Ryzen
 */

// ============================================================================
// Types and Interfaces
// ============================================================================

export type GPUVendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'arm' | 'qualcomm' | 'powervr' | 'unknown';
export type GPUTier = 'high' | 'medium' | 'low' | 'unknown';
export type ProcessorTier = 'high' | 'medium' | 'low';
export type MemoryTier = 'high' | 'medium' | 'low';
export type VideoResolution = '4k' | '1080p' | '720p' | '480p';
export type PreferredCodec = 'h265' | 'h264' | 'vp9' | 'av1';
export type PreviewQuality = 'high' | 'medium' | 'low';

export interface GPUProfile {
  vendor: GPUVendor;
  model: string;
  tier: GPUTier;
  supportsHardwareAcceleration: boolean;
  supportsWebGL2: boolean;
  supportsWebGPU: boolean;
  maxTextureSize: number;
  renderer: string;
  unmaskedVendor: string;
}

export interface ProcessorProfile {
  cores: number;
  isAppleSilicon: boolean;
  appleSiliconModel: string | null;
  tier: ProcessorTier;
  estimatedSpeed: 'fast' | 'medium' | 'slow';
}

export interface MemoryProfile {
  deviceMemory: number; // GB
  tier: MemoryTier;
}

export interface VideoRecommendations {
  maxVideoResolution: VideoResolution;
  preferredCodec: PreferredCodec;
  useHardwareDecoding: boolean;
  maxSimultaneousStreams: number;
  enableEffects: boolean;
  previewQuality: PreviewQuality;
  targetFps: number;
  enableFrameSkipping: boolean;
  bufferSizeMultiplier: number;
}

export interface HardwareProfile {
  gpu: GPUProfile;
  processor: ProcessorProfile;
  memory: MemoryProfile;
  recommendations: VideoRecommendations;
  deviceType: 'desktop' | 'mobile' | 'tablet';
  isMobile: boolean;
  isLowEnd: boolean;
  performanceScore: number; // 0-100
  detectionTimestamp: number;
}

export interface VideoSettings {
  resolution: { width: number; height: number };
  codec: PreferredCodec;
  bitrate: number;
  fps: number;
  useHardwareAcceleration: boolean;
  preloadStrategy: 'none' | 'metadata' | 'auto';
  bufferAhead: number; // seconds
  maxConcurrentDecodes: number;
}

// ============================================================================
// GPU Detection Patterns
// ============================================================================

const GPU_PATTERNS: Record<GPUVendor, RegExp> = {
  nvidia: /nvidia|geforce|rtx|gtx|quadro|tesla/i,
  amd: /amd|radeon|rx\s?\d|vega|navi/i,
  intel: /intel|iris|uhd\s*graphics|arc\s*a?\d|hd\s*graphics/i,
  apple: /apple|m1|m2|m3|m4|m5/i,
  arm: /mali|arm/i,
  qualcomm: /adreno|qualcomm/i,
  powervr: /powervr|imagination/i,
  unknown: /.*/,
};

// GPU Model Tier Classification
const GPU_TIER_PATTERNS = {
  high: {
    nvidia: /rtx\s*(40[89]0|4070|4080|4090|30[789]0|3080|3090)/i,
    amd: /rx\s*(7[89]00|6[89]00|6700\s*xt|6800|6900)/i,
    intel: /arc\s*a[57]|iris\s*xe\s*max/i,
    apple: /m[2-5]\s*(pro|max|ultra)|m[3-5]/i,
    qualcomm: /adreno\s*(7[45]0|740|730)/i,
    arm: /mali-g[789]\d{2}|mali-g720|mali-g710/i,
  },
  medium: {
    nvidia: /rtx\s*(3060|3050|2080|2070|2060)|gtx\s*(1[68]80|1[68]70|1660)/i,
    amd: /rx\s*(6[67]00|5[67]00|580|570)/i,
    intel: /arc\s*a[3]|iris\s*xe|iris\s*plus/i,
    apple: /m1\s*(pro|max)|m2/i,
    qualcomm: /adreno\s*(6[89]0|660|650|640|730)/i,
    arm: /mali-g[67]\d{2}|mali-g78|mali-g77|mali-g76/i,
  },
  low: {
    nvidia: /gtx\s*(1[0-5]\d{2}|9\d{2}|7\d{2})|mx\d{3}/i,
    amd: /rx\s*(5[0-4]0|4\d{2})|vega\s*[38]/i,
    intel: /uhd\s*(6[0-3]0|7[0-3]0)|hd\s*(5\d{2}|6\d{2})/i,
    apple: /m1(?!\s*(pro|max|ultra))/i,
    qualcomm: /adreno\s*([0-5]\d{2}|6[0-3]0)/i,
    arm: /mali-g[0-5]\d|mali-t\d{3}/i,
  },
};

// Apple Silicon Detection Patterns
const APPLE_SILICON_PATTERNS = {
  m5_ultra: /m5\s*ultra/i,
  m5_max: /m5\s*max/i,
  m5_pro: /m5\s*pro/i,
  m5: /m5(?!\s*(pro|max|ultra))/i,
  m4_ultra: /m4\s*ultra/i,
  m4_max: /m4\s*max/i,
  m4_pro: /m4\s*pro/i,
  m4: /m4(?!\s*(pro|max|ultra))/i,
  m3_ultra: /m3\s*ultra/i,
  m3_max: /m3\s*max/i,
  m3_pro: /m3\s*pro/i,
  m3: /m3(?!\s*(pro|max|ultra))/i,
  m2_ultra: /m2\s*ultra/i,
  m2_max: /m2\s*max/i,
  m2_pro: /m2\s*pro/i,
  m2: /m2(?!\s*(pro|max|ultra))/i,
  m1_ultra: /m1\s*ultra/i,
  m1_max: /m1\s*max/i,
  m1_pro: /m1\s*pro/i,
  m1: /m1(?!\s*(pro|max|ultra))/i,
};

// Mobile Device Detection Patterns
const HIGH_END_MOBILE_PATTERNS = [
  // Samsung Galaxy S series
  /sm-s9|sm-s8|sm-s7|galaxy\s*s2[0-9]/i,
  // Samsung Galaxy Fold/Flip
  /sm-f9|sm-f7|galaxy\s*z\s*(fold|flip)/i,
  // Google Pixel
  /pixel\s*[6-9]|pixel\s*pro/i,
  // OnePlus
  /oneplus\s*(1[0-9]|[89])/i,
  // Xiaomi flagships
  /xiaomi\s*(1[3-9]|14)|mi\s*(1[1-9])/i,
  // OPPO Find
  /find\s*x[3-9]|oppo\s*find/i,
  // Vivo X series
  /vivo\s*x[89]\d|vivo\s*x\s*(fold|flip)/i,
  // ASUS ROG
  /rog\s*phone\s*[5-9]/i,
  // Honor Magic
  /honor\s*magic|magic\s*v[s]?\d/i,
  // iPhone 12+
  /iphone\s*(1[2-9]|[2-9]\d)/i,
];

// ============================================================================
// Detection Functions
// ============================================================================

/**
 * Get WebGL context and renderer information
 */
function getWebGLInfo(): { renderer: string; vendor: string; webgl2: boolean; maxTextureSize: number } {
  const canvas = document.createElement('canvas');
  
  // Try WebGL2 first
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = canvas.getContext('webgl2');
  const webgl2 = !!gl;
  
  // Fall back to WebGL1
  if (!gl) {
    gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext | null;
  }
  
  if (!gl) {
    return { renderer: 'unknown', vendor: 'unknown', webgl2: false, maxTextureSize: 0 };
  }
  
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  let renderer = 'unknown';
  let vendor = 'unknown';
  
  if (debugInfo) {
    renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'unknown';
    vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || 'unknown';
  }
  
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
  
  return { renderer, vendor, webgl2, maxTextureSize };
}

/**
 * Check WebGPU support
 */
async function checkWebGPUSupport(): Promise<boolean> {
  if (!('gpu' in navigator)) {
    return false;
  }
  
  try {
    const adapter = await (navigator as any).gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

/**
 * Detect GPU vendor from renderer string
 */
function detectGPUVendor(renderer: string, vendor: string): GPUVendor {
  const combined = `${renderer} ${vendor}`.toLowerCase();
  
  // Check in order of specificity
  if (GPU_PATTERNS.apple.test(combined)) return 'apple';
  if (GPU_PATTERNS.nvidia.test(combined)) return 'nvidia';
  if (GPU_PATTERNS.amd.test(combined)) return 'amd';
  if (GPU_PATTERNS.qualcomm.test(combined)) return 'qualcomm';
  if (GPU_PATTERNS.arm.test(combined)) return 'arm';
  if (GPU_PATTERNS.powervr.test(combined)) return 'powervr';
  if (GPU_PATTERNS.intel.test(combined)) return 'intel';
  
  return 'unknown';
}

/**
 * Classify GPU tier based on model
 */
function classifyGPUTier(renderer: string, vendor: GPUVendor): GPUTier {
  // Check high tier patterns
  for (const [gpuVendor, pattern] of Object.entries(GPU_TIER_PATTERNS.high)) {
    if (pattern.test(renderer)) {
      return 'high';
    }
  }
  
  // Check medium tier patterns
  for (const [gpuVendor, pattern] of Object.entries(GPU_TIER_PATTERNS.medium)) {
    if (pattern.test(renderer)) {
      return 'medium';
    }
  }
  
  // Check low tier patterns
  for (const [gpuVendor, pattern] of Object.entries(GPU_TIER_PATTERNS.low)) {
    if (pattern.test(renderer)) {
      return 'low';
    }
  }
  
  // Default based on vendor
  switch (vendor) {
    case 'apple':
      return 'high'; // Apple GPUs are generally high-performance
    case 'nvidia':
    case 'amd':
      return 'medium'; // Unknown NVIDIA/AMD models are likely mid-range
    case 'qualcomm':
    case 'arm':
      return 'medium'; // Unknown mobile GPUs
    case 'intel':
    case 'powervr':
      return 'low'; // Integrated graphics
    default:
      return 'unknown';
  }
}

/**
 * Detect Apple Silicon model
 */
function detectAppleSiliconModel(renderer: string): string | null {
  for (const [model, pattern] of Object.entries(APPLE_SILICON_PATTERNS)) {
    if (pattern.test(renderer)) {
      return model.replace(/_/g, ' ').toUpperCase();
    }
  }
  
  // Check if it's Apple GPU but model unknown
  if (/apple/i.test(renderer)) {
    return 'Apple GPU (Unknown Model)';
  }
  
  return null;
}

/**
 * Detect device type
 */
function detectDeviceType(): 'desktop' | 'mobile' | 'tablet' {
  const ua = navigator.userAgent;
  
  // Check for tablets first
  if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) {
    return 'tablet';
  }
  
  // Check for mobile
  if (/Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    return 'mobile';
  }
  
  // Check screen size as fallback
  const screenWidth = window.screen.width;
  const screenHeight = window.screen.height;
  const minDimension = Math.min(screenWidth, screenHeight);
  
  if (minDimension < 768 && 'ontouchstart' in window) {
    return 'mobile';
  }
  
  return 'desktop';
}

/**
 * Check if device is high-end mobile
 */
function isHighEndMobile(): boolean {
  const ua = navigator.userAgent;
  
  for (const pattern of HIGH_END_MOBILE_PATTERNS) {
    if (pattern.test(ua)) {
      return true;
    }
  }
  
  // Check hardware concurrency as fallback
  const cores = navigator.hardwareConcurrency || 0;
  if (cores >= 8) {
    return true;
  }
  
  return false;
}

/**
 * Run performance benchmark
 */
function runBenchmark(): number {
  const startTime = performance.now();
  
  // CPU benchmark: array operations
  const iterations = 50000;
  const arr: number[] = [];
  
  for (let i = 0; i < iterations; i++) {
    arr.push(Math.sqrt(i) * Math.sin(i) * Math.cos(i));
  }
  
  arr.sort((a, b) => a - b);
  
  const cpuTime = performance.now() - startTime;
  
  // GPU benchmark: canvas operations
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  
  const gpuStart = performance.now();
  if (ctx) {
    for (let i = 0; i < 50; i++) {
      const gradient = ctx.createLinearGradient(0, 0, 512, 512);
      gradient.addColorStop(0, `rgb(${i * 5}, ${i * 3}, ${i * 2})`);
      gradient.addColorStop(1, `rgb(${255 - i * 5}, ${255 - i * 3}, ${255 - i * 2})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 512, 512);
    }
  }
  const gpuTime = performance.now() - gpuStart;
  
  // Calculate score (lower time = higher score)
  // Typical ranges:
  // - High-end: CPU < 15ms, GPU < 20ms
  // - Mid-range: CPU 15-40ms, GPU 20-50ms
  // - Low-end: CPU > 40ms, GPU > 50ms
  
  const cpuScore = Math.max(0, Math.min(50, 50 - (cpuTime - 5) * 1.5));
  const gpuScore = Math.max(0, Math.min(50, 50 - (gpuTime - 10)));
  
  return Math.round(cpuScore + gpuScore);
}

/**
 * Classify processor tier
 */
function classifyProcessorTier(cores: number, isAppleSilicon: boolean, benchmarkScore: number): ProcessorTier {
  if (isAppleSilicon) {
    return 'high';
  }
  
  if (benchmarkScore >= 70 || cores >= 12) {
    return 'high';
  }
  
  if (benchmarkScore >= 40 || cores >= 6) {
    return 'medium';
  }
  
  return 'low';
}

/**
 * Classify memory tier
 */
function classifyMemoryTier(deviceMemory: number): MemoryTier {
  if (deviceMemory >= 8) {
    return 'high';
  }
  
  if (deviceMemory >= 4) {
    return 'medium';
  }
  
  return 'low';
}

/**
 * Generate video recommendations based on hardware profile
 */
function generateRecommendations(
  gpu: GPUProfile,
  processor: ProcessorProfile,
  memory: MemoryProfile,
  deviceType: 'desktop' | 'mobile' | 'tablet',
  performanceScore: number
): VideoRecommendations {
  const isMobile = deviceType === 'mobile' || deviceType === 'tablet';
  
  // Determine max resolution
  let maxVideoResolution: VideoResolution = '720p';
  
  if (gpu.tier === 'high' && processor.tier === 'high' && memory.tier !== 'low') {
    maxVideoResolution = '4k';
  } else if (
    (gpu.tier === 'high' || gpu.tier === 'medium') &&
    (processor.tier === 'high' || processor.tier === 'medium') &&
    memory.tier !== 'low'
  ) {
    maxVideoResolution = '1080p';
  } else if (gpu.tier !== 'unknown' && processor.tier !== 'low') {
    maxVideoResolution = '720p';
  } else {
    maxVideoResolution = '480p';
  }
  
  // Mobile adjustments
  if (isMobile && maxVideoResolution === '4k') {
    maxVideoResolution = '1080p'; // Cap mobile at 1080p for battery
  }
  
  // Determine preferred codec
  let preferredCodec: PreferredCodec = 'h264';
  
  if (gpu.tier === 'high' && gpu.supportsHardwareAcceleration) {
    // High-end with hardware acceleration can handle modern codecs
    if (gpu.vendor === 'apple' || gpu.vendor === 'nvidia') {
      preferredCodec = 'h265';
    } else if (gpu.supportsWebGPU) {
      preferredCodec = 'av1';
    } else {
      preferredCodec = 'vp9';
    }
  } else if (gpu.tier === 'medium') {
    preferredCodec = 'h264'; // Safest choice for mid-range
  }
  
  // Hardware decoding
  const useHardwareDecoding = gpu.supportsHardwareAcceleration && gpu.tier !== 'low';
  
  // Simultaneous streams
  let maxSimultaneousStreams = 1;
  if (gpu.tier === 'high' && processor.tier === 'high') {
    maxSimultaneousStreams = 4;
  } else if (gpu.tier === 'medium' || processor.tier === 'medium') {
    maxSimultaneousStreams = 2;
  }
  
  // Effects
  const enableEffects = gpu.tier !== 'low' && processor.tier !== 'low';
  
  // Preview quality
  let previewQuality: PreviewQuality = 'medium';
  if (performanceScore >= 70) {
    previewQuality = 'high';
  } else if (performanceScore < 40) {
    previewQuality = 'low';
  }
  
  // Target FPS
  let targetFps = 30;
  if (gpu.tier === 'high' && !isMobile) {
    targetFps = 60;
  } else if (gpu.tier === 'low' || performanceScore < 30) {
    targetFps = 24;
  }
  
  // Frame skipping
  const enableFrameSkipping = performanceScore < 40 || (isMobile && performanceScore < 60);
  
  // Buffer size multiplier
  let bufferSizeMultiplier = 1.0;
  if (memory.tier === 'high') {
    bufferSizeMultiplier = 2.0;
  } else if (memory.tier === 'low') {
    bufferSizeMultiplier = 0.5;
  }
  
  return {
    maxVideoResolution,
    preferredCodec,
    useHardwareDecoding,
    maxSimultaneousStreams,
    enableEffects,
    previewQuality,
    targetFps,
    enableFrameSkipping,
    bufferSizeMultiplier,
  };
}

// ============================================================================
// Main Detection Function
// ============================================================================

/**
 * Detect hardware capabilities and generate optimization profile
 */
export async function detectHardware(): Promise<HardwareProfile> {
  console.log('🔍 Starting comprehensive hardware detection...');
  
  // Get WebGL info
  const webglInfo = getWebGLInfo();
  console.log('📊 WebGL Info:', webglInfo);
  
  // Check WebGPU support
  const webgpuSupport = await checkWebGPUSupport();
  console.log('🎮 WebGPU Support:', webgpuSupport);
  
  // Detect GPU
  const gpuVendor = detectGPUVendor(webglInfo.renderer, webglInfo.vendor);
  const gpuTier = classifyGPUTier(webglInfo.renderer, gpuVendor);
  const appleSiliconModel = detectAppleSiliconModel(webglInfo.renderer);
  
  const gpu: GPUProfile = {
    vendor: gpuVendor,
    model: webglInfo.renderer,
    tier: gpuTier,
    supportsHardwareAcceleration: webglInfo.webgl2 || gpuVendor !== 'unknown',
    supportsWebGL2: webglInfo.webgl2,
    supportsWebGPU: webgpuSupport,
    maxTextureSize: webglInfo.maxTextureSize,
    renderer: webglInfo.renderer,
    unmaskedVendor: webglInfo.vendor,
  };
  
  console.log('🎨 GPU Profile:', gpu);
  
  // Detect processor
  const cores = navigator.hardwareConcurrency || 2;
  const benchmarkScore = runBenchmark();
  const isAppleSilicon = !!appleSiliconModel;
  const processorTier = classifyProcessorTier(cores, isAppleSilicon, benchmarkScore);
  
  const processor: ProcessorProfile = {
    cores,
    isAppleSilicon,
    appleSiliconModel,
    tier: processorTier,
    estimatedSpeed: benchmarkScore >= 60 ? 'fast' : benchmarkScore >= 30 ? 'medium' : 'slow',
  };
  
  console.log('⚡ Processor Profile:', processor);
  
  // Detect memory
  // @ts-ignore - deviceMemory is not in all browsers
  const deviceMemory = navigator.deviceMemory || 4; // Default to 4GB if not available
  const memoryTier = classifyMemoryTier(deviceMemory);
  
  const memory: MemoryProfile = {
    deviceMemory,
    tier: memoryTier,
  };
  
  console.log('💾 Memory Profile:', memory);
  
  // Detect device type
  const deviceType = detectDeviceType();
  const isMobile = deviceType === 'mobile' || deviceType === 'tablet';
  
  // Calculate overall performance score
  let performanceScore = benchmarkScore;
  
  // Adjust based on GPU tier
  if (gpu.tier === 'high') {
    performanceScore = Math.min(100, performanceScore + 15);
  } else if (gpu.tier === 'low') {
    performanceScore = Math.max(0, performanceScore - 15);
  }
  
  // Adjust for Apple Silicon
  if (isAppleSilicon) {
    performanceScore = Math.min(100, performanceScore + 20);
  }
  
  // Adjust for high-end mobile
  if (isMobile && isHighEndMobile()) {
    performanceScore = Math.min(100, performanceScore + 10);
  }
  
  // Determine if low-end
  const isLowEnd = performanceScore < 35 || (gpu.tier === 'low' && processor.tier === 'low');
  
  // Generate recommendations
  const recommendations = generateRecommendations(gpu, processor, memory, deviceType, performanceScore);
  
  const profile: HardwareProfile = {
    gpu,
    processor,
    memory,
    recommendations,
    deviceType,
    isMobile,
    isLowEnd,
    performanceScore,
    detectionTimestamp: Date.now(),
  };
  
  console.log('🖥️ Complete Hardware Profile:', profile);
  
  return profile;
}

// ============================================================================
// Video Settings Generator
// ============================================================================

/**
 * Get optimal video settings based on hardware profile
 */
export function getOptimalVideoSettings(profile: HardwareProfile): VideoSettings {
  const { recommendations, isMobile } = profile;
  
  // Resolution mapping
  const resolutionMap: Record<VideoResolution, { width: number; height: number }> = {
    '4k': { width: 3840, height: 2160 },
    '1080p': { width: 1920, height: 1080 },
    '720p': { width: 1280, height: 720 },
    '480p': { width: 854, height: 480 },
  };
  
  const resolution = resolutionMap[recommendations.maxVideoResolution];
  
  // Bitrate based on resolution and quality
  let bitrate = 5000000; // 5 Mbps default
  switch (recommendations.maxVideoResolution) {
    case '4k':
      bitrate = 25000000; // 25 Mbps
      break;
    case '1080p':
      bitrate = 8000000; // 8 Mbps
      break;
    case '720p':
      bitrate = 5000000; // 5 Mbps
      break;
    case '480p':
      bitrate = 2500000; // 2.5 Mbps
      break;
  }
  
  // Preload strategy
  let preloadStrategy: 'none' | 'metadata' | 'auto' = 'auto';
  if (isMobile || profile.memory.tier === 'low') {
    preloadStrategy = 'metadata';
  }
  
  // Buffer ahead
  let bufferAhead = 5; // seconds
  if (profile.memory.tier === 'high') {
    bufferAhead = 10;
  } else if (profile.memory.tier === 'low') {
    bufferAhead = 2;
  }
  
  return {
    resolution,
    codec: recommendations.preferredCodec,
    bitrate,
    fps: recommendations.targetFps,
    useHardwareAcceleration: recommendations.useHardwareDecoding,
    preloadStrategy,
    bufferAhead,
    maxConcurrentDecodes: recommendations.maxSimultaneousStreams,
  };
}

// ============================================================================
// React Hook
// ============================================================================

let cachedProfile: HardwareProfile | null = null;
let profilePromise: Promise<HardwareProfile> | null = null;

/**
 * Get hardware profile (cached)
 */
export async function getHardwareProfile(): Promise<HardwareProfile> {
  if (cachedProfile) {
    return cachedProfile;
  }
  
  if (profilePromise) {
    return profilePromise;
  }
  
  profilePromise = detectHardware().then(profile => {
    cachedProfile = profile;
    return profile;
  });
  
  return profilePromise;
}

/**
 * Clear cached profile (useful for testing or re-detection)
 */
export function clearHardwareProfileCache(): void {
  cachedProfile = null;
  profilePromise = null;
}

/**
 * Get cached profile synchronously (returns null if not yet detected)
 */
export function getCachedHardwareProfile(): HardwareProfile | null {
  return cachedProfile;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if hardware supports a specific codec
 */
export function supportsCodec(codec: PreferredCodec, profile: HardwareProfile): boolean {
  const { gpu } = profile;
  
  switch (codec) {
    case 'av1':
      // AV1 requires WebGPU or very modern hardware
      return gpu.supportsWebGPU || (gpu.tier === 'high' && gpu.vendor === 'nvidia');
    case 'h265':
      // H.265/HEVC requires hardware acceleration
      return gpu.supportsHardwareAcceleration && (gpu.vendor === 'apple' || gpu.vendor === 'nvidia' || gpu.vendor === 'amd');
    case 'vp9':
      // VP9 is widely supported
      return gpu.supportsWebGL2;
    case 'h264':
      // H.264 is universally supported
      return true;
    default:
      return false;
  }
}

/**
 * Get recommended export settings based on hardware
 */
export function getRecommendedExportSettings(profile: HardwareProfile): {
  resolution: '720p' | '1080p' | '4K';
  fps: '30' | '60';
  quality: 'low' | 'medium' | 'high';
} {
  const { recommendations, performanceScore } = profile;
  
  let resolution: '720p' | '1080p' | '4K' = '1080p';
  if (recommendations.maxVideoResolution === '4k') {
    resolution = '4K';
  } else if (recommendations.maxVideoResolution === '480p' || recommendations.maxVideoResolution === '720p') {
    resolution = '720p';
  }
  
  const fps: '30' | '60' = recommendations.targetFps >= 60 ? '60' : '30';
  
  let quality: 'low' | 'medium' | 'high' = 'medium';
  if (performanceScore >= 70) {
    quality = 'high';
  } else if (performanceScore < 40) {
    quality = 'low';
  }
  
  return { resolution, fps, quality };
}

/**
 * Format hardware profile for display
 */
export function formatHardwareProfileForDisplay(profile: HardwareProfile): string {
  const lines: string[] = [];
  
  lines.push(`GPU: ${profile.gpu.model}`);
  lines.push(`  Vendor: ${profile.gpu.vendor}`);
  lines.push(`  Tier: ${profile.gpu.tier}`);
  lines.push(`  WebGL2: ${profile.gpu.supportsWebGL2 ? 'Yes' : 'No'}`);
  lines.push(`  WebGPU: ${profile.gpu.supportsWebGPU ? 'Yes' : 'No'}`);
  
  lines.push(`\nProcessor:`);
  lines.push(`  Cores: ${profile.processor.cores}`);
  if (profile.processor.isAppleSilicon) {
    lines.push(`  Apple Silicon: ${profile.processor.appleSiliconModel}`);
  }
  lines.push(`  Tier: ${profile.processor.tier}`);
  
  lines.push(`\nMemory: ${profile.memory.deviceMemory}GB (${profile.memory.tier})`);
  
  lines.push(`\nDevice: ${profile.deviceType}`);
  lines.push(`Performance Score: ${profile.performanceScore}/100`);
  
  lines.push(`\nRecommendations:`);
  lines.push(`  Max Resolution: ${profile.recommendations.maxVideoResolution}`);
  lines.push(`  Preferred Codec: ${profile.recommendations.preferredCodec}`);
  lines.push(`  Hardware Decoding: ${profile.recommendations.useHardwareDecoding ? 'Yes' : 'No'}`);
  lines.push(`  Target FPS: ${profile.recommendations.targetFps}`);
  lines.push(`  Preview Quality: ${profile.recommendations.previewQuality}`);
  
  return lines.join('\n');
}

// ============================================================================
// React Hook for Hardware Profile
// ============================================================================

import { useState, useEffect } from 'react';

/**
 * React hook to use hardware profile in components
 * Automatically detects hardware on mount and provides loading state
 */
export function useHardwareProfile(): {
  profile: HardwareProfile | null;
  isLoading: boolean;
  error: Error | null;
  videoSettings: VideoSettings | null;
} {
  const [profile, setProfile] = useState<HardwareProfile | null>(getCachedHardwareProfile());
  const [isLoading, setIsLoading] = useState(!cachedProfile);
  const [error, setError] = useState<Error | null>(null);
  const [videoSettings, setVideoSettings] = useState<VideoSettings | null>(
    cachedProfile ? getOptimalVideoSettings(cachedProfile) : null
  );

  useEffect(() => {
    if (cachedProfile) {
      setProfile(cachedProfile);
      setVideoSettings(getOptimalVideoSettings(cachedProfile));
      setIsLoading(false);
      return;
    }

    let mounted = true;

    getHardwareProfile()
      .then((detectedProfile) => {
        if (mounted) {
          setProfile(detectedProfile);
          setVideoSettings(getOptimalVideoSettings(detectedProfile));
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setIsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  return { profile, isLoading, error, videoSettings };
}

// ============================================================================
// Export Default
// ============================================================================

export default {
  detectHardware,
  getOptimalVideoSettings,
  getHardwareProfile,
  clearHardwareProfileCache,
  getCachedHardwareProfile,
  supportsCodec,
  getRecommendedExportSettings,
  formatHardwareProfileForDisplay,
  useHardwareProfile,
};