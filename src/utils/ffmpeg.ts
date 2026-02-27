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

function applyGpuTierSettings(settings: EncodingSettings, gpuTier: string, quality: string) {
  // Helper to get CRF value based on quality
  const getCrf = (high: string, mid: string, low: string) => {
    if (quality === 'high') return high;
    if (quality === 'medium') return mid;
    return low;
  };

  // Helper to get preset value based on quality
  const getPreset = (high: string, low: string) => quality === 'high' ? high : low;

  // Reset additional flags for this tier
  settings.additionalFlags = settings.additionalFlags.filter(f => f !== '-tune' && f !== '-g' && f !== '-max_muxing_queue_size');

  switch (gpuTier) {
    case 'high':
      settings.preset = 'ultrafast';
      settings.crf = getCrf('23', '26', '30');
      settings.maxWidth = 3840;
      settings.maxHeight = 2160;
      settings.targetFps = 60;
      settings.additionalFlags.push('-tune', 'zerolatency', '-g', '60', '-max_muxing_queue_size', '1024');
      break;
    case 'medium':
      settings.preset = getPreset('fast', 'veryfast');
      settings.crf = getCrf('20', '24', '28');
      settings.maxWidth = 1920;
      settings.maxHeight = 1080;
      settings.targetFps = 30;
      settings.additionalFlags.push('-tune', 'fastdecode');
      break;
    case 'low':
      settings.preset = 'ultrafast';
      settings.crf = getCrf('22', '28', '32');
      settings.maxWidth = 1280;
      settings.maxHeight = 720;
      settings.targetFps = 30;
      settings.additionalFlags.push('-tune', 'fastdecode');
      break;
    default:
      settings.preset = 'fast';
      settings.additionalFlags.push('-tune', 'fastdecode');
      break;
  }
}

function applyGpuVendorSettings(settings: EncodingSettings, gpuVendor: string) {
  switch (gpuVendor) {
    case 'nvidia':
    case 'amd':
    case 'intel':
      settings.additionalFlags.push('-bf', '0');
      break;
    case 'apple':
      settings.pixelFormat = 'yuv420p';
      break;
    case 'arm':
    case 'qualcomm':
      settings.preset = 'ultrafast';
      settings.additionalFlags.push('-tune', 'fastdecode');
      break;
  }
}

function extractProfileInfo(hardwareProfile: AnyHardwareProfile) {
  let gpuTier = 'unknown';
  let processorCores = 4;
  let memoryTier = 'unknown';
  let isAppleSilicon = false;
  let gpuVendor = 'unknown';

  if ('gpu' in hardwareProfile && hardwareProfile.gpu && 'processor' in hardwareProfile && hardwareProfile.processor) {
    gpuTier = hardwareProfile.gpu.tier;
    processorCores = hardwareProfile.processor.cores;
    memoryTier = hardwareProfile.memory.tier;
    isAppleSilicon = hardwareProfile.processor.isAppleSilicon;
    gpuVendor = hardwareProfile.gpu.vendor;
  } else if ('cpuCores' in hardwareProfile) {
    processorCores = hardwareProfile.cpuCores;
    isAppleSilicon = hardwareProfile.isAppleSilicon;
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
  }
  return { gpuTier, processorCores, memoryTier, isAppleSilicon, gpuVendor };
}

function applyHardwareSpecificSettings(
  settings: EncodingSettings,
  hardwareProfile: AnyHardwareProfile,
  quality: string,
  format: string
) {
  const { gpuTier, processorCores, memoryTier, isAppleSilicon, gpuVendor } = extractProfileInfo(hardwareProfile);
  
  applyGpuTierSettings(settings, gpuTier, quality);
  
  if (processorCores >= 16 || processorCores >= 8) {
    settings.threads = '4';
  } else {
    settings.threads = String(Math.max(2, processorCores));
  }
  
  if (isAppleSilicon) {
    settings.preset = quality === 'high' ? 'medium' : 'fast';
    settings.threads = '0';
  }
  
  if (memoryTier === 'low') {
    settings.maxWidth = Math.min(settings.maxWidth, 1280);
    settings.maxHeight = Math.min(settings.maxHeight, 720);
    settings.preset = 'ultrafast';
    settings.additionalFlags.push('-max_muxing_queue_size', '1024');
  }
  
  applyGpuVendorSettings(settings, gpuVendor);
  
  if (format === 'webm') {
    settings.videoCodec = 'libvpx-vp9';
    // Use slower cpu-used for better stability in WASM (avoid memory issues)
    const cpuUsed = gpuTier === 'high' ? '3' : gpuTier === 'medium' ? '5' : '6';
    settings.additionalFlags.push('-cpu-used', cpuUsed);
    // Remove row-mt for WASM stability (causes memory access issues)
    // settings.additionalFlags.push('-row-mt', '1');
    // Remove deadline realtime - causes memory access violations in WASM
    // settings.additionalFlags.push('-deadline', 'realtime');
  }
  
  return { gpuTier, processorCores };
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
  const availableCores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  
  const defaultSettings: EncodingSettings = {
    videoCodec: format === 'webm' ? 'libvpx-vp9' : 'libx264',
    preset: safeMode ? 'ultrafast' : 'fast',
    crf: quality === 'high' ? '20' : quality === 'medium' ? '25' : '30',
    pixelFormat: 'yuv420p',
    threads: safeMode ? String(Math.min(4, availableCores)) : String(Math.min(8, availableCores)),
    additionalFlags: [],
    maxWidth: 1920,
    maxHeight: 1080,
    targetFps: 30,
  };

  if (safeMode) {
    console.log('🛡️ FFmpeg: SAFE MODE ACTIVE - Using balanced settings for stability');
    defaultSettings.additionalFlags.push('-tune', 'fastdecode');
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
  
  const { gpuTier, processorCores } = applyHardwareSpecificSettings(settings, hardwareProfile, quality, format);
  
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

function getGpuTierAndWebGPU(hardwareProfile: AnyHardwareProfile) {
  let gpuTier = 'unknown';
  let supportsWebGPU = false;
  
  if ('gpu' in hardwareProfile && hardwareProfile.gpu) {
    gpuTier = hardwareProfile.gpu.tier;
    supportsWebGPU = hardwareProfile.gpu.supportsWebGPU || false;
  } else if ('cpuCores' in hardwareProfile) {
    const score = hardwareProfile.performanceScore || 50;
    gpuTier = score > 70 ? 'high' : score > 40 ? 'medium' : 'low';
  }
  
  return { gpuTier, supportsWebGPU };
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
    return 'h264';
  }
  
  const { gpuTier, supportsWebGPU } = getGpuTierAndWebGPU(hardwareProfile);
  
  switch (useCase) {
    case 'streaming':
      return 'h264';
      
    case 'archive':
      if (gpuTier === 'high' && supportsWebGPU) {
        return 'av1';
      }
      return gpuTier === 'high' ? 'h265' : 'h264';
      
    case 'social':
      return 'h264';
      
    case 'general':
    default:
      if (gpuTier === 'high') {
        return 'h265';
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

function replaceOrAddArg(args: string[], flag: string, value: string) {
  const index = args.indexOf(flag);
  if (index !== -1) {
    args[index + 1] = value;
  } else {
    args.push(flag, value);
  }
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
  
  replaceOrAddArg(args, '-c:v', settings.videoCodec);
  
  const presetIndex = args.indexOf('-preset');
  if (presetIndex !== -1) {
    args[presetIndex + 1] = settings.preset;
  } else if (!settings.videoCodec.includes('vpx')) {
    args.push('-preset', settings.preset);
  }
  
  replaceOrAddArg(args, '-crf', settings.crf);
  replaceOrAddArg(args, '-threads', settings.threads);
  replaceOrAddArg(args, '-pix_fmt', settings.pixelFormat);
  
  const fpsIndex = args.indexOf('-r');
  if (fpsIndex !== -1) {
    const requested = Number.parseInt(args[fpsIndex + 1] || '0', 10);
    const effective = requested > 0 ? Math.min(requested, settings.targetFps) : settings.targetFps;
    args[fpsIndex + 1] = String(effective);
  }
  
  for (let i = 0; i < settings.additionalFlags.length; i += 2) {
    const flag = settings.additionalFlags[i];
    const value = settings.additionalFlags[i + 1];
    
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

function getMultiplierFromGpuTier(gpuTier: string) {
  switch (gpuTier) {
    case 'high': return 0.3;
    case 'medium': return 0.5;
    case 'low': return 1.5;
    default: return 1.0;
  }
}

function adjustMultiplierForCores(multiplier: number, cores: number) {
  if (cores >= 16) return multiplier * 0.5;
  if (cores >= 8) return multiplier * 0.6;
  if (cores >= 4) return multiplier * 0.8;
  return multiplier * 1.2;
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
  let multiplier = 0.8;
  
  if (!hardwareProfile) {
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
      const score = hardwareProfile.performanceScore || 50;
      gpuTier = score > 70 ? 'high' : score > 40 ? 'medium' : 'low';
    }
    
    multiplier = getMultiplierFromGpuTier(gpuTier);
    multiplier = adjustMultiplierForCores(multiplier, cores);
    
    if (isAppleSilicon) {
      multiplier *= 0.5;
    }
  }
  
  const pixels = resolution.width * resolution.height;
  const basePixels = 1920 * 1080;
  const resolutionFactor = pixels / basePixels;
  
  const estimatedTime = videoDuration * multiplier * Math.sqrt(resolutionFactor);
  
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
    const tFromProgress = prog ? Number.parseInt(prog[1], 10) / 1_000_000 : null;

    let tFromStats: number | null = null;
    const timeIndex = message.indexOf('time=');
    if (timeIndex !== -1) {
      const timeStr = message.substring(timeIndex + 5).split(' ')[0]; // Get the time part
      const parts = timeStr.split(':');
      if (parts.length >= 3) {
        const h = Number.parseInt(parts[0], 10);
        const m = Number.parseInt(parts[1], 10);
        const s = Number.parseFloat(parts[2]);
        if (!isNaN(h) && !isNaN(m) && !isNaN(s)) {
          tFromStats = h * 3600 + m * 60 + s;
        }
      }
    }

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
      .then((code) => {
        clearTimeout(timer);
        clearInterval(progressTick);
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
        if (code !== 0) {
          console.error(`❌ FFmpeg exec failed with code ${code} after ${elapsed}s`);
          reject(new Error(`FFmpeg exited with code ${code}`));
        } else {
          console.log(`✅ FFmpeg exec completed in ${elapsed}s`);
          resolve();
        }
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

  // Build a single eq= filter with all parameters to avoid multiple eq filters
  // which can conflict with each other in FFmpeg filter chains
  const eqParts: string[] = [];

  if (filter.brightness !== 0) {
    // CSS preview uses: brightness(1 + val/100) which is multiplicative
    // FFmpeg eq=brightness is additive on -1..1 luma scale, which is much more aggressive
    // To approximate CSS multiplicative brightness with FFmpeg additive:
    // CSS brightness(1.5) ≈ 50% brighter; FFmpeg brightness=0.5 adds 0.5 to luma (way too much)
    // A good approximation: FFmpeg brightness ≈ (val/100) * 0.25
    // This maps CSS brightness range [-100,100] → FFmpeg [-0.25, 0.25] which visually matches better
    eqParts.push(`brightness=${(filter.brightness / 100) * 0.25}`);
  }

  if (filter.contrast !== 0) {
    // CSS preview uses: contrast(1 + val/100) which is a multiplier
    // FFmpeg eq=contrast is also a multiplier (default 1.0), so this mapping is correct
    eqParts.push(`contrast=${1 + filter.contrast / 100}`);
  }

  if (filter.saturation !== 0) {
    // CSS preview uses: saturate(1 + val/100) which is a multiplier
    // FFmpeg eq=saturation is also a multiplier (default 1.0), so this mapping is correct
    eqParts.push(`saturation=${1 + filter.saturation / 100}`);
  }

  if (eqParts.length > 0) {
    filters.push(`eq=${eqParts.join(':')}`);
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
 * @returns FFmpeg drawtext filter string
 */
export function getTextFilterString(
  textOverlay: TextOverlay,
  videoWidth: number,
  videoHeight: number,
  fontPath: string = FFMPEG_FONT_PATH,
): string {
  const escapedText = escapeTextForFFmpeg(textOverlay.text);
  const fontColor = hexToFFmpegColor(textOverlay.color);
  
  // The fontSize stored in the data model is defined relative to the export resolution.
  // In preview, VideoPlayer scales it DOWN by (previewWidth / exportWidth).
  // In export, we use it directly — no scaling needed.
  // Previously this used a hardcoded referenceWidth=600 which caused text to be
  // (exportWidth / 600) times too large in the export.
  const scaledFontSize = Math.max(1, Math.round(textOverlay.fontSize));
  
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
  // Matches preview: full opacity background with padding equivalent to 4px/8px
  if (textOverlay.backgroundColor) {
    const bgColor = hexToFFmpegColor(textOverlay.backgroundColor);
    parts.push(`box=1`);
    parts.push(`boxcolor=${bgColor}`);
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
    'zoom-out': 'squeezev', // squeezev provides a zoom-out-like shrink effect
    'rotate-in': 'radial',
    'rotate-out': 'radial',
    'circle-wipe': 'circleopen',
    'diamond-wipe': 'diagtl', // diagtl provides a diamond-like diagonal reveal
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
  clipDuration: number,
  resolution?: { width: number; height: number }
): string {
  if (transition.type === 'none') {
    return '';
  }
  
  const duration = Math.max(0.1, Math.min(transition.duration, clipDuration * 0.5)); // Max 50% of clip duration
  const frames = Math.round(duration * 30); // Assuming 30fps for frame-based calculations
  const w = resolution ? resolution.width : 1920;
  const h = resolution ? resolution.height : 1080;
  
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
      
      // Slide transitions: animate position from off-screen to normal
      case 'slide-left':
        // Slide in from the right (starts off-screen right, moves left to normal position)
        return `format=yuva444p,geq=lum='if(lt(T,${duration}),if(gte(X,W*(1-T/${duration})),lum(X-W*(1-T/${duration}),Y),0),lum(X,Y))':cb='if(lt(T,${duration}),if(gte(X,W*(1-T/${duration})),cb(X-W*(1-T/${duration}),Y),128),cb(X,Y))':cr='if(lt(T,${duration}),if(gte(X,W*(1-T/${duration})),cr(X-W*(1-T/${duration}),Y),128),cr(X,Y))':a='if(lt(T,${duration}),if(gte(X,W*(1-T/${duration})),255,0),255)',format=yuv420p`;
      case 'slide-right':
        // Slide in from the left (starts off-screen left, moves right to normal position)
        return `format=yuva444p,geq=lum='if(lt(T,${duration}),if(lt(X,W*T/${duration}),lum(X+W*(1-T/${duration}),Y),0),lum(X,Y))':cb='if(lt(T,${duration}),if(lt(X,W*T/${duration}),cb(X+W*(1-T/${duration}),Y),128),cb(X,Y))':cr='if(lt(T,${duration}),if(lt(X,W*T/${duration}),cr(X+W*(1-T/${duration}),Y),128),cr(X,Y))':a='if(lt(T,${duration}),if(lt(X,W*T/${duration}),255,0),255)',format=yuv420p`;
      case 'slide-up':
        // Slide in from the bottom (starts off-screen bottom, moves up to normal position)
        return `format=yuva444p,geq=lum='if(lt(T,${duration}),if(gte(Y,H*(1-T/${duration})),lum(X,Y-H*(1-T/${duration})),0),lum(X,Y))':cb='if(lt(T,${duration}),if(gte(Y,H*(1-T/${duration})),cb(X,Y-H*(1-T/${duration})),128),cb(X,Y))':cr='if(lt(T,${duration}),if(gte(Y,H*(1-T/${duration})),cr(X,Y-H*(1-T/${duration})),128),cr(X,Y))':a='if(lt(T,${duration}),if(gte(Y,H*(1-T/${duration})),255,0),255)',format=yuv420p`;
      case 'slide-down':
        // Slide in from the top (starts off-screen top, moves down to normal position)
        return `format=yuva444p,geq=lum='if(lt(T,${duration}),if(lt(Y,H*T/${duration}),lum(X,Y+H*(1-T/${duration})),0),lum(X,Y))':cb='if(lt(T,${duration}),if(lt(Y,H*T/${duration}),cb(X,Y+H*(1-T/${duration})),128),cb(X,Y))':cr='if(lt(T,${duration}),if(lt(Y,H*T/${duration}),cr(X,Y+H*(1-T/${duration})),128),cr(X,Y))':a='if(lt(T,${duration}),if(lt(Y,H*T/${duration}),255,0),255)',format=yuv420p`;
      case 'slide-diagonal-tl':
        // Slide in from bottom-right diagonally to top-left position
        // Use fade + zoompan as approximation for diagonal slide
        return `zoompan=z='if(lte(on,${frames}),1.3-0.3*on/${frames},1)':x='if(lte(on,${frames}),iw*0.15*(1-on/${frames}),0)':y='if(lte(on,${frames}),ih*0.15*(1-on/${frames}),0)':d=1:s=${w}x${h},fade=t=in:st=0:d=${duration}`;
      case 'slide-diagonal-tr':
        // Slide in from bottom-left diagonally to top-right position
        return `zoompan=z='if(lte(on,${frames}),1.3-0.3*on/${frames},1)':x='if(lte(on,${frames}),-iw*0.15*(1-on/${frames}),0)':y='if(lte(on,${frames}),ih*0.15*(1-on/${frames}),0)':d=1:s=${w}x${h},fade=t=in:st=0:d=${duration}`;
      
      case 'zoom-in':
        // Zoom in from smaller to normal size
        return `zoompan=z='if(lte(on,${frames}),1.5-0.5*on/${frames},1)':d=1:s=${w}x${h},fade=t=in:st=0:d=${duration}`;
      case 'zoom-out':
        // Start zoomed in, zoom out to normal
        return `zoompan=z='if(lte(on,${frames}),1+0.5*on/${frames},1.5)':d=1:s=${w}x${h},fade=t=in:st=0:d=${duration}`;
      case 'rotate-in':
        // Rotate in effect: start rotated (PI radians = 180°) and rotate to normal (0°)
        // Using ow=iw:oh=ih to keep original dimensions (avoids "height not divisible by 2" errors)
        return `format=yuva444p,rotate=a='if(lt(t,${duration}),PI*(1-t/${duration}),0)':c=black@0:ow=iw:oh=ih,format=yuv420p,fade=t=in:st=0:d=${duration}`;
      case 'rotate-out':
        // For rotate-out at start position, we rotate FROM a rotated state TO normal
        // Using ow=iw:oh=ih to keep original dimensions (avoids "height not divisible by 2" errors)
        return `format=yuva444p,rotate=a='if(lt(t,${duration}),PI*(1-t/${duration}),0)':c=black@0:ow=iw:oh=ih,format=yuv420p,fade=t=in:st=0:d=${duration}`;
      
      // Wipe transitions: use crop to progressively reveal the clip
      case 'wipe-left':
        // Wipe from right to left: progressively reveal from right side
        return `format=yuva444p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(T,${duration}),if(gte(X,W*(1-T/${duration})),255,0),255)',format=yuv420p`;
      case 'wipe-right':
        // Wipe from left to right: progressively reveal from left side
        return `format=yuva444p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(T,${duration}),if(lt(X,W*T/${duration}),255,0),255)',format=yuv420p`;
      case 'wipe-up':
        // Wipe from bottom to top: progressively reveal from bottom
        return `format=yuva444p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(T,${duration}),if(gte(Y,H*(1-T/${duration})),255,0),255)',format=yuv420p`;
      case 'wipe-down':
        // Wipe from top to bottom: progressively reveal from top
        return `format=yuva444p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(T,${duration}),if(lt(Y,H*T/${duration}),255,0),255)',format=yuv420p`;
      case 'circle-wipe':
        // Circle wipe: reveal from center outward in a circle
        // Distance from center normalized, compared against progress
        return `format=yuva444p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(T,${duration}),if(lt(sqrt(pow(X-W/2,2)+pow(Y-H/2,2)),T/${duration}*sqrt(pow(W/2,2)+pow(H/2,2))),255,0),255)',format=yuv420p`;
      case 'diamond-wipe':
        // Diamond wipe: reveal from center outward in a diamond shape
        // Manhattan distance from center, compared against progress
        return `format=yuva444p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(T,${duration}),if(lt(abs(X-W/2)+abs(Y-H/2),T/${duration}*(W/2+H/2)),255,0),255)',format=yuv420p`;
      
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
      
      // Slide transitions: animate position from normal to off-screen
      case 'slide-left':
        // Slide out to the left (moves from normal position to off-screen left)
        return `format=yuva444p,geq=lum='if(gt(T,${fadeStart}),if(lt(X,W*(1-(T-${fadeStart})/${duration})),lum(X+W*(T-${fadeStart})/${duration},Y),0),lum(X,Y))':cb='if(gt(T,${fadeStart}),if(lt(X,W*(1-(T-${fadeStart})/${duration})),cb(X+W*(T-${fadeStart})/${duration},Y),128),cb(X,Y))':cr='if(gt(T,${fadeStart}),if(lt(X,W*(1-(T-${fadeStart})/${duration})),cr(X+W*(T-${fadeStart})/${duration},Y),128),cr(X,Y))':a='if(gt(T,${fadeStart}),if(lt(X,W*(1-(T-${fadeStart})/${duration})),255,0),255)',format=yuv420p`;
      case 'slide-right':
        // Slide out to the right (moves from normal position to off-screen right)
        return `format=yuva444p,geq=lum='if(gt(T,${fadeStart}),if(gte(X,W*(T-${fadeStart})/${duration}),lum(X-W*(T-${fadeStart})/${duration},Y),0),lum(X,Y))':cb='if(gt(T,${fadeStart}),if(gte(X,W*(T-${fadeStart})/${duration}),cb(X-W*(T-${fadeStart})/${duration},Y),128),cb(X,Y))':cr='if(gt(T,${fadeStart}),if(gte(X,W*(T-${fadeStart})/${duration}),cr(X-W*(T-${fadeStart})/${duration},Y),128),cr(X,Y))':a='if(gt(T,${fadeStart}),if(gte(X,W*(T-${fadeStart})/${duration}),255,0),255)',format=yuv420p`;
      case 'slide-up':
        // Slide out upward (moves from normal position to off-screen top)
        return `format=yuva444p,geq=lum='if(gt(T,${fadeStart}),if(lt(Y,H*(1-(T-${fadeStart})/${duration})),lum(X,Y+H*(T-${fadeStart})/${duration}),0),lum(X,Y))':cb='if(gt(T,${fadeStart}),if(lt(Y,H*(1-(T-${fadeStart})/${duration})),cb(X,Y+H*(T-${fadeStart})/${duration}),128),cb(X,Y))':cr='if(gt(T,${fadeStart}),if(lt(Y,H*(1-(T-${fadeStart})/${duration})),cr(X,Y+H*(T-${fadeStart})/${duration}),128),cr(X,Y))':a='if(gt(T,${fadeStart}),if(lt(Y,H*(1-(T-${fadeStart})/${duration})),255,0),255)',format=yuv420p`;
      case 'slide-down':
        // Slide out downward (moves from normal position to off-screen bottom)
        return `format=yuva444p,geq=lum='if(gt(T,${fadeStart}),if(gte(Y,H*(T-${fadeStart})/${duration}),lum(X,Y-H*(T-${fadeStart})/${duration}),0),lum(X,Y))':cb='if(gt(T,${fadeStart}),if(gte(Y,H*(T-${fadeStart})/${duration}),cb(X,Y-H*(T-${fadeStart})/${duration}),128),cb(X,Y))':cr='if(gt(T,${fadeStart}),if(gte(Y,H*(T-${fadeStart})/${duration}),cr(X,Y-H*(T-${fadeStart})/${duration}),128),cr(X,Y))':a='if(gt(T,${fadeStart}),if(gte(Y,H*(T-${fadeStart})/${duration}),255,0),255)',format=yuv420p`;
      case 'slide-diagonal-tl':
        // Slide out diagonally toward top-left
        return `zoompan=z='if(gte(on,${Math.round(fadeStart * 30)}),1+0.3*(on-${Math.round(fadeStart * 30)})/${frames},1)':x='if(gte(on,${Math.round(fadeStart * 30)}),iw*0.15*(on-${Math.round(fadeStart * 30)})/${frames},0)':y='if(gte(on,${Math.round(fadeStart * 30)}),ih*0.15*(on-${Math.round(fadeStart * 30)})/${frames},0)':d=1:s=${w}x${h},fade=t=out:st=${fadeStart}:d=${duration}`;
      case 'slide-diagonal-tr':
        // Slide out diagonally toward top-right
        return `zoompan=z='if(gte(on,${Math.round(fadeStart * 30)}),1+0.3*(on-${Math.round(fadeStart * 30)})/${frames},1)':x='if(gte(on,${Math.round(fadeStart * 30)}),-iw*0.15*(on-${Math.round(fadeStart * 30)})/${frames},0)':y='if(gte(on,${Math.round(fadeStart * 30)}),ih*0.15*(on-${Math.round(fadeStart * 30)})/${frames},0)':d=1:s=${w}x${h},fade=t=out:st=${fadeStart}:d=${duration}`;
      
      case 'zoom-in':
        // Zoom in at the end (zoom into frame then disappear)
        return `zoompan=z='if(gte(on,${Math.round(fadeStart * 30)}),1+0.5*(on-${Math.round(fadeStart * 30)})/${frames},1)':d=1:s=${w}x${h},fade=t=out:st=${fadeStart}:d=${duration}`;
      case 'zoom-out':
        // Zoom out at the end (shrink away)
        return `zoompan=z='if(gte(on,${Math.round(fadeStart * 30)}),1.5-0.5*(on-${Math.round(fadeStart * 30)})/${frames},1.5)':d=1:s=${w}x${h},fade=t=out:st=${fadeStart}:d=${duration}`;
      case 'rotate-in':
        // For rotate-in at end position, rotate from normal to rotated state
        // Using ow=iw:oh=ih to keep original dimensions (avoids "height not divisible by 2" errors)
        return `format=yuva444p,rotate=a='if(gt(t,${fadeStart}),PI*(t-${fadeStart})/${duration},0)':c=black@0:ow=iw:oh=ih,format=yuv420p,fade=t=out:st=${fadeStart}:d=${duration}`;
      case 'rotate-out':
        // Rotate out effect: start normal (0°) and rotate to PI radians (180°)
        // Using ow=iw:oh=ih to keep original dimensions (avoids "height not divisible by 2" errors)
        return `format=yuva444p,rotate=a='if(gt(t,${fadeStart}),PI*(t-${fadeStart})/${duration},0)':c=black@0:ow=iw:oh=ih,format=yuv420p,fade=t=out:st=${fadeStart}:d=${duration}`;
      
      // Wipe transitions: use alpha to progressively hide the clip
      case 'wipe-left':
        // Wipe out to the left: progressively hide from left side
        return `format=yuva444p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(gt(T,${fadeStart}),if(gte(X,W*(T-${fadeStart})/${duration}),255,0),255)',format=yuv420p`;
      case 'wipe-right':
        // Wipe out to the right: progressively hide from right side
        return `format=yuva444p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(gt(T,${fadeStart}),if(lt(X,W*(1-(T-${fadeStart})/${duration})),255,0),255)',format=yuv420p`;
      case 'wipe-up':
        // Wipe out upward: progressively hide from top
        return `format=yuva444p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(gt(T,${fadeStart}),if(gte(Y,H*(T-${fadeStart})/${duration}),255,0),255)',format=yuv420p`;
      case 'wipe-down':
        // Wipe out downward: progressively hide from bottom
        return `format=yuva444p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(gt(T,${fadeStart}),if(lt(Y,H*(1-(T-${fadeStart})/${duration})),255,0),255)',format=yuv420p`;
      case 'circle-wipe':
        // Circle wipe out: shrink circle from full to center
        return `format=yuva444p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(gt(T,${fadeStart}),if(lt(sqrt(pow(X-W/2,2)+pow(Y-H/2,2)),(1-(T-${fadeStart})/${duration})*sqrt(pow(W/2,2)+pow(H/2,2))),255,0),255)',format=yuv420p`;
      case 'diamond-wipe':
        // Diamond wipe out: shrink diamond from full to center
        return `format=yuva444p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(gt(T,${fadeStart}),if(lt(abs(X-W/2)+abs(Y-H/2),(1-(T-${fadeStart})/${duration})*(W/2+H/2)),255,0),255)',format=yuv420p`;
      
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
      if (video.readyState < 2) {
        throw new Error('Video not ready for drawing (readyState=' + video.readyState + ')');
      }
      try {
        ctx.drawImage(video, 0, 0, targetW, targetH);
      } catch (drawErr) {
        throw new Error('drawImage failed for video thumbnail: ' + (drawErr instanceof Error ? drawErr.message : String(drawErr)));
      }

      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      URL.revokeObjectURL(url);
      return dataUrl;
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

    const uint8Array = data as Uint8Array;
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);
    return `data:image/jpeg;base64,${base64}`;
  } finally {
    isOperationInProgress = false;
    currentOperationType = null;
  }
}

function checkComplexFeatures(
  clips: { file: File; filter?: VideoFilter; volume?: number }[],
  textOverlays?: TextOverlay[],
  transitions?: Transition[],
  audioClips?: { file: File; volume?: number }[]
) {
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
  const hasImages = clips.some(c => c.file.type.startsWith('image/'));
  const hasAudioClips = audioClips && audioClips.length > 0;
  const hasNonDefaultVolume = clips.some(c => c.volume !== undefined && c.volume !== 1) ||
    (audioClips && audioClips.some(c => c.volume !== undefined && c.volume !== 1));
  
  return hasTextOverlays || hasTransitions || hasFilters || hasImages || hasAudioClips || hasNonDefaultVolume;
}


type ExportClip = { file: File; startTime: number; duration: number; trimStart: number; trimEnd: number; filter?: VideoFilter; id?: string; audioMuted?: boolean; crop?: any; transform?: any; trackIndex?: number; volume?: number };
type ExportAudioClip = { file: File; startTime: number; duration: number; trimStart: number; trimEnd: number; id?: string; volume?: number };


function buildVideoFilter(
  clip: ExportClip,
  resolution: { width: number; height: number },
  isImage: boolean
): string {
  let filter = '';

  if (clip.crop) {
    // Force even dimensions and coordinates for crop to prevent yuv420p errors
    const w = `trunc(iw*${clip.crop.width}/100/2)*2`;
    const h = `trunc(ih*${clip.crop.height}/100/2)*2`;
    const x = `trunc(iw*${clip.crop.x}/100/2)*2`;
    const y = `trunc(ih*${clip.crop.y}/100/2)*2`;
    filter += `crop=${w}:${h}:${x}:${y}`;
  }

  if (filter) filter += ',';
  filter += `scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2`;

  if (clip.filter) {
    const filterString = getFilterString(clip.filter);
    if (filterString) filter += ',' + filterString;
  }

  return filter;
}

function buildImageTransformFilter(
  clip: ExportClip,
  inputIndex: number,
  duration: number,
  resolution: { width: number; height: number },
  targetFps: number,
  isBaseTrack: boolean,
  outLabel: string,
  fc: string[]
) {
  const scaleX = clip.transform.scaleX ?? clip.transform.scale;
  const scaleY = clip.transform.scaleY ?? clip.transform.scale;
  
  const actualWidthPct = (80 * scaleX) / 100;
  const actualHeightPct = (80 * scaleY) / 100;
  
  // Force even dimensions to prevent scale filter errors with YUV inputs
  const targetW = Math.max(2, Math.round(resolution.width * actualWidthPct / 100) & ~1);
  const targetH = Math.max(2, Math.round(resolution.height * actualHeightPct / 100) & ~1);
  
  const centerX = Math.round(resolution.width * clip.transform.x / 100);
  const centerY = Math.round(resolution.height * clip.transform.y / 100);
  
  let imgFilter = `[${inputIndex}:v]loop=loop=-1:size=1:start=0,trim=duration=${duration},setpts=PTS-STARTPTS`;
  imgFilter += `,scale=${targetW}:${targetH}`;
  imgFilter += `,format=rgba`;
  
  if (clip.transform.rotation !== 0) {
    const angle = clip.transform.rotation * Math.PI / 180;
    imgFilter += `,rotate=${angle}:c=black@0:ow=rotw(${angle}):oh=roth(${angle})`;
  }
  
  if (clip.filter) {
    const filterString = getFilterString(clip.filter);
    if (filterString) imgFilter += ',' + filterString;
  }
  
  const imgLabel = `img_${outLabel}`;
  fc.push(`${imgFilter}[${imgLabel}]`);
  
  const bgLabel = `bg_${outLabel}`;
  const bgColor = isBaseTrack ? 'black' : 'black@0';
  fc.push(`color=c=${bgColor}:s=${resolution.width}x${resolution.height}:d=${duration}:r=${targetFps},format=rgba[${bgLabel}]`);
  
  fc.push(`[${bgLabel}][${imgLabel}]overlay=x=${centerX}-w/2:y=${centerY}-h/2,setsar=1[${outLabel}]`);
}

async function exportSingleClipFastPath(
  ffmpegInstance: any,
  clip: ExportClip,
  clipDuration: number,
  inputFileName: string,
  outputFileName: string,
  resolution: { width: number; height: number },
  effectiveFps: number,
  encodingSettings: any,
  quality: string,
  outputFormat: string,
  execTimeoutMs: number,
  textOverlays?: any[],
  onProgress?: (progress: number, message: string) => void
) {
  const isImage = clip.file.type.startsWith("image/");
  let videoFilterChain = buildVideoFilter(clip, resolution, isImage);

  if (textOverlays && textOverlays.length > 0) {
    for (const text of textOverlays) {
      if (text.text.trim() && text.duration > 0) {
        const textFilter = getTextFilterString(text, resolution.width, resolution.height);
        videoFilterChain += ',' + textFilter;
      }
    }
  }

  // Apply audio volume filter if volume is not default
  const clipVolume = clip.volume ?? 1;
  const audioFilterChain = clipVolume !== 1 ? `volume=${clipVolume}` : '';

  let args = [];
  if (isImage) {
    args.push('-loop', '1');
  }
  
  args.push(
    '-i', inputFileName,
    '-ss', clip.trimStart.toString(),
    '-t', clipDuration.toString(),
    '-vf', videoFilterChain,
    '-c:v', encodingSettings.videoCodec,
    '-crf', quality,
  );

  // Add audio filter for volume if needed
  if (audioFilterChain) {
    args.push('-af', audioFilterChain);
  }

  args.push(
    '-c:a', outputFormat === 'webm' ? 'libopus' : 'aac',
    '-preset', encodingSettings.preset,
    '-r', String(effectiveFps),
    '-pix_fmt', encodingSettings.pixelFormat,
    '-threads', encodingSettings.threads,
    outputFileName
  );

  args = buildOptimizedArgs(args, encodingSettings);

  console.log('FFmpeg command:', args.join(' '));
  await execWithTimeout(ffmpegInstance, args, execTimeoutMs);
  
  onProgress?.(96, 'Finalisation...');
}

function buildSingleClipExternalAudio(
  clip: ExportClip,
  clipDuration: number,
  externalAudioClipsSingle: any[],
  extraAudioFiles: File[],
  timeOriginSingle: number,
  fc: string[],
  outLabel: string
) {
  const sortedAudio = [...externalAudioClipsSingle].sort((a, b) => a.startTime - b.startTime);
  const parts: string[] = [];
  let cursor = 0;
  let seg = 0;

  for (const ac of sortedAudio) {
    let dur = Math.max(0, ac.duration - ac.trimStart - ac.trimEnd);
    if (dur <= 0.001) continue;

    // Calculate where this audio clip should start relative to the exported video
    const relativeStart = ac.startTime - timeOriginSingle;
    
    // If the audio clip ends before the video clip starts, skip it entirely
    if (relativeStart + dur <= 0) continue;
    // If the audio clip starts after the video clip ends, skip it
    if (relativeStart >= clipDuration) continue;
    
    // If the audio clip starts before the video clip, we need to trim the beginning
    let audioTrimStart = ac.trimStart;
    let effectiveStart = Math.max(0, relativeStart);
    if (relativeStart < 0) {
      // Audio starts before the video — skip the non-overlapping portion
      audioTrimStart += Math.abs(relativeStart);
      dur -= Math.abs(relativeStart);
    }
    
    // Clamp duration so audio doesn't extend past the video clip
    dur = Math.min(dur, clipDuration - effectiveStart);
    if (dur <= 0.001) continue;

    const start = Math.max(effectiveStart, cursor);
    const gap = start - cursor;
    if (gap > 0.01) {
      const gl = `agap0_${seg++}`;
      fc.push(`aevalsrc=0:d=${gap}:s=48000:c=stereo[${gl}]`);
      parts.push(`[${gl}]`);
      cursor += gap;
    }

    const inputIndex = ac.file === clip.file ? 0 : 1 + extraAudioFiles.findIndex((f) => f === ac.file);
    const al = `aext0_${seg++}`;
    const acVol = ac.volume ?? 1;
    const acVolFilter = acVol !== 1 ? `,volume=${acVol}` : '';
    fc.push(`[${inputIndex}:a]atrim=start=${audioTrimStart}:duration=${dur},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo${acVolFilter}[${al}]`);
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
    fc.push(`aevalsrc=0:d=${clipDuration}:s=48000:c=stereo[${outLabel}]`);
  } else {
    fc.push(`${parts.join('')}concat=n=${parts.length}:v=0:a=1[${outLabel}]`);
  }
}

function buildSingleClipAudioFilter(
  clip: ExportClip,
  clipDuration: number,
  externalAudioClipsSingle: any[],
  extraAudioFiles: File[],
  timeOriginSingle: number,
  fc: string[],
  isImage: boolean
) {
  let clipAudioLabel = 'aclip';
  if (isImage || clip.audioMuted) {
    fc.push(`aevalsrc=0:d=${clipDuration}:s=48000:c=stereo[${clipAudioLabel}]`);
  } else {
    const clipVolume = clip.volume ?? 1;
    const volumeFilter = clipVolume !== 1 ? `,volume=${clipVolume}` : '';
    fc.push(`[0:a]atrim=start=${clip.trimStart}:duration=${clipDuration},asetpts=PTS-STARTPTS${volumeFilter}[${clipAudioLabel}]`);
  }

  if (externalAudioClipsSingle.length > 0) {
    const extAudioLabel = 'aext_only';
    buildSingleClipExternalAudio(clip, clipDuration, externalAudioClipsSingle, extraAudioFiles, timeOriginSingle, fc, extAudioLabel);
    fc.push(`[${clipAudioLabel}][${extAudioLabel}]amix=inputs=2:duration=longest[a0]`);
  } else {
    fc.push(`[${clipAudioLabel}]anull[a0]`);
  }
}

function buildSingleClipTransitionsFilter(
  clipDuration: number,
  needsBg: boolean,
  startTransition: any,
  endTransition: any,
  fc: string[]
) {
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
  return vLabel;
}

function buildSingleClipTextFilter(
  textOverlays: any[] | undefined,
  vLabel: string,
  resolution: { width: number; height: number },
  fc: string[]
) {
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
    return 'vfinal';
  }
  return vLabel;
}

async function loadExtraAudioFiles(
  ffmpegInstance: any,
  clip: ExportClip,
  externalAudioClipsSingle: any[],
  safeMode: boolean
) {
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
    } catch (e) { /* ignore */ }
    const buf = new Uint8Array(await file.arrayBuffer());
    await writeFileWithTimeout(ffmpegInstance, name, buf, safeMode ? 60000 : 45000);
  }
  
  return { extraAudioFiles, extraAudioInputNames };
}

async function exportSingleClipComplexPath(
  ffmpegInstance: any,
  clip: ExportClip,
  clipDuration: number,
  inputFileName: string,
  outputFileName: string,
  resolution: { width: number; height: number },
  effectiveFps: number,
  encodingSettings: any,
  quality: string,
  outputFormat: string,
  execTimeoutMs: number,
  clipTransitions: any[],
  externalAudioClipsSingle: any[],
  timeOriginSingle: number,
  safeMode: boolean,
  textOverlays?: any[],
  onProgress?: (progress: number, message: string) => void
) {
  const startTransition = clipTransitions.find((t) => t.position === 'start');
  const endTransition = clipTransitions.find((t) => t.position === 'end');
  const needsBg = clipTransitions.length > 0;

  const { extraAudioFiles, extraAudioInputNames } = await loadExtraAudioFiles(
    ffmpegInstance, clip, externalAudioClipsSingle, safeMode
  );

  const bgInputIndex = 1 + extraAudioInputNames.length;
  const fc: string[] = [];

  const isImage = clip.file.type.startsWith("image/");
  
  if (isImage && !clip.crop) {
    const imageClip = {
      ...clip,
      transform: clip.transform || { x: 50, y: 50, scale: 100, rotation: 0 }
    };
    buildImageTransformFilter(imageClip, 0, clipDuration, resolution, effectiveFps, true, 'v0', fc);
  } else {
    const baseFilter = buildVideoFilter(clip, resolution, isImage);
    let vBase = '';
    if (isImage) {
      vBase = `[0:v]loop=loop=-1:size=1:start=0,trim=duration=${clipDuration},setpts=PTS-STARTPTS,${baseFilter},fps=${effectiveFps},setsar=1`;
    } else {
      vBase = `[0:v]trim=start=${clip.trimStart}:duration=${clipDuration},setpts=PTS-STARTPTS,${baseFilter},fps=${effectiveFps},setsar=1`;
    }
    fc.push(`${vBase}[v0]`);
  }

  if (needsBg) {
    fc.push(`[${bgInputIndex}:v]setpts=PTS-STARTPTS[bg]`);
  }

  buildSingleClipAudioFilter(clip, clipDuration, externalAudioClipsSingle, extraAudioFiles, timeOriginSingle, fc, isImage);
  
  let vLabel = buildSingleClipTransitionsFilter(clipDuration, needsBg, startTransition, endTransition, fc);
  vLabel = buildSingleClipTextFilter(textOverlays, vLabel, resolution, fc);

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
    outputFileName
  ];

  args = buildOptimizedArgs(args, encodingSettings);
  console.log('FFmpeg command:', args.join(' '));
  await execWithTimeout(ffmpegInstance, args, execTimeoutMs);
  
  onProgress?.(96, 'Finalisation...');

  for (const n of extraAudioInputNames) {
    try {
      await ffmpegInstance.deleteFile(n);
    } catch (e) { /* ignore */ }
  }
}

async function exportSingleClip(
  ffmpegInstance: any,
  clip: ExportClip,
  settings: any,
  encodingSettings: any,
  resolution: { width: number; height: number },
  outputFormat: string,
  quality: string,
  execTimeoutMs: number,
  encodingStartTime: number,
  onProgress?: (progress: number, message: string) => void,
  textOverlays?: any[],
  transitions?: any[],
  audioClips?: any[],
  safeMode: boolean = false
): Promise<Blob> {
  onProgress?.(5, 'Chargement du fichier...');
  
  let fileToLoad = clip.file;
  if (fileToLoad.type === 'image/svg+xml' || fileToLoad.name.toLowerCase().endsWith('.svg')) {
    try {
      const pngBlob = await convertImageToPng(fileToLoad);
      fileToLoad = new File([pngBlob], fileToLoad.name.replace(/\.svg$/i, '.png'), { type: 'image/png' });
    } catch (e) {
      console.error('Failed to convert SVG to PNG:', e);
      throw new Error(`Impossible de convertir l'image SVG (${fileToLoad.name}). L'image est peut-être corrompue ou contient des éléments externes non supportés. Veuillez utiliser un format PNG ou JPEG.`);
    }
  }

  const inputFileName = 'input' + getFileExtension(fileToLoad.name);
  const outputFileName = `output.${outputFormat}`;

  const fileData = await fetchFile(fileToLoad);
  
  try {
    await ffmpegInstance.deleteFile(inputFileName);
  } catch (e) { /* ignore */ }

  const dataArray = fileData instanceof Uint8Array ? fileData : new Uint8Array(fileData);
  await writeFileWithTimeout(ffmpegInstance, inputFileName, dataArray);

  onProgress?.(5, 'Traitement de la vidéo...');

  const clipDuration = clip.duration - clip.trimStart - clip.trimEnd;
  const requestedFps = Number.parseInt(settings.fps || '30', 10);
  const effectiveFps = Math.min(requestedFps, encodingSettings.targetFps);

  const externalAudioClipsSingle = audioClips || [];
  const timeOriginSingle = clip.startTime;

  const clipId = clip.id;
  const clipTransitions = (transitions || []).filter((t) => t.clipId === clipId && t.type !== 'none');
  const hasClipTransitions = clipTransitions.length > 0;
  const isImage = clip.file.type.startsWith("image/");
  const hasTransform = isImage && !clip.crop;

  const adjustedTextOverlays = (textOverlays || [])
    .map(text => ({
      ...text,
      startTime: text.startTime - clip.startTime
    }))
    .filter(text => text.text.trim() && text.startTime + text.duration > 0 && text.startTime < clipDuration);

  const hasNonDefaultVolume = clip.volume !== undefined && clip.volume !== 1;
  if (!hasClipTransitions && externalAudioClipsSingle.length === 0 && !clip.audioMuted && !hasTransform && !hasNonDefaultVolume) {
    await exportSingleClipFastPath(
      ffmpegInstance, clip, clipDuration, inputFileName, outputFileName,
      resolution, effectiveFps, encodingSettings, quality, outputFormat,
      execTimeoutMs, adjustedTextOverlays, onProgress
    );
  } else {
    await exportSingleClipComplexPath(
      ffmpegInstance, clip, clipDuration, inputFileName, outputFileName,
      resolution, effectiveFps, encodingSettings, quality, outputFormat,
      execTimeoutMs, clipTransitions, externalAudioClipsSingle, timeOriginSingle,
      safeMode, adjustedTextOverlays, onProgress
    );
  }

  onProgress?.(98, 'Finalisation...');
  const data = await ffmpegInstance.readFile(outputFileName);
  
  await ffmpegInstance.deleteFile(inputFileName);
  await ffmpegInstance.deleteFile(outputFileName);

  const actualEncodingTime = (performance.now() - encodingStartTime) / 1000;
  console.log('✅ EXPORT COMPLETE (Single Clip)');
  console.log(`⏱️ Actual encoding time: ${formatEncodingTime(Math.ceil(actualEncodingTime))}`);
  console.log(`📈 Speed ratio: ${(currentTotalDuration / actualEncodingTime).toFixed(2)}x realtime`);

  onProgress?.(100, 'Terminé !');
  return new Blob([data as any], { type: outputFormat === 'webm' ? 'video/webm' : 'video/mp4' });
}

interface GapInfo {
  beforeClipIndex: number;
  duration: number;
}

function detectGaps(clips: ExportClip[]): { gaps: GapInfo[], gapMap: Map<number, number> } {
  const gaps: GapInfo[] = [];
  const gapMap = new Map<number, number>();
  
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const clipStartTime = clip.startTime;
    
    if (i > 0) {
      const prevClip = clips[i - 1];
      const prevEffectiveDuration = prevClip.duration - prevClip.trimStart - prevClip.trimEnd;
      const expectedStartTime = prevClip.startTime + prevEffectiveDuration;
      const gapDuration = clipStartTime - expectedStartTime;
      if (gapDuration > 0.01) {
        gaps.push({ beforeClipIndex: i, duration: gapDuration });
        gapMap.set(i, gapDuration);
      }
    }
  }
  return { gaps, gapMap };
}

function isSvgFile(file: File): boolean {
  return file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
}

async function convertSvgToPngFile(file: File): Promise<File> {
  try {
    const pngBlob = await convertImageToPng(file);
    return new File([pngBlob], file.name.replace(/\.svg$/i, '.png'), { type: 'image/png' });
  } catch (e) {
    console.error('Failed to convert SVG to PNG:', e);
    throw new Error(`Impossible de convertir l'image SVG (${file.name}). L'image est peut-être corrompue ou contient des éléments externes non supportés. Veuillez utiliser un format PNG ou JPEG.`);
  }
}

async function probeVideoMetadata(
  file: File,
  fileIndex: number,
  inputVideoMeta: Map<number, { width: number; height: number }>
) {
  if (!file.type.startsWith('video/')) return;
  try {
    const meta = await getVideoMetadata(file);
    inputVideoMeta.set(fileIndex, { width: meta.width, height: meta.height });
  } catch (e) { /* ignore */ }
}

async function writeInputFile(
  ffmpegInstance: any,
  inputFileName: string,
  file: File,
  safeMode: boolean
) {
  const dataArray = new Uint8Array(await file.arrayBuffer());
  try {
    await ffmpegInstance.deleteFile(inputFileName);
  } catch (e) { /* ignore */ }
  await writeFileWithTimeout(ffmpegInstance, inputFileName, dataArray, safeMode ? 60000 : 45000);
}

async function loadUniqueFiles(
  ffmpegInstance: any,
  clips: ExportClip[],
  safeMode: boolean,
  onProgress?: (progress: number, message: string) => void
) {
  const inputFiles: string[] = [];
  const clipToInputIndex = new Map<number, number>();
  const uniqueFiles: { file: File; originalIndex: number }[] = [];
  
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    let existingIndex = uniqueFiles.findIndex(u => u.file === clip.file);
    if (existingIndex === -1) {
      existingIndex = uniqueFiles.length;
      uniqueFiles.push({ file: clip.file, originalIndex: i });
    }
    clipToInputIndex.set(i, existingIndex);
  }
  
  const inputVideoMeta = new Map<number, { width: number; height: number }>();
  
  for (let i = 0; i < uniqueFiles.length; i++) {
    let { file } = uniqueFiles[i];
    
    if (isSvgFile(file)) {
      file = await convertSvgToPngFile(file);
      uniqueFiles[i].file = file;
    }

    const inputFileName = `input${i}${getFileExtension(file.name)}`;
    inputFiles.push(inputFileName);

    await probeVideoMetadata(file, i, inputVideoMeta);
    
    onProgress?.(5, `Chargement des fichiers... (${i + 1}/${uniqueFiles.length})`);

    await writeInputFile(ffmpegInstance, inputFileName, file, safeMode);
  }
  
  return { inputFiles, clipToInputIndex, uniqueFiles, inputVideoMeta };
}

async function loadExternalAudioFiles(
  ffmpegInstance: any,
  externalAudioClips: ExportAudioClip[],
  uniqueFiles: { file: File; originalIndex: number }[],
  inputFiles: string[],
  safeMode: boolean,
  onProgress?: (progress: number, message: string) => void
) {
  const externalAudioFileToInputIndex = new Map<File, number>();
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

  for (let i = 0; i < extraAudioFiles.length; i++) {
    const file = extraAudioFiles[i];
    const inputIndex = uniqueFiles.length + i;
    externalAudioFileToInputIndex.set(file, inputIndex);

    const inputFileName = `audio_input${i}${getFileExtension(file.name)}`;
    inputFiles.push(inputFileName);

    onProgress?.(5, `Chargement des fichiers audio... (${i + 1}/${extraAudioFiles.length})`);
    try {
      await ffmpegInstance.deleteFile(inputFileName);
    } catch (e) { /* ignore */ }
    const dataArray = new Uint8Array(await file.arrayBuffer());
    await writeFileWithTimeout(ffmpegInstance, inputFileName, dataArray, safeMode ? 60000 : 45000);
  }
  
  return externalAudioFileToInputIndex;
}


function buildGapFilter(
  gapDuration: number,
  gapCounter: number,
  isBaseTrack: boolean,
  resolution: { width: number; height: number },
  targetFps: number,
  filterComplex: string[],
  trackVideoSegments: string[],
  trackAudioSegments: string[]
) {
  const gapVideoLabel = `vgap${gapCounter}`;
  const gapAudioLabel = `agap${gapCounter}`;
  
  const gapColor = isBaseTrack ? 'black' : 'black@0';
  const gapFormat = isBaseTrack ? 'yuv420p' : 'rgba';
  
  filterComplex.push(`color=c=${gapColor}:s=${resolution.width}x${resolution.height}:d=${gapDuration}:r=${targetFps},format=${gapFormat},setsar=1[${gapVideoLabel}]`);
  filterComplex.push(`aevalsrc=0:d=${gapDuration}:s=48000:c=stereo[${gapAudioLabel}]`);
  
  trackVideoSegments.push(`[${gapVideoLabel}]`);
  trackAudioSegments.push(`[${gapAudioLabel}]`);
}

function getVideoFilterString(
  clip: ExportClip,
  inputIndex: number,
  isImage: boolean,
  duration: number,
  resolution: { width: number; height: number },
  targetFps: number,
  needsFpsNormalization: boolean,
  needsPerClipTimebaseNormalization: boolean,
  isBaseTrack: boolean,
  inputVideoMeta: Map<number, { width: number; height: number }>
): string {
  const meta = inputVideoMeta.get(inputIndex);
  const needsScalePad = !isImage && meta ? (meta.width !== resolution.width || meta.height !== resolution.height) : true;
  
  const baseFilter = buildVideoFilter(clip, resolution, isImage);
  let videoFilter = '';
  
  if (isImage) {
    videoFilter = `[${inputIndex}:v]loop=loop=-1:size=1:start=0,trim=duration=${duration},setpts=PTS-STARTPTS,${baseFilter}`;
  } else {
    videoFilter = `[${inputIndex}:v]trim=start=${clip.trimStart}:duration=${duration},setpts=PTS-STARTPTS`;
    if (needsScalePad || clip.crop) {
      videoFilter += `,${baseFilter}`;
    } else if (clip.filter) {
      const filterString = getFilterString(clip.filter);
      if (filterString) videoFilter += ',' + filterString;
    }
  }
  
  if (needsFpsNormalization) videoFilter += `,fps=${targetFps}`;
  if (needsPerClipTimebaseNormalization) videoFilter += `,settb=1/${targetFps}`;
  
  // Force SAR to 1:1 to prevent concat filter errors when mixing cropped/scaled clips
  videoFilter += `,setsar=1`;
  
  // Force consistent pixel format per track to prevent concat filter errors
  if (isBaseTrack) {
    videoFilter += ',format=yuv420p';
  } else {
    videoFilter += ',format=rgba';
  }
  
  return videoFilter;
}

function buildImagePostFilter(
  needsFpsNormalization: boolean,
  needsPerClipTimebaseNormalization: boolean,
  isBaseTrack: boolean,
  targetFps: number
): string {
  const parts: string[] = [];
  if (needsFpsNormalization) parts.push(`fps=${targetFps}`);
  if (needsPerClipTimebaseNormalization) parts.push(`settb=1/${targetFps}`);
  parts.push(isBaseTrack ? 'format=yuv420p' : 'format=rgba');
  return parts.join(',');
}

function buildClipVideoFilter(
  clip: ExportClip,
  originalIndex: number,
  inputIndex: number,
  isImage: boolean,
  duration: number,
  resolution: { width: number; height: number },
  targetFps: number,
  needsFpsNormalization: boolean,
  needsPerClipTimebaseNormalization: boolean,
  isBaseTrack: boolean,
  inputVideoMeta: Map<number, { width: number; height: number }>,
  filterComplex: string[]
): string {
  const clipVideoLabel = `v${originalIndex}`;

  if (isImage && !clip.crop) {
    const imageClip = {
      ...clip,
      transform: clip.transform || { x: 50, y: 50, scale: 100, rotation: 0 }
    };
    const transformOutLabel = `trans_${originalIndex}`;
    buildImageTransformFilter(imageClip, inputIndex, duration, resolution, targetFps, isBaseTrack, transformOutLabel, filterComplex);

    const postFilter = buildImagePostFilter(needsFpsNormalization, needsPerClipTimebaseNormalization, isBaseTrack, targetFps);
    filterComplex.push(postFilter
      ? `[${transformOutLabel}]${postFilter}[${clipVideoLabel}]`
      : `[${transformOutLabel}]copy[${clipVideoLabel}]`
    );
  } else {
    const videoFilter = getVideoFilterString(
      clip, inputIndex, isImage, duration, resolution, targetFps,
      needsFpsNormalization, needsPerClipTimebaseNormalization, isBaseTrack, inputVideoMeta
    );
    filterComplex.push(`${videoFilter}[${clipVideoLabel}]`);
  }

  return clipVideoLabel;
}

function combineTransitionFilters(startFilter: string, endFilter: string): string {
  if (startFilter && endFilter) return `${startFilter},${endFilter}`;
  return startFilter || endFilter || '';
}

function applyClipTransitions(
  clip: ExportClip,
  originalIndex: number,
  videoLabel: string,
  duration: number,
  resolution: { width: number; height: number },
  transitions: any[] | undefined,
  filterComplex: string[]
): string {
  if (!transitions) return videoLabel;

  const clipTransitions = transitions.filter(t => t.clipId === clip.id && t.type !== 'none');
  if (clipTransitions.length === 0) return videoLabel;

  const startTransition = clipTransitions.find(t => t.position === 'start');
  const endTransition = clipTransitions.find(t => t.position === 'end');

  const transFilter = getSingleClipTransitionFilter(startTransition || { type: 'none' } as any, duration, resolution);
  const transFilterEnd = getSingleClipTransitionFilter(endTransition || { type: 'none' } as any, duration, resolution);

  const combinedTransFilter = combineTransitionFilters(transFilter, transFilterEnd);
  if (!combinedTransFilter) return videoLabel;

  const transLabel = `vtrans${originalIndex}`;
  filterComplex.push(`[${videoLabel}]${combinedTransFilter}[${transLabel}]`);
  return transLabel;
}

function buildClipAudioFilter(
  clip: ExportClip,
  inputIndex: number,
  isImage: boolean,
  duration: number,
  clipAudioLabel: string,
  filterComplex: string[]
) {
  if (isImage || clip.audioMuted) {
    filterComplex.push(`aevalsrc=0:d=${duration}:s=48000:c=stereo[${clipAudioLabel}]`);
    return;
  }
  const clipVolume = clip.volume ?? 1;
  const volumeFilter = clipVolume !== 1 ? `,volume=${clipVolume}` : '';
  filterComplex.push(`[${inputIndex}:a]atrim=start=${clip.trimStart}:duration=${duration},asetpts=PTS-STARTPTS${volumeFilter}[${clipAudioLabel}]`);
}

function processClipFilter(
  clip: ExportClip,
  originalIndex: number,
  inputIndex: number,
  isImage: boolean,
  duration: number,
  resolution: { width: number; height: number },
  targetFps: number,
  needsFpsNormalization: boolean,
  needsPerClipTimebaseNormalization: boolean,
  isBaseTrack: boolean,
  inputVideoMeta: Map<number, { width: number; height: number }>,
  filterComplex: string[],
  trackVideoSegments: string[],
  trackAudioSegments: string[],
  transitions?: any[]
) {
  const clipAudioLabel = `a${originalIndex}`;

  const clipVideoLabel = buildClipVideoFilter(
    clip, originalIndex, inputIndex, isImage, duration, resolution, targetFps,
    needsFpsNormalization, needsPerClipTimebaseNormalization, isBaseTrack, inputVideoMeta, filterComplex
  );

  const finalVideoLabel = applyClipTransitions(
    clip, originalIndex, clipVideoLabel, duration, resolution, transitions, filterComplex
  );

  buildClipAudioFilter(clip, inputIndex, isImage, duration, clipAudioLabel, filterComplex);

  trackVideoSegments.push(`[${finalVideoLabel}]`);
  trackAudioSegments.push(`[${clipAudioLabel}]`);
}

function buildTrackSegments(
  trackClips: ExportClip[],
  isBaseTrack: boolean,
  timeOrigin: number,
  totalDuration: number,
  clips: ExportClip[],
  clipToInputIndex: Map<number, number>,
  inputVideoMeta: Map<number, { width: number; height: number }>,
  resolution: { width: number; height: number },
  targetFps: number,
  needsFpsNormalization: boolean,
  needsPerClipTimebaseNormalization: boolean,
  filterComplex: string[],
  gapCounterRef: { current: number },
  transitions?: any[]
) {
  const trackVideoSegments: string[] = [];
  const trackAudioSegments: string[] = [];
  let currentTime = timeOrigin;

  for (let i = 0; i < trackClips.length; i++) {
    const clip = trackClips[i];
    const originalIndex = clips.indexOf(clip);
    const inputIndex = clipToInputIndex.get(originalIndex) ?? originalIndex;
    const isImage = clip.file.type.startsWith('image/');
    const duration = clip.duration - clip.trimStart - clip.trimEnd;
    
    if (clip.startTime > currentTime + 0.01) {
      const gapDuration = clip.startTime - currentTime;
      buildGapFilter(gapDuration, gapCounterRef.current++, isBaseTrack, resolution, targetFps, filterComplex, trackVideoSegments, trackAudioSegments);
    }
    
    processClipFilter(
      clip, originalIndex, inputIndex, isImage, duration, resolution, targetFps,
      needsFpsNormalization, needsPerClipTimebaseNormalization, isBaseTrack,
      inputVideoMeta, filterComplex, trackVideoSegments, trackAudioSegments, transitions
    );
    
    currentTime = clip.startTime + duration;
  }
  
  if (currentTime < timeOrigin + totalDuration - 0.01) {
    const gapDuration = timeOrigin + totalDuration - currentTime;
    buildGapFilter(gapDuration, gapCounterRef.current++, isBaseTrack, resolution, targetFps, filterComplex, trackVideoSegments, trackAudioSegments);
  }

  return { trackVideoSegments, trackAudioSegments };
}

function buildOverlayTracks(trackVideoLabels: string[], filterComplex: string[]) {
  let currentVideoLabel = trackVideoLabels[0].replace(/[[\]]/g, '');
  for (let i = 1; i < trackVideoLabels.length; i++) {
    const overlayLabel = trackVideoLabels[i].replace(/[[\]]/g, '');
    const outLabel = `mergedv${i}`;
    filterComplex.push(`[${currentVideoLabel}][${overlayLabel}]overlay=0:0:shortest=1[${outLabel}]`);
    currentVideoLabel = outLabel;
  }
  return currentVideoLabel;
}

function buildTextOverlaysFilter(
  textOverlays: any[],
  currentVideoLabel: string,
  resolution: { width: number; height: number },
  filterComplex: string[]
) {
  if (!textOverlays || textOverlays.length === 0) return currentVideoLabel;
  
  const validTexts = textOverlays.filter(t => t.text.trim());
  if (validTexts.length === 0) return currentVideoLabel;

  let textInputLabel = currentVideoLabel;
  let textOutputLabel = 'vtext0';
  
  for (let i = 0; i < validTexts.length; i++) {
    const text = validTexts[i];
    const textFilter = getTextFilterString(text, resolution.width, resolution.height);
    const isLast = i === validTexts.length - 1;
    textOutputLabel = isLast ? 'finalv' : `vtext${i}`;
    
    filterComplex.push(`[${textInputLabel}]${textFilter}[${textOutputLabel}]`);
    textInputLabel = textOutputLabel;
  }
  
  return 'finalv';
}

function buildExternalAudioFilter(
  externalAudioClips: ExportAudioClip[],
  externalAudioFileToInputIndex: Map<File, number>,
  timeOrigin: number,
  totalDuration: number,
  currentAudioLabel: string,
  filterComplex: string[]
) {
  if (externalAudioClips.length === 0) return currentAudioLabel;

  const sortedAudio = [...externalAudioClips].sort((a, b) => a.startTime - b.startTime);
  const parts: string[] = [];
  let cursor = 0;
  let seg = 0;

  for (const ac of sortedAudio) {
    const inputIndex = externalAudioFileToInputIndex.get(ac.file);
    if (inputIndex == null) continue;

    let dur = Math.max(0, ac.duration - ac.trimStart - ac.trimEnd);
    if (dur <= 0.001) continue;

    // Calculate where this audio clip should start relative to the exported timeline
    const relativeStart = ac.startTime - timeOrigin;
    
    // If the audio clip ends before the timeline starts, skip it entirely
    if (relativeStart + dur <= 0) continue;
    // If the audio clip starts after the total duration, skip it
    if (relativeStart >= totalDuration) continue;
    
    // If the audio clip starts before the timeline origin, trim the beginning
    let audioTrimStart = ac.trimStart;
    let effectiveStart = Math.max(0, relativeStart);
    if (relativeStart < 0) {
      audioTrimStart += Math.abs(relativeStart);
      dur -= Math.abs(relativeStart);
    }
    
    // Clamp duration so audio doesn't extend past the total duration
    dur = Math.min(dur, totalDuration - effectiveStart);
    if (dur <= 0.001) continue;

    const start = Math.max(effectiveStart, cursor);
    const gap = start - cursor;
    if (gap > 0.01) {
      const gl = `agape${seg++}`;
      filterComplex.push(`aevalsrc=0:d=${gap}:s=48000:c=stereo[${gl}]`);
      parts.push(`[${gl}]`);
      cursor += gap;
    }

    const al = `aext${seg++}`;
    const acVolume = (ac as ExportAudioClip).volume ?? 1;
    const acVolumeFilter = acVolume !== 1 ? `,volume=${acVolume}` : '';
    filterComplex.push(`[${inputIndex}:a]atrim=start=${audioTrimStart}:duration=${dur},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo${acVolumeFilter}[${al}]`);
    parts.push(`[${al}]`);
    cursor += dur;
  }

  const tail = totalDuration - cursor;
  if (tail > 0.01) {
    const tl = `atail${seg++}`;
    filterComplex.push(`aevalsrc=0:d=${tail}:s=48000:c=stereo[${tl}]`);
    parts.push(`[${tl}]`);
  }

  const extAudioLabel = 'outa_ext_only';
  if (parts.length === 0) {
    return currentAudioLabel;
  } else {
    filterComplex.push(`${parts.join('')}concat=n=${parts.length}:v=0:a=1[${extAudioLabel}]`);
  }
  
  const finalAudioLabel = 'outa_final';
  filterComplex.push(`[${currentAudioLabel}][${extAudioLabel}]amix=inputs=2:duration=longest[${finalAudioLabel}]`);
  
  return finalAudioLabel;
}

function buildMultiClipFilterChain(
  clips: ExportClip[],
  clipToInputIndex: Map<number, number>,
  inputVideoMeta: Map<number, { width: number; height: number }>,
  transitions: any[] | undefined,
  textOverlays: any[] | undefined,
  externalAudioClips: ExportAudioClip[],
  externalAudioFileToInputIndex: Map<File, number>,
  resolution: { width: number; height: number },
  targetFps: number,
  timeOrigin: number,
  uniqueFilesCount: number
) {
  const filterComplex: string[] = [];
  
  const hasImages = clips.some((c) => c.file.type.startsWith('image/'));
  const hasAnyTransitionMarkers = !!(transitions && transitions.some((t) => t.type !== 'none'));
  const needsPerClipTimebaseNormalization = hasAnyTransitionMarkers;
  const needsFpsNormalization = uniqueFilesCount > 1 || hasImages || needsPerClipTimebaseNormalization;
  
  const tracksMap = new Map<number, ExportClip[]>();
  clips.forEach(clip => {
    const trackIndex = clip.trackIndex ?? 0;
    if (!tracksMap.has(trackIndex)) {
      tracksMap.set(trackIndex, []);
    }
    tracksMap.get(trackIndex)!.push(clip);
  });

  const trackIndices = Array.from(tracksMap.keys()).sort((a, b) => a - b);
  
  // Calculate actual total duration by considering both video and audio clips
  const videoDurations = clips.map((c) => {
    const d = c.duration - c.trimStart - c.trimEnd;
    return Math.max(0, c.startTime - timeOrigin) + Math.max(0, d);
  });
  const audioDurations = (externalAudioClips || []).map((ac) => {
    const d = ac.duration - ac.trimStart - ac.trimEnd;
    return Math.max(0, ac.startTime - timeOrigin) + Math.max(0, d);
  });
  const totalDuration = Math.max(0, ...videoDurations, ...audioDurations);

  const trackVideoLabels: string[] = [];
  const trackAudioLabels: string[] = [];
  const gapCounterRef = { current: 0 };

  for (const trackIndex of trackIndices) {
    const trackClips = tracksMap.get(trackIndex)!.sort((a, b) => a.startTime - b.startTime);
    const isBaseTrack = trackIndex === trackIndices[0];
    
    const { trackVideoSegments, trackAudioSegments } = buildTrackSegments(
      trackClips, isBaseTrack, timeOrigin, totalDuration, clips, clipToInputIndex,
      inputVideoMeta, resolution, targetFps, needsFpsNormalization,
      needsPerClipTimebaseNormalization, filterComplex, gapCounterRef, transitions
    );
    
    const trackVideoOut = `trackv${trackIndex}`;
    const trackAudioOut = `tracka${trackIndex}`;
    
    if (trackVideoSegments.length === 1) {
      filterComplex.push(`${trackVideoSegments[0]}null[${trackVideoOut}]`);
      filterComplex.push(`${trackAudioSegments[0]}anull[${trackAudioOut}]`);
    } else {
      filterComplex.push(`${trackVideoSegments.join('')}concat=n=${trackVideoSegments.length}:v=1:a=0,settb=1/${targetFps}[${trackVideoOut}]`);
      filterComplex.push(`${trackAudioSegments.join('')}concat=n=${trackAudioSegments.length}:v=0:a=1[${trackAudioOut}]`);
    }
    
    trackVideoLabels.push(`[${trackVideoOut}]`);
    trackAudioLabels.push(`[${trackAudioOut}]`);
  }
  
  let currentVideoLabel = buildOverlayTracks(trackVideoLabels, filterComplex);
  
  const currentAudioLabel = 'outa';
  if (trackAudioLabels.length === 1) {
    filterComplex.push(`${trackAudioLabels[0]}anull[${currentAudioLabel}]`);
  } else {
    filterComplex.push(`${trackAudioLabels.join('')}amix=inputs=${trackAudioLabels.length}:duration=longest[${currentAudioLabel}]`);
  }
  
  currentVideoLabel = buildTextOverlaysFilter(textOverlays || [], currentVideoLabel, resolution, filterComplex);

  const finalVideoLabel = currentVideoLabel;
  const finalAudioLabel = buildExternalAudioFilter(
    externalAudioClips, externalAudioFileToInputIndex, timeOrigin, totalDuration, currentAudioLabel, filterComplex
  );

  return { filterComplex, finalVideoLabel, finalAudioLabel };
}

async function exportMultiClip(
  ffmpegInstance: any,
  clips: ExportClip[],
  settings: any,
  encodingSettings: any,
  resolution: { width: number; height: number },
  outputFormat: string,
  quality: string,
  execTimeoutMs: number,
  encodingStartTime: number,
  onProgress?: (progress: number, message: string) => void,
  textOverlays?: any[],
  transitions?: any[],
  audioClips?: ExportAudioClip[],
  safeMode: boolean = false
): Promise<Blob> {
  onProgress?.(5, 'Chargement des fichiers...');
  
  const externalAudioClips = audioClips || [];
  const timeOrigin = clips.length > 0 ? Math.min(...clips.map((c) => c.startTime)) : 0;
  
  const adjustedTextOverlays = (textOverlays || [])
    .map(text => ({
      ...text,
      startTime: text.startTime - timeOrigin
    }))
    .filter(text => text.text.trim() && text.startTime + text.duration > 0);
  
  const { inputFiles, clipToInputIndex, uniqueFiles, inputVideoMeta } = await loadUniqueFiles(
    ffmpegInstance, clips, safeMode, onProgress
  );
  
  const externalAudioFileToInputIndex = await loadExternalAudioFiles(
    ffmpegInstance, externalAudioClips, uniqueFiles, inputFiles, safeMode, onProgress
  );
  
  const targetFps = Number.parseInt(settings.fps || '30');
  
  const { filterComplex, finalVideoLabel, finalAudioLabel } = buildMultiClipFilterChain(
    clips, clipToInputIndex, inputVideoMeta, transitions, adjustedTextOverlays,
    externalAudioClips, externalAudioFileToInputIndex, resolution, targetFps, timeOrigin, uniqueFiles.length
  );

  const outputFileName = `output.${outputFormat}`;
  
  let args = [
    ...inputFiles.flatMap(f => ['-i', f]),
    '-progress', 'pipe:1',
    '-nostats',
    '-filter_complex', filterComplex.join(';'),
    '-map', `[${finalVideoLabel}]`,
    '-map', `[${finalAudioLabel}]`,
    '-c:v', encodingSettings.videoCodec,
    '-crf', quality,
    '-c:a', outputFormat === 'webm' ? 'libopus' : 'aac',
    '-preset', encodingSettings.preset,
    '-r', String(Math.min(Number.parseInt(settings.fps || '30'), encodingSettings.targetFps)),
    '-pix_fmt', encodingSettings.pixelFormat,
    '-threads', encodingSettings.threads,
    '-shortest',
    outputFileName
  ];
  
  args = buildOptimizedArgs(args, encodingSettings);

  console.log('FFmpeg command:', args.join(' '));
  onProgress?.(10, 'Encodage...');
  await execWithTimeout(ffmpegInstance, args, execTimeoutMs);

  onProgress?.(96, 'Finalisation...');
  const data = await ffmpegInstance.readFile(outputFileName);
  
  onProgress?.(98, 'Nettoyage...');
  for (const fileName of inputFiles) {
    await ffmpegInstance.deleteFile(fileName);
  }
  await ffmpegInstance.deleteFile(outputFileName);
  
  onProgress?.(99, 'Préparation du téléchargement...');

  const actualEncodingTime = (performance.now() - encodingStartTime) / 1000;
  console.log('✅ EXPORT COMPLETE (Multi-Clip)');
  console.log(`⏱️ Actual encoding time: ${formatEncodingTime(Math.ceil(actualEncodingTime))}`);
  console.log(`📈 Speed ratio: ${(currentTotalDuration / actualEncodingTime).toFixed(2)}x realtime`);
  console.log(`📊 Clips processed: ${clips.length}`);

  onProgress?.(100, 'Terminé !');
  return new Blob([data as any], { type: outputFormat === 'webm' ? 'video/webm' : 'video/mp4' });
}

async function _exportProjectInternal(
  clips: ExportClip[],
  settings: ExportSettings,
  onProgress?: (progress: number, message: string) => void,
  textOverlays?: TextOverlay[],
  transitions?: Transition[],
  aspectRatio?: AspectRatio,
  hardwareProfile?: AnyHardwareProfile,
  safeMode: boolean = false,
  audioClips?: ExportAudioClip[]
): Promise<Blob> {
  // Try MediaBunny export first if no complex features
  const mediaBunnyResult = tryMediaBunnyExport(clips, settings, onProgress, textOverlays, transitions, aspectRatio, hardwareProfile, safeMode, audioClips);
  if (mediaBunnyResult) {
    return mediaBunnyResult;
  }

  // Wait for any existing FFmpeg operation to complete
  await waitForFFmpegOperation();
  
  isOperationInProgress = true;
  currentOperationType = 'export';
  
  try {
    return await performFFmpegExport(clips, settings, onProgress, textOverlays, transitions, aspectRatio, hardwareProfile, safeMode, audioClips);
  } catch (error) {
    await handleExportError(error);
    throw error;
  } finally {
    isOperationInProgress = false;
    currentOperationType = null;
  }
}

function tryMediaBunnyExport(
  clips: ExportClip[],
  settings: ExportSettings,
  onProgress?: (progress: number, message: string) => void,
  textOverlays?: TextOverlay[],
  transitions?: Transition[],
  aspectRatio?: AspectRatio,
  hardwareProfile?: AnyHardwareProfile,
  safeMode?: boolean,
  audioClips?: ExportAudioClip[]
): Promise<Blob> | null {
  // Only fall back to FFmpeg for image clips (not supported by MediaBunny)
  const hasImages = clips.some(c => c.file.type.startsWith('image/'));
  if (hasImages) {
    console.log('⚠️ Image clips detected, using FFmpeg (MediaBunny does not support static images).');
    return null;
  }

  try {
    console.log('🐰 Using MediaBunny for export (primary engine)');
    return exportProjectWithMediaBunny(
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
    console.error('MediaBunny export failed, falling back to FFmpeg:', error);
    return null;
  }
}

async function waitForFFmpegOperation(): Promise<void> {
  if (isOperationInProgress && currentOperationType === 'export') {
    throw new Error('Un export est déjà en cours. Veuillez patienter.');
  }

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
}

async function performFFmpegExport(
  clips: ExportClip[],
  settings: ExportSettings,
  onProgress?: (progress: number, message: string) => void,
  textOverlays?: TextOverlay[],
  transitions?: Transition[],
  aspectRatio?: AspectRatio,
  hardwareProfile?: AnyHardwareProfile,
  safeMode?: boolean,
  audioClips?: ExportAudioClip[]
): Promise<Blob> {
  currentTotalDuration = clips.reduce((acc, clip) => acc + (clip.duration - clip.trimStart - clip.trimEnd), 0);
  
  onProgress?.(1, safeMode ? 'Chargement de FFmpeg (Mode sans échec)...' : 'Chargement de FFmpeg...');
  
  const exportProgressHandler = (percent: number, msg: string) => {
    const scaledPercent = Math.round(percent * 0.95);
    const safePercent = Math.min(95, Math.max(0, scaledPercent));
    onProgress?.(safePercent, `Traitement en cours...`);
  };

  const ffmpegInstance = await loadFFmpeg(exportProgressHandler, { safeMode });
  
  if (textOverlays && textOverlays.length > 0 && textOverlays.some(t => t.text.trim())) {
    onProgress?.(2, 'Chargement de la police...');
    await loadDefaultFont(ffmpegInstance);
  }
  
  onProgress?.(3, 'Préparation des paramètres...');
  const effectiveAspectRatio = aspectRatio || settings.aspectRatio || '16:9';
  const resolution = getResolutionForAspectRatio(settings.resolution, effectiveAspectRatio);
  console.log(`📐 Export resolution: ${resolution.width}x${resolution.height} (${effectiveAspectRatio})`);
  const outputFormat = settings.format;
  
  const effectiveHardwareProfile = hardwareProfile || cachedHardwareProfile;
  const encodingSettings = getOptimalEncodingSettings(
    effectiveHardwareProfile,
    outputFormat as 'mp4' | 'webm',
    settings.quality,
    safeMode
  );
  
  const estimatedTime = estimateEncodingTime(
    effectiveHardwareProfile,
    currentTotalDuration,
    resolution
  );

  const execTimeoutMs = safeMode
    ? Math.max(600_000, estimatedTime * 1000 * 60)
    : Math.max(240_000, estimatedTime * 1000 * 30) + (outputFormat === 'webm' ? 180_000 : 0); // Add 3 min extra for WebM
  
  const encodingStartTime = performance.now();
  const quality = encodingSettings.crf;

  if (clips.length === 0) {
    throw new Error('Aucun clip à exporter');
  }

  if (clips.length === 1) {
    return await exportSingleClip(
      ffmpegInstance, clips[0], settings, encodingSettings, resolution, outputFormat, quality,
      execTimeoutMs, encodingStartTime, onProgress, textOverlays, transitions, audioClips, safeMode
    );
  }

  return await exportMultiClip(
    ffmpegInstance, clips, settings, encodingSettings, resolution, outputFormat, quality,
    execTimeoutMs, encodingStartTime, onProgress, textOverlays, transitions, audioClips, safeMode
  );
}

async function handleExportError(error: unknown): Promise<void> {
  console.error('Error in exportProject:', error);
  const isFFmpegError = error instanceof Error && (
    error.message.includes('Timeout') ||
    error.message.includes('stuck') ||
    error.message.includes('FFmpeg.terminate') ||
    error.message.includes('FS error')
  );
  
  if (isFFmpegError) {
    console.warn('FFmpeg error detected, resetting instance...');
    await resetFFmpeg();
  }
}

function getFileExtension(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? `.${ext}` : '.mp4';
}

async function convertImageToPng(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      // Use a reasonable default size if SVG doesn't specify dimensions
      canvas.width = img.width || 1920;
      canvas.height = img.height || 1080;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        return reject(new Error('Could not get canvas context'));
      }
      
      try {
        if (!img.complete || img.naturalWidth === 0) {
          URL.revokeObjectURL(url);
          return reject(new Error('Image not fully loaded or has zero dimensions'));
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Could not convert image to PNG'));
          }
        }, 'image/png');
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load image for conversion'));
    };
    
    img.src = url;
  });
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
  clips: { file: File; startTime: number; duration: number; trimStart: number; trimEnd: number; filter?: VideoFilter; id?: string; audioMuted?: boolean; volume?: number; crop?: any; transform?: any; trackIndex?: number }[],
  settings: ExportSettings,
  onProgress?: (progress: number, message: string) => void,
  textOverlays?: TextOverlay[],
  transitions?: Transition[],
  aspectRatio?: AspectRatio,
  hardwareProfile?: AnyHardwareProfile,
  audioClips?: { file: File; startTime: number; duration: number; trimStart: number; trimEnd: number; id?: string; volume?: number }[]
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

