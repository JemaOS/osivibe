import { useState, useEffect, useCallback } from 'react';
import { useEditorStore } from '../store/editorStore';
import { TimelineClip, TextOverlay } from '../types';

export const useTimelineClipDrag = (
  tracksContainerRef: React.RefObject<HTMLDivElement>,
  PIXELS_PER_SECOND: number,
  TRACK_HEIGHT: number,
  RULER_HEIGHT: number
) => {
  const { tracks, ui, selectClip, moveClip } = useEditorStore();
  const [isDraggingClip, setIsDraggingClip] = useState(false);
  const [draggedClipId, setDraggedClipId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleClipMouseDown = useCallback((e: React.MouseEvent, clipId: string, trackId: string) => {
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
  }, [tracks, selectClip, PIXELS_PER_SECOND, ui.timelineZoom, tracksContainerRef]);

  const handleClipTouchStart = useCallback((e: React.TouchEvent, clipId: string, trackId: string) => {
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
  }, [tracks, selectClip, PIXELS_PER_SECOND, ui.timelineZoom, tracksContainerRef]);

  const hasCollision = useCallback((trackId: string, startTime: number, duration: number, excludeClipId?: string) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return false;

    const endTime = startTime + duration;
    
    return track.clips.some(clip => {
      if (clip.id === excludeClipId) return false;
      
      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + (clip.duration - clip.trimStart - clip.trimEnd);
      
      return (startTime < clipEnd && endTime > clipStart);
    });
  }, [tracks]);

  const findSnapPoints = useCallback((trackId: string, excludeClipId?: string) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return [];

    const snapPoints: number[] = [0];

    track.clips.forEach(clip => {
      if (clip.id === excludeClipId) return;
      
      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + (clip.duration - clip.trimStart - clip.trimEnd);
      
      snapPoints.push(clipStart, clipEnd);
    });

    return snapPoints;
  }, [tracks]);

  const applySnapping = useCallback((time: number, trackId: string, clipDuration: number, excludeClipId?: string) => {
    const SNAP_THRESHOLD = 0.2;
    const snapPoints = findSnapPoints(trackId, excludeClipId);
    
    let snappedTime = time;
    let minDistance = SNAP_THRESHOLD;

    snapPoints.forEach(snapPoint => {
      const distance = Math.abs(time - snapPoint);
      if (distance < minDistance) {
        minDistance = distance;
        snappedTime = snapPoint;
      }
    });

    const clipEnd = time + clipDuration;
    snapPoints.forEach(snapPoint => {
      const distance = Math.abs(clipEnd - snapPoint);
      if (distance < SNAP_THRESHOLD && distance < minDistance) {
        snappedTime = snapPoint - clipDuration;
      }
    });

    return Math.max(0, snappedTime);
  }, [findSnapPoints]);

  const findBestGapPosition = useCallback((clipsOnTrack: any[], preferredTime: number, clipDuration: number) => {
    let bestPosition = preferredTime;
    let bestDistance = Infinity;

    for (let i = 0; i < clipsOnTrack.length; i++) {
      const gapEnd = clipsOnTrack[i].start;
      const gapStart = i > 0 ? clipsOnTrack[i - 1].end : 0;

      if (gapEnd - gapStart >= clipDuration) {
        const position = gapEnd - clipDuration;
        const distance = Math.abs(position - preferredTime);
        
        if (distance < bestDistance) {
          bestDistance = distance;
          bestPosition = position;
        }
      }
    }

    if (clipsOnTrack.length > 0) {
      const lastClipEnd = clipsOnTrack[clipsOnTrack.length - 1].end;
      const distance = Math.abs(lastClipEnd - preferredTime);
      
      if (distance < bestDistance) {
        bestPosition = lastClipEnd;
      }
    }

    return Math.max(0, bestPosition);
  }, []);

  const findNonCollidingPosition = useCallback((trackId: string, preferredTime: number, clipDuration: number, excludeClipId?: string) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return preferredTime;

    const clipsOnTrack = track.clips
      .filter(c => c.id !== excludeClipId)
      .map(c => ({
        start: c.startTime,
        end: c.startTime + (c.duration - c.trimStart - c.trimEnd)
      }))
      .sort((a, b) => a.start - b.start);

    if (clipsOnTrack.length === 0) return Math.max(0, preferredTime);

    const clipEnd = preferredTime + clipDuration;

    let hasCollision = false;
    for (const existing of clipsOnTrack) {
      if (preferredTime < existing.end && clipEnd > existing.start) {
        hasCollision = true;
        break;
      }
    }

    if (!hasCollision) return Math.max(0, preferredTime);

    return findBestGapPosition(clipsOnTrack, preferredTime, clipDuration);
  }, [tracks, findBestGapPosition]);

  const isClipCompatibleWithTrack = useCallback((clipType: string, trackType: string, trackName: string): boolean => {
    const isAudioClip = clipType === 'audio';
    const isVideoClip = clipType === 'video';
    const isImageClip = clipType === 'image';
    const isVideoTrack = trackType === 'video';
    const isAudioTrack = trackType === 'audio';

    if (isAudioClip) return isAudioTrack;
    
    if (isVideoClip) {
      const isImageTrack = trackName.toLowerCase().includes('image');
      return isVideoTrack && !isImageTrack;
    }
    
    if (isImageClip) {
      const isVideoNamedTrack = trackName.toLowerCase().includes('video');
      return isVideoTrack && !isVideoNamedTrack;
    }
    
    return false;
  }, []);

  const getTargetTrackForDrag = useCallback((clientY: number, rect: DOMRect) => {
    const trackIndex = Math.floor((clientY - rect.top + (tracksContainerRef.current?.scrollTop || 0) - RULER_HEIGHT) / TRACK_HEIGHT);
    return tracks[trackIndex];
  }, [tracksContainerRef, RULER_HEIGHT, TRACK_HEIGHT, tracks]);

  const handleClipDragMove = useCallback((clientX: number, clientY: number) => {
    const rect = tracksContainerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = clientX - rect.left + (tracksContainerRef.current?.scrollLeft || 0) - dragOffset.x;
    const newTime = Math.max(0, x / (PIXELS_PER_SECOND * ui.timelineZoom));

    let targetTrack = getTargetTrackForDrag(clientY, rect);

    if (targetTrack && !targetTrack.locked) {
      const draggedClip = tracks.flatMap(t => t.clips).find(c => c.id === draggedClipId);
      if (!draggedClip) return;

      if (!isClipCompatibleWithTrack(draggedClip.type, targetTrack.type, targetTrack.name)) {
        const originalTrack = tracks.find(t => t.clips.some(c => c.id === draggedClipId));
        if (originalTrack) {
          targetTrack = originalTrack;
        } else {
          return;
        }
      }

      const clipDuration = draggedClip.duration - draggedClip.trimStart - draggedClip.trimEnd;
      const snappedTime = applySnapping(newTime, targetTrack.id, clipDuration, draggedClipId!);

      if (hasCollision(targetTrack.id, snappedTime, clipDuration, draggedClipId!)) {
        const adjustedTime = findNonCollidingPosition(targetTrack.id, snappedTime, clipDuration, draggedClipId!);
        moveClip(draggedClipId!, targetTrack.id, adjustedTime);
      } else {
        moveClip(draggedClipId!, targetTrack.id, snappedTime);
      }
    }
  }, [dragOffset.x, ui.timelineZoom, tracks, draggedClipId, moveClip, tracksContainerRef, PIXELS_PER_SECOND, getTargetTrackForDrag, isClipCompatibleWithTrack, applySnapping, hasCollision, findNonCollidingPosition]);

  useEffect(() => {
    if (!isDraggingClip || !draggedClipId) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!tracksContainerRef.current) return;
      handleClipDragMove(e.clientX, e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!tracksContainerRef.current || e.touches.length !== 1) return;
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
  }, [isDraggingClip, draggedClipId, handleClipDragMove, tracksContainerRef]);

  return {
    isDraggingClip,
    draggedClipId,
    handleClipMouseDown,
    handleClipTouchStart,
    hasCollision
  };
};

export const useTimelineClipResize = (
  tracksContainerRef: React.RefObject<HTMLDivElement>,
  PIXELS_PER_SECOND: number
) => {
  const { tracks, ui, updateClip } = useEditorStore();
  const [resizingClip, setResizingClip] = useState<{ id: string; edge: 'start' | 'end' } | null>(null);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent, clipId: string, edge: 'start' | 'end') => {
    e.stopPropagation();
    setResizingClip({ id: clipId, edge });
  }, []);

  const handleImageResize = useCallback((clip: TimelineClip, time: number) => {
    if (resizingClip?.edge === 'start') {
      const currentEndTime = clip.startTime + clip.duration;
      const newStartTime = Math.min(currentEndTime - 0.1, Math.max(0, time));
      const newDuration = currentEndTime - newStartTime;
      
      updateClip(clip.id, { 
        startTime: newStartTime,
        duration: newDuration
      });
    } else {
      const newDuration = Math.max(0.1, time - clip.startTime);
      updateClip(clip.id, { duration: newDuration });
    }
  }, [resizingClip, updateClip]);

  const handleVideoAudioResize = useCallback((clip: TimelineClip, time: number) => {
    if (resizingClip?.edge === 'start') {
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
  }, [resizingClip, updateClip]);

  useEffect(() => {
    if (!resizingClip) return;

    const clip = tracks.flatMap(t => t.clips).find(c => c.id === resizingClip.id);
    if (!clip) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = tracksContainerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left + (tracksContainerRef.current?.scrollLeft || 0);
      const time = x / (PIXELS_PER_SECOND * ui.timelineZoom);

      if (clip.type === 'image') {
        handleImageResize(clip, time);
      } else {
        handleVideoAudioResize(clip, time);
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
  }, [resizingClip, tracks, ui.timelineZoom, tracksContainerRef, PIXELS_PER_SECOND, handleImageResize, handleVideoAudioResize]);

  return {
    resizingClip,
    handleResizeMouseDown
  };
};

export const useTimelineTextDrag = (
  tracksContainerRef: React.RefObject<HTMLDivElement>,
  PIXELS_PER_SECOND: number
) => {
  const { textOverlays, ui, selectText, updateTextOverlay } = useEditorStore();
  const [isDraggingText, setIsDraggingText] = useState(false);
  const [draggedTextId, setDraggedTextId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleTextMouseDown = useCallback((e: React.MouseEvent, textId: string) => {
    e.stopPropagation();
    selectText(textId);

    const text = textOverlays.find(t => t.id === textId);
    if (!text) return;

    const textStartX = text.startTime * PIXELS_PER_SECOND * ui.timelineZoom;
    const offsetX = e.clientX - textStartX - (tracksContainerRef.current?.getBoundingClientRect().left || 0) + (tracksContainerRef.current?.scrollLeft || 0);

    setDraggedTextId(textId);
    setIsDraggingText(true);
    setDragOffset({ x: offsetX, y: e.clientY });
  }, [textOverlays, selectText, PIXELS_PER_SECOND, ui.timelineZoom, tracksContainerRef]);

  const calculateTextCollision = useCallback((newTime: number, currentText: TextOverlay, otherTexts: TextOverlay[]) => {
    const hasCollision = otherTexts.some(t => 
      (newTime < t.startTime + t.duration) && (newTime + currentText.duration > t.startTime)
    );
    
    if (!hasCollision) return newTime;

    let bestTime = newTime;
    let minDistance = Infinity;
    
    for (let i = 0; i <= otherTexts.length; i++) {
      const t1End = (i === 0) ? 0 : (otherTexts[i-1].startTime + otherTexts[i-1].duration);
      const t2Start = (i < otherTexts.length) ? otherTexts[i].startTime : Infinity;
      
      const gapSize = t2Start - t1End;
      if (gapSize >= currentText.duration) {
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
    
    return bestTime;
  }, []);

  useEffect(() => {
    if (!isDraggingText || !draggedTextId) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = tracksContainerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left + (tracksContainerRef.current?.scrollLeft || 0) - dragOffset.x;
      let newTime = Math.max(0, x / (PIXELS_PER_SECOND * ui.timelineZoom));
      
      const currentText = textOverlays.find(t => t.id === draggedTextId);
      if (currentText) {
        const otherTexts = textOverlays.filter(t => t.id !== draggedTextId).sort((a, b) => a.startTime - b.startTime);
        newTime = calculateTextCollision(newTime, currentText, otherTexts);
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
  }, [isDraggingText, draggedTextId, dragOffset, ui.timelineZoom, updateTextOverlay, textOverlays, tracksContainerRef, PIXELS_PER_SECOND, calculateTextCollision]);

  return {
    draggedTextId,
    handleTextMouseDown
  };
};

export const useTimelineTextResize = (
  tracksContainerRef: React.RefObject<HTMLDivElement>,
  PIXELS_PER_SECOND: number
) => {
  const { textOverlays, ui, updateTextOverlay } = useEditorStore();
  const [resizingText, setResizingText] = useState<{ id: string; edge: 'start' | 'end' } | null>(null);

  const handleTextResizeMouseDown = useCallback((e: React.MouseEvent, textId: string, edge: 'start' | 'end') => {
    e.stopPropagation();
    setResizingText({ id: textId, edge });
  }, []);

  const handleTextResizeStart = useCallback((time: number, text: TextOverlay, otherTexts: TextOverlay[]) => {
    const currentEndTime = text.startTime + text.duration;
    
    let limit = 0;
    for (const t of otherTexts) {
      const tEnd = t.startTime + t.duration;
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
  }, [updateTextOverlay]);

  const handleTextResizeEnd = useCallback((time: number, text: TextOverlay, otherTexts: TextOverlay[]) => {
    const currentStartTime = text.startTime;
    
    let limit = Infinity;
    for (const t of otherTexts) {
      if (t.startTime >= currentStartTime) {
        if (t.startTime < limit) limit = t.startTime;
      }
    }

    const maxDuration = limit - currentStartTime;
    const newDuration = Math.max(0.1, Math.min(maxDuration, time - currentStartTime));
    
    updateTextOverlay(text.id, { duration: newDuration });
  }, [updateTextOverlay]);

  useEffect(() => {
    if (!resizingText) return;

    const text = textOverlays.find(t => t.id === resizingText.id);
    if (!text) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = tracksContainerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left + (tracksContainerRef.current?.scrollLeft || 0);
      const time = x / (PIXELS_PER_SECOND * ui.timelineZoom);

      const otherTexts = textOverlays.filter(t => t.id !== resizingText.id);

      if (resizingText.edge === 'start') {
        handleTextResizeStart(time, text, otherTexts);
      } else {
        handleTextResizeEnd(time, text, otherTexts);
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
  }, [resizingText, textOverlays, ui.timelineZoom, tracksContainerRef, PIXELS_PER_SECOND, handleTextResizeStart, handleTextResizeEnd]);

  return {
    handleTextResizeMouseDown
  };
};

export const useTimelineTransitionDrag = (
  tracksContainerRef: React.RefObject<HTMLDivElement>,
  PIXELS_PER_SECOND: number,
  TRACK_HEIGHT: number,
  RULER_HEIGHT: number
) => {
  const { tracks, transitions, setTransition, removeTransition, ui } = useEditorStore();
  const [isDraggingTransition, setIsDraggingTransition] = useState(false);
  const [draggedTransitionId, setDraggedTransitionId] = useState<string | null>(null);

  const handleTransitionMouseDown = useCallback((e: React.MouseEvent, transitionId: string) => {
    e.stopPropagation();
    setDraggedTransitionId(transitionId);
    setIsDraggingTransition(true);
  }, []);

  const handleTransitionDrop = useCallback((e: MouseEvent, rect: DOMRect) => {
    const x = e.clientX - rect.left + (tracksContainerRef.current?.scrollLeft || 0);
    const time = x / (PIXELS_PER_SECOND * ui.timelineZoom);

    const trackIndex = Math.floor((e.clientY - rect.top + (tracksContainerRef.current?.scrollTop || 0) - RULER_HEIGHT) / TRACK_HEIGHT);
    const targetTrack = tracks[trackIndex];

    if (targetTrack && targetTrack.type !== 'audio') {
      const targetClip = targetTrack.clips.find(c => {
        const start = c.startTime;
        const end = c.startTime + (c.duration - c.trimStart - c.trimEnd);
        return time >= start && time < end;
      });

      if (targetClip) {
        const transition = transitions.find(t => t.id === draggedTransitionId);
        if (transition) {
          const clipStart = targetClip.startTime;
          const clipDuration = targetClip.duration - targetClip.trimStart - targetClip.trimEnd;
          const relativeTime = time - clipStart;
          const newPosition = relativeTime < clipDuration / 2 ? 'start' : 'end';

          if (transition.clipId !== targetClip.id || transition.position !== newPosition) {
            removeTransition(transition.clipId, transition.position);
            setTransition(targetClip.id, transition.type, transition.duration, newPosition);
          }
        }
      }
    }
  }, [tracksContainerRef, PIXELS_PER_SECOND, ui.timelineZoom, RULER_HEIGHT, TRACK_HEIGHT, tracks, transitions, draggedTransitionId, removeTransition, setTransition]);

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

      handleTransitionDrop(e, rect);

      setIsDraggingTransition(false);
      setDraggedTransitionId(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingTransition, draggedTransitionId, handleTransitionDrop, tracksContainerRef]);

  return {
    handleTransitionMouseDown
  };
};

export const useTimelineDrop = (
  tracksContainerRef: React.RefObject<HTMLDivElement>,
  PIXELS_PER_SECOND: number
) => {
  const { tracks, mediaFiles, ui, addClipToTrack, setTransition } = useEditorStore();

  const findSmartTrack = useCallback((mediaType: string, tracksList: any[]) => {
    const typeMap: Record<string, { type: string; keywords: string[] }> = {
      'image': { type: 'video', keywords: ['image', 'overlay'] },
      'video': { type: 'video', keywords: ['video'] },
      'audio': { type: 'audio', keywords: ['audio'] },
    };

    const config = typeMap[mediaType];
    if (config) {
      const smartTrack = tracksList.find(t => 
        t.type === config.type && config.keywords.some(k => t.name.toLowerCase().includes(k))
      );
      if (smartTrack) return smartTrack;
    }
    
    const fallbackType = mediaType === 'audio' ? 'audio' : 'video';
    return tracksList.find(t => t.type === fallbackType);
  }, []);

  const handleMediaDrop = useCallback((media: any, trackId: string, time: number) => {
    const targetTrack = tracks.find(t => t.id === trackId);
    if (!targetTrack) return;

    const isCompatible = (media.type === 'audio' && targetTrack.type === 'audio') ||
                         ((media.type === 'video' || media.type === 'image') && targetTrack.type === 'video');

    if (isCompatible) {
       addClipToTrack(trackId, media, Math.max(0, time));
    } else {
       const smartTrack = findSmartTrack(media.type, tracks);

       if (smartTrack) {
         addClipToTrack(smartTrack.id, media, Math.max(0, time));
       }
    }
  }, [tracks, addClipToTrack, findSmartTrack]);

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

        handleMediaDrop(media, trackId, time);
      }
    } catch (error) {
      console.error('Error handling drop:', error);
    }
  }, [mediaFiles, tracksContainerRef, PIXELS_PER_SECOND, ui.timelineZoom, handleMediaDrop]);

  const handleClipDrop = useCallback((e: React.DragEvent, clipId: string, trackType?: string) => {
    try {
      const rawData = e.dataTransfer.getData('application/json');
      if (!rawData) return;

      const data = JSON.parse(rawData);
      
      if (data.type === 'NEW_TRANSITION') {
        e.preventDefault();
        e.stopPropagation();
        
        if (trackType === 'audio') {
          return;
        }
        
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const position = x < rect.width / 2 ? 'start' : 'end';
        
        setTransition(clipId, data.transitionType, 0.5, position);
      }
    } catch (error) {
      console.error('Error handling clip drop:', error);
    }
  }, [setTransition]);

  const handleTimelineMediaDrop = useCallback((media: any, time: number) => {
    const smartTrack = findSmartTrack(media.type, tracks);
    
    if (smartTrack) {
      addClipToTrack(smartTrack.id, media, Math.max(0, time));
    }
  }, [findSmartTrack, tracks, addClipToTrack]);

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

        handleTimelineMediaDrop(media, time);
      }
    } catch (error) {
      console.error('Error handling timeline drop:', error);
    }
  }, [mediaFiles, tracksContainerRef, PIXELS_PER_SECOND, ui.timelineZoom, handleTimelineMediaDrop]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  return {
    handleDrop,
    handleClipDrop,
    handleTimelineDrop,
    handleDragOver
  };
};

