// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { RESOLUTION_PRESETS, ExportSettings, VideoFilter, TimelineClip, MediaFile, TextOverlay, Transition, TransitionType, getResolutionForAspectRatio, AspectRatio } from '../types';
import type { HardwareProfile as DetectionHardwareProfile, VideoSettings } from './hardwareDetection';
import type { HardwareProfile as PreviewHardwareProfile } from './previewOptimizer';
import { exportProjectWithMediaBunny, cancelMediaBunnyExport } from './mediaBunny';

// Union type to handle both profile structures
export type AnyHardwareProfile = DetectionHardwareProfile | PreviewHardwareProfile;

let ffmpeg: FFmpeg | null = null;
let isLoaded = false;
let isFontLoaded = false;
let currentProgressCallback: ((progress: number, message: string) => void) | undefined;
let currentTotalDuration = 0;
let isOperationInProgress = false; // Prevent multiple simultaneous FFmpeg operations
let currentOperationType: string | null = null; // Track what operation is running

// Used to detect stalls (no progress callbacks coming from ffmpeg.wasm)
let lastProgressUpdateAt = 0;
let lastProgressPercent = 0;

// Cached hardware profile for encoding optimization
let cachedHardwareProfile: AnyHardwareProfile | null = null;

function isLikelyAudioFile(file: File): boolean {
  // Some browsers provide empty MIME types for WAV. Fall back to extension.
  const mime = (file.type || '').toLowerCase();
  if (mime.startsWith('audio/')) return true;

  const name = (file.name || '').toLowerCase();
  return (
    name.endsWith('.wav') ||
    name.endsWith('.mp3') ||
    name.endsWith('.m4a') ||
    name.endsWith('.aac') ||
    name.endsWith('.ogg') ||
    name.endsWith('.opus') ||
    name.endsWith('.flac')
  );
}

/**
 * Hardware-optimized encoding settings
 */
export interface EncodingSettings {
  // Video codec settings
  videoCodec: string;
  preset: string;
  crf: string;
  pixelFormat: string;
  
  // Performance settings
  threads: string;
  
  // Additional flags
  additionalFlags: string[];
  
  // Resolution limits
  maxWidth: number;
  maxHeight: number;
  
  // Frame rate
  targetFps: number;
}

/**
 * Get optimal encoding settings based on hardware profile
 * @param hardwareProfile - The detected hardware profile
 * @param format - Output format (mp4, webm)
 * @param quality - Quality setting (high, medium, low)
 * @returns Optimized encoding settings
 */
export function getOptimalEncodingSettings(
  hardwareProfile: AnyHardwareProfile | null,
  format: 'mp4' | 'webm' = 'mp4',
  quality: 'high' | 'medium' | 'low' = 'medium',
  safeMode: boolean = false
): EncodingSettings {
  // Get thread count from navigator.hardwareConcurrency for optimal multi-threading
  const availableCores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  
  // Default settings for unknown hardware - OPTIMIZED FOR SPEED
  const defaultSettings: EncodingSettings = {
    videoCodec: format === 'webm' ? 'libvpx-vp9' : 'libx264',
    preset: safeMode ? 'ultrafast' : 'fast', // ultrafast for safe mode to ensure completion
    crf: quality === 'high' ? '20' : quality === 'medium' ? '25' : '30', // Higher CRF = faster encoding
    pixelFormat: 'yuv420p',
    threads: safeMode ? String(Math.min(4, availableCores)) : String(Math.min(8, availableCores)), // Use up to 4 threads in safe mode, cap at 8 for normal
    additionalFlags: [], // Removed faststart to prevent blocking at 95%
    maxWidth: 1920,
    maxHeight: 1080,
    targetFps: 30,
  };

  if (safeMode) {
    console.log('🛡️ FFmpeg: SAFE MODE ACTIVE - Using balanced settings for stability');
    // In safe mode, we return immediately with conservative settings
    // We also add -tune fastdecode to ensure decoding is fast
    defaultSettings.additionalFlags.push('-tune', 'fastdecode');
    // Keep 1080p in safe mode if possible, only downgrade if strictly necessary
    // defaultSettings.maxWidth = 1280; 
    // defaultSettings.maxHeight = 720;
    return defaultSettings;
  }
  
  if (!hardwareProfile) {
    console.log('⚡ FFmpeg: No hardware profile, using speed-optimized defaults', {
      threads: defaultSettings.threads,
      preset: defaultSettings.preset,
      crf: defaultSettings.crf,
    });
    return defaultSettings;
  }
  
  const settings = { ...defaultSettings };
  
  // Handle different profile structures safely
  let gpuTier = 'unknown';
  let processorCores = 4;
  let memoryTier = 'unknown';
  let isAppleSilicon = false;
  let gpuVendor = 'unknown';

  // Check if it's the DetectionHardwareProfile (has 'gpu' object)
  if ('gpu' in hardwareProfile && hardwareProfile.gpu && 'processor' in hardwareProfile && hardwareProfile.processor) {
    gpuTier = hardwareProfile.gpu.tier;
    processorCores = hardwareProfile.processor.cores;
    memoryTier = hardwareProfile.memory.tier;
    isAppleSilicon = hardwareProfile.processor.isAppleSilicon;
    gpuVendor = hardwareProfile.gpu.vendor;
  } 
  // Check if it's the PreviewHardwareProfile (flat structure)
  else if ('cpuCores' in hardwareProfile) {
    // Map PreviewHardwareProfile to similar concepts
    processorCores = hardwareProfile.cpuCores;
    isAppleSilicon = hardwareProfile.isAppleSilicon;
    
    // Infer tiers from performance score if available
    const score = hardwareProfile.performanceScore || 50;
    if (score > 70) {
      gpuTier = 'high';
      memoryTier = 'high';
    } else if (score > 40) {
      gpuTier = 'medium';
      memoryTier = 'medium';
    } else {
      gpuTier = 'low';
      memoryTier = 'low';
    }
    
    // Try to infer vendor from user agent if needed, or default to unknown
    // Since PreviewHardwareProfile doesn't have vendor, we rely on generic optimizations
  }
  
  // SPEED-OPTIMIZED: Adjust based on GPU tier
  // Priority: SPEED over quality (user can choose quality setting if needed)
  switch (gpuTier) {
    case 'high':
      // High-end GPU: use 'veryfast' preset for maximum speed on powerful hardware
      // RTX 4090/i9 14th gen can handle this easily with good quality
      // WASM is CPU bound, so we need faster presets even on high-end hardware
      // In ffmpeg.wasm, encoding is CPU/WASM bound. Favor ultrafast to avoid stalls.
      settings.preset = 'ultrafast';
      settings.crf = quality === 'high' ? '23' : quality === 'medium' ? '26' : '30';
      settings.maxWidth = 3840;
      settings.maxHeight = 2160;
      settings.targetFps = 60;
      // Use zerolatency tune for faster encoding (removes B-frames, reduces latency)
      settings.additionalFlags.push('-tune', 'zerolatency');
      // Add specific flags for high-end CPUs to maximize throughput
      settings.additionalFlags.push('-g', '60'); // Keyframe interval (2s at 30fps)
      // Reduce memory pressure for WASM
      settings.additionalFlags.push('-max_muxing_queue_size', '1024');
      break;
      
    case 'medium':
      // Mid-range GPU: use 'fast' preset
      settings.preset = quality === 'high' ? 'fast' : 'veryfast';
      settings.crf = quality === 'high' ? '20' : quality === 'medium' ? '24' : '28';
      settings.maxWidth = 1920;
      settings.maxHeight = 1080;
      settings.targetFps = 30;
      settings.additionalFlags.push('-tune', 'fastdecode');
      break;
      
    case 'low':
      // Low-end GPU: prioritize speed with ultrafast preset
      settings.preset = 'ultrafast';
      settings.crf = quality === 'high' ? '22' : quality === 'medium' ? '28' : '32';
      settings.maxWidth = 1280;
      settings.maxHeight = 720;
      settings.targetFps = 30;
      settings.additionalFlags.push('-tune', 'fastdecode');
      break;
      
    default:
      // Unknown: use fast defaults
      settings.preset = 'fast';
      settings.additionalFlags.push('-tune', 'fastdecode');
      break;
  }
  
  // OPTIMIZED: Use available CPU cores but with safe limits for WASM
  // WASM environment has memory and thread contention limits even on high-end hardware
  // EXPERIMENTAL: High thread counts (>8) cause deadlocks in browser. 
  // We cap at 4 to ensure stability while still providing good performance.
  if (processorCores >= 16) {
    settings.threads = '4'; // Cap at 4 for maximum WASM stability
  } else if (processorCores >= 8) {
    settings.threads = '4'; // Standard high performance
  } else {
    settings.threads = String(Math.max(2, processorCores)); // Minimum 2 threads
  }
  
  // Adjust for Apple Silicon - these are very efficient at video encoding
  if (isAppleSilicon) {
    // Apple Silicon: use 'fast' preset (still excellent quality due to efficient architecture)
    settings.preset = quality === 'high' ? 'medium' : 'fast';
    settings.threads = '0'; // Let FFmpeg auto-optimize for Apple Silicon
    // Don't use zerolatency on Apple Silicon - it has efficient B-frame encoding
  }
  
  // Adjust for memory constraints
  if (memoryTier === 'low') {
    // Reduce memory usage and use faster settings
    settings.maxWidth = Math.min(settings.maxWidth, 1280);
    settings.maxHeight = Math.min(settings.maxHeight, 720);
    settings.preset = 'ultrafast'; // Force ultrafast for low memory
    settings.additionalFlags.push('-max_muxing_queue_size', '1024');
  }
  
  // GPU-specific optimizations for speed
  switch (gpuVendor) {
    case 'nvidia':
      // NVIDIA GPUs: optimize for speed
      // Note: ffmpeg.wasm is software-only, but we optimize for CPU encoding
      settings.additionalFlags.push('-bf', '0'); // Disable B-frames for faster encoding
      break;
      
    case 'amd':
      // AMD GPUs: similar speed optimizations
      settings.additionalFlags.push('-bf', '0');
      break;
      
    case 'apple':
      // Apple GPUs: VideoToolbox-friendly settings
      settings.pixelFormat = 'yuv420p';
      // Apple Silicon is efficient, can use B-frames
      break;
      
    case 'intel':
      // Intel GPUs: Quick Sync friendly settings
      settings.additionalFlags.push('-bf', '0'); // Disable B-frames for speed
      break;
      
    case 'arm':
    case 'qualcomm':
      // Mobile GPUs: prioritize efficiency and speed
      settings.preset = 'ultrafast';
      settings.additionalFlags.push('-tune', 'fastdecode');
      break;
  }
  
  // WebM-specific optimizations - SPEED FOCUSED
  if (format === 'webm') {
    settings.videoCodec = 'libvpx-vp9';
    // VP9 doesn't use preset, uses cpu-used instead (0=slowest, 8=fastest)
    // Higher cpu-used = faster encoding
    const cpuUsed = gpuTier === 'high' ? '4' : gpuTier === 'medium' ? '6' : '8';
    settings.additionalFlags.push('-cpu-used', cpuUsed);
    settings.additionalFlags.push('-row-mt', '1'); // Enable row-based multithreading
    settings.additionalFlags.push('-deadline', 'realtime'); // Fastest VP9 encoding mode
  }
  
  // Always ensure faststart is present for web optimization
  // REMOVED: faststart causes "stuck at 95%" issue on large files
  /*
  if (!settings.additionalFlags.includes('-movflags')) {
    settings.additionalFlags.push('-movflags', '+faststart');
  }
  */
  
  console.log('⚡ FFmpeg: Speed-optimized encoding settings', {
    gpuTier,
    processorCores,
    threads: settings.threads,
    preset: settings.preset,
    crf: settings.crf,
    additionalFlags: settings.additionalFlags,
  });
  
  return settings;
}

/**
 * Get recommended codec based on hardware and use case
 * @param hardwareProfile - The detected hardware profile
 * @param useCase - The intended use case
 * @returns Recommended codec string
 */
export function getRecommendedCodec(
  hardwareProfile: AnyHardwareProfile | null,
  useCase: 'streaming' | 'archive' | 'social' | 'general' = 'general'
): 'h264' | 'h265' | 'vp9' | 'av1' {
  if (!hardwareProfile) {
    return 'h264'; // Most compatible
  }
  
  // Handle different profile structures
  let gpuTier = 'unknown';
  let supportsWebGPU = false;
  
  if ('gpu' in hardwareProfile && hardwareProfile.gpu) {
    gpuTier = hardwareProfile.gpu.tier;
    supportsWebGPU = hardwareProfile.gpu.supportsWebGPU || false;
  } else if ('cpuCores' in hardwareProfile) {
    const score = hardwareProfile.performanceScore || 50;
    gpuTier = score > 70 ? 'high' : score > 40 ? 'medium' : 'low';
  }
  
  switch (useCase) {
    case 'streaming':
      // Streaming: prioritize compatibility and fast encoding
      return 'h264';
      
    case 'archive':
      // Archive: prioritize compression efficiency
      if (gpuTier === 'high' && supportsWebGPU) {
        return 'av1'; // Best compression, but slow
      }
      return gpuTier === 'high' ? 'h265' : 'h264';
      
    case 'social':
      // Social media: balance compatibility and quality
      return 'h264'; // Most platforms support H.264
      
    case 'general':
    default:
      // General use: based on hardware capability
      if (gpuTier === 'high') {
        return 'h265'; // Better quality at same bitrate
      }
      return 'h264';
  }
}

/**
 * Set the hardware profile for encoding optimization
 * @param profile - The hardware profile to use
 */
export function setHardwareProfile(profile: AnyHardwareProfile): void {
  cachedHardwareProfile = profile;
  
  // Safe logging for different profile types
  if ('gpu' in profile && profile.gpu && 'processor' in profile && profile.processor) {
    console.log('🎬 FFmpeg: Hardware profile set for encoding optimization', {
      gpu: profile.gpu.vendor,
      gpuTier: profile.gpu.tier,
      cores: profile.processor.cores,
      isAppleSilicon: profile.processor.isAppleSilicon,
    });
  } else if ('cpuCores' in profile) {
    console.log('🎬 FFmpeg: Hardware profile set for encoding optimization', {
      cpuCores: profile.cpuCores,
      isAppleSilicon: profile.isAppleSilicon,
      performanceScore: profile.performanceScore,
    });
  }
}

/**
 * Get the cached hardware profile
 * @returns The cached hardware profile or null
 */
export function getHardwareProfile(): AnyHardwareProfile | null {
  return cachedHardwareProfile;
}

/**
 * Build FFmpeg arguments with hardware-optimized settings
 * @param baseArgs - Base FFmpeg arguments
 * @param settings - Encoding settings
 * @returns Complete FFmpeg arguments array
 */
export function buildOptimizedArgs(
  baseArgs: string[],
  settings: EncodingSettings
): string[] {
  const args = [...baseArgs];
  
  // Find and replace codec settings
  const codecIndex = args.indexOf('-c:v');
  if (codecIndex !== -1) {
    args[codecIndex + 1] = settings.videoCodec;
  }
  
  // Find and replace preset
  const presetIndex = args.indexOf('-preset');
  if (presetIndex !== -1) {
    args[presetIndex + 1] = settings.preset;
  } else {
    // Add preset if not present (for non-VP9 codecs)
    if (!settings.videoCodec.includes('vpx')) {
      args.push('-preset', settings.preset);
    }
  }
  
  // Find and replace CRF
  const crfIndex = args.indexOf('-crf');
  if (crfIndex !== -1) {
    args[crfIndex + 1] = settings.crf;
  }
  
  // Find and replace threads
  const threadsIndex = args.indexOf('-threads');
  if (threadsIndex !== -1) {
    args[threadsIndex + 1] = settings.threads;
  } else {
    args.push('-threads', settings.threads);
  }
  
  // Find and replace pixel format
  const pixFmtIndex = args.indexOf('-pix_fmt');
  if (pixFmtIndex !== -1) {
    args[pixFmtIndex + 1] = settings.pixelFormat;
  }
  
  // Find and replace frame rate
  const fpsIndex = args.indexOf('-r');
  if (fpsIndex !== -1) {
    // Keep the caller's requested fps if it's lower than the hardware profile target.
    // Forcing 60fps in wasm can double work (dup frames) and slow exports significantly.
    const requested = parseInt(args[fpsIndex + 1] || '0', 10);
    const effective = requested > 0 ? Math.min(requested, settings.targetFps) : settings.targetFps;
    args[fpsIndex + 1] = String(effective);
  }
  
  // Add additional flags
  for (let i = 0; i < settings.additionalFlags.length; i += 2) {
    const flag = settings.additionalFlags[i];
    const value = settings.additionalFlags[i + 1];
    
    // Check if flag already exists
    const existingIndex = args.indexOf(flag);
    if (existingIndex !== -1 && value) {
      args[existingIndex + 1] = value;
    } else {
      if (value) {
        args.push(flag, value);
      } else {
        args.push(flag);
      }
    }
  }
  
  return args;
}

/**
 * Get encoding complexity estimate based on hardware
 * With speed-optimized presets, encoding is significantly faster
 * @param hardwareProfile - The hardware profile
 * @param videoDuration - Duration in seconds
 * @param resolution - Target resolution
 * @returns Estimated encoding time in seconds
 */
export function estimateEncodingTime(
  hardwareProfile: AnyHardwareProfile | null,
  videoDuration: number,
  resolution: { width: number; height: number }
): number {
  // Base estimate with SPEED-OPTIMIZED presets:
  // - High-end: ~0.3x realtime (3x faster than realtime)
  // - Medium: ~0.5x realtime (2x faster than realtime)
  // - Low-end: ~1.5x realtime
  let multiplier = 0.8; // Default: faster than realtime with optimized settings
  
  if (!hardwareProfile) {
    // Unknown hardware: assume 1x realtime with fast preset
    multiplier = 1.0;
  } else {
    let gpuTier = 'unknown';
    let cores = 4;
    let isAppleSilicon = false;

    if ('gpu' in hardwareProfile && hardwareProfile.gpu && 'processor' in hardwareProfile && hardwareProfile.processor) {
      gpuTier = hardwareProfile.gpu.tier;
      cores = hardwareProfile.processor.cores;
      isAppleSilicon = hardwareProfile.processor.isAppleSilicon;
    } else if ('cpuCores' in hardwareProfile) {
      cores = hardwareProfile.cpuCores;
      isAppleSilicon = hardwareProfile.isAppleSilicon;
      // Infer tier
      const score = hardwareProfile.performanceScore || 50;
      gpuTier = score > 70 ? 'high' : score > 40 ? 'medium' : 'low';
    }
    
    // Adjust for GPU tier (with speed-optimized presets)
    switch (gpuTier) {
      case 'high':
        multiplier = 0.3; // 0.3x realtime (~3x faster than realtime)
        break;
      case 'medium':
        multiplier = 0.5; // 0.5x realtime (~2x faster than realtime)
        break;
      case 'low':
        multiplier = 1.5; // 1.5x realtime (still faster with ultrafast preset)
        break;
      default:
        multiplier = 1.0;
    }
    
    // Adjust for CPU cores - more cores = faster encoding
    if (cores >= 16) {
      multiplier *= 0.5; // 16+ cores: 2x speedup
    } else if (cores >= 8) {
      multiplier *= 0.6; // 8-15 cores: 1.67x speedup
    } else if (cores >= 4) {
      multiplier *= 0.8; // 4-7 cores: 1.25x speedup
    } else {
      multiplier *= 1.2; // Less than 4 cores: slight slowdown
    }
    
    // Adjust for Apple Silicon (very efficient at video encoding)
    if (isAppleSilicon) {
      multiplier *= 0.5; // Apple Silicon is ~2x faster
    }
  }
  
  // Adjust for resolution
  const pixels = resolution.width * resolution.height;
  const basePixels = 1920 * 1080;
  const resolutionFactor = pixels / basePixels;
  
  // Encoding time scales roughly with pixel count (square root for better estimate)
  const estimatedTime = videoDuration * multiplier * Math.sqrt(resolutionFactor);
  
  // Minimum 1 second estimate
  return Math.max(1, Math.ceil(estimatedTime));
}

/**
 * Format encoding time for display
 * @param seconds - Time in seconds
 * @returns Formatted time string
 */
export function formatEncodingTime(seconds: number): string {
  if (seconds < 60) {
    return `~${seconds}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `~${minutes}m ${secs}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `~${hours}h ${minutes}m`;
  }
}

// Default font file path in FFmpeg virtual filesystem
const FFMPEG_FONT_PATH = '/fonts/default.ttf';

export async function loadFFmpeg(
  onProgress?: (progress: number, message: string) => void,
  options?: { safeMode?: boolean }
): Promise<FFmpeg> {
  const safeMode = options?.safeMode ?? false;
  currentProgressCallback = onProgress;

  if (ffmpeg && isLoaded) {
    console.log('FFmpeg already loaded');
    return ffmpeg;
  }

  console.log('Loading FFmpeg...');
  ffmpeg = new FFmpeg();

  // Track time-based progress from logs (some builds don't emit progress events reliably)
  let lastTimeSecondsFromLog = 0;
  let lastPercentFromLog = 0;
  let lastLogUpdateAt = 0;

  ffmpeg.on('log', ({ message }) => {
    console.log('[FFmpeg]', message);

    // Parse ffmpeg stats lines like: "time=00:00:01.23"
    if (!currentProgressCallback || currentTotalDuration <= 0) return;
    const now = performance.now();
    // Throttle to avoid spamming UI
    if (now - lastLogUpdateAt < 250) return;

    // Prefer -progress key/value if present
    const prog = /out_time_ms=(\d+)/.exec(message);
    const tFromProgress = prog ? parseInt(prog[1], 10) / 1_000_000 : null;

    const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message);
    const tFromStats = m
      ? (parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]))
      : null;

    const t = (tFromProgress ?? tFromStats);
    if (t == null) return;
    if (!(t > lastTimeSecondsFromLog)) return;

    const percent = Math.min(99, Math.max(0, Math.round((t / currentTotalDuration) * 100)));
    if (percent <= lastPercentFromLog) return;

    lastTimeSecondsFromLog = t;
    lastPercentFromLog = percent;
    lastLogUpdateAt = now;
    lastProgressUpdateAt = now;
    lastProgressPercent = percent;
    currentProgressCallback(percent, 'Encodage...');
  });

  ffmpeg.on('progress', ({ progress, time }) => {
    console.log('[FFmpeg Progress]', progress, time);
    if (currentProgressCallback) {
      let percentage = progress * 100;
      
      // If we have total duration and time, use that for more accurate progress
      if (currentTotalDuration > 0 && time > 0) {
        // time is in microseconds (us) in ffmpeg.wasm
        const timeInSeconds = time / 1000000;
        const timeBasedPercentage = (timeInSeconds / currentTotalDuration) * 100;
        
        if (timeBasedPercentage > 0 && timeBasedPercentage <= 100) {
          percentage = timeBasedPercentage;
        }
      }
      
      // Clamp percentage
      percentage = Math.min(100, Math.max(0, percentage));

      lastProgressUpdateAt = performance.now();
      lastProgressPercent = Math.round(percentage);
      
      // Only update if progress has changed significantly to avoid jitter
      // or if it's the final completion
      currentProgressCallback(Math.round(percentage), `Traitement en cours...`);
    }
  });

  try {
    onProgress?.(0, safeMode ? 'Chargement de FFmpeg (Mode sans échec)...' : 'Chargement de FFmpeg...');

    // Load FFmpeg core from CDN
    // Prefer multi-threaded core when the page is crossOriginIsolated (SharedArrayBuffer available).
    // This is usually *much* faster for exports/assemblage.
    const isCrossOriginIsolated = typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false;
    const hasSAB = typeof SharedArrayBuffer !== 'undefined';
    const canUseMultiThread = !safeMode && isCrossOriginIsolated && hasSAB;

    const baseURL = canUseMultiThread
      ? 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm'
      : 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

    console.log(`Fetching FFmpeg core files (${canUseMultiThread ? 'Multi-threaded' : 'Single-thread'})...`, {
      safeMode,
      crossOriginIsolated: isCrossOriginIsolated,
      sharedArrayBuffer: hasSAB,
    });
    
    // Add timeout for fetching files
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout loading FFmpeg core files')), 30000)
    );

    const loadPromise = (async () => {
      const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
      const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');
      const workerURL = canUseMultiThread
        ? await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript')
        : undefined;

      console.log('Loading FFmpeg core files...');
      await ffmpeg!.load({
        coreURL,
        wasmURL,
        ...(workerURL ? { workerURL } : {}),
      });
    })();

    await Promise.race([loadPromise, timeoutPromise]);

    isLoaded = true;
    console.log('FFmpeg loaded successfully');
    onProgress?.(100, 'FFmpeg chargé avec succès');
    return ffmpeg;
  } catch (error) {
    console.error('Error loading FFmpeg:', error);
    isLoaded = false;
    ffmpeg = null;
    throw new Error('Impossible de charger FFmpeg. Vérifiez votre connexion Internet et réessayez. (Erreur: ' + (error instanceof Error ? error.message : String(error)) + ')');
  }
}

export function isFFmpegLoaded(): boolean {
  return isLoaded;
}

/**
 * Reset FFmpeg instance (useful for recovery from errors)
 */
export async function resetFFmpeg() {
  if (ffmpeg) {
    try {
      ffmpeg.terminate();
    } catch (e) {
      console.error('Error terminating FFmpeg:', e);
    }
    ffmpeg = null;
  }
  isLoaded = false;
  isFontLoaded = false;
  isOperationInProgress = false;
  currentOperationType = null;
  console.log('FFmpeg instance reset');
}

async function writeFileWithTimeout(ffmpegInstance: FFmpeg, fileName: string, data: Uint8Array | string, timeoutMs: number = 30000): Promise<void> {
  const startTime = performance.now();
  console.log(`⏳ Starting write for ${fileName} (${data instanceof Uint8Array ? data.length : data.length} bytes)...`);
  
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      reject(new Error(`Timeout writing file ${fileName} to FFmpeg FS after ${elapsed}s (stuck at write)`));
    }, timeoutMs);

    ffmpegInstance.writeFile(fileName, data)
      .then(() => {
        clearTimeout(timer);
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ Write completed for ${fileName} in ${elapsed}s`);
        resolve();
      })
      .catch((e) => {
        clearTimeout(timer);
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
        console.error(`❌ Write failed for ${fileName} after ${elapsed}s:`, e);
        reject(e);
      });
  });
}

async function execWithTimeout(ffmpegInstance: FFmpeg, args: string[], timeoutMs: number = 180000): Promise<void> {
  const startTime = performance.now();
  console.log(`⏳ Starting FFmpeg exec (timeout=${timeoutMs}ms):`, args.join(' '));

  // Mark "we have progress" now, so stall detection works from the beginning.
  lastProgressUpdateAt = startTime;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      reject(new Error(`Timeout running FFmpeg exec after ${elapsed}s`));
    }, timeoutMs);

    // Some ffmpeg.wasm builds (especially multi-thread) don't emit progress events reliably.
    // If we haven't received any progress update for a while, simulate a smooth progress ramp
    // so the UI doesn't look frozen. The hard timeout will still protect against real hangs.
    const progressTick = setInterval(() => {
      if (!currentProgressCallback) return;
      const now = performance.now();
      if (now - lastProgressUpdateAt < 2000) return; // we are receiving real progress

      const elapsed = now - startTime;
      // Ramp from 10% -> 98% across the timeout window.
      const simulated = Math.min(98, Math.max(lastProgressPercent, Math.round(10 + (elapsed / timeoutMs) * 88)));
      if (simulated > lastProgressPercent) {
        lastProgressPercent = simulated;
        lastProgressUpdateAt = now;
        currentProgressCallback(simulated, 'Encodage...');
      }
    }, 750);

    ffmpegInstance.exec(args)
      .then(() => {
        clearTimeout(timer);
        clearInterval(progressTick);
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ FFmpeg exec completed in ${elapsed}s`);
        resolve();
      })
      .catch((e) => {
        clearTimeout(timer);
        clearInterval(progressTick);
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
        console.error(`❌ FFmpeg exec failed after ${elapsed}s:`, e);
        reject(e);
      });
  });
}

/**
 * Load a default font into FFmpeg's virtual filesystem for text overlays
 * Uses CORS-friendly CDN sources for Roboto font
 * @returns true if font was loaded successfully, false otherwise
 */
export async function loadDefaultFont(ffmpegInstance: FFmpeg): Promise<boolean> {
  if (isFontLoaded) {
    console.log('🔤 DEBUG - Font already loaded');
    return true;
  }

  try {
    console.log('🔤 DEBUG - Loading default font for text overlays...');
    
    // Font URLs - TTF format REQUIRED for FFmpeg.wasm (WOFF2 not supported)
    // Local TTF file has priority for reliability and compatibility
    const fontUrls = [
      // Local TTF file - PRIORITY (FFmpeg.wasm only supports TTF, not WOFF2)
      '/fonts/Roboto.ttf',
      // CDN TTF fallbacks (if local file fails)
      'https://github.com/ArtifexSoftware/urw-base35-fonts/raw/master/fonts/NimbusSans-Regular.otf',
      'https://cdn.jsdelivr.net/gh/ArtifexSoftware/urw-base35-fonts@master/fonts/NimbusSans-Regular.otf'
    ];
    
    let fontData: Uint8Array | null = null;
    let loadedFromUrl: string | null = null;
    let lastError: Error | null = null;
    
    for (const fontUrl of fontUrls) {
      try {
        console.log(`🔤 DEBUG - Trying to load font from: ${fontUrl}`);
        const response = await fetch(fontUrl, {
          mode: 'cors',
          credentials: 'omit'
        });
        console.log(`🔤 DEBUG - Font fetch response for ${fontUrl}:`, {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get('content-type')
        });
        if (response.ok) {
          fontData = new Uint8Array(await response.arrayBuffer());
          loadedFromUrl = fontUrl;
          console.log(`🔤 DEBUG - Successfully loaded font from: ${fontUrl}, size: ${fontData.length} bytes`);
          break;
        } else {
          lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
          console.warn(`🔤 DEBUG - Font fetch returned status ${response.status} for: ${fontUrl}`);
        }
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        console.warn(`🔤 DEBUG - Failed to fetch font from ${fontUrl}:`, e);
      }
    }
    
    if (fontData) {
      // Create fonts directory in FFmpeg virtual filesystem
      try {
        await ffmpegInstance.createDir('/fonts');
        console.log('🔤 DEBUG - Created /fonts directory in FFmpeg VFS');
      } catch (e) {
        console.log('🔤 DEBUG - /fonts directory already exists or error:', e);
        // Directory might already exist, ignore error
      }
      
      // Write font file to virtual filesystem
      await ffmpegInstance.writeFile(FFMPEG_FONT_PATH, fontData);
      isFontLoaded = true;
      console.log(`🔤 DEBUG - Font loaded successfully into FFmpeg VFS at ${FFMPEG_FONT_PATH}`);
      console.log(`🔤 DEBUG - Font source: ${loadedFromUrl}`);
      return true;
    } else {
      console.error('🔤 DEBUG - ❌ FONT LOADING FAILED - Could not load any font from sources');
      console.error('🔤 DEBUG - Last error:', lastError?.message || 'Unknown error');
      console.error('🔤 DEBUG - Text overlays WILL NOT WORK without a font file');
      console.warn('Consider adding a local font file at public/fonts/Roboto.ttf');
      return false;
    }
  } catch (error) {
    console.error('🔤 DEBUG - ❌ Error loading font:', error);
    // Don't throw - text overlays will fail gracefully
    return false;
  }
}

export function cancelExport() {
  // Cancel MediaBunny export if running
  cancelMediaBunnyExport();

  if (ffmpeg) {
    try {
      ffmpeg.terminate();
    } catch (e) {
      console.error('Error terminating FFmpeg:', e);
    }
    ffmpeg = null;
    isLoaded = false;
  }
}

export function getFilterString(filter: VideoFilter): string {
  const filters: string[] = [];

  if (filter.brightness !== 0) {
    filters.push(`eq=brightness=${filter.brightness / 100}`);
  }

  if (filter.contrast !== 0) {
    filters.push(`eq=contrast=${1 + filter.contrast / 100}`);
  }

  if (filter.saturation !== 0) {
    filters.push(`eq=saturation=${1 + filter.saturation / 100}`);
  }

  if (filter.grayscale) {
    filters.push('hue=s=0');
  }

  if (filter.sepia) {
    filters.push('colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131');
  }

  if (filter.blur > 0) {
    filters.push(`boxblur=${filter.blur}:1`);
  }

  return filters.length > 0 ? filters.join(',') : '';
}

/**
 * Escape text for FFmpeg drawtext filter
 * Special characters need to be escaped: ' : \
 */
function escapeTextForFFmpeg(text: string): string {
  return text
    .replace(/\\/g, '\\\\\\\\')  // Escape backslashes
    .replace(/'/g, "\\'")         // Escape single quotes
    .replace(/:/g, '\\:')         // Escape colons
    .replace(/\[/g, '\\[')        // Escape brackets
    .replace(/\]/g, '\\]');
}

/**
 * Convert hex color to FFmpeg format (0xRRGGBB or with alpha 0xRRGGBBAA)
 */
function hexToFFmpegColor(hex: string): string {
  // Remove # if present
  const cleanHex = hex.replace('#', '');
  return `0x${cleanHex}`;
}

/**
 * Escape FFmpeg filter option expressions for use inside -filter_complex.
 *
 * In filtergraphs, ',' and ':' are structural separators, so expressions like
 * if(a,b,c) MUST escape commas (\,) or the whole graph breaks.
 */
function escapeFilterComplexExpr(expr: string): string {
  return expr
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/'/g, "\\'");
}

/**
 * Generate FFmpeg drawtext filter string for a text overlay
 * @param textOverlay - The text overlay configuration
 * @param videoWidth - The video width in pixels (export resolution)
 * @param videoHeight - The video height in pixels (export resolution)
 * @param fontPath - Path to the font file in FFmpeg virtual filesystem (optional, uses default if not provided)
 * @param referenceWidth - The reference width used in preview (typically ~600px). Used to scale fontSize proportionally.
 * @returns FFmpeg drawtext filter string
 */
export function getTextFilterString(
  textOverlay: TextOverlay,
  videoWidth: number,
  videoHeight: number,
  fontPath: string = FFMPEG_FONT_PATH,
  referenceWidth: number = 600
): string {
  const escapedText = escapeTextForFFmpeg(textOverlay.text);
  const fontColor = hexToFFmpegColor(textOverlay.color);
  
  // Scale fontSize from preview context to export context
  // In preview, text is displayed at fontSize scaled DOWN by (previewWidth / exportWidth)
  // So in export, we need to scale fontSize UP by (exportWidth / referenceWidth)
  // This ensures text appears at the same relative size in both preview and export
  const scaleFactor = videoWidth / referenceWidth;
  const scaledFontSize = Math.round(textOverlay.fontSize * scaleFactor);
  
  // Calculate position in pixels from percentage
  // x and y are percentages (0-100), convert to pixel positions
  // The position represents the CENTER of the text, so we need to offset by half the text dimensions
  // FFmpeg drawtext positions text by its top-left corner, so we subtract half width/height
  // Using FFmpeg expressions: text_w and text_h give the rendered text dimensions
  const xPosBase = Math.round((textOverlay.x / 100) * videoWidth);
  const yPosBase = Math.round((textOverlay.y / 100) * videoHeight);
  
  // Build the drawtext filter
  // IMPORTANT: fontfile is REQUIRED for FFmpeg.wasm - it doesn't have built-in fonts
  // Position is calculated to center the text at the specified coordinates
  // x = baseX - (text_w / 2), y = baseY - (text_h / 2)
  const parts: string[] = [
    `fontfile=${fontPath}`,
    `text='${escapedText}'`,
    `fontsize=${scaledFontSize}`,
    `fontcolor=${fontColor}`,
    `x=${xPosBase}-tw/2`,
    `y=${yPosBase}-th/2`,
  ];
  
  // Add background color if specified
  if (textOverlay.backgroundColor) {
    const bgColor = hexToFFmpegColor(textOverlay.backgroundColor);
    parts.push(`box=1`);
    parts.push(`boxcolor=${bgColor}@0.5`);
    parts.push(`boxborderw=5`);
  }
  
  // Add timing - enable filter only during the text's duration
  const startTime = textOverlay.startTime;
  const endTime = textOverlay.startTime + textOverlay.duration;
  parts.push(`enable='between(t,${startTime},${endTime})'`);
  
  return `drawtext=${parts.join(':')}`;
}

/**
 * Map TransitionType to FFmpeg xfade transition name
 * FFmpeg xfade supports: fade, wipeleft, wiperight, wipeup, wipedown,
 * slideleft, slideright, slideup, slidedown, circlecrop, rectcrop,
 * distance, fadeblack, fadewhite, radial, smoothleft, smoothright,
 * smoothup, smoothdown, circleopen, circleclose, vertopen, vertclose,
 * horzopen, horzclose, dissolve, pixelize, diagtl, diagtr, diagbl, diagbr,
 * hlslice, hrslice, vuslice, vdslice, hblur, fadegrays, wipetl, wipetr,
 * wipebl, wipebr, squeezeh, squeezev, zoomin, fadefast, fadeslow
 */
function mapTransitionTypeToFFmpeg(type: TransitionType): string {
  const mapping: Record<TransitionType, string> = {
    'none': 'fade',
    'fade': 'fade',
    'dissolve': 'dissolve',
    'slide-left': 'slideleft',
    'slide-right': 'slideright',
    'slide-up': 'slideup',
    'slide-down': 'slidedown',
    'slide-diagonal-tl': 'diagtl',
    'slide-diagonal-tr': 'diagtr',
    'wipe-left': 'wipeleft',
    'wipe-right': 'wiperight',
    'wipe-up': 'wipeup',
    'wipe-down': 'wipedown',
    'zoom-in': 'zoomin',
    'zoom-out': 'fadefast', // No direct zoom-out, use fadefast as alternative
    'rotate-in': 'radial',
    'rotate-out': 'radial',
    'circle-wipe': 'circleopen',
    'diamond-wipe': 'rectcrop',
    'cross-dissolve': 'dissolve',
  };
  
  return mapping[type] || 'fade';
}

/**
 * Generate FFmpeg xfade filter string for a transition between two clips
 * @param transition - The transition configuration
 * @param offset - The time offset where the transition starts (in seconds)
 * @returns FFmpeg xfade filter string
 */
export function getTransitionFilter(
  transition: Transition,
  offset: number
): string {
  if (transition.type === 'none') {
    return '';
  }
  
  const ffmpegTransition = mapTransitionTypeToFFmpeg(transition.type);
  const duration = Math.max(0.1, Math.min(transition.duration, 2)); // Clamp duration between 0.1 and 2 seconds
  
  return `xfade=transition=${ffmpegTransition}:duration=${duration}:offset=${offset}`;
}

/**
 * Generate FFmpeg filter for single clip fade in/out effects
 * Used when a transition is applied to a single clip (no other clip to transition to/from)
 * @param transition - The transition configuration
 * @param clipDuration - The duration of the clip in seconds
 * @returns FFmpeg filter string for fade effect
 */
export function getSingleClipTransitionFilter(
  transition: Transition,
  clipDuration: number
): string {
  if (transition.type === 'none') {
    return '';
  }
  
  const duration = Math.max(0.1, Math.min(transition.duration, clipDuration * 0.5)); // Max 50% of clip duration
  const frames = Math.round(duration * 30); // Assuming 30fps for frame-based calculations
  
  // For single clips, we apply fade in/out effects based on position
  // 'start' position = fade in at the beginning
  // 'end' position = fade out at the end
  if (transition.position === 'start') {
    // Fade in effect at the start of the clip
    // Different transition types map to different fade styles
    switch (transition.type) {
      case 'fade':
      case 'dissolve':
      case 'cross-dissolve':
        return `fade=t=in:st=0:d=${duration}`;
      case 'zoom-in':
        // Zoom in from smaller to normal size
        return `zoompan=z='if(lte(on,${frames}),1.5-0.5*on/${frames},1)':d=1:s=iw*2:ih*2,fade=t=in:st=0:d=${duration}`;
      case 'zoom-out':
        // Start zoomed in, zoom out to normal
        return `zoompan=z='if(lte(on,${frames}),1+0.5*on/${frames},1.5)':d=1:s=iw*2:ih*2,fade=t=in:st=0:d=${duration}`;
      case 'rotate-in':
        // Rotate in effect: start rotated (PI radians = 180°) and rotate to normal (0°)
        // The rotation angle decreases from PI to 0 over the duration
        // Using format filter to ensure proper pixel format for rotation
        // Using ow=iw:oh=ih to keep original dimensions (avoids "height not divisible by 2" errors)
        return `format=yuva444p,rotate=a='if(lt(t,${duration}),PI*(1-t/${duration}),0)':c=black@0:ow=iw:oh=ih,format=yuv420p,fade=t=in:st=0:d=${duration}`;
      case 'rotate-out':
        // For rotate-out at start position, we rotate FROM a rotated state TO normal
        // This is similar to rotate-in but conceptually the "out" refers to the previous clip
        // Using ow=iw:oh=ih to keep original dimensions (avoids "height not divisible by 2" errors)
        return `format=yuva444p,rotate=a='if(lt(t,${duration}),PI*(1-t/${duration}),0)':c=black@0:ow=iw:oh=ih,format=yuv420p,fade=t=in:st=0:d=${duration}`;
      case 'wipe-left':
      case 'wipe-right':
      case 'wipe-up':
      case 'wipe-down':
      case 'circle-wipe':
      case 'diamond-wipe':
        // Wipe effects - use fade as approximation for single clip
        return `fade=t=in:st=0:d=${duration}`;
      default:
        return `fade=t=in:st=0:d=${duration}`;
    }
  } else if (transition.position === 'end') {
    // Fade out effect at the end of the clip
    const fadeStart = Math.max(0, clipDuration - duration);
    switch (transition.type) {
      case 'fade':
      case 'dissolve':
      case 'cross-dissolve':
        return `fade=t=out:st=${fadeStart}:d=${duration}`;
      case 'zoom-in':
        // Zoom in at the end (zoom out of frame)
        return `fade=t=out:st=${fadeStart}:d=${duration}`;
      case 'zoom-out':
        // Zoom out at the end
        return `fade=t=out:st=${fadeStart}:d=${duration}`;
      case 'rotate-in':
        // For rotate-in at end position, rotate from normal to rotated state
        // Using ow=iw:oh=ih to keep original dimensions (avoids "height not divisible by 2" errors)
        return `format=yuva444p,rotate=a='if(gt(t,${fadeStart}),PI*(t-${fadeStart})/${duration},0)':c=black@0:ow=iw:oh=ih,format=yuv420p,fade=t=out:st=${fadeStart}:d=${duration}`;
      case 'rotate-out':
        // Rotate out effect: start normal (0°) and rotate to PI radians (180°)
        // The rotation angle increases from 0 to PI over the duration at the end
        // Using ow=iw:oh=ih to keep original dimensions (avoids "height not divisible by 2" errors)
        return `format=yuva444p,rotate=a='if(gt(t,${fadeStart}),PI*(t-${fadeStart})/${duration},0)':c=black@0:ow=iw:oh=ih,format=yuv420p,fade=t=out:st=${fadeStart}:d=${duration}`;
      case 'wipe-left':
      case 'wipe-right':
      case 'wipe-up':
      case 'wipe-down':
      case 'circle-wipe':
      case 'diamond-wipe':
        // Wipe effects - use fade as approximation for single clip
        return `fade=t=out:st=${fadeStart}:d=${duration}`;
      default:
        return `fade=t=out:st=${fadeStart}:d=${duration}`;
    }
  }
  
  return '';
}

/**
 * Generate audio crossfade filter for transitions
 * @param duration - Transition duration in seconds
 * @param offset - The time offset where the transition starts
 * @returns FFmpeg acrossfade filter string
 */
export function getAudioTransitionFilter(
  duration: number,
  offset: number
): string {
  return `acrossfade=d=${duration}:c1=tri:c2=tri`;
}

export async function trimVideo(
  inputFile: File,
  startTime: number,
  duration: number,
  onProgress?: (progress: number, message: string) => void
): Promise<Blob> {
  const ffmpegInstance = await loadFFmpeg(onProgress);
  
  const inputFileName = 'input' + getFileExtension(inputFile.name);
  const outputFileName = 'output.mp4';

  await ffmpegInstance.writeFile(inputFileName, await fetchFile(inputFile));

  await ffmpegInstance.exec([
    '-i', inputFileName,
    '-ss', startTime.toString(),
    '-t', duration.toString(),
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-strict', 'experimental',
    outputFileName
  ]);

  const data = await ffmpegInstance.readFile(outputFileName);
  
  // Clean up
  await ffmpegInstance.deleteFile(inputFileName);
  await ffmpegInstance.deleteFile(outputFileName);

  return new Blob([data as any], { type: 'video/mp4' });
}

export async function applyFilter(
  inputFile: File,
  filter: VideoFilter,
  onProgress?: (progress: number, message: string) => void
): Promise<Blob> {
  const ffmpegInstance = await loadFFmpeg(onProgress);
  
  const inputFileName = 'input' + getFileExtension(inputFile.name);
  const outputFileName = 'output.mp4';
  const filterString = getFilterString(filter);

  await ffmpegInstance.writeFile(inputFileName, await fetchFile(inputFile));

  const args = ['-i', inputFileName];
  
  if (filterString) {
    args.push('-vf', filterString);
  }
  
  args.push('-c:v', 'libx264', '-c:a', 'aac', outputFileName);

  await ffmpegInstance.exec(args);

  const data = await ffmpegInstance.readFile(outputFileName);
  
  await ffmpegInstance.deleteFile(inputFileName);
  await ffmpegInstance.deleteFile(outputFileName);

  return new Blob([data as any], { type: 'video/mp4' });
}

export async function generateThumbnail(
  inputFile: File,
  timeInSeconds: number = 0
): Promise<string> {
  // Prefer native (video element + canvas) thumbnail generation.
  // This avoids loading FFmpeg and prevents export/thumbnail contention.
  if (typeof document !== 'undefined' && inputFile.type.startsWith('video/')) {
    try {
      const url = URL.createObjectURL(inputFile);
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.src = url;

      await new Promise<void>((resolve, reject) => {
        const onLoaded = () => resolve();
        const onErr = () => reject(new Error('Failed to load video for thumbnail'));
        video.addEventListener('loadedmetadata', onLoaded, { once: true });
        video.addEventListener('error', onErr, { once: true });
      });

      const seekTime = Math.max(0, Math.min(timeInSeconds, Math.max(0, (video.duration || 0) - 0.05)));
      if (Number.isFinite(seekTime)) {
        try {
          video.currentTime = seekTime;
        } catch {
          // ignore
        }
      }

      await new Promise<void>((resolve, reject) => {
        const onSeeked = () => resolve();
        const onErr = () => reject(new Error('Failed to seek video for thumbnail'));
        video.addEventListener('seeked', onSeeked, { once: true });
        video.addEventListener('error', onErr, { once: true });
        // Some browsers may not fire seeked if already at time 0
        setTimeout(() => resolve(), 250);
      });

      const targetW = 160;
      const aspect = video.videoWidth > 0 ? video.videoHeight / video.videoWidth : 9 / 16;
      const targetH = Math.max(1, Math.round(targetW * aspect));

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No canvas context');
      ctx.drawImage(video, 0, 0, targetW, targetH);

      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.8);
      });

      URL.revokeObjectURL(url);
      return URL.createObjectURL(blob);
    } catch (e) {
      console.warn('Native thumbnail generation failed, falling back to FFmpeg:', e);
    }
  }

  // Check if another operation is in progress
  if (isOperationInProgress) {
    console.log('⏳ Thumbnail generation skipped - another FFmpeg operation is in progress:', currentOperationType);
    // Return a placeholder or empty string instead of blocking
    return '';
  }
  
  isOperationInProgress = true;
  currentOperationType = 'thumbnail';
  
  try {
    const ffmpegInstance = await loadFFmpeg();
    
    const inputFileName = 'input' + getFileExtension(inputFile.name);
    const outputFileName = 'thumbnail.jpg';

    await ffmpegInstance.writeFile(inputFileName, await fetchFile(inputFile));

    await ffmpegInstance.exec([
      '-i', inputFileName,
      '-ss', timeInSeconds.toString(),
      '-vframes', '1',
      '-vf', 'scale=160:-1',
      outputFileName
    ]);

    const data = await ffmpegInstance.readFile(outputFileName);
    
    await ffmpegInstance.deleteFile(inputFileName);
    await ffmpegInstance.deleteFile(outputFileName);

    const blob = new Blob([data as any], { type: 'image/jpeg' });
    return URL.createObjectURL(blob);
  } finally {
    isOperationInProgress = false;
    currentOperationType = null;
  }
}

async function _exportProjectInternal(
  clips: { file: File; startTime: number; duration: number; trimStart: number; trimEnd: number; filter?: VideoFilter; id?: string; audioMuted?: boolean }[],
  settings: ExportSettings,
  onProgress?: (progress: number, message: string) => void,
  textOverlays?: TextOverlay[],
  transitions?: Transition[],
  aspectRatio?: AspectRatio,
  hardwareProfile?: AnyHardwareProfile,
  safeMode: boolean = false,
  audioClips?: { file: File; startTime: number; duration: number; trimStart: number; trimEnd: number; id?: string }[]
): Promise<Blob> {
  // Check for complex features that MediaBunny implementation doesn't support yet
  // Update: MediaBunny now supports Filters, Text, and basic Transitions (Fades)
  // We only fallback if there are features we absolutely cannot handle efficiently yet
  // For now, we let MediaBunny try everything. If it fails, the catch block will handle fallback.
  
  /* 
  const hasTextOverlays = textOverlays && textOverlays.length > 0 && textOverlays.some(t => t.text.trim().length > 0);
  const hasTransitions = transitions && transitions.length > 0 && transitions.some(t => t.type !== 'none');
  const hasFilters = clips.some(c => c.filter && (
    c.filter.brightness !== 0 || 
    c.filter.contrast !== 0 || 
    c.filter.saturation !== 0 || 
    c.filter.grayscale || 
    c.filter.sepia || 
    c.filter.blur > 0
  ));
  
  // If complex features are present, skip MediaBunny and use FFmpeg
  if (hasTextOverlays || hasTransitions || hasFilters) {
    console.log('⚠️ Complex features detected (Text/Transitions/Filters), falling back to FFmpeg for full support.');
    // Fallthrough to FFmpeg implementation below
  } else {
  */
    try {
        // Try MediaBunny for fast export
        return await exportProjectWithMediaBunny(
            clips,
            settings,
            onProgress,
            textOverlays,
            transitions,
            aspectRatio,
            hardwareProfile,
            safeMode,
            audioClips
        );
    } catch (error) {
        console.error('MediaBunny export failed:', error);
        throw error;
    }
    
    // FFmpeg logic disabled
    return new Blob([]); 


  // Prevent concurrent exports (they will terminate each other in ffmpeg.wasm)

  // Prevent concurrent exports (they will terminate each other in ffmpeg.wasm)
  if (isOperationInProgress && currentOperationType === 'export') {
    throw new Error('Un export est déjà en cours. Veuillez patienter.');
  }

  // If a thumbnail (or other lightweight op) is running, wait briefly instead of terminating FFmpeg.
  if (isOperationInProgress && currentOperationType && currentOperationType !== 'export') {
    console.log('⏳ Waiting for FFmpeg operation to finish:', currentOperationType);
    const start = performance.now();
    const timeoutMs = 4000;
    while (isOperationInProgress && performance.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (isOperationInProgress) {
      console.warn('⚠️ Previous FFmpeg operation did not finish in time, resetting instance...');
      await resetFFmpeg();
    }
  }
  
  isOperationInProgress = true;
  currentOperationType = 'export';
  
  try {
    // Calculate total duration for progress normalization
    currentTotalDuration = clips.reduce((acc, clip) => acc + (clip.duration - clip.trimStart - clip.trimEnd), 0);
    
    onProgress?.(1, safeMode ? 'Chargement de FFmpeg (Mode sans échec)...' : 'Chargement de FFmpeg...');
    
    // Define a specific progress handler for export
    const exportProgressHandler = (percent: number, msg: string) => {
      // Ensure progress is strictly increasing and within bounds
      // Map 0-100 from FFmpeg to 0-95 for the UI to reserve space for finalization
      const scaledPercent = Math.round(percent * 0.95);
      const safePercent = Math.min(95, Math.max(0, scaledPercent));
      onProgress?.(safePercent, `Traitement en cours...`);
    };

    const ffmpegInstance = await loadFFmpeg(exportProgressHandler, { safeMode });
    
    // Load font for text overlays if there are any text overlays
    if (textOverlays && textOverlays.length > 0 && textOverlays.some(t => t.text.trim())) {
      onProgress?.(2, 'Chargement de la police...');
      await loadDefaultFont(ffmpegInstance);
    }
    
    onProgress?.(3, 'Préparation des paramètres...');
    // Get resolution based on aspect ratio if provided, otherwise use default 16:9
    const effectiveAspectRatio = aspectRatio || settings.aspectRatio || '16:9';
    const resolution = getResolutionForAspectRatio(settings.resolution, effectiveAspectRatio);
    console.log(`📐 Export resolution: ${resolution.width}x${resolution.height} (${effectiveAspectRatio})`);
    const outputFormat = settings.format;
    
    // Get hardware-optimized encoding settings
    const effectiveHardwareProfile = hardwareProfile || cachedHardwareProfile;
    const encodingSettings = getOptimalEncodingSettings(
      effectiveHardwareProfile,
      outputFormat as 'mp4' | 'webm',
      settings.quality,
      safeMode
    );
    
    // Log encoding optimization info with detailed performance metrics
    const estimatedTime = estimateEncodingTime(
      effectiveHardwareProfile,
      currentTotalDuration,
      resolution
    );

    // Dynamic timeout: short exports should fail fast if the wasm core deadlocks.
    // Longer exports get more headroom, and safeMode is more conservative.
    // NOTE: ffmpeg.wasm can run far slower than our heuristic estimate depending on filters.
    // Use generous minimums to avoid false timeouts (especially in SAFE MODE which is single-thread).
    const execTimeoutMs = safeMode
      ? Math.max(600_000, estimatedTime * 1000 * 60) // >= 10 minutes
      : Math.max(240_000, estimatedTime * 1000 * 30); // >= 4 minutes
    
    console.log(safeMode ? '🛡️ EXPORT SAFE MODE ACTIVE' : '🚀 EXPORT SPEED OPTIMIZATION ACTIVE');
    console.log('═══════════════════════════════════════════════════════════');
    
    // Safe logging for different profile types
    let gpuVendor = 'unknown';
    let gpuTier = 'unknown';

    if (effectiveHardwareProfile && 'gpu' in effectiveHardwareProfile) {
      const profile = effectiveHardwareProfile as DetectionHardwareProfile;
      gpuVendor = profile.gpu?.vendor || 'unknown';
      gpuTier = profile.gpu?.tier || 'unknown';
    }
    
    let cpuCores: number | string = 'unknown';
    let isAppleSilicon = false;
    let memoryTier = 'unknown';

    if (effectiveHardwareProfile) {
      if ('processor' in effectiveHardwareProfile) {
        const profile = effectiveHardwareProfile as DetectionHardwareProfile;
        cpuCores = profile.processor?.cores || 'unknown';
        isAppleSilicon = profile.processor?.isAppleSilicon || false;
        memoryTier = profile.memory?.tier || 'unknown';
      } else if ('cpuCores' in effectiveHardwareProfile) {
        const profile = effectiveHardwareProfile as PreviewHardwareProfile;
        cpuCores = profile.cpuCores;
        isAppleSilicon = profile.isAppleSilicon;
        // Infer memory tier from score if available
        const score = profile.performanceScore || 50;
        memoryTier = score > 70 ? 'high' : score > 40 ? 'medium' : 'low';
      }
    }

    console.log('📊 Hardware Profile:', {
      gpu: gpuVendor,
      gpuTier: gpuTier,
      cpuCores: cpuCores || navigator.hardwareConcurrency || 'unknown',
      isAppleSilicon: isAppleSilicon,
      memoryTier: memoryTier,
    });
    console.log('⚡ Speed-Optimized Encoding Settings:', {
      preset: encodingSettings.preset,
      crf: encodingSettings.crf,
      threads: encodingSettings.threads,
      targetFps: encodingSettings.targetFps,
      additionalFlags: encodingSettings.additionalFlags,
    });
    console.log('📹 Video Details:', {
      duration: `${currentTotalDuration.toFixed(1)}s`,
      resolution: `${resolution.width}x${resolution.height}`,
      format: outputFormat,
      quality: settings.quality,
    });
    console.log(`⏱️ Estimated encoding time: ${formatEncodingTime(estimatedTime)} for ${currentTotalDuration.toFixed(1)}s video`);
    console.log('═══════════════════════════════════════════════════════════');
    
    // Store start time for actual encoding time measurement
    const encodingStartTime = performance.now();
    
    const quality = encodingSettings.crf;

    if (clips.length === 0) {
      throw new Error('Aucun clip à exporter');
    }

    // For a single clip, simple export
    if (clips.length === 1) {
      onProgress?.(5, 'Chargement du fichier...');
      const clip = clips[0];
      const inputFileName = 'input' + getFileExtension(clip.file.name);
      const outputFileName = `output.${outputFormat}`;

      console.log('📂 Writing file to FFmpeg FS:', inputFileName, 'Size:', clip.file.size);
      const fileData = await fetchFile(clip.file);
      console.log('📂 File data fetched, writing to FS...');
      
      // Try to delete file if it exists to prevent issues
      try {
        await ffmpegInstance.deleteFile(inputFileName);
        console.log('🗑️ Deleted existing file from FS');
      } catch (e) {
        // Ignore error if file doesn't exist
      }

      // Explicitly cast to Uint8Array to ensure compatibility
      const dataArray = fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData);
      await writeFileWithTimeout(ffmpegInstance, inputFileName, dataArray);
      console.log('✅ File written to FS');

      onProgress?.(5, 'Traitement de la vidéo...');

      const clipDuration = clip.duration - clip.trimStart - clip.trimEnd;
      const requestedFps = parseInt(settings.fps || '30', 10);
      const effectiveFps = Math.min(requestedFps, encodingSettings.targetFps);

      // Audio clips placed on timeline audio tracks (WAV/MP3/etc)
      // NOTE: do not rely on MIME type (can be empty for WAV)
      const externalAudioClipsSingle = (audioClips || []).filter((c) => isLikelyAudioFile(c.file));
      // Export pipeline ignores initial gap; align audio to the first video clip start.
      const timeOriginSingle = clip.startTime;

      // Detect transitions for this clip
      const clipId = clip.id;
      const clipTransitions = (transitions || []).filter((t) => t.clipId === clipId && t.type !== 'none');
      const hasClipTransitions = clipTransitions.length > 0;

      // FAST PATH: no transitions AND no external audio override AND clip audio not muted
      // -> keep -vf pipeline (cheapest)
      if (!hasClipTransitions && externalAudioClipsSingle.length === 0 && !clip.audioMuted) {
        // Build video filter chain
        let videoFilterChain = `scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2`;

        // Add clip filter if present
        if (clip.filter) {
          const filterString = getFilterString(clip.filter);
          if (filterString) {
            videoFilterChain += ',' + filterString;
          }
        }

        // Add text overlays for single clip export
        if (textOverlays && textOverlays.length > 0) {
          const relevantTexts = textOverlays.filter((text) => {
            const textEnd = text.startTime + text.duration;
            return text.text.trim() && text.startTime < clipDuration && textEnd > 0;
          });

          for (const text of relevantTexts) {
            // Adjust text timing relative to clip
            const adjustedText = {
              ...text,
              startTime: Math.max(0, text.startTime - clip.trimStart),
              duration: text.duration,
            };

            const endTime = adjustedText.startTime + adjustedText.duration;
            if (endTime > clipDuration) {
              adjustedText.duration = clipDuration - adjustedText.startTime;
            }

            if (adjustedText.duration > 0) {
              const textFilter = getTextFilterString(adjustedText, resolution.width, resolution.height);
              videoFilterChain += ',' + textFilter;
            }
          }
        }

        // Build base args with hardware-optimized settings
        let args = [
          '-i', inputFileName,
          '-ss', clip.trimStart.toString(),
          '-t', clipDuration.toString(),
          '-vf', videoFilterChain,
          '-c:v', encodingSettings.videoCodec,
          '-crf', quality,
          '-c:a', outputFormat === 'webm' ? 'libopus' : 'aac',
          '-preset', encodingSettings.preset,
          '-r', String(effectiveFps),
          '-pix_fmt', encodingSettings.pixelFormat,
          '-threads', encodingSettings.threads,
          outputFileName
        ];

        // Apply hardware-optimized additional flags
        args = buildOptimizedArgs(args, encodingSettings);

        console.log('FFmpeg command:', args.join(' '));
        await execWithTimeout(ffmpegInstance, args, execTimeoutMs);
        
        onProgress?.(96, 'Finalisation...');
      } else {
        // filter_complex path: transitions and/or external audio override
        const startTransition = clipTransitions.find((t) => t.position === 'start');
        const endTransition = clipTransitions.find((t) => t.position === 'end');
        const needsBg = hasClipTransitions;

        // Extra audio inputs (WAV/etc) different from the video input
        const extraAudioFiles: File[] = [];
        for (const ac of externalAudioClipsSingle) {
          if (ac.file === clip.file) continue;
          if (!extraAudioFiles.includes(ac.file)) extraAudioFiles.push(ac.file);
        }

        const extraAudioInputNames: string[] = [];
        for (let i = 0; i < extraAudioFiles.length; i++) {
          const file = extraAudioFiles[i];
          const name = `audio_input${i}${getFileExtension(file.name)}`;
          extraAudioInputNames.push(name);
          try {
            await ffmpegInstance.deleteFile(name);
          } catch {}
          const buf = new Uint8Array(await file.arrayBuffer());
          await writeFileWithTimeout(ffmpegInstance, name, buf, safeMode ? 60000 : 45000);
        }

        const bgInputIndex = 1 + extraAudioInputNames.length;
        const fc: string[] = [];

        // Video base => [v0]
        let vBase = `[0:v]trim=start=${clip.trimStart}:duration=${clipDuration},setpts=PTS-STARTPTS,scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2,fps=${effectiveFps}`;
        if (clip.filter) {
          const filterString = getFilterString(clip.filter);
          if (filterString) vBase += `,${filterString}`;
        }
        fc.push(`${vBase}[v0]`);

        if (needsBg) {
          fc.push(`[${bgInputIndex}:v]setpts=PTS-STARTPTS[bg]`);
        }

        // Build audio output => [a0]
        if (externalAudioClipsSingle.length > 0) {
          const sortedAudio = [...externalAudioClipsSingle].sort((a, b) => a.startTime - b.startTime);
          const parts: string[] = [];
          let cursor = 0;
          let seg = 0;

          for (const ac of sortedAudio) {
            const dur = Math.max(0, ac.duration - ac.trimStart - ac.trimEnd);
            if (dur <= 0.001) continue;

            // Align to export origin (video initial gap is removed)
            const requestedStart = Math.max(0, ac.startTime - timeOriginSingle);
            const start = Math.max(requestedStart, cursor);
            const gap = start - cursor;
            if (gap > 0.01) {
              const gl = `agap0_${seg++}`;
              fc.push(`aevalsrc=0:d=${gap}:s=48000:c=stereo[${gl}]`);
              parts.push(`[${gl}]`);
              cursor += gap;
            }

            const inputIndex = ac.file === clip.file ? 0 : 1 + extraAudioFiles.findIndex((f) => f === ac.file);
            const al = `aext0_${seg++}`;
            fc.push(`[${inputIndex}:a]atrim=start=${ac.trimStart}:duration=${dur},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[${al}]`);
            parts.push(`[${al}]`);
            cursor += dur;
          }

          const tail = clipDuration - cursor;
          if (tail > 0.01) {
            const tl = `atail0_${seg++}`;
            fc.push(`aevalsrc=0:d=${tail}:s=48000:c=stereo[${tl}]`);
            parts.push(`[${tl}]`);
          }

          if (parts.length === 0) {
            fc.push(`aevalsrc=0:d=${clipDuration}:s=48000:c=stereo[a0]`);
          } else {
            fc.push(`${parts.join('')}concat=n=${parts.length}:v=0:a=1[a0]`);
          }
        } else if (clip.audioMuted) {
          fc.push(`aevalsrc=0:d=${clipDuration}:s=48000:c=stereo[a0]`);
        } else {
          fc.push(`[0:a]atrim=start=${clip.trimStart}:duration=${clipDuration},asetpts=PTS-STARTPTS[a0]`);
        }

        // Apply transitions on video only
        let vLabel = 'v0';
        if (needsBg && startTransition && startTransition.type !== 'none') {
          const d = Math.max(0.1, Math.min(startTransition.duration, clipDuration * 0.5));
          const transName = mapTransitionTypeToFFmpeg(startTransition.type);
          fc.push(`[bg][${vLabel}]xfade=transition=${transName}:duration=${d}:offset=0[vstart]`);
          vLabel = 'vstart';
        }

        if (needsBg && endTransition && endTransition.type !== 'none') {
          const d = Math.max(0.1, Math.min(endTransition.duration, clipDuration * 0.5));
          const st = Math.max(0, clipDuration - d);
          const transName = mapTransitionTypeToFFmpeg(endTransition.type);
          fc.push(`[${vLabel}][bg]xfade=transition=${transName}:duration=${d}:offset=${st}[vend]`);
          vLabel = 'vend';
        }

        // Text overlays (on final video)
        if (textOverlays && textOverlays.length > 0 && textOverlays.some((t) => t.text.trim())) {
          const validTexts = textOverlays.filter((t) => t.text.trim());
          let inV = vLabel;
          for (let i = 0; i < validTexts.length; i++) {
            const text = validTexts[i];
            const textFilter = getTextFilterString(text, resolution.width, resolution.height);
            const outV = i === validTexts.length - 1 ? 'vfinal' : `vtext${i}`;
            fc.push(`[${inV}]${textFilter}[${outV}]`);
            inV = outV;
          }
          vLabel = 'vfinal';
        }

        const baseArgs: string[] = ['-i', inputFileName];
        for (const n of extraAudioInputNames) baseArgs.push('-i', n);
        if (needsBg) {
          const bgLavfi = `color=c=black:s=${resolution.width}x${resolution.height}:r=${effectiveFps}:d=${clipDuration}`;
          baseArgs.push('-f', 'lavfi', '-i', bgLavfi);
        }

        let args = [
          ...baseArgs,
          '-progress', 'pipe:1',
          '-nostats',
          '-filter_complex', fc.join(';'),
          '-map', `[${vLabel}]`,
          '-map', '[a0]',
          '-c:v', encodingSettings.videoCodec,
          '-crf', quality,
          '-c:a', outputFormat === 'webm' ? 'libopus' : 'aac',
          '-preset', encodingSettings.preset,
          '-r', String(effectiveFps),
          '-pix_fmt', encodingSettings.pixelFormat,
          '-threads', encodingSettings.threads,
          '-shortest',
          // '-movflags', '+faststart', // Removed to prevent blocking
          outputFileName
        ];

        args = buildOptimizedArgs(args, encodingSettings);
        console.log('FFmpeg command:', args.join(' '));
        await execWithTimeout(ffmpegInstance, args, execTimeoutMs);
        
        onProgress?.(96, 'Finalisation...');

        // Cleanup extra audio FS files
        for (const n of extraAudioInputNames) {
          try {
            await ffmpegInstance.deleteFile(n);
          } catch {}
        }
      }

      onProgress?.(98, 'Finalisation...');
      const data = await ffmpegInstance.readFile(outputFileName);
      
      await ffmpegInstance.deleteFile(inputFileName);
      await ffmpegInstance.deleteFile(outputFileName);

      // Log actual encoding time for single clip
      const actualEncodingTime = (performance.now() - encodingStartTime) / 1000;
      console.log('✅ EXPORT COMPLETE (Single Clip)');
      console.log(`⏱️ Actual encoding time: ${formatEncodingTime(Math.ceil(actualEncodingTime))}`);
      console.log(`📈 Speed ratio: ${(currentTotalDuration / actualEncodingTime).toFixed(2)}x realtime`);

      onProgress?.(100, 'Terminé !');
      return new Blob([data as any], { type: outputFormat === 'webm' ? 'video/webm' : 'video/mp4' });
    }

    // For multiple clips, concatenate - OPTIMIZED VERSION
    onProgress?.(5, 'Chargement des fichiers...');
    const inputFiles: string[] = [];
    const filterComplex: string[] = [];

    // External audio track clips (WAV/MP3/etc) passed from the timeline.
    // If present, we will override the exported audio with these clips.
    const externalAudioClips = (audioClips || []).filter((c) => isLikelyAudioFile(c.file));
    const externalAudioFileToInputIndex = new Map<File, number>();

    // Timeline start alignment: export pipeline ignores initial gaps for video.
    // We align audio-track clips to the same origin so they sync with exported video.
    const timeOrigin = clips.length > 0 ? Math.min(...clips.map((c) => c.startTime)) : 0;
    
    // OPTIMIZATION: Simplified approach - avoid complex intermediate processing
    // 1. Load all files first
    // 2. Build a single optimized filter chain
    // 3. Use direct concat when no transitions, xfade only when needed
    
    // Track gaps between clips based on their startTime positions
    // OPTIMIZATION: We ignore the initial gap (before first clip) as it's usually not needed in export
    // This significantly speeds up export by avoiding black frame generation
    interface GapInfo {
      beforeClipIndex: number;
      duration: number;
    }
    const gaps: GapInfo[] = [];
    
    // Calculate effective durations and detect gaps
    console.log('🕳️ DEBUG - Detecting gaps between clips (ignoring initial gap for speed)');
    
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const effectiveDuration = clip.duration - clip.trimStart - clip.trimEnd;
      const clipStartTime = clip.startTime;
      
      if (i === 0) {
        // OPTIMIZATION: Skip initial gap - it's just empty space before the first clip
        // Users rarely want black frames at the start of their exported video
        if (clipStartTime > 0.01) {
          console.log(`🕳️ DEBUG - Ignoring initial gap of ${clipStartTime.toFixed(2)}s (optimization)`);
        }
      } else {
        const prevClip = clips[i - 1];
        const prevEffectiveDuration = prevClip.duration - prevClip.trimStart - prevClip.trimEnd;
        const expectedStartTime = prevClip.startTime + prevEffectiveDuration;
        const gapDuration = clipStartTime - expectedStartTime;
        if (gapDuration > 0.01) {
          gaps.push({ beforeClipIndex: i, duration: gapDuration });
        }
      }
    }
    
    console.log(`🕳️ DEBUG - Total gaps detected (excluding initial): ${gaps.length}`);
    
    const gapMap = new Map<number, number>();
    for (const gap of gaps) {
      gapMap.set(gap.beforeClipIndex, gap.duration);
    }
    
    // OPTIMIZATION: Deduplicate files - when clips are split from the same source, load only once
    const clipToInputIndex = new Map<number, number>(); // Maps clip index to input file index
    
    // First pass: identify unique files
    const uniqueFiles: { file: File; originalIndex: number }[] = [];
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      // Check if this exact File object was already seen
      let found = false;
      for (let j = 0; j < uniqueFiles.length; j++) {
        if (uniqueFiles[j].file === clip.file) {
          clipToInputIndex.set(i, j);
          found = true;
          break;
        }
      }
      if (!found) {
        clipToInputIndex.set(i, uniqueFiles.length);
        uniqueFiles.push({ file: clip.file, originalIndex: i });
      }
    }
    
    console.log(`📂 OPTIMIZATION: ${clips.length} clips use ${uniqueFiles.length} unique file(s)`);
    
    // Load only unique files - SEQUENTIAL to avoid memory issues
    // FFmpeg.wasm can have issues with parallel writes
    console.log(`📂 Loading ${uniqueFiles.length} unique file(s)...`);

    // Metadata cache (used for smart scaling decisions)
    const inputVideoMeta = new Map<number, { width: number; height: number }>();
    
    for (let i = 0; i < uniqueFiles.length; i++) {
      const { file } = uniqueFiles[i];
      const inputFileName = `input${i}${getFileExtension(file.name)}`;
      inputFiles.push(inputFileName);

      // Read basic metadata once per unique file (lets us skip scale/pad when unnecessary)
      if (file.type.startsWith('video/')) {
        try {
          const meta = await getVideoMetadata(file);
          inputVideoMeta.set(i, { width: meta.width, height: meta.height });
        } catch {
          // Non-blocking
        }
      }
      
      // Keep the UI alive during long load stages
      onProgress?.(5, `Chargement des fichiers... (${i + 1}/${uniqueFiles.length})`);

      console.log(`📂 [${i + 1}/${uniqueFiles.length}] Reading file: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
      const fetchStart = performance.now();
      
      // Use arrayBuffer directly instead of fetchFile for better performance with local files
      const arrayBuffer = await file.arrayBuffer();
      const dataArray = new Uint8Array(arrayBuffer);
      
      const fetchTime = ((performance.now() - fetchStart) / 1000).toFixed(2);
      console.log(`📂 [${i + 1}/${uniqueFiles.length}] File read in ${fetchTime}s, writing to FFmpeg FS...`);
      
      // Delete existing file if any
      try {
        await ffmpegInstance.deleteFile(inputFileName);
        console.log(`🗑️ Deleted existing ${inputFileName}`);
      } catch (e) {
        // File doesn't exist, that's fine
      }
      
      // Write to FFmpeg FS with a timeout to avoid indefinite hangs (common on large/many inputs)
      console.log(`📝 Writing to FFmpeg FS: ${inputFileName}...`);
      await writeFileWithTimeout(ffmpegInstance, inputFileName, dataArray, safeMode ? 60000 : 45000);
      console.log(`✅ [${i + 1}/${uniqueFiles.length}] File written to FFmpeg FS: ${inputFileName}`);
    }
    
    console.log(`✅ All ${uniqueFiles.length} unique file(s) loaded successfully`);

    // Load external audio inputs that are not already part of the unique video inputs.
    if (externalAudioClips.length > 0) {
      const extraAudioFiles: File[] = [];

      for (const ac of externalAudioClips) {
        const f = ac.file;
        const existingVideoIdx = uniqueFiles.findIndex((u) => u.file === f);
        if (existingVideoIdx !== -1) {
          externalAudioFileToInputIndex.set(f, existingVideoIdx);
          continue;
        }
        if (!extraAudioFiles.includes(f)) extraAudioFiles.push(f);
      }

      console.log(`🔊 Loading ${extraAudioFiles.length} external audio file(s)...`);
      for (let i = 0; i < extraAudioFiles.length; i++) {
        const file = extraAudioFiles[i];
        const inputIndex = uniqueFiles.length + i;
        externalAudioFileToInputIndex.set(file, inputIndex);

        const inputFileName = `audio_input${i}${getFileExtension(file.name)}`;
        inputFiles.push(inputFileName);

        onProgress?.(5, `Chargement des fichiers audio... (${i + 1}/${extraAudioFiles.length})`);
        try {
          await ffmpegInstance.deleteFile(inputFileName);
        } catch {}
        const dataArray = new Uint8Array(await file.arrayBuffer());
        await writeFileWithTimeout(ffmpegInstance, inputFileName, dataArray, safeMode ? 60000 : 45000);
      }
      console.log('✅ External audio inputs loaded');
    }
    
    // OPTIMIZATION: Build simplified filter chain
    const targetFps = parseInt(settings.fps || '30');

    const hasImages = clips.some((c) => c.file.type.startsWith('image/'));
    const hasAnyTransitionMarkers = !!(transitions && transitions.some((t) => t.type !== 'none'));
    // IMPORTANT:
    // - For xfade stability, inputs MUST have matching timebases.
    // - Single-file projects often have timebase 1/15360; without normalization xfade fails.
    // So when transitions exist we force fps+settb on each clip stream.
    const needsPerClipTimebaseNormalization = hasAnyTransitionMarkers;
    const needsFpsNormalization = uniqueFiles.length > 1 || hasImages || needsPerClipTimebaseNormalization;
    
    // Generate gap segments (black video + silence)
    let gapCounter = 0;
    for (const gap of gaps) {
      const gapVideoLabel = `vgap${gapCounter}`;
      const gapAudioLabel = `agap${gapCounter}`;
      // Simplified: generate at target fps directly, no extra normalization
      filterComplex.push(`color=c=black:s=${resolution.width}x${resolution.height}:d=${gap.duration}:r=${targetFps},format=yuv420p[${gapVideoLabel}]`);
      filterComplex.push(`aevalsrc=0:d=${gap.duration}:s=48000:c=stereo[${gapAudioLabel}]`);
      gapCounter++;
    }
    
    // Generate video/audio filters for each clip - SIMPLIFIED
    // Use clipToInputIndex to reference the correct input file
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const inputIndex = clipToInputIndex.get(i) ?? i; // Get the actual input file index
      const isImage = clip.file.type.startsWith('image/');
      const duration = clip.duration - clip.trimStart - clip.trimEnd;

      const meta = inputVideoMeta.get(inputIndex);
      const needsScalePad = !isImage && meta ? (meta.width !== resolution.width || meta.height !== resolution.height) : true;
      
      // OPTIMIZATION: Simplified video filter - only essential operations
      // Use inputIndex to reference the correct input file (handles deduplicated files)
      let videoFilter = '';
      if (isImage) {
        videoFilter = `[${inputIndex}:v]loop=loop=-1:size=1:start=0,trim=duration=${duration},setpts=PTS-STARTPTS,scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2`;

        if (needsFpsNormalization) {
          videoFilter += `,fps=${targetFps}`;
        }

        // Normalize timebase for transitions/xfade stability
        if (needsPerClipTimebaseNormalization) {
          videoFilter += `,settb=1/${targetFps}`;
        }
      } else {
        // OPTIMIZATION: Use trim with correct input index
        // For split clips from the same source, scaling/fps normalization is often redundant.
        // We keep them only when necessary (different input resolution or mixed sources/images).
        videoFilter = `[${inputIndex}:v]trim=start=${clip.trimStart}:duration=${duration},setpts=PTS-STARTPTS`;

        if (needsScalePad) {
          videoFilter += `,scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2`;
        }

        if (needsFpsNormalization) {
          videoFilter += `,fps=${targetFps}`;
        }

        // Normalize timebase for transitions/xfade stability
        if (needsPerClipTimebaseNormalization) {
          videoFilter += `,settb=1/${targetFps}`;
        }
      }
      
      if (clip.filter) {
        const filterString = getFilterString(clip.filter);
        if (filterString) {
          videoFilter += ',' + filterString;
        }
      }
      
      filterComplex.push(`${videoFilter}[v${i}]`);
      
      // Audio filter - simplified, use inputIndex for correct input reference
      if (isImage) {
        filterComplex.push(`aevalsrc=0:d=${duration}:s=48000:c=stereo[a${i}]`);
      } else {
        if (clip.audioMuted) {
          // Video clip audio explicitly muted (e.g. detached audio deleted) => silence
          filterComplex.push(`aevalsrc=0:d=${duration}:s=48000:c=stereo[a${i}]`);
        } else {
          filterComplex.push(`[${inputIndex}:a]atrim=start=${clip.trimStart}:duration=${duration},asetpts=PTS-STARTPTS[a${i}]`);
        }
      }
    }
    
    // Calculate clip durations for transition offsets
    const clipDurations: number[] = clips.map(clip => clip.duration - clip.trimStart - clip.trimEnd);
    
    // Build transition maps
    const clipIdToSortedIndex = new Map<string, number>();
    clips.forEach((clip, index) => {
      if (clip.id) clipIdToSortedIndex.set(clip.id, index);
    });
    
    const startTransitionByIndex = new Map<number, Transition>();
    const endTransitionByIndex = new Map<number, Transition>();
    
    if (transitions && transitions.length > 0) {
      for (const transition of transitions) {
        const sortedIndex = clipIdToSortedIndex.get(transition.clipId);
        if (transition.type !== 'none' && sortedIndex !== undefined) {
          if (transition.position === 'start') {
            startTransitionByIndex.set(sortedIndex, transition);
          } else if (transition.position === 'end') {
            endTransitionByIndex.set(sortedIndex, transition);
          }
        }
      }
    }
    
    // OPTIMIZATION: Determine if we have any transitions at all
    const hasAnyTransitions = startTransitionByIndex.size > 0 || endTransitionByIndex.size > 0;
    const hasGaps = gaps.length > 0;
    
    let currentVideoLabel = '';
    
    // FAST PATH: No transitions (with or without gaps) - single concat in filter_complex.
    // In ffmpeg.wasm, pre-processing to intermediate files can hang and is often slower than
    // doing one final encode. This keeps the graph simple and avoids multi-encode pipelines.
    if (!hasAnyTransitions && clips.length > 1) {
      console.log('🚀 FAST PATH: Simple concat (no transitions)');
      console.log(`📊 Clips: ${clips.length}, Gaps: ${gaps.length}`);

      const orderedVideoLabels: string[] = [];
      const orderedAudioLabels: string[] = [];
      let gapIdx = 0;

      for (let i = 0; i < clips.length; i++) {
        if (gapMap.has(i)) {
          orderedVideoLabels.push(`[vgap${gapIdx}]`);
          orderedAudioLabels.push(`[agap${gapIdx}]`);
          gapIdx++;
        }
        orderedVideoLabels.push(`[v${i}]`);
        orderedAudioLabels.push(`[a${i}]`);
      }

      filterComplex.push(`${orderedVideoLabels.join('')}concat=n=${orderedVideoLabels.length}:v=1:a=0[outv]`);
      filterComplex.push(`${orderedAudioLabels.join('')}concat=n=${orderedAudioLabels.length}:v=0:a=1[outa]`);
      currentVideoLabel = 'outv';
    }
    
    // STANDARD PATH with filter_complex: Only used when transitions are needed
    if (hasAnyTransitions) {
      // STANDARD PATH: Handle gaps and/or transitions
      console.log('📦 STANDARD PATH: Processing with gaps/transitions');
      
      // Build adjacency info
      const isAdjacentToNext: boolean[] = [];
      for (let i = 0; i < clips.length - 1; i++) {
        isAdjacentToNext.push(!gapMap.has(i + 1));
      }
      isAdjacentToNext.push(false);
      
      // Collect all segments in order (gaps + clips)
      const allVideoSegments: string[] = [];
      const allAudioSegments: string[] = [];
      
      let gapIdx = 0;
      for (let i = 0; i < clips.length; i++) {
        // Add gap before this clip if exists
        if (gapMap.has(i)) {
          allVideoSegments.push(`vgap${gapIdx}`);
          allAudioSegments.push(`agap${gapIdx}`);
          gapIdx++;
        }
        allVideoSegments.push(`v${i}`);
        allAudioSegments.push(`a${i}`);
      }
      
      // OPTIMIZATION: Check if we need xfade at all
      let needsXfade = false;
      for (let i = 0; i < clips.length - 1; i++) {
        if (isAdjacentToNext[i]) {
          const transition = startTransitionByIndex.get(i + 1) || endTransitionByIndex.get(i);
          if (transition && transition.type !== 'none') {
            needsXfade = true;
            break;
          }
        }
      }
      
      if (!needsXfade) {
        // No xfade needed - simple concat of all segments
        console.log('🚀 No xfade needed - simple concat');
        const allVideoLabelsStr = allVideoSegments.map(s => `[${s}]`).join('');
        const allAudioLabelsStr = allAudioSegments.map(s => `[${s}]`).join('');
        filterComplex.push(`${allVideoLabelsStr}concat=n=${allVideoSegments.length}:v=1:a=0[outv]`);
        filterComplex.push(`${allAudioLabelsStr}concat=n=${allAudioSegments.length}:v=0:a=1[outa]`);
        currentVideoLabel = 'outv';
      } else {
        // Need xfade - process with transitions
        console.log('🔀 Processing with xfade transitions');
        
        // Process video segments with xfade where needed
        let mergeCounter = 0;
        const processedVideoSegments: string[] = [];
        const processedAudioSegments: string[] = [];
        const processedClips = new Set<number>();
        
        // Add initial gap if exists
        if (gapMap.has(0)) {
          processedVideoSegments.push('vgap0');
          processedAudioSegments.push('agap0');
        }
        
        for (let i = 0; i < clips.length; i++) {
          if (processedClips.has(i)) continue;
          
          let currentGroupLabel = `v${i}`;
          let groupEndIndex = i;
          let groupCumulativeOffset = clipDurations[i];
          const clipIndicesInGroup: number[] = [i];
          
          // Look ahead for adjacent clips with transitions
          while (groupEndIndex < clips.length - 1 && isAdjacentToNext[groupEndIndex]) {
            const nextIndex = groupEndIndex + 1;
            const transition = startTransitionByIndex.get(nextIndex) || endTransitionByIndex.get(groupEndIndex);
            
            if (transition && transition.type !== 'none') {
              // Apply xfade
              const transitionDuration = Math.min(
                transition.duration,
                clipDurations[groupEndIndex] * 0.9,
                clipDurations[nextIndex] * 0.9
              );
              const offset = Math.max(0, groupCumulativeOffset - transitionDuration);
              const outputLabel = `vm${mergeCounter}`;

              // PERFORMANCE NOTE: custom per-pixel blend masks are extremely slow in ffmpeg.wasm.
              // Always use xfade for stability/speed (diamond-wipe maps to rectcrop; circle-wipe maps to circleopen).
              const xfadeFilter = getTransitionFilter(transition, offset);
              
              if (xfadeFilter) {
                // OPTIMIZATION: Add settb only for xfade compatibility
                filterComplex.push(`[${currentGroupLabel}][v${nextIndex}]${xfadeFilter},settb=1/${targetFps}[${outputLabel}]`);
                currentGroupLabel = outputLabel;
                mergeCounter++;
                groupCumulativeOffset = offset + clipDurations[nextIndex];
              }
              
              processedClips.add(nextIndex);
              clipIndicesInGroup.push(nextIndex);
              groupEndIndex = nextIndex;
            } else {
              // No transition - concat
              const outputLabel = `vm${mergeCounter}`;
              // IMPORTANT: concat outputs a different timebase (often 1/1000000). Normalize it so a later xfade won't fail.
              filterComplex.push(`[${currentGroupLabel}][v${nextIndex}]concat=n=2:v=1:a=0,settb=1/${targetFps}[${outputLabel}]`);
              currentGroupLabel = outputLabel;
              mergeCounter++;
              groupCumulativeOffset += clipDurations[nextIndex];
              
              processedClips.add(nextIndex);
              clipIndicesInGroup.push(nextIndex);
              groupEndIndex = nextIndex;
            }
          }
          
          processedVideoSegments.push(currentGroupLabel);
          
          // Handle audio for this group
          if (clipIndicesInGroup.length > 1) {
            const audioLabels = clipIndicesInGroup.map(ci => `[a${ci}]`).join('');
            const mergedAudioLabel = `am${mergeCounter}`;
            filterComplex.push(`${audioLabels}concat=n=${clipIndicesInGroup.length}:v=0:a=1[${mergedAudioLabel}]`);
            processedAudioSegments.push(mergedAudioLabel);
          } else {
            processedAudioSegments.push(`a${i}`);
          }
          
          // Add gap after this group if needed
          let nextUnprocessedIndex = groupEndIndex + 1;
          while (nextUnprocessedIndex < clips.length && processedClips.has(nextUnprocessedIndex)) {
            nextUnprocessedIndex++;
          }
          
          if (nextUnprocessedIndex < clips.length && gapMap.has(nextUnprocessedIndex)) {
            let actualGapIndex = 0;
            for (const gap of gaps) {
              if (gap.beforeClipIndex === nextUnprocessedIndex) {
                processedVideoSegments.push(`vgap${actualGapIndex}`);
                processedAudioSegments.push(`agap${actualGapIndex}`);
                break;
              }
              actualGapIndex++;
            }
          }
        }
        
        // Final concat of all processed segments
        if (processedVideoSegments.length === 1) {
          filterComplex.push(`[${processedVideoSegments[0]}]null[outv]`);
        } else {
          const allLabels = processedVideoSegments.map(s => `[${s}]`).join('');
          // Keep a stable timebase on the final merged stream
          filterComplex.push(`${allLabels}concat=n=${processedVideoSegments.length}:v=1:a=0,settb=1/${targetFps}[outv]`);
        }
        
        if (processedAudioSegments.length === 1) {
          filterComplex.push(`[${processedAudioSegments[0]}]anull[outa]`);
        } else {
          const allAudioLabels = processedAudioSegments.map(s => `[${s}]`).join('');
          filterComplex.push(`${allAudioLabels}concat=n=${processedAudioSegments.length}:v=0:a=1[outa]`);
        }
        
        currentVideoLabel = 'outv';
      }
    }
    
    console.log('Transition processing complete. finalLabel:', currentVideoLabel);
      
    onProgress?.(5, 'Assemblage des clips...');
    
    // Add text overlays to the final merged video
    if (textOverlays && textOverlays.length > 0 && textOverlays.some(t => t.text.trim())) {
      console.log('🔤 DEBUG - Processing text overlays for multi-clip export');
      console.log('🔤 DEBUG - isFontLoaded:', isFontLoaded);
      
      // Apply text filters to the merged video
      let textInputLabel = currentVideoLabel;
      let textOutputLabel = 'vtext0';
      
      const validTexts = textOverlays.filter(t => t.text.trim());
      console.log('🔤 DEBUG - Valid texts count:', validTexts.length);
      
      for (let i = 0; i < validTexts.length; i++) {
        const text = validTexts[i];
        const textFilter = getTextFilterString(text, resolution.width, resolution.height);
        const isLast = i === validTexts.length - 1;
        textOutputLabel = isLast ? 'finalv' : `vtext${i}`;
        
        console.log(`🔤 DEBUG - Text ${i + 1}/${validTexts.length}:`, {
          text: text.text,
          startTime: text.startTime,
          duration: text.duration,
          filter: textFilter
        });
        
        filterComplex.push(`[${textInputLabel}]${textFilter}[${textOutputLabel}]`);
        textInputLabel = textOutputLabel;
      }
      
      // Update the video label to the final text output
      currentVideoLabel = 'finalv';
      console.log('🔤 DEBUG - Text filters added to filter complex');
    }

    const outputFileName = `output.${outputFormat}`;
    
    // Determine the final video label (outv or finalv if text overlays were added)
    const finalVideoLabel = currentVideoLabel;

    // Determine final audio label: use external audio-track clips if provided.
    const finalAudioLabel = externalAudioClips.length > 0 ? 'outa_ext' : 'outa';

    if (externalAudioClips.length > 0) {
      // Compute exported video duration (includes gaps, but ignores initial gap by design)
      const outputTimelineDuration = Math.max(
        0,
        ...clips.map((c) => {
          const d = c.duration - c.trimStart - c.trimEnd;
          return Math.max(0, c.startTime - timeOrigin) + Math.max(0, d);
        })
      );

      console.log('🔊 Export audio override: using audio-track clips', {
        count: externalAudioClips.length,
        outputTimelineDuration,
      });

      const sortedAudio = [...externalAudioClips].sort((a, b) => a.startTime - b.startTime);
      const parts: string[] = [];
      let cursor = 0;
      let seg = 0;

      for (const ac of sortedAudio) {
        const inputIndex = externalAudioFileToInputIndex.get(ac.file);
        if (inputIndex == null) {
          console.warn('External audio clip has no input index, skipping', ac.file.name);
          continue;
        }

        const dur = Math.max(0, ac.duration - ac.trimStart - ac.trimEnd);
        if (dur <= 0.001) continue;

        // Align to export origin (video ignores initial gap)
        const requestedStart = Math.max(0, ac.startTime - timeOrigin);

        // concat cannot represent overlaps; enforce monotonic cursor
        const start = Math.max(requestedStart, cursor);
        const gap = start - cursor;
        if (gap > 0.01) {
          const gl = `agape${seg++}`;
          filterComplex.push(`aevalsrc=0:d=${gap}:s=48000:c=stereo[${gl}]`);
          parts.push(`[${gl}]`);
          cursor += gap;
        }

        const al = `aext${seg++}`;
        filterComplex.push(`[${inputIndex}:a]atrim=start=${ac.trimStart}:duration=${dur},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[${al}]`);
        parts.push(`[${al}]`);
        cursor += dur;
      }

      // Trailing silence to avoid -shortest truncating the video when external audio ends early.
      const tail = outputTimelineDuration - cursor;
      if (tail > 0.01) {
        const tl = `atail${seg++}`;
        filterComplex.push(`aevalsrc=0:d=${tail}:s=48000:c=stereo[${tl}]`);
        parts.push(`[${tl}]`);
      }

      if (parts.length === 0) {
        filterComplex.push(`aevalsrc=0:d=${outputTimelineDuration}:s=48000:c=stereo[${finalAudioLabel}]`);
      } else {
        filterComplex.push(`${parts.join('')}concat=n=${parts.length}:v=0:a=1[${finalAudioLabel}]`);
      }
    }
    
    // Build base args for multi-clip export with hardware-optimized settings
    let args = [
      ...inputFiles.flatMap(f => ['-i', f]),
      // Emit periodic progress key/value logs (parsed in loadFFmpeg log handler)
      '-progress', 'pipe:1',
      '-nostats',
      '-filter_complex', filterComplex.join(';'),
      '-map', `[${finalVideoLabel}]`,
      '-map', `[${finalAudioLabel}]`,
      '-c:v', encodingSettings.videoCodec,
      '-crf', quality,
      '-c:a', outputFormat === 'webm' ? 'libopus' : 'aac',
      '-preset', encodingSettings.preset,
      // Force a reasonable frame rate to avoid "Frame rate very high" errors and massive processing load
      '-r', String(Math.min(parseInt(settings.fps || '30'), encodingSettings.targetFps)),
      // Explicitly set pixel format to avoid compatibility issues
      '-pix_fmt', encodingSettings.pixelFormat,
      // Thread optimization based on hardware
      '-threads', encodingSettings.threads,
      // Add shortest to prevent infinite loops if something goes wrong with duration
      '-shortest',
      // Optimize for web playback
      // '-movflags', '+faststart', // Removed to prevent blocking
      outputFileName
    ];
    
    // Apply hardware-optimized additional flags
    args = buildOptimizedArgs(args, encodingSettings);

    console.log('FFmpeg command:', args.join(' '));
    onProgress?.(10, 'Encodage...');
    await execWithTimeout(ffmpegInstance, args, execTimeoutMs);

    onProgress?.(96, 'Finalisation...');
    const data = await ffmpegInstance.readFile(outputFileName);
    
    onProgress?.(98, 'Nettoyage...');
    // Clean up
    for (const fileName of inputFiles) {
      await ffmpegInstance.deleteFile(fileName);
    }
    await ffmpegInstance.deleteFile(outputFileName);
    
    onProgress?.(99, 'Préparation du téléchargement...');

    // Log actual encoding time for multi-clip export
    const actualEncodingTime = (performance.now() - encodingStartTime) / 1000;
    console.log('✅ EXPORT COMPLETE (Multi-Clip)');
    console.log(`⏱️ Actual encoding time: ${formatEncodingTime(Math.ceil(actualEncodingTime))}`);
    console.log(`📈 Speed ratio: ${(currentTotalDuration / actualEncodingTime).toFixed(2)}x realtime`);
    console.log(`📊 Clips processed: ${clips.length}`);

    onProgress?.(100, 'Terminé !');
    return new Blob([data as any], { type: outputFormat === 'webm' ? 'video/webm' : 'video/mp4' });
  } catch (error) {
    console.error('Error in exportProject:', error);
    // If FFmpeg was terminated/aborted or got stuck, the instance is usually unusable.
    // Reset so the next attempt can reload cleanly (and potentially fall back to single-thread safe mode).
    if (
      error instanceof Error &&
      (
        error.message.includes('Timeout') ||
        error.message.includes('stuck') ||
        error.message.includes('FFmpeg.terminate') ||
        error.message.includes('FS error')
      )
    ) {
      console.warn('FFmpeg error detected, resetting instance...');
      await resetFFmpeg();
    }
    throw error;
  } finally {
    // Always release the operation lock
    isOperationInProgress = false;
    currentOperationType = null;
  }
}

function getFileExtension(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? `.${ext}` : '.mp4';
}

export async function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(video.duration);
    };
    
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Impossible de lire les métadonnées de la vidéo'));
    };
    
    video.src = URL.createObjectURL(file);
  });
}

export async function getVideoMetadata(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true; // Important pour permettre autoplay
    
    let hasResolved = false;
    
    const cleanup = () => {
      if (video.src) {
        URL.revokeObjectURL(video.src);
      }
    };
    
    const handleSuccess = () => {
      if (hasResolved) return;
      hasResolved = true;
      
      const metadata = {
        duration: video.duration || 0,
        width: video.videoWidth || 1280,
        height: video.videoHeight || 720,
      };
      cleanup();
      resolve(metadata);
    };
    
    const handleError = (error: any) => {
      if (hasResolved) return;
      hasResolved = true;
      
      console.warn('Could not read video metadata, using defaults:', error);
      cleanup();
      // Return default values instead of rejecting
      resolve({
        duration: 5, // Default 5 seconds
        width: 1280,
        height: 720,
      });
    };
    
    video.onloadedmetadata = handleSuccess;
    video.onerror = handleError;
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (!hasResolved) {
        handleError(new Error('Timeout loading video metadata'));
      }
    }, 10000);
    
    try {
      video.src = URL.createObjectURL(file);
      // Try to load the video
      video.load();
    } catch (error) {
      handleError(error);
    }
  });
}

export async function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    
    let hasResolved = false;
    
    const cleanup = () => {
      if (audio.src) {
        URL.revokeObjectURL(audio.src);
      }
    };
    
    const handleSuccess = () => {
      if (hasResolved) return;
      hasResolved = true;
      
      cleanup();
      resolve(audio.duration || 0);
    };
    
    const handleError = () => {
      if (hasResolved) return;
      hasResolved = true;
      
      console.warn('Could not read audio metadata, using default duration');
      cleanup();
      resolve(5); // Default 5 seconds
    };
    
    audio.onloadedmetadata = handleSuccess;
    audio.onerror = handleError;
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (!hasResolved) {
        handleError();
      }
    }, 10000);
    
    try {
      audio.src = URL.createObjectURL(file);
      audio.load();
    } catch (error) {
      handleError();
    }
  });
}

/**
 * Wrapper for exportProject with automatic retry logic for timeout/stuck errors
 */
export async function exportProject(
  clips: { file: File; startTime: number; duration: number; trimStart: number; trimEnd: number; filter?: VideoFilter; id?: string; audioMuted?: boolean }[],
  settings: ExportSettings,
  onProgress?: (progress: number, message: string) => void,
  textOverlays?: TextOverlay[],
  transitions?: Transition[],
  aspectRatio?: AspectRatio,
  hardwareProfile?: AnyHardwareProfile,
  audioClips?: { file: File; startTime: number; duration: number; trimStart: number; trimEnd: number; id?: string }[]
): Promise<Blob> {
  const MAX_RETRIES = 1;
  let attempt = 0;

  while (true) {
    try {
      const safeMode = attempt > 0;
      return await _exportProjectInternal(clips, settings, onProgress, textOverlays, transitions, aspectRatio, hardwareProfile, safeMode, audioClips);
    } catch (error) {
      console.error(`Export attempt ${attempt + 1} failed:`, error);
      
      const isRecoverable =
        error instanceof Error &&
        (
          error.message.includes('Timeout') ||
          error.message.includes('stuck') ||
          error.message.includes('FFmpeg.terminate') ||
          error.message.includes('FS error')
        );
      
      if (attempt < MAX_RETRIES && isRecoverable) {
        console.warn('FFmpeg seems stuck, resetting instance and retrying in SAFE MODE...');
        onProgress?.(0, 'Redémarrage du moteur d\'export en mode sans échec (tentative 2/2)...');
        
        // Force reset
        await resetFFmpeg();
        
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        attempt++;
        continue;
      }
      
      // If we're here, we either ran out of retries or it's a non-recoverable error
      throw error;
    }
  }
}
