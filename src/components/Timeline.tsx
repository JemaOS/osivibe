// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ZoomIn, ZoomOut, Volume2, VolumeX, Lock, Unlock, Plus, Scissors, Copy, Trash2, Music2, Split, Crop, Type, Monitor, Move } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { useResponsive, useLayoutMode } from '../hooks/use-responsive';
import { useTimelineClipDrag, useTimelineClipResize, useTimelineTextDrag, useTimelineTextResize, useTimelineTransitionDrag, useTimelineDrop } from '../hooks/use-timeline-interactions';
import { formatTime } from '../utils/helpers';
import type { TimelineClip, TextOverlay, MediaFile } from '../types';

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

// Helper functions for track label based on layout mode
const getExpandedLabel = (trackName: string): string => trackName;

const getMinimalLabel = (trackName: string): string => {
  const lowerName = trackName.toLowerCase();
  if (lowerName.includes('video')) return 'Vid';
  if (lowerName.includes('image')) return 'Img';
  if (lowerName.includes('audio')) return 'Aud';
  if (lowerName.includes('text')) return 'Txt';
  return trackName.substring(0, 3);
};

const getCompactLabel = (trackName: string): string => {
  const lowerName = trackName.toLowerCase();
  if (lowerName.includes('video')) return 'Video';
  if (lowerName.includes('image')) return 'Imgs';
  if (lowerName.includes('audio')) return 'Audio';
  if (lowerName.includes('text')) return 'Text';
  return trackName.length > 5 ? trackName.substring(0, 5) : trackName;
};

const getTrackTypeFromName = (trackName: string): 'video' | 'image' | 'audio' | 'text' | 'other' => {
  const lowerName = trackName.toLowerCase();
  if (lowerName.includes('video')) return 'video';
  if (lowerName.includes('image')) return 'image';
  if (lowerName.includes('audio')) return 'audio';
  if (lowerName.includes('text')) return 'text';
  return 'other';
};

const getTrackLabel = (trackName: string, layoutMode: string): string => {
  if (layoutMode === 'desktop' || layoutMode === 'expanded') {
    return trackName;
  }

  const type = getTrackTypeFromName(trackName);

  if (layoutMode === 'minimal') {
    const minimalLabels: Record<string, string> = {
      video: 'Vid', image: 'Img', audio: 'Aud', text: 'Txt'
    };
    return minimalLabels[type] || trackName.substring(0, 3);
  }

  if (layoutMode === 'compact' || layoutMode === 'adaptive') {
    const compactLabels: Record<string, string> = {
      video: 'Video', image: 'Imgs', audio: 'Audio', text: 'Text'
    };
    return compactLabels[type] || (trackName.length > 5 ? trackName.substring(0, 5) : trackName);
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

// Additional helper functions to reduce component complexity
const getClipHeight = (layoutMode: string, trackHeight: number): number => {
  if (layoutMode === 'minimal' || layoutMode === 'compact') return trackHeight - 8;
  return trackHeight - 16;
};

const getClipTop = (layoutMode: string): number => {
  if (layoutMode === 'minimal' || layoutMode === 'compact') return 4;
  return 8;
};

const getTimeInterval = (zoom: number): number => {
  if (zoom < 0.5) return 10;
  if (zoom < 1) return 5;
  if (zoom < 2) return 2;
  return 1;
};

// Helper functions for responsive classes
const getHeaderTitleClass = (isMinimal: boolean, isCompact: boolean) => 
  isMinimal ? 'text-[9px]' : isCompact ? 'text-[10px]' : 'text-xs';

const getToolbarBtnClass = (isMinimal: boolean, isCompact: boolean) => 
  isMinimal ? 'w-6 h-6' : isCompact ? 'w-7 h-7' : 'w-8 h-8';

const getToolbarIconClass = (isMinimal: boolean, isCompact: boolean) => 
  isMinimal ? 'w-2.5 h-2.5' : isCompact ? 'w-3 h-3' : 'w-4 h-4';

const getDividerClass = (isMinimal: boolean) => 
  isMinimal ? 'h-4' : 'h-5';

const getZoomBtnClass = (isMinimal: boolean, isCompact: boolean) => 
  isMinimal ? 'w-5 h-5' : isCompact ? 'w-6 h-6' : 'w-8 h-8';

const getZoomIconClass = (isMinimal: boolean, isCompact: boolean) => 
  isMinimal ? 'w-2 h-2' : isCompact ? 'w-2.5 h-2.5' : 'w-4 h-4';

const getZoomTextClass = (isMinimal: boolean, isCompact: boolean) => 
  isMinimal ? 'text-[8px] min-w-[1.5rem]' : isCompact ? 'text-[9px] min-w-[2rem]' : 'text-xs min-w-[3rem]';

const getRatioBtnClass = (isMinimal: boolean, isCompact: boolean) => 
  isMinimal ? 'h-5 text-[8px] px-1' : isCompact ? 'h-6 text-[9px] px-1.5' : 'h-8 text-xs px-2';

const getTrackIconClass = (isMinimal: boolean) => 
  isMinimal ? 'w-2.5 h-2.5' : 'w-3 h-3';

const getTrackTextClass = (isMinimal: boolean, isCompact: boolean) => 
  isMinimal ? 'text-[8px]' : isCompact ? 'text-[9px]' : 'text-xs';

const getTrackActionBtnClass = (isMinimal: boolean, isCompact: boolean) => 
  isMinimal ? 'w-4 h-4' : isCompact ? 'w-5 h-5' : 'w-6 h-6';

const getTrackActionIconClass = (isMinimal: boolean, isCompact: boolean) => 
  isMinimal ? 'w-2 h-2' : isCompact ? 'w-2.5 h-2.5' : 'sm:w-3 sm:h-3';

const getAddTrackBtnClass = (isMinimal: boolean, isCompact: boolean) => 
  isMinimal ? 'h-5 text-[8px]' : isCompact ? 'h-6 text-[9px]' : 'h-8 text-xs';

const getAddTrackIconClass = (isMinimal: boolean, isCompact: boolean) => 
  isMinimal ? 'w-2 h-2' : isCompact ? 'w-2.5 h-2.5' : 'w-3 h-3';

const getRulerTickClass = (isMinimal: boolean) => 
  isMinimal ? 'h-1' : 'h-2';

const getRulerTextClass = (isMinimal: boolean, isCompact: boolean) => 
  isMinimal ? 'text-[7px]' : isCompact ? 'text-[8px]' : 'text-[0.6rem]';

const getResizeHandleClass = (isMinimal: boolean, isCompact: boolean) => 
  isMinimal || isCompact ? 'w-4' : 'w-3';

const getPlayheadHandleClass = (isMinimal: boolean, isCompact: boolean) => 
  isMinimal || isCompact ? '-left-4 w-8 h-8' : '-left-2 w-4 h-4';

const TimelineClipComponent = ({
  clip,
  track,
  ui,
  PIXELS_PER_SECOND,
  clipTop,
  clipHeight,
  transitions,
  draggedClipId,
  isMinimal,
  isCompact,
  handleClipMouseDown,
  handleClipTouchStart,
  handleClipContextMenu,
  handleClipDrop,
  handleTransitionMouseDown,
  handleResizeMouseDown
}: any) => {
  const clipWidth = (clip.duration - clip.trimStart - clip.trimEnd) * PIXELS_PER_SECOND * ui.timelineZoom;
  const clipX = clip.startTime * PIXELS_PER_SECOND * ui.timelineZoom;
  const isSelected = ui.selectedClipId === clip.id;
  const clipTransitions = transitions.filter((t: any) => t.clipId === clip.id);

  return (
    <div
      className={`timeline-clip absolute ${
        track.type === 'audio' ? 'timeline-clip-audio' : ''
      } ${isSelected ? 'selected' : ''} ${
        draggedClipId === clip.id ? 'dragging' : ''
      } overflow-hidden flex items-center px-0.5 fold-cover:px-0.5 fold-open:px-1 sm:px-2 cursor-grab active:cursor-grabbing touch-target`}
      style={{
        left: `${clipX}px`,
        width: `${clipWidth}px`,
        top: clipTop,
        height: clipHeight,
      }}
      onMouseDown={(e) => handleClipMouseDown(e, clip.id, track.id)}
      onTouchStart={(e) => handleClipTouchStart(e, clip.id, track.id)}
      onContextMenu={(e) => handleClipContextMenu(e, clip.id)}
      onDrop={(e) => handleClipDrop(e, clip.id, track.type)}
    >
      {/* Transition Indicators */}
      {clipTransitions.map((transition: any) => {
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
        );
      })}

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
};

const useTimelineKeyboardShortcuts = () => {
  const {
    ui, tracks, mediaFiles, textOverlays, player, projectDuration,
    removeClip, removeTextOverlay, undo, redo, seek
  } = useEditorStore();

  const [copiedClip, setCopiedClip] = useState<{ clip: TimelineClip; trackId: string } | null>(null);
  const [copiedText, setCopiedText] = useState<TextOverlay | null>(null);

  const handleUndoRedo = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      e.preventDefault();
      redo();
      return true;
    }
    return false;
  }, [undo, redo]);

  const handleDelete = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (ui.selectedClipId) {
        e.preventDefault();
        removeClip(ui.selectedClipId);
        return true;
      }
      if (ui.selectedTextId) {
        e.preventDefault();
        removeTextOverlay(ui.selectedTextId);
        return true;
      }
    }
    return false;
  }, [ui.selectedClipId, ui.selectedTextId, removeClip, removeTextOverlay]);

  const handleCopy = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      if (ui.selectedClipId) {
        e.preventDefault();
        const clip = tracks.flatMap(t => t.clips).find(c => c.id === ui.selectedClipId);
        const trackWithClip = tracks.find(t => t.clips.some(c => c.id === ui.selectedClipId));
        if (clip && trackWithClip) {
          setCopiedClip({ clip: { ...clip }, trackId: trackWithClip.id });
          setCopiedText(null);
        }
        return true;
      }
      if (ui.selectedTextId) {
        e.preventDefault();
        const text = textOverlays.find(t => t.id === ui.selectedTextId);
        if (text) {
          setCopiedText({ ...text });
          setCopiedClip(null);
        }
        return true;
      }
    }
    return false;
  }, [ui.selectedClipId, ui.selectedTextId, tracks, textOverlays]);

  const handlePaste = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      if (copiedClip) {
        e.preventDefault();
        const media = mediaFiles.find(m => m.id === copiedClip.clip.mediaId);
        if (media) {
          const { addClipToTrack } = useEditorStore.getState();
          addClipToTrack(copiedClip.trackId, media, player.currentTime);
        }
        return true;
      }
      if (copiedText) {
        e.preventDefault();
        const { addTextOverlay } = useEditorStore.getState();
        addTextOverlay({
          ...copiedText,
          id: undefined,
          startTime: player.currentTime,
        });
        return true;
      }
    }
    return false;
  }, [copiedClip, copiedText, mediaFiles, player.currentTime]);

  const handleSeekKeys = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      seek(Math.max(0, player.currentTime - (e.shiftKey ? 1 : 0.1)));
      return true;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      seek(Math.min(projectDuration, player.currentTime + (e.shiftKey ? 1 : 0.1)));
      return true;
    }
    return false;
  }, [player.currentTime, projectDuration, seek]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') {
      return;
    }

    if (handleUndoRedo(e)) return;
    if (handleDelete(e)) return;
    if (handleCopy(e)) return;
    if (handlePaste(e)) return;
    if (handleSeekKeys(e)) return;
  }, [handleUndoRedo, handleDelete, handleCopy, handlePaste, handleSeekKeys]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return { copiedClip, copiedText, setCopiedClip, setCopiedText };
};

const useTimelinePlayhead = (tracksContainerRef: React.RefObject<HTMLDivElement>, PIXELS_PER_SECOND: number) => {
  const { ui, player, projectDuration, seek } = useEditorStore();
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [isTouchScrubbing, setIsTouchScrubbing] = useState(false);

  const handlePlayheadMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDraggingPlayhead(true);
  };

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
  }, [isDraggingPlayhead, ui.timelineZoom, projectDuration, seek, tracksContainerRef, PIXELS_PER_SECOND]);

  return {
    isDraggingPlayhead,
    isTouchScrubbing,
    setIsTouchScrubbing,
    handlePlayheadMouseDown,
    handlePlayheadTouchStart
  };
};

const useTimelineContextMenu = () => {
  const { selectClip, selectText } = useEditorStore();
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);

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

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  return {
    contextMenu,
    setContextMenu,
    handleClipContextMenu,
    handleTextContextMenu
  };
};

const useTimelineTouch = (
  tracksContainerRef: React.RefObject<HTMLDivElement>,
  ui: any,
  setTimelineZoom: any,
  player: any,
  isMinimal: boolean,
  isCompact: boolean,
  setIsTouchScrubbing: any,
  setTouchStartX: any,
  setTouchStartTime: any
) => {
  const [lastPinchDistance, setLastPinchDistance] = useState<number | null>(null);

  const getTouchDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return null;
    const touch1 = touches[0];
    const touch2 = touches[1];
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const distance = getTouchDistance(e.touches);
      setLastPinchDistance(distance);
    } else if (e.touches.length === 1) {
      const rect = tracksContainerRef.current?.getBoundingClientRect();
      if (rect) {
        setTouchStartX(e.touches[0].clientX);
        setTouchStartTime(player.currentTime);
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastPinchDistance) {
      const currentDistance = getTouchDistance(e.touches);
      if (currentDistance) {
        const sensitivity = isMinimal || isCompact ? 150 : 100;
        const delta = (currentDistance - lastPinchDistance) / sensitivity;
        const newZoom = Math.max(0.2, Math.min(5, ui.timelineZoom + delta));
        setTimelineZoom(newZoom);
        setLastPinchDistance(currentDistance);
      }
      e.preventDefault();
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      setLastPinchDistance(null);
    }
    setIsTouchScrubbing(false);
  };

  return { handleTouchStart, handleTouchMove, handleTouchEnd };
};

const useTimelineCut = () => {
  const { player, tracks, textOverlays, updateTextOverlay, addTextOverlay, ui } = useEditorStore();

  const handleCutClick = () => {
    const cutTime = player.currentTime;
    const { splitClip } = useEditorStore.getState();
    const { selectedClipId, selectedTrackId } = useEditorStore.getState().ui;
    
    const clipsToSplit: string[] = [];
    
    // If a clip is selected, only cut that specific clip
    // Otherwise, cut clips from the selected track or all tracks (legacy behavior)
    if (selectedClipId) {
      // Only cut the selected clip
      const clip = tracks.flatMap(t => t.clips).find(c => c.id === selectedClipId);
      if (clip) {
        const clipStart = clip.startTime;
        const clipEnd = clip.startTime + clip.duration - clip.trimStart - clip.trimEnd;
        
        if (cutTime > clipStart && cutTime < clipEnd) {
          clipsToSplit.push(selectedClipId);
        }
      }
    } else {
      // No clip selected - use track-based selection (original behavior)
      const tracksToProcess = selectedTrackId 
        ? tracks.filter(t => t.id === selectedTrackId)
        : tracks;
      
      tracksToProcess.forEach(track => {
        track.clips.forEach(clip => {
          const clipStart = clip.startTime;
          const clipEnd = clip.startTime + clip.duration - clip.trimStart - clip.trimEnd;
          
          if (cutTime > clipStart && cutTime < clipEnd) {
            clipsToSplit.push(clip.id);
          }
        });
      });
    }
    
    clipsToSplit.forEach(clipId => {
      splitClip(clipId, cutTime);
    });

    textOverlays.forEach(text => {
      const textEnd = text.startTime + text.duration;
      if (cutTime > text.startTime && cutTime < textEnd) {
        const firstDuration = cutTime - text.startTime;
        const secondDuration = text.duration - firstDuration;
        
        updateTextOverlay(text.id, { duration: firstDuration });
        
        addTextOverlay({
          ...text,
          id: undefined,
          startTime: cutTime,
          duration: secondDuration,
          text: text.text
        });
      }
    });
  };

  return { handleCutClick };
};

const TimelineContextMenu = ({ contextMenu, setContextMenu, setCopiedClip, setCopiedText }: any) => {
  const { tracks, mediaFiles, textOverlays, addTextOverlay, removeTextOverlay, removeClip, player } = useEditorStore();

  const handleDetachAudio = (clipId: string) => {
    const clip = tracks.flatMap(t => t.clips).find(c => c.id === clipId);
    if (!clip) return;
    
    const media = mediaFiles.find(m => m.id === clip.mediaId);
    if (!media || media.type !== 'video') return;

    const { detachAudioFromVideo } = useEditorStore.getState();
    detachAudioFromVideo(clipId);

    setContextMenu(null);
  };

  const handleCutClip = (clipId: string) => {
    const clip = tracks.flatMap(t => t.clips).find(c => c.id === clipId);
    if (!clip) return;

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
    removeClip(clipId);
    setContextMenu(null);
  };

  if (!contextMenu) return null;

  if (contextMenu.type === 'clip') {
    const clip = tracks.flatMap(t => t.clips).find(c => c.id === contextMenu.id);
    const media = clip ? mediaFiles.find(m => m.id === clip.mediaId) : null;
    const isVideo = media?.type === 'video';

    return (
      <div
        className="fixed z-[100] bg-[#0f0f0f] border-2 border-primary-500/50 rounded-lg shadow-2xl py-1 min-w-[180px]"
        style={{
          left: `${contextMenu.x}px`,
          top: `${contextMenu.y}px`,
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(117, 122, 237, 0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
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
            <span>Detacher audio</span>
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
      </div>
    );
  } else if (contextMenu.type === 'text') {
    return (
      <div
        className="fixed z-[100] bg-[#0f0f0f] border-2 border-primary-500/50 rounded-lg shadow-2xl py-1 min-w-[180px]"
        style={{
          left: `${contextMenu.x}px`,
          top: `${contextMenu.y}px`,
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(117, 122, 237, 0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => {
            const text = textOverlays.find(t => t.id === contextMenu.id);
            if (text) {
              setCopiedText({ ...text });
              setCopiedClip(null);
              addTextOverlay({
                ...text,
                id: undefined,
                startTime: text.startTime + 0.5,
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
      </div>
    );
  }
  return null;
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
    setTrackVolume,
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
  const [isDraggingText, setIsDraggingText] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizingText, setResizingText] = useState<{ id: string; edge: 'start' | 'end' } | null>(null);
  const [isDraggingTransition, setIsDraggingTransition] = useState(false);
  const [draggedTransitionId, setDraggedTransitionId] = useState<string | null>(null);
  
  // Touch scrubbing state
  const [touchStartX, setTouchStartX] = useState(0);
  const [touchStartTime, setTouchStartTime] = useState(0);

  const { copiedClip, copiedText, setCopiedClip, setCopiedText } = useTimelineKeyboardShortcuts();
  const { isDraggingPlayhead, isTouchScrubbing, setIsTouchScrubbing, handlePlayheadMouseDown, handlePlayheadTouchStart } = useTimelinePlayhead(tracksContainerRef, PIXELS_PER_SECOND);
  const { contextMenu, setContextMenu, handleClipContextMenu, handleTextContextMenu } = useTimelineContextMenu();
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useTimelineTouch(tracksContainerRef, ui, setTimelineZoom, player, isMinimal, isCompact, setIsTouchScrubbing, setTouchStartX, setTouchStartTime);
  const { handleCutClick } = useTimelineCut();
  const { isDraggingClip, draggedClipId, handleClipMouseDown, handleClipTouchStart, hasCollision } = useTimelineClipDrag(tracksContainerRef, PIXELS_PER_SECOND, TRACK_HEIGHT, RULER_HEIGHT);
  const { resizingClip, handleResizeMouseDown } = useTimelineClipResize(tracksContainerRef, PIXELS_PER_SECOND);
  const { draggedTextId, handleTextMouseDown } = useTimelineTextDrag(tracksContainerRef, PIXELS_PER_SECOND);
  const { handleTextResizeMouseDown } = useTimelineTextResize(tracksContainerRef, PIXELS_PER_SECOND);
  const { handleTransitionMouseDown } = useTimelineTransitionDrag(tracksContainerRef, PIXELS_PER_SECOND, TRACK_HEIGHT, RULER_HEIGHT);
  const { handleDrop, handleClipDrop, handleTimelineDrop, handleDragOver } = useTimelineDrop(tracksContainerRef, PIXELS_PER_SECOND);

  const timelineWidth = Math.max(projectDuration * PIXELS_PER_SECOND * ui.timelineZoom, 1000);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (labelsContainerRef.current) {
      labelsContainerRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  // Generate time markers
  const getTimeMarkers = () => {
    const markers: number[] = [];
    const interval = getTimeInterval(ui.timelineZoom);
    
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

  const playheadX = player.currentTime * PIXELS_PER_SECOND * ui.timelineZoom;

  // Get dynamic sizes for UI elements
  const clipHeight = getClipHeight(layoutMode, TRACK_HEIGHT);
  const clipTop = getClipTop(layoutMode);

  return (
    <div className="glass-panel-medium h-full flex flex-col overflow-hidden rounded-t-xl border-t">
      {/* Timeline Header */}
      <div className={`px-1 fold-cover:px-1 fold-open:px-2 sm:px-4 py-1 fold-cover:py-1 fold-open:py-1.5 sm:py-2 flex items-center justify-between border-b border-white/10 flex-shrink-0 overflow-hidden`}>
        <h3 className={`${getHeaderTitleClass(isMinimal, isCompact)} sm:text-body font-semibold text-white flex-shrink-0`}>Timeline</h3>
        <div className="flex items-center gap-0.5 fold-cover:gap-0.5 fold-open:gap-1 sm:gap-2 overflow-x-auto scrollbar-none min-w-0 flex-1 justify-end">
          {/* Cut Tool */}
          <button
            onClick={handleCutClick}
            className={`btn-icon ${getToolbarBtnClass(isMinimal, isCompact)} hover:bg-primary-500 hover:text-white touch-target flex-shrink-0`}
            title="Couper"
          >
            <Scissors className={getToolbarIconClass(isMinimal, isCompact)} />
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
          
          <div className={`w-px ${getDividerClass(isMinimal)} bg-white/20 mx-0.5 hidden sm:block flex-shrink-0`} />
          
          <span className="text-[9px] hidden sm:inline sm:text-caption text-neutral-400 flex-shrink-0">Zoom:</span>
          <button
            onClick={() => handleZoom(-0.2)}
            className={`btn-icon ${getZoomBtnClass(isMinimal, isCompact)} touch-target flex-shrink-0`}
            disabled={ui.timelineZoom <= 0.2}
          >
            <ZoomOut className={getZoomIconClass(isMinimal, isCompact)} />
          </button>
          <span className={`${getZoomTextClass(isMinimal, isCompact)} text-neutral-300 text-center flex-shrink-0`}>
            {Math.round(ui.timelineZoom * 100)}%
          </span>
          <button
            onClick={() => handleZoom(0.2)}
            className={`btn-icon ${getZoomBtnClass(isMinimal, isCompact)} touch-target flex-shrink-0`}
            disabled={ui.timelineZoom >= 5}
          >
            <ZoomIn className={getZoomIconClass(isMinimal, isCompact)} />
          </button>
          <div className={`w-px ${getDividerClass(isMinimal)} bg-white/20 mx-0.5 hidden sm:block flex-shrink-0`} />
          {/* Aspect Ratio Button */}
          <button
            onClick={handleAspectRatioClick}
            className={`btn-secondary ${getRatioBtnClass(isMinimal, isCompact)} flex items-center gap-0.5 touch-target flex-shrink-0`}
            title="Ratio"
          >
            <Monitor className={getToolbarIconClass(isMinimal, isCompact)} />
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
                      <TrackIcon className={`${getTrackIconClass(isMinimal)} text-neutral-400 flex-shrink-0`} />
                    )}
                    <p
                      className={`${getTrackTextClass(isMinimal, isCompact)} font-medium text-neutral-300 truncate`}
                      title={track.name} // Full name on hover
                    >
                      {getTrackLabel(track.name, layoutMode)}
                    </p>
                  </div>
                  <div className="flex items-center gap-0 fold-cover:gap-0 fold-open:gap-0.5 sm:gap-1">
                    <button
                      onClick={() => toggleTrackMute(track.id)}
                      className={`btn-icon ${getTrackActionBtnClass(isMinimal, isCompact)} ${track.muted ? 'text-error' : ''} touch-target`}
                      title={track.muted ? 'Unmute' : 'Mute'}
                    >
                      {track.muted ? <VolumeX className={getTrackActionIconClass(isMinimal, isCompact)} /> : <Volume2 className={getTrackActionIconClass(isMinimal, isCompact)} />}
                    </button>
                    <button
                      onClick={() => toggleTrackLock(track.id)}
                      className={`btn-icon ${getTrackActionBtnClass(isMinimal, isCompact)} ${track.locked ? 'text-warning' : ''} touch-target`}
                      title={track.locked ? 'Unlock' : 'Lock'}
                    >
                      {track.locked ? <Lock className={getTrackActionIconClass(isMinimal, isCompact)} /> : <Unlock className={getTrackActionIconClass(isMinimal, isCompact)} />}
                    </button>
                    {/* Volume slider - only show when not muted */}
                    {!track.muted && !isMinimal && (
                      <div className="flex items-center gap-0.5" title={`Volume: ${Math.round((track.volume || 1) * 100)}%`}>
                        <input
                          type="range"
                          min="0"
                          max="2"
                          step="0.1"
                          value={track.volume ?? 1}
                          onChange={(e) => setTrackVolume(track.id, parseFloat(e.target.value))}
                          className="w-12 h-1 sm:w-16 bg-neutral-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
                        />
                        <span className="text-[8px] text-neutral-400 hidden sm:inline">
                          {Math.round((track.volume || 1) * 100)}%
                        </span>
                      </div>
                    )}
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
                  <Type className={`${getTrackIconClass(isMinimal)} text-neutral-400 flex-shrink-0`} />
                )}
                <p
                  className={`${getTrackTextClass(isMinimal, isCompact)} font-medium text-neutral-300 truncate`}
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
              className={`btn-secondary w-full ${getAddTrackBtnClass(isMinimal, isCompact)} touch-target`}
            >
              <Plus className={getAddTrackIconClass(isMinimal, isCompact)} />
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
                    <div className={`w-px ${getRulerTickClass(isMinimal)} bg-neutral-400`} />
                    <span className={`${getRulerTextClass(isMinimal, isCompact)} text-neutral-400 ml-0.5 select-none`}>
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
                {track.clips.map((clip) => (
                  <TimelineClipComponent
                    key={clip.id}
                    clip={clip}
                    track={track}
                    ui={ui}
                    PIXELS_PER_SECOND={PIXELS_PER_SECOND}
                    clipTop={clipTop}
                    clipHeight={clipHeight}
                    transitions={transitions}
                    draggedClipId={draggedClipId}
                    isMinimal={isMinimal}
                    isCompact={isCompact}
                    handleClipMouseDown={handleClipMouseDown}
                    handleClipTouchStart={handleClipTouchStart}
                    handleClipContextMenu={handleClipContextMenu}
                    handleClipDrop={handleClipDrop}
                    handleTransitionMouseDown={handleTransitionMouseDown}
                    handleResizeMouseDown={handleResizeMouseDown}
                  />
                ))}
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
                      top: clipTop,
                      height: clipHeight,
                    }}
                    onMouseDown={(e) => handleTextMouseDown(e, text.id)}
                    onContextMenu={(e) => handleTextContextMenu(e, text.id)}
                  >
                    {/* Resize handles - larger for touch */}
                    <div
                      className={`absolute left-0 top-0 bottom-0 ${getResizeHandleClass(isMinimal, isCompact)} cursor-ew-resize hover:bg-purple-500/50 z-10 group touch-target`}
                      onMouseDown={(e) => handleTextResizeMouseDown(e, text.id, 'start')}
                      title="Étendre le début"
                    >
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-purple-500/80 group-hover:w-full transition-all" />
                    </div>
                    <div
                      className={`absolute right-0 top-0 bottom-0 ${getResizeHandleClass(isMinimal, isCompact)} cursor-ew-resize hover:bg-purple-500/50 z-10 group touch-target`}
                      onMouseDown={(e) => handleTextResizeMouseDown(e, text.id, 'end')}
                      title="Étendre la fin"
                    >
                      <div className="absolute right-0 top-0 bottom-0 w-1 bg-purple-500/80 group-hover:w-full transition-all" />
                    </div>

                    {/* Text content */}
                    <p className={`${getRulerTextClass(isMinimal, isCompact)} font-medium text-white truncate relative z-10`}>
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
                className={`absolute -top-1 ${getPlayheadHandleClass(isMinimal, isCompact)} cursor-ew-resize touch-target`}
                onMouseDown={handlePlayheadMouseDown}
                onTouchStart={handlePlayheadTouchStart}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Context Menu */}
      <TimelineContextMenu 
        contextMenu={contextMenu} 
        setContextMenu={setContextMenu} 
        setCopiedClip={setCopiedClip} 
        setCopiedText={setCopiedText} 
      />
    </div>
  );
};

export default Timeline;


      </div>

      {/* Context Menu */}
      <TimelineContextMenu 
        contextMenu={contextMenu} 
        setContextMenu={setContextMenu} 
        setCopiedClip={setCopiedClip} 
        setCopiedText={setCopiedText} 
      />
    </div>
  );
};

export default Timeline;



        </div>
      </div>

      {/* Context Menu */}
      <TimelineContextMenu 
        contextMenu={contextMenu} 
        setContextMenu={setContextMenu} 
        setCopiedClip={setCopiedClip} 
        setCopiedText={setCopiedText} 
      />
    </div>
  );
};

export default Timeline;


      </div>

      {/* Context Menu */}
      <TimelineContextMenu 
        contextMenu={contextMenu} 
        setContextMenu={setContextMenu} 
        setCopiedClip={setCopiedClip} 
        setCopiedText={setCopiedText} 
      />
    </div>
  );
};

export default Timeline;




