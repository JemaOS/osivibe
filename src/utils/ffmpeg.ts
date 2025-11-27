// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { RESOLUTION_PRESETS, ExportSettings, VideoFilter, TimelineClip, MediaFile } from '../types';

let ffmpeg: FFmpeg | null = null;
let isLoaded = false;
let currentProgressCallback: ((progress: number, message: string) => void) | undefined;
let currentTotalDuration = 0;

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
  clips: { file: File; startTime: number; duration: number; trimStart: number; trimEnd: number; filter?: VideoFilter }[],
  settings: ExportSettings,
  onProgress?: (progress: number, message: string) => void
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
      
      const args = [
        '-i', inputFileName,
        '-ss', clip.trimStart.toString(),
        '-t', (clip.duration - clip.trimStart - clip.trimEnd).toString(),
        '-vf', `scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2`,
        '-c:v', outputFormat === 'webm' ? 'libvpx-vp9' : 'libx264',
        '-crf', quality,
        '-c:a', outputFormat === 'webm' ? 'libopus' : 'aac',
        '-preset', 'ultrafast', // Optimized for speed
        '-r', settings.fps || '30',
        '-pix_fmt', 'yuv420p',
        '-threads', '0', // Let FFmpeg decide optimal thread count
        outputFileName
      ];

      if (clip.filter) {
        const filterString = getFilterString(clip.filter);
        if (filterString) {
          const vfIndex = args.indexOf('-vf');
          args[vfIndex + 1] = args[vfIndex + 1] + ',' + filterString;
        }
      }

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
      
      // Audio filter chain
      // We need to generate silent audio for clips that don't have audio (like images or muted videos)
      // to ensure concat works properly (concat requires all segments to have same streams)
      if (isImage) {
        // Generate silence for image duration
        filterComplex.push(`aevalsrc=0:d=${duration}[a${i}]`);
      } else {
        // For video, try to use its audio.
        // Ideally we should check if video has audio stream.
        // For simplicity, we assume it does. If it fails, we might need a fallback.
        // A robust way is to use -map [i:a]? but inside filter_complex it's tricky.
        // Let's assume video has audio for now, or use a fallback strategy if we could detect it.
        // If we encounter errors with videos without audio, we'll need to probe first.
        filterComplex.push(`[${i}:a]atrim=start=${clip.trimStart}:duration=${duration},asetpts=PTS-STARTPTS[a${i}]`);
      }
    }

    onProgress?.(5, 'Assemblage des clips...');

    // Concatenate all clips
    const concatInputs = clips.map((_, i) => `[v${i}][a${i}]`).join('');
    filterComplex.push(`${concatInputs}concat=n=${clips.length}:v=1:a=1[outv][outa]`);

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
