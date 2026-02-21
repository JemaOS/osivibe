// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ZoomIn, ZoomOut, Volume2, VolumeX, Lock, Unlock, Plus, Scissors, Copy, Trash2, Music2, Split, Crop, Type, Monitor, Move } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { useResponsive, useLayoutMode } from '../hooks/use-responsive';
import { formatTime } from '../utils/helpers';
import type { TimelineClip, TextOverlay } from '../types';

// Base scale - will be adjusted based on screen size
const BASE_PIXELS_PER_SECOND = 50;

interface ContextMenu {
  id: string;
  type: 'clip' | 'text';
  x: number;
  y: number;
}

// Helper functions extracted to reduce cognitive complexity
const getTrackHeight = (layoutMode: string): number => {
  if (layoutMode === 'minimal') return 40;
  if (layoutMode === 'compact') return 48;
  if (layoutMode === 'adaptive') return 56;
  if (layoutMode === 'expanded') return 60;
  return 64; // Desktop
};

const getRulerHeight = (layoutMode: string): number => {
  if (layoutMode === 'minimal') return 24;
  if (layoutMode === 'compact') return 28;
  return 32;
};

const getLabelWidth = (layoutMode: string): number => {
  if (layoutMode === 'minimal') return 60;
  if (layoutMode === 'compact') return 80;
  if (layoutMode === 'adaptive') return 96;
  return 128; // Desktop
};

const getTrackLabel = (trackName: string, layoutMode: string): string => {
  const isDesktop = layoutMode === 'desktop';
  const isExpanded = layoutMode === 'expanded';
  const isMinimal = layoutMode === 'minimal';
  const isCompact = layoutMode === 'compact' || layoutMode === 'adaptive';
  
  if (isDesktop || isExpanded) return trackName;
  
  const lowerName = trackName.toLowerCase();
  
  if (isMinimal) {
    if (lowerName.includes('video')) return 'Vid';
    if (lowerName.includes('image')) return 'Img';
    if (lowerName.includes('audio')) return 'Aud';
    if (lowerName.includes('text')) return 'Txt';
    return trackName.substring(0, 3);
  }
  
  if (isCompact) {
    if (lowerName.includes('video')) return 'Video';
    if (lowerName.includes('image')) return 'Imgs';
    if (lowerName.includes('audio')) return 'Audio';
    if (lowerName.includes('text')) return 'Text';
    return trackName.length > 5 ? trackName.substring(0, 5) : trackName;
  }
  
  return trackName;
};

const getTrackIconComponent = (trackName: string, trackType: string) => {
  const lowerName = trackName.toLowerCase();
  if (lowerName.includes('video') || trackType === 'video') return Monitor;
  if (lowerName.includes('image')) return Monitor;
  if (lowerName.includes('audio') || trackType === 'audio') return Volume2;
  if (lowerName.includes('text')) return Type;
  return Monitor;
};

export const Timeline: React.FC = () => {
  const {
    tracks,
    mediaFiles,
    textOverlays,
    transitions,
    setTransition,
    removeTransition,
    aspectRatio,
    setAspectRatio,
    ui,
    player,
    projectDuration,
    selectClip,
    moveClip,
    updateClip,
    toggleTrackMute,
    toggleTrackLock,
    addTrack,
    seek,
    setTimelineZoom,
    setTimelineScrollX,
    updateTextOverlay,
    addTextOverlay,
    selectText,
    removeTextOverlay,
    removeClip,
    splitClip,
    undo,
    redo,
  } = useEditorStore();

  // Use responsive hook for adaptive timeline
  const responsive = useResponsive();
  const layoutMode = useLayoutMode();
  
  // Determine layout characteristics
  const isMinimal = layoutMode === 'minimal';
  const isCompact = layoutMode === 'compact';
  const isAdaptive = layoutMode === 'adaptive';
  const isExpanded = layoutMode === 'expanded';
  const isDesktop = layoutMode === 'desktop';

  const TRACK_HEIGHT = getTrackHeight(layoutMode);
  const RULER_HEIGHT = getRulerHeight(layoutMode);
  const LABEL_WIDTH = getLabelWidth(layoutMode);
  const PIXELS_PER_SECOND = BASE_PIXELS_PER_SECOND;

  const timelineRef = useRef<HTMLDivElement>(null);
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const labelsContainerRef = useRef<HTMLDivElement>(null);
  const [isDraggingClip, setIsDraggingClip] = useState(false);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [draggedClipId, setDraggedClipId] = useState<string | null>(null);
  const [isDraggingText, setIsDraggingText] = useState(false);
  const [draggedTextId, setDraggedTextId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizingClip, setResizingClip] = useState<{ id: string; edge: 'start' | 'end' } | null>(null);
  const [resizingText, setResizingText] = useState<{ id: string; edge: 'start' | 'end' } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [lastPinchDistance, setLastPinchDistance] = useState<number | null>(null);
  const [copiedClip, setCopiedClip] = useState<{ clip: TimelineClip; trackId: string } | null>(null);
  const [copiedText, setCopiedText] = useState<TextOverlay | null>(null);
  const [isDraggingTransition, setIsDraggingTransition] = useState(false);
  const [draggedTransitionId, setDraggedTransitionId] = useState<string | null>(null);
  
  // Touch scrubbing state
  const [isTouchScrubbing, setIsTouchScrubbing] = useState(false);
  const [touchStartX, setTouchStartX] = useState(0);
  const [touchStartTime, setTouchStartTime] = useState(0);

  const timelineWidth = Math.max(projectDuration * PIXELS_PER_SECOND * ui.timelineZoom, 1000);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (labelsContainerRef.current) {
      labelsContainerRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ignore if typing in an input field
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') {
      return;
    }

    // Undo/Redo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      e.preventDefault();
      redo();
      return;
    }

    // Delete key - remove selected clip or text
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (ui.selectedClipId) {
        e.preventDefault();
        removeClip(ui.selectedClipId);
        return;
      }
      if (ui.selectedTextId) {
        e.preventDefault();
        removeTextOverlay(ui.selectedTextId);
        return;
      }
    }

    // Ctrl+C or Cmd+C - copy selected clip or text
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      if (ui.selectedClipId) {
        e.preventDefault();
        const clip = tracks.flatMap(t => t.clips).find(c => c.id === ui.selectedClipId);
        const trackWithClip = tracks.find(t => t.clips.some(c => c.id === ui.selectedClipId));
        if (clip && trackWithClip) {
          setCopiedClip({ clip: { ...clip }, trackId: trackWithClip.id });
          setCopiedText(null);
        }
        return;
      }
      if (ui.selectedTextId) {
        e.preventDefault();
        const text = textOverlays.find(t => t.id === ui.selectedTextId);
        if (text) {
          setCopiedText({ ...text });
          setCopiedClip(null);
        }
        return;
      }
    }

    // Ctrl+V or Cmd+V - paste copied clip or text
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      if (copiedClip) {
        e.preventDefault();
        const media = mediaFiles.find(m => m.id === copiedClip.clip.mediaId);
        if (media) {
          const { addClipToTrack } = useEditorStore.getState();
          // Paste at playhead position
          addClipToTrack(copiedClip.trackId, media, player.currentTime);
        }
        return;
      }
      if (copiedText) {
        e.preventDefault();
        const { addTextOverlay } = useEditorStore.getState();
        addTextOverlay({
          ...copiedText,
          id: undefined, // Generate new ID
          startTime: player.currentTime,
        });
        return;
      }
    }

    // Arrow keys for seeking
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      seek(Math.max(0, player.currentTime - 0.1));
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      seek(Math.min(projectDuration, player.currentTime + 0.1));
    }
    
    if (e.shiftKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      seek(Math.max(0, player.currentTime - 1));
    }
    if (e.shiftKey && e.key === 'ArrowRight') {
      e.preventDefault();
      seek(Math.min(projectDuration, player.currentTime + 1));
    }
  }, [ui.selectedClipId, ui.selectedTextId, copiedClip, copiedText, tracks, mediaFiles, player.currentTime, textOverlays, removeClip, removeTextOverlay, undo, redo, seek, projectDuration]);

  // Keyboard shortcuts
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Generate time markers
  const getTimeMarkers = () => {
    const markers: number[] = [];
    const interval = ui.timelineZoom < 0.5 ? 10 : ui.timelineZoom < 1 ? 5 : ui.timelineZoom < 2 ? 2 : 1;
    
    for (let i = 0; i <= projectDuration; i += interval) {
      markers.push(i);
    }
    
    return markers;
  };

  // Handle timeline click to seek
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDraggingClip || resizingClip || isDraggingPlayhead) return;
    
    const rect = tracksContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = e.clientX - rect.left + (tracksContainerRef.current?.scrollLeft || 0);
    const time = x / (PIXELS_PER_SECOND * ui.timelineZoom);
    
    seek(Math.max(0, Math.min(projectDuration, time)));
  };

  // Handle playhead dragging
  const handlePlayheadMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDraggingPlayhead(true);
  };

  // Touch-friendly playhead dragging
  const handlePlayheadTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    setIsDraggingPlayhead(true);
    setIsTouchScrubbing(true);
  };

  useEffect(() => {
    if (!isDraggingPlayhead) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = tracksContainerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left + (tracksContainerRef.current?.scrollLeft || 0);
      const time = x / (PIXELS_PER_SECOND * ui.timelineZoom);
      seek(Math.max(0, Math.min(projectDuration, time)));
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      
      const rect = tracksContainerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const touch = e.touches[0];
      const x = touch.clientX - rect.left + (tracksContainerRef.current?.scrollLeft || 0);
      const time = x / (PIXELS_PER_SECOND * ui.timelineZoom);
      seek(Math.max(0, Math.min(projectDuration, time)));
    };

    const handleMouseUp = () => {
      setIsDraggingPlayhead(false);
      setIsTouchScrubbing(false);
    };

    const handleTouchEnd = () => {
      setIsDraggingPlayhead(false);
      setIsTouchScrubbing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDraggingPlayhead, ui.timelineZoom, projectDuration, seek]);

  // Helper to calculate menu position
  const calculateMenuPosition = (clientX: number, clientY: number) => {
    const menuWidth = 180;
    const menuHeight = 200;
    
    let x = clientX;
    let y = clientY;
    
    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;
    if (x < 10) x = 10;
    if (y < 10) y = 10;

    return { x, y };
  };

  // Handle clip context menu
  const handleClipContextMenu = (e: React.MouseEvent, clipId: string) => {
    e.preventDefault();
    e.stopPropagation();
    selectClip(clipId);
    
    const { x, y } = calculateMenuPosition(e.clientX, e.clientY);
    
    setContextMenu({
      id: clipId,
      type: 'clip',
      x,
      y,
    });
  };

  // Handle text context menu
  const handleTextContextMenu = (e: React.MouseEvent, textId: string) => {
    e.preventDefault();
    e.stopPropagation();
    selectText(textId);

    const { x, y } = calculateMenuPosition(e.clientX, e.clientY);

    setContextMenu({
      id: textId,
      type: 'text',
      x,
      y,
    });
  };

  // Close context menu
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  // Handle clip dragging
  const handleClipMouseDown = (e: React.MouseEvent, clipId: string, trackId: string) => {
    const track = tracks.find(t => t.id === trackId);
    if (track?.locked) return;

    e.stopPropagation();
    selectClip(clipId);

    const clip = tracks.flatMap(t => t.clips).find(c => c.id === clipId);
    if (!clip) return;

    const clipStartX = clip.startTime * PIXELS_PER_SECOND * ui.timelineZoom;
    const offsetX = e.clientX - clipStartX - (tracksContainerRef.current?.getBoundingClientRect().left || 0) + (tracksContainerRef.current?.scrollLeft || 0);

    setDraggedClipId(clipId);
    setIsDraggingClip(true);
    setDragOffset({ x: offsetX, y: e.clientY });
  };

  // Touch-friendly clip dragging
  const handleClipTouchStart = (e: React.TouchEvent, clipId: string, trackId: string) => {
    const track = tracks.find(t => t.id === trackId);
    if (track?.locked) return;

    e.stopPropagation();
    selectClip(clipId);

    const clip = tracks.flatMap(t => t.clips).find(c => c.id === clipId);
    if (!clip) return;

    const touch = e.touches[0];
    const clipStartX = clip.startTime * PIXELS_PER_SECOND * ui.timelineZoom;
    const offsetX = touch.clientX - clipStartX - (tracksContainerRef.current?.getBoundingClientRect().left || 0) + (tracksContainerRef.current?.scrollLeft || 0);

    setDraggedClipId(clipId);
    setIsDraggingClip(true);
    setDragOffset({ x: offsetX, y: touch.clientY });
  };

  // Handle text dragging
  const handleTextMouseDown = (e: React.MouseEvent, textId: string) => {
    e.stopPropagation();
    selectText(textId);

    const text = textOverlays.find(t => t.id === textId);
    if (!text) return;

    const textStartX = text.startTime * PIXELS_PER_SECOND * ui.timelineZoom;
    const offsetX = e.clientX - textStartX - (tracksContainerRef.current?.getBoundingClientRect().left || 0) + (tracksContainerRef.current?.scrollLeft || 0);

    setDraggedTextId(textId);
    setIsDraggingText(true);
    setDragOffset({ x: offsetX, y: e.clientY });
  };

  useEffect(() => {
    if (!isDraggingText || !draggedTextId) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = tracksContainerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left + (tracksContainerRef.current?.scrollLeft || 0) - dragOffset.x;
      let newTime = Math.max(0, x / (PIXELS_PER_SECOND * ui.timelineZoom));
      
      // Check for collisions with other text overlays
      const currentText = textOverlays.find(t => t.id === draggedTextId);
      if (currentText) {
        const otherTexts = textOverlays.filter(t => t.id !== draggedTextId).sort((a, b) => a.startTime - b.startTime);
        
        // Check if we have a collision at the preferred position
        const hasCollision = otherTexts.some(t => 
            (newTime < t.startTime + t.duration) && (newTime + currentText.duration > t.startTime)
        );
        
        if (hasCollision) {
            // Find the closest valid position (gap)
            let bestTime = newTime;
            let minDistance = Infinity;
            
            for (let i = 0; i <= otherTexts.length; i++) {
                const t1End = (i === 0) ? 0 : (otherTexts[i-1].startTime + otherTexts[i-1].duration);
                const t2Start = (i < otherTexts.length) ? otherTexts[i].startTime : Infinity;
                
                const gapSize = t2Start - t1End;
                if (gapSize >= currentText.duration) {
                    // Valid range for startTime: [t1End, t2Start - duration]
                    const minValid = t1End;
                    const maxValid = t2Start - currentText.duration;
                    
                    const clamped = Math.max(minValid, Math.min(maxValid, newTime));
                    const dist = Math.abs(clamped - newTime);
                    
                    if (dist < minDistance) {
                        minDistance = dist;
                        bestTime = clamped;
                    }
                }
            }
            
            newTime = bestTime;
        }
      }

      updateTextOverlay(draggedTextId, { startTime: newTime });
    };

    const handleMouseUp = () => {
      setIsDraggingText(false);
      setDraggedTextId(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingText, draggedTextId, dragOffset, ui.timelineZoom, updateTextOverlay, textOverlays]);

  // Handle transition dragging
  const handleTransitionMouseDown = (e: React.MouseEvent, transitionId: string) => {
    e.stopPropagation();
    setDraggedTransitionId(transitionId);
    setIsDraggingTransition(true);
  };

  useEffect(() => {
    if (!isDraggingTransition || !draggedTransitionId) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Optional: Add visual feedback for dragging transition
    };

    const handleMouseUp = (e: MouseEvent) => {
      const rect = tracksContainerRef.current?.getBoundingClientRect();
      if (!rect) {
        setIsDraggingTransition(false);
        setDraggedTransitionId(null);
        return;
      }

      const x = e.clientX - rect.left + (tracksContainerRef.current?.scrollLeft || 0);
      const time = x / (PIXELS_PER_SECOND * ui.timelineZoom);

      // Find target track and clip
      const trackIndex = Math.floor((e.clientY - rect.top + (tracksContainerRef.current?.scrollTop || 0) - RULER_HEIGHT) / TRACK_HEIGHT);
      const targetTrack = tracks[trackIndex];

      if (targetTrack) {
        const targetClip = targetTrack.clips.find(c => {
          const start = c.startTime;
          const end = c.startTime + (c.duration - c.trimStart - c.trimEnd);
          return time >= start && time < end;
        });

        if (targetClip) {
          const transition = transitions.find(t => t.id === draggedTransitionId);
          if (transition) {
            // Calculate position relative to clip
            const clipStart = targetClip.startTime;
            const clipDuration = targetClip.duration - targetClip.trimStart - targetClip.trimEnd;
            const relativeTime = time - clipStart;
            const newPosition = relativeTime < clipDuration / 2 ? 'start' : 'end';

            if (transition.clipId !== targetClip.id || transition.position !== newPosition) {
              // Move transition: remove from old, add to new
              removeTransition(transition.clipId, transition.position);
              setTransition(targetClip.id, transition.type, transition.duration, newPosition);
            }
          }
        }
      }

      setIsDraggingTransition(false);
      setDraggedTransitionId(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingTransition, draggedTransitionId, tracks, ui.timelineZoom, transitions, removeTransition, setTransition, TRACK_HEIGHT, RULER_HEIGHT]);

  // Check if a clip overlaps with existing clips on a track
  const hasCollision = (trackId: string, startTime: number, duration: number, excludeClipId?: string) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return false;

    const endTime = startTime + duration;
    
    return track.clips.some(clip => {
      if (clip.id === excludeClipId) return false;
      
      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + (clip.duration - clip.trimStart - clip.trimEnd);
      
      // Check if there's any overlap
      return (startTime < clipEnd && endTime > clipStart);
    });
  };

  // Find an available track without collision
  const findAvailableTrack = (clipType: 'video' | 'audio' | 'image', startTime: number, duration: number, excludeClipId?: string) => {
    // Images are treated as video clips
    const trackType = clipType === 'image' ? 'video' : clipType;
    
    // First, try tracks of the same type
    const sameTypeTracks = tracks.filter(t => t.type === trackType && !t.locked);
    
    for (const track of sameTypeTracks) {
      if (!hasCollision(track.id, startTime, duration, excludeClipId)) {
        return track.id;
      }
    }
    
    // If no available track, create a new one
    const { addTrack } = useEditorStore.getState();
    addTrack(trackType);
    
    // Return the ID of the newly created track (it will be the last one)
    const newTracks = useEditorStore.getState().tracks;
    const newTrack = newTracks.filter(t => t.type === trackType).pop();
    return newTrack?.id || sameTypeTracks[0]?.id;
  };

  // Find snap points on a track
  const findSnapPoints = (trackId: string, excludeClipId?: string) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return [];

    const snapPoints: number[] = [0]; // Start of timeline is always a snap point

    track.clips.forEach(clip => {
      if (clip.id === excludeClipId) return;
      
      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + (clip.duration - clip.trimStart - clip.trimEnd);
      
      snapPoints.push(clipStart, clipEnd);
    });

    return snapPoints;
  };

  // Apply snapping to a time value
  const applySnapping = (time: number, trackId: string, clipDuration: number, excludeClipId?: string) => {
    const SNAP_THRESHOLD = 0.2; // 0.2 seconds threshold for snapping
    const snapPoints = findSnapPoints(trackId, excludeClipId);
    
    let snappedTime = time;
    let minDistance = SNAP_THRESHOLD;

    // Check snapping for clip start
    snapPoints.forEach(snapPoint => {
      const distance = Math.abs(time - snapPoint);
      if (distance < minDistance) {
        minDistance = distance;
        snappedTime = snapPoint;
      }
    });

    // Check snapping for clip end
    const clipEnd = time + clipDuration;
    snapPoints.forEach(snapPoint => {
      const distance = Math.abs(clipEnd - snapPoint);
      if (distance < SNAP_THRESHOLD && distance < minDistance) {
        snappedTime = snapPoint - clipDuration;
      }
    });

    return Math.max(0, snappedTime);
  };

  // Find position without collision (next available slot)
  const findNonCollidingPosition = (trackId: string, preferredTime: number, clipDuration: number, excludeClipId?: string) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return preferredTime;

    // Get all clips on the track (excluding the one being moved)
    const clipsOnTrack = track.clips
      .filter(c => c.id !== excludeClipId)
      .map(c => ({
        start: c.startTime,
        end: c.startTime + (c.duration - c.trimStart - c.trimEnd)
      }))
      .sort((a, b) => a.start - b.start);

    // If no clips, return preferred time
    if (clipsOnTrack.length === 0) return Math.max(0, preferredTime);

    const clipEnd = preferredTime + clipDuration;

    // Check if preferred position is free
    let hasCollision = false;
    for (const existing of clipsOnTrack) {
      if (preferredTime < existing.end && clipEnd > existing.start) {
        hasCollision = true;
        break;
      }
    }

    if (!hasCollision) return Math.max(0, preferredTime);

    // Find the closest gap before or after preferred position
    let bestPosition = preferredTime;
    let bestDistance = Infinity;

    // Try to place before each clip
    for (let i = 0; i < clipsOnTrack.length; i++) {
      const gapEnd = clipsOnTrack[i].start;
      const gapStart = i > 0 ? clipsOnTrack[i - 1].end : 0;

      // Check if clip fits in this gap
      if (gapEnd - gapStart >= clipDuration) {
        const position = gapEnd - clipDuration; // Snap to the end of the gap
        const distance = Math.abs(position - preferredTime);
        
        if (distance < bestDistance) {
          bestDistance = distance;
          bestPosition = position;
        }
      }
    }

    // Try to place after the last clip
    if (clipsOnTrack.length > 0) {
      const lastClipEnd = clipsOnTrack[clipsOnTrack.length - 1].end;
      const distance = Math.abs(lastClipEnd - preferredTime);
      
      if (distance < bestDistance) {
        bestPosition = lastClipEnd;
      }
    }

    return Math.max(0, bestPosition);
  };

  // Check if a clip type is compatible with a track type
  const isClipCompatibleWithTrack = (clipType: string, trackType: string, trackName: string): boolean => {
    // Audio clips can only go to audio tracks
    if (clipType === 'audio') {
      return trackType === 'audio';
    }
    
    // Video clips can only go to video tracks (not image tracks)
    if (clipType === 'video') {
      // Video clips should go to tracks named "Video" or generic video tracks, not "Images"
      const isImageTrack = trackName.toLowerCase().includes('image');
      return trackType === 'video' && !isImageTrack;
    }
    
    // Image clips can only go to image tracks or generic video tracks
    if (clipType === 'image') {
      // Images should go to tracks named "Images" or generic video tracks, not "Video" named tracks
      const isVideoNamedTrack = trackName.toLowerCase().includes('video');
      // Allow images on video-type tracks that are either named "Images" or are generic
      return trackType === 'video' && !isVideoNamedTrack;
    }
    
    return false;
  };

  const handleClipDragMove = useCallback((clientX: number, clientY: number) => {
    const rect = tracksContainerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = clientX - rect.left + (tracksContainerRef.current?.scrollLeft || 0) - dragOffset.x;
    const newTime = Math.max(0, x / (PIXELS_PER_SECOND * ui.timelineZoom));

    // Determine target track based on mouse position
    const trackIndex = Math.floor((clientY - rect.top + (tracksContainerRef.current?.scrollTop || 0) - RULER_HEIGHT) / TRACK_HEIGHT);
    let targetTrack = tracks[trackIndex];

    if (targetTrack && !targetTrack.locked) {
      const draggedClip = tracks.flatMap(t => t.clips).find(c => c.id === draggedClipId);
      if (!draggedClip) return;

      // Check if clip type is compatible with target track
      if (!isClipCompatibleWithTrack(draggedClip.type, targetTrack.type, targetTrack.name)) {
        // Find the original track of the clip and only allow horizontal movement
        const originalTrack = tracks.find(t => t.clips.some(c => c.id === draggedClipId));
        if (originalTrack) {
          targetTrack = originalTrack;
        } else {
          return; // Can't move to incompatible track
        }
      }

      const clipDuration = draggedClip.duration - draggedClip.trimStart - draggedClip.trimEnd;

      // Apply snapping
      const snappedTime = applySnapping(newTime, targetTrack.id, clipDuration, draggedClipId!);

      // Check if there's a collision at snapped position
      if (hasCollision(targetTrack.id, snappedTime, clipDuration, draggedClipId!)) {
        // Find next available position without collision
        const adjustedTime = findNonCollidingPosition(targetTrack.id, snappedTime, clipDuration, draggedClipId!);
        moveClip(draggedClipId!, targetTrack.id, adjustedTime);
      } else {
        // No collision, use snapped position
        moveClip(draggedClipId!, targetTrack.id, snappedTime);
      }
    }
  }, [dragOffset.x, ui.timelineZoom, tracks, draggedClipId, moveClip, TRACK_HEIGHT, RULER_HEIGHT]);

  useEffect(() => {
    if (!isDraggingClip || !draggedClipId) return;

    const handleMouseMove = (e: MouseEvent) => {
      handleClipDragMove(e.clientX, e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      handleClipDragMove(touch.clientX, touch.clientY);
    };

    const handleMouseUp = () => {
      setIsDraggingClip(false);
      setDraggedClipId(null);
    };

    const handleTouchEnd = () => {
      setIsDraggingClip(false);
      setDraggedClipId(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDraggingClip, draggedClipId, dragOffset, ui.timelineZoom, tracks, moveClip, mediaFiles, TRACK_HEIGHT, RULER_HEIGHT]);

  // Handle clip resizing
  const handleResizeMouseDown = (e: React.MouseEvent, clipId: string, edge: 'start' | 'end') => {
    e.stopPropagation();
    setResizingClip({ id: clipId, edge });
  };

  // Handle text resizing
  const handleTextResizeMouseDown = (e: React.MouseEvent, textId: string, edge: 'start' | 'end') => {
    e.stopPropagation();
    setResizingText({ id: textId, edge });
  };

  useEffect(() => {
    if (!resizingClip) return;

    const clip = tracks.flatMap(t => t.clips).find(c => c.id === resizingClip.id);
    if (!clip) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = tracksContainerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left + (tracksContainerRef.current?.scrollLeft || 0);
      const time = x / (PIXELS_PER_SECOND * ui.timelineZoom);

      // Special handling for images (infinite duration)
      if (clip.type === 'image') {
        if (resizingClip.edge === 'start') {
          // Calculate new start time, ensuring we don't go past the end
          // For images, duration is the actual length on timeline
          const currentEndTime = clip.startTime + clip.duration;
          const newStartTime = Math.min(currentEndTime - 0.1, Math.max(0, time));
          const newDuration = currentEndTime - newStartTime;
          
          updateClip(clip.id, { 
            startTime: newStartTime,
            duration: newDuration
          });
        } else {
          // Just update duration based on new end time
          const newDuration = Math.max(0.1, time - clip.startTime);
          updateClip(clip.id, { duration: newDuration });
        }
      } else {
        // Standard handling for video/audio (fixed source duration with trims)
        if (resizingClip.edge === 'start') {
          const maxTrimStart = clip.duration - clip.trimEnd - 0.1;
          const newTrimStart = Math.max(0, Math.min(maxTrimStart, clip.trimStart + (time - clip.startTime)));
          const newStartTime = time;
          
          updateClip(clip.id, { 
            trimStart: newTrimStart,
            startTime: newStartTime,
          });
        } else {
          const clipEndTime = clip.startTime + (clip.duration - clip.trimStart - clip.trimEnd);
          const newEndTime = time;
          const delta = newEndTime - clipEndTime;
          const newTrimEnd = Math.max(0, clip.trimEnd - delta);
          
          updateClip(clip.id, { trimEnd: newTrimEnd });
        }
      }
    };

    const handleMouseUp = () => {
      setResizingClip(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingClip, tracks, ui.timelineZoom, updateClip]);

  useEffect(() => {
    if (!resizingText) return;

    const text = textOverlays.find(t => t.id === resizingText.id);
    if (!text) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = tracksContainerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left + (tracksContainerRef.current?.scrollLeft || 0);
      const time = x / (PIXELS_PER_SECOND * ui.timelineZoom);

      // Calculate constraints to prevent overlap
      const otherTexts = textOverlays.filter(t => t.id !== resizingText.id);

      if (resizingText.edge === 'start') {
        const currentEndTime = text.startTime + text.duration;
        
        // Find the closest neighbor to the left (limit for start time)
        let limit = 0;
        for (const t of otherTexts) {
          const tEnd = t.startTime + t.duration;
          // Check if this clip is to our left (or overlapping us from left)
          if (tEnd <= currentEndTime) {
            if (tEnd > limit) limit = tEnd;
          }
        }

        const newStartTime = Math.max(limit, Math.min(currentEndTime - 0.1, Math.max(0, time)));
        const newDuration = currentEndTime - newStartTime;
        
        updateTextOverlay(text.id, { 
          startTime: newStartTime,
          duration: newDuration
        });
      } else {
        const currentStartTime = text.startTime;
        
        // Find closest neighbor to the right (limit for end time)
        let limit = Infinity;
        for (const t of otherTexts) {
          // Check if this clip is to our right (or overlapping us from right)
          if (t.startTime >= currentStartTime) {
            if (t.startTime < limit) limit = t.startTime;
          }
        }

        // Calculate new duration, constrained by the limit
        // time is the new end time cursor position
        const maxDuration = limit - currentStartTime;
        const newDuration = Math.max(0.1, Math.min(maxDuration, time - currentStartTime));
        
        updateTextOverlay(text.id, { duration: newDuration });
      }
    };

    const handleMouseUp = () => {
      setResizingText(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingText, textOverlays, ui.timelineZoom, updateTextOverlay]);

  // Handle media drop from library
  const handleDrop = useCallback((e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      const rawData = e.dataTransfer.getData('application/json');
      if (!rawData) return;

      const data = JSON.parse(rawData);
      
      if (data.type === 'media') {
        const media = mediaFiles.find(m => m.id === data.mediaId);
        if (!media) return;

        const rect = tracksContainerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = e.clientX - rect.left + (tracksContainerRef.current?.scrollLeft || 0);
        const time = x / (PIXELS_PER_SECOND * ui.timelineZoom);

        const targetTrack = tracks.find(t => t.id === trackId);
        if (!targetTrack) return;

        // Check compatibility
        // Audio files go to audio tracks
        // Video and Image files go to video tracks
        const isCompatible = (media.type === 'audio' && targetTrack.type === 'audio') ||
                             ((media.type === 'video' || media.type === 'image') && targetTrack.type === 'video');

        if (isCompatible) {
           const { addClipToTrack } = useEditorStore.getState();
           addClipToTrack(trackId, media, Math.max(0, time));
        } else {
           // If not compatible, redirect to smart placement
           let smartTrack: any = null;
           
           if (media.type === 'image') {
             smartTrack = tracks.find(t => t.type === 'video' && (t.name.toLowerCase().includes('image') || t.name.toLowerCase().includes('overlay')));
           } else if (media.type === 'video') {
             smartTrack = tracks.find(t => t.type === 'video' && t.name.toLowerCase().includes('video'));
           } else if (media.type === 'audio') {
             smartTrack = tracks.find(t => t.type === 'audio' && t.name.toLowerCase().includes('audio'));
           }
           
           // Fallback
           if (!smartTrack) {
             const trackType = media.type === 'audio' ? 'audio' : 'video';
             smartTrack = tracks.find(t => t.type === trackType);
           }

           if (smartTrack) {
             const { addClipToTrack } = useEditorStore.getState();
             addClipToTrack(smartTrack.id, media, Math.max(0, time));
           }
        }
      }
    } catch (error) {
      console.error('Error handling drop:', error);
    }
  }, [mediaFiles, tracks, ui.timelineZoom]);

  // Handle drop specifically on a clip (for transitions)
  const handleClipDrop = useCallback((e: React.DragEvent, clipId: string) => {
    try {
      const rawData = e.dataTransfer.getData('application/json');
      if (!rawData) return;

      const data = JSON.parse(rawData);
      
      if (data.type === 'NEW_TRANSITION') {
        e.preventDefault();
        e.stopPropagation(); // Stop bubbling to track
        
        // Determine if dropped on start or end
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const position = x < rect.width / 2 ? 'start' : 'end';
        
        const { setTransition } = useEditorStore.getState();
        setTransition(clipId, data.transitionType, 0.5, position);
      }
    } catch (error) {
      console.error('Error handling clip drop:', error);
    }
  }, []);

  // Handle drop on the timeline background (empty space)
  const handleTimelineDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      const rawData = e.dataTransfer.getData('application/json');
      if (!rawData) return;

      const data = JSON.parse(rawData);
      
      if (data.type === 'media') {
        const media = mediaFiles.find(m => m.id === data.mediaId);
        if (!media) return;

        const rect = tracksContainerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = e.clientX - rect.left + (tracksContainerRef.current?.scrollLeft || 0);
        const time = x / (PIXELS_PER_SECOND * ui.timelineZoom);

        // Smart track selection
        let targetTrack: any = null;
        
        if (media.type === 'image') {
          // Prefer tracks named "Images" or "Overlay"
          targetTrack = tracks.find(t => 
            t.type === 'video' && 
            (t.name.toLowerCase().includes('image') || t.name.toLowerCase().includes('overlay'))
          );
        } else if (media.type === 'video') {
          // Prefer tracks named "Video"
          targetTrack = tracks.find(t => 
            t.type === 'video' && 
            t.name.toLowerCase().includes('video')
          );
        } else if (media.type === 'audio') {
          // Prefer tracks named "Audio"
          targetTrack = tracks.find(t => 
            t.type === 'audio' && 
            t.name.toLowerCase().includes('audio')
          );
        }

        // Fallback to any suitable track if no specific preference found
        if (!targetTrack) {
          const trackType = media.type === 'audio' ? 'audio' : 'video';
          targetTrack = tracks.find(t => t.type === trackType);
        }
        
        if (targetTrack) {
          const { addClipToTrack } = useEditorStore.getState();
          addClipToTrack(targetTrack.id, media, Math.max(0, time));
        }
      }
    } catch (error) {
      console.error('Error handling timeline drop:', error);
    }
  }, [mediaFiles, tracks, ui.timelineZoom]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleZoom = (delta: number) => {
    setTimelineZoom(ui.timelineZoom + delta);
  };

  const handleAspectRatioClick = () => {
    const ratios: ('16:9' | '9:16' | '1:1' | '4:3' | '21:9')[] = ['16:9', '9:16', '1:1', '4:3', '21:9'];
    const currentIndex = ratios.indexOf(aspectRatio);
    const nextIndex = (currentIndex + 1) % ratios.length;
    const newRatio = ratios[nextIndex];
    console.log('📐 Aspect ratio click:', aspectRatio, '→', newRatio);
    setAspectRatio(newRatio);
  };

  // Handle cut button click - cuts all clips at playhead position
  const handleCutClick = () => {
    const cutTime = player.currentTime;
    const { splitClip } = useEditorStore.getState();
    
    // Find all clips that intersect with the playhead position
    const clipsToSplit: string[] = [];
    
    tracks.forEach(track => {
      track.clips.forEach(clip => {
        const clipStart = clip.startTime;
        const clipEnd = clip.startTime + clip.duration - clip.trimStart - clip.trimEnd;
        
        // Check if playhead is within this clip
        if (cutTime > clipStart && cutTime < clipEnd) {
          clipsToSplit.push(clip.id);
        }
      });
    });
    
    // Split all clips at the playhead position
    clipsToSplit.forEach(clipId => {
      splitClip(clipId, cutTime);
    });

    // Split text overlays
    textOverlays.forEach(text => {
      const textEnd = text.startTime + text.duration;
      if (cutTime > text.startTime && cutTime < textEnd) {
        // Split text
        const firstDuration = cutTime - text.startTime;
        const secondDuration = text.duration - firstDuration;
        
        // Update first part
        updateTextOverlay(text.id, { duration: firstDuration });
        
        // Create second part
        addTextOverlay({
          ...text,
          id: undefined, // let it generate new id
          startTime: cutTime,
          duration: secondDuration,
          text: text.text // copy content
        });
      }
    });
  };

  // Calculate distance between two touch points
  const getTouchDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return null;
    const touch1 = touches[0];
    const touch2 = touches[1];
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Handle pinch-to-zoom with improved sensitivity
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const distance = getTouchDistance(e.touches);
      setLastPinchDistance(distance);
    } else if (e.touches.length === 1) {
      // Single touch - prepare for scrubbing
      const rect = tracksContainerRef.current?.getBoundingClientRect();
      if (rect) {
        setTouchStartX(e.touches[0].clientX);
        setTouchStartTime(player.currentTime);
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastPinchDistance) {
      // Pinch-to-zoom
      const currentDistance = getTouchDistance(e.touches);
      if (currentDistance) {
        // Improved sensitivity for foldable devices
        const sensitivity = isMinimal || isCompact ? 150 : 100;
        const delta = (currentDistance - lastPinchDistance) / sensitivity;
        const newZoom = Math.max(0.2, Math.min(5, ui.timelineZoom + delta));
        setTimelineZoom(newZoom);
        setLastPinchDistance(currentDistance);
      }
      e.preventDefault(); // Prevent scrolling while pinching
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      setLastPinchDistance(null);
    }
    setIsTouchScrubbing(false);
  };

  const playheadX = player.currentTime * PIXELS_PER_SECOND * ui.timelineZoom;

  // Context menu actions
  const handleDetachAudio = (clipId: string) => {
    const clip = tracks.flatMap(t => t.clips).find(c => c.id === clipId);
    if (!clip) return;
    
    const media = mediaFiles.find(m => m.id === clip.mediaId);
    if (!media || media.type !== 'video') return;

    // Use the proper detachAudioFromVideo function that establishes bidirectional links
    const { detachAudioFromVideo } = useEditorStore.getState();
    detachAudioFromVideo(clipId);

    setContextMenu(null);
  };

  const handleCutClip = (clipId: string) => {
    const clip = tracks.flatMap(t => t.clips).find(c => c.id === clipId);
    if (!clip) return;

    // Split clip at playhead position
    const cutTime = player.currentTime;
    if (cutTime > clip.startTime && cutTime < clip.startTime + clip.duration - clip.trimStart - clip.trimEnd) {
      const trackWithClip = tracks.find(t => t.clips.some(c => c.id === clipId));
      if (!trackWithClip) return;

      const { splitClip } = useEditorStore.getState();
      splitClip(clipId, cutTime);
    }

    setContextMenu(null);
  };

  const handleDuplicateClip = (clipId: string) => {
    const clip = tracks.flatMap(t => t.clips).find(c => c.id === clipId);
    if (!clip) return;

    const trackWithClip = tracks.find(t => t.clips.some(c => c.id === clipId));
    if (!trackWithClip) return;

    const media = mediaFiles.find(m => m.id === clip.mediaId);
    if (!media) return;

    const { addClipToTrack } = useEditorStore.getState();
    const newStartTime = clip.startTime + (clip.duration - clip.trimStart - clip.trimEnd) + 0.1;
    addClipToTrack(trackWithClip.id, media, newStartTime);

    setContextMenu(null);
  };

  const handleDeleteClip = (clipId: string) => {
    const { removeClip } = useEditorStore.getState();
    removeClip(clipId);
    setContextMenu(null);
  };

  // Get dynamic sizes for UI elements
  const getClipHeight = () => TRACK_HEIGHT - (isMinimal ? 8 : isCompact ? 8 : 16);
  const getClipTop = () => isMinimal ? 4 : isCompact ? 4 : 8;

  return (
    <div className="glass-panel-medium h-full flex flex-col overflow-hidden rounded-t-xl border-t">
      {/* Timeline Header */}
      <div className={`px-1 fold-cover:px-1 fold-open:px-2 sm:px-4 py-1 fold-cover:py-1 fold-open:py-1.5 sm:py-2 flex items-center justify-between border-b border-white/10 flex-shrink-0 overflow-hidden`}>
        <h3 className={`${isMinimal ? 'text-[9px]' : isCompact ? 'text-[10px]' : 'text-xs'} sm:text-body font-semibold text-white flex-shrink-0`}>Timeline</h3>
        <div className="flex items-center gap-0.5 fold-cover:gap-0.5 fold-open:gap-1 sm:gap-2 overflow-x-auto scrollbar-none min-w-0 flex-1 justify-end">
          {/* Cut Tool */}
          <button
            onClick={handleCutClick}
            className={`btn-icon ${isMinimal ? 'w-6 h-6' : isCompact ? 'w-7 h-7' : 'w-8 h-8'} hover:bg-primary-500 hover:text-white touch-target flex-shrink-0`}
            title="Couper"
          >
            <Scissors className={`${isMinimal ? 'w-2.5 h-2.5' : isCompact ? 'w-3 h-3' : 'w-4 h-4'}`} />
          </button>
          
          {/* Crop Tool - Hidden on minimal and compact screens */}
          {!isMinimal && !isCompact && (
            <button
              onClick={() => {
                const event = new CustomEvent('toggleCropMode');
                window.dispatchEvent(event);
              }}
              className={`btn-icon w-8 h-8 hover:bg-primary-500 hover:text-white touch-target flex-shrink-0`}
              title="Rogner"
              disabled={!ui.selectedClipId}
            >
              <Crop className="w-4 h-4" />
            </button>
          )}
          
          <div className={`w-px ${isMinimal ? 'h-4' : 'h-5'} bg-white/20 mx-0.5 hidden sm:block flex-shrink-0`} />
          
          <span className="text-[9px] hidden sm:inline sm:text-caption text-neutral-400 flex-shrink-0">Zoom:</span>
          <button
            onClick={() => handleZoom(-0.2)}
            className={`btn-icon ${isMinimal ? 'w-5 h-5' : isCompact ? 'w-6 h-6' : 'w-8 h-8'} touch-target flex-shrink-0`}
            disabled={ui.timelineZoom <= 0.2}
          >
            <ZoomOut className={`${isMinimal ? 'w-2 h-2' : isCompact ? 'w-2.5 h-2.5' : 'w-4 h-4'}`} />
          </button>
          <span className={`${isMinimal ? 'text-[8px] min-w-[1.5rem]' : isCompact ? 'text-[9px] min-w-[2rem]' : 'text-xs min-w-[3rem]'} text-neutral-300 text-center flex-shrink-0`}>
            {Math.round(ui.timelineZoom * 100)}%
          </span>
          <button
            onClick={() => handleZoom(0.2)}
            className={`btn-icon ${isMinimal ? 'w-5 h-5' : isCompact ? 'w-6 h-6' : 'w-8 h-8'} touch-target flex-shrink-0`}
            disabled={ui.timelineZoom >= 5}
          >
            <ZoomIn className={`${isMinimal ? 'w-2 h-2' : isCompact ? 'w-2.5 h-2.5' : 'w-4 h-4'}`} />
          </button>

          <div className={`w-px ${isMinimal ? 'h-4' : 'h-5'} bg-white/20 mx-0.5 hidden sm:block flex-shrink-0`} />

          {/* Aspect Ratio Button */}
          <button
            onClick={handleAspectRatioClick}
            className={`btn-secondary ${isMinimal ? 'h-5 text-[8px] px-1' : isCompact ? 'h-6 text-[9px] px-1.5' : 'h-8 text-xs px-2'} flex items-center gap-0.5 touch-target flex-shrink-0`}
            title="Ratio"
          >
            <Monitor className={`${isMinimal ? 'w-2.5 h-2.5' : isCompact ? 'w-3 h-3' : 'w-4 h-4'}`} />
            <span className="hidden xs:inline">{aspectRatio}</span>
          </button>
        </div>
      </div>

      {/* Timeline Content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Track Labels */}
        <div 
          className="flex-shrink-0 bg-white/5 border-r border-white/10 flex flex-col"
          style={{ width: LABEL_WIDTH }}
        >
          {/* Ruler space */}
          <div className="border-b border-white/10 flex-shrink-0" style={{ height: RULER_HEIGHT }} />
          
          {/* Track labels */}
          <div ref={labelsContainerRef} className="flex-1 overflow-hidden relative min-h-0">
            {tracks.map((track) => {
              const TrackIcon = getTrackIconComponent(track.name, track.type);
              return (
                <div
                  key={track.id}
                  className="border-b border-white/10 px-1 fold-cover:px-1 fold-open:px-1.5 sm:px-2 flex flex-col justify-center gap-0.5"
                  style={{ height: TRACK_HEIGHT }}
                >
                  <div className="flex items-center gap-1">
                    {/* Show icon on small screens for better identification */}
                    {(isMinimal || isCompact) && (
                      <TrackIcon className={`${isMinimal ? 'w-2.5 h-2.5' : 'w-3 h-3'} text-neutral-400 flex-shrink-0`} />
                    )}
                    <p
                      className={`${isMinimal ? 'text-[8px]' : isCompact ? 'text-[9px]' : 'text-xs'} font-medium text-neutral-300 truncate`}
                      title={track.name} // Full name on hover
                    >
                      {getTrackLabel(track.name, layoutMode)}
                    </p>
                  </div>
                  <div className="flex items-center gap-0 fold-cover:gap-0 fold-open:gap-0.5 sm:gap-1">
                    <button
                      onClick={() => toggleTrackMute(track.id)}
                      className={`btn-icon ${isMinimal ? 'w-4 h-4' : isCompact ? 'w-5 h-5' : 'w-6 h-6'} ${track.muted ? 'text-error' : ''} touch-target`}
                      title={track.muted ? 'Unmute' : 'Mute'}
                    >
                      {track.muted ? <VolumeX className={`${isMinimal ? 'w-2 h-2' : 'w-2.5 h-2.5'} sm:w-3 sm:h-3`} /> : <Volume2 className={`${isMinimal ? 'w-2 h-2' : 'w-2.5 h-2.5'} sm:w-3 sm:h-3`} />}
                    </button>
                    <button
                      onClick={() => toggleTrackLock(track.id)}
                      className={`btn-icon ${isMinimal ? 'w-4 h-4' : isCompact ? 'w-5 h-5' : 'w-6 h-6'} ${track.locked ? 'text-warning' : ''} touch-target`}
                      title={track.locked ? 'Unlock' : 'Lock'}
                    >
                      {track.locked ? <Lock className={`${isMinimal ? 'w-2 h-2' : 'w-2.5 h-2.5'} sm:w-3 sm:h-3`} /> : <Unlock className={`${isMinimal ? 'w-2 h-2' : 'w-2.5 h-2.5'} sm:w-3 sm:h-3`} />}
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Text Track Label */}
            <div
              className="border-b border-white/10 px-1 fold-cover:px-1 fold-open:px-1.5 sm:px-2 flex flex-col justify-center gap-0.5"
              style={{ height: TRACK_HEIGHT }}
            >
              <div className="flex items-center gap-1">
                {/* Show icon on small screens for better identification */}
                {(isMinimal || isCompact) && (
                  <Type className={`${isMinimal ? 'w-2.5 h-2.5' : 'w-3 h-3'} text-neutral-400 flex-shrink-0`} />
                )}
                <p
                  className={`${isMinimal ? 'text-[8px]' : isCompact ? 'text-[9px]' : 'text-xs'} font-medium text-neutral-300 truncate`}
                  title="Textes" // Full name on hover
                >
                  {getTrackLabel('Textes', layoutMode)}
                </p>
              </div>
              <div className="flex items-center gap-0 fold-cover:gap-0 fold-open:gap-0.5 sm:gap-1">
                {/* Only show icon if not already shown above */}
                {!isMinimal && !isCompact && (
                  <Type className={`w-4 h-4 text-neutral-400`} />
                )}
              </div>
            </div>
          </div>

          {/* Add Track Button */}
          <div className="p-0.5 fold-cover:p-0.5 fold-open:p-1 sm:p-2 flex-shrink-0">
            <button 
              onClick={() => addTrack('video')} 
              className={`btn-secondary w-full ${isMinimal ? 'h-5 text-[8px]' : isCompact ? 'h-6 text-[9px]' : 'h-8 text-xs'} touch-target`}
            >
              <Plus className={`${isMinimal ? 'w-2 h-2' : isCompact ? 'w-2.5 h-2.5' : 'w-3 h-3'}`} />
              <span className="fold-cover:hidden fold-open:inline">Track</span>
            </button>
          </div>
        </div>

        {/* Timeline Tracks */}
        <div
          ref={tracksContainerRef}
          className="flex-1 overflow-auto custom-scrollbar relative"
          onClick={handleTimelineClick}
          onScroll={handleScroll}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onDrop={handleTimelineDrop}
          onDragOver={handleDragOver}
        >
          <div className="relative min-h-full" style={{ width: timelineWidth }}>
            {/* Time Ruler */}
            <div 
              className="bg-white/5 border-b border-white/10 sticky top-0 z-20" 
              style={{ width: timelineWidth, height: RULER_HEIGHT }}
            >
              {getTimeMarkers().map((time) => {
                const x = time * PIXELS_PER_SECOND * ui.timelineZoom;
                return (
                  <div
                    key={time}
                    className="absolute top-0 bottom-0 flex flex-col justify-end"
                    style={{ left: `${x}px` }}
                  >
                    <div className={`w-px ${isMinimal ? 'h-1' : 'h-2'} bg-neutral-400`} />
                    <span className={`${isMinimal ? 'text-[7px]' : isCompact ? 'text-[8px]' : 'text-[0.6rem]'} text-neutral-400 ml-0.5 select-none`}>
                      {formatTime(time)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Tracks */}
            {tracks.map((track) => (
              <div
                key={track.id}
                className="timeline-track border-b border-white/10 relative"
                onDrop={(e) => handleDrop(e, track.id)}
                onDragOver={handleDragOver}
                style={{ width: timelineWidth, height: TRACK_HEIGHT }}
              >
                {/* Track clips */}
                {track.clips.map((clip) => {
                  const clipWidth = (clip.duration - clip.trimStart - clip.trimEnd) * PIXELS_PER_SECOND * ui.timelineZoom;
                  const clipX = clip.startTime * PIXELS_PER_SECOND * ui.timelineZoom;
                  const media = mediaFiles.find(m => m.id === clip.mediaId);
                  const isSelected = ui.selectedClipId === clip.id;
                  const clipTransitions = transitions.filter(t => t.clipId === clip.id);

                  return (
                    <div
                      key={clip.id}
                      className={`timeline-clip absolute ${
                        track.type === 'audio' ? 'timeline-clip-audio' : ''
                      } ${isSelected ? 'selected' : ''} ${
                        draggedClipId === clip.id ? 'dragging' : ''
                      } overflow-hidden flex items-center px-0.5 fold-cover:px-0.5 fold-open:px-1 sm:px-2 cursor-grab active:cursor-grabbing touch-target`}
                      style={{
                        left: `${clipX}px`,
                        width: `${clipWidth}px`,
                        top: getClipTop(),
                        height: getClipHeight(),
                      }}
                      onMouseDown={(e) => handleClipMouseDown(e, clip.id, track.id)}
                      onTouchStart={(e) => handleClipTouchStart(e, clip.id, track.id)}
                      onContextMenu={(e) => handleClipContextMenu(e, clip.id)}
                      onDrop={(e) => handleClipDrop(e, clip.id)}
                    >
                      {/* Transition Indicators */}
                      {clipTransitions.map(transition => {
                        const handleMouseDown = (e: React.MouseEvent) => handleTransitionMouseDown(e, transition.id);
                        return (
                        <div
                          key={transition.id}
                          className="absolute top-0 bottom-0 bg-blue-500/80 z-20 cursor-move flex items-center justify-center hover:bg-blue-600 transition-colors"
                          style={{ 
                            width: `${Math.min(transition.duration * PIXELS_PER_SECOND * ui.timelineZoom, clipWidth)}px`,
                            left: transition.position === 'end' ? 'auto' : 0,
                            right: transition.position === 'end' ? 0 : 'auto',
                          }}
                          onMouseDown={handleMouseDown}
                          title={`Transition: ${transition.type} (${transition.position})`}
                        >
                           <Move className={`${isMinimal ? 'w-2 h-2' : 'w-3 h-3'} text-white`} />
                        </div>
                      )})}

                      {/* Resize handles - larger for touch */}
                      {!track.locked && (
                        <>
                          <div
                            className={`absolute left-0 top-0 bottom-0 ${isMinimal || isCompact ? 'w-4' : 'w-3'} cursor-ew-resize hover:bg-primary-500/50 z-10 group touch-target`}
                            onMouseDown={(e) => handleResizeMouseDown(e, clip.id, 'start')}
                            title="Étendre le début"
                          >
                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary-500/80 group-hover:w-full transition-all" />
                          </div>
                          <div
                            className={`absolute right-0 top-0 bottom-0 ${isMinimal || isCompact ? 'w-4' : 'w-3'} cursor-ew-resize hover:bg-primary-500/50 z-10 group touch-target`}
                            onMouseDown={(e) => handleResizeMouseDown(e, clip.id, 'end')}
                            title="Étendre la fin"
                          >
                            <div className="absolute right-0 top-0 bottom-0 w-1 bg-primary-500/80 group-hover:w-full transition-all" />
                          </div>
                        </>
                      )}

                      {/* Thumbnail */}
                      {clip.thumbnail && (
                        <img
                          src={clip.thumbnail}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover opacity-20"
                        />
                      )}

                      {/* Clip name */}
                      <p className={`${isMinimal ? 'text-[7px]' : isCompact ? 'text-[8px]' : 'text-[0.6rem]'} font-medium text-white truncate relative z-10`}>
                        {clip.name}
                      </p>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Text Track */}
            <div
              className="timeline-track border-b border-white/10 relative"
              style={{ width: timelineWidth, height: TRACK_HEIGHT }}
            >
              {textOverlays.map((text) => {
                const textWidth = text.duration * PIXELS_PER_SECOND * ui.timelineZoom;
                const textX = text.startTime * PIXELS_PER_SECOND * ui.timelineZoom;
                const isSelected = ui.selectedTextId === text.id;

                return (
                  <div
                    key={text.id}
                    className={`timeline-clip absolute bg-purple-500/30 border border-purple-500/50 ${isSelected ? 'selected ring-2 ring-purple-500' : ''} ${
                      draggedTextId === text.id ? 'dragging' : ''
                    } overflow-hidden flex items-center px-0.5 fold-cover:px-0.5 fold-open:px-1 sm:px-2 cursor-grab active:cursor-grabbing rounded touch-target`}
                    style={{
                      left: `${textX}px`,
                      width: `${textWidth}px`,
                      top: getClipTop(),
                      height: getClipHeight(),
                    }}
                    onMouseDown={(e) => handleTextMouseDown(e, text.id)}
                    onContextMenu={(e) => handleTextContextMenu(e, text.id)}
                  >
                    {/* Resize handles - larger for touch */}
                    <div
                      className={`absolute left-0 top-0 bottom-0 ${isMinimal || isCompact ? 'w-4' : 'w-3'} cursor-ew-resize hover:bg-purple-500/50 z-10 group touch-target`}
                      onMouseDown={(e) => handleTextResizeMouseDown(e, text.id, 'start')}
                      title="Étendre le début"
                    >
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-purple-500/80 group-hover:w-full transition-all" />
                    </div>
                    <div
                      className={`absolute right-0 top-0 bottom-0 ${isMinimal || isCompact ? 'w-4' : 'w-3'} cursor-ew-resize hover:bg-purple-500/50 z-10 group touch-target`}
                      onMouseDown={(e) => handleTextResizeMouseDown(e, text.id, 'end')}
                      title="Étendre la fin"
                    >
                      <div className="absolute right-0 top-0 bottom-0 w-1 bg-purple-500/80 group-hover:w-full transition-all" />
                    </div>

                    {/* Text content */}
                    <p className={`${isMinimal ? 'text-[7px]' : isCompact ? 'text-[8px]' : 'text-[0.6rem]'} font-medium text-white truncate relative z-10`}>
                      {text.text}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Playhead - with larger touch target */}
            <div
              className="playhead"
              style={{ left: `${playheadX}px` }}
            >
              <div
                className={`absolute -top-1 ${isMinimal || isCompact ? '-left-4 w-8 h-8' : '-left-2 w-4 h-4'} cursor-ew-resize touch-target`}
                onMouseDown={handlePlayheadMouseDown}
                onTouchStart={handlePlayheadTouchStart}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-[100] bg-[#0f0f0f] border-2 border-primary-500/50 rounded-lg shadow-2xl py-1 min-w-[180px]"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(117, 122, 237, 0.3)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            if (contextMenu.type === 'clip') {
              const clip = tracks.flatMap(t => t.clips).find(c => c.id === contextMenu.id);
              const media = clip ? mediaFiles.find(m => m.id === clip.mediaId) : null;
              const isVideo = media?.type === 'video';

              return (
                <>
                  <button
                    onClick={() => handleCutClip(contextMenu.id)}
                    className="w-full px-3 py-2.5 text-sm text-white hover:bg-white/10 flex items-center gap-2 transition-colors touch-target"
                  >
                    <Scissors className="w-4 h-4" />
                    <span>Couper</span>
                  </button>

                  {isVideo && (
                    <button
                      onClick={() => handleDetachAudio(contextMenu.id)}
                      className="w-full px-3 py-2.5 text-sm text-white hover:bg-white/10 flex items-center gap-2 transition-colors touch-target"
                    >
                      <Music2 className="w-4 h-4" />
                      <span>Détacher audio</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleDuplicateClip(contextMenu.id)}
                    className="w-full px-3 py-2.5 text-sm text-white hover:bg-white/10 flex items-center gap-2 transition-colors touch-target"
                  >
                    <Copy className="w-4 h-4" />
                    <span>Dupliquer</span>
                  </button>

                  <div className="h-px bg-white/10 my-1" />

                  <button
                    onClick={() => handleDeleteClip(contextMenu.id)}
                    className="w-full px-3 py-2.5 text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-2 transition-colors touch-target"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Supprimer</span>
                  </button>
                </>
              );
            } else if (contextMenu.type === 'text') {
              return (
                <>
                  <button
                    onClick={() => {
                      const text = textOverlays.find(t => t.id === contextMenu.id);
                      if (text) {
                        setCopiedText({ ...text });
                        setCopiedClip(null);
                        // Paste immediately for duplicate effect or just copy? 
                        // Standard behavior is usually just copy, but "Duplicate" implies action.
                        // Let's implement duplicate here.
                        addTextOverlay({
                          ...text,
                          id: undefined,
                          startTime: text.startTime + 0.5, // Offset slightly
                        });
                      }
                      setContextMenu(null);
                    }}
                    className="w-full px-3 py-2.5 text-sm text-white hover:bg-white/10 flex items-center gap-2 transition-colors touch-target"
                  >
                    <Copy className="w-4 h-4" />
                    <span>Dupliquer</span>
                  </button>

                  <div className="h-px bg-white/10 my-1" />

                  <button
                    onClick={() => {
                      removeTextOverlay(contextMenu.id);
                      setContextMenu(null);
                    }}
                    className="w-full px-3 py-2.5 text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-2 transition-colors touch-target"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Supprimer</span>
                  </button>
                </>
              );
            }
            return null;
          })()}
        </div>
      )}
    </div>
  );
};

export default Timeline;
