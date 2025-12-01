// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { RESOLUTION_PRESETS, ExportSettings, VideoFilter, TimelineClip, MediaFile, TextOverlay, Transition, TransitionType } from '../types';

let ffmpeg: FFmpeg | null = null;
let isLoaded = false;
let isFontLoaded = false;
let currentProgressCallback: ((progress: number, message: string) => void) | undefined;
let currentTotalDuration = 0;

// Default font file path in FFmpeg virtual filesystem
const FFMPEG_FONT_PATH = '/fonts/default.ttf';

export async function loadFFmpeg(
  onProgress?: (progress: number, message: string) => void
): Promise<FFmpeg> {
  currentProgressCallback = onProgress;

  if (ffmpeg && isLoaded) {
    console.log('FFmpeg already loaded');
    return ffmpeg;
  }

  console.log('Loading FFmpeg...');
  ffmpeg = new FFmpeg();

  ffmpeg.on('log', ({ message }) => {
    console.log('[FFmpeg]', message);
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
      
      // Only update if progress has changed significantly to avoid jitter
      // or if it's the final completion
      currentProgressCallback(Math.round(percentage), `Traitement en cours...`);
    }
  });

  try {
    onProgress?.(0, 'Chargement de FFmpeg...');
    
    // Load FFmpeg core from CDN
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    
    console.log('Fetching FFmpeg core files...');
    
    // Add timeout for fetching files
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout loading FFmpeg core files')), 30000)
    );

    const loadPromise = (async () => {
      const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
      const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');
      
      console.log('Loading FFmpeg with core files...');
      await ffmpeg!.load({
        coreURL,
        wasmURL,
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
}

export async function exportProject(
  clips: { file: File; startTime: number; duration: number; trimStart: number; trimEnd: number; filter?: VideoFilter; id?: string }[],
  settings: ExportSettings,
  onProgress?: (progress: number, message: string) => void,
  textOverlays?: TextOverlay[],
  transitions?: Transition[]
): Promise<Blob> {
  try {
    // Calculate total duration for progress normalization
    currentTotalDuration = clips.reduce((acc, clip) => acc + (clip.duration - clip.trimStart - clip.trimEnd), 0);
    
    onProgress?.(1, 'Chargement de FFmpeg...');
    
    // Define a specific progress handler for export
    const exportProgressHandler = (percent: number, msg: string) => {
      // Ensure progress is strictly increasing and within bounds
      const safePercent = Math.min(99, Math.max(0, Math.round(percent)));
      onProgress?.(safePercent, `Traitement en cours...`);
    };

    const ffmpegInstance = await loadFFmpeg(exportProgressHandler);
    
    // Load font for text overlays if there are any text overlays
    if (textOverlays && textOverlays.length > 0 && textOverlays.some(t => t.text.trim())) {
      onProgress?.(2, 'Chargement de la police...');
      await loadDefaultFont(ffmpegInstance);
    }
    
    onProgress?.(3, 'Préparation des paramètres...');
    const resolution = RESOLUTION_PRESETS[settings.resolution];
    const outputFormat = settings.format;
    const quality = settings.quality === 'high' ? '18' : settings.quality === 'medium' ? '23' : '28';

    if (clips.length === 0) {
      throw new Error('Aucun clip à exporter');
    }

    // For a single clip, simple export
    if (clips.length === 1) {
      onProgress?.(5, 'Chargement du fichier...');
      const clip = clips[0];
      const inputFileName = 'input' + getFileExtension(clip.file.name);
      const outputFileName = `output.${outputFormat}`;

      await ffmpegInstance.writeFile(inputFileName, await fetchFile(clip.file));

      onProgress?.(5, 'Traitement de la vidéo...');
      
      const clipDuration = clip.duration - clip.trimStart - clip.trimEnd;
      
      // Build video filter chain
      let videoFilterChain = `scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2`;
      
      // Add clip filter if present
      if (clip.filter) {
        const filterString = getFilterString(clip.filter);
        if (filterString) {
          videoFilterChain += ',' + filterString;
        }
      }
      
      // Apply transitions for single clip (fade in/out effects)
      if (transitions && transitions.length > 0) {
        console.log('🔀 DEBUG - Processing transitions for single clip export');
        const clipId = clip.id;
        
        // Find transitions for this clip
        const clipTransitions = transitions.filter(t => t.clipId === clipId && t.type !== 'none');
        console.log(`🔀 DEBUG - Found ${clipTransitions.length} transitions for single clip`);
        
        for (const transition of clipTransitions) {
          console.log(`🔀 DEBUG - Single clip transition:`, {
            type: transition.type,
            position: transition.position,
            duration: transition.duration
          });
          
          const transitionFilter = getSingleClipTransitionFilter(transition, clipDuration);
          if (transitionFilter) {
            videoFilterChain += ',' + transitionFilter;
            console.log(`🔀 DEBUG - Applied single clip transition filter: ${transitionFilter}`);
          }
        }
      }
      
      // Add text overlays for single clip export
      if (textOverlays && textOverlays.length > 0) {
        console.log('🔤 DEBUG - Processing text overlays for single clip export');
        console.log('🔤 DEBUG - isFontLoaded:', isFontLoaded);
        
        console.log('🔤 DEBUG - Clip duration:', clipDuration);
        
        const relevantTexts = textOverlays.filter(text => {
          const textEnd = text.startTime + text.duration;
          const isRelevant = text.startTime < clipDuration && textEnd > 0;
          console.log(`🔤 DEBUG - Text "${text.text}" (${text.startTime}s - ${textEnd}s): ${isRelevant ? 'INCLUDED' : 'EXCLUDED'}`);
          return isRelevant;
        });
        
        console.log('🔤 DEBUG - Relevant texts count:', relevantTexts.length);
        
        for (const text of relevantTexts) {
          // Adjust text timing relative to clip
          const adjustedText = {
            ...text,
            startTime: Math.max(0, text.startTime - clip.trimStart),
            duration: text.duration,
          };
          // Ensure endTime doesn't exceed clip duration
          const endTime = adjustedText.startTime + adjustedText.duration;
          if (endTime > clipDuration) {
            adjustedText.duration = clipDuration - adjustedText.startTime;
          }
          if (adjustedText.duration > 0) {
            const textFilter = getTextFilterString(adjustedText, resolution.width, resolution.height);
            console.log(`🔤 DEBUG - Text filter for "${text.text}":`, textFilter);
            videoFilterChain += ',' + textFilter;
          } else {
            console.log(`🔤 DEBUG - Text "${text.text}" skipped: duration <= 0 after adjustment`);
          }
        }
        
        console.log('🔤 DEBUG - Final video filter chain:', videoFilterChain);
      }
      
      const args = [
        '-i', inputFileName,
        '-ss', clip.trimStart.toString(),
        '-t', clipDuration.toString(),
        '-vf', videoFilterChain,
        '-c:v', outputFormat === 'webm' ? 'libvpx-vp9' : 'libx264',
        '-crf', quality,
        '-c:a', outputFormat === 'webm' ? 'libopus' : 'aac',
        '-preset', 'ultrafast', // Optimized for speed
        '-r', settings.fps || '30',
        '-pix_fmt', 'yuv420p',
        '-threads', '0', // Let FFmpeg decide optimal thread count
        outputFileName
      ];

      console.log('FFmpeg command:', args.join(' '));
      await ffmpegInstance.exec(args);

      onProgress?.(98, 'Finalisation...');
      const data = await ffmpegInstance.readFile(outputFileName);
      
      await ffmpegInstance.deleteFile(inputFileName);
      await ffmpegInstance.deleteFile(outputFileName);

      onProgress?.(100, 'Terminé !');
      return new Blob([data as any], { type: outputFormat === 'webm' ? 'video/webm' : 'video/mp4' });
    }

    // For multiple clips, concatenate
    onProgress?.(5, 'Chargement des fichiers...');
    const inputFiles: string[] = [];
    const filterComplex: string[] = [];
    
    // Separate video/image clips from audio clips if needed, but current structure assumes clips have both or are video
    // We need to handle cases where clips might not have audio stream
    
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const inputFileName = `input${i}${getFileExtension(clip.file.name)}`;
      await ffmpegInstance.writeFile(inputFileName, await fetchFile(clip.file));
      inputFiles.push(inputFileName);
      
      // Video filter chain
      // Ensure we have a video stream. If it's an image, loop it.
      // If it's a video, trim it.
      const isImage = clip.file.type.startsWith('image/');
      const duration = clip.duration - clip.trimStart - clip.trimEnd;
      
      let videoFilter = '';
      if (isImage) {
        // For images: loop 1, trim to duration, scale/pad
        // Note: images don't have [i:v], they are just input i. But ffmpeg treats image input as video stream.
        videoFilter = `[${i}:v]loop=loop=-1:size=1:start=0,trim=duration=${duration},setpts=PTS-STARTPTS,scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
      } else {
        // For video: trim, scale/pad, setsar to avoid aspect ratio issues
        videoFilter = `[${i}:v]trim=start=${clip.trimStart}:duration=${duration},setpts=PTS-STARTPTS,scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
      }
      
      if (clip.filter) {
        const filterString = getFilterString(clip.filter);
        if (filterString) {
          videoFilter += ',' + filterString;
        }
      }
      
      filterComplex.push(`${videoFilter}[v${i}]`);
    }
    
    // Calculate cumulative durations for transition offsets and text timing
    const clipDurations: number[] = clips.map(clip => clip.duration - clip.trimStart - clip.trimEnd);
    const clipStartTimes: number[] = [];
    let cumulativeTime = 0;
    for (let i = 0; i < clips.length; i++) {
      clipStartTimes.push(cumulativeTime);
      cumulativeTime += clipDurations[i];
    }
    
    // Build transition maps for clips that have transitions
    // startTransitionMap: Key: clipId, Value: transition (for 'start' position transitions - applied at beginning of clip)
    // endTransitionMap: Key: clipId, Value: transition (for 'end' position transitions - applied at end of clip)
    const startTransitionMap = new Map<string, Transition>();
    const endTransitionMap = new Map<string, Transition>();
    
    if (transitions && transitions.length > 0) {
      console.log('🔀 DEBUG - Building transition maps from', transitions.length, 'transitions');
      for (const transition of transitions) {
        console.log(`🔀 DEBUG - Transition:`, {
          id: transition.id,
          type: transition.type,
          clipId: transition.clipId,
          position: transition.position,
          duration: transition.duration
        });
        if (transition.type !== 'none') {
          if (transition.position === 'start') {
            startTransitionMap.set(transition.clipId, transition);
            console.log(`🔀 DEBUG - Start transition mapped: clipId=${transition.clipId}, type=${transition.type}`);
          } else if (transition.position === 'end') {
            endTransitionMap.set(transition.clipId, transition);
            console.log(`🔀 DEBUG - End transition mapped: clipId=${transition.clipId}, type=${transition.type}`);
          }
        } else {
          console.log(`🔀 DEBUG - Transition skipped (type=none): clipId=${transition.clipId}`);
        }
      }
      console.log('🔀 DEBUG - Start transition map size:', startTransitionMap.size);
      console.log('🔀 DEBUG - End transition map size:', endTransitionMap.size);
    } else {
      console.log('🔀 DEBUG - No transitions to process');
    }
    
    // Apply transitions between clips using xfade
    // xfade merges two video streams with a transition effect
    // Format: [input1][input2]xfade=transition=type:duration=d:offset=o[output]
    // The offset is when the transition starts (relative to the beginning of the combined output)
    //
    // Transition logic:
    // - 'start' position on clip N: transition FROM clip N-1 TO clip N (applied between N-1 and N)
    // - 'end' position on clip N: transition FROM clip N TO clip N+1 (applied between N and N+1)
    // Both are equivalent for the same pair of clips, just different UI perspectives
    
    let hasTransitions = false;
    let currentVideoLabel = 'v0';
    let cumulativeOffset = clipDurations[0]; // Running total of video duration (accounting for overlaps)
    
    console.log('Starting transition processing with', clips.length, 'clips');
    console.log('Clip durations:', clipDurations);
    
    for (let i = 1; i < clips.length; i++) {
      const clip = clips[i];
      const clipId = clip.id;
      const prevClip = clips[i - 1];
      const prevClipId = prevClip.id;
      
      // Check for transition: either 'start' on current clip OR 'end' on previous clip
      let transition = clipId ? startTransitionMap.get(clipId) : undefined;
      let transitionSource = 'start';
      
      // If no 'start' transition on current clip, check for 'end' transition on previous clip
      if (!transition && prevClipId) {
        transition = endTransitionMap.get(prevClipId);
        transitionSource = 'end';
      }
      
      console.log(`🔀 DEBUG - Processing clip ${i}/${clips.length - 1}:`, {
        clipId,
        prevClipId,
        hasTransition: !!transition,
        transitionType: transition?.type,
        transitionPosition: transition?.position,
        transitionSource
      });
      
      if (transition) {
        hasTransitions = true;
        console.log(`🔀 DEBUG - ✅ Applying transition ${transition.type} between clips ${i-1} and ${i} (source: ${transitionSource} position on ${transitionSource === 'start' ? 'current' : 'previous'} clip)`);
        
        // Transition duration should not exceed either clip's duration
        const transitionDuration = Math.min(
          transition.duration,
          clipDurations[i - 1] * 0.9, // Don't use more than 90% of previous clip
          clipDurations[i] * 0.9      // Don't use more than 90% of current clip
        );
        
        // The offset is where the transition starts in the output timeline
        // It's the cumulative duration minus the transition duration (because clips overlap)
        const offset = Math.max(0, cumulativeOffset - transitionDuration);
        
        const outputLabel = `vt${i}`;
        const xfadeFilter = getTransitionFilter(transition, offset);
        
        console.log(`Applying xfade: [${currentVideoLabel}][v${i}] offset=${offset}, duration=${transitionDuration}`);
        console.log(`xfade filter: ${xfadeFilter}`);
        
        if (xfadeFilter) {
          filterComplex.push(`[${currentVideoLabel}][v${i}]${xfadeFilter}[${outputLabel}]`);
          currentVideoLabel = outputLabel;
          
          // Update cumulative offset: add current clip duration minus overlap
          cumulativeOffset = offset + clipDurations[i];
        }
      } else {
        // No transition - need to concatenate this clip with the current video
        // Use concat filter to join without transition
        const outputLabel = `vt${i}`;
        filterComplex.push(`[${currentVideoLabel}][v${i}]concat=n=2:v=1:a=0[${outputLabel}]`);
        currentVideoLabel = outputLabel;
        
        // Update cumulative offset: just add the full clip duration
        cumulativeOffset += clipDurations[i];
        
        console.log(`🔀 DEBUG - No transition for clip ${i}, using concat. New cumulative offset: ${cumulativeOffset}`);
      }
    }
    
    // Rename final video output to vmerged
    if (clips.length > 1) {
      filterComplex.push(`[${currentVideoLabel}]copy[vmerged]`);
      currentVideoLabel = 'vmerged';
    }
    
    console.log('Transition processing complete. hasTransitions:', hasTransitions, 'finalLabel:', currentVideoLabel);
    
    // Generate audio filters for all clips
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const isImage = clip.file.type.startsWith('image/');
      const duration = clip.duration - clip.trimStart - clip.trimEnd;
      
      if (isImage) {
        // Generate silence for image duration
        filterComplex.push(`aevalsrc=0:d=${duration}[a${i}]`);
      } else {
        // For video, use its audio
        filterComplex.push(`[${i}:a]atrim=start=${clip.trimStart}:duration=${duration},asetpts=PTS-STARTPTS[a${i}]`);
      }
    }
      
    onProgress?.(5, 'Assemblage des clips...');

    // Audio concatenation - always needed for multiple clips
    const audioConcat = clips.map((_, i) => `[a${i}]`).join('');
    filterComplex.push(`${audioConcat}concat=n=${clips.length}:v=0:a=1[outa]`);
    
    // Video is already merged in currentVideoLabel (vmerged), just rename to outv
    filterComplex.push(`[${currentVideoLabel}]copy[outv]`);
    
    // Add text overlays to the final merged video
    if (textOverlays && textOverlays.length > 0 && textOverlays.some(t => t.text.trim())) {
      console.log('🔤 DEBUG - Processing text overlays for multi-clip export');
      console.log('🔤 DEBUG - isFontLoaded:', isFontLoaded);
      
      // Remove the last filter that outputs to [outv] - we'll chain text filters instead
      filterComplex.pop();
      
      // Apply text filters to the merged video (currentVideoLabel = vmerged)
      let textInputLabel = currentVideoLabel;
      let textOutputLabel = 'vtext0';
      
      const validTexts = textOverlays.filter(t => t.text.trim());
      console.log('🔤 DEBUG - Valid texts count:', validTexts.length);
      
      for (let i = 0; i < validTexts.length; i++) {
        const text = validTexts[i];
        const textFilter = getTextFilterString(text, resolution.width, resolution.height);
        const isLast = i === validTexts.length - 1;
        textOutputLabel = isLast ? 'outv' : `vtext${i}`;
        
        console.log(`🔤 DEBUG - Text ${i + 1}/${validTexts.length}:`, {
          text: text.text,
          startTime: text.startTime,
          duration: text.duration,
          filter: textFilter
        });
        
        filterComplex.push(`[${textInputLabel}]${textFilter}[${textOutputLabel}]`);
        textInputLabel = textOutputLabel;
      }
      
      console.log('🔤 DEBUG - Text filters added to filter complex');
    } else {
      console.log('🔤 DEBUG - No text overlays to process (count:', textOverlays?.length, ', hasValidText:', textOverlays?.some(t => t.text.trim()), ')');
    }

    const outputFileName = `output.${outputFormat}`;
    
    const args = [
      ...inputFiles.flatMap(f => ['-i', f]),
      '-filter_complex', filterComplex.join(';'),
      '-map', '[outv]',
      '-map', '[outa]',
      '-c:v', outputFormat === 'webm' ? 'libvpx-vp9' : 'libx264',
      '-crf', quality,
      '-c:a', outputFormat === 'webm' ? 'libopus' : 'aac',
      '-preset', 'ultrafast', // Optimized for speed
      // Force a reasonable frame rate to avoid "Frame rate very high" errors and massive processing load
      '-r', settings.fps || '30',
      // Explicitly set pixel format to avoid compatibility issues
      '-pix_fmt', 'yuv420p',
      // Add shortest to prevent infinite loops if something goes wrong with duration
      '-shortest',
      // Add hardware acceleration if available (auto-detected by ffmpeg.wasm usually, but explicit flags can help)
      // Note: ffmpeg.wasm is software based, but we can optimize args
      '-movflags', '+faststart', // Optimize for web playback
      outputFileName
    ];

    console.log('FFmpeg command:', args.join(' '));
    await ffmpegInstance.exec(args);

    onProgress?.(98, 'Finalisation...');
    const data = await ffmpegInstance.readFile(outputFileName);
    
    // Clean up
    for (const fileName of inputFiles) {
      await ffmpegInstance.deleteFile(fileName);
    }
    await ffmpegInstance.deleteFile(outputFileName);

    onProgress?.(100, 'Terminé !');
    return new Blob([data as any], { type: outputFormat === 'webm' ? 'video/webm' : 'video/mp4' });
  } catch (error) {
    console.error('Error in exportProject:', error);
    throw error;
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
