// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useRef, useEffect, useState, useCallback, useMemo, useLayoutEffect } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  ChevronLeft,
  ChevronRight,
  Settings,
  Crop,
  Gauge
} from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { formatTime, getCSSFilter } from '../utils/helpers';
import type { TimelineClip, MediaFile, TransformSettings } from '../types';
import {
  initializePreviewOptimizer,
  getOptimalSettings,
  applyVideoOptimizations,
  optimizeMobilePlayback,
  getMobileVideoAttributes,
  FrameRateLimiter,
  PerformanceMonitor,
  getHardwareProfile,
  getCurrentSettings,
  updateSettings,
  PreviewSettings,
  HardwareProfile,
  PREVIEW_RESOLUTIONS,
} from '../utils/previewOptimizer';

export const VideoPlayer: React.FC = () => {
  const {
    mediaFiles,
    tracks,
    textOverlays,
    transitions,
    filters,
    aspectRatio,
    player,
    projectDuration,
    ui,
    play,
    pause,
    togglePlayPause,
    seek,
    setVolume,
    toggleMute,
    setPlaybackRate,
    toggleFullscreen,
    updateTextOverlay,
    selectText,
    updateClip,
    selectClip,
  } = useEditorStore();

  const videoRefs = useRef<{ [key: string]: HTMLVideoElement | null }>({});
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();
  const frameRateLimiterRef = useRef<FrameRateLimiter | null>(null);
  const performanceMonitorRef = useRef<PerformanceMonitor | null>(null);
  
  // Refs for smooth video synchronization
  const lastSyncTimeRef = useRef<number>(0);
  const syncDebounceRef = useRef<number | null>(null);
  const isSeekingRef = useRef<boolean>(false);
  const pendingSeekRef = useRef<number | null>(null);
  const preloadedClipsRef = useRef<Set<string>>(new Set());
  
  // Mobile optimization refs
  const isMobileRef = useRef<boolean>(false);
  const lastStateUpdateRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [cropMode, setCropMode] = useState(false);
  const [draggedTextId, setDraggedTextId] = useState<string | null>(null);
  const [cropArea, setCropArea] = useState({ x: 0, y: 0, width: 100, height: 100, locked: false });
  const [resizingCrop, setResizingCrop] = useState<string | null>(null); // 'nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w', or null
  const [cropDragStart, setCropDragStart] = useState({ x: 0, y: 0, crop: { x: 0, y: 0, width: 100, height: 100 } });
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingTextValue, setEditingTextValue] = useState('');
  const [transformingImageId, setTransformingImageId] = useState<string | null>(null);
  const [transformStart, setTransformStart] = useState<{ x: number; y: number; transform: TransformSettings }>({ x: 0, y: 0, transform: { x: 50, y: 50, scale: 100, rotation: 0 } });
  const [resizingImageId, setResizingImageId] = useState<string | null>(null);
  const [resizeCorner, setResizeCorner] = useState<string | null>(null);
  const [rotatingImageId, setRotatingImageId] = useState<string | null>(null);
  const [rotationStart, setRotationStart] = useState({ angle: 0, centerX: 0, centerY: 0 });
  const [resizingTextId, setResizingTextId] = useState<string | null>(null);
  const [textResizeStart, setTextResizeStart] = useState({ x: 0, y: 0, fontSize: 16, textX: 0, textY: 0, scaleX: 1, scaleY: 1 });
  
  // Preview optimization state
  const [previewSettings, setPreviewSettings] = useState<PreviewSettings>(() => getCurrentSettings());
  const [hardwareProfile, setHardwareProfile] = useState<HardwareProfile | null>(null);
  const [currentFps, setCurrentFps] = useState<number>(30);
  const [isPerformancePoor, setIsPerformancePoor] = useState(false);
  const [autoQualityApplied, setAutoQualityApplied] = useState(false);
  
  // Initialize preview optimizer on mount - AUTO QUALITY FROM START
  useEffect(() => {
    const profile = initializePreviewOptimizer();
    setHardwareProfile(profile);
    
    // Store mobile status in ref for performance
    isMobileRef.current = profile.isMobile;
    
    // Get optimal settings based on detected hardware
    const settings = getOptimalSettings(1920, 1080, profile);
    
    // IMPORTANT: Set the quality to the recommended value from hardware detection
    // This ensures auto-adaptation from the very beginning
    settings.quality = profile.recommendedQuality;
    
    // Apply the auto-detected settings immediately
    setPreviewSettings(settings);
    updateSettings(settings);
    
    frameRateLimiterRef.current = new FrameRateLimiter(settings.targetFps, settings.frameSkipping);
    performanceMonitorRef.current = new PerformanceMonitor();
    
    setAutoQualityApplied(true);
    
    console.log('🎬 VideoPlayer: Preview optimizer initialized with AUTO quality', {
      profile,
      settings,
      recommendedQuality: profile.recommendedQuality,
      cpuCores: profile.cpuCores,
      isLowEnd: profile.isLowEnd,
      isMobile: profile.isMobile
    });
    
    return () => {
      frameRateLimiterRef.current = null;
      performanceMonitorRef.current = null;
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);
  
  // Debug: Log aspect ratio changes
  useEffect(() => {
    console.log('🖼️ VideoPlayer: aspect ratio changed to', aspectRatio);
  }, [aspectRatio]);
  
  // Update preview settings when quality changes
  const handleQualityChange = useCallback((quality: PreviewSettings['quality']) => {
    const newSettings = updateSettings({ quality });
    
    // Recalculate based on quality
    switch (quality) {
      case 'low':
        newSettings.maxResolution = PREVIEW_RESOLUTIONS.low;
        newSettings.targetFps = 24;
        newSettings.frameSkipping = true;
        break;
      case 'medium':
        newSettings.maxResolution = PREVIEW_RESOLUTIONS.medium;
        newSettings.targetFps = 30;
        newSettings.frameSkipping = hardwareProfile?.isLowEnd ?? false;
        break;
      case 'high':
        newSettings.maxResolution = PREVIEW_RESOLUTIONS.high;
        newSettings.targetFps = 30;
        newSettings.frameSkipping = false;
        break;
      case 'original':
        newSettings.maxResolution = -1;
        newSettings.targetFps = 60;
        newSettings.frameSkipping = false;
        break;
      case 'auto':
        // Re-detect optimal settings
        if (hardwareProfile) {
          const autoSettings = getOptimalSettings(1920, 1080, hardwareProfile);
          Object.assign(newSettings, autoSettings);
        }
        break;
    }
    
    setPreviewSettings(newSettings);
    
    // Update frame rate limiter
    if (frameRateLimiterRef.current) {
      frameRateLimiterRef.current.setTargetFps(newSettings.targetFps);
      frameRateLimiterRef.current.setFrameSkipping(newSettings.frameSkipping);
    }
    
    setShowQualityMenu(false);
    console.log('🎬 Preview quality changed to:', quality, newSettings);
  }, [hardwareProfile]);
  
  // Get all active clips at playhead position, sorted by track index (bottom to top)
  const getActiveClips = useCallback(() => {
    const activeClips: { clip: TimelineClip; media: MediaFile; trackIndex: number }[] = [];
    
    tracks.forEach((track, index) => {
      if (track.type !== 'video' || track.muted) return;
      
      const clip = track.clips.find(c => {
        const clipStart = c.startTime;
        const clipEnd = c.startTime + (c.duration - c.trimStart - c.trimEnd);
        return player.currentTime >= clipStart && player.currentTime < clipEnd;
      });
      
      if (clip) {
        const media = mediaFiles.find(m => m.id === clip.mediaId);
        if (media) {
          activeClips.push({ clip, media, trackIndex: index });
        }
      }
    });
    
    return activeClips;
  }, [tracks, mediaFiles, player.currentTime]);

  // Get current text overlays
  const getCurrentTextOverlays = useCallback(() => {
    return textOverlays.filter(text => {
      const start = text.startTime;
      const end = text.startTime + text.duration;
      return player.currentTime >= start && player.currentTime < end;
    });
  }, [textOverlays, player.currentTime]);

  // Calculate transition style
  const getTransitionStyle = (clip: TimelineClip, currentTime: number) => {
    const clipTransitions = transitions.filter(t => t.clipId === clip.id);
    if (clipTransitions.length === 0) return {};

    let style: React.CSSProperties = {};

    clipTransitions.forEach(transition => {
      if (transition.type === 'none') return;

      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + (clip.duration - clip.trimStart - clip.trimEnd);
      let progress = 0;

      if (transition.position === 'start' || !transition.position) {
        progress = (currentTime - clipStart) / transition.duration;
      } else {
        progress = (clipEnd - currentTime) / transition.duration;
      }

      if (progress >= 0 && progress <= 1) {
        const p = progress;
        const inv = 1 - p;

        switch (transition.type) {
          case 'fade':
          case 'dissolve':
          case 'cross-dissolve':
            style.opacity = p;
            break;
          case 'zoom-in':
            style.transform = `scale(${p})`;
            style.opacity = p;
            break;
          case 'zoom-out':
            style.transform = `scale(${1.5 - p * 0.5})`;
            style.opacity = p;
            break;
          case 'slide-left':
            style.transform = transition.position === 'end' 
              ? `translateX(${-inv * 100}%)` 
              : `translateX(${inv * 100}%)`;
            break;
          case 'slide-right':
            style.transform = transition.position === 'end' 
              ? `translateX(${inv * 100}%)` 
              : `translateX(${-inv * 100}%)`;
            break;
          case 'slide-up':
            style.transform = transition.position === 'end' 
              ? `translateY(${-inv * 100}%)` 
              : `translateY(${inv * 100}%)`;
            break;
          case 'slide-down':
            style.transform = transition.position === 'end' 
              ? `translateY(${inv * 100}%)` 
              : `translateY(${-inv * 100}%)`;
            break;
          case 'slide-diagonal-tl':
            style.transform = transition.position === 'end'
              ? `translate(${-inv * 100}%, ${-inv * 100}%)`
              : `translate(${inv * 100}%, ${inv * 100}%)`;
            break;
          case 'slide-diagonal-tr':
            style.transform = transition.position === 'end'
              ? `translate(${inv * 100}%, ${-inv * 100}%)`
              : `translate(${-inv * 100}%, ${inv * 100}%)`;
            break;
          case 'wipe-left':
            style.clipPath = transition.position === 'end'
              ? `inset(0 ${inv * 100}% 0 0)`
              : `inset(0 0 0 ${inv * 100}%)`;
            break;
          case 'wipe-right':
            style.clipPath = transition.position === 'end'
              ? `inset(0 0 0 ${inv * 100}%)`
              : `inset(0 ${inv * 100}% 0 0)`;
            break;
          case 'wipe-up':
            style.clipPath = transition.position === 'end'
              ? `inset(0 0 ${inv * 100}% 0)`
              : `inset(0 0 0 0)`; // TODO: Fix wipe-up logic if needed, inset(top right bottom left)
            // Actually for wipe-up (reveal from bottom):
            // Start: inset(100% 0 0 0) -> inset(0 0 0 0)
            // End: inset(0 0 0 0) -> inset(100% 0 0 0) (wipe out to top?)
            // Let's stick to standard wipe logic:
            style.clipPath = transition.position === 'end'
              ? `inset(0 0 ${inv * 100}% 0)`
              : `inset(${inv * 100}% 0 0 0)`;
            break;
          case 'wipe-down':
            style.clipPath = transition.position === 'end'
              ? `inset(${inv * 100}% 0 0 0)`
              : `inset(0 0 ${inv * 100}% 0)`;
            break;
          case 'rotate-in':
            style.transform = `rotate(${inv * -180}deg) scale(${p})`;
            style.opacity = p;
            break;
          case 'rotate-out':
            style.transform = `rotate(${inv * 180}deg) scale(${p})`;
            style.opacity = p;
            break;
          case 'circle-wipe':
            style.clipPath = `circle(${p * 100}% at 50% 50%)`;
            break;
          case 'diamond-wipe':
            style.clipPath = `polygon(50% ${50 - p * 100}%, ${50 + p * 100}% 50%, 50% ${50 + p * 100}%, ${50 - p * 100}% 50%)`;
            break;
          default:
            style.opacity = p;
        }
      }
    });

    return style;
  };

  // Create a dependency string for audioMuted states to trigger re-render when they change
  const audioMutedStates = useMemo(() => {
    return tracks
      .flatMap(t => t.clips)
      .filter(c => c.type === 'video')
      .map(c => `${c.id}:${c.audioMuted}`)
      .join(',');
  }, [tracks]);

  // Sync video volume and playback state immediately (no debounce for audio)
  const syncVideoVolumeAndPlayback = useCallback(() => {
    const activeClips = getActiveClips();
    
    activeClips.forEach((item) => {
      if (item.media.type !== 'video') return;
      
      const videoEl = videoRefs.current[item.clip.id];
      if (!videoEl) return;

      // Determine if this is the "main" video (bottom-most video track)
      const isMainVideo = activeClips.find(c => c.media.type === 'video')?.clip.id === item.clip.id;

      // Only the main video gets volume, others are muted to prevent echo
      const isAudioMuted = item.clip.audioMuted === true;
      const targetVolume = isMainVideo && !isAudioMuted ? (player.isMuted ? 0 : player.volume) : 0;
      
      // Always apply volume immediately
      if (videoEl.volume !== targetVolume) {
        videoEl.volume = targetVolume;
      }
      
      videoEl.playbackRate = player.playbackRate;

      if (player.isPlaying) {
        if (videoEl.paused) {
          videoEl.play().catch(() => {});
        }
      } else {
        if (!videoEl.paused) {
          videoEl.pause();
        }
      }
    });
  }, [player.isPlaying, player.volume, player.isMuted, player.playbackRate, getActiveClips]);

  // Debounced video sync function to prevent stuttering during rapid navigation
  // This only handles time sync and filters, NOT volume/playback
  const syncVideosDebounced = useCallback((forceSync: boolean = false) => {
    const now = performance.now();
    const timeSinceLastSync = now - lastSyncTimeRef.current;
    
    // MOBILE OPTIMIZATION: Use longer intervals on mobile to reduce CPU load
    const isMobile = isMobileRef.current;
    const MIN_SYNC_INTERVAL = isMobile ? 33 : 16; // ~30fps on mobile, ~60fps on desktop
    const PAUSED_SYNC_INTERVAL = isMobile ? 100 : 50; // Longer debounce when paused on mobile
    
    // If we're playing, sync immediately but throttled
    // If we're seeking (not playing), debounce more aggressively
    const shouldSyncNow = forceSync ||
      (player.isPlaying && timeSinceLastSync >= MIN_SYNC_INTERVAL) ||
      (!player.isPlaying && timeSinceLastSync >= PAUSED_SYNC_INTERVAL);
    
    if (!shouldSyncNow) {
      // Schedule a sync for later if not already scheduled
      if (syncDebounceRef.current === null) {
        syncDebounceRef.current = window.setTimeout(() => {
          syncDebounceRef.current = null;
          syncVideosDebounced(true);
        }, player.isPlaying ? MIN_SYNC_INTERVAL : PAUSED_SYNC_INTERVAL);
      }
      return;
    }
    
    lastSyncTimeRef.current = now;
    
    const activeClips = getActiveClips();
    
    // Sync all active video clips - time and filters only
    activeClips.forEach((item) => {
      if (item.media.type !== 'video') return;
      
      const videoEl = videoRefs.current[item.clip.id];
      if (!videoEl) return;

      // Only update src if it changed
      if (videoEl.src !== item.media.url) {
        videoEl.src = item.media.url;
        videoEl.load();
      }

      const clipStart = item.clip.startTime;
      const localTime = player.currentTime - clipStart + item.clip.trimStart;
      
      // MOBILE OPTIMIZATION: Use larger seek threshold on mobile
      // This prevents micro-seeks that cause stuttering
      const seekThreshold = isMobile
        ? (player.isPlaying ? 0.25 : 0.1) // Larger threshold on mobile
        : (player.isPlaying ? 0.15 : 0.05);
      const timeDiff = Math.abs(videoEl.currentTime - localTime);
      
      if (timeDiff > seekThreshold) {
        // Mark as seeking to prevent race conditions
        if (!isSeekingRef.current) {
          isSeekingRef.current = true;
          videoEl.currentTime = localTime;
          
          // Reset seeking flag after a short delay (longer on mobile)
          setTimeout(() => {
            isSeekingRef.current = false;
          }, isMobile ? 100 : 50);
        }
      }

      // MOBILE OPTIMIZATION: Only apply filters when paused or on desktop
      // Filters are expensive on mobile during playback
      if (!isMobile || !player.isPlaying) {
        const clipFilter = filters[item.clip.id];
        if (clipFilter) {
          videoEl.style.filter = getCSSFilter(clipFilter);
        } else {
          videoEl.style.filter = 'none';
        }
      }
    });
    
    // Always sync volume and playback state immediately after time sync
    syncVideoVolumeAndPlayback();
  }, [player.currentTime, player.isPlaying, getActiveClips, filters, syncVideoVolumeAndPlayback]);
  
  // Sync volume and playback immediately when these change (no debounce)
  useEffect(() => {
    syncVideoVolumeAndPlayback();
  }, [syncVideoVolumeAndPlayback, player.volume, player.isMuted, player.playbackRate, audioMutedStates]);

  // Update video playback with optimized sync
  useEffect(() => {
    syncVideosDebounced();
    
    // Cleanup debounce timer on unmount
    return () => {
      if (syncDebounceRef.current !== null) {
        clearTimeout(syncDebounceRef.current);
        syncDebounceRef.current = null;
      }
    };
  }, [syncVideosDebounced, audioMutedStates]);
  
  // Preload adjacent clips for smoother transitions
  useEffect(() => {
    const activeClips = getActiveClips();
    
    // Find clips that will be active soon (within 2 seconds)
    const upcomingClips: string[] = [];
    
    tracks.forEach((track) => {
      if (track.type !== 'video') return;
      
      track.clips.forEach((clip) => {
        const clipStart = clip.startTime;
        const clipEnd = clip.startTime + (clip.duration - clip.trimStart - clip.trimEnd);
        
        // Check if clip starts within the next 2 seconds
        if (clipStart > player.currentTime && clipStart <= player.currentTime + 2) {
          upcomingClips.push(clip.id);
        }
      });
    });
    
    // Preload upcoming clips
    upcomingClips.forEach((clipId) => {
      if (preloadedClipsRef.current.has(clipId)) return;
      
      const clip = tracks.flatMap(t => t.clips).find(c => c.id === clipId);
      if (!clip) return;
      
      const media = mediaFiles.find(m => m.id === clip.mediaId);
      if (!media || media.type !== 'video') return;
      
      // Create a hidden video element to preload
      const preloadVideo = document.createElement('video');
      preloadVideo.preload = 'auto';
      preloadVideo.muted = true;
      preloadVideo.src = media.url;
      preloadVideo.currentTime = clip.trimStart;
      
      preloadedClipsRef.current.add(clipId);
      
      // Clean up after 10 seconds
      setTimeout(() => {
        preloadedClipsRef.current.delete(clipId);
        preloadVideo.src = '';
      }, 10000);
    });
  }, [player.currentTime, tracks, mediaFiles, getActiveClips]);

  // Animation loop for playback with frame rate limiting
  useEffect(() => {
    if (!player.isPlaying) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
      // Reset performance monitor when paused
      performanceMonitorRef.current?.reset();
      return;
    }

    let lastTime = performance.now();
    let isActive = true;
    let fpsUpdateCounter = 0;
    let accumulatedTime = 0;
    
    // MOBILE OPTIMIZATION: Use lower update rate on mobile
    const isMobile = isMobileRef.current;
    const MIN_TIME_STEP = isMobile ? 1000 / 30 : 1000 / 60; // 30fps on mobile, 60fps on desktop
    const FPS_UPDATE_INTERVAL = isMobile ? 60 : 30; // Update FPS display less often on mobile

    const animate = (currentTime: number) => {
      if (!isActive) return;
      
      // Frame rate limiting for smooth playback on low-end devices
      const frameLimiter = frameRateLimiterRef.current;
      if (frameLimiter && !frameLimiter.shouldRenderFrame(currentTime)) {
        // Skip this frame but keep the loop running
        if (isActive) {
          animationRef.current = requestAnimationFrame(animate);
        }
        return;
      }
      
      // Record frame for performance monitoring
      const perfMonitor = performanceMonitorRef.current;
      if (perfMonitor) {
        perfMonitor.recordFrame(currentTime);
        
        // Update FPS display periodically (less often on mobile)
        fpsUpdateCounter++;
        if (fpsUpdateCounter >= FPS_UPDATE_INTERVAL) {
          fpsUpdateCounter = 0;
          const fps = perfMonitor.getAverageFps();
          
          // MOBILE OPTIMIZATION: Batch state updates
          // Only update if FPS changed significantly
          if (Math.abs(fps - currentFps) > 2) {
            setCurrentFps(fps);
          }
          
          // Check for poor performance and auto-adjust
          const isPoor = perfMonitor.isPerformancePoor();
          if (isPoor !== isPerformancePoor) {
            setIsPerformancePoor(isPoor);
          }
          
          // Auto-adjust quality if performance is poor
          if (isPoor && previewSettings.quality !== 'low') {
            const recommendation = perfMonitor.getQualityRecommendation();
            if (recommendation === 'decrease') {
              console.log('⚠️ Poor performance detected, reducing quality');
              if (previewSettings.quality === 'original' || previewSettings.quality === 'high') {
                handleQualityChange('medium');
              } else if (previewSettings.quality === 'medium') {
                handleQualityChange('low');
              }
            }
          }
        }
      }
      
      const deltaTime = currentTime - lastTime;
      lastTime = currentTime;
      
      // Accumulate time and only update state when we have enough
      accumulatedTime += deltaTime;
      
      if (accumulatedTime >= MIN_TIME_STEP) {
        // Get current state directly (avoid re-render)
        const state = useEditorStore.getState();
        const timeAdvance = (accumulatedTime / 1000) * state.player.playbackRate;
        const newTime = state.player.currentTime + timeAdvance;
        
        // Reset accumulated time
        accumulatedTime = 0;
        
        if (newTime >= state.projectDuration) {
          state.seek(0);
          state.pause();
        } else {
          // MOBILE OPTIMIZATION: Throttle state updates
          const now = performance.now();
          const timeSinceLastUpdate = now - lastStateUpdateRef.current;
          const updateThreshold = isMobile ? 50 : 16; // Update less frequently on mobile
          
          if (timeSinceLastUpdate >= updateThreshold) {
            lastStateUpdateRef.current = now;
            state.seek(newTime);
          }
        }
      }

      if (useEditorStore.getState().player.isPlaying && isActive) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    // Reset frame limiter when starting playback
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
  }, [player.isPlaying, previewSettings.quality, handleQualityChange, currentFps, isPerformancePoor]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (!cropMode && !editingTextId) {
            togglePlayPause();
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (!editingTextId) {
            seek(Math.max(0, player.currentTime - (e.shiftKey ? 10 : 1)));
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (!editingTextId) {
            seek(Math.min(projectDuration, player.currentTime + (e.shiftKey ? 10 : 1)));
          }
          break;
        case 'Home':
          e.preventDefault();
          if (!editingTextId) {
            seek(0);
          }
          break;
        case 'End':
          e.preventDefault();
          if (!editingTextId) {
            seek(projectDuration);
          }
          break;
        case 'm':
          e.preventDefault();
          if (!editingTextId) {
            toggleMute();
          }
          break;
        case 'f':
          e.preventDefault();
          if (!editingTextId) {
            toggleFullscreen();
          }
          break;
        case 'c':
          if (e.ctrlKey || e.metaKey) return; // Let copy/paste work
          e.preventDefault();
          if (!editingTextId) {
            setCropMode(prev => !prev);
          }
          break;
      }
    };

    // Listen for crop mode toggle from Timeline
    const handleToggleCropEvent = () => {
      setCropMode(prev => {
        const next = !prev;
        if (next && player.isPlaying) {
          pause();
        }
        return next;
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('toggleCropMode', handleToggleCropEvent);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('toggleCropMode', handleToggleCropEvent);
    };
  }, [player.currentTime, projectDuration, togglePlayPause, seek, toggleMute, toggleFullscreen, editingTextId, cropMode]);

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    seek(percentage * projectDuration);
  };

  // Handle text dragging
  const handleTextMouseDown = (e: React.MouseEvent, textId: string) => {
    e.stopPropagation();
    // Pause playback when dragging text
    if (player.isPlaying) {
      pause();
    }
    setDraggedTextId(textId);
    selectText(textId);
  };

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
  }, [draggedTextId, updateTextOverlay]);

  // Handle text resize
  const handleTextResizeStart = (e: React.MouseEvent, textId: string, corner: string) => {
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
  };

  useEffect(() => {
    if (!resizingTextId || !resizeCorner || !videoContainerRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = videoContainerRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Calculate text center in pixels using stored position
      const centerX = rect.left + (rect.width * textResizeStart.textX) / 100;
      const centerY = rect.top + (rect.height * textResizeStart.textY) / 100;

      let newScaleX = textResizeStart.scaleX;
      let newScaleY = textResizeStart.scaleY;

      if (['n', 's'].includes(resizeCorner)) {
        // Vertical resizing
        const startDist = Math.abs(textResizeStart.y - centerY);
        const currentDist = Math.abs(e.clientY - centerY);
        if (startDist > 0) {
          const ratio = currentDist / startDist;
          newScaleY = Math.max(0.1, Math.min(10, textResizeStart.scaleY * ratio));
        }
      } else if (['e', 'w'].includes(resizeCorner)) {
        // Horizontal resizing
        const startDist = Math.abs(textResizeStart.x - centerX);
        const currentDist = Math.abs(e.clientX - centerX);
        if (startDist > 0) {
          const ratio = currentDist / startDist;
          newScaleX = Math.max(0.1, Math.min(10, textResizeStart.scaleX * ratio));
        }
      } else {
        // Diagonal resizing - proportional
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
  }, [resizingTextId, resizeCorner, textResizeStart, updateTextOverlay]);

  // Handle crop mode
  const handleToggleCrop = () => {
    const nextMode = !cropMode;
    setCropMode(nextMode);
    
    if (nextMode) {
      if (player.isPlaying) {
        pause();
      }
      const activeClips = getActiveClips();
      const mainClip = activeClips.find(c => c.clip.id === ui.selectedClipId) || activeClips[0];
      
      if (mainClip) {
        // Initialize crop area from existing crop or default
        const crop = mainClip.clip.crop || { x: 0, y: 0, width: 100, height: 100, locked: false };
        setCropArea(crop);
      }
    }
  };

  const handleApplyCrop = () => {
    if (ui.selectedClipId) {
      updateClip(ui.selectedClipId, { crop: cropArea });
      setCropMode(false);
    }
  };

  // Handle crop resize
  const handleCropResizeStart = (e: React.MouseEvent, handle: string) => {
    e.stopPropagation();
    setResizingCrop(handle);
    setCropDragStart({
      x: e.clientX,
      y: e.clientY,
      crop: { ...cropArea }
    });
  };

  useEffect(() => {
    if (!resizingCrop || !videoContainerRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = videoContainerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const deltaX = ((e.clientX - cropDragStart.x) / rect.width) * 100;
      const deltaY = ((e.clientY - cropDragStart.y) / rect.height) * 100;

      const { crop } = cropDragStart;
      let newCrop = { ...cropArea };

      switch (resizingCrop) {
        case 'nw': // Top-left corner
          {
            const newX = Math.max(0, Math.min(crop.x + crop.width - 5, crop.x + deltaX));
            const newY = Math.max(0, Math.min(crop.y + crop.height - 5, crop.y + deltaY));
            newCrop.width = crop.width + (crop.x - newX);
            newCrop.height = crop.height + (crop.y - newY);
            newCrop.x = newX;
            newCrop.y = newY;
          }
          break;
        case 'ne': // Top-right corner
          {
            const newY = Math.max(0, Math.min(crop.y + crop.height - 5, crop.y + deltaY));
            newCrop.width = Math.max(5, Math.min(100 - crop.x, crop.width + deltaX));
            newCrop.height = crop.height + (crop.y - newY);
            newCrop.y = newY;
          }
          break;
        case 'sw': // Bottom-left corner
          {
            const newX = Math.max(0, Math.min(crop.x + crop.width - 5, crop.x + deltaX));
            newCrop.width = crop.width + (crop.x - newX);
            newCrop.height = Math.max(5, Math.min(100 - crop.y, crop.height + deltaY));
            newCrop.x = newX;
          }
          break;
        case 'se': // Bottom-right corner
          newCrop.width = Math.max(5, Math.min(100 - crop.x, crop.width + deltaX));
          newCrop.height = Math.max(5, Math.min(100 - crop.y, crop.height + deltaY));
          break;
        case 'n': // Top edge
          {
            const newY = Math.max(0, Math.min(crop.y + crop.height - 5, crop.y + deltaY));
            newCrop.height = crop.height + (crop.y - newY);
            newCrop.y = newY;
          }
          break;
        case 's': // Bottom edge
          newCrop.height = Math.max(5, Math.min(100 - crop.y, crop.height + deltaY));
          break;
        case 'w': // Left edge
          {
            const newX = Math.max(0, Math.min(crop.x + crop.width - 5, crop.x + deltaX));
            newCrop.width = crop.width + (crop.x - newX);
            newCrop.x = newX;
          }
          break;
        case 'e': // Right edge
          newCrop.width = Math.max(5, Math.min(100 - crop.x, crop.width + deltaX));
          break;
      }

      setCropArea(newCrop);
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
  }, [resizingCrop, cropDragStart, cropArea]);

  // Handle text editing
  const handleTextDoubleClick = (e: React.MouseEvent, textId: string, currentText: string) => {
    e.stopPropagation();
    setEditingTextId(textId);
    setEditingTextValue(currentText);
    // Pause playback when editing
    if (player.isPlaying) {
      pause();
    }
  };

  const handleTextEditChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditingTextValue(e.target.value);
  };

  const handleTextEditSubmit = () => {
    if (editingTextId) {
      updateTextOverlay(editingTextId, { text: editingTextValue });
      setEditingTextId(null);
    }
  };

  const handleTextEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleTextEditSubmit();
    } else if (e.key === 'Escape') {
      setEditingTextId(null);
    }
    e.stopPropagation(); // Prevent triggering other shortcuts
  };

  // Handle image transform start (drag to move, scroll to scale, shift+drag to rotate)
  const handleImageTransformStart = (e: React.MouseEvent, clipId: string) => {
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
  };

  // Handle image transform (move, scale, rotate)
  useEffect(() => {
    if (!transformingImageId || !videoContainerRef.current) return;

    const clip = tracks.flatMap(t => t.clips).find(c => c.id === transformingImageId);
    if (!clip) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = videoContainerRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Move image with mouse drag
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
  }, [transformingImageId, transformStart, tracks, updateClip]);

  // Handle image resize with corner handles
  const handleImageResizeStart = (e: React.MouseEvent, clipId: string, corner: string) => {
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
  };

  useEffect(() => {
    if (!resizingImageId || !resizeCorner || !videoContainerRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = videoContainerRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Calculate image center in pixels
      const centerX = rect.left + (rect.width * transformStart.transform.x) / 100;
      const centerY = rect.top + (rect.height * transformStart.transform.y) / 100;

      // Get current scales (fallback to uniform scale if not set)
      const currentScaleX = transformStart.transform.scaleX ?? transformStart.transform.scale;
      const currentScaleY = transformStart.transform.scaleY ?? transformStart.transform.scale;

      let newScaleX = currentScaleX;
      let newScaleY = currentScaleY;

      if (resizeCorner === 'n' || resizeCorner === 's') {
        // Vertical resizing only
        const startDist = Math.abs(transformStart.y - centerY);
        const currentDist = Math.abs(e.clientY - centerY);
        if (startDist > 0) {
          const ratio = currentDist / startDist;
          newScaleY = Math.max(10, Math.min(500, currentScaleY * ratio));
        }
      } else if (resizeCorner === 'e' || resizeCorner === 'w') {
        // Horizontal resizing only
        const startDist = Math.abs(transformStart.x - centerX);
        const currentDist = Math.abs(e.clientX - centerX);
        if (startDist > 0) {
          const ratio = currentDist / startDist;
          newScaleX = Math.max(10, Math.min(500, currentScaleX * ratio));
        }
      } else {
        // Corner resizing - proportional
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
          // Scale both dimensions by the same ratio to maintain aspect ratio
          newScaleX = Math.max(10, Math.min(500, currentScaleX * ratio));
          newScaleY = Math.max(10, Math.min(500, currentScaleY * ratio));
        }
      }

      updateClip(resizingImageId, {
        transform: {
          ...transformStart.transform,
          scaleX: newScaleX,
          scaleY: newScaleY,
          scale: Math.max(newScaleX, newScaleY) // Keep scale updated as reference
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
  }, [resizingImageId, resizeCorner, transformStart, updateClip]);

  // Handle image rotation
  const handleImageRotateStart = (e: React.MouseEvent, clipId: string) => {
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
  };

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
  }, [rotatingImageId, rotationStart, transformStart, updateClip]);

  const activeClips = getActiveClips();
  const currentTexts = getCurrentTextOverlays();
  const progressPercentage = projectDuration > 0 ? (player.currentTime / projectDuration) * 100 : 0;

  const playbackSpeeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
  
  // Get aspect ratio value for inline style
  const getAspectRatioValue = () => {
    switch (aspectRatio) {
      case '16:9': return '16 / 9';
      case '9:16': return '9 / 16';
      case '1:1': return '1 / 1';
      case '4:3': return '4 / 3';
      case '21:9': return '21 / 9';
      default: return '16 / 9';
    }
  };

  // Apply crop if defined
  const getCropStyle = (clip: any) => {
    if (!clip.crop) return {};
    const { x, y, width, height } = clip.crop;
    const safeWidth = Math.max(1, width);
    const safeHeight = Math.max(1, height);
    
    // Zoom to crop logic:
    // Scale the element up so the cropped area fills the container
    // And shift it so the top-left of the crop area is at 0,0
    const scaleX = 100 / safeWidth;
    const scaleY = 100 / safeHeight;
    
    return {
      width: `${scaleX * 100}%`,
      height: `${scaleY * 100}%`,
      left: `${-x * scaleX}%`,
      top: `${-y * scaleY}%`,
      position: 'absolute' as const,
      maxWidth: 'none',
      maxHeight: 'none',
    };
  };

  // Stable ref callback with optimizations applied
  const setVideoRef = useCallback((id: string, el: HTMLVideoElement | null) => {
    if (el) {
      videoRefs.current[id] = el;
      // Apply video optimizations for smooth playback with hardware profile
      applyVideoOptimizations(el, previewSettings, hardwareProfile || undefined);
      
      // Apply mobile-specific playback optimizations
      if (hardwareProfile?.isMobile) {
        optimizeMobilePlayback(el);
        
        // Apply mobile video attributes
        const mobileAttrs = getMobileVideoAttributes();
        Object.entries(mobileAttrs).forEach(([key, value]) => {
          el.setAttribute(key, value);
        });
      }
    } else {
      delete videoRefs.current[id];
    }
  }, [previewSettings, hardwareProfile]);
  
  // Get video style based on preview settings (for resolution limiting)
  const getVideoStyle = useCallback((media: MediaFile): React.CSSProperties => {
    const style: React.CSSProperties = {};
    
    // Apply resolution limiting via CSS for preview
    if (previewSettings.maxResolution > 0 && media.height && media.height > previewSettings.maxResolution) {
      // Scale down the video rendering for performance
      const scale = previewSettings.maxResolution / media.height;
      style.imageRendering = previewSettings.quality === 'low' ? 'pixelated' : 'auto';
      
      // Use CSS to hint at lower quality rendering
      if (previewSettings.quality === 'low' || previewSettings.quality === 'medium') {
        style.filter = 'blur(0.5px)'; // Slight blur to hide artifacts
      }
    }
    
    return style;
  }, [previewSettings]);
  
  // Quality options for the menu
  const qualityOptions: { value: PreviewSettings['quality']; label: string; description: string }[] = [
    { value: 'auto', label: 'Auto', description: hardwareProfile ? `Détecté: ${hardwareProfile.recommendedQuality}` : 'Ajustement automatique' },
    { value: 'low', label: 'Basse (360p)', description: 'Pour appareils anciens' },
    { value: 'medium', label: 'Moyenne (480p)', description: 'Équilibré' },
    { value: 'high', label: 'Haute (720p)', description: 'Bonne qualité' },
    { value: 'original', label: 'Originale', description: 'Qualité maximale' },
  ];
  
  // Get quality label for display
  const getQualityLabel = () => {
    if (previewSettings.quality === 'auto' && hardwareProfile) {
      return `Auto (${hardwareProfile.recommendedQuality})`;
    }
    const option = qualityOptions.find(o => o.value === previewSettings.quality);
    return option?.label || previewSettings.quality;
  };

  return (
    <div
      ref={containerRef}
      className={`glass-panel flex flex-col h-full ${player.isFullscreen ? 'fixed inset-0 z-[100] rounded-none' : ''}`}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(true)}
    >
      {/* Video Container */}
      <div ref={videoContainerRef} className="flex-1 relative bg-black rounded-t-xl overflow-hidden flex items-center justify-center p-1 xxs:p-2 sm:p-4 min-h-0">
        {/* Aspect Ratio Indicator */}
        <div className="absolute top-1 xxs:top-2 right-1 xxs:right-2 bg-black/70 backdrop-blur-sm px-1.5 xxs:px-2 sm:px-3 py-0.5 xxs:py-1 rounded-full text-[9px] xxs:text-[10px] sm:text-xs font-medium text-white z-50 border border-white/20">
          {aspectRatio}
        </div>
        
        <div
          className="relative shadow-2xl overflow-hidden transition-all duration-300 ease-in-out"
          style={{ 
            aspectRatio: getAspectRatioValue(),
            backgroundColor: '#1a1a1a',
            border: '2px solid #444',
            boxShadow: '0 0 0 1px #000, 0 20px 50px rgba(0,0,0,0.5)',
            
            // Ensure the player fits within the container while maintaining aspect ratio
            height: '100%',
            width: 'auto',
            maxWidth: '100%',
            
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {activeClips.length > 0 ? (
            <>
              {/* Render all active clips (videos and images) layered */}
              {activeClips.map((item, index) => {
                const isSelected = ui.selectedClipId === item.clip.id;
                const zIndex = 10 + index; // Higher tracks appear on top
                const transitionStyle = getTransitionStyle(item.clip, player.currentTime);

                if (item.media.type === 'video') {
                  // Get optimized video style for preview performance
                  const videoStyle = getVideoStyle(item.media);
                  
                  if (item.clip.crop) {
                    // Cropped video rendering
                    return (
                      <div
                        key={item.clip.id}
                        className="absolute inset-0 overflow-hidden"
                        style={{ zIndex }}
                      >
                        <div className="w-full h-full" style={transitionStyle}>
                          <video
                            ref={(el) => setVideoRef(item.clip.id, el)}
                            src={item.media.url}
                            className="object-cover"
                            style={{ ...getCropStyle(item.clip), ...videoStyle }}
                            playsInline
                            webkit-playsinline="true"
                            muted={false}
                            controls={false}
                            preload={hardwareProfile?.isMobile ? 'metadata' : 'auto'}
                            onError={(e) => console.error('Video error:', e.currentTarget.error, item.media.url)}
                          />
                        </div>
                      </div>
                    );
                  }
                  
                  // Standard video rendering with preview optimizations
                  return (
                    <div
                      key={item.clip.id}
                      className="absolute inset-0 w-full h-full"
                      style={{ zIndex }}
                    >
                      <div className="w-full h-full" style={transitionStyle}>
                        <video
                          ref={(el) => setVideoRef(item.clip.id, el)}
                          src={item.media.url}
                          className="w-full h-full object-contain"
                          style={videoStyle}
                          playsInline
                          webkit-playsinline="true"
                          muted={false}
                          controls={false}
                          preload={hardwareProfile?.isMobile ? 'metadata' : 'auto'}
                          onError={(e) => console.error('Video error:', e.currentTarget.error, item.media.url)}
                        />
                      </div>
                    </div>
                  );
                }

                if (item.media.type === 'image') {
                  const transform = item.clip.transform || { x: 50, y: 50, scale: 100, rotation: 0 };
                  
                  if (item.clip.crop) {
                    // Cropped image rendering
                    return (
                      <div 
                        key={item.clip.id}
                        className="absolute inset-0 overflow-hidden"
                        style={{ zIndex }}
                      >
                        <div className="w-full h-full" style={transitionStyle}>
                          <img
                            src={item.media.url}
                            alt={item.clip.name}
                            className="object-cover"
                            style={getCropStyle(item.clip)}
                          />
                        </div>
                      </div>
                    );
                  }

                  // Standard image rendering with transform
                  const scaleX = transform.scaleX ?? transform.scale;
                  const scaleY = transform.scaleY ?? transform.scale;
                  
                  const baseSize = 80; // Base size as percentage of container
                  const actualWidth = (baseSize * scaleX) / 100;
                  const actualHeight = (baseSize * scaleY) / 100;

                  // Apply filter to image container
                  const clipFilter = filters[item.clip.id];
                  const filterStyle = clipFilter ? { filter: getCSSFilter(clipFilter) } : {};
                  
                  return (
                    <div
                      key={item.clip.id}
                      className={`absolute ${isSelected && !cropMode && !editingTextId ? 'ring-4 ring-primary-500' : ''}`}
                      style={{
                        zIndex: isSelected ? 70 : zIndex, // Bring selected image above Play Button (z-60)
                        left: `${transform.x}%`,
                        top: `${transform.y}%`,
                        width: `${actualWidth}%`,
                        height: `${actualHeight}%`,
                        transform: `translate(-50%, -50%) rotate(${transform.rotation}deg)`,
                        cursor: isSelected && !cropMode && !editingTextId ? 'move' : 'pointer',
                        pointerEvents: 'auto',
                        ...filterStyle // Apply filter here
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!cropMode && !editingTextId) {
                          selectClip(item.clip.id);
                        }
                      }}
                      onMouseDown={(e) => {
                        if (!cropMode && !editingTextId) {
                          e.stopPropagation();
                          if (isSelected) {
                            handleImageTransformStart(e, item.clip.id);
                          } else {
                            selectClip(item.clip.id);
                          }
                        }
                      }}
                    >
                      <div className="w-full h-full" style={transitionStyle}>
                        <img
                          src={item.media.url}
                          alt={item.clip.name}
                          className="w-full h-full object-fill"
                          style={{ pointerEvents: 'none' }}
                          onError={(e) => {
                            console.error('Image error:', item.media.url);
                            console.log('Image dimensions:', item.media.width, 'x', item.media.height);
                          }}
                        />
                      </div>
                      
                      {/* Resize handles when selected */}
                      {isSelected && !cropMode && !editingTextId && (
                        <>
                          {/* Corner handles */}
                          <div 
                            className="absolute -top-2 -left-2 w-4 h-4 bg-primary-500 border-2 border-white rounded-full cursor-nwse-resize hover:scale-125 transition-transform z-10"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleImageResizeStart(e, item.clip.id, 'nw');
                            }}
                          />
                          <div 
                            className="absolute -top-2 -right-2 w-4 h-4 bg-primary-500 border-2 border-white rounded-full cursor-nesw-resize hover:scale-125 transition-transform z-10"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleImageResizeStart(e, item.clip.id, 'ne');
                            }}
                          />
                          <div 
                            className="absolute -bottom-2 -left-2 w-4 h-4 bg-primary-500 border-2 border-white rounded-full cursor-nesw-resize hover:scale-125 transition-transform z-10"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleImageResizeStart(e, item.clip.id, 'sw');
                            }}
                          />
                          <div 
                            className="absolute -bottom-2 -right-2 w-4 h-4 bg-primary-500 border-2 border-white rounded-full cursor-nwse-resize hover:scale-125 transition-transform z-10"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleImageResizeStart(e, item.clip.id, 'se');
                            }}
                          />

                          {/* Side handles (Left, Right, Top, Bottom) */}
                          <div 
                            className="absolute top-1/2 -left-2 -translate-y-1/2 w-4 h-4 bg-primary-500 border-2 border-white rounded-full cursor-ew-resize hover:scale-125 transition-transform z-10"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleImageResizeStart(e, item.clip.id, 'w');
                            }}
                          />
                          <div 
                            className="absolute top-1/2 -right-2 -translate-y-1/2 w-4 h-4 bg-primary-500 border-2 border-white rounded-full cursor-ew-resize hover:scale-125 transition-transform z-10"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleImageResizeStart(e, item.clip.id, 'e');
                            }}
                          />
                          <div 
                            className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-primary-500 border-2 border-white rounded-full cursor-ns-resize hover:scale-125 transition-transform z-10"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleImageResizeStart(e, item.clip.id, 'n');
                            }}
                          />
                          <div 
                            className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-primary-500 border-2 border-white rounded-full cursor-ns-resize hover:scale-125 transition-transform z-10"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleImageResizeStart(e, item.clip.id, 's');
                            }}
                          />
                          
                          {/* Rotation handle */}
                          <div 
                            className="absolute -top-8 left-1/2 -translate-x-1/2 w-6 h-6 bg-blue-500 border-2 border-white rounded-full cursor-grab hover:scale-125 transition-transform z-10 flex items-center justify-center"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleImageRotateStart(e, item.clip.id);
                            }}
                          >
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          </div>
                        </>
                      )}
                    </div>
                  );
                }

                return null;
              })}

              {/* Crop Overlay */}
              {cropMode && (
                <div className="absolute inset-0 z-[100]">
                  {/* Visible crop area with shadow for outside */}
                  <div
                    className="absolute border-2 border-primary-500 bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.7)]"
                    style={{
                      left: `${cropArea.x}%`,
                      top: `${cropArea.y}%`,
                      width: `${cropArea.width}%`,
                      height: `${cropArea.height}%`,
                      cursor: 'move'
                    }}
                    onMouseDown={(e) => {
                      // Allow dragging the entire crop area
                      if (e.target === e.currentTarget) {
                        e.stopPropagation();
                        const rect = videoContainerRef.current?.getBoundingClientRect();
                        if (!rect) return;
                        
                        const startX = e.clientX;
                        const startY = e.clientY;
                        const startCrop = { ...cropArea };
                        
                        const handleDrag = (moveEvent: MouseEvent) => {
                          const deltaX = ((moveEvent.clientX - startX) / rect.width) * 100;
                          const deltaY = ((moveEvent.clientY - startY) / rect.height) * 100;
                          
                          setCropArea({
                            ...startCrop,
                            x: Math.max(0, Math.min(100 - startCrop.width, startCrop.x + deltaX)),
                            y: Math.max(0, Math.min(100 - startCrop.height, startCrop.y + deltaY))
                          });
                        };
                        
                        const handleDragEnd = () => {
                          window.removeEventListener('mousemove', handleDrag);
                          window.removeEventListener('mouseup', handleDragEnd);
                        };
                        
                        window.addEventListener('mousemove', handleDrag);
                        window.addEventListener('mouseup', handleDragEnd);
                      }
                    }}
                  >
                    {/* Corner handles - Larger and more visible */}
                    <div 
                      className="absolute -top-2 -left-2 w-6 h-6 bg-primary-500 border-2 border-white rounded-sm cursor-nwse-resize hover:scale-125 transition-transform shadow-lg" 
                      onMouseDown={(e) => handleCropResizeStart(e, 'nw')}
                    />
                    <div 
                      className="absolute -top-2 -right-2 w-6 h-6 bg-primary-500 border-2 border-white rounded-sm cursor-nesw-resize hover:scale-125 transition-transform shadow-lg" 
                      onMouseDown={(e) => handleCropResizeStart(e, 'ne')}
                    />
                    <div 
                      className="absolute -bottom-2 -left-2 w-6 h-6 bg-primary-500 border-2 border-white rounded-sm cursor-nesw-resize hover:scale-125 transition-transform shadow-lg" 
                      onMouseDown={(e) => handleCropResizeStart(e, 'sw')}
                    />
                    <div 
                      className="absolute -bottom-2 -right-2 w-6 h-6 bg-primary-500 border-2 border-white rounded-sm cursor-nwse-resize hover:scale-125 transition-transform shadow-lg" 
                      onMouseDown={(e) => handleCropResizeStart(e, 'se')}
                    />
                    
                    {/* Edge handles - Larger bars */}
                    <div 
                      className="absolute -top-2 left-1/2 -translate-x-1/2 w-12 h-4 bg-primary-500 border-2 border-white rounded-sm cursor-ns-resize hover:scale-110 transition-transform shadow-lg" 
                      onMouseDown={(e) => handleCropResizeStart(e, 'n')}
                    />
                    <div 
                      className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-12 h-4 bg-primary-500 border-2 border-white rounded-sm cursor-ns-resize hover:scale-110 transition-transform shadow-lg" 
                      onMouseDown={(e) => handleCropResizeStart(e, 's')}
                    />
                    <div 
                      className="absolute top-1/2 -translate-y-1/2 -left-2 w-4 h-12 bg-primary-500 border-2 border-white rounded-sm cursor-ew-resize hover:scale-110 transition-transform shadow-lg" 
                      onMouseDown={(e) => handleCropResizeStart(e, 'w')}
                    />
                    <div 
                      className="absolute top-1/2 -translate-y-1/2 -right-2 w-4 h-12 bg-primary-500 border-2 border-white rounded-sm cursor-ew-resize hover:scale-110 transition-transform shadow-lg" 
                      onMouseDown={(e) => handleCropResizeStart(e, 'e')}
                    />
                    
                    {/* Grid lines (rule of thirds) */}
                    <div className="absolute top-1/3 left-0 right-0 h-px bg-white/30 pointer-events-none" />
                    <div className="absolute top-2/3 left-0 right-0 h-px bg-white/30 pointer-events-none" />
                    <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/30 pointer-events-none" />
                    <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/30 pointer-events-none" />
                  </div>
                  
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-[110]">
                    <button onClick={() => setCropMode(false)} className="btn-secondary px-4 py-2">
                      Annuler
                    </button>
                    <button onClick={handleApplyCrop} className="btn-primary px-4 py-2">
                      Appliquer
                    </button>
                  </div>
                </div>
              )}
              
              {/* Text Overlays - now draggable */}
              {!cropMode && currentTexts.map((text) => (
                <div
                  key={text.id}
                  className={`absolute cursor-move ${ui.selectedTextId === text.id ? 'ring-2 ring-primary-500' : ''}`}
                  style={{
                    zIndex: 50, // Always on top of video/images
                    left: `${text.x}%`,
                    top: `${text.y}%`,
                    transform: `translate(-50%, -50%) scale(${text.scaleX ?? 1}, ${text.scaleY ?? 1})`,
                    fontSize: `${text.fontSize}px`,
                    fontFamily: text.fontFamily,
                    color: text.color,
                    backgroundColor: text.backgroundColor,
                    fontWeight: text.bold ? 'bold' : 'normal',
                    fontStyle: text.italic ? 'italic' : 'normal',
                    padding: text.backgroundColor ? '4px 8px' : 0,
                    borderRadius: '4px',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'auto',
                  }}
                  onMouseDown={(e) => handleTextMouseDown(e, text.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (player.isPlaying) pause();
                    selectText(text.id);
                  }}
                  onDoubleClick={(e) => handleTextDoubleClick(e, text.id, text.text)}
                >
                  {text.id === editingTextId ? (
                    <input
                      type="text"
                      value={editingTextValue}
                      onChange={handleTextEditChange}
                      onBlur={handleTextEditSubmit}
                      onKeyDown={handleTextEditKeyDown}
                      autoFocus
                      onFocus={(e) => e.target.select()}
                      className="w-full h-full p-0 bg-transparent border-none outline-none"
                      style={{
                        fontSize: `${text.fontSize}px`,
                        fontFamily: text.fontFamily,
                        color: text.color,
                        backgroundColor: text.backgroundColor,
                        fontWeight: text.bold ? 'bold' : 'normal',
                        fontStyle: text.italic ? 'italic' : 'normal',
                        padding: text.backgroundColor ? '4px 8px' : 0,
                        borderRadius: '4px',
                        whiteSpace: 'nowrap',
                        pointerEvents: 'auto',
                        width: 'auto',
                        minWidth: '50px',
                      }}
                    />
                  ) : (
                    text.text
                  )}

                  {/* Resize handles for text */}
                  {ui.selectedTextId === text.id && !editingTextId && (
                    <>
                      <div 
                        className="absolute -top-2 -left-2 w-3 h-3 bg-primary-500 border border-white rounded-full cursor-nwse-resize hover:scale-125 transition-transform z-10"
                        onMouseDown={(e) => handleTextResizeStart(e, text.id, 'nw')}
                      />
                      <div 
                        className="absolute -top-2 -right-2 w-3 h-3 bg-primary-500 border border-white rounded-full cursor-nesw-resize hover:scale-125 transition-transform z-10"
                        onMouseDown={(e) => handleTextResizeStart(e, text.id, 'ne')}
                      />
                      <div 
                        className="absolute -bottom-2 -left-2 w-3 h-3 bg-primary-500 border border-white rounded-full cursor-nesw-resize hover:scale-125 transition-transform z-10"
                        onMouseDown={(e) => handleTextResizeStart(e, text.id, 'sw')}
                      />
                      <div 
                        className="absolute -bottom-2 -right-2 w-3 h-3 bg-primary-500 border border-white rounded-full cursor-nwse-resize hover:scale-125 transition-transform z-10"
                        onMouseDown={(e) => handleTextResizeStart(e, text.id, 'se')}
                      />
                      
                      {/* Side handles */}
                      <div 
                        className="absolute top-1/2 -left-2 -translate-y-1/2 w-3 h-3 bg-primary-500 border border-white rounded-full cursor-ew-resize hover:scale-125 transition-transform z-10"
                        onMouseDown={(e) => handleTextResizeStart(e, text.id, 'w')}
                      />
                      <div 
                        className="absolute top-1/2 -right-2 -translate-y-1/2 w-3 h-3 bg-primary-500 border border-white rounded-full cursor-ew-resize hover:scale-125 transition-transform z-10"
                        onMouseDown={(e) => handleTextResizeStart(e, text.id, 'e')}
                      />
                      <div 
                        className="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 bg-primary-500 border border-white rounded-full cursor-ns-resize hover:scale-125 transition-transform z-10"
                        onMouseDown={(e) => handleTextResizeStart(e, text.id, 'n')}
                      />
                      <div 
                        className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-3 h-3 bg-primary-500 border border-white rounded-full cursor-ns-resize hover:scale-125 transition-transform z-10"
                        onMouseDown={(e) => handleTextResizeStart(e, text.id, 's')}
                      />
                    </>
                  )}
                </div>
              ))}
            </>
          ) : (
            <div className="text-center text-neutral-400 p-2 xxs:p-4">
              <div className="w-12 h-12 xxs:w-16 xxs:h-16 sm:w-20 sm:h-20 mx-auto mb-2 xxs:mb-4 rounded-xl xxs:rounded-2xl bg-glass-medium flex items-center justify-center">
                <Play className="w-6 h-6 xxs:w-8 xxs:h-8 sm:w-10 sm:h-10" />
              </div>
              <p className="text-xs xxs:text-sm sm:text-body-lg text-white">Aucune vidéo</p>
              <p className="text-[10px] xxs:text-xs sm:text-small mt-0.5 xxs:mt-1 text-neutral-400">Ajoutez des médias</p>
            </div>
          )}
        </div>

        {/* Big Play Button - Hidden when mobile sidebar is open */}
        {!player.isPlaying && activeClips.length > 0 && !cropMode && !editingTextId && !transformingImageId && !resizingImageId && !rotatingImageId && !draggedTextId && !ui.selectedClipId && !ui.selectedTextId && !resizingTextId && !ui.isMobileSidebarOpen && (
          <button
            onClick={togglePlayPause}
            className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors z-[60]"
          >
            <div className="w-12 h-12 xxs:w-16 xxs:h-16 sm:w-20 sm:h-20 rounded-full bg-glass-light backdrop-blur-md flex items-center justify-center shadow-glass-lg">
              <Play className="w-6 h-6 xxs:w-8 xxs:h-8 sm:w-10 sm:h-10 text-primary-500 ml-0.5 xxs:ml-1" fill="currentColor" />
            </div>
          </button>
        )}
      </div>

      {/* Progress Bar */}
      <div
        className="h-1 xxs:h-1.5 bg-neutral-200/50 cursor-pointer relative group flex-shrink-0"
        onClick={handleProgressClick}
      >
        <div
          className="absolute inset-y-0 left-0 bg-primary-500 transition-all"
          style={{ width: `${progressPercentage}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2 h-2 xxs:w-3 xxs:h-3 bg-primary-500 rounded-full shadow-glow-violet opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `calc(${progressPercentage}% - 4px)` }}
        />
      </div>

      {/* Controls */}
      <div className={`px-1.5 xxs:px-2 sm:px-4 py-1.5 xxs:py-2 sm:py-3 flex items-center justify-between gap-1 xxs:gap-2 sm:gap-4 transition-opacity flex-shrink-0 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
        {/* Left Controls */}
        <div className="flex items-center gap-0.5 xxs:gap-1 sm:gap-2">
          <button onClick={() => seek(0)} className="btn-icon w-6 h-6 xxs:w-7 xxs:h-7 sm:w-9 sm:h-9" title="Debut">
            <SkipBack className="w-3 h-3 xxs:w-3.5 xxs:h-3.5 sm:w-4 sm:h-4" />
          </button>
          <button
            onClick={() => !cropMode && !editingTextId && togglePlayPause()}
            className={`btn-icon w-7 h-7 xxs:w-8 xxs:h-8 sm:w-10 sm:h-10 bg-primary-500 text-white hover:bg-primary-600 border-primary-500 ${cropMode || editingTextId ? 'opacity-50 cursor-not-allowed' : ''}`}
            title={player.isPlaying ? 'Pause' : 'Lecture'}
            disabled={cropMode || !!editingTextId}
          >
            {player.isPlaying ? <Pause className="w-3.5 h-3.5 xxs:w-4 xxs:h-4 sm:w-5 sm:h-5" /> : <Play className="w-3.5 h-3.5 xxs:w-4 xxs:h-4 sm:w-5 sm:h-5 ml-0.5" />}
          </button>
          <button onClick={() => seek(projectDuration)} className="btn-icon w-6 h-6 xxs:w-7 xxs:h-7 sm:w-9 sm:h-9" title="Fin">
            <SkipForward className="w-3 h-3 xxs:w-3.5 xxs:h-3.5 sm:w-4 sm:h-4" />
          </button>

          {/* Frame by frame - Hidden on small screens */}
          <div className="hidden sm:flex items-center gap-1 ml-2">
            <button onClick={() => seek(Math.max(0, player.currentTime - 1/30))} className="btn-icon w-8 h-8" title="Image precedente">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={() => seek(Math.min(projectDuration, player.currentTime + 1/30))} className="btn-icon w-8 h-8" title="Image suivante">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Time Display */}
        <div className="font-mono text-[9px] xxs:text-[10px] sm:text-small text-neutral-400 flex-shrink-0">
          <span className="text-white">{formatTime(player.currentTime)}</span>
          <span className="mx-0.5 xxs:mx-1 text-neutral-500">/</span>
          <span>{formatTime(projectDuration)}</span>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-0.5 xxs:gap-1 sm:gap-2">
          {/* Volume - Hidden on very small screens */}
          <div className="relative hidden xxs:flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => setShowVolumeSlider(!showVolumeSlider)}
              className="btn-icon w-6 h-6 xxs:w-7 xxs:h-7 sm:w-9 sm:h-9"
              title="Volume"
            >
              {player.isMuted || player.volume === 0 ? <VolumeX className="w-3 h-3 xxs:w-3.5 xxs:h-3.5 sm:w-4 sm:h-4" /> : <Volume2 className="w-3 h-3 xxs:w-3.5 xxs:h-3.5 sm:w-4 sm:h-4" />}
            </button>
            <div
              className={`hidden sm:flex items-center gap-2 transition-all duration-200 overflow-hidden ${showVolumeSlider ? 'w-32 opacity-100' : 'w-0 opacity-0'}`}
            >
              <div className="flex-1 h-6 flex items-center px-1">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(player.volume * 100)}
                  onChange={(e) => setVolume(parseInt(e.target.value) / 100)}
                  className="volume-slider-horizontal w-full"
                />
              </div>
              <span className="text-xs text-white font-mono w-9 text-right flex-shrink-0">{Math.round(player.volume * 100)}%</span>
            </div>
          </div>

          {/* Preview Quality - Hidden on very small screens */}
          <div className="relative hidden xs:block">
            <button
              onClick={() => setShowQualityMenu(!showQualityMenu)}
              className={`btn-icon w-6 h-6 xxs:w-7 xxs:h-7 sm:w-9 sm:h-9 ${isPerformancePoor ? 'text-warning' : ''}`}
              title="Qualité"
            >
              <Gauge className="w-3 h-3 xxs:w-3.5 xxs:h-3.5 sm:w-4 sm:h-4" />
            </button>
            {showQualityMenu && (
              <div
                className="glass-panel fixed p-3 shadow-glass-lg custom-scrollbar"
                style={{
                  width: '280px',
                  maxWidth: 'calc(100vw - 2rem)',
                  maxHeight: '70vh',
                  overflowY: 'auto',
                  zIndex: 9999,
                  right: '1rem',
                  bottom: '5rem',
                }}
              >
                <div className="text-small mb-3 px-1 flex items-center justify-between" style={{ color: '#a0a0a0' }}>
                  <span>Qualité Preview • {currentFps} FPS</span>
                  {isPerformancePoor && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ color: '#F59E0B', background: 'rgba(245, 158, 11, 0.2)' }}>Lent</span>
                  )}
                </div>
                
                {/* Auto-detection banner */}
                {autoQualityApplied && hardwareProfile && (
                  <div className="mb-3 px-2 py-2 rounded text-small" style={{ background: 'rgba(117, 122, 237, 0.1)', border: '1px solid rgba(117, 122, 237, 0.3)' }}>
                    <div className="flex items-center gap-1.5" style={{ color: '#757AED' }}>
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span className="font-medium">Auto-détecté: {hardwareProfile.recommendedQuality}</span>
                    </div>
                    <div className="mt-1" style={{ color: '#808080' }}>
                      {hardwareProfile.cpuCores} cœurs • Score: {hardwareProfile.performanceScore}/100
                      {hardwareProfile.isAppleSilicon && ' • Apple Silicon'}
                      {hardwareProfile.isHighEndMobile && !hardwareProfile.isAppleSilicon && ' • Mobile haut de gamme'}
                      {hardwareProfile.isLowEnd && ' • Mode économie'}
                    </div>
                  </div>
                )}
                
                <div className="space-y-1">
                  {qualityOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => handleQualityChange(option.value)}
                      className={`w-full px-3 py-2.5 text-left rounded-sm transition-all ${
                        previewSettings.quality === option.value
                          ? 'text-white'
                          : 'hover:bg-[var(--bg-hover)]'
                      }`}
                      style={{
                        background: previewSettings.quality === option.value ? 'var(--primary)' : 'transparent',
                        border: previewSettings.quality === option.value ? '1px solid var(--primary)' : '1px solid transparent',
                      }}
                    >
                      <div className="text-body font-medium flex items-center gap-2">
                        {option.label}
                        {option.value === hardwareProfile?.recommendedQuality && option.value !== 'auto' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#10B981' }}>Recommandé</span>
                        )}
                      </div>
                      <div className="text-small mt-0.5" style={{
                        color: previewSettings.quality === option.value ? 'rgba(255,255,255,0.8)' : '#808080'
                      }}>{option.description}</div>
                    </button>
                  ))}
                </div>
                
                {/* Performance stats */}
                <div className="mt-3 pt-3 px-1 text-small" style={{ borderTop: '1px solid var(--border-color)', color: '#808080' }}>
                  <div className="flex justify-between">
                    <span>Résolution max:</span>
                    <span style={{ color: '#ffffff' }}>{previewSettings.maxResolution > 0 ? `${previewSettings.maxResolution}p` : 'Originale'}</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span>FPS cible:</span>
                    <span style={{ color: '#ffffff' }}>{previewSettings.targetFps}</span>
                  </div>
                  {previewSettings.frameSkipping && (
                    <div className="flex justify-between mt-1">
                      <span>Frame skip:</span>
                      <span style={{ color: '#F59E0B' }}>Activé</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Playback Speed - Hidden on very small screens */}
          <div className="relative hidden xs:block">
            <button
              onClick={() => setShowSpeedMenu(!showSpeedMenu)}
              className="btn-icon w-6 h-6 xxs:w-7 xxs:h-7 sm:w-9 sm:h-9 text-[9px] xxs:text-[10px] sm:text-caption font-mono"
              title="Vitesse"
            >
              {player.playbackRate}x
            </button>
            {showSpeedMenu && (
              <div className="absolute bottom-full right-0 mb-2 p-1 bg-[var(--bg-secondary)] border border-[var(--bg-tertiary)] rounded-lg min-w-[80px] shadow-lg z-50">
                {playbackSpeeds.map((speed) => (
                  <button
                    key={speed}
                    onClick={() => {
                      setPlaybackRate(speed);
                      setShowSpeedMenu(false);
                    }}
                    className={`w-full px-3 py-1.5 text-small text-left rounded-md transition-colors font-mono ${
                      player.playbackRate === speed
                        ? 'bg-[var(--primary)] text-white'
                        : 'hover:bg-[var(--bg-tertiary)] text-white'
                    }`}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Fullscreen */}
          <button onClick={toggleFullscreen} className="btn-icon w-6 h-6 xxs:w-7 xxs:h-7 sm:w-9 sm:h-9" title={player.isFullscreen ? 'Quitter' : 'Plein écran'}>
            {player.isFullscreen ? <Minimize className="w-3 h-3 xxs:w-3.5 xxs:h-3.5 sm:w-4 sm:h-4" /> : <Maximize className="w-3 h-3 xxs:w-3.5 xxs:h-3.5 sm:w-4 sm:h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;
