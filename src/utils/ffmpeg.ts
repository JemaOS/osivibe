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
 * Uses Google's Roboto font from CDN
 */
export async function loadDefaultFont(ffmpegInstance: FFmpeg): Promise<void> {
  if (isFontLoaded) {
    console.log('Font already loaded');
    return;
  }

  try {
    console.log('Loading default font for text overlays...');
    
    // Fetch Roboto Regular font from Google Fonts CDN
    const fontUrl = 'https://github.com/google/fonts/raw/main/ofl/roboto/Roboto%5Bwdth%2Cwght%5D.ttf';
    // Alternative: use a more reliable CDN
    const fallbackFontUrl = 'https://cdn.jsdelivr.net/gh/ArtifexSoftware/urw-base35-fonts@master/fonts/NimbusSans-Regular.otf';
    
    let fontData: Uint8Array | null = null;
    
    try {
      const response = await fetch(fontUrl);
      if (response.ok) {
        fontData = new Uint8Array(await response.arrayBuffer());
      }
    } catch (e) {
      console.warn('Failed to fetch primary font, trying fallback:', e);
    }
    
    if (!fontData) {
      try {
        const response = await fetch(fallbackFontUrl);
        if (response.ok) {
          fontData = new Uint8Array(await response.arrayBuffer());
        }
      } catch (e) {
        console.warn('Failed to fetch fallback font:', e);
      }
    }
    
    if (fontData) {
      // Create fonts directory in FFmpeg virtual filesystem
      try {
        await ffmpegInstance.createDir('/fonts');
      } catch (e) {
        // Directory might already exist, ignore error
      }
      
      // Write font file to virtual filesystem
      await ffmpegInstance.writeFile(FFMPEG_FONT_PATH, fontData);
      isFontLoaded = true;
      console.log('Default font loaded successfully');
    } else {
      console.warn('Could not load any font, text overlays may not work');
    }
  } catch (error) {
    console.error('Error loading font:', error);
    // Don't throw - text overlays will fail gracefully
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
 * @param videoWidth - The video width in pixels
 * @param videoHeight - The video height in pixels
 * @param fontPath - Path to the font file in FFmpeg virtual filesystem (optional, uses default if not provided)
 * @returns FFmpeg drawtext filter string
 */
export function getTextFilterString(
  textOverlay: TextOverlay,
  videoWidth: number,
  videoHeight: number,
  fontPath: string = FFMPEG_FONT_PATH
): string {
  const escapedText = escapeTextForFFmpeg(textOverlay.text);
  const fontColor = hexToFFmpegColor(textOverlay.color);
  
  // Calculate position in pixels from percentage
  // x and y are percentages (0-100), convert to pixel positions
  const xPos = Math.round((textOverlay.x / 100) * videoWidth);
  const yPos = Math.round((textOverlay.y / 100) * videoHeight);
  
  // Build the drawtext filter
  // IMPORTANT: fontfile is REQUIRED for FFmpeg.wasm - it doesn't have built-in fonts
  const parts: string[] = [
    `fontfile=${fontPath}`,
    `text='${escapedText}'`,
    `fontsize=${textOverlay.fontSize}`,
    `fontcolor=${fontColor}`,
    `x=${xPos}`,
    `y=${yPos}`,
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
        const clipDuration = clip.duration - clip.trimStart - clip.trimEnd;
        const relevantTexts = textOverlays.filter(text => {
          const textEnd = text.startTime + text.duration;
          // Check if text overlaps with clip timeline (considering trim)
          return text.startTime < clipDuration && textEnd > 0;
        });
        
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
            videoFilterChain += ',' + textFilter;
          }
        }
      }
      
      const args = [
        '-i', inputFileName,
        '-ss', clip.trimStart.toString(),
        '-t', (clip.duration - clip.trimStart - clip.trimEnd).toString(),
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
    
    // Build transition map for clips that have transitions
    const transitionMap = new Map<string, Transition>();
    if (transitions && transitions.length > 0) {
      for (const transition of transitions) {
        if (transition.type !== 'none') {
          transitionMap.set(transition.clipId, transition);
        }
      }
    }
    
    // Apply transitions between clips using xfade
    // We need to chain xfade filters: [v0][v1]xfade...[vt0];[vt0][v2]xfade...[vt1];...
    let currentVideoLabel = 'v0';
    let transitionIndex = 0;
    let transitionOffset = clipDurations[0]; // First transition starts at end of first clip
    
    for (let i = 1; i < clips.length; i++) {
      const clip = clips[i];
      const clipId = clip.id;
      const transition = clipId ? transitionMap.get(clipId) : undefined;
      
      if (transition && transition.position === 'start') {
        // Apply xfade transition
        const transitionDuration = Math.min(transition.duration, clipDurations[i - 1], clipDurations[i]);
        const offset = transitionOffset - transitionDuration;
        
        const outputLabel = i === clips.length - 1 ? 'vmerged' : `vt${transitionIndex}`;
        const xfadeFilter = getTransitionFilter(transition, offset);
        
        if (xfadeFilter) {
          filterComplex.push(`[${currentVideoLabel}][v${i}]${xfadeFilter}[${outputLabel}]`);
          currentVideoLabel = outputLabel;
          transitionIndex++;
          // Adjust offset: transition overlaps, so next clip starts earlier
          transitionOffset = offset + clipDurations[i];
        } else {
          // No transition, just concatenate
          transitionOffset += clipDurations[i];
        }
      } else {
        // No transition for this clip, will be handled by concat
        transitionOffset += clipDurations[i];
      }
    }
    
    // If we used transitions, we need different concat logic
    const hasTransitions = transitionIndex > 0;
    
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

    // Concatenate all clips (video already merged if transitions were used)
    if (hasTransitions) {
      // Audio still needs to be concatenated
      const audioConcat = clips.map((_, i) => `[a${i}]`).join('');
      filterComplex.push(`${audioConcat}concat=n=${clips.length}:v=0:a=1[outa]`);
      // Video is already in vmerged or last vt label
      filterComplex.push(`[${currentVideoLabel}]copy[outv]`);
    } else {
      // Original concat for both video and audio
      const concatInputs = clips.map((_, i) => `[v${i}][a${i}]`).join('');
      filterComplex.push(`${concatInputs}concat=n=${clips.length}:v=1:a=1[outv][outa]`);
    }
    
    // Add text overlays to the final merged video
    if (textOverlays && textOverlays.length > 0 && textOverlays.some(t => t.text.trim())) {
      // Replace [outv] with text filters chain
      // Remove the last filter that outputs to [outv]
      const lastFilter = filterComplex.pop();
      
      if (hasTransitions) {
        // For transitions, we need to apply text to the merged video
        let textInputLabel = currentVideoLabel;
        let textOutputLabel = 'vtext0';
        
        const validTexts = textOverlays.filter(t => t.text.trim());
        for (let i = 0; i < validTexts.length; i++) {
          const text = validTexts[i];
          const textFilter = getTextFilterString(text, resolution.width, resolution.height);
          const isLast = i === validTexts.length - 1;
          textOutputLabel = isLast ? 'outv' : `vtext${i}`;
          
          filterComplex.push(`[${textInputLabel}]${textFilter}[${textOutputLabel}]`);
          textInputLabel = textOutputLabel;
        }
        
        // Re-add audio concat
        const audioConcat = clips.map((_, i) => `[a${i}]`).join('');
        filterComplex.push(`${audioConcat}concat=n=${clips.length}:v=0:a=1[outa]`);
      } else {
        // For non-transition case, chain text filters after concat
        // First, output concat to intermediate label
        const concatInputs = clips.map((_, i) => `[v${i}][a${i}]`).join('');
        filterComplex.push(`${concatInputs}concat=n=${clips.length}:v=1:a=1[vconcated][outa]`);
        
        let textInputLabel = 'vconcated';
        let textOutputLabel = 'vtext0';
        
        const validTexts = textOverlays.filter(t => t.text.trim());
        for (let i = 0; i < validTexts.length; i++) {
          const text = validTexts[i];
          const textFilter = getTextFilterString(text, resolution.width, resolution.height);
          const isLast = i === validTexts.length - 1;
          textOutputLabel = isLast ? 'outv' : `vtext${i}`;
          
          filterComplex.push(`[${textInputLabel}]${textFilter}[${textOutputLabel}]`);
          textInputLabel = textOutputLabel;
        }
      }
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
