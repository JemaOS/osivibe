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
import { ExportSettings, VideoFilter, TextOverlay, Transition, AspectRatio, getResolutionForAspectRatio, CropSettings, TransformSettings } from '../types';

let isExportCancelled = false;

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
        case 'zoom-in': ctx.translate(width/2,height/2); ctx.scale(p,p); ctx.translate(-width/2,-height/2); break;
        case 'zoom-out': { const s=1.5-p*0.5; ctx.translate(width/2,height/2); ctx.scale(s,s); ctx.translate(-width/2,-height/2); break; }
        case 'rotate-in': ctx.translate(width/2,height/2); ctx.rotate(inv*-Math.PI); ctx.scale(p,p); ctx.translate(-width/2,-height/2); break;
        case 'rotate-out': ctx.translate(width/2,height/2); ctx.rotate(inv*Math.PI); ctx.scale(p,p); ctx.translate(-width/2,-height/2); break;
    }
};

const applySlideTransition = (ctx: any, type: string, inv: number, width: number, height: number, isEnd: boolean) => {
    switch (type) {
        case 'slide-left': ctx.translate(isEnd ? -inv*width : inv*width, 0); break;
        case 'slide-right': ctx.translate(isEnd ? inv*width : -inv*width, 0); break;
        case 'slide-up': ctx.translate(0, isEnd ? -inv*height : inv*height); break;
        case 'slide-down': ctx.translate(0, isEnd ? inv*height : -inv*height); break;
        case 'slide-diagonal-tl': { const t=isEnd?-inv:inv; ctx.translate(t*width,t*height); break; }
        case 'slide-diagonal-tr': { ctx.translate((isEnd?inv:-inv)*width,(isEnd?-inv:inv)*height); break; }
    }
};

const applyWipeTransition = (ctx: any, type: string, p: number, inv: number, width: number, height: number, isEnd: boolean) => {
    switch (type) {
        case 'wipe-left': ctx.beginPath(); ctx.rect(0,0,isEnd?inv*width:p*width,height); ctx.clip(); break;
        case 'wipe-right': ctx.beginPath(); ctx.rect(isEnd?inv*width:0,0,p*width,height); ctx.clip(); break;
        case 'wipe-up': ctx.beginPath(); ctx.rect(0,isEnd?inv*height:0,width,p*height); ctx.clip(); break;
        case 'wipe-down': ctx.beginPath(); ctx.rect(0,isEnd?inv*height:0,width,p*height); ctx.clip(); break;
        case 'circle-wipe': { ctx.beginPath(); const r=Math.sqrt(width*width+height*height)/2; ctx.arc(width/2,height/2,p*r*1.5,0,Math.PI*2); ctx.clip(); break; }
        case 'diamond-wipe': { ctx.beginPath(); const cx=width/2,cy=height/2,dx=p*width,dy=p*height; ctx.moveTo(cx,cy-dy); ctx.lineTo(cx+dx,cy); ctx.lineTo(cx,cy+dy); ctx.lineTo(cx-dx,cy); ctx.closePath(); ctx.clip(); break; }
    }
};

const applyTransition = (ctx: CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D, transition: Transition, clipTime: number, clipDuration: number, width: number, height: number, isEnd: boolean): void => {
    const p = isEnd ? (clipDuration-clipTime)/transition.duration : clipTime/transition.duration;
    const inv = 1-p;
    const type = transition.type;
    if (['fade','dissolve','cross-dissolve','zoom-in','zoom-out','rotate-in','rotate-out'].includes(type)) ctx.globalAlpha = p;
    if (type.startsWith('zoom')||type.startsWith('rotate')) applyTransformTransition(ctx,type,p,inv,width,height);
    else if (type.startsWith('slide')) applySlideTransition(ctx,type,inv,width,height,isEnd);
    else if (type.includes('wipe')) applyWipeTransition(ctx,type,p,inv,width,height,isEnd);
};

const renderTextOverlays = (ctx: CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D, activeTexts: TextOverlay[], width: number, height: number): void => {
    ctx.filter = 'none';
    for (const text of activeTexts) {
        ctx.save();
        const x = (text.x/100)*width, y = (text.y/100)*height;
        ctx.font = `${text.italic?'italic ':''}${text.bold?'bold ':''}${text.fontSize}px ${text.fontFamily}`;
        ctx.fillStyle = text.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.translate(x, y);
        if (text.scaleX||text.scaleY) ctx.scale(text.scaleX||1, text.scaleY||1);
        if (text.backgroundColor) {
            const metrics = ctx.measureText(text.text);
            const tw=metrics.width, th=text.fontSize, px=8, py=4, bx=-tw/2-px, by=-th/2-py, bw=tw+px*2, bh=th+py*2, r=4;
            ctx.fillStyle = text.backgroundColor;
            ctx.beginPath(); ctx.moveTo(bx+r,by); ctx.lineTo(bx+bw-r,by); ctx.quadraticCurveTo(bx+bw,by,bx+bw,by+r);
            ctx.lineTo(bx+bw,by+bh-r); ctx.quadraticCurveTo(bx+bw,by+bh,bx+bw-r,by+bh);
            ctx.lineTo(bx+r,by+bh); ctx.quadraticCurveTo(bx,by+bh,bx,by+bh-r);
            ctx.lineTo(bx,by+r); ctx.quadraticCurveTo(bx,by,bx+r,by); ctx.closePath(); ctx.fill();
            ctx.fillStyle = text.color;
        }
        ctx.fillText(text.text, 0, 0);
        ctx.restore();
    }
};

const hasClipEffects = (clip: any, _width: number, _height: number) => {
    const hasFilter = clip.filter && (clip.filter.brightness!==0||clip.filter.contrast!==0||clip.filter.saturation!==0||clip.filter.grayscale||clip.filter.sepia||clip.filter.blur>0);
    const hasCrop = !!(clip.crop && clip.crop.width < 100 && clip.crop.height < 100);
    const hasTransform = !!(clip.transform && (clip.transform.rotation !== 0 || clip.transform.scale !== 100 || (clip.transform.scaleX !== undefined && clip.transform.scaleX !== 100) || (clip.transform.scaleY !== undefined && clip.transform.scaleY !== 100) || clip.transform.x !== 50 || clip.transform.y !== 50));
    return { hasFilter, hasCrop, hasTransform, hasTransition: false, hasText: false, isSameResolution: true };
};

export function cancelMediaBunnyExport() { isExportCancelled = true; }

export async function getVideoDuration(file: File): Promise<number> {
    const url = URL.createObjectURL(file);
    try { const s=new UrlSource(url); const i=new Input({source:s,formats:ALL_FORMATS}); return await i.computeDuration(); }
    catch(e) { console.error('Error getting video duration with MediaBunny:',e); throw e; }
    finally { URL.revokeObjectURL(url); }
}

export async function getAudioDuration(file: File): Promise<number> {
    const url = URL.createObjectURL(file);
    try { const s=new UrlSource(url); const i=new Input({source:s,formats:ALL_FORMATS}); return await i.computeDuration(); }
    catch(e) { console.error('Error getting audio duration with MediaBunny:',e); throw e; }
    finally { URL.revokeObjectURL(url); }
}

export async function getMediaInfo(file: File) {
    const url = URL.createObjectURL(file);
    try {
        const s=new UrlSource(url); const i=new Input({source:s,formats:ALL_FORMATS});
        const duration=await i.computeDuration(); const videoTrack=await i.getPrimaryVideoTrack(); const audioTrack=await i.getPrimaryAudioTrack();
        return { duration, videoTrack, audioTrack };
    } finally { URL.revokeObjectURL(url); }
}

export async function getVideoMetadata(file: File): Promise<{duration:number;width:number;height:number}> {
    const url = URL.createObjectURL(file);
    try {
        const s=new UrlSource(url); const i=new Input({source:s,formats:ALL_FORMATS});
        const duration=await i.computeDuration(); const vt=await i.getPrimaryVideoTrack();
        return { duration, width: vt.displayWidth, height: vt.displayHeight };
    } catch(e) { console.error('Error getting video metadata with MediaBunny:',e); throw e; }
    finally { URL.revokeObjectURL(url); }
}

export async function generateThumbnail(file: File, time: number = 0): Promise<string> {
    const url = URL.createObjectURL(file);
    try {
        const s=new UrlSource(url); const i=new Input({source:s,formats:ALL_FORMATS});
        const vt=await i.getPrimaryVideoTrack(); const sink=new VideoSampleSink(vt);
        const dur=await i.computeDuration(); const st=Math.min(Math.max(0,time),dur);
        const frame=await sink.getSample(st);
        if (!frame) throw new Error('Could not generate thumbnail frame');
        const canvas=document.createElement('canvas'); canvas.width=frame.displayWidth; canvas.height=frame.displayHeight;
        const ctx=canvas.getContext('2d'); if(!ctx) throw new Error('Could not get canvas context');
        frame.draw(ctx,0,0,frame.displayWidth,frame.displayHeight); frame.close();
        return canvas.toDataURL('image/jpeg',0.8);
    } catch(e) { console.error('Error generating thumbnail with MediaBunny:',e); throw e; }
    finally { URL.revokeObjectURL(url); }
}

const processGapFrames = async (gapDuration: number, fps: number, width: number, height: number, currentTimelineTime: number, frameDuration: number, videoSource: any, canvas: HTMLCanvasElement|OffscreenCanvas, ctx: CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D) => {
    const gapFrames = Math.ceil(gapDuration*fps);
    ctx.fillStyle='black'; ctx.fillRect(0,0,width,height);
    const bm = await createImageBitmap(canvas as any);
    for (let j=0; j<gapFrames; j++) {
        if (isExportCancelled) { bm.close(); throw new Error('Export cancelled'); }
        const ts=currentTimelineTime+(j*frameDuration);
        const f=new VideoFrame(bm,{timestamp:ts*1_000_000}); const s=new VideoSample(f); await videoSource.add(s); s.close();
    }
    bm.close();
};

const processAudioSamples = async (audioSink: AudioSampleSink|null, clip: any, audioConfig: any, audioSource: any) => {
    if (!audioSink) return;
    for await (const sample of audioSink.samples()) {
        if (isExportCancelled) { sample.close(); throw new Error('Export cancelled'); }
        const ts = sample.timestamp;
        if (ts > (clip.duration-clip.trimEnd)+0.1) { sample.close(); break; }
        if (ts >= clip.trimStart && ts <= (clip.duration-clip.trimEnd)) {
            const rel = ts-clip.trimStart+clip.startTime;
            const sr=(sample as any).sampleRate, nc=(sample as any).numberOfChannels;
            if (sr&&nc&&(sr!==audioConfig.sampleRate||nc!==audioConfig.numberOfChannels)) { /* skip */ }
            else { sample.setTimestamp(rel); await audioSource.add(sample); }
        }
        sample.close();
    }
};

/** Scale audio sample data by a volume factor. */
const scaleAudioSampleVolume = (sample: any, volume: number): any => {
    if (volume === 1) return null;
    const fmt: string = sample.format, nCh: number = sample.numberOfChannels, sr: number = sample.sampleRate;
    const nFr: number = sample.numberOfFrames, ts: number = sample.timestamp;
    const isF = fmt.startsWith('f32'), i16 = fmt.startsWith('s16'), i32 = fmt.startsWith('s32'), iU8 = fmt.startsWith('u8');
    const isP = fmt.endsWith('-planar'), tot = nFr * nCh;
    const copyPlane = (ch: number) => { const ps=sample.allocationSize({planeIndex:ch,format:fmt}); const pb=new ArrayBuffer(ps); sample.copyTo(pb,{planeIndex:ch,format:fmt}); return pb; };
    const copyInterleaved = (sz: number) => { const sb=new ArrayBuffer(sz); sample.copyTo(sb,{planeIndex:0,format:fmt}); return sb; };
    if (isF) {
        const bs=tot*4, buf=new ArrayBuffer(bs);
        if (isP) { for(let c=0;c<nCh;c++){const s=new Float32Array(copyPlane(c)),d=new Float32Array(buf,c*nFr*4,nFr);for(let i=0;i<s.length;i++)d[i]=Math.max(-1,Math.min(1,s[i]*volume));} }
        else { const s=new Float32Array(copyInterleaved(bs)),d=new Float32Array(buf);for(let i=0;i<s.length;i++)d[i]=Math.max(-1,Math.min(1,s[i]*volume)); }
        return new AudioSample({data:buf,format:fmt,numberOfChannels:nCh,sampleRate:sr,timestamp:ts});
    } else if (i16) {
        const bs=tot*2, buf=new ArrayBuffer(bs);
        if (isP) { for(let c=0;c<nCh;c++){const s=new Int16Array(copyPlane(c)),d=new Int16Array(buf,c*nFr*2,nFr);for(let i=0;i<s.length;i++)d[i]=Math.max(-32768,Math.min(32767,Math.round(s[i]*volume)));} }
        else { const s=new Int16Array(copyInterleaved(bs)),d=new Int16Array(buf);for(let i=0;i<s.length;i++)d[i]=Math.max(-32768,Math.min(32767,Math.round(s[i]*volume))); }
        return new AudioSample({data:buf,format:fmt,numberOfChannels:nCh,sampleRate:sr,timestamp:ts});
    } else if (i32) {
        const bs=tot*4, buf=new ArrayBuffer(bs);
        if (isP) { for(let c=0;c<nCh;c++){const s=new Int32Array(copyPlane(c)),d=new Int32Array(buf,c*nFr*4,nFr);for(let i=0;i<s.length;i++)d[i]=Math.max(-2147483648,Math.min(2147483647,Math.round(s[i]*volume)));} }
        else { const s=new Int32Array(copyInterleaved(bs)),d=new Int32Array(buf);for(let i=0;i<s.length;i++)d[i]=Math.max(-2147483648,Math.min(2147483647,Math.round(s[i]*volume))); }
        return new AudioSample({data:buf,format:fmt,numberOfChannels:nCh,sampleRate:sr,timestamp:ts});
    } else if (iU8) {
        const bs=tot, buf=new ArrayBuffer(bs);
        if (isP) { for(let c=0;c<nCh;c++){const s=new Uint8Array(copyPlane(c)),d=new Uint8Array(buf,c*nFr,nFr);for(let i=0;i<s.length;i++){const v=s[i]-128;d[i]=Math.max(0,Math.min(255,Math.round(v*volume+128)));}} }
        else { const s=new Uint8Array(copyInterleaved(bs)),d=new Uint8Array(buf);for(let i=0;i<s.length;i++){const v=s[i]-128;d[i]=Math.max(0,Math.min(255,Math.round(v*volume+128)));} }
        return new AudioSample({data:buf,format:fmt,numberOfChannels:nCh,sampleRate:sr,timestamp:ts});
    }
    return null;
};

/** Process external audio clips (separate audio track). */
const processExternalAudioClips = async (audioClips: {file:File;startTime:number;duration:number;trimStart:number;trimEnd:number;id?:string;volume?:number}[], audioConfig: any, audioSource: any) => {
    if (!audioClips||audioClips.length===0) return;
    for (const ac of [...audioClips].sort((a,b)=>a.startTime-b.startTime)) {
        if (isExportCancelled) throw new Error('Export cancelled');
        const url = URL.createObjectURL(ac.file);
        try {
            const src=new UrlSource(url); const inp=new Input({source:src,formats:ALL_FORMATS});
            const at=await inp.getPrimaryAudioTrack(); const sink=new AudioSampleSink(at);
            const vol = ac.volume ?? 1;
            for await (const sample of sink.samples()) {
                if (isExportCancelled) { sample.close(); throw new Error('Export cancelled'); }
                const ts=sample.timestamp;
                if (ts>(ac.duration-ac.trimEnd)+0.1) { sample.close(); break; }
                if (ts>=ac.trimStart&&ts<=(ac.duration-ac.trimEnd)) {
                    const rel=ts-ac.trimStart+ac.startTime;
                    const sr=(sample as any).sampleRate, nc=(sample as any).numberOfChannels;
                    if (sr&&nc&&(sr!==audioConfig.sampleRate||nc!==audioConfig.numberOfChannels)) { sample.close(); continue; }
                    if (vol!==1) {
                        const scaled=scaleAudioSampleVolume(sample,vol);
                        if (scaled) { scaled.setTimestamp(rel); await audioSource.add(scaled); scaled.close(); }
                        else { sample.setTimestamp(rel); await audioSource.add(sample); }
                    } else { sample.setTimestamp(rel); await audioSource.add(sample); }
                }
                sample.close();
            }
        } catch(err) {
            if (isExportCancelled||(err instanceof Error&&err.message==='Export cancelled')) throw err;
            console.error(`Error processing external audio clip ${ac.id||'?'}:`,err);
        } finally { URL.revokeObjectURL(url); }
    }
};

const calculateSampleProgress = (sample: any, clip: any, clipDuration: number, processedDuration: number, totalDuration: number) => {
    const ts=sample.timestamp, rel=ts-clip.trimStart+clip.startTime;
    const cp=(ts-clip.trimStart)/clipDuration;
    const tp=5+((processedDuration+(clipDuration*cp))/totalDuration)*90;
    return { relativeTimestamp: rel, totalProgress: tp };
};

const updateProgressIfNeeded = (tp: number, pd: number, td: number, ci: number, sl: number, op: any) => {
    const pp=5+(pd/td)*90;
    if (Math.floor(tp)>Math.floor(pp)) op?.(Math.round(tp),`Traitement du clip ${ci+1}/${sl}...`);
};

const filterActiveTextOverlays = (textOverlays: any, relativeTimestamp: number): TextOverlay[] => {
    if (!textOverlays) return [];
    return textOverlays.filter((t: any) => relativeTimestamp>=t.startTime&&relativeTimestamp<=(t.startTime+t.duration));
};

const checkClipEffectFlags = (sample: any, clip: any, width: number, height: number, startTransition: any, endTransition: any, activeTexts: TextOverlay[]) => {
    const {hasFilter,hasCrop,hasTransform}=hasClipEffects(clip,width,height);
    return { hasFilter, hasCrop, hasTransform, hasTransition: !!(startTransition||endTransition), hasText: activeTexts.length>0, isSameResolution: (sample as any).displayWidth===width&&(sample as any).displayHeight===height };
};

const addFrameDirectly = async (sample: any, relativeTimestamp: number, videoSource: any) => {
    const f=new VideoFrame(sample as any,{timestamp:relativeTimestamp*1_000_000}); const s=new VideoSample(f); await videoSource.add(s); s.close();
};

const prepareCanvasForEffects = (ctx: CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D, startTransition: any, endTransition: any, clip: any) => {
    ctx.filter='none'; ctx.globalAlpha=1.0;
    if (startTransition||endTransition) { ctx.fillStyle='black'; ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height); }
    ctx.save();
    if (clip.filter) ctx.filter=buildFilterString(clip.filter);
};

const applyClipTransitions = (ctx: CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D, sample: any, clip: any, clipDuration: number, startTransition: any, endTransition: any, width: number, height: number) => {
    if (!startTransition&&!endTransition) return;
    const ts=sample.timestamp, ct=ts-clip.trimStart;
    let at: Transition|undefined, isEnd=false;
    if (startTransition&&ct<startTransition.duration) { at=startTransition; isEnd=false; }
    else if (endTransition&&ct>(clipDuration-endTransition.duration)) { at=endTransition; isEnd=true; }
    if (at) applyTransition(ctx,at,ct,clipDuration,width,height,isEnd);
};

const isValidCanvasImageSource = (source: any): boolean => {
    if (!source) return false;
    // Check for known drawable types
    if (typeof source.draw === 'function') return true;
    if (source instanceof HTMLImageElement) return source.complete && source.naturalWidth > 0;
    if (source instanceof HTMLVideoElement) return source.readyState >= 2;
    if (source instanceof HTMLCanvasElement || source instanceof OffscreenCanvas) return true;
    if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) return true;
    if (typeof VideoFrame !== 'undefined' && source instanceof VideoFrame) return true;
    // If it has displayWidth/displayHeight it's likely a MediaBunny VideoSample with a draw method
    if (source.displayWidth && source.displayHeight) return true;
    return false;
};

const safeDrawImage = (ctx: CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D, source: any, ...args: number[]) => {
    if (!source) {
        console.warn('drawImage called with null/undefined source, skipping frame');
        return;
    }
    try {
        if (typeof source.draw === 'function') {
            source.draw(ctx, ...args);
        } else {
            (ctx.drawImage as any)(source, ...args);
        }
    } catch (e) {
        console.warn('drawImage failed for source type:', typeof source, source?.constructor?.name, e);
        // Fill with black frame as fallback instead of crashing
        ctx.fillStyle = 'black';
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;
        ctx.fillRect(0, 0, w, h);
    }
};

const drawSampleToCanvas = (ctx: CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D, sample: any, width: number, height: number, clip?: any) => {
    if (!isValidCanvasImageSource(sample)) {
        console.warn('drawSampleToCanvas: invalid or unready sample, drawing black frame. Type:', typeof sample, sample?.constructor?.name);
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, width, height);
        return;
    }
    const crop = clip?.crop;
    const transform = clip?.transform;
    if (crop && (crop.width < 100 || crop.height < 100 || crop.x > 0 || crop.y > 0)) {
        // Calculate source rectangle from crop percentages
        const frameW = (sample as any).displayWidth || width;
        const frameH = (sample as any).displayHeight || height;
        const sx = (crop.x / 100) * frameW;
        const sy = (crop.y / 100) * frameH;
        const sw = (crop.width / 100) * frameW;
        const sh = (crop.height / 100) * frameH;
        // Draw only the cropped portion, scaled to fill the output canvas
        safeDrawImage(ctx, sample, sx, sy, sw, sh, 0, 0, width, height);
    } else if (transform && (transform.rotation !== 0 || transform.scale !== 100 || transform.x !== 50 || transform.y !== 50 || (transform.scaleX !== undefined && transform.scaleX !== 100) || (transform.scaleY !== undefined && transform.scaleY !== 100))) {
        // Apply transform: position, scale, rotation
        ctx.save();
        const posX = (transform.x / 100) * width;
        const posY = (transform.y / 100) * height;
        const scaleVal = (transform.scale || 100) / 100;
        const scaleXVal = transform.scaleX !== undefined ? transform.scaleX / 100 : scaleVal;
        const scaleYVal = transform.scaleY !== undefined ? transform.scaleY / 100 : scaleVal;
        const rotRad = (transform.rotation || 0) * Math.PI / 180;
        ctx.translate(posX, posY);
        ctx.rotate(rotRad);
        ctx.scale(scaleXVal, scaleYVal);
        const frameW = (sample as any).displayWidth || width;
        const frameH = (sample as any).displayHeight || height;
        safeDrawImage(ctx, sample, -frameW/2, -frameH/2, frameW, frameH);
        ctx.restore();
    } else {
        safeDrawImage(ctx, sample, 0, 0, width, height);
    }
};

const addProcessedFrame = async (ctx: CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D, relativeTimestamp: number, canvas: HTMLCanvasElement|OffscreenCanvas, videoSource: any) => {
    const f=new VideoFrame(canvas as any,{timestamp:relativeTimestamp*1_000_000}); const s=new VideoSample(f); await videoSource.add(s); s.close();
};

/** Check if a clip's file is an image (not a video). */
const isImageClip = (clip: any): boolean => {
    if (!clip.file) return false;
    const type = clip.file.type || '';
    if (type.startsWith('image/')) return true;
    // Fallback: check file extension
    const name = (clip.file.name || '').toLowerCase();
    return /\.(png|jpe?g|gif|bmp|webp|svg|avif|ico)$/.test(name);
};

/** Load an image File as an ImageBitmap for efficient canvas drawing. */
const loadImageBitmap = async (file: File): Promise<ImageBitmap> => {
    const blob = file.slice(0, file.size, file.type);
    return createImageBitmap(blob);
};

/**
 * Draw an image onto the canvas, scaled to fit the export resolution while
 * maintaining aspect ratio (letterbox / pillarbox with black bars).
 * Supports crop and transform settings from the clip.
 */
const drawImageToCanvas = (
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    img: ImageBitmap,
    width: number,
    height: number,
    clip?: any
): void => {
    const crop = clip?.crop;
    const transform = clip?.transform;

    if (crop && (crop.width < 100 || crop.height < 100 || crop.x > 0 || crop.y > 0)) {
        // Crop: extract a sub-region of the image
        const sx = (crop.x / 100) * img.width;
        const sy = (crop.y / 100) * img.height;
        const sw = (crop.width / 100) * img.width;
        const sh = (crop.height / 100) * img.height;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
    } else if (transform && (transform.rotation !== 0 || transform.scale !== 100 || transform.x !== 50 || transform.y !== 50 || (transform.scaleX !== undefined && transform.scaleX !== 100) || (transform.scaleY !== undefined && transform.scaleY !== 100))) {
        // Transform: position, scale, rotation
        ctx.save();
        const posX = (transform.x / 100) * width;
        const posY = (transform.y / 100) * height;
        const scaleVal = (transform.scale || 100) / 100;
        const scaleXVal = transform.scaleX !== undefined ? transform.scaleX / 100 : scaleVal;
        const scaleYVal = transform.scaleY !== undefined ? transform.scaleY / 100 : scaleVal;
        const rotRad = (transform.rotation || 0) * Math.PI / 180;
        ctx.translate(posX, posY);
        ctx.rotate(rotRad);
        ctx.scale(scaleXVal, scaleYVal);
        ctx.drawImage(img, -img.width / 2, -img.height / 2, img.width, img.height);
        ctx.restore();
    } else {
        // Fit image to canvas maintaining aspect ratio (letterbox/pillarbox)
        const imgAspect = img.width / img.height;
        const canvasAspect = width / height;
        let dw: number, dh: number, dx: number, dy: number;
        if (imgAspect > canvasAspect) {
            // Image is wider — pillarbox (black bars top/bottom)
            dw = width;
            dh = width / imgAspect;
            dx = 0;
            dy = (height - dh) / 2;
        } else {
            // Image is taller — letterbox (black bars left/right)
            dh = height;
            dw = height * imgAspect;
            dx = (width - dw) / 2;
            dy = 0;
        }
        // Fill black background first for letterbox/pillarbox bars
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, dx, dy, dw, dh);
    }
};

/**
 * Process an image clip: render the image as video frames for the clip's duration.
 * Supports filters, transitions, text overlays, crop, and transform.
 */
const processImageClip = async (
    clip: any,
    index: number,
    currentTimelineTime: number,
    processedDuration: number,
    totalDuration: number,
    totalClips: number,
    onProgress: any,
    textOverlays: any,
    transitions: any,
    width: number,
    height: number,
    fps: number,
    frameDuration: number,
    canvas: HTMLCanvasElement | OffscreenCanvas,
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    videoSource: any
): Promise<void> => {
    if (isExportCancelled) throw new Error('Export cancelled');

    const clipDuration = clip.duration - clip.trimStart - clip.trimEnd;
    const totalFrames = Math.ceil(clipDuration * fps);

    // Fill gap before this clip if needed
    if (clip.startTime > currentTimelineTime + 0.01) {
        await processGapFrames(clip.startTime - currentTimelineTime, fps, width, height, currentTimelineTime, frameDuration, videoSource, canvas, ctx);
    }

    onProgress?.(Math.round(5 + (processedDuration / totalDuration) * 90), `Traitement du clip image ${index + 1}/${totalClips}...`);

    // Load the image
    const imgBitmap = await loadImageBitmap(clip.file);

    try {
        // Get transitions for this clip
        const clipTransitions = transitions?.filter((t: any) => t.clipId === clip.id) || [];
        const startTransition = clipTransitions.find((t: any) => t.position === 'start');
        const endTransition = clipTransitions.find((t: any) => t.position === 'end');

        for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
            if (isExportCancelled) throw new Error('Export cancelled');

            const frameTime = frameIdx * frameDuration; // time within the clip
            const timelineTime = clip.startTime + frameTime; // absolute timeline time

            // Update progress periodically
            if (frameIdx % 10 === 0) {
                const clipProgress = frameIdx / totalFrames;
                const totalProgress = 5 + ((processedDuration + clipDuration * clipProgress) / totalDuration) * 90;
                onProgress?.(Math.round(totalProgress), `Traitement du clip image ${index + 1}/${totalClips}...`);
            }

            // Get active text overlays for this frame
            const activeTexts = filterActiveTextOverlays(textOverlays, timelineTime);

            // Prepare canvas
            ctx.globalAlpha = 1.0;
            ctx.filter = 'none';

            // If there are transitions, fill black background first
            if (startTransition || endTransition) {
                ctx.fillStyle = 'black';
                ctx.fillRect(0, 0, width, height);
            }

            ctx.save();

            // Apply filter if present
            if (clip.filter) {
                ctx.filter = buildFilterString(clip.filter);
            }

            // Apply transitions
            if (startTransition && frameTime < startTransition.duration) {
                applyTransition(ctx, startTransition, frameTime, clipDuration, width, height, false);
            } else if (endTransition && frameTime > (clipDuration - endTransition.duration)) {
                applyTransition(ctx, endTransition, frameTime, clipDuration, width, height, true);
            }

            // Draw the image
            drawImageToCanvas(ctx, imgBitmap, width, height, clip);

            ctx.restore();

            // Render text overlays on top
            if (activeTexts.length > 0) {
                renderTextOverlays(ctx, activeTexts, width, height);
            }

            // Create video frame and add to output
            await addProcessedFrame(ctx, timelineTime, canvas, videoSource);
        }
    } finally {
        imgBitmap.close();
    }
};

const processSingleVideoSample = async (sample: any, clip: any, clipDuration: number, processedDuration: number, totalDuration: number, sortedClipsLength: number, clipIndex: number, onProgress: any, textOverlays: any, startTransition: any, endTransition: any, width: number, height: number, videoSource: any, canvas: HTMLCanvasElement|OffscreenCanvas, ctx: CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D) => {
    const {relativeTimestamp,totalProgress}=calculateSampleProgress(sample,clip,clipDuration,processedDuration,totalDuration);
    updateProgressIfNeeded(totalProgress,processedDuration,totalDuration,clipIndex,sortedClipsLength,onProgress);
    const activeTexts=filterActiveTextOverlays(textOverlays,relativeTimestamp);
    const {hasFilter,hasCrop,hasTransform,hasTransition,hasText,isSameResolution}=checkClipEffectFlags(sample,clip,width,height,startTransition,endTransition,activeTexts);
    if (!hasFilter&&!hasCrop&&!hasTransform&&!hasTransition&&!hasText&&isSameResolution) { await addFrameDirectly(sample,relativeTimestamp,videoSource); }
    else {
        prepareCanvasForEffects(ctx,startTransition,endTransition,clip);
        applyClipTransitions(ctx,sample,clip,clipDuration,startTransition,endTransition,width,height);
        drawSampleToCanvas(ctx,sample,width,height,clip);
        ctx.restore();
        if (hasText) renderTextOverlays(ctx,activeTexts,width,height);
        await addProcessedFrame(ctx,relativeTimestamp,canvas,videoSource);
    }
};

const processVideoSamples = async (videoSink: VideoSampleSink, clip: any, clipDuration: number, processedDuration: number, totalDuration: number, sortedClipsLength: number, clipIndex: number, onProgress: any, textOverlays: any, startTransition: any, endTransition: any, width: number, height: number, videoSource: any, canvas: HTMLCanvasElement|OffscreenCanvas, ctx: CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D) => {
    for await (const sample of videoSink.samples()) {
        if (isExportCancelled) { sample.close(); throw new Error('Export cancelled'); }
        const ts=sample.timestamp;
        if (ts>(clip.duration-clip.trimEnd)+0.1) { sample.close(); break; }
        if (ts>=clip.trimStart&&ts<=(clip.duration-clip.trimEnd)) {
            await processSingleVideoSample(sample,clip,clipDuration,processedDuration,totalDuration,sortedClipsLength,clipIndex,onProgress,textOverlays,startTransition,endTransition,width,height,videoSource,canvas,ctx);
        }
        sample.close();
    }
};

const getAudioConfig = async (clips: any[], isWebM: boolean, audioClips?: {file:File;startTime:number;duration:number;trimStart:number;trimEnd:number;id?:string;volume?:number}[]) => {
    let sampleRate=48000, numberOfChannels=2;
    // Skip image clips when probing for audio settings (images have no audio track)
    const probe = clips.find(c=>!c.audioMuted && !isImageClip(c)) || (audioClips&&audioClips.length>0?audioClips[0]:null);
    if (probe) {
        try {
            const url=URL.createObjectURL(probe.file); const s=new UrlSource(url); const i=new Input({source:s,formats:ALL_FORMATS});
            const at=await i.getPrimaryAudioTrack();
            if (at) { sampleRate=at.sampleRate||48000; numberOfChannels=at.numberOfChannels||2; }
            URL.revokeObjectURL(url);
        } catch(e) { console.warn('Could not detect audio settings from first clip, using defaults',e); }
    }
    return { codec: isWebM?'opus':'aac', bitrate: 128_000, numberOfChannels, sampleRate } as any;
};

const getVideoConfig = (settings: ExportSettings, resolution: any, isWebM: boolean) => {
    let bitrate=2_500_000;
    if (settings.resolution==='4K') bitrate=8_000_000;
    else if (settings.resolution==='720p') bitrate=1_500_000;
    if (settings.quality==='high') bitrate*=1.5;
    if (settings.quality==='low') bitrate*=0.7;
    return { codec: isWebM?'vp9':'avc', bitrate: Math.round(bitrate), width: resolution.width, height: resolution.height } as any;
};

export async function exportProjectWithMediaBunny(
    clips: {file:File;startTime:number;duration:number;trimStart:number;trimEnd:number;filter?:VideoFilter;id?:string;audioMuted?:boolean;crop?:CropSettings;transform?:TransformSettings}[],
    settings: ExportSettings,
    onProgress?: (progress:number,message:string)=>void,
    textOverlays?: TextOverlay[],
    transitions?: Transition[],
    aspectRatio?: AspectRatio,
    hardwareProfile?: any,
    safeMode: boolean = false,
    audioClips?: {file:File;startTime:number;duration:number;trimStart:number;trimEnd:number;id?:string;volume?:number}[]
): Promise<Blob> {
    isExportCancelled = false;
    onProgress?.(0, 'Initialisation de MediaBunny...');
    const effectiveAspectRatio = aspectRatio||settings.aspectRatio||'16:9';
    const resolution = getResolutionForAspectRatio(settings.resolution, effectiveAspectRatio);
    const isWebM = settings.format==='webm';
    const outputFormat = isWebM ? new WebMOutputFormat() : new Mp4OutputFormat();
    const target = new BufferTarget();
    const output = new Output({ format: outputFormat, target });
    const videoConfig = getVideoConfig(settings, resolution, isWebM);
    const videoSource = new VideoSampleSource(videoConfig);
    output.addVideoTrack(videoSource);
    const audioConfig = await getAudioConfig(clips, isWebM, audioClips);
    const audioSource = new AudioSampleSource(audioConfig);
    output.addAudioTrack(audioSource);
    await output.start();
    onProgress?.(5, 'Export dÃ©marrÃ©...');
    let currentTimelineTime = 0;

    // Calculate actual total duration by considering both video and audio clips
    let totalDuration = 0;
    // Check video clips
    for (const clip of clips) {
        const clipEndTime = clip.startTime + (clip.duration - clip.trimStart - clip.trimEnd);
        if (clipEndTime > totalDuration) {
            totalDuration = clipEndTime;
        }
    }
    // Check audio clips
    if (audioClips) {
        for (const clip of audioClips) {
            const clipEndTime = clip.startTime + (clip.duration - clip.trimStart - clip.trimEnd);
            if (clipEndTime > totalDuration) {
                totalDuration = clipEndTime;
            }
        }
    }

    let processedDuration = 0;
    const sortedClips = [...clips].sort((a,b)=>a.startTime-b.startTime);
    const width=resolution.width, height=resolution.height;
    const canvas = typeof OffscreenCanvas!=='undefined' ? new OffscreenCanvas(width,height) : document.createElement('canvas');
    canvas.width=width; canvas.height=height;
    const ctx = canvas.getContext('2d',{alpha:false,desynchronized:true}) as CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D;
    if (!ctx) throw new Error('Could not create canvas context');
    const fps = Number.parseInt(settings.fps)||30;
    const frameDuration = 1/fps;

    const processClip = async (clip: any, index: number, ctt: number, pd: number, td: number, tc: number, op: any, to: any, tr: any, ac: any, w: number, h: number, f: number, fd: number, cv: HTMLCanvasElement|OffscreenCanvas, cx: CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D, vs: any, as2: any) => {
        if (isExportCancelled) throw new Error('Export cancelled');

        // Branch: image clips are rendered frame-by-frame from a static image
        if (isImageClip(clip)) {
            await processImageClip(clip, index, ctt, pd, td, tc, op, to, tr, w, h, f, fd, cv, cx, vs);
            return;
        }

        // Video clip processing (original path)
        const cd = clip.duration-clip.trimStart-clip.trimEnd;
        if (clip.startTime>ctt+0.01) { await processGapFrames(clip.startTime-ctt,f,w,h,ctt,fd,vs,cv,cx); ctt=clip.startTime; }
        op?.(Math.round(5+(pd/td)*90),`Traitement du clip ${index+1}/${tc}...`);
        const url = URL.createObjectURL(clip.file);
        try {
            const source=new UrlSource(url); const input=new Input({source,formats:ALL_FORMATS});
            const vt=await input.getPrimaryVideoTrack(); const vSink=new VideoSampleSink(vt);
            let aSink: AudioSampleSink|null = null;
            if (!clip.audioMuted) { try { const at=await input.getPrimaryAudioTrack(); aSink=new AudioSampleSink(at); } catch(e) { console.warn('No audio track found for clip',clip.id); } }
            const ct=tr?.filter((t:any)=>t.clipId===clip.id)||[];
            const st=ct.find((t:any)=>t.position==='start'), et=ct.find((t:any)=>t.position==='end');
            await processVideoSamples(vSink,clip,cd,pd,td,tc,index,op,to,st,et,w,h,vs,cv,cx);
            await processAudioSamples(aSink,clip,ac,as2);
        } catch(err) {
            if (isExportCancelled||(err instanceof Error&&err.message==='Export cancelled')) throw err;
            console.error(`Error processing clip ${index}:`,err); throw err;
        } finally { URL.revokeObjectURL(url); }
    };

    for (let i=0; i<sortedClips.length; i++) {
        await processClip(sortedClips[i],i,currentTimelineTime,processedDuration,totalDuration,sortedClips.length,onProgress,textOverlays,transitions,audioConfig,width,height,fps,frameDuration,canvas,ctx,videoSource,audioSource);
        const clip=sortedClips[i]; const cd=clip.duration-clip.trimStart-clip.trimEnd;
        processedDuration+=cd; currentTimelineTime=Math.max(currentTimelineTime,clip.startTime+cd);
    }

    // Process external audio clips (separate audio track) after all video clips
    if (audioClips && audioClips.length > 0) {
        onProgress?.(92, 'Traitement des pistes audio...');
        await processExternalAudioClips(audioClips, audioConfig, audioSource);
    }

    // Add black frames if audio extends beyond video duration
    if (currentTimelineTime < totalDuration) {
        const remainingDuration = totalDuration - currentTimelineTime;
        await processGapFrames(remainingDuration, fps, width, height, currentTimelineTime, frameDuration, videoSource, canvas, ctx);
    }

    if (isExportCancelled) throw new Error('Export cancelled');
    onProgress?.(95, 'Finalisation...');
    await output.finalize();
    if (target.buffer) return new Blob([target.buffer],{type:isWebM?'video/webm':'video/mp4'});
    else throw new Error('Export failed: No buffer generated');
}
