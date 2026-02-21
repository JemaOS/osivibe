import { 
    Input, 
    Output, 
    UrlSource, 
    ALL_FORMATS, 
    VideoSampleSink, 
    AudioSampleSink,
    VideoSampleSource,
    AudioSampleSource,
    Mp4OutputFormat,
    WebMOutputFormat,
    BufferTarget,
    VideoSample,
    AudioSample
} from 'mediabunny';
import { ExportSettings, VideoFilter, TextOverlay, Transition, AspectRatio, getResolutionForAspectRatio } from '../types';

let isExportCancelled = false;

export function cancelMediaBunnyExport() {
    isExportCancelled = true;
}

export async function getVideoDuration(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  try {
    const source = new UrlSource(url);
    const input = new Input({
      source: source,
      formats: ALL_FORMATS,
    });

    const duration = await input.computeDuration();
    // MediaBunny returns duration in seconds (float)
    return duration; 
  } catch (error) {
    console.error('Error getting video duration with MediaBunny:', error);
    throw error;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function getAudioDuration(file: File): Promise<number> {
    const url = URL.createObjectURL(file);
    try {
        const source = new UrlSource(url);
        const input = new Input({
            source: source,
            formats: ALL_FORMATS,
        });
        return await input.computeDuration();
    } catch (error) {
        console.error('Error getting audio duration with MediaBunny:', error);
        throw error;
    } finally {
        URL.revokeObjectURL(url);
    }
}

export async function getMediaInfo(file: File) {
    const url = URL.createObjectURL(file);
    try {
        const source = new UrlSource(url);
        const input = new Input({
            source: source,
            formats: ALL_FORMATS,
        });

        const duration = await input.computeDuration();
        const videoTrack = await input.getPrimaryVideoTrack();
        const audioTrack = await input.getPrimaryAudioTrack();

        return {
            duration,
            videoTrack,
            audioTrack
        };
    } finally {
        URL.revokeObjectURL(url);
    }
}

export async function getVideoMetadata(file: File): Promise<{ duration: number; width: number; height: number }> {
    const url = URL.createObjectURL(file);
    try {
        const source = new UrlSource(url);
        const input = new Input({
            source: source,
            formats: ALL_FORMATS,
        });

        const duration = await input.computeDuration();
        const videoTrack = await input.getPrimaryVideoTrack();
        
        return {
            duration,
            width: videoTrack.displayWidth,
            height: videoTrack.displayHeight
        };
    } catch (error) {
        console.error('Error getting video metadata with MediaBunny:', error);
        throw error;
    } finally {
        URL.revokeObjectURL(url);
    }
}

export async function generateThumbnail(file: File, time: number = 0): Promise<string> {
    const url = URL.createObjectURL(file);
    try {
        const source = new UrlSource(url);
        const input = new Input({
            source: source,
            formats: ALL_FORMATS,
        });

        const videoTrack = await input.getPrimaryVideoTrack();
        const sink = new VideoSampleSink(videoTrack);
        
        // Ensure time is within duration
        const duration = await input.computeDuration();
        const sampleTime = Math.min(Math.max(0, time), duration);

        const frame = await sink.getSample(sampleTime);
        
        if (!frame) {
            throw new Error('Could not generate thumbnail frame');
        }

        // Convert VideoFrame to blob URL
        const canvas = document.createElement('canvas');
        canvas.width = frame.displayWidth;
        canvas.height = frame.displayHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get canvas context');
        
        // Use frame.draw() which handles rotation and drawing to context
        frame.draw(ctx, 0, 0, frame.displayWidth, frame.displayHeight);
        frame.close(); // Release the frame

        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) {
                    resolve(URL.createObjectURL(blob));
                } else {
                    reject(new Error('Could not create blob from canvas'));
                }
            }, 'image/jpeg');
        });

    } catch (error) {
        console.error('Error generating thumbnail with MediaBunny:', error);
        throw error;
    } finally {
        URL.revokeObjectURL(url);
    }
}

export async function exportProjectWithMediaBunny(
    clips: { file: File; startTime: number; duration: number; trimStart: number; trimEnd: number; filter?: VideoFilter; id?: string; audioMuted?: boolean }[],
    settings: ExportSettings,
    onProgress?: (progress: number, message: string) => void,
    textOverlays?: TextOverlay[],
    transitions?: Transition[],
    aspectRatio?: AspectRatio,
    hardwareProfile?: any,
    safeMode: boolean = false,
    audioClips?: { file: File; startTime: number; duration: number; trimStart: number; trimEnd: number; id?: string }[]
): Promise<Blob> {
    isExportCancelled = false;
    console.log('🚀 Starting export with MediaBunny...');
    onProgress?.(0, 'Initialisation de MediaBunny...');

    const effectiveAspectRatio = aspectRatio || settings.aspectRatio || '16:9';
    const resolution = getResolutionForAspectRatio(settings.resolution, effectiveAspectRatio);
    
    // Determine format
    const isWebM = settings.format === 'webm';
    const outputFormat = isWebM ? new WebMOutputFormat() : new Mp4OutputFormat();
    const target = new BufferTarget();
    
    const output = new Output({
        format: outputFormat,
        target: target
    });

    // Configure Video Encoder
    // Use a lower bitrate for faster encoding if speed is priority, or match source
    // For 20min video, 8Mbps is huge. Let's optimize based on resolution.
    let bitrate = 2_500_000; // Default 2.5Mbps for 1080p
    if (settings.resolution === '4K') bitrate = 8_000_000;
    else if (settings.resolution === '720p') bitrate = 1_500_000;
    
    // Adjust for quality setting
    if (settings.quality === 'high') bitrate *= 1.5;
    if (settings.quality === 'low') bitrate *= 0.7;

    const videoConfig = {
        codec: isWebM ? 'vp9' : 'avc', // 'avc' = H.264
        bitrate: Math.round(bitrate),
        width: resolution.width,
        height: resolution.height,
        // frameRate: 30, // Optional, but good for consistency
    } as any; // Cast to any to avoid strict type checking for now

    const videoSource = new VideoSampleSource(videoConfig);
    output.addVideoTrack(videoSource);

    // Configure Audio Encoder
    // Detect audio settings from the first clip with audio
    let sampleRate = 48000;
    let numberOfChannels = 2;

    // Try to get audio info from the first clip that isn't muted
    const firstAudioClip = clips.find(c => !c.audioMuted);
    if (firstAudioClip) {
        try {
            const url = URL.createObjectURL(firstAudioClip.file);
            const source = new UrlSource(url);
            const input = new Input({ source, formats: ALL_FORMATS });
            const audioTrack = await input.getPrimaryAudioTrack();
            
            if (audioTrack) {
                sampleRate = audioTrack.sampleRate || 48000;
                numberOfChannels = audioTrack.numberOfChannels || 2;
                console.log(`🎧 Detected audio settings: ${sampleRate}Hz, ${numberOfChannels}ch`);
            }
            URL.revokeObjectURL(url);
        } catch (e) {
            console.warn('Could not detect audio settings from first clip, using defaults', e);
        }
    }

    const audioConfig = {
        codec: isWebM ? 'opus' : 'aac',
        bitrate: 128_000,
        numberOfChannels: numberOfChannels,
        sampleRate: sampleRate
    } as any;

    const audioSource = new AudioSampleSource(audioConfig);
    output.addAudioTrack(audioSource);

    await output.start();
    onProgress?.(5, 'Export démarré...');

    // Process clips
    let currentTimelineTime = 0;
    const totalDuration = clips.reduce((acc, clip) => acc + (clip.duration - clip.trimStart - clip.trimEnd), 0);
    let processedDuration = 0;

    // Sort clips by startTime to ensure correct order (though they should be sorted)
    const sortedClips = [...clips].sort((a, b) => a.startTime - b.startTime);

    // Setup Canvas for processing (Filters, Text, Transitions)
    const width = resolution.width;
    const height = resolution.height;
    const canvas = typeof OffscreenCanvas !== 'undefined' 
        ? new OffscreenCanvas(width, height) 
        : document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    
    if (!ctx) throw new Error('Could not create canvas context');

    const fps = parseInt(settings.fps) || 30;
    const frameDuration = 1 / fps;

    for (let i = 0; i < sortedClips.length; i++) {
        if (isExportCancelled) {
            throw new Error('Export cancelled');
        }

        const clip = sortedClips[i];
        const clipDuration = clip.duration - clip.trimStart - clip.trimEnd;
        
        // 1. Handle Gaps (Black Frames)
        if (clip.startTime > currentTimelineTime + 0.01) { // 10ms tolerance
            const gapDuration = clip.startTime - currentTimelineTime;
            console.log(`Filling gap of ${gapDuration.toFixed(3)}s with black frames`);
            
            const gapFrames = Math.ceil(gapDuration * fps);
            
            // OPTIMIZATION: Create black frame source once
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, width, height);
            const blackBitmap = await createImageBitmap(canvas);
            
            for (let j = 0; j < gapFrames; j++) {
                if (isExportCancelled) {
                    blackBitmap.close();
                    throw new Error('Export cancelled');
                }
                const timestamp = currentTimelineTime + (j * frameDuration);
                // Create frame from bitmap (fast)
                const frame = new VideoFrame(blackBitmap, { timestamp: timestamp * 1_000_000 });
                const sample = new VideoSample(frame);
                await videoSource.add(sample);
                sample.close();
            }
            
            blackBitmap.close(); // Cleanup
            currentTimelineTime = clip.startTime;
        }
        
        const currentProgress = 5 + (processedDuration / totalDuration) * 90;
        onProgress?.(Math.round(currentProgress), `Traitement du clip ${i + 1}/${sortedClips.length}...`);
        
        const url = URL.createObjectURL(clip.file);
        try {
            const source = new UrlSource(url);
            const input = new Input({ source, formats: ALL_FORMATS });
            
            // Video
            const videoTrack = await input.getPrimaryVideoTrack();
            const videoSink = new VideoSampleSink(videoTrack);
            
            // Audio (if not muted)
            let audioSink: AudioSampleSink | null = null;
            if (!clip.audioMuted) {
                try {
                    const audioTrack = await input.getPrimaryAudioTrack();
                    audioSink = new AudioSampleSink(audioTrack);
                } catch (e) {
                    console.warn('No audio track found for clip', clip.id);
                }
            }

            // Find transitions for this clip
            const clipTransitions = transitions?.filter(t => t.clipId === clip.id) || [];
            const startTransition = clipTransitions.find(t => t.position === 'start');
            const endTransition = clipTransitions.find(t => t.position === 'end');
                
            // Process Video Samples
            let clipProcessedTime = 0;
            for await (const sample of videoSink.samples()) {
                if (isExportCancelled) {
                    sample.close();
                    throw new Error('Export cancelled');
                }

                const timestamp = sample.timestamp; // in seconds

                // OPTIMIZATION: Stop processing if we passed the trim end
                // Add a small buffer (0.1s) to ensure we don't miss the last frame due to precision
                if (timestamp > (clip.duration - clip.trimEnd) + 0.1) {
                    sample.close();
                    break;
                }
                
                // Check if sample is within trim range
                
                // Check if sample is within trim range
                if (timestamp >= clip.trimStart && timestamp <= (clip.duration - clip.trimEnd)) {
                    // Calculate new timestamp relative to timeline
                    const relativeTimestamp = timestamp - clip.trimStart + clip.startTime;
                    
                    // Update progress more frequently (every frame)
                    clipProcessedTime = timestamp - clip.trimStart;
                    const clipProgress = clipProcessedTime / clipDuration;
                    const totalProgress = 5 + ((processedDuration + (clipDuration * clipProgress)) / totalDuration) * 90;
                    
                    // Only update UI every 1% change to avoid flooding
                    if (Math.floor(totalProgress) > Math.floor(5 + (processedDuration / totalDuration) * 90)) {
                         onProgress?.(Math.round(totalProgress), `Traitement du clip ${i + 1}/${sortedClips.length}...`);
                    }

                    // Check for active text overlays
                    const activeTexts = textOverlays ? textOverlays.filter(t => 
                        relativeTimestamp >= t.startTime && 
                        relativeTimestamp <= (t.startTime + t.duration)
                    ) : [];

                    // OPTIMIZATION: Fast Path (Pass-through)
                    // If no effects, no transitions, no text, and resolution matches -> Skip Canvas
                    const hasFilter = clip.filter && (
                        clip.filter.brightness !== 0 || 
                        clip.filter.contrast !== 0 || 
                        clip.filter.saturation !== 0 || 
                        clip.filter.grayscale || 
                        clip.filter.sepia || 
                        clip.filter.blur > 0
                    );
                    
                    const hasTransition = startTransition || endTransition;
                    const hasText = activeTexts.length > 0;
                    const isSameResolution = (sample as any).displayWidth === width && (sample as any).displayHeight === height;

                    if (!hasFilter && !hasTransition && !hasText && isSameResolution) {
                        // FAST PATH: Zero-copy frame creation
                        const frame = new VideoFrame(sample as any, { timestamp: relativeTimestamp * 1_000_000 });
                        const newSample = new VideoSample(frame);
                        await videoSource.add(newSample);
                        newSample.close();
                    } else {
                        // SLOW PATH: Canvas rendering
                        
                        // Reset filter
                        ctx.filter = 'none';
                        ctx.globalAlpha = 1.0;
                        
                        // Clear canvas with black before drawing (important for transitions that reveal background)
                        if (startTransition || endTransition) {
                            ctx.fillStyle = 'black';
                            ctx.fillRect(0, 0, width, height);
                        }
    
                        ctx.save();
    
                        // Apply Clip Filter
                        if (clip.filter) {
                            const f = clip.filter;
                            const filters: string[] = [];
                            if (f.brightness !== 0) filters.push(`brightness(${100 + f.brightness}%)`);
                            if (f.contrast !== 0) filters.push(`contrast(${100 + f.contrast}%)`);
                            if (f.saturation !== 0) filters.push(`saturate(${100 + f.saturation}%)`);
                            if (f.grayscale) filters.push('grayscale(100%)');
                            if (f.sepia) filters.push('sepia(100%)');
                            if (f.blur > 0) filters.push(`blur(${f.blur}px)`);
                            if (filters.length > 0) ctx.filter = filters.join(' ');
                        }
    
                        // Apply Transitions
                        if (startTransition || endTransition) {
                            const clipTime = timestamp - clip.trimStart; // Time into the trimmed clip
                            const clipDuration = clip.duration - clip.trimStart - clip.trimEnd;
                            
                            let p = 1; // Visibility (0 to 1)
                            let activeTransition: Transition | undefined;
                            let isEnd = false;
    
                            if (startTransition && clipTime < startTransition.duration) {
                                activeTransition = startTransition;
                                p = clipTime / startTransition.duration; // 0 -> 1
                                isEnd = false;
                            } else if (endTransition && clipTime > (clipDuration - endTransition.duration)) {
                                activeTransition = endTransition;
                                p = (clipDuration - clipTime) / endTransition.duration; // 1 -> 0
                                isEnd = true;
                            }
                            
                            if (activeTransition) {
                                const inv = 1 - p;
                                const type = activeTransition.type;
    
                                // Opacity for fade-like transitions
                                if (['fade', 'dissolve', 'cross-dissolve', 'zoom-in', 'zoom-out', 'rotate-in', 'rotate-out'].includes(type)) {
                                    ctx.globalAlpha = p;
                                }
    
                                switch (type) {
                                    case 'zoom-in':
                                        ctx.translate(width / 2, height / 2);
                                        ctx.scale(p, p);
                                        ctx.translate(-width / 2, -height / 2);
                                        break;
                                    case 'zoom-out': {
                                        const s = 1.5 - p * 0.5;
                                        ctx.translate(width / 2, height / 2);
                                        ctx.scale(s, s);
                                        ctx.translate(-width / 2, -height / 2);
                                        break;
                                    }
                                    case 'rotate-in':
                                        ctx.translate(width / 2, height / 2);
                                        ctx.rotate(inv * -Math.PI);
                                        ctx.scale(p, p);
                                        ctx.translate(-width / 2, -height / 2);
                                        break;
                                    case 'rotate-out':
                                        ctx.translate(width / 2, height / 2);
                                        ctx.rotate(inv * Math.PI);
                                        ctx.scale(p, p);
                                        ctx.translate(-width / 2, -height / 2);
                                        break;
                                    case 'slide-left': {
                                        const txLeft = isEnd ? -inv * width : inv * width;
                                        ctx.translate(txLeft, 0);
                                        break;
                                    }
                                    case 'slide-right': {
                                        const txRight = isEnd ? inv * width : -inv * width;
                                        ctx.translate(txRight, 0);
                                        break;
                                    }
                                    case 'slide-up': {
                                        const tyUp = isEnd ? -inv * height : inv * height;
                                        ctx.translate(0, tyUp);
                                        break;
                                    }
                                    case 'slide-down': {
                                        const tyDown = isEnd ? inv * height : -inv * height;
                                        ctx.translate(0, tyDown);
                                        break;
                                    }
                                    case 'slide-diagonal-tl': {
                                        const tDiaTL = isEnd ? -inv : inv;
                                        ctx.translate(tDiaTL * width, tDiaTL * height);
                                        break;
                                    }
                                    case 'slide-diagonal-tr': {
                                        const tDiaTRX = isEnd ? inv : -inv;
                                        const tDiaTRY = isEnd ? -inv : inv;
                                        ctx.translate(tDiaTRX * width, tDiaTRY * height);
                                        break;
                                    }
                                    case 'wipe-left':
                                        ctx.beginPath();
                                        if (isEnd) {
                                            ctx.rect(0, 0, p * width, height);
                                        } else {
                                            ctx.rect(inv * width, 0, p * width, height);
                                        }
                                        ctx.clip();
                                        break;
                                    case 'wipe-right':
                                        ctx.beginPath();
                                        if (isEnd) {
                                            ctx.rect(inv * width, 0, p * width, height);
                                        } else {
                                            ctx.rect(0, 0, p * width, height);
                                        }
                                        ctx.clip();
                                        break;
                                    case 'wipe-up':
                                        ctx.beginPath();
                                        if (isEnd) {
                                            ctx.rect(0, 0, width, p * height);
                                        } else {
                                            ctx.rect(0, inv * height, width, p * height);
                                        }
                                        ctx.clip();
                                        break;
                                    case 'wipe-down':
                                        ctx.beginPath();
                                        if (isEnd) {
                                            ctx.rect(0, inv * height, width, p * height);
                                        } else {
                                            ctx.rect(0, 0, width, p * height);
                                        }
                                        ctx.clip();
                                        break;
                                    case 'circle-wipe': {
                                        ctx.beginPath();
                                        const maxRadius = Math.sqrt(width*width + height*height) / 2;
                                        ctx.arc(width/2, height/2, p * maxRadius * 1.5, 0, Math.PI * 2);
                                        ctx.clip();
                                        break;
                                    }
                                    case 'diamond-wipe': {
                                        ctx.beginPath();
                                        const cx = width / 2;
                                        const cy = height / 2;
                                        const dx = p * width; 
                                        const dy = p * height;
                                        ctx.moveTo(cx, cy - dy); // Top
                                        ctx.lineTo(cx + dx, cy); // Right
                                        ctx.lineTo(cx, cy + dy); // Bottom
                                        ctx.lineTo(cx - dx, cy); // Left
                                        ctx.closePath();
                                        ctx.clip();
                                        break;
                                    }
                                }
                            }
                        }
    
                        // Draw the frame
                        if (typeof (sample as any).draw === 'function') {
                            (sample as any).draw(ctx, 0, 0, width, height);
                        } else {
                            ctx.drawImage(sample as any, 0, 0, width, height);
                        }
                        
                        ctx.restore();
    
                        // Apply Text Overlays
                        if (hasText) {
                            ctx.filter = 'none'; // Reset filter for text
                            for (const text of activeTexts) {
                                ctx.save();
                                const x = (text.x / 100) * width;
                                const y = (text.y / 100) * height;
                                
                                ctx.font = `${text.italic ? 'italic ' : ''}${text.bold ? 'bold ' : ''}${text.fontSize}px ${text.fontFamily}`;
                                ctx.fillStyle = text.color;
                                ctx.textAlign = 'center';
                                ctx.textBaseline = 'middle';
                                
                                // Handle rotation/scale if needed (simplified for now)
                                ctx.translate(x, y);
                                if (text.scaleX || text.scaleY) {
                                    ctx.scale(text.scaleX || 1, text.scaleY || 1);
                                }
                                
                                ctx.fillText(text.text, 0, 0);
                                ctx.restore();
                            }
                        }
    
                        // Create new VideoFrame from canvas
                        const frame = new VideoFrame(canvas as any, { timestamp: relativeTimestamp * 1_000_000 });
                        // Wrap in VideoSample as expected by MediaBunny
                        const newSample = new VideoSample(frame);
                        await videoSource.add(newSample);
                        newSample.close();
                    }
                }
                sample.close();
            }

            // Process Audio Samples
            if (audioSink) {
                for await (const sample of audioSink.samples()) {
                    if (isExportCancelled) {
                        sample.close();
                        throw new Error('Export cancelled');
                    }
                    const timestamp = sample.timestamp;

                    // OPTIMIZATION: Stop processing if we passed the trim end
                    if (timestamp > (clip.duration - clip.trimEnd) + 0.1) {
                        sample.close();
                        break;
                    }

                    if (timestamp >= clip.trimStart && timestamp <= (clip.duration - clip.trimEnd)) {
                        const relativeTimestamp = timestamp - clip.trimStart + clip.startTime;
                        
                        // Check if sample matches encoder config
                        // Note: AudioSample in MediaBunny wraps AudioData. 
                        // We access the underlying AudioData properties if available, or the wrapper's.
                        // If properties are missing, we assume it's okay (risky but better than crashing if props are just hidden)
                        
                        const sRate = (sample as any).sampleRate;
                        const nChannels = (sample as any).numberOfChannels;
                        
                        if (sRate && nChannels && (sRate !== audioConfig.sampleRate || nChannels !== audioConfig.numberOfChannels)) {
                            // Skip incompatible audio to prevent encoder crash
                            // console.warn('Skipping incompatible audio sample');
                        } else {
                            sample.setTimestamp(relativeTimestamp);
                            await audioSource.add(sample);
                        }
                    }
                    sample.close();
                }
            }

        } catch (err) {
            if (isExportCancelled || (err instanceof Error && err.message === 'Export cancelled')) {
                throw err;
            }
            console.error(`Error processing clip ${i}:`, err);
        } finally {
            URL.revokeObjectURL(url);
        }
        
        processedDuration += clipDuration;
        currentTimelineTime = Math.max(currentTimelineTime, clip.startTime + clipDuration);
    }

    if (isExportCancelled) {
        throw new Error('Export cancelled');
    }

    onProgress?.(95, 'Finalisation...');
    await output.finalize();
    
    if (target.buffer) {
        return new Blob([target.buffer], { type: isWebM ? 'video/webm' : 'video/mp4' });
    } else {
        throw new Error('Export failed: No buffer generated');
    }
}
