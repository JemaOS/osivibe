import { useState, useEffect, useCallback, useRef } from 'react';
import { TransformSettings } from '../types';
import { getCSSFilter } from '../utils/helpers';
import { useEditorStore } from '../store/editorStore';

export const useVideoPlayerSync = (
  videoRefs: React.MutableRefObject<{ [key: string]: HTMLVideoElement | null }>,
  audioRefs: React.MutableRefObject<{ [key: string]: HTMLAudioElement | null }>,
  canvasRef: React.RefObject<HTMLCanvasElement>,
  player: any,
  filters: any,
  getActiveClips: () => any[],
  getActiveAudioClips: () => any[],
  videoClipsWithDetachedAudio: Set<string>,
  isMobileRef: React.MutableRefObject<boolean>,
  isScrubbingRef: React.MutableRefObject<boolean>,
  useMediaBunny: boolean,
  isMediaBunnyReady: boolean,
  renderMediaBunny: any,
  audioMutedStates: string
) => {
  const lastSyncTimeRef = useRef<number>(0);
  const syncDebounceRef = useRef<number | null>(null);
  const isSeekingRef = useRef<boolean>(false);

  const syncVideoVolumeAndPlayback = useCallback(() => {
    const activeClips = getActiveClips();
    
    const mainVideoId = activeClips.find(c => c.media.type === 'video')?.clip.id;

    activeClips.forEach((item) => {
      if (item.media.type !== 'video') return;
      
      const videoEl = videoRefs.current[item.clip.id];
      if (!videoEl) return;

      const isMainVideo = mainVideoId === item.clip.id;

      const isAudioMuted =
        item.clip.audioMuted === true ||
        item.trackMuted === true ||
        videoClipsWithDetachedAudio.has(item.clip.id);
      const targetVolume = isMainVideo && !isAudioMuted ? (player.isMuted ? 0 : player.volume) : 0;
      
      if (videoEl.volume !== targetVolume) {
        videoEl.volume = targetVolume;
      }
      
      if (videoEl.playbackRate !== player.playbackRate) {
        videoEl.playbackRate = player.playbackRate;
      }

      if (player.isPlaying) {
        if (videoEl.paused) {
          videoEl.play().catch((err) => {
            console.error('[DEBUG syncVideoVolumeAndPlayback] Play error:', err);
          });
        }
      } else {
        if (!videoEl.paused) {
          videoEl.pause();
        }
      }
    });
  }, [player.isPlaying, player.volume, player.isMuted, player.playbackRate, getActiveClips, videoClipsWithDetachedAudio, videoRefs]);

  const syncAudioVolumeAndPlayback = useCallback(() => {
    const activeAudio = getActiveAudioClips();
    const activeIds = new Set(activeAudio.map((a) => a.clip.id));
    
    Object.entries(audioRefs.current).forEach(([clipId, el]) => {
      if (!el) return;
      if (!activeIds.has(clipId)) {
        if (!el.paused) {
          el.pause();
        }
      }
    });

    activeAudio.forEach((item) => {
      const audioEl = audioRefs.current[item.clip.id];
      if (!audioEl) return;

      if (audioEl.getAttribute('src') !== item.media.url) {
        audioEl.setAttribute('src', item.media.url);
        audioEl.load();
      }

      const clipStart = item.clip.startTime;
      const localTime = player.currentTime - clipStart + item.clip.trimStart;
      const timeDiff = Math.abs((audioEl.currentTime || 0) - localTime);
      
      const isScrubbing = isScrubbingRef.current;
      const seekThreshold = isScrubbing ? 0.25 : (player.isPlaying ? 0.1 : 0.05);
      
      if (timeDiff > seekThreshold && Number.isFinite(localTime)) {
        try {
          if (audioEl.readyState > 0) {
            audioEl.currentTime = Math.max(0, localTime);
          }
        } catch (err) {
          console.error('[DEBUG syncAudioVolumeAndPlayback] Seek error:', err);
        }
      }

      audioEl.playbackRate = player.playbackRate;
      const mutedByTrack = item.trackMuted === true;
      const targetVol = mutedByTrack || player.isMuted ? 0 : player.volume;
      
      if (audioEl.volume !== targetVol) audioEl.volume = targetVol;
      audioEl.muted = targetVol === 0;

      if (player.isPlaying) {
        if (audioEl.paused) {
          audioEl.play().catch((err) => {
            console.error('[DEBUG syncAudioVolumeAndPlayback] Audio play error:', err);
          });
        }
      } else {
        if (!audioEl.paused) {
          audioEl.pause();
        }
      }
    });
  }, [getActiveAudioClips, player.currentTime, player.isPlaying, player.isMuted, player.playbackRate, player.volume, audioRefs, isScrubbingRef]);

  const syncVideosDebounced = useCallback((forceSync: boolean = false) => {
    const now = performance.now();
    const timeSinceLastSync = now - lastSyncTimeRef.current;
    
    const isMobile = isMobileRef.current;
    const isScrubbing = isScrubbingRef.current;
    
    const PLAYING_SYNC_INTERVAL = isMobile ? 16 : 16;
    const SCRUBBING_SYNC_INTERVAL = isMobile ? 100 : 50;
    
    const MIN_SYNC_INTERVAL = isScrubbing ? SCRUBBING_SYNC_INTERVAL : PLAYING_SYNC_INTERVAL;
    const PAUSED_SYNC_INTERVAL = isMobile ? 50 : 33;
    
    const shouldSyncNow = forceSync ||
      (player.isPlaying && timeSinceLastSync >= MIN_SYNC_INTERVAL) ||
      (!player.isPlaying && timeSinceLastSync >= PAUSED_SYNC_INTERVAL);
    
    if (!shouldSyncNow) {
      if (syncDebounceRef.current === null) {
        syncDebounceRef.current = window.setTimeout(() => {
          syncDebounceRef.current = null;
          syncVideosDebounced(true);
        }, player.isPlaying ? MIN_SYNC_INTERVAL : PAUSED_SYNC_INTERVAL);
      }
      return;
    }
    
    lastSyncTimeRef.current = now;
    
    const currentTime = useEditorStore.getState().player.currentTime;
    const activeClips = getActiveClips();
    
    activeClips.forEach((item) => {
      if (item.media.type !== 'video') return;
      
      const videoEl = videoRefs.current[item.clip.id];
      if (!videoEl) return;

      if (videoEl.getAttribute('src') !== item.media.url) {
        videoEl.setAttribute('src', item.media.url);
        videoEl.load();
      }

      if (videoEl.playbackRate !== player.playbackRate) {
        videoEl.playbackRate = player.playbackRate;
      }

      const clipStart = item.clip.startTime;
      const localTime = currentTime - clipStart + item.clip.trimStart;
      
      const isScrubbing = isScrubbingRef.current;
      const scrubbingSeekThreshold = isMobile ? 0.25 : 0.15;
      const pausedSeekThreshold = 0.05;
      
      const seekThreshold = isScrubbing
        ? scrubbingSeekThreshold
        : (player.isPlaying ? Infinity : pausedSeekThreshold);
      
      const timeDiff = Math.abs(videoEl.currentTime - localTime);
      
      if (!player.isPlaying || isScrubbing) {
        if (timeDiff > seekThreshold) {
          if (!isSeekingRef.current) {
            isSeekingRef.current = true;
            if (videoEl.readyState > 0) {
              videoEl.currentTime = localTime;
            }
            setTimeout(() => {
              isSeekingRef.current = false;
            }, isMobile ? 100 : 50);
          }
        }
      }

      if (!isMobile || !player.isPlaying) {
        const clipFilter = filters[item.clip.id];
        if (clipFilter) {
          videoEl.style.filter = getCSSFilter(clipFilter);
        } else {
          videoEl.style.filter = 'none';
        }
      }
    });
    
    if (useMediaBunny && isMediaBunnyReady && canvasRef.current && (!player.isPlaying || forceSync)) {
      renderMediaBunny(currentTime, canvasRef.current.width, canvasRef.current.height).catch(console.error);
    }
    
    syncVideoVolumeAndPlayback();
    syncAudioVolumeAndPlayback();
  }, [player.isPlaying, filters, syncVideoVolumeAndPlayback, syncAudioVolumeAndPlayback, getActiveClips, isMobileRef, isScrubbingRef, player.playbackRate, useMediaBunny, isMediaBunnyReady, canvasRef, renderMediaBunny, videoRefs]);

  useEffect(() => {
    syncVideoVolumeAndPlayback();
    syncAudioVolumeAndPlayback();
  }, [syncVideoVolumeAndPlayback, syncAudioVolumeAndPlayback, player.volume, player.isMuted, player.playbackRate, audioMutedStates]);

  useEffect(() => {
    syncVideosDebounced();
    
    return () => {
      if (syncDebounceRef.current !== null) {
        clearTimeout(syncDebounceRef.current);
        syncDebounceRef.current = null;
      }
    };
  }, [syncVideosDebounced, audioMutedStates]);

  return { syncVideosDebounced };
};

export const useVideoPlayerAnimation = (
  player: any,
  previewSettings: any,
  hardwareProfile: any,
  isMobileRef: React.MutableRefObject<boolean>,
  isScrubbingRef: React.MutableRefObject<boolean>,
  frameRateLimiterRef: React.MutableRefObject<any>,
  performanceMonitorRef: React.MutableRefObject<any>,
  currentFps: number,
  setCurrentFps: any,
  isPerformancePoor: boolean,
  setIsPerformancePoor: any,
  lastAutoQualityChangeRef: React.MutableRefObject<number>,
  handleQualityChange: any,
  useMediaBunny: boolean,
  isMediaBunnyReady: boolean,
  canvasRef: React.RefObject<HTMLCanvasElement>,
  renderMediaBunny: any
) => {
  const animationRef = useRef<number>();
  const debugLogCounterRef = useRef<number>(0);
  const debugLastFrameTimeRef = useRef<number>(0);
  const debugFrameTimesRef = useRef<number[]>([]);
  const debugLastLogTimeRef = useRef<number>(0);
  const lastStateUpdateRef = useRef<number>(0);
  const AUTO_QUALITY_COOLDOWN = 5000;

  useEffect(() => {
    if (!player.isPlaying) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
      performanceMonitorRef.current?.reset();
      return;
    }

    let lastTime = performance.now();
    let isActive = true;
    let fpsUpdateCounter = 0;
    let accumulatedTime = 0;
    
    const isMobile = isMobileRef.current;
    const isLowEnd = previewSettings.quality === 'low';
    const targetFps = previewSettings.targetFps || 30;
    const MIN_TIME_STEP = 1000 / targetFps;
    const FPS_UPDATE_INTERVAL = (isMobile || isLowEnd) ? 60 : 30;
    
    debugLogCounterRef.current = 0;
    debugLastFrameTimeRef.current = performance.now();
    debugFrameTimesRef.current = [];
    debugLastLogTimeRef.current = performance.now();

    const handlePerformanceMonitoring = (currentTime: number) => {
      const perfMonitor = performanceMonitorRef.current;
      if (!perfMonitor) return;
      
      perfMonitor.recordFrame(currentTime);
      
      fpsUpdateCounter++;
      if (fpsUpdateCounter >= FPS_UPDATE_INTERVAL) {
        fpsUpdateCounter = 0;
        const fps = perfMonitor.getAverageFps();
        
        if (Math.abs(fps - currentFps) > 2) {
          setCurrentFps(fps);
        }
        
        const isPoor = perfMonitor.isPerformancePoor();
        if (isPoor !== isPerformancePoor) {
          setIsPerformancePoor(isPoor);
        }
        
        const nowPerf = performance.now();
        const timeSinceLastChange = nowPerf - lastAutoQualityChangeRef.current;
        
        if (isPoor && previewSettings.quality !== 'low' && timeSinceLastChange > AUTO_QUALITY_COOLDOWN) {
          const recommendation = perfMonitor.getQualityRecommendation();
          if (recommendation === 'decrease') {
            lastAutoQualityChangeRef.current = nowPerf;
            if (previewSettings.quality === 'original' || previewSettings.quality === 'high') {
              handleQualityChange('medium');
            } else if (previewSettings.quality === 'medium') {
              handleQualityChange('low');
            }
          }
        }
      }
    };

    const animate = (currentTime: number) => {
      if (!isActive) return;
      
      const frameTime = currentTime - debugLastFrameTimeRef.current;
      debugLastFrameTimeRef.current = currentTime;
      debugFrameTimesRef.current.push(frameTime);
      if (debugFrameTimesRef.current.length > 10) debugFrameTimesRef.current.shift();
      
      debugLogCounterRef.current++;
      const now = performance.now();
      const timeSinceLastLog = now - debugLastLogTimeRef.current;
      
      if (debugLogCounterRef.current >= 60 || timeSinceLastLog > 500) {
        debugLogCounterRef.current = 0;
        debugLastLogTimeRef.current = now;
      }
      
      const frameLimiter = frameRateLimiterRef.current;
      if (frameLimiter && !frameLimiter.shouldRenderFrame(currentTime)) {
        if (isActive) {
          animationRef.current = requestAnimationFrame(animate);
        }
        return;
      }
      
      handlePerformanceMonitoring(currentTime);
      
      const deltaTime = currentTime - lastTime;
      lastTime = currentTime;
      
      accumulatedTime += deltaTime;
      
      const nowUpdate = performance.now();
      const timeSinceLastUpdate = nowUpdate - lastStateUpdateRef.current;
      
      const isScrubbing = isScrubbingRef.current;
      const playingUpdateThreshold = (isMobile || isLowEnd) ? 33 : 16;
      const scrubbingUpdateThreshold = (isMobile || isLowEnd) ? 100 : 50;
      const updateThreshold = isScrubbing ? scrubbingUpdateThreshold : playingUpdateThreshold;
      
      if (accumulatedTime >= MIN_TIME_STEP && timeSinceLastUpdate >= updateThreshold) {
        const state = useEditorStore.getState();
        const timeAdvance = (accumulatedTime / 1000) * state.player.playbackRate;
        const newTime = state.player.currentTime + timeAdvance;
        
        accumulatedTime = 0;
        lastStateUpdateRef.current = nowUpdate;
        
        if (newTime >= state.projectDuration) {
          state.seek(0);
          state.pause();
        } else {
          state.seek(newTime);
        }
      }

      if (useMediaBunny && isMediaBunnyReady && canvasRef.current) {
        const state = useEditorStore.getState();
        const renderTime = state.player.currentTime; 
        renderMediaBunny(renderTime, canvasRef.current.width, canvasRef.current.height).catch(e => {
          console.error('MediaBunny render error:', e);
        });
      }

      if (useEditorStore.getState().player.isPlaying && isActive) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    frameRateLimiterRef.current?.reset();
    accumulatedTime = 0;
    lastStateUpdateRef.current = performance.now();
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      isActive = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
    };
  }, [player.isPlaying, previewSettings.quality, handleQualityChange, currentFps, isPerformancePoor, isMobileRef, isScrubbingRef, frameRateLimiterRef, performanceMonitorRef, lastAutoQualityChangeRef, useMediaBunny, isMediaBunnyReady, canvasRef, renderMediaBunny]);
};

export const useVideoPlayerText = (
  videoContainerRef: React.RefObject<HTMLDivElement>,
  player: any,
  pause: any,
  selectText: any,
  updateTextOverlay: any,
  textOverlays: any[]
) => {
  const [draggedTextId, setDraggedTextId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingTextValue, setEditingTextValue] = useState('');
  const [resizingTextId, setResizingTextId] = useState<string | null>(null);
  const [resizeCorner, setResizeCorner] = useState<string | null>(null);
  const [textResizeStart, setTextResizeStart] = useState({ x: 0, y: 0, fontSize: 16, textX: 0, textY: 0, scaleX: 1, scaleY: 1 });

  const handleTextMouseDown = useCallback((e: React.MouseEvent, textId: string) => {
    e.stopPropagation();
    if (player.isPlaying) {
      pause();
    }
    setDraggedTextId(textId);
    selectText(textId);
  }, [player.isPlaying, pause, selectText]);

  useEffect(() => {
    if (!draggedTextId || !videoContainerRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = videoContainerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;

      updateTextOverlay(draggedTextId, {
        x: Math.max(0, Math.min(100, x)),
        y: Math.max(0, Math.min(100, y))
      });
    };

    const handleMouseUp = () => {
      setDraggedTextId(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggedTextId, updateTextOverlay, videoContainerRef]);

  const handleTextResizeStart = useCallback((e: React.MouseEvent, textId: string, corner: string) => {
    e.stopPropagation();
    if (player.isPlaying) pause();

    const text = textOverlays.find(t => t.id === textId);
    if (!text) return;

    setResizingTextId(textId);
    setResizeCorner(corner);
    setTextResizeStart({
      x: e.clientX,
      y: e.clientY,
      fontSize: text.fontSize,
      textX: text.x,
      textY: text.y,
      scaleX: text.scaleX ?? 1,
      scaleY: text.scaleY ?? 1
    });
  }, [player.isPlaying, pause, textOverlays]);

  useEffect(() => {
    if (!resizingTextId || !resizeCorner || !videoContainerRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = videoContainerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const centerX = rect.left + (rect.width * textResizeStart.textX) / 100;
      const centerY = rect.top + (rect.height * textResizeStart.textY) / 100;

      let newScaleX = textResizeStart.scaleX;
      let newScaleY = textResizeStart.scaleY;

      if (['n', 's'].includes(resizeCorner)) {
        const startDist = Math.abs(textResizeStart.y - centerY);
        const currentDist = Math.abs(e.clientY - centerY);
        if (startDist > 0) {
          const ratio = currentDist / startDist;
          newScaleY = Math.max(0.1, Math.min(10, textResizeStart.scaleY * ratio));
        }
      } else if (['e', 'w'].includes(resizeCorner)) {
        const startDist = Math.abs(textResizeStart.x - centerX);
        const currentDist = Math.abs(e.clientX - centerX);
        if (startDist > 0) {
          const ratio = currentDist / startDist;
          newScaleX = Math.max(0.1, Math.min(10, textResizeStart.scaleX * ratio));
        }
      } else {
        const startDist = Math.sqrt(
          Math.pow(textResizeStart.x - centerX, 2) + 
          Math.pow(textResizeStart.y - centerY, 2)
        );
        const currentDist = Math.sqrt(
          Math.pow(e.clientX - centerX, 2) + 
          Math.pow(e.clientY - centerY, 2)
        );
        if (startDist > 0) {
          const ratio = currentDist / startDist;
          newScaleX = Math.max(0.1, Math.min(10, textResizeStart.scaleX * ratio));
          newScaleY = Math.max(0.1, Math.min(10, textResizeStart.scaleY * ratio));
        }
      }
      
      updateTextOverlay(resizingTextId, { 
        scaleX: newScaleX,
        scaleY: newScaleY
      });
    };

    const handleMouseUp = () => {
      setResizingTextId(null);
      setResizeCorner(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingTextId, resizeCorner, textResizeStart, updateTextOverlay, videoContainerRef]);

  const handleTextDoubleClick = useCallback((e: React.MouseEvent, textId: string, currentText: string) => {
    e.stopPropagation();
    setEditingTextId(textId);
    setEditingTextValue(currentText);
    if (player.isPlaying) {
      pause();
    }
  }, [player.isPlaying, pause]);

  const handleTextEditChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEditingTextValue(e.target.value);
  }, []);

  const handleTextEditSubmit = useCallback(() => {
    if (editingTextId) {
      updateTextOverlay(editingTextId, { text: editingTextValue });
      setEditingTextId(null);
    }
  }, [editingTextId, editingTextValue, updateTextOverlay]);

  const handleTextEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleTextEditSubmit();
    } else if (e.key === 'Escape') {
      setEditingTextId(null);
    }
    e.stopPropagation();
  }, [handleTextEditSubmit]);

  return {
    draggedTextId,
    editingTextId,
    editingTextValue,
    resizingTextId,
    handleTextMouseDown,
    handleTextResizeStart,
    handleTextDoubleClick,
    handleTextEditChange,
    handleTextEditSubmit,
    handleTextEditKeyDown
  };
};

export const useVideoPlayerImage = (
  videoContainerRef: React.RefObject<HTMLDivElement>,
  player: any,
  pause: any,
  tracks: any[],
  updateClip: any
) => {
  const [transformingImageId, setTransformingImageId] = useState<string | null>(null);
  const [transformStart, setTransformStart] = useState<{ x: number; y: number; transform: TransformSettings }>({ x: 0, y: 0, transform: { x: 50, y: 50, scale: 100, rotation: 0 } });
  const [resizingImageId, setResizingImageId] = useState<string | null>(null);
  const [resizeCorner, setResizeCorner] = useState<string | null>(null);
  const [rotatingImageId, setRotatingImageId] = useState<string | null>(null);
  const [rotationStart, setRotationStart] = useState({ angle: 0, centerX: 0, centerY: 0 });

  const handleImageTransformStart = useCallback((e: React.MouseEvent, clipId: string) => {
    e.stopPropagation();
    if (player.isPlaying) {
      pause();
    }

    const clip = tracks.flatMap(t => t.clips).find(c => c.id === clipId);
    if (!clip) return;

    const currentTransform = clip.transform || { x: 50, y: 50, scale: 100, rotation: 0 };
    
    setTransformingImageId(clipId);
    setTransformStart({
      x: e.clientX,
      y: e.clientY,
      transform: { ...currentTransform }
    });
  }, [player.isPlaying, pause, tracks]);

  useEffect(() => {
    if (!transformingImageId || !videoContainerRef.current) return;

    const clip = tracks.flatMap(t => t.clips).find(c => c.id === transformingImageId);
    if (!clip) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = videoContainerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const deltaX = ((e.clientX - transformStart.x) / rect.width) * 100;
      const deltaY = ((e.clientY - transformStart.y) / rect.height) * 100;

      updateClip(transformingImageId, {
        transform: {
          ...transformStart.transform,
          x: Math.max(0, Math.min(100, transformStart.transform.x + deltaX)),
          y: Math.max(0, Math.min(100, transformStart.transform.y + deltaY))
        }
      });
    };

    const handleMouseUp = () => {
      setTransformingImageId(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [transformingImageId, transformStart, tracks, updateClip, videoContainerRef]);

  const handleImageResizeStart = useCallback((e: React.MouseEvent, clipId: string, corner: string) => {
    e.stopPropagation();
    if (player.isPlaying) pause();

    const clip = tracks.flatMap(t => t.clips).find(c => c.id === clipId);
    if (!clip) return;

    const currentTransform = clip.transform || { x: 50, y: 50, scale: 100, rotation: 0 };
    
    setResizingImageId(clipId);
    setResizeCorner(corner);
    setTransformStart({
      x: e.clientX,
      y: e.clientY,
      transform: { ...currentTransform }
    });
  }, [player.isPlaying, pause, tracks]);

  const calculateNewScales = useCallback((
    e: MouseEvent,
    centerX: number,
    centerY: number,
    currentScaleX: number,
    currentScaleY: number
  ) => {
    let newScaleX = currentScaleX;
    let newScaleY = currentScaleY;

    if (resizeCorner === 'n' || resizeCorner === 's') {
      const startDist = Math.abs(transformStart.y - centerY);
      const currentDist = Math.abs(e.clientY - centerY);
      if (startDist > 0) {
        const ratio = currentDist / startDist;
        newScaleY = Math.max(10, Math.min(500, currentScaleY * ratio));
      }
    } else if (resizeCorner === 'e' || resizeCorner === 'w') {
      const startDist = Math.abs(transformStart.x - centerX);
      const currentDist = Math.abs(e.clientX - centerX);
      if (startDist > 0) {
        const ratio = currentDist / startDist;
        newScaleX = Math.max(10, Math.min(500, currentScaleX * ratio));
      }
    } else {
      const startDist = Math.sqrt(
        Math.pow(transformStart.x - centerX, 2) + 
        Math.pow(transformStart.y - centerY, 2)
      );
      const currentDist = Math.sqrt(
        Math.pow(e.clientX - centerX, 2) + 
        Math.pow(e.clientY - centerY, 2)
      );
      if (startDist > 0) {
        const ratio = currentDist / startDist;
        newScaleX = Math.max(10, Math.min(500, currentScaleX * ratio));
        newScaleY = Math.max(10, Math.min(500, currentScaleY * ratio));
      }
    }

    return { newScaleX, newScaleY };
  }, [resizeCorner, transformStart]);

  useEffect(() => {
    if (!resizingImageId || !resizeCorner || !videoContainerRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = videoContainerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const centerX = rect.left + (rect.width * transformStart.transform.x) / 100;
      const centerY = rect.top + (rect.height * transformStart.transform.y) / 100;

      const currentScaleX = transformStart.transform.scaleX ?? transformStart.transform.scale;
      const currentScaleY = transformStart.transform.scaleY ?? transformStart.transform.scale;

      const { newScaleX, newScaleY } = calculateNewScales(e, centerX, centerY, currentScaleX, currentScaleY);

      updateClip(resizingImageId, {
        transform: {
          ...transformStart.transform,
          scaleX: newScaleX,
          scaleY: newScaleY,
          scale: Math.max(newScaleX, newScaleY)
        }
      });
    };

    const handleMouseUp = () => {
      setResizingImageId(null);
      setResizeCorner(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingImageId, resizeCorner, transformStart, updateClip, videoContainerRef, calculateNewScales]);

  const handleImageRotateStart = useCallback((e: React.MouseEvent, clipId: string) => {
    e.stopPropagation();
    if (player.isPlaying) pause();

    const clip = tracks.flatMap(t => t.clips).find(c => c.id === clipId);
    if (!clip) return;

    const rect = videoContainerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const transform = clip.transform || { x: 50, y: 50, scale: 100, rotation: 0 };
    const centerX = rect.left + (rect.width * transform.x) / 100;
    const centerY = rect.top + (rect.height * transform.y) / 100;
    
    const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);

    setRotatingImageId(clipId);
    setRotationStart({
      angle: angle - transform.rotation,
      centerX,
      centerY
    });
    setTransformStart({
      x: e.clientX,
      y: e.clientY,
      transform: { ...transform }
    });
  }, [player.isPlaying, pause, tracks, videoContainerRef]);

  useEffect(() => {
    if (!rotatingImageId || !videoContainerRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      const currentAngle = Math.atan2(
        e.clientY - rotationStart.centerY,
        e.clientX - rotationStart.centerX
      ) * (180 / Math.PI);
      
      const rotation = currentAngle - rotationStart.angle;

      updateClip(rotatingImageId, {
        transform: {
          ...transformStart.transform,
          rotation: Math.round(rotation)
        }
      });
    };

    const handleMouseUp = () => {
      setRotatingImageId(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [rotatingImageId, rotationStart, transformStart, updateClip, videoContainerRef]);

  return {
    transformingImageId,
    resizingImageId,
    rotatingImageId,
    handleImageTransformStart,
    handleImageResizeStart,
    handleImageRotateStart
  };
};

export const useVideoPlayerCrop = (
  videoContainerRef: React.RefObject<HTMLDivElement>,
  player: any,
  pause: any,
  ui: any,
  updateClip: any,
  getActiveClips: any
) => {
  const [cropMode, setCropMode] = useState(false);
  const [cropArea, setCropArea] = useState({ x: 0, y: 0, width: 100, height: 100, locked: false });
  const [resizingCrop, setResizingCrop] = useState<string | null>(null);
  const [cropDragStart, setCropDragStart] = useState({ x: 0, y: 0, crop: { x: 0, y: 0, width: 100, height: 100 } });

  const handleToggleCrop = useCallback(() => {
    const nextMode = !cropMode;
    setCropMode(nextMode);
    
    if (nextMode) {
      if (player.isPlaying) {
        pause();
      }
      const activeClips = getActiveClips();
      const mainClip = activeClips.find((c: any) => c.clip.id === ui.selectedClipId) || activeClips[0];
      
      if (mainClip) {
        const crop = mainClip.clip.crop || { x: 0, y: 0, width: 100, height: 100, locked: false };
        setCropArea(crop);
      }
    }
  }, [cropMode, player.isPlaying, pause, getActiveClips, ui.selectedClipId]);

  const handleApplyCrop = useCallback(() => {
    if (ui.selectedClipId) {
      updateClip(ui.selectedClipId, { crop: cropArea });
      setCropMode(false);
    }
  }, [ui.selectedClipId, updateClip, cropArea]);

  const handleCropResizeStart = useCallback((e: React.MouseEvent, handle: string) => {
    e.stopPropagation();
    setResizingCrop(handle);
    setCropDragStart({
      x: e.clientX,
      y: e.clientY,
      crop: { ...cropArea }
    });
  }, [cropArea]);

  const calculateNewCropEdge = useCallback((
    handle: string,
    deltaX: number,
    deltaY: number,
    crop: { x: number; y: number; width: number; height: number }
  ): { x: number; y: number; width: number; height: number } | null => {
    switch (handle) {
      case 'nw': {
        const newX = Math.max(0, Math.min(crop.x + crop.width - 5, crop.x + deltaX));
        const newY = Math.max(0, Math.min(crop.y + crop.height - 5, crop.y + deltaY));
        return {
          width: crop.width + (crop.x - newX),
          height: crop.height + (crop.y - newY),
          x: newX,
          y: newY
        };
      }
      case 'ne': {
        const newY = Math.max(0, Math.min(crop.y + crop.height - 5, crop.y + deltaY));
        return {
          width: Math.max(5, Math.min(100 - crop.x, crop.width + deltaX)),
          height: crop.height + (crop.y - newY),
          y: newY,
          x: crop.x
        };
      }
      case 'sw': {
        const newX = Math.max(0, Math.min(crop.x + crop.width - 5, crop.x + deltaX));
        return {
          width: crop.width + (crop.x - newX),
          height: Math.max(5, Math.min(100 - crop.y, crop.height + deltaY)),
          x: newX,
          y: crop.y
        };
      }
      case 'se':
        return {
          width: Math.max(5, Math.min(100 - crop.x, crop.width + deltaX)),
          height: Math.max(5, Math.min(100 - crop.y, crop.height + deltaY)),
          x: crop.x,
          y: crop.y
        };
      case 'n': {
        const newY = Math.max(0, Math.min(crop.y + crop.height - 5, crop.y + deltaY));
        return {
          height: crop.height + (crop.y - newY),
          y: newY,
          width: crop.width,
          x: crop.x
        };
      }
      case 's':
        return {
          height: Math.max(5, Math.min(100 - crop.y, crop.height + deltaY)),
          width: crop.width,
          x: crop.x,
          y: crop.y
        };
      case 'w': {
        const newX = Math.max(0, Math.min(crop.x + crop.width - 5, crop.x + deltaX));
        return {
          width: crop.width + (crop.x - newX),
          x: newX,
          height: crop.height,
          y: crop.y
        };
      }
      case 'e':
        return {
          width: Math.max(5, Math.min(100 - crop.x, crop.width + deltaX)),
          height: crop.height,
          x: crop.x,
          y: crop.y
        };
      default:
        return null;
    }
  }, []);

  const calculateNewCrop = useCallback((deltaX: number, deltaY: number, crop: any) => {
    const result = calculateNewCropEdge(resizingCrop || '', deltaX, deltaY, crop);
    return result || { ...cropArea };
  }, [calculateNewCropEdge, resizingCrop, cropArea]);

  useEffect(() => {
    if (!resizingCrop || !videoContainerRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = videoContainerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const deltaX = ((e.clientX - cropDragStart.x) / rect.width) * 100;
      const deltaY = ((e.clientY - cropDragStart.y) / rect.height) * 100;

      const { crop } = cropDragStart;
      const newCrop = calculateNewCrop(deltaX, deltaY, crop);

      setCropArea({ ...newCrop, locked: cropArea.locked });
    };

    const handleMouseUp = () => {
      setResizingCrop(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingCrop, cropDragStart, calculateNewCrop, videoContainerRef]);

  return {
    cropMode,
    setCropMode,
    cropArea,
    setCropArea,
    handleToggleCrop,
    handleApplyCrop,
    handleCropResizeStart
  };
};
