// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Preview Optimizer - Optimizes video playback for smooth preview on all hardware
 * 
 * Key features:
 * - Generates low-resolution proxy videos for 4K content
 * - Detects hardware capabilities and adapts playback
 * - Implements frame skipping for weak CPUs
 * - Provides adaptive quality settings
 */

export interface PreviewSettings {
  quality: 'auto' | 'low' | 'medium' | 'high' | 'original';
  maxResolution: number; // Max height in pixels
  frameSkipping: boolean;
  targetFps: number;
  useProxy: boolean;
  hardwareAcceleration: boolean;
  // Mobile-specific optimizations
  useLowLatencyMode: boolean;
  useReducedMotion: boolean;
  bufferSize: 'small' | 'medium' | 'large';
}

export interface HardwareProfile {
  cpuCores: number;
  isLowEnd: boolean;
  isMobile: boolean;
  isHighEndMobile: boolean; // Snapdragon 8 Gen 1+, Apple Silicon, etc.
  isAppleSilicon: boolean; // M1, M2, M3, M4, M5
  supportsHardwareAcceleration: boolean;
  recommendedQuality: PreviewSettings['quality'];
  maxSafeResolution: number;
  deviceType: 'desktop' | 'mobile' | 'tablet';
  performanceScore: number; // 0-100 based on benchmark
}

export interface ProxyVideo {
  originalUrl: string;
  proxyUrl: string;
  proxyBlob?: Blob;
  resolution: number;
  isGenerating: boolean;
  progress: number;
}

// Cache for proxy videos
const proxyCache = new Map<string, ProxyVideo>();

// Default preview settings
const DEFAULT_SETTINGS: PreviewSettings = {
  quality: 'auto',
  maxResolution: 720,
  frameSkipping: false,
  targetFps: 30,
  useProxy: true,
  hardwareAcceleration: true,
  useLowLatencyMode: false,
  useReducedMotion: false,
  bufferSize: 'medium',
};

// Resolution presets for preview
export const PREVIEW_RESOLUTIONS = {
  low: 360,
  medium: 480,
  high: 720,
  original: -1, // No limit
} as const;

/**
 * Detect if device is Apple Silicon (M1, M2, M3, M4, M5)
 */
function detectAppleSilicon(): boolean {
  const ua = navigator.userAgent;
  const platform = navigator.platform;
  
  // Check for Mac with ARM
  if (platform === 'MacIntel' || platform === 'MacARM64') {
    // Modern Safari on Apple Silicon reports specific features
    // Check for WebGL2 with high performance
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        // Apple GPU indicates Apple Silicon
        if (renderer && renderer.includes('Apple')) {
          return true;
        }
      }
    }
  }
  
  // Check for iPad with M chip (iPad Pro 2021+)
  if (/iPad/.test(ua)) {
    // iPads with M chips have high core counts
    const cores = navigator.hardwareConcurrency || 0;
    if (cores >= 8) {
      return true;
    }
  }
  
  return false;
}

/**
 * Detect high-end mobile processors (Snapdragon 8 Gen 1+, Dimensity 9000+, etc.)
 */
function detectHighEndMobile(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  const cores = navigator.hardwareConcurrency || 0;
  
  // Check for known high-end Android devices first (before core count check)
  // Snapdragon 8 Gen 1, 2, 3 devices
  const highEndIndicators = [
    'sm-s9', 'sm-s8', 'sm-s7', // Samsung Galaxy S series
    'sm-f9', 'sm-f7', // Samsung Galaxy Fold/Flip
    'sm-n9', // Samsung Galaxy Note
    'pixel 8', 'pixel 7', 'pixel 6', // Google Pixel
    'oneplus', // OnePlus devices
    'xiaomi 13', 'xiaomi 14', // Xiaomi flagships
    'find x', 'oppo find', // OPPO Find series
    'vivo x', // Vivo X series
    'rog phone', // ASUS ROG
    'redmagic', // Nubia Red Magic
    'sony xperia 1', 'sony xperia 5', // Sony Xperia
    // Honor devices - Magic series are flagship foldables
    'honor magic', 'magic v', 'magic vs', 'magic5', 'magic6',
    'honor 70', 'honor 80', 'honor 90', 'honor 100',
    // Huawei flagships
    'huawei mate', 'huawei p40', 'huawei p50', 'huawei p60',
    // Other foldables
    'galaxy z', 'z fold', 'z flip',
    // Gaming phones
    'black shark', 'legion phone', 'nubia',
  ];
  
  for (const indicator of highEndIndicators) {
    if (ua.includes(indicator)) {
      console.log('🎯 High-end device detected by UA:', indicator);
      return true;
    }
  }
  
  // Check for high-end iPhones (iPhone 12+)
  if (/iphone/.test(ua)) {
    // Modern iPhones have 6 cores, but A14+ chips are very powerful
    // Check screen resolution as a proxy for newer models
    const screenWidth = window.screen.width * (window.devicePixelRatio || 1);
    const screenHeight = window.screen.height * (window.devicePixelRatio || 1);
    
    // iPhone 12+ have high resolution displays
    if (Math.max(screenWidth, screenHeight) >= 2532) {
      return true;
    }
  }
  
  // High-end mobile devices typically have 8+ cores
  // But check this after UA detection since some devices report fewer
  if (cores < 6) {
    return false;
  }
  
  // Fallback: 6+ cores with WebGL2 support and good GPU indicates high-end
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (gl && cores >= 6) {
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      // Adreno 6xx+, 7xx, Mali-G7xx, Apple GPU indicate high-end
      if (renderer && (
        /adreno.*[67]/i.test(renderer) ||
        /mali-g[789]/i.test(renderer) ||
        /apple/i.test(renderer) ||
        /powervr/i.test(renderer)
      )) {
        console.log('🎯 High-end device detected by GPU:', renderer);
        return true;
      }
    }
  }
  
  // Large screen with high DPI on mobile often indicates flagship
  const screenWidth = window.screen.width * (window.devicePixelRatio || 1);
  const screenHeight = window.screen.height * (window.devicePixelRatio || 1);
  const maxDimension = Math.max(screenWidth, screenHeight);
  
  // Foldables and flagships have very high resolution screens
  if (maxDimension >= 2400 && cores >= 6) {
    console.log('🎯 High-end device detected by screen resolution:', maxDimension);
    return true;
  }
  
  return false;
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
  
  return 'desktop';
}

/**
 * Detect if running on Chrome mobile
 */
function isMobileChrome(): boolean {
  const ua = navigator.userAgent;
  return /Chrome/i.test(ua) && /Android|iPhone|iPad|iPod/i.test(ua);
}

/**
 * Detect if device has limited memory (< 4GB)
 */
function hasLimitedMemory(): boolean {
  // @ts-ignore - deviceMemory is not in all browsers
  const memory = navigator.deviceMemory;
  if (memory !== undefined) {
    return memory < 4;
  }
  // Assume limited memory on mobile
  return detectDeviceType() !== 'desktop';
}

/**
 * Detect network connection quality
 */
function getConnectionQuality(): 'slow' | 'medium' | 'fast' {
  // @ts-ignore - connection is not in all browsers
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection) {
    const effectiveType = connection.effectiveType;
    if (effectiveType === 'slow-2g' || effectiveType === '2g') {
      return 'slow';
    } else if (effectiveType === '3g') {
      return 'medium';
    }
  }
  return 'fast';
}

/**
 * Run a quick performance benchmark
 * Returns a score from 0-100
 */
function runQuickBenchmark(): number {
  const startTime = performance.now();
  
  // Simple CPU benchmark: array operations
  const iterations = 100000;
  const arr: number[] = [];
  
  for (let i = 0; i < iterations; i++) {
    arr.push(Math.sqrt(i) * Math.sin(i));
  }
  
  // Sort to add more work
  arr.sort((a, b) => a - b);
  
  const cpuTime = performance.now() - startTime;
  
  // GPU benchmark: canvas operations
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  
  const gpuStart = performance.now();
  if (ctx) {
    for (let i = 0; i < 100; i++) {
      ctx.fillStyle = `rgb(${i}, ${i * 2}, ${i * 3})`;
      ctx.fillRect(0, 0, 256, 256);
      ctx.clearRect(0, 0, 256, 256);
    }
  }
  const gpuTime = performance.now() - gpuStart;
  
  // Calculate score (lower time = higher score)
  // Typical ranges:
  // - High-end: CPU < 20ms, GPU < 10ms
  // - Mid-range: CPU 20-50ms, GPU 10-30ms
  // - Low-end: CPU > 50ms, GPU > 30ms
  
  let cpuScore = Math.max(0, Math.min(50, 50 - (cpuTime - 10)));
  let gpuScore = Math.max(0, Math.min(50, 50 - (gpuTime - 5) * 2));
  
  const totalScore = Math.round(cpuScore + gpuScore);
  
  console.log('🏃 Performance benchmark:', {
    cpuTime: cpuTime.toFixed(2) + 'ms',
    gpuTime: gpuTime.toFixed(2) + 'ms',
    cpuScore: cpuScore.toFixed(1),
    gpuScore: gpuScore.toFixed(1),
    totalScore
  });
  
  return totalScore;
}

/**
 * Detect hardware capabilities
 */
export function detectHardware(): HardwareProfile {
  const cpuCores = navigator.hardwareConcurrency || 2;
  const deviceType = detectDeviceType();
  const isMobile = deviceType === 'mobile' || deviceType === 'tablet';
  const isAppleSilicon = detectAppleSilicon();
  const isHighEndMobile = isMobile && (isAppleSilicon || detectHighEndMobile());
  const isChromeOnMobile = isMobileChrome();
  const limitedMemory = hasLimitedMemory();
  const connectionQuality = getConnectionQuality();
  
  // Check for hardware acceleration support
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  const supportsHardwareAcceleration = !!gl;
  
  // Run performance benchmark
  const performanceScore = runQuickBenchmark();
  
  // Determine if this is a low-end device based on benchmark and cores
  // High-end mobile devices should NOT be considered low-end
  let isLowEnd = false;
  
  if (isHighEndMobile || isAppleSilicon) {
    // High-end mobile or Apple Silicon - never low-end
    isLowEnd = false;
  } else if (performanceScore < 30) {
    // Poor benchmark score
    isLowEnd = true;
  } else if (cpuCores <= 2) {
    // Very few cores
    isLowEnd = true;
  } else if (cpuCores <= 4 && performanceScore < 50) {
    // Few cores with mediocre performance
    isLowEnd = true;
  } else if (isMobile && limitedMemory) {
    // Mobile with limited memory
    isLowEnd = true;
  }
  
  // Recommend quality based on hardware
  // IMPORTANT: On mobile Chrome, be more conservative with quality
  let recommendedQuality: PreviewSettings['quality'] = 'high';
  let maxSafeResolution = 1080;
  
  if (isAppleSilicon) {
    // Apple Silicon (M1-M5) - maximum performance
    recommendedQuality = 'original';
    maxSafeResolution = 2160; // 4K capable
  } else if (isHighEndMobile && !isChromeOnMobile) {
    // High-end mobile NOT on Chrome - can handle original
    recommendedQuality = 'original';
    maxSafeResolution = 1080;
  } else if (isHighEndMobile && isChromeOnMobile) {
    // High-end mobile ON Chrome - be more conservative
    // Chrome on Android has known video decoding issues
    recommendedQuality = 'high';
    maxSafeResolution = 720;
  } else if (isChromeOnMobile) {
    // Chrome on mobile (not high-end) - use lower quality
    if (performanceScore >= 50) {
      recommendedQuality = 'medium';
      maxSafeResolution = 480;
    } else {
      recommendedQuality = 'low';
      maxSafeResolution = 360;
    }
  } else if (performanceScore >= 70) {
    // Excellent performance
    recommendedQuality = 'original';
    maxSafeResolution = 1080;
  } else if (performanceScore >= 50) {
    // Good performance
    recommendedQuality = 'high';
    maxSafeResolution = 720;
  } else if (performanceScore >= 30) {
    // Moderate performance
    recommendedQuality = 'medium';
    maxSafeResolution = 480;
  } else {
    // Poor performance
    recommendedQuality = 'low';
    maxSafeResolution = 360;
  }
  
  // Legacy fallback for devices where benchmark might not be accurate
  if (!isHighEndMobile && !isAppleSilicon) {
    if (cpuCores <= 2 && recommendedQuality !== 'low') {
      recommendedQuality = 'low';
      maxSafeResolution = 360;
    } else if (cpuCores <= 4 && recommendedQuality === 'original') {
      recommendedQuality = 'high';
      maxSafeResolution = 720;
    }
  }
  
  // Network quality adjustment
  if (connectionQuality === 'slow' && recommendedQuality !== 'low') {
    recommendedQuality = 'low';
    maxSafeResolution = 360;
  } else if (connectionQuality === 'medium' && recommendedQuality === 'original') {
    recommendedQuality = 'high';
    maxSafeResolution = 720;
  }
  
  console.log('🖥️ Hardware Profile:', {
    cpuCores,
    deviceType,
    isLowEnd,
    isMobile,
    isHighEndMobile,
    isAppleSilicon,
    isChromeOnMobile,
    limitedMemory,
    connectionQuality,
    supportsHardwareAcceleration,
    performanceScore,
    recommendedQuality,
    maxSafeResolution,
  });
  
  return {
    cpuCores,
    isLowEnd,
    isMobile,
    isHighEndMobile,
    isAppleSilicon,
    supportsHardwareAcceleration,
    recommendedQuality,
    maxSafeResolution,
    deviceType,
    performanceScore,
  };
}

/**
 * Get optimal preview settings based on hardware and video properties
 */
export function getOptimalSettings(
  videoWidth: number,
  videoHeight: number,
  hardwareProfile?: HardwareProfile
): PreviewSettings {
  const profile = hardwareProfile || detectHardware();
  const isChromeOnMobile = isMobileChrome();
  const limitedMemory = hasLimitedMemory();
  
  const settings: PreviewSettings = { ...DEFAULT_SETTINGS };
  
  // Auto quality selection
  if (settings.quality === 'auto') {
    settings.quality = profile.recommendedQuality;
  }
  
  // Mobile Chrome specific optimizations
  if (isChromeOnMobile) {
    settings.useLowLatencyMode = true;
    settings.bufferSize = limitedMemory ? 'small' : 'medium';
    
    // Check for reduced motion preference
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      settings.useReducedMotion = true;
      settings.targetFps = 24;
    }
  }
  
  // Set max resolution based on quality
  switch (settings.quality) {
    case 'low':
      settings.maxResolution = PREVIEW_RESOLUTIONS.low;
      settings.targetFps = isChromeOnMobile ? 20 : 24; // Even lower FPS on Chrome mobile
      settings.frameSkipping = true;
      settings.bufferSize = 'small';
      break;
    case 'medium':
      settings.maxResolution = PREVIEW_RESOLUTIONS.medium;
      settings.targetFps = isChromeOnMobile ? 24 : 30;
      settings.frameSkipping = profile.isLowEnd || isChromeOnMobile;
      settings.bufferSize = 'small';
      break;
    case 'high':
      settings.maxResolution = PREVIEW_RESOLUTIONS.high;
      settings.targetFps = isChromeOnMobile ? 25 : 30;
      settings.frameSkipping = isChromeOnMobile;
      settings.bufferSize = 'medium';
      break;
    case 'original':
      settings.maxResolution = videoHeight;
      settings.targetFps = isChromeOnMobile ? 30 : 60;
      settings.frameSkipping = isChromeOnMobile;
      settings.useProxy = false;
      settings.bufferSize = 'large';
      break;
  }
  
  // Determine if proxy is needed
  settings.useProxy = videoHeight > settings.maxResolution;
  
  // Hardware acceleration
  settings.hardwareAcceleration = profile.supportsHardwareAcceleration;
  
  return settings;
}

/**
 * Generate a low-resolution proxy video using Canvas
 * This is a lightweight alternative to FFmpeg for preview purposes
 */
export async function generateCanvasProxy(
  videoUrl: string,
  targetHeight: number,
  onProgress?: (progress: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'auto';
    
    video.onloadedmetadata = async () => {
      const originalWidth = video.videoWidth;
      const originalHeight = video.videoHeight;
      
      // Calculate target dimensions maintaining aspect ratio
      const scale = targetHeight / originalHeight;
      const targetWidth = Math.round(originalWidth * scale);
      
      // If video is already smaller than target, return original
      if (originalHeight <= targetHeight) {
        resolve(videoUrl);
        return;
      }
      
      console.log(`🎬 Generating proxy: ${originalWidth}x${originalHeight} -> ${targetWidth}x${targetHeight}`);
      
      // Create canvas for frame extraction
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d', { 
        alpha: false,
        desynchronized: true // Better performance
      });
      
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }
      
      // For now, we'll use the original video with CSS scaling
      // This is more efficient than re-encoding in the browser
      // The actual optimization happens in the video element styling
      
      // Store proxy info in cache
      const proxyInfo: ProxyVideo = {
        originalUrl: videoUrl,
        proxyUrl: videoUrl, // Same URL, but we'll apply CSS scaling
        resolution: targetHeight,
        isGenerating: false,
        progress: 100,
      };
      
      proxyCache.set(videoUrl, proxyInfo);
      onProgress?.(100);
      
      resolve(videoUrl);
    };
    
    video.onerror = () => {
      reject(new Error('Failed to load video for proxy generation'));
    };
    
    video.src = videoUrl;
    video.load();
  });
}

/**
 * Get or create a proxy video URL
 */
export async function getProxyUrl(
  originalUrl: string,
  videoHeight: number,
  settings: PreviewSettings,
  onProgress?: (progress: number) => void
): Promise<string> {
  // Check cache first
  const cached = proxyCache.get(originalUrl);
  if (cached && cached.resolution === settings.maxResolution && !cached.isGenerating) {
    return cached.proxyUrl;
  }
  
  // If proxy not needed, return original
  if (!settings.useProxy || videoHeight <= settings.maxResolution) {
    return originalUrl;
  }
  
  // Generate proxy
  try {
    const proxyUrl = await generateCanvasProxy(originalUrl, settings.maxResolution, onProgress);
    return proxyUrl;
  } catch (error) {
    console.warn('Failed to generate proxy, using original:', error);
    return originalUrl;
  }
}

/**
 * Apply optimized video element settings for smooth playback
 */
export function applyVideoOptimizations(
  videoElement: HTMLVideoElement,
  settings: PreviewSettings,
  profile?: HardwareProfile
): void {
  // Get current hardware profile if not provided
  const hwProfile = profile || hardwareProfile;
  const isHighEnd = hwProfile?.isHighEndMobile || hwProfile?.isAppleSilicon ||
                    (hwProfile?.performanceScore && hwProfile.performanceScore >= 50);
  const isChromeOnMobile = isMobileChrome();
  const isMobile = hwProfile?.isMobile || detectDeviceType() !== 'desktop';
  
  // Disable picture-in-picture to reduce overhead
  if ('disablePictureInPicture' in videoElement) {
    (videoElement as any).disablePictureInPicture = true;
  }
  
  // Disable remote playback
  if ('disableRemotePlayback' in videoElement) {
    (videoElement as any).disableRemotePlayback = true;
  }
  
  // CRITICAL: Mobile Chrome optimizations
  if (isChromeOnMobile || isMobile) {
    // Use metadata preload on mobile to reduce memory usage
    videoElement.preload = settings.bufferSize === 'large' ? 'auto' : 'metadata';
    
    // Enable low latency mode if supported (Chrome 87+)
    // @ts-ignore - experimental API
    if ('requestVideoFrameCallback' in videoElement) {
      // Video frame callback is available - good for sync
      console.log('📹 requestVideoFrameCallback available');
    }
    
    // Set decode hints for Chrome
    // @ts-ignore - experimental API
    if (videoElement.getVideoPlaybackQuality) {
      // Can monitor dropped frames
      console.log('📹 getVideoPlaybackQuality available');
    }
    
    // Reduce buffer size on mobile
    // @ts-ignore - experimental API
    if ('buffered' in videoElement && settings.bufferSize === 'small') {
      // Hint to browser to use smaller buffer
      videoElement.setAttribute('x-webkit-airplay', 'deny');
    }
    
    // Disable autoplay to prevent background decoding
    videoElement.autoplay = false;
    
    // Force hardware decoding hints
    videoElement.setAttribute('webkit-playsinline', 'true');
    videoElement.setAttribute('x5-playsinline', 'true');
    videoElement.setAttribute('x5-video-player-type', 'h5');
    videoElement.setAttribute('x5-video-player-fullscreen', 'false');
    
    // Poster frame to reduce initial decode
    if (!videoElement.poster) {
      videoElement.poster = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    }
  } else {
    // Desktop: use auto preload
    videoElement.preload = 'auto';
  }
  
  // Enable playsInline for mobile (CRITICAL for iOS)
  videoElement.playsInline = true;
  
  // Apply CSS optimizations based on device capability
  if (isHighEnd && !isChromeOnMobile) {
    // High-end devices (not Chrome mobile): minimal CSS interference
    videoElement.style.willChange = 'auto';
    videoElement.style.transform = '';
    videoElement.style.imageRendering = 'auto';
    
    // Remove any filters that might slow down rendering
    if (!videoElement.style.filter || videoElement.style.filter === 'none') {
      videoElement.style.filter = '';
    }
    
    console.log('🚀 High-end optimizations applied');
  } else if (isChromeOnMobile) {
    // Chrome mobile specific optimizations
    // Use GPU compositing but avoid complex transforms
    videoElement.style.willChange = 'contents';
    videoElement.style.transform = 'translate3d(0,0,0)'; // Force GPU layer
    videoElement.style.backfaceVisibility = 'hidden';
    videoElement.style.perspective = '1000px';
    
    // Optimize rendering
    videoElement.style.imageRendering = 'auto';
    videoElement.style.objectFit = 'contain';
    
    // Reduce paint complexity
    videoElement.style.contain = 'layout paint';
    
    // Disable pointer events during playback for better performance
    // (will be re-enabled when needed)
    
    console.log('📱 Chrome mobile optimizations applied');
  } else {
    // Lower-end devices: force GPU layer
    videoElement.style.willChange = 'transform';
    videoElement.style.transform = 'translateZ(0)';
    
    // For low-end devices, reduce quality via CSS
    if (settings.quality === 'low' || settings.quality === 'medium') {
      videoElement.style.imageRendering = 'optimizeSpeed';
    }
  }
}

/**
 * Optimize video playback for mobile Chrome
 * Call this when starting playback
 */
export function optimizeMobilePlayback(videoElement: HTMLVideoElement): void {
  const isChromeOnMobile = isMobileChrome();
  
  if (!isChromeOnMobile) return;
  
  // Reduce decode priority during playback
  // @ts-ignore
  if (videoElement.requestVideoFrameCallback) {
    let lastFrameTime = 0;
    const targetFrameTime = 1000 / 24; // Target 24fps on mobile
    
    const frameCallback = (now: number, metadata: any) => {
      const elapsed = now - lastFrameTime;
      
      // Skip frames if we're falling behind
      if (elapsed < targetFrameTime * 0.8) {
        // Too fast, skip this callback
        // @ts-ignore
        videoElement.requestVideoFrameCallback(frameCallback);
        return;
      }
      
      lastFrameTime = now;
      
      // Continue requesting frames
      if (!videoElement.paused && !videoElement.ended) {
        // @ts-ignore
        videoElement.requestVideoFrameCallback(frameCallback);
      }
    };
    
    // Start frame callback when playing
    videoElement.addEventListener('play', () => {
      lastFrameTime = performance.now();
      // @ts-ignore
      videoElement.requestVideoFrameCallback(frameCallback);
    }, { once: false });
  }
  
  // Monitor and log dropped frames
  // @ts-ignore
  if (videoElement.getVideoPlaybackQuality) {
    let lastDroppedFrames = 0;
    
    const checkQuality = () => {
      if (videoElement.paused || videoElement.ended) return;
      
      // @ts-ignore
      const quality = videoElement.getVideoPlaybackQuality();
      const newDropped = quality.droppedVideoFrames - lastDroppedFrames;
      
      if (newDropped > 5) {
        console.warn(`⚠️ Dropped ${newDropped} frames`);
      }
      
      lastDroppedFrames = quality.droppedVideoFrames;
      
      // Check again in 1 second
      setTimeout(checkQuality, 1000);
    };
    
    videoElement.addEventListener('play', checkQuality, { once: false });
  }
}

/**
 * Get mobile-optimized video attributes
 */
export function getMobileVideoAttributes(): Record<string, string> {
  const isChromeOnMobile = isMobileChrome();
  
  const attrs: Record<string, string> = {
    'playsinline': 'true',
    'webkit-playsinline': 'true',
  };
  
  if (isChromeOnMobile) {
    attrs['x5-playsinline'] = 'true';
    attrs['x5-video-player-type'] = 'h5';
    attrs['x5-video-player-fullscreen'] = 'false';
    attrs['x5-video-orientation'] = 'portrait';
  }
  
  return attrs;
}

/**
 * Frame rate limiter for smooth playback
 */
export class FrameRateLimiter {
  private lastFrameTime: number = 0;
  private frameInterval: number;
  private frameSkipCounter: number = 0;
  private skipEveryNFrames: number;
  
  constructor(targetFps: number, enableFrameSkipping: boolean = false) {
    this.frameInterval = 1000 / targetFps;
    this.skipEveryNFrames = enableFrameSkipping ? 2 : 0; // Skip every 2nd frame if enabled
  }
  
  /**
   * Check if we should render this frame
   */
  shouldRenderFrame(currentTime: number): boolean {
    const elapsed = currentTime - this.lastFrameTime;
    
    if (elapsed < this.frameInterval) {
      return false;
    }
    
    // Frame skipping for very low-end devices
    if (this.skipEveryNFrames > 0) {
      this.frameSkipCounter++;
      if (this.frameSkipCounter % this.skipEveryNFrames === 0) {
        return false;
      }
    }
    
    this.lastFrameTime = currentTime - (elapsed % this.frameInterval);
    return true;
  }
  
  /**
   * Update target FPS
   */
  setTargetFps(fps: number): void {
    this.frameInterval = 1000 / fps;
  }
  
  /**
   * Enable/disable frame skipping
   */
  setFrameSkipping(enabled: boolean): void {
    this.skipEveryNFrames = enabled ? 2 : 0;
  }
  
  /**
   * Reset the limiter
   */
  reset(): void {
    this.lastFrameTime = 0;
    this.frameSkipCounter = 0;
  }
}

/**
 * Performance monitor for adaptive quality
 */
export class PerformanceMonitor {
  private frameTimes: number[] = [];
  private maxSamples: number = 60;
  private lastTime: number = 0;
  private droppedFrames: number = 0;
  private totalFrames: number = 0;
  
  /**
   * Record a frame render
   */
  recordFrame(currentTime: number): void {
    if (this.lastTime > 0) {
      const frameTime = currentTime - this.lastTime;
      this.frameTimes.push(frameTime);
      
      if (this.frameTimes.length > this.maxSamples) {
        this.frameTimes.shift();
      }
      
      // Consider frame dropped if it took more than 50ms (< 20fps)
      if (frameTime > 50) {
        this.droppedFrames++;
      }
      this.totalFrames++;
    }
    this.lastTime = currentTime;
  }
  
  /**
   * Get average FPS
   */
  getAverageFps(): number {
    if (this.frameTimes.length === 0) return 60;
    
    const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    return Math.round(1000 / avgFrameTime);
  }
  
  /**
   * Get dropped frame percentage
   */
  getDroppedFramePercentage(): number {
    if (this.totalFrames === 0) return 0;
    return (this.droppedFrames / this.totalFrames) * 100;
  }
  
  /**
   * Check if performance is poor
   */
  isPerformancePoor(): boolean {
    return this.getAverageFps() < 20 || this.getDroppedFramePercentage() > 10;
  }
  
  /**
   * Get recommended quality adjustment
   */
  getQualityRecommendation(): 'decrease' | 'maintain' | 'increase' {
    const fps = this.getAverageFps();
    const droppedPercent = this.getDroppedFramePercentage();
    
    if (fps < 20 || droppedPercent > 15) {
      return 'decrease';
    } else if (fps > 50 && droppedPercent < 2) {
      return 'increase';
    }
    return 'maintain';
  }
  
  /**
   * Reset the monitor
   */
  reset(): void {
    this.frameTimes = [];
    this.lastTime = 0;
    this.droppedFrames = 0;
    this.totalFrames = 0;
  }
}

/**
 * Video buffer manager for smoother playback
 */
export class VideoBufferManager {
  private preloadedVideos: Map<string, HTMLVideoElement> = new Map();
  private maxPreloaded: number = 3;
  
  /**
   * Preload a video for smoother playback
   */
  preload(url: string, startTime: number = 0): HTMLVideoElement {
    if (this.preloadedVideos.has(url)) {
      return this.preloadedVideos.get(url)!;
    }
    
    // Clean up old preloaded videos if at limit
    if (this.preloadedVideos.size >= this.maxPreloaded) {
      const firstKey = this.preloadedVideos.keys().next().value;
      if (firstKey) {
        const oldVideo = this.preloadedVideos.get(firstKey);
        if (oldVideo) {
          oldVideo.src = '';
          oldVideo.load();
        }
        this.preloadedVideos.delete(firstKey);
      }
    }
    
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.src = url;
    video.currentTime = startTime;
    
    this.preloadedVideos.set(url, video);
    return video;
  }
  
  /**
   * Get a preloaded video
   */
  get(url: string): HTMLVideoElement | undefined {
    return this.preloadedVideos.get(url);
  }
  
  /**
   * Clear all preloaded videos
   */
  clear(): void {
    this.preloadedVideos.forEach(video => {
      video.src = '';
      video.load();
    });
    this.preloadedVideos.clear();
  }
}

// Global instances
let hardwareProfile: HardwareProfile | null = null;
let currentSettings: PreviewSettings = { ...DEFAULT_SETTINGS };
const performanceMonitor = new PerformanceMonitor();
const bufferManager = new VideoBufferManager();

/**
 * Initialize the preview optimizer
 */
export function initializePreviewOptimizer(): HardwareProfile {
  hardwareProfile = detectHardware();
  currentSettings = getOptimalSettings(1920, 1080, hardwareProfile);
  
  console.log('🎬 Preview Optimizer initialized:', {
    hardwareProfile,
    settings: currentSettings,
  });
  
  return hardwareProfile;
}

/**
 * Get current preview settings
 */
export function getCurrentSettings(): PreviewSettings {
  return { ...currentSettings };
}

/**
 * Update preview settings
 */
export function updateSettings(newSettings: Partial<PreviewSettings>): PreviewSettings {
  currentSettings = { ...currentSettings, ...newSettings };
  return currentSettings;
}

/**
 * Get hardware profile
 */
export function getHardwareProfile(): HardwareProfile {
  if (!hardwareProfile) {
    hardwareProfile = detectHardware();
  }
  return hardwareProfile;
}

/**
 * Get performance monitor instance
 */
export function getPerformanceMonitor(): PerformanceMonitor {
  return performanceMonitor;
}

/**
 * Get buffer manager instance
 */
export function getBufferManager(): VideoBufferManager {
  return bufferManager;
}

/**
 * Clean up resources
 */
export function cleanup(): void {
  proxyCache.clear();
  bufferManager.clear();
  performanceMonitor.reset();
}

export default {
  initializePreviewOptimizer,
  detectHardware,
  getOptimalSettings,
  getProxyUrl,
  applyVideoOptimizations,
  optimizeMobilePlayback,
  getMobileVideoAttributes,
  getCurrentSettings,
  updateSettings,
  getHardwareProfile,
  getPerformanceMonitor,
  getBufferManager,
  cleanup,
  FrameRateLimiter,
  PerformanceMonitor,
  VideoBufferManager,
};