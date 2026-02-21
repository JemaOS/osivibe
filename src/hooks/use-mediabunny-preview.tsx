import { useEffect, useRef, useCallback, useState } from 'react';
import { Input, UrlSource, VideoSampleSink, ALL_FORMATS } from 'mediabunny';
import { useEditorStore } from '../store/editorStore';
import { TimelineClip, TimelineTrack } from '../types';
import { getCSSFilter } from '../utils/helpers';

interface MediaBunnyClip {
  id: string;
  input: Input;
  sink: VideoSampleSink;
  mediaId: string;
  url: string;
  lastSample?: any; // VideoSample
  lastSampleTime?: number;
  // Buffer for lookahead
  buffer: Array<{ sample: any, time: number }>;
  isFetching: boolean;
  // Queue for serialized fetching
  fetchQueue: Promise<any>;
  // Track pending fetches to avoid duplicates
  pendingFetches: Map<number, Promise<any>>;
}

export const useMediaBunnyPreview = (
  canvasRef: React.RefObject<HTMLCanvasElement>,
  isEnabled: boolean
) => {
  const { mediaFiles, tracks, filters } = useEditorStore();
  const clipsRef = useRef<Map<string, MediaBunnyClip>>(new Map());
  const [isReady, setIsReady] = useState(false);

  // Initialize MediaBunny inputs for all video clips
  useEffect(() => {
    if (!isEnabled) return;

    const initClips = async () => {
      const currentClips = new Map<string, MediaBunnyClip>();
      const promises: Promise<void>[] = [];

      tracks.forEach(track => {
        if (track.type !== 'video') return;

        track.clips.forEach(clip => {
          const media = mediaFiles.find(m => m.id === clip.mediaId);
          if (!media || media.type !== 'video') return;

          // Check if we already have this clip initialized
          const existing = clipsRef.current.get(clip.id);
          if (existing && existing.url === media.url) {
            currentClips.set(clip.id, existing);
            return;
          }

          // Initialize new input
          const p = (async () => {
            try {
              const source = new UrlSource(media.url);
              const input = new Input({
                source: source,
                formats: ALL_FORMATS,
              });
              
              // We need to initialize the input to get tracks
              await input.computeDuration();
              
              const videoTrack = await input.getPrimaryVideoTrack();
              const sink = new VideoSampleSink(videoTrack);
              
              currentClips.set(clip.id, {
                id: clip.id,
                input,
                sink,
                mediaId: media.id,
                url: media.url,
                buffer: [],
                isFetching: false,
                fetchQueue: Promise.resolve(),
                pendingFetches: new Map()
              });
            } catch (err) {
              console.error(`Failed to initialize MediaBunny for clip ${clip.id}`, err);
            }
          })();
          promises.push(p);
        });
      });

      await Promise.all(promises);

      // Cleanup old clips - FIX: Properly release MediaBunny resources to prevent memory leaks
      clipsRef.current.forEach((clip, id) => {
        if (!currentClips.has(id)) {
          // Close any cached samples
          if (clip.lastSample) {
            try { clip.lastSample.close(); } catch(e) { /* ignore */ }
          }
          // Close buffer samples
          clip.buffer.forEach(item => {
            try { item.sample.close(); } catch(e) { /* ignore */ }
          });
          // FIX: Close input and sink to release WebCodecs resources (VideoDecoder, etc.)
          // These resources must be explicitly closed to prevent memory leaks
          // Use type assertion since the MediaBunny types may not include close() but runtime does
          const input = clip.input as unknown as { close?: () => void };
          if (input && typeof input.close === 'function') {
            try { input.close(); } catch(e) { /* ignore */ }
          }
          const sink = clip.sink as unknown as { close?: () => void };
          if (sink && typeof sink.close === 'function') {
            try { sink.close(); } catch(e) { /* ignore */ }
          }
        }
      });

      clipsRef.current = currentClips;
      setIsReady(true);
    };

    initClips();

    // Cleanup on unmount - FIX: Ensure all resources are released when component unmounts
    return () => {
      clipsRef.current.forEach(clip => {
        // Close cached samples
        if (clip.lastSample) {
          try { clip.lastSample.close(); } catch(e) { /* ignore */ }
        }
        // Close buffer samples
        clip.buffer.forEach(item => {
          try { item.sample.close(); } catch(e) { /* ignore */ }
        });
        // FIX: Close input and sink to release WebCodecs resources
        // Use type assertion since the MediaBunny types may not include close() but runtime does
        const input = clip.input as unknown as { close?: () => void };
        if (input && typeof input.close === 'function') {
          try { input.close(); } catch(e) { /* ignore */ }
        }
        const sink = clip.sink as unknown as { close?: () => void };
        if (sink && typeof sink.close === 'function') {
          try { sink.close(); } catch(e) { /* ignore */ }
        }
      });
      // Clear the map to release all references
      clipsRef.current.clear();
    };
  }, [mediaFiles, tracks, isEnabled]);

  const isRenderingRef = useRef(false);
  const pendingRenderRef = useRef<{ currentTime: number, width: number, height: number } | null>(null);
  
  // Performance monitoring
  const perfRef = useRef({
    frameCount: 0,
    lastLogTime: 0,
    totalRenderTime: 0,
    maxRenderTime: 0,
    cacheHits: 0
  });

  // Helper: Find active clips at current time
  const findActiveClips = (
    tracks: TimelineTrack[],
    clipsMap: Map<string, MediaBunnyClip>,
    currentTime: number
  ): { clip: TimelineClip, mbClip: MediaBunnyClip }[] => {
    const activeClips: { clip: TimelineClip, mbClip: MediaBunnyClip }[] = [];
    
    tracks.forEach(track => {
      if (track.type !== 'video') return;
      
      const clip = track.clips.find(c => 
        currentTime >= c.startTime && 
        currentTime < c.startTime + (c.duration - c.trimStart - c.trimEnd)
      );

      if (clip) {
        const mbClip = clipsMap.get(clip.id);
        if (mbClip) {
          activeClips.push({ clip, mbClip });
        }
      }
    });
    
    return activeClips;
  };

// Helper: Check if buffered frame matches requested time
const isBufferMatch = (item: { sample: { timestamp?: number; duration?: number }, time: number }, clipTime: number): boolean => {
  if (typeof item.sample.timestamp === 'number') {
    const isMicroseconds = item.sample.timestamp > 1000; 
    const scale = isMicroseconds ? 1e-6 : 1;
    const frameTime = item.sample.timestamp * scale;
    const frameDuration = (item.sample.duration ? item.sample.duration * scale : 0.033);
    
    return clipTime >= frameTime - 0.01 && clipTime < frameTime + frameDuration + 0.015;
  }
  // Fallback
  return Math.abs(clipTime - item.time) < 0.045;
};

// Helper: Check if last sample can be reused
const canReuseLastSample = (
  sample: { timestamp?: number; duration?: number }, 
  lastSampleTime: number | undefined,
  clipTime: number
): boolean => {
  if (typeof sample.timestamp === 'number') {
    const isMicroseconds = sample.timestamp > 1000; 
    const scale = isMicroseconds ? 1e-6 : 1;
    const frameTime = sample.timestamp * scale;
    const frameDuration = (sample.duration ? sample.duration * scale : 0.033);
    
    if (clipTime >= frameTime - 0.01 && clipTime < frameTime + frameDuration + 0.015) {
      return true;
    }
  }
  
  // Fallback to simple delta check
  if (lastSampleTime !== undefined) {
    const delta = Math.abs(clipTime - lastSampleTime);
    return delta < 0.045;
  }
  
  return false;
};

// Helper: Draw sample to canvas
const drawSampleToCanvas = (
  ctx: CanvasRenderingContext2D,
  sample: { displayWidth: number; displayHeight: number; draw: Function },
  clip: TimelineClip,
  width: number,
  height: number
) => {
  if (clip.crop) {
    // Crop logic
    const sx = (clip.crop.x / 100) * sample.displayWidth;
    const sy = (clip.crop.y / 100) * sample.displayHeight;
    const sWidth = (clip.crop.width / 100) * sample.displayWidth;
    const sHeight = (clip.crop.height / 100) * sample.displayHeight;
    sample.draw(ctx, 0, 0, width, height, sx, sy, sWidth, sHeight);
  } else {
    // Standard video rendering (object-contain)
    const videoAspect = sample.displayWidth / sample.displayHeight;
    const canvasAspect = width / height;
    
    let drawWidth, drawHeight, dx, dy;
    
    if (videoAspect > canvasAspect) {
      drawWidth = width;
      drawHeight = width / videoAspect;
      dx = 0;
      dy = (height - drawHeight) / 2;
    } else {
      drawHeight = height;
      drawWidth = height * videoAspect;
      dy = 0;
      dx = (width - drawWidth) / 2;
    }
    
    sample.draw(ctx, dx, dy, drawWidth, drawHeight);
  }
};
  const safeGetSample = async (mbClip: MediaBunnyClip, time: number) => {
    // Check if we are already fetching this time (or close to it)
    for (const [pendingTime, promise] of mbClip.pendingFetches.entries()) {
      if (Math.abs(pendingTime - time) < 0.02) { // 20ms tolerance
        return promise;
      }
    }

    // Chain the fetch to the existing queue
    const fetchPromise = mbClip.fetchQueue.then(async () => {
      try {
        return await mbClip.sink.getSample(time);
      } catch (e) {
        console.error("Error fetching sample:", e);
        return null;
      }
    });
    
    // Update the queue pointer
    mbClip.fetchQueue = fetchPromise.catch(() => {}); 
    
    // Track this pending fetch
    mbClip.pendingFetches.set(time, fetchPromise);
    
    // Cleanup when done
    fetchPromise.finally(() => {
      mbClip.pendingFetches.delete(time);
    });
    
    return fetchPromise;
  };

  // Helper to refill buffer in background
  const refillBuffer = async (mbClip: MediaBunnyClip, currentTime: number) => {
    if (mbClip.isFetching) return;
    mbClip.isFetching = true;
    
    try {
      // Try to buffer next 2 frames (approx 66ms) - Reduced from 3 to lower load
      // We assume 30fps (33ms)
      const step = 0.033;
      const targetBuffer = 2;
      
      // Determine start time for buffering
      // If buffer has items, start after last item
      // If buffer empty, start after currentTime
      let startTime = currentTime;
      if (mbClip.buffer.length > 0) {
        startTime = mbClip.buffer[mbClip.buffer.length - 1].time;
      }
      
      let added = 0;
      while (mbClip.buffer.length + added < targetBuffer) {
        const nextTime = startTime + step * (added + 1);
        
        // Use safeGetSample to serialize
        const sample = await safeGetSample(mbClip, nextTime);
        
        if (sample) {
           mbClip.buffer.push({ sample, time: nextTime });
           added++;
           // Small yield to let main thread breathe
           await new Promise(r => setTimeout(r, 0));
        } else {
           break; // End of stream or error
        }
      }
    } catch (e) {
      // Ignore errors in background fetch
    } finally {
      mbClip.isFetching = false;
    }
  };

  const performRender = async (currentTime: number, width: number, height: number) => {
    const renderStart = performance.now();

    // Check canvas availability FIRST to avoid fetching samples if we can't draw
    // This prevents memory leaks where samples are fetched but never closed because of early returns
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // Get latest state directly to avoid stale closures in animation loop
    const state = useEditorStore.getState();
    const currentTracks = state.tracks;
    const currentFilters = state.filters;

    // Find active clips (sorted by track order/z-index)
    // Assuming tracks are ordered bottom-to-top
    const activeClips: { clip: TimelineClip, mbClip: MediaBunnyClip }[] = [];

    currentTracks.forEach(track => {
      if (track.type !== 'video') return;
      
      const clip = track.clips.find(c => 
        currentTime >= c.startTime && 
        currentTime < c.startTime + (c.duration - c.trimStart - c.trimEnd)
      );

      if (clip) {
        const mbClip = clipsRef.current.get(clip.id);
        if (mbClip) {
          activeClips.push({ clip, mbClip });
        }
      }
    });

    // Fetch samples BEFORE clearing canvas to prevent flickering
    const fetchStart = performance.now();
    const samplesToDraw = await Promise.all(activeClips.map(async ({ clip, mbClip }) => {
      try {
        const clipTime = currentTime - clip.startTime + clip.trimStart;
        
        // 1. Check Buffer First (Lookahead)
        // Find the best matching frame in the buffer
        let bestBufferIndex = -1;
        let bestBufferSample = null;
        
        for (let i = 0; i < mbClip.buffer.length; i++) {
          const item = mbClip.buffer[i];
          // Check if this buffered frame covers our time
          // Use same logic as cache check
          let isMatch = false;
          if (typeof item.sample.timestamp === 'number') {
             const isMicroseconds = item.sample.timestamp > 1000; 
             const scale = isMicroseconds ? 1e-6 : 1;
             const frameTime = item.sample.timestamp * scale;
             const frameDuration = (item.sample.duration ? item.sample.duration * scale : 0.033);
             
             if (clipTime >= frameTime - 0.01 && clipTime < frameTime + frameDuration + 0.015) {
               isMatch = true;
             }
          } else {
             // Fallback
             if (Math.abs(clipTime - item.time) < 0.045) {
               isMatch = true;
             }
          }
          
          if (isMatch) {
            bestBufferIndex = i;
            bestBufferSample = item.sample;
            break;
          }
        }
        
        if (bestBufferSample) {
          // Found in buffer!
          // Move from buffer to lastSample
          if (mbClip.lastSample && mbClip.lastSample !== bestBufferSample) {
             try { mbClip.lastSample.close(); } catch(e) { /* ignore */ }
          }
          mbClip.lastSample = bestBufferSample;
          mbClip.lastSampleTime = clipTime; // Approximate
          
          // Remove this and all older frames from buffer (they are passed)
          // We keep newer frames
          const used = mbClip.buffer.splice(0, bestBufferIndex + 1);
          // Close skipped frames (if any)
          for (let k=0; k<used.length-1; k++) {
             if (used[k].sample !== bestBufferSample) {
                try { used[k].sample.close(); } catch(e) { /* ignore */ }
             }
          }
          
          perfRef.current.cacheHits++;
          
          // Trigger refill if buffer is low
          if (mbClip.buffer.length < 2 && !mbClip.isFetching) {
             refillBuffer(mbClip, clipTime);
          }
          
          return { clip, sample: mbClip.lastSample, reused: true };
        }

        // 2. Check Last Sample (Current Cache)
        // Optimization: Reuse last sample if we are within its duration
        if (mbClip.lastSample) {
          const sample = mbClip.lastSample;
          let reused = false;

          // Try to use exact frame timing if available (VideoFrame standard)
          if (typeof sample.timestamp === 'number') {
            // Detect time unit (microseconds vs seconds)
            // VideoFrame uses microseconds, so values are usually large
            const isMicroseconds = sample.timestamp > 1000; 
            const scale = isMicroseconds ? 1e-6 : 1;
            
            const frameTime = sample.timestamp * scale;
            // Default to 33ms (30fps) if duration is missing
            const frameDuration = (sample.duration ? sample.duration * scale : 0.033);
            
            // If the requested time is within this frame's window, reuse it
            // We add a small buffer (0.005s) to be lenient
            // INCREASED TOLERANCE: Allow up to 15ms "late" reuse to avoid blocking on decoder
            // This prefers holding a frame slightly too long over stuttering
            if (clipTime >= frameTime - 0.01 && clipTime < frameTime + frameDuration + 0.015) {
              reused = true;
            }
          } 
          
          // Fallback to simple delta check if timestamp logic failed or wasn't applicable
          // We use a slightly larger threshold (45ms) to cover 24/25fps content
          if (!reused && mbClip.lastSampleTime !== undefined) {
            const delta = Math.abs(clipTime - mbClip.lastSampleTime);
            if (delta < 0.045) { 
               reused = true;
            }
          }

          if (reused) {
            perfRef.current.cacheHits++;
            // Trigger refill if buffer is low
            if (mbClip.buffer.length < 2 && !mbClip.isFetching) {
               refillBuffer(mbClip, clipTime);
            }
            return { clip, sample: mbClip.lastSample, reused: true };
          }
        }

        // 3. Synchronous Fetch (Fallback - causes stutter but necessary)
        // Use safeGetSample to ensure we don't race with background buffer
        const sample = await safeGetSample(mbClip, clipTime);
        
        // Update cache
        // CRITICAL FIX: Check if the new sample is actually different from the old one
        // before closing the old one. MediaBunny might return the same object.
        if (mbClip.lastSample && mbClip.lastSample !== sample) {
          try { mbClip.lastSample.close(); } catch(e) { /* ignore */ }
        }
        mbClip.lastSample = sample; // Keep it open!
        mbClip.lastSampleTime = clipTime;
        
        // Trigger refill
        if (!mbClip.isFetching) {
           refillBuffer(mbClip, clipTime);
        }

        return { clip, sample, reused: false };
      } catch (err) {
        console.error(`Error rendering clip ${clip.id}`, err);
        return { clip, sample: null, reused: false };
      }
    }));
    const fetchTime = performance.now() - fetchStart;

    try {
      // Clear canvas only when we are ready to draw
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);

      // Draw clips
      for (const { clip, sample } of samplesToDraw) {
        if (sample) {
          try {
            ctx.save();
            
            // Apply filters
            const clipFilter = currentFilters[clip.id];
            if (clipFilter) {
              ctx.filter = getCSSFilter(clipFilter);
            }

            // Handle transforms
            if (clip.crop) {
               // Crop logic
               const sx = (clip.crop.x / 100) * sample.displayWidth;
               const sy = (clip.crop.y / 100) * sample.displayHeight;
               const sWidth = (clip.crop.width / 100) * sample.displayWidth;
               const sHeight = (clip.crop.height / 100) * sample.displayHeight;
               
               // Draw to full canvas (object-cover behavior)
               sample.draw(ctx, 0, 0, width, height, sx, sy, sWidth, sHeight);
               
            } else {
              // Standard video rendering (object-contain)
              const videoAspect = sample.displayWidth / sample.displayHeight;
              const canvasAspect = width / height;
              
              let drawWidth, drawHeight, dx, dy;
              
              if (videoAspect > canvasAspect) {
                // Video is wider than canvas (fit width)
                drawWidth = width;
                drawHeight = width / videoAspect;
                dx = 0;
                dy = (height - drawHeight) / 2;
              } else {
                // Video is taller than canvas (fit height)
                drawHeight = height;
                drawWidth = height * videoAspect;
                dy = 0;
                dx = (width - drawWidth) / 2;
              }
              
              sample.draw(ctx, dx, dy, drawWidth, drawHeight);
            }
            
            ctx.restore();
          } catch (e) {
            console.error("Error drawing sample", e);
          }
        }
      }
    } finally {
      // DO NOT close samples here if we are caching them!
      // We only close them when we replace them or unmount.
      // But if we failed to cache (e.g. error), we should close.
      // Actually, we updated the cache in the map loop.
      // So the samples in `samplesToDraw` are either the cached ones (don't close)
      // or the new ones which are NOW cached (don't close).
      // The only thing to close is if we had a temporary sample that we didn't cache?
      // No, we always cache.
    }

    const renderEnd = performance.now();
    const renderDuration = renderEnd - renderStart;
    
    // Update performance stats
    perfRef.current.frameCount++;
    perfRef.current.totalRenderTime += renderDuration;
    perfRef.current.maxRenderTime = Math.max(perfRef.current.maxRenderTime, renderDuration);

    if (renderEnd - perfRef.current.lastLogTime > 1000) {
      const fps = perfRef.current.frameCount;
      const avgRender = perfRef.current.totalRenderTime / fps;
      
      console.log(`📊 Preview Perf: ${fps} FPS | Avg Render: ${avgRender.toFixed(2)}ms | Max Render: ${perfRef.current.maxRenderTime.toFixed(2)}ms | Fetch: ${fetchTime.toFixed(2)}ms | Cache Hits: ${perfRef.current.cacheHits}/${fps}`);
      
      perfRef.current = {
        frameCount: 0,
        lastLogTime: renderEnd,
        totalRenderTime: 0,
        maxRenderTime: 0,
        cacheHits: 0
      };
    }
  };

  const render = useCallback(async (currentTime: number, width: number, height: number) => {
    if (!isEnabled || !canvasRef.current || !isReady) return;
    
    // If already rendering, skip this frame to prevent backlog
    // We rely on the next RAF to call us again with the latest time
    if (isRenderingRef.current) {
      return;
    }

    isRenderingRef.current = true;

    try {
      // Render the requested frame
      await performRender(currentTime, width, height);
    } catch (e) {
      console.error("Render loop error:", e);
    } finally {
      isRenderingRef.current = false;
    }
  }, [isEnabled, isReady]);

  return { render, isReady };
};

