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

// Helper function to build filter string from VideoFilter
const buildFilterString = (filter: VideoFilter): string => {
    const filters: string[] = [];
    if (filter.brightness !== 0) filters.push(`brightness(${100 + filter.brightness}%)`);
    if (filter.contrast !== 0) filters.push(`contrast(${100 + filter.contrast}%)`);
    if (filter.saturation !== 0) filters.push(`saturate(${100 + filter.saturation}%)`);
    if (filter.grayscale) filters.push('grayscale(100%)');
    if (filter.sepia) filters.push('sepia(100%)');
    if (filter.blur > 0) filters.push(`blur(${filter.blur}px)`);
    return filters.length > 0 ? filters.join(' ') : 'none';
};

const applyTransformTransition = (ctx: any, type: string, p: number, inv: number, width: number, height: number) => {
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
    }
};

const applySlideTransition = (ctx: any, type: string, inv: number, width: number, height: number, isEnd: boolean) => {
    switch (type) {
        case 'slide-left':
            ctx.translate(isEnd ? -inv * width : inv * width, 0);
            break;
        case 'slide-right':
            ctx.translate(isEnd ? inv * width : -inv * width, 0);
            break;
        case 'slide-up':
            ctx.translate(0, isEnd ? -inv * height : inv * height);
            break;
        case 'slide-down':
            ctx.translate(0, isEnd ? inv * height : -inv * height);
            break;
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
    }
};

const applyWipeTransition = (ctx: any, type: string, p: number, inv: number, width: number, height: number, isEnd: boolean) => {
    switch (type) {
        case 'wipe-left':
            ctx.beginPath();
            ctx.rect(0, 0, isEnd ? inv * width : p * width, height);
            ctx.clip();
            break;
        case 'wipe-right':
            ctx.beginPath();
            ctx.rect(isEnd ? inv * width : 0, 0, p * width, height);
            ctx.clip();
            break;
        case 'wipe-up':
            ctx.beginPath();
            ctx.rect(0, isEnd ? inv * height : 0, width, p * height);
            ctx.clip();
            break;
        case 'wipe-down':
            ctx.beginPath();
            ctx.rect(0, isEnd ? inv * height : 0, width, p * height);
            ctx.clip();
            break;
        case 'circle-wipe': {
            ctx.beginPath();
            const maxRadius = Math.sqrt(width * width + height * height) / 2;
            ctx.arc(width / 2, height / 2, p * maxRadius * 1.5, 0, Math.PI * 2);
            ctx.clip();
            break;
        }
        case 'diamond-wipe': {
            ctx.beginPath();
            const cx = width / 2;
            const cy = height / 2;
            const dx = p * width;
            const dy = p * height;
            ctx.moveTo(cx, cy - dy);
            ctx.lineTo(cx + dx, cy);
            ctx.lineTo(cx, cy + dy);
            ctx.lineTo(cx - dx, cy);
            ctx.closePath();
            ctx.clip();
            break;
        }
    }
};

// Helper function to apply transition effects
const applyTransition = (
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    transition: Transition,
    clipTime: number,
    clipDuration: number,
    width: number,
    height: number,
    isEnd: boolean
): void => {
    const p = isEnd 
        ? (clipDuration - clipTime) / transition.duration 
        : clipTime / transition.duration;
    const inv = 1 - p;
    const type = transition.type;

    if (['fade', 'dissolve', 'cross-dissolve', 'zoom-in', 'zoom-out', 'rotate-in', 'rotate-out'].includes(type)) {
        ctx.globalAlpha = p;
    }

    if (type.startsWith('zoom') || type.startsWith('rotate')) {
        applyTransformTransition(ctx, type, p, inv, width, height);
    } else if (type.startsWith('slide')) {
        applySlideTransition(ctx, type, inv, width, height, isEnd);
    } else if (type.includes('wipe')) {
        applyWipeTransition(ctx, type, p, inv, width, height, isEnd);
    }
};

// Helper function to render text overlays
const renderTextOverlays = (
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    activeTexts: TextOverlay[],
    width: number,
    height: number
): void => {
    ctx.filter = 'none';
    for (const text of activeTexts) {
        ctx.save();
        const x = (text.x / 100) * width;
        const y = (text.y / 100) * height;
        
        ctx.font = `${text.italic ? 'italic ' : ''}${text.bold ? 'bold ' : ''}${text.fontSize}px ${text.fontFamily}`;
        ctx.fillStyle = text.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        ctx.translate(x, y);
        if (text.scaleX || text.scaleY) {
            ctx.scale(text.scaleX || 1, text.scaleY || 1);
        }
        
        ctx.fillText(text.text, 0, 0);
        ctx.restore();
    }
};

// Helper function to check if a clip has effects
const hasClipEffects = (clip: any, width: number, height: number): { hasFilter: boolean; hasTransition: boolean; hasText: boolean; isSameResolution: boolean } => {
    const hasFilter = clip.filter && (
        clip.filter.brightness !== 0 || 
        clip.filter.contrast !== 0 || 
        clip.filter.saturation !== 0 || 
        clip.filter.grayscale || 
        clip.filter.sepia || 
        clip.filter.blur > 0
    );
    
    return {
        hasFilter,
        hasTransition: false,
        hasText: false,
        isSameResolution: true
    };
};
// Helper functions end

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

        return canvas.toDataURL('image/jpeg', 0.8);

    } catch (error) {
        console.error('Error generating thumbnail with MediaBunny:', error);
        throw error;
    } finally {
        URL.revokeObjectURL(url);
    }
}

const processGapFrames = async (
    gapDuration: number,
    fps: number,
    width: number,
    height: number,
    currentTimelineTime: number,
    frameDuration: number,
    videoSource: any,
    canvas: HTMLCanvasElement | OffscreenCanvas,
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
) => {
    console.log(`Filling gap of ${gapDuration.toFixed(3)}s with black frames`);
    const gapFrames = Math.ceil(gapDuration * fps);
    
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, width, height);
    const blackBitmap = await createImageBitmap(canvas as any);
    
    for (let j = 0; j < gapFrames; j++) {
        if (isExportCancelled) {
            blackBitmap.close();
            throw new Error('Export cancelled');
        }
        const timestamp = currentTimelineTime + (j * frameDuration);
        const frame = new VideoFrame(blackBitmap, { timestamp: timestamp * 1_000_000 });
        const sample = new VideoSample(frame);
        await videoSource.add(sample);
        sample.close();
    }
    
    blackBitmap.close();
};

const processAudioSamples = async (
    audioSink: AudioSampleSink | null,
    clip: any,
    audioConfig: any,
    audioSource: any
) => {
    if (!audioSink) return;

    for await (const sample of audioSink.samples()) {
        if (isExportCancelled) {
            sample.close();
            throw new Error('Export cancelled');
        }
        const timestamp = sample.timestamp;

        if (timestamp > (clip.duration - clip.trimEnd) + 0.1) {
            sample.close();
            break;
        }

        if (timestamp >= clip.trimStart && timestamp <= (clip.duration - clip.trimEnd)) {
            const relativeTimestamp = timestamp - clip.trimStart + clip.startTime;
            
            const sRate = (sample as any).sampleRate;
            const nChannels = (sample as any).numberOfChannels;
            
            if (sRate && nChannels && (sRate !== audioConfig.sampleRate || nChannels !== audioConfig.numberOfChannels)) {
                // Skip incompatible audio
            } else {
                sample.setTimestamp(relativeTimestamp);
                await audioSource.add(sample);
            }
        }
        sample.close();
    }
};

const calculateSampleProgress = (
    sample: any,
    clip: any,
    clipDuration: number,
    processedDuration: number,
    totalDuration: number
): { relativeTimestamp: number; totalProgress: number } => {
    const timestamp = sample.timestamp;
    const relativeTimestamp = timestamp - clip.trimStart + clip.startTime;
    
    const clipProcessedTime = timestamp - clip.trimStart;
    const clipProgress = clipProcessedTime / clipDuration;
    const totalProgress = 5 + ((processedDuration + (clipDuration * clipProgress)) / totalDuration) * 90;
    
    return { relativeTimestamp, totalProgress };
};

const updateProgressIfNeeded = (
    totalProgress: number,
    processedDuration: number,
    totalDuration: number,
    clipIndex: number,
    sortedClipsLength: number,
    onProgress: any
) => {
    const prevProgress = 5 + (processedDuration / totalDuration) * 90;
    if (Math.floor(totalProgress) > Math.floor(prevProgress)) {
        onProgress?.(Math.round(totalProgress), `Traitement du clip ${clipIndex + 1}/${sortedClipsLength}...`);
    }
};

const filterActiveTextOverlays = (
    textOverlays: any,
    relativeTimestamp: number
): TextOverlay[] => {
    if (!textOverlays) return [];
    return textOverlays.filter((t: any) => 
        relativeTimestamp >= t.startTime && 
        relativeTimestamp <= (t.startTime + t.duration)
    );
};

const checkClipEffectFlags = (
    sample: any,
    clip: any,
    width: number,
    height: number,
    startTransition: any,
    endTransition: any,
    activeTexts: TextOverlay[]
): { hasFilter: boolean; hasTransition: boolean; hasText: boolean; isSameResolution: boolean } => {
    const { hasFilter } = hasClipEffects(clip, width, height);
    const hasTransition = startTransition || endTransition;
    const hasText = activeTexts.length > 0;
    const isSameResolution = (sample as any).displayWidth === width && (sample as any).displayHeight === height;
    
    return { hasFilter, hasTransition, hasText, isSameResolution };
};

const addFrameDirectly = async (
    sample: any,
    relativeTimestamp: number,
    videoSource: any
) => {
    const frame = new VideoFrame(sample as any, { timestamp: relativeTimestamp * 1_000_000 });
    const newSample = new VideoSample(frame);
    await videoSource.add(newSample);
    newSample.close();
};

const prepareCanvasForEffects = (
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    startTransition: any,
    endTransition: any,
    clip: any
) => {
    ctx.filter = 'none';
    ctx.globalAlpha = 1.0;
    
    if (startTransition || endTransition) {
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    ctx.save();

    if (clip.filter) {
        ctx.filter = buildFilterString(clip.filter);
    }
};

const applyClipTransitions = (
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    sample: any,
    clip: any,
    clipDuration: number,
    startTransition: any,
    endTransition: any,
    width: number,
    height: number
) => {
    if (!startTransition && !endTransition) return;
    
    const timestamp = sample.timestamp;
    const clipTime = timestamp - clip.trimStart;
    
    let activeTransition: Transition | undefined;
    let isEnd = false;

    if (startTransition && clipTime < startTransition.duration) {
        activeTransition = startTransition;
        isEnd = false;
    } else if (endTransition && clipTime > (clipDuration - endTransition.duration)) {
        activeTransition = endTransition;
        isEnd = true;
    }
    
    if (activeTransition) {
        applyTransition(ctx, activeTransition, clipTime, clipDuration, width, height, isEnd);
    }
};

const drawSampleToCanvas = (
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    sample: any,
    width: number,
    height: number
) => {
    if (typeof (sample as any).draw === 'function') {
        (sample as any).draw(ctx, 0, 0, width, height);
    } else {
        ctx.drawImage(sample as any, 0, 0, width, height);
    }
};

const addProcessedFrame = async (
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    relativeTimestamp: number,
    canvas: HTMLCanvasElement | OffscreenCanvas,
    videoSource: any
) => {
    const frame = new VideoFrame(canvas as any, { timestamp: relativeTimestamp * 1_000_000 });
    const newSample = new VideoSample(frame);
    await videoSource.add(newSample);
    newSample.close();
};

const processSingleVideoSample = async (
    sample: any,
    clip: any,
    clipDuration: number,
    processedDuration: number,
    totalDuration: number,
    sortedClipsLength: number,
    clipIndex: number,
    onProgress: any,
    textOverlays: any,
    startTransition: any,
    endTransition: any,
    width: number,
    height: number,
    videoSource: any,
    canvas: HTMLCanvasElement | OffscreenCanvas,
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
) => {
    const { relativeTimestamp, totalProgress } = calculateSampleProgress(
        sample, clip, clipDuration, processedDuration, totalDuration
    );
    
    updateProgressIfNeeded(
        totalProgress, processedDuration, totalDuration,
        clipIndex, sortedClipsLength, onProgress
    );

    const activeTexts = filterActiveTextOverlays(textOverlays, relativeTimestamp);

    const { hasFilter, hasTransition, hasText, isSameResolution } = checkClipEffectFlags(
        sample, clip, width, height, startTransition, endTransition, activeTexts
    );

    if (!hasFilter && !hasTransition && !hasText && isSameResolution) {
        await addFrameDirectly(sample, relativeTimestamp, videoSource);
    } else {
        prepareCanvasForEffects(ctx, startTransition, endTransition, clip);
        
        applyClipTransitions(ctx, sample, clip, clipDuration, startTransition, endTransition, width, height);
        
        drawSampleToCanvas(ctx, sample, width, height);
        
        ctx.restore();

        if (hasText) {
            renderTextOverlays(ctx, activeTexts, width, height);
        }

        await addProcessedFrame(ctx, relativeTimestamp, canvas, videoSource);
    }
};

const processVideoSamples = async (
    videoSink: VideoSampleSink,
    clip: any,
    clipDuration: number,
    processedDuration: number,
    totalDuration: number,
    sortedClipsLength: number,
    clipIndex: number,
    onProgress: any,
    textOverlays: any,
    startTransition: any,
    endTransition: any,
    width: number,
    height: number,
    videoSource: any,
    canvas: HTMLCanvasElement | OffscreenCanvas,
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
) => {
    for await (const sample of videoSink.samples()) {
        if (isExportCancelled) {
            sample.close();
            throw new Error('Export cancelled');
        }

        const timestamp = sample.timestamp;

        if (timestamp > (clip.duration - clip.trimEnd) + 0.1) {
            sample.close();
            break;
        }
        
        if (timestamp >= clip.trimStart && timestamp <= (clip.duration - clip.trimEnd)) {
            await processSingleVideoSample(
                sample, clip, clipDuration, processedDuration, totalDuration,
                sortedClipsLength, clipIndex, onProgress, textOverlays,
                startTransition, endTransition, width, height, videoSource, canvas, ctx
            );
        }
        sample.close();
    }
};

const getAudioConfig = async (clips: any[], isWebM: boolean) => {
    let sampleRate = 48000;
    let numberOfChannels = 2;

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
            }
            URL.revokeObjectURL(url);
        } catch (e) {
            console.warn('Could not detect audio settings from first clip, using defaults', e);
        }
    }

    return {
        codec: isWebM ? 'opus' : 'aac',
        bitrate: 128_000,
        numberOfChannels: numberOfChannels,
        sampleRate: sampleRate
    } as any;
};

const getVideoConfig = (settings: ExportSettings, resolution: any, isWebM: boolean) => {
    let bitrate = 2_500_000;
    if (settings.resolution === '4K') bitrate = 8_000_000;
    else if (settings.resolution === '720p') bitrate = 1_500_000;
    
    if (settings.quality === 'high') bitrate *= 1.5;
    if (settings.quality === 'low') bitrate *= 0.7;

    return {
        codec: isWebM ? 'vp9' : 'avc',
        bitrate: Math.round(bitrate),
        width: resolution.width,
        height: resolution.height,
    } as any;
};

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
    onProgress?.(0, 'Initialisation de MediaBunny...');

    const effectiveAspectRatio = aspectRatio || settings.aspectRatio || '16:9';
    const resolution = getResolutionForAspectRatio(settings.resolution, effectiveAspectRatio);
    
    const isWebM = settings.format === 'webm';
    const outputFormat = isWebM ? new WebMOutputFormat() : new Mp4OutputFormat();
    const target = new BufferTarget();
    
    const output = new Output({
        format: outputFormat,
        target: target
    });

    const videoConfig = getVideoConfig(settings, resolution, isWebM);
    const videoSource = new VideoSampleSource(videoConfig);
    output.addVideoTrack(videoSource);

    const audioConfig = await getAudioConfig(clips, isWebM);
    const audioSource = new AudioSampleSource(audioConfig);
    output.addAudioTrack(audioSource);

    await output.start();
    onProgress?.(5, 'Export démarré...');

    let currentTimelineTime = 0;
    const totalDuration = clips.reduce((acc, clip) => acc + (clip.duration - clip.trimStart - clip.trimEnd), 0);
    let processedDuration = 0;

    const sortedClips = [...clips].sort((a, b) => a.startTime - b.startTime);

    const width = resolution.width;
    const height = resolution.height;
    const canvas = typeof OffscreenCanvas !== 'undefined' 
        ? new OffscreenCanvas(width, height) 
        : document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    
    if (!ctx) throw new Error('Could not create canvas context');

    const fps = Number.parseInt(settings.fps) || 30;
    const frameDuration = 1 / fps;

    // Extracted processClip function
    const processClip = async (
        clip: any,
        index: number,
        currentTimelineTime: number,
        processedDuration: number,
        totalDuration: number,
        totalClips: number,
        onProgress: any,
        textOverlays: any,
        transitions: any,
        audioConfig: any,
        width: number,
        height: number,
        fps: number,
        frameDuration: number,
        canvas: HTMLCanvasElement | OffscreenCanvas,
        ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
        videoSource: any,
        audioSource: any
    ) => {
        if (isExportCancelled) {
            throw new Error('Export cancelled');
        }

        const clipDuration = clip.duration - clip.trimStart - clip.trimEnd;
        
        if (clip.startTime > currentTimelineTime + 0.01) {
            const gapDuration = clip.startTime - currentTimelineTime;
            await processGapFrames(gapDuration, fps, width, height, currentTimelineTime, frameDuration, videoSource, canvas, ctx);
            currentTimelineTime = clip.startTime;
        }
        
        const currentProgress = 5 + (processedDuration / totalDuration) * 90;
        onProgress?.(Math.round(currentProgress), `Traitement du clip ${index + 1}/${totalClips}...`);
        
        const url = URL.createObjectURL(clip.file);
        try {
            const source = new UrlSource(url);
            const input = new Input({ source, formats: ALL_FORMATS });
            
            const videoTrack = await input.getPrimaryVideoTrack();
            const videoSink = new VideoSampleSink(videoTrack);
            
            let audioSink: AudioSampleSink | null = null;
            if (!clip.audioMuted) {
                try {
                    const audioTrack = await input.getPrimaryAudioTrack();
                    audioSink = new AudioSampleSink(audioTrack);
                } catch (e) {
                    console.warn('No audio track found for clip', clip.id);
                }
            }

            const clipTransitions = transitions?.filter(t => t.clipId === clip.id) || [];
            const startTransition = clipTransitions.find(t => t.position === 'start');
            const endTransition = clipTransitions.find(t => t.position === 'end');
                
            await processVideoSamples(
                videoSink,
                clip,
                clipDuration,
                processedDuration,
                totalDuration,
                totalClips,
                index,
                onProgress,
                textOverlays,
                startTransition,
                endTransition,
                width,
                height,
                videoSource,
                canvas,
                ctx
            );

            await processAudioSamples(audioSink, clip, audioConfig, audioSource);

        } catch (err) {
            if (isExportCancelled || (err instanceof Error && err.message === 'Export cancelled')) {
                throw err;
            }
            console.error(`Error processing clip ${index}:`, err);
            throw err; // Throw to trigger FFmpeg fallback
        } finally {
            URL.revokeObjectURL(url);
        }
    };

    for (let i = 0; i < sortedClips.length; i++) {
        await processClip(sortedClips[i], i, currentTimelineTime, processedDuration, totalDuration, sortedClips.length, onProgress, textOverlays, transitions, audioConfig, width, height, fps, frameDuration, canvas, ctx, videoSource, audioSource);
        
        const clip = sortedClips[i];
        const clipDuration = clip.duration - clip.trimStart - clip.trimEnd;
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
