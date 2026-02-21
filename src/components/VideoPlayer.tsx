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
  Gauge,
  Cpu,
  Monitor
} from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { useResponsive, useLayoutMode } from '../hooks/use-responsive';
import { formatTime, getCSSFilter } from '../utils/helpers';
import type { TimelineClip, MediaFile, TransformSettings } from '../types';
import { RESOLUTION_PRESETS } from '../types';
import {
  initializePreviewOptimizer,
  getOptimalSettings,
  applyVideoOptimizations,
  optimizeMobilePlayback,
  getMobileVideoAttributes,
  FrameRateLimiter,
  PerformanceMonitor,
  getHardwareProfile as getLegacyHardwareProfile,
  getCurrentSettings,
  updateSettings,
  PreviewSettings,
  HardwareProfile,
  PREVIEW_RESOLUTIONS,
} from '../utils/previewOptimizer';
import {
  useHardwareProfile as useEnhancedHardwareProfile,
  HardwareProfile as EnhancedHardwareProfile,
  VideoSettings as EnhancedVideoSettings,
  getOptimalVideoSettings as getEnhancedVideoSettings,
  formatHardwareProfileForDisplay,
} from '../utils/hardwareDetection';
import { useMediaBunnyPreview } from '../hooks/use-mediabunny-preview';

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
    exportSettings,
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

  // Use responsive hook for fold-aware layout
  const responsive = useResponsive();
  const layoutMode = useLayoutMode();
  
  // Determine layout characteristics
  const isMinimal = layoutMode === 'minimal';
  const isCompact = layoutMode === 'compact';
  const isAdaptive = layoutMode === 'adaptive';
  const isExpanded = layoutMode === 'expanded';
  const isDesktop = layoutMode === 'desktop';
  
  // Get touch target size based on device
  const touchTargetSize = responsive.touchTargetSize;

  const videoRefs = useRef<{ [key: string]: HTMLVideoElement | null }>({});
  const audioRefs = useRef<{ [key: string]: HTMLAudioElement | null }>({});
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const qualityButtonRef = useRef<HTMLButtonElement>(null);
  const qualityMenuRef = useRef<HTMLDivElement>(null);
  const speedButtonRef = useRef<HTMLButtonElement>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();
  const frameRateLimiterRef = useRef<FrameRateLimiter | null>(null);
  const performanceMonitorRef = useRef<PerformanceMonitor | null>(null);
  
  // Refs for smooth video synchronization
  const lastSyncTimeRef = useRef<number>(0);
  const syncDebounceRef = useRef<number | null>(null);
  const isSeekingRef = useRef<boolean>(false);
  const pendingSeekRef = useRef<number | null>(null);
  const preloadedClipsRef = useRef<Set<string>>(new Set());
  
  // DEBUG: Diagnostic logging refs
  const debugLogCounterRef = useRef<number>(0);
  const debugLastFrameTimeRef = useRef<number>(0);
  const debugFrameTimesRef = useRef<number[]>([]);
  const debugLastLogTimeRef = useRef<number>(0);
  
  // Mobile optimization refs
  const isMobileRef = useRef<boolean>(false);
  const lastStateUpdateRef = useRef<number>(0);
  const lastAutoQualityChangeRef = useRef<number>(0);
  const AUTO_QUALITY_COOLDOWN = 5000; // 5 secondes entre les changements auto
  const rafIdRef = useRef<number | null>(null);
  // OPTIMISATION: Flag pour désactiver ResizeObserver pendant le scrubbing
  const isScrubbingRef = useRef<boolean>(false);
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
  const [enhancedProfile, setEnhancedProfile] = useState<EnhancedHardwareProfile | null>(null);
  const [currentFps, setCurrentFps] = useState<number>(30);
  const [isPerformancePoor, setIsPerformancePoor] = useState(false);
  const [autoQualityApplied, setAutoQualityApplied] = useState(false);
  
  // Preview container dimensions for text scaling
  const [previewDimensions, setPreviewDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  
  // MediaBunny integration
  const [useMediaBunny, setUseMediaBunny] = useState(false);
  const { render: renderMediaBunny, isReady: isMediaBunnyReady } = useMediaBunnyPreview(canvasRef, useMediaBunny);

  // Initialize preview optimizer on mount - AUTO QUALITY FROM START
  useEffect(() => {
    const profile = initializePreviewOptimizer();
    setHardwareProfile(profile);
    
    // Enable MediaBunny for high-end desktop GPUs with WebCodecs support
    // DISABLED: User reported performance regression compared to standard playback.
    // Reverting to standard HTML5 video engine for stability.
    /*
    if (profile.supportsHardwareAcceleration && profile.supportsWebCodecs && !profile.isMobile && !profile.isLowEnd) {
      console.log('🚀 Enabling MediaBunny preview engine for high-end hardware');
      setUseMediaBunny(true);
    }
    */
    setUseMediaBunny(false);
    
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
  
  // Initialize enhanced hardware detection for detailed GPU/processor info
  useEffect(() => {
    const initEnhancedDetection = async () => {
      try {
        const { detectHardware } = await import('../utils/hardwareDetection');
        const enhanced = await detectHardware();
        setEnhancedProfile(enhanced);
        
        console.log('🖥️ Enhanced hardware detection:', {
          gpu: enhanced.gpu,
          processor: enhanced.processor,
          recommendations: enhanced.recommendations
        });
      } catch (error) {
        console.warn('Enhanced hardware detection failed:', error);
      }
    };
    
    initEnhancedDetection();
  }, []);
  
  // Debug: Log aspect ratio changes
  useEffect(() => {
    console.log('🖼️ VideoPlayer: aspect ratio changed to', aspectRatio);
  }, [aspectRatio]);
  
  // Track preview container dimensions for text scaling
  useEffect(() => {
    const updateDimensions = () => {
      // OPTIMISATION: Ignorer les mises à jour de resize pendant le scrubbing
      // pour éviter les re-renders additionnels qui causent des saccades
      if (isScrubbingRef.current) return;
      
      if (videoContainerRef.current) {
        const rect = videoContainerRef.current.getBoundingClientRect();
        // Find the actual video display area within the container
        // The video maintains aspect ratio, so we need to calculate the actual display size
        const containerWidth = rect.width;
        const containerHeight = rect.height;
        
        // Get the aspect ratio value
        let aspectWidth = 16, aspectHeight = 9;
        switch (aspectRatio) {
          case '16:9': aspectWidth = 16; aspectHeight = 9; break;
          case '9:16': aspectWidth = 9; aspectHeight = 16; break;
          case '1:1': aspectWidth = 1; aspectHeight = 1; break;
          case '4:3': aspectWidth = 4; aspectHeight = 3; break;
          case '21:9': aspectWidth = 21; aspectHeight = 9; break;
        }
        
        // Calculate the actual display dimensions maintaining aspect ratio
        const containerAspect = containerWidth / containerHeight;
        const videoAspect = aspectWidth / aspectHeight;
        
        let displayWidth, displayHeight;
        if (containerAspect > videoAspect) {
          // Container is wider than video - height is the constraint
          displayHeight = containerHeight;
          displayWidth = containerHeight * videoAspect;
        } else {
          // Container is taller than video - width is the constraint
          displayWidth = containerWidth;
          displayHeight = containerWidth / videoAspect;
        }
        
        setPreviewDimensions({ width: displayWidth, height: displayHeight });
        console.log('📐 Preview dimensions updated:', { displayWidth, displayHeight, containerWidth, containerHeight });
      }
    };
    
    updateDimensions();
    
    // Use ResizeObserver for more accurate tracking
    const resizeObserver = new ResizeObserver(updateDimensions);
    if (videoContainerRef.current) {
      resizeObserver.observe(videoContainerRef.current);
    }
    
    window.addEventListener('resize', updateDimensions);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateDimensions);
    };
  }, [aspectRatio]);
  
  // Calculate text scale factor based on preview size vs export resolution
  const getTextScaleFactor = useCallback(() => {
    if (previewDimensions.width === 0 || previewDimensions.height === 0) {
      return 1;
    }
    
    // Get the export resolution
    const exportResolution = RESOLUTION_PRESETS[exportSettings.resolution];
    const exportWidth = exportResolution.width;
    const exportHeight = exportResolution.height;
    
    // Calculate scale factor based on the preview width vs export width
    // This ensures text appears at the same relative size in preview as in export
    const scaleFactor = previewDimensions.width / exportWidth;
    
    console.log('📝 Text scale factor:', {
      previewWidth: previewDimensions.width,
      exportWidth,
      scaleFactor
    });
    
    return scaleFactor;
  }, [previewDimensions, exportSettings.resolution]);
  
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
        // Cap at 30fps for stability even in original quality
        // 60fps decoding of 4K content is often unstable in browser
        newSettings.targetFps = 30;
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
  
  // OPTIMISATION: Utiliser useMemo au lieu de useCallback pour getActiveClips
  // Cela évite les recalculs à chaque render quand les clips n'ont pas changé
  // NOTE: track.muted should only affect AUDIO playback, not video display
  // Video clips should always be visible regardless of mute state
  const activeClipsData = useMemo(() => {
    const result: { clip: TimelineClip; media: MediaFile; trackIndex: number; trackMuted: boolean }[] = [];
    
    tracks.forEach((track, index) => {
      // Only filter by track type, NOT by muted state
      // Muted tracks should still show video, just without audio
      if (track.type !== 'video') return;
      
      const clip = track.clips.find(c => {
        const clipStart = c.startTime;
        const clipEnd = c.startTime + (c.duration - c.trimStart - c.trimEnd);
        // Use <= for clipEnd to include clips at exactly the boundary (important for split clips)
        // This ensures the preview doesn't disappear when playhead is at the exact split point
        return player.currentTime >= clipStart && player.currentTime <= clipEnd;
      });
      
      if (clip) {
        const media = mediaFiles.find(m => m.id === clip.mediaId);
        if (media) {
          // Include trackMuted state so audio can be properly controlled
          result.push({ clip, media, trackIndex: index, trackMuted: track.muted });
        }
      }
    });
    
    return result;
  }, [tracks, mediaFiles, player.currentTime]);
  
  // Fonction wrapper pour compatibilité avec le code existant
  const getActiveClips = useCallback(() => activeClipsData, [activeClipsData]);

  // Audio preview: get all active audio clips at playhead (supports external audio tracks + detached audio)
  const getActiveAudioClips = useCallback(() => {
    const activeAudio: { clip: TimelineClip; media: MediaFile; trackIndex: number; trackMuted: boolean }[] = [];

    tracks.forEach((track, index) => {
      if (track.type !== 'audio') return;

      const clip = track.clips.find((c) => {
        const clipStart = c.startTime;
        const clipEnd = c.startTime + (c.duration - c.trimStart - c.trimEnd);
        return player.currentTime >= clipStart && player.currentTime <= clipEnd;
      });

      if (clip) {
        const media = mediaFiles.find((m) => m.id === clip.mediaId);
        if (media) {
          activeAudio.push({ clip, media, trackIndex: index, trackMuted: track.muted });
        }
      }
    });

    return activeAudio;
  }, [tracks, mediaFiles, player.currentTime]);

  // If a video clip has a detached audio clip present, mute the video's audio in preview to avoid double sound.
  const videoClipsWithDetachedAudio = useMemo(() => {
    const audioClipIds = new Set(
      tracks
        .filter((t) => t.type === 'audio')
        .flatMap((t) => t.clips)
        .map((c) => c.id)
    );

    const set = new Set<string>();
    tracks
      .filter((t) => t.type === 'video')
      .flatMap((t) => t.clips)
      .forEach((c) => {
        if (c.detachedAudioClipId && audioClipIds.has(c.detachedAudioClipId)) set.add(c.id);
      });

    return set;
  }, [tracks]);

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

    const style: React.CSSProperties = {};

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
    
    // DEBUG: Log audio sync for video elements
    console.log('[DEBUG syncVideoVolumeAndPlayback] Called:', {
      activeClipCount: activeClips.length,
      isPlaying: player.isPlaying,
      volume: player.volume,
      isMuted: player.isMuted,
      playbackRate: player.playbackRate
    });
    
    activeClips.forEach((item) => {
      if (item.media.type !== 'video') return;
      
      const videoEl = videoRefs.current[item.clip.id];
      if (!videoEl) return;

      // Determine if this is the "main" video (bottom-most video track)
      const isMainVideo = activeClips.find(c => c.media.type === 'video')?.clip.id === item.clip.id;

      // Only the main video gets volume, others are muted to prevent echo
      // Also mute if the track is muted OR if the clip's audio is muted
      const isAudioMuted =
        item.clip.audioMuted === true ||
        item.trackMuted === true ||
        videoClipsWithDetachedAudio.has(item.clip.id);
      const targetVolume = isMainVideo && !isAudioMuted ? (player.isMuted ? 0 : player.volume) : 0;
      
      // DEBUG: Log volume changes
      if (videoEl.volume !== targetVolume) {
        console.log('[DEBUG syncVideoVolumeAndPlayback] Volume change:', {
          clipId: item.clip.id,
          isMainVideo,
          isAudioMuted,
          oldVolume: videoEl.volume.toFixed(2),
          newVolume: targetVolume.toFixed(2)
        });
        videoEl.volume = targetVolume;
      }
      
      if (videoEl.playbackRate !== player.playbackRate) {
        console.log('[DEBUG syncVideoVolumeAndPlayback] PlaybackRate change:', {
          clipId: item.clip.id,
          oldRate: videoEl.playbackRate,
          newRate: player.playbackRate
        });
      }
      videoEl.playbackRate = player.playbackRate;

      if (player.isPlaying) {
        if (videoEl.paused) {
          console.log('[DEBUG syncVideoVolumeAndPlayback] Playing video:', item.clip.id);
          videoEl.play().catch((err) => {
            console.error('[DEBUG syncVideoVolumeAndPlayback] Play error:', err);
          });
        }
      } else {
        if (!videoEl.paused) {
          console.log('[DEBUG syncVideoVolumeAndPlayback] Pausing video:', item.clip.id);
          videoEl.pause();
        }
      }
    });
  }, [player.isPlaying, player.volume, player.isMuted, player.playbackRate, getActiveClips, videoClipsWithDetachedAudio]);

  // Sync audio track playback (external audio + detached audio clips)
  const syncAudioVolumeAndPlayback = useCallback(() => {
    const activeAudio = getActiveAudioClips();
    const activeIds = new Set(activeAudio.map((a) => a.clip.id));
    
    // DEBUG: Log audio track sync
    console.log('[DEBUG syncAudioVolumeAndPlayback] Called:', {
      activeAudioCount: activeAudio.length,
      activeIds: Array.from(activeIds),
      isPlaying: player.isPlaying,
      volume: player.volume,
      isMuted: player.isMuted,
      playbackRate: player.playbackRate
    });

    // Pause any non-active audio elements
    Object.entries(audioRefs.current).forEach(([clipId, el]) => {
      if (!el) return;
      if (!activeIds.has(clipId)) {
        if (!el.paused) {
          console.log('[DEBUG syncAudioVolumeAndPlayback] Pausing non-active audio:', clipId);
          el.pause();
        }
      }
    });

    activeAudio.forEach((item) => {
      const audioEl = audioRefs.current[item.clip.id];
      if (!audioEl) {
        console.log('[DEBUG syncAudioVolumeAndPlayback] No audio element for clip:', item.clip.id);
        return;
      }

      // Ensure src
      if (audioEl.getAttribute('src') !== item.media.url) {
        console.log('[DEBUG syncAudioVolumeAndPlayback] Setting src:', {
          clipId: item.clip.id,
          src: item.media.url
        });
        audioEl.setAttribute('src', item.media.url);
        audioEl.load();
      }

      // Sync time
      const clipStart = item.clip.startTime;
      const localTime = player.currentTime - clipStart + item.clip.trimStart;
      const timeDiff = Math.abs((audioEl.currentTime || 0) - localTime);
      
      const isScrubbing = isScrubbingRef.current;
      const seekThreshold = isScrubbing ? 0.25 : (player.isPlaying ? 0.1 : 0.05);
      
      // DEBUG: Log audio time sync
      if (timeDiff > 0.05 && !player.isPlaying) {
        console.log('[DEBUG syncAudioVolumeAndPlayback] Audio time check:', {
          clipId: item.clip.id,
          audioTime: (audioEl.currentTime || 0).toFixed(3),
          localTime: localTime.toFixed(3),
          timeDiff: timeDiff.toFixed(3),
          willSeek: timeDiff > seekThreshold
        });
      }
      
      if (timeDiff > seekThreshold && Number.isFinite(localTime)) {
        try {
          if (audioEl.readyState > 0) {
            console.log('[DEBUG syncAudioVolumeAndPlayback] Seeking audio:', {
              clipId: item.clip.id,
              to: localTime.toFixed(3)
            });
            audioEl.currentTime = Math.max(0, localTime);
          }
        } catch (err) {
          console.error('[DEBUG syncAudioVolumeAndPlayback] Seek error:', err);
        }
      }

      // Playback properties
      audioEl.playbackRate = player.playbackRate;
      const mutedByTrack = item.trackMuted === true;
      const targetVol = mutedByTrack || player.isMuted ? 0 : player.volume;
      
      // DEBUG: Log volume changes
      if (audioEl.volume !== targetVol) {
        console.log('[DEBUG syncAudioVolumeAndPlayback] Audio volume change:', {
          clipId: item.clip.id,
          oldVolume: audioEl.volume.toFixed(2),
          newVolume: targetVol.toFixed(2),
          mutedByTrack,
          isMuted: player.isMuted
        });
      }
      
      if (audioEl.volume !== targetVol) audioEl.volume = targetVol;
      audioEl.muted = targetVol === 0;

      if (player.isPlaying) {
        if (audioEl.paused) {
          console.log('[DEBUG syncAudioVolumeAndPlayback] Playing audio:', item.clip.id);
          audioEl.play().catch((err) => {
            console.error('[DEBUG syncAudioVolumeAndPlayback] Audio play error:', err);
          });
        }
      } else {
        if (!audioEl.paused) {
          console.log('[DEBUG syncAudioVolumeAndPlayback] Pausing audio:', item.clip.id);
          audioEl.pause();
        }
      }
    });
  }, [getActiveAudioClips, player.currentTime, player.isPlaying, player.isMuted, player.playbackRate, player.volume]);

  // Debounced video sync function to prevent stuttering during rapid navigation
  // This only handles time sync and filters, NOT volume/playback
  // OPTIMISATION: Seuils adaptatifs - bas pour lecture fluide, haut pour scrubbing
  const syncVideosDebounced = useCallback((forceSync: boolean = false) => {
    const now = performance.now();
    const timeSinceLastSync = now - lastSyncTimeRef.current;
    
    // DEBUG: Log syncVideosDebounced calls
    if (forceSync || timeSinceLastSync > 100) {
      console.log('[DEBUG syncVideosDebounced] Called:', {
        forceSync,
        timeSinceLastSync: timeSinceLastSync.toFixed(2) + 'ms',
        isPlaying: player.isPlaying,
        isScrubbing: isScrubbingRef.current
      });
    }
    
    // OPTIMISATION: Seuils adaptatifs selon le contexte
    // Pendant la lecture: seuils bas pour synchronisation fluide (60fps)
    // Pendant le scrubbing: seuils hauts pour réduire la charge CPU
    const isMobile = isMobileRef.current;
    const isScrubbing = isScrubbingRef.current;
    
    // Seuils pour la LECTURE (fluide, 60fps)
    const PLAYING_SYNC_INTERVAL = isMobile ? 16 : 16; // ~60fps pour synchronisation fluide
    const PLAYING_SEEK_THRESHOLD = isMobile ? 0.05 : 0.03; // Seuil bas pendant lecture
    
    // Seuils pour le SCRUBBING (économie CPU)
    const SCRUBBING_SYNC_INTERVAL = isMobile ? 100 : 50; // Moins fréquent pendant scrubbing
    const SCRUBBING_SEEK_THRESHOLD = isMobile ? 0.25 : 0.15; // Seuil haut pendant scrubbing
    
    // Choisir les seuils selon le contexte
    const MIN_SYNC_INTERVAL = isScrubbing ? SCRUBBING_SYNC_INTERVAL : PLAYING_SYNC_INTERVAL;
    const PAUSED_SYNC_INTERVAL = isMobile ? 50 : 33; // Debounce en pause
    
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
    
    // OPTIMISATION: Lire currentTime depuis le store dans le callback
    // au lieu de l'utiliser comme dépendance du useCallback
    const currentTime = useEditorStore.getState().player.currentTime;
    
    const activeClips = getActiveClips();
    
    // DEBUG: Log active clips being synced
    if (forceSync || activeClips.length > 0) {
      console.log('[DEBUG syncVideosDebounced] Syncing clips:', {
        clipCount: activeClips.length,
        currentTime: currentTime.toFixed(3),
        isMobile,
        seekThreshold: isScrubbing ? SCRUBBING_SEEK_THRESHOLD : PLAYING_SEEK_THRESHOLD
      });
    }
    
    // Sync all active video clips - time and filters only
    activeClips.forEach((item) => {
      if (item.media.type !== 'video') return;
      
      const videoEl = videoRefs.current[item.clip.id];
      if (!videoEl) return;

      // Only update src if it changed
      if (videoEl.getAttribute('src') !== item.media.url) {
        videoEl.setAttribute('src', item.media.url);
        videoEl.load();
      }

      // Ensure playback rate is applied (especially after load)
      if (videoEl.playbackRate !== player.playbackRate) {
        videoEl.playbackRate = player.playbackRate;
      }

      const clipStart = item.clip.startTime;
      const localTime = currentTime - clipStart + item.clip.trimStart;
      
      // OPTIMISATION CRITIQUE: Ne pas seek pendant la lecture
      // Pendant la lecture, la vidéo HTML5 avance naturellement
      // Seeker constamment crée des saccades (interruption du flux vidéo)
      // On ne seek que quand on est en pause ou pendant le scrubbing
      const isScrubbing = isScrubbingRef.current;
      
      // Seuil pour le scrubbing (haut pour éviter les seeks excessifs)
      const scrubbingSeekThreshold = isMobile ? 0.25 : 0.15;
      // Seuil quand on est en pause (bas pour précision)
      const pausedSeekThreshold = 0.05;
      
      const seekThreshold = isScrubbing
        ? scrubbingSeekThreshold
        : (player.isPlaying ? Infinity : pausedSeekThreshold); // Infinity = pas de seek pendant lecture
      
      const timeDiff = Math.abs(videoEl.currentTime - localTime);
      
      // DEBUG: Log timeDiff for each clip (moins fréquent pour éviter le spam)
      if ((timeDiff > 0.05 || forceSync) && !player.isPlaying) {
        console.log('[DEBUG syncVideosDebounced] Clip time check:', {
          clipId: item.clip.id,
          videoTime: videoEl.currentTime.toFixed(3),
          localTime: localTime.toFixed(3),
          timeDiff: timeDiff.toFixed(3),
          seekThreshold: seekThreshold === Infinity ? 'NO_SEEK (playing)' : seekThreshold.toFixed(3),
          willSeek: timeDiff > seekThreshold && seekThreshold !== Infinity
        });
      }
      
      // Ne seek que si on n'est PAS en train de jouer (sauf scrubbing)
      if (!player.isPlaying || isScrubbing) {
        if (timeDiff > seekThreshold) {
          // Mark as seeking to prevent race conditions
          if (!isSeekingRef.current) {
            isSeekingRef.current = true;
            if (videoEl.readyState > 0) {
              console.log('[DEBUG syncVideosDebounced] SEEKING video:', {
                clipId: item.clip.id,
                from: videoEl.currentTime.toFixed(3),
                to: localTime.toFixed(3),
                diff: timeDiff.toFixed(3),
                reason: isScrubbing ? 'scrubbing' : 'paused'
              });
              videoEl.currentTime = localTime;
            }
            
            // Reset seeking flag after a short delay (longer on mobile)
            setTimeout(() => {
              isSeekingRef.current = false;
            }, isMobile ? 100 : 50);
          }
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
    
    // Sync MediaBunny if enabled
    // CRITICAL OPTIMIZATION: Only sync here if PAUSED.
    // If playing, the animation loop handles rendering to avoid double-calls and resource contention.
    if (useMediaBunny && isMediaBunnyReady && canvasRef.current && (!player.isPlaying || forceSync)) {
      renderMediaBunny(currentTime, canvasRef.current.width, canvasRef.current.height).catch(console.error);
    }
    
    // Always sync volume and playback state immediately after time sync
    syncVideoVolumeAndPlayback();

    // Also sync audio tracks (not debounced separately for now)
    syncAudioVolumeAndPlayback();
    // OPTIMISATION: Ne pas inclure player.currentTime dans les dépendances
    // Le callback lit currentTime depuis le store, pas comme dépendance
    // Cela évite les re-renders en cascade lors du scrubbing
  }, [player.isPlaying, filters, syncVideoVolumeAndPlayback, syncAudioVolumeAndPlayback]);
  
  // Sync volume and playback immediately when these change (no debounce)
  useEffect(() => {
    syncVideoVolumeAndPlayback();
    syncAudioVolumeAndPlayback();
  }, [syncVideoVolumeAndPlayback, syncAudioVolumeAndPlayback, player.volume, player.isMuted, player.playbackRate, audioMutedStates]);

  const allAudioClips = useMemo(() => {
    return tracks
      .filter((t) => t.type === 'audio')
      .flatMap((t) => t.clips)
      .map((clip) => ({
        clip,
        media: mediaFiles.find((m) => m.id === clip.mediaId) || null,
      }))
      .filter((x) => !!x.media) as { clip: TimelineClip; media: MediaFile }[];
  }, [tracks, mediaFiles]);

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
    const isLowEnd = previewSettings.quality === 'low';
    // Use targetFps from settings to determine time step
    const targetFps = previewSettings.targetFps || 30;
    const MIN_TIME_STEP = 1000 / targetFps;
    const FPS_UPDATE_INTERVAL = (isMobile || isLowEnd) ? 60 : 30; // Update FPS display less often on mobile/low-end
    
    // DEBUG: Reset diagnostic counters
    debugLogCounterRef.current = 0;
    debugLastFrameTimeRef.current = performance.now();
    debugFrameTimesRef.current = [];
    debugLastLogTimeRef.current = performance.now();

    const animate = (currentTime: number) => {
      if (!isActive) return;
      
      // DEBUG: Calculate frame time and log every 60 frames
      const frameTime = currentTime - debugLastFrameTimeRef.current;
      debugLastFrameTimeRef.current = currentTime;
      debugFrameTimesRef.current.push(frameTime);
      if (debugFrameTimesRef.current.length > 10) debugFrameTimesRef.current.shift();
      
      debugLogCounterRef.current++;
      const now = performance.now();
      const timeSinceLastLog = now - debugLastLogTimeRef.current;
      
      // Log every 60 frames (~1 second at 60fps) or every 500ms
      if (debugLogCounterRef.current >= 60 || timeSinceLastLog > 500) {
        debugLogCounterRef.current = 0;
        debugLastLogTimeRef.current = now;
        const avgFrameTime = debugFrameTimesRef.current.reduce((a, b) => a + b, 0) / debugFrameTimesRef.current.length;
        const effectiveFps = 1000 / avgFrameTime;
        
        console.log('[DEBUG Animation Loop]', {
          frameTime: frameTime.toFixed(2) + 'ms',
          avgFrameTime: avgFrameTime.toFixed(2) + 'ms',
          effectiveFps: effectiveFps.toFixed(1),
          accumulatedTime: accumulatedTime.toFixed(2),
          targetFps,
          MIN_TIME_STEP: MIN_TIME_STEP.toFixed(2),
          isMobile,
          isLowEnd,
          isScrubbing: isScrubbingRef.current
        });
      }
      
      // Frame rate limiting for smooth playback on low-end devices
      const frameLimiter = frameRateLimiterRef.current;
      if (frameLimiter && !frameLimiter.shouldRenderFrame(currentTime)) {
        // DEBUG: Log skipped frame
        if (debugLogCounterRef.current === 0) {
          console.log('[DEBUG Frame Skip] Frame skipped by limiter');
        }
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
          
          // Auto-adjust quality if performance is poor (avec cooldown)
          const nowPerf = performance.now();
          const timeSinceLastChange = nowPerf - lastAutoQualityChangeRef.current;
          
          // DEBUG: Log performance monitoring
          console.log('[DEBUG Performance Monitor]', {
            fps: fps.toFixed(1),
            isPoor,
            isPerformancePoor,
            timeSinceLastChange: timeSinceLastChange.toFixed(0) + 'ms',
            currentQuality: previewSettings.quality,
            targetFps: previewSettings.targetFps,
            frameSkipping: previewSettings.frameSkipping
          });
          
          if (isPoor && previewSettings.quality !== 'low' && timeSinceLastChange > AUTO_QUALITY_COOLDOWN) {
            const recommendation = perfMonitor.getQualityRecommendation();
            console.log('[DEBUG Performance Monitor] Auto-reducing quality:', {
              recommendation,
              from: previewSettings.quality,
              timeSinceLastChange: timeSinceLastChange.toFixed(0) + 'ms'
            });
            if (recommendation === 'decrease') {
              console.log('⚠️ Poor performance detected, reducing quality');
              lastAutoQualityChangeRef.current = nowPerf;
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
      
      const nowUpdate = performance.now();
      const timeSinceLastUpdate = nowUpdate - lastStateUpdateRef.current;
      
      const isScrubbing = isScrubbingRef.current;
      const playingUpdateThreshold = (isMobile || isLowEnd) ? 33 : 16; // 30-60fps pendant lecture
      const scrubbingUpdateThreshold = (isMobile || isLowEnd) ? 100 : 50; // 10-20fps pendant scrubbing
      const updateThreshold = isScrubbing ? scrubbingUpdateThreshold : playingUpdateThreshold;
      
      if (accumulatedTime >= MIN_TIME_STEP && timeSinceLastUpdate >= updateThreshold) {
        // Get current state directly (avoid re-render)
        const state = useEditorStore.getState();
        const timeAdvance = (accumulatedTime / 1000) * state.player.playbackRate;
        const newTime = state.player.currentTime + timeAdvance;
        
        // Reset accumulated time
        accumulatedTime = 0;
        lastStateUpdateRef.current = nowUpdate;
        
        if (newTime >= state.projectDuration) {
          console.log('[DEBUG Animation Loop] End reached, seeking to 0 and pausing');
          state.seek(0);
          state.pause();
        } else {
          state.seek(newTime);
        }
      }

      // Render MediaBunny frame if enabled
      // Pass the CALCULATED newTime (or current state time) to renderMediaBunny
      // Using state.player.currentTime might be one frame behind if the seek() above hasn't propagated yet
      // But for visual smoothness, we should use the time we just calculated.
      if (useMediaBunny && isMediaBunnyReady && canvasRef.current) {
        const state = useEditorStore.getState();
        // Use the time we just calculated for the most accurate sync
        const renderTime = state.player.currentTime; 
        renderMediaBunny(renderTime, canvasRef.current.width, canvasRef.current.height).catch(e => {
          console.error('MediaBunny render error:', e);
        });
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
    // OPTIMISATION: Activer le flag isScrubbing pendant l'interaction
    isScrubbingRef.current = true;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    seek(percentage * projectDuration);
    
    // Désactiver le flag après un délai plus long pour couvrir toute la transition
    // 300ms pour s'assurer que tous les seeks sont terminés
    setTimeout(() => {
      isScrubbingRef.current = false;
    }, 300);
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
      const newCrop = { ...cropArea };

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

  // Utiliser directement activeClipsData (useMemo) au lieu de getActiveClips()
  // pour éviter les appels de fonction inutiles
  const activeClips = activeClipsData;
  const currentTexts = getCurrentTextOverlays();
  const progressPercentage = projectDuration > 0 ? (player.currentTime / projectDuration) * 100 : 0;

  const playbackSpeeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

  // Close preview quality menu when clicking outside / pressing Escape
  useEffect(() => {
    if (!showQualityMenu) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (qualityMenuRef.current?.contains(target)) return;
      if (qualityButtonRef.current?.contains(target)) return;
      setShowQualityMenu(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowQualityMenu(false);
    };

    // Use capture so we can close before other handlers run.
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showQualityMenu]);

  // Close playback speed menu when clicking outside / pressing Escape
  useEffect(() => {
    if (!showSpeedMenu) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (speedMenuRef.current?.contains(target)) return;
      if (speedButtonRef.current?.contains(target)) return;
      setShowSpeedMenu(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowSpeedMenu(false);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showSpeedMenu]);
  
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
      
      // Avoid re-applying optimizations if already done
      if (el.dataset.optimized === 'true') return;
      
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
      
      // Apply enhanced hardware-based optimizations if available
      if (enhancedProfile) {
        // Set playback quality hints based on GPU tier
        if (enhancedProfile.gpu.tier === 'low') {
          el.dataset.qualityHint = 'low';
        } else if (enhancedProfile.gpu.tier === 'high') {
          el.dataset.qualityHint = 'high';
        }
        
        // Enable hardware acceleration if supported
        if (enhancedProfile.gpu.supportsHardwareAcceleration) {
          el.style.transform = 'translateZ(0)'; // Force GPU layer
        }
      }
    } else {
      delete videoRefs.current[id];
    }
  }, [previewSettings, hardwareProfile, enhancedProfile]);
  
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

  // Calculate fold-aware container styles
  const getFoldAwareContainerStyles = (): React.CSSProperties => {
    const styles: React.CSSProperties = {};
    
    // If device is spanning across fold, add padding to avoid hinge
    if (responsive.isSpanning && responsive.hingeWidth > 0) {
      // For video player, we want to keep video on one side of the fold
      // or center it avoiding the hinge
      styles.paddingLeft = `${responsive.hingeWidth / 2}px`;
      styles.paddingRight = `${responsive.hingeWidth / 2}px`;
    }
    
    return styles;
  };

  return (
    <div
      ref={containerRef}
      className={`glass-panel flex flex-col h-full fold-transition ${player.isFullscreen ? 'fixed inset-0 z-[100] rounded-none' : ''}`}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(true)}
      style={getFoldAwareContainerStyles()}
    >
      {/* Video Container - Fold-aware with aspect ratio handling */}
      <div
        ref={videoContainerRef}
        className={`flex-1 relative bg-black rounded-t-xl overflow-hidden flex items-center justify-center p-1 fold-cover:p-0.5 fold-open:p-2 sm:p-4 min-h-0 ${responsive.isSpanning ? 'avoid-hinge' : ''}`}
      >
        {/* Hidden audio elements for timeline audio playback */}
        <div style={{ display: 'none' }}>
          {allAudioClips.map(({ clip, media }) => (
            <audio
              key={clip.id}
              ref={(el) => {
                if (el) audioRefs.current[clip.id] = el;
                else delete audioRefs.current[clip.id];
              }}
              src={media.url}
              preload={hardwareProfile?.isMobile ? 'metadata' : 'auto'}
            />
          ))}
        </div>
        {/* Aspect Ratio Indicator - Responsive sizing */}
        <div className={`absolute top-1 fold-cover:top-0.5 fold-open:top-2 right-1 fold-cover:right-0.5 fold-open:right-2 bg-black/70 backdrop-blur-sm px-1.5 fold-cover:px-1 fold-open:px-2 sm:px-3 py-0.5 fold-cover:py-0.5 fold-open:py-1 rounded-full ${isMinimal ? 'text-[8px]' : isCompact ? 'text-[9px]' : 'text-xs'} font-medium text-white z-50 border border-white/20`}>
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
          {/* MediaBunny Canvas for high-performance preview */}
          {useMediaBunny && (
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
              width={previewDimensions.width || 1920}
              height={previewDimensions.height || 1080}
              style={{ zIndex: 5 }}
            />
          )}

          {activeClips.length > 0 ? (
            <>
              {/* Render all active clips (videos and images) layered */}
              {activeClips.map((item, index) => {
                const isSelected = ui.selectedClipId === item.clip.id;
                const zIndex = 10 + index; // Higher tracks appear on top
                const transitionStyle = getTransitionStyle(item.clip, player.currentTime);

                if (item.media.type === 'video') {
                  // If MediaBunny is enabled, use it for video rendering
                  // But render an audio element for the sound
                  if (useMediaBunny) {
                    return (
                      <audio
                        key={item.clip.id}
                        ref={(el) => {
                          // Cast to any/VideoElement to satisfy the ref type
                          // Audio and Video elements share the HTMLMediaElement interface which is what we mostly use
                          if (el) videoRefs.current[item.clip.id] = el as unknown as HTMLVideoElement;
                        }}
                        src={item.media.url}
                        preload="auto"
                        onError={(e) => console.error('Audio error:', e.currentTarget.error, item.media.url)}
                      />
                    );
                  }

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
                    {/* Corner handles - Small and unobtrusive */}
                    <div
                      className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-primary-500 border border-white rounded-sm cursor-nwse-resize hover:scale-125 transition-transform shadow-md"
                      onMouseDown={(e) => handleCropResizeStart(e, 'nw')}
                    />
                    <div
                      className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-primary-500 border border-white rounded-sm cursor-nesw-resize hover:scale-125 transition-transform shadow-md"
                      onMouseDown={(e) => handleCropResizeStart(e, 'ne')}
                    />
                    <div
                      className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-primary-500 border border-white rounded-sm cursor-nesw-resize hover:scale-125 transition-transform shadow-md"
                      onMouseDown={(e) => handleCropResizeStart(e, 'sw')}
                    />
                    <div
                      className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-primary-500 border border-white rounded-sm cursor-nwse-resize hover:scale-125 transition-transform shadow-md"
                      onMouseDown={(e) => handleCropResizeStart(e, 'se')}
                    />
                    
                    {/* Edge handles - Small bars */}
                    <div
                      className="absolute -top-1 left-1/2 -translate-x-1/2 w-6 h-2 bg-primary-500 border border-white rounded-sm cursor-ns-resize hover:scale-110 transition-transform shadow-md"
                      onMouseDown={(e) => handleCropResizeStart(e, 'n')}
                    />
                    <div
                      className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-6 h-2 bg-primary-500 border border-white rounded-sm cursor-ns-resize hover:scale-110 transition-transform shadow-md"
                      onMouseDown={(e) => handleCropResizeStart(e, 's')}
                    />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 -left-1 w-2 h-6 bg-primary-500 border border-white rounded-sm cursor-ew-resize hover:scale-110 transition-transform shadow-md"
                      onMouseDown={(e) => handleCropResizeStart(e, 'w')}
                    />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 -right-1 w-2 h-6 bg-primary-500 border border-white rounded-sm cursor-ew-resize hover:scale-110 transition-transform shadow-md"
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
              {!cropMode && currentTexts.map((text) => {
                // Calculate scaled font size to match export resolution
                const scaleFactor = getTextScaleFactor();
                const scaledFontSize = text.fontSize * scaleFactor;
                
                return (
                <div
                  key={text.id}
                  className={`absolute cursor-move ${ui.selectedTextId === text.id ? 'ring-2 ring-primary-500' : ''}`}
                  style={{
                    zIndex: 50, // Always on top of video/images
                    left: `${text.x}%`,
                    top: `${text.y}%`,
                    transform: `translate(-50%, -50%) scale(${text.scaleX ?? 1}, ${text.scaleY ?? 1})`,
                    fontSize: `${scaledFontSize}px`,
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
                        fontSize: `${scaledFontSize}px`,
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

                  {/* Resize handles for text - with inverse scale to counteract parent's scale transform */}
                  {ui.selectedTextId === text.id && !editingTextId && (
                    <>
                      <div
                        className="absolute -top-2 -left-2 w-3 h-3 bg-primary-500 border border-white rounded-full cursor-nwse-resize hover:scale-125 transition-transform z-10"
                        style={{ transform: `scale(${1 / (text.scaleX ?? 1)}, ${1 / (text.scaleY ?? 1)})` }}
                        onMouseDown={(e) => handleTextResizeStart(e, text.id, 'nw')}
                      />
                      <div
                        className="absolute -top-2 -right-2 w-3 h-3 bg-primary-500 border border-white rounded-full cursor-nesw-resize hover:scale-125 transition-transform z-10"
                        style={{ transform: `scale(${1 / (text.scaleX ?? 1)}, ${1 / (text.scaleY ?? 1)})` }}
                        onMouseDown={(e) => handleTextResizeStart(e, text.id, 'ne')}
                      />
                      <div
                        className="absolute -bottom-2 -left-2 w-3 h-3 bg-primary-500 border border-white rounded-full cursor-nesw-resize hover:scale-125 transition-transform z-10"
                        style={{ transform: `scale(${1 / (text.scaleX ?? 1)}, ${1 / (text.scaleY ?? 1)})` }}
                        onMouseDown={(e) => handleTextResizeStart(e, text.id, 'sw')}
                      />
                      <div
                        className="absolute -bottom-2 -right-2 w-3 h-3 bg-primary-500 border border-white rounded-full cursor-nwse-resize hover:scale-125 transition-transform z-10"
                        style={{ transform: `scale(${1 / (text.scaleX ?? 1)}, ${1 / (text.scaleY ?? 1)})` }}
                        onMouseDown={(e) => handleTextResizeStart(e, text.id, 'se')}
                      />
                      
                      {/* Side handles */}
                      <div
                        className="absolute top-1/2 -left-2 w-3 h-3 bg-primary-500 border border-white rounded-full cursor-ew-resize hover:scale-125 transition-transform z-10"
                        style={{ transform: `translateY(-50%) scale(${1 / (text.scaleX ?? 1)}, ${1 / (text.scaleY ?? 1)})` }}
                        onMouseDown={(e) => handleTextResizeStart(e, text.id, 'w')}
                      />
                      <div
                        className="absolute top-1/2 -right-2 w-3 h-3 bg-primary-500 border border-white rounded-full cursor-ew-resize hover:scale-125 transition-transform z-10"
                        style={{ transform: `translateY(-50%) scale(${1 / (text.scaleX ?? 1)}, ${1 / (text.scaleY ?? 1)})` }}
                        onMouseDown={(e) => handleTextResizeStart(e, text.id, 'e')}
                      />
                      <div
                        className="absolute -top-2 left-1/2 w-3 h-3 bg-primary-500 border border-white rounded-full cursor-ns-resize hover:scale-125 transition-transform z-10"
                        style={{ transform: `translateX(-50%) scale(${1 / (text.scaleX ?? 1)}, ${1 / (text.scaleY ?? 1)})` }}
                        onMouseDown={(e) => handleTextResizeStart(e, text.id, 'n')}
                      />
                      <div
                        className="absolute -bottom-2 left-1/2 w-3 h-3 bg-primary-500 border border-white rounded-full cursor-ns-resize hover:scale-125 transition-transform z-10"
                        style={{ transform: `translateX(-50%) scale(${1 / (text.scaleX ?? 1)}, ${1 / (text.scaleY ?? 1)})` }}
                        onMouseDown={(e) => handleTextResizeStart(e, text.id, 's')}
                      />
                    </>
                  )}
                </div>
              );
              })}
            </>
          ) : (
            <div className="text-center text-neutral-400 p-2 fold-cover:p-1 fold-open:p-4">
              <div className={`${isMinimal ? 'w-12 h-12' : isCompact ? 'w-14 h-14' : 'w-20 h-20'} mx-auto mb-2 fold-cover:mb-1 fold-open:mb-4 rounded-xl fold-cover:rounded-lg fold-open:rounded-2xl bg-glass-medium flex items-center justify-center`}>
                <Play className={`${isMinimal ? 'w-6 h-6' : isCompact ? 'w-7 h-7' : 'w-10 h-10'}`} />
              </div>
              <p className={`${isMinimal ? 'text-xs' : isCompact ? 'text-sm' : 'text-body-lg'} text-white`}>Aucune vidéo</p>
              <p className={`${isMinimal ? 'text-[9px]' : isCompact ? 'text-[10px]' : 'text-small'} mt-0.5 fold-cover:mt-0.5 fold-open:mt-1 text-neutral-400`}>Ajoutez des médias</p>
            </div>
          )}
        </div>

        {/* Big Play Button - Hidden when mobile sidebar is open, touch-friendly sizing */}
        {!player.isPlaying && activeClips.length > 0 && !cropMode && !editingTextId && !transformingImageId && !resizingImageId && !rotatingImageId && !draggedTextId && !ui.selectedClipId && !ui.selectedTextId && !resizingTextId && !ui.isMobileSidebarOpen && (
          <button
            onClick={togglePlayPause}
            className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors z-[60]"
          >
            <div className={`${isMinimal ? 'w-14 h-14' : isCompact ? 'w-16 h-16' : 'w-20 h-20'} rounded-full bg-glass-light backdrop-blur-md flex items-center justify-center shadow-glass-lg touch-target-lg`}>
              <Play className={`${isMinimal ? 'w-7 h-7' : isCompact ? 'w-8 h-8' : 'w-10 h-10'} text-primary-500 ml-0.5 fold-cover:ml-0.5 fold-open:ml-1`} fill="currentColor" />
            </div>
          </button>
        )}
      </div>

      {/* Progress Bar - Touch-friendly with larger hit area */}
      <div
        className={`${isMinimal ? 'h-1.5' : isCompact ? 'h-2' : 'h-1.5'} bg-neutral-200/50 cursor-pointer relative group flex-shrink-0`}
        onClick={handleProgressClick}
        style={{ minHeight: touchTargetSize >= 48 ? '8px' : '6px' }}
      >
        <div
          className="absolute inset-y-0 left-0 bg-primary-500 transition-all"
          style={{ width: `${progressPercentage}%` }}
        />
        <div
          className={`absolute top-1/2 -translate-y-1/2 ${isMinimal ? 'w-3 h-3' : 'w-3 h-3'} bg-primary-500 rounded-full shadow-glow-violet opacity-0 group-hover:opacity-100 transition-opacity`}
          style={{ left: `calc(${progressPercentage}% - 6px)` }}
        />
      </div>

      {/* Controls */}
      <div className={`px-1.5 fold-cover:px-1 fold-open:px-2 sm:px-4 py-1.5 fold-cover:py-1 fold-open:py-2 sm:py-3 flex items-center justify-between gap-1 fold-cover:gap-0.5 fold-open:gap-2 sm:gap-4 transition-opacity flex-shrink-0 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
        {/* Left Controls */}
        <div className="flex items-center gap-0.5 fold-cover:gap-0.5 fold-open:gap-1 sm:gap-2 flex-shrink-0">
          {/* Skip back - hidden on very small screens */}
          <button
            onClick={() => seek(0)}
            className={`btn-icon ${isMinimal ? 'w-7 h-7 hidden xxs:flex' : isCompact ? 'w-8 h-8' : 'w-9 h-9'} touch-target flex-shrink-0`}
            title="Debut"
          >
            <SkipBack className={`${isMinimal ? 'w-3 h-3' : 'w-4 h-4'}`} />
          </button>
          <button
            onClick={() => !cropMode && !editingTextId && togglePlayPause()}
            className={`btn-icon ${isMinimal ? 'w-9 h-9' : isCompact ? 'w-10 h-10' : 'w-10 h-10'} bg-primary-500 text-white hover:bg-primary-600 border-primary-500 touch-target-lg flex-shrink-0 ${cropMode || editingTextId ? 'opacity-50 cursor-not-allowed' : ''}`}
            title={player.isPlaying ? 'Pause' : 'Lecture'}
            disabled={cropMode || !!editingTextId}
          >
            {player.isPlaying ? <Pause className={`${isMinimal ? 'w-4 h-4' : 'w-5 h-5'}`} /> : <Play className={`${isMinimal ? 'w-4 h-4' : 'w-5 h-5'} ml-0.5`} />}
          </button>
          {/* Skip forward - hidden on very small screens */}
          <button
            onClick={() => seek(projectDuration)}
            className={`btn-icon ${isMinimal ? 'w-7 h-7 hidden xxs:flex' : isCompact ? 'w-8 h-8' : 'w-9 h-9'} touch-target flex-shrink-0`}
            title="Fin"
          >
            <SkipForward className={`${isMinimal ? 'w-3 h-3' : 'w-4 h-4'}`} />
          </button>

          {/* Frame by frame - Hidden on small/foldable screens */}
          <div className="hidden lg:flex items-center gap-1 ml-2">
            <button onClick={() => seek(Math.max(0, player.currentTime - 1/30))} className="btn-icon w-8 h-8 touch-target" title="Image precedente">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button onClick={() => seek(Math.min(projectDuration, player.currentTime + 1/30))} className="btn-icon w-8 h-8 touch-target" title="Image suivante">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Time Display - Compact on small screens */}
        <div className={`font-mono ${isMinimal ? 'text-[8px]' : isCompact ? 'text-[9px]' : 'text-small'} text-neutral-400 flex-shrink min-w-0`}>
          <span className="text-white">{formatTime(player.currentTime)}</span>
          <span className="mx-0.5 text-neutral-500">/</span>
          <span>{formatTime(projectDuration)}</span>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-0.5 fold-cover:gap-0.5 fold-open:gap-1 sm:gap-2 flex-shrink-0">
          {/* Volume - Hidden on minimal and compact screens */}
          <div className={`relative ${isMinimal || isCompact ? 'hidden' : 'flex'} items-center gap-1 sm:gap-2`}>
            <button
              onClick={() => setShowVolumeSlider(!showVolumeSlider)}
              className="btn-icon w-9 h-9 touch-target"
              title="Volume"
            >
              {player.isMuted || player.volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <div
              className={`hidden md:flex items-center gap-2 transition-all duration-200 overflow-hidden ${showVolumeSlider ? 'w-32 opacity-100' : 'w-0 opacity-0'}`}
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

          {/* Preview Quality - Hidden on minimal and compact screens */}
          <div className={`relative ${isMinimal || isCompact ? 'hidden' : 'block'}`}>
            <button
              ref={qualityButtonRef}
              onClick={() => setShowQualityMenu(!showQualityMenu)}
              className={`btn-icon ${isCompact ? 'w-9 h-9' : 'w-9 h-9'} touch-target ${isPerformancePoor ? 'text-warning' : ''}`}
              title="Qualité"
            >
              <Gauge className={`${isCompact ? 'w-4 h-4' : 'w-4 h-4'}`} />
            </button>
            {showQualityMenu && (
              <div
                ref={qualityMenuRef}
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
                    {/* Enhanced GPU info */}
                    {enhancedProfile && (
                      <div className="mt-2 pt-2" style={{ borderTop: '1px solid rgba(117, 122, 237, 0.2)', color: '#a0a0a0' }}>
                        <div className="flex items-center gap-1">
                          <Monitor className="w-3 h-3" />
                          <span className="text-[10px]">
                            GPU: {enhancedProfile.gpu.model || enhancedProfile.gpu.vendor}
                            {enhancedProfile.gpu.tier !== 'unknown' && ` (${enhancedProfile.gpu.tier})`}
                          </span>
                        </div>
                        {enhancedProfile.gpu.supportsWebGPU && (
                          <span className="text-[9px] ml-4 text-green-400">WebGPU ✓</span>
                        )}
                      </div>
                    )}
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

          {/* Playback Speed - Hidden on minimal and compact screens */}
          <div className={`relative ${isMinimal || isCompact ? 'hidden' : 'block'}`}>
            <button
              ref={speedButtonRef}
              onClick={() => setShowSpeedMenu(!showSpeedMenu)}
              className="btn-icon w-9 h-9 text-caption font-mono touch-target"
              title="Vitesse"
            >
              {player.playbackRate}x
            </button>
            {showSpeedMenu && (
              <div
                ref={speedMenuRef}
                className="absolute bottom-full right-0 mb-2 p-1 bg-[var(--bg-secondary)] border border-[var(--bg-tertiary)] rounded-lg min-w-[80px] shadow-lg z-50"
              >
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
          <button
            onClick={toggleFullscreen}
            className={`btn-icon ${isMinimal ? 'w-7 h-7' : isCompact ? 'w-8 h-8' : 'w-9 h-9'} touch-target flex-shrink-0`}
            title={player.isFullscreen ? 'Quitter' : 'Plein écran'}
          >
            {player.isFullscreen ? <Minimize className={`${isMinimal ? 'w-3 h-3' : 'w-4 h-4'}`} /> : <Maximize className={`${isMinimal ? 'w-3 h-3' : 'w-4 h-4'}`} />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayer;
