// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { indexedDBStorage } from '../utils/storage';
import { v4 as uuidv4 } from 'uuid';
import type {
  MediaFile,
  TimelineClip,
  TimelineTrack,
  TextOverlay,
  Transition,
  VideoFilter,
  PlayerState,
  UIState,
  ExportSettings,
  MediaType,
  TransitionType,
  TrackType,
} from '../types';
import { DEFAULT_FILTER } from '../types';

// Helper to resolve overlaps by shifting clips to the right
const resolveOverlaps = (clips: TimelineClip[]): TimelineClip[] => {
  if (clips.length <= 1) return clips;
  
  // Sort by start time
  const sortedClips = [...clips].sort((a, b) => a.startTime - b.startTime);
  
  const resolvedClips: TimelineClip[] = [];
  let previousEnd = 0;
  
  for (const clip of sortedClips) {
    const duration = clip.duration - clip.trimStart - clip.trimEnd;
    let startTime = clip.startTime;
    
    // If this clip starts before the previous one ended, shift it
    if (startTime < previousEnd - 0.001) { // Use small epsilon for float comparison
      startTime = previousEnd;
    }
    
    resolvedClips.push({ ...clip, startTime });
    previousEnd = startTime + duration;
  }
  
  return resolvedClips;
};

// Helper for moveClip to find and remove clip from a track
const findAndRemoveClip = (track: TimelineTrack, clipId: string, newTrackId: string, newStartTime: number): { track: TimelineTrack; clipToMove: TimelineClip | null } => {
  const clip = track.clips.find((c) => c.id === clipId);
  if (clip) {
    const clipToMove = { ...clip, trackId: newTrackId, startTime: Math.max(0, newStartTime) };
    const updatedTrack = {
      ...track,
      clips: track.clips.filter((c) => c.id !== clipId),
    };
    return { track: updatedTrack, clipToMove };
  }
  return { track, clipToMove: null };
};

// Helper for moveClip to add clip to a new track
const addClipToTrack = (track: TimelineTrack, clipToMove: TimelineClip): TimelineTrack => {
  if (track.id === clipToMove.trackId) {
    return { ...track, clips: resolveOverlaps([...track.clips, clipToMove]) };
  }
  return track;
};

// Helper for splitClip to perform the split operation on state
const performSplitClip = (
  state: { tracks: TimelineTrack[] },
  clipId: string,
  splitTime: number
): { tracks: TimelineTrack[] } | typeof state => {
  // First, find the track containing the clip
  const trackIndex = state.tracks.findIndex(t => t.clips.some(c => c.id === clipId));
  if (trackIndex === -1) return state; // Clip not found in any track

  const track = state.tracks[trackIndex];
  const clipIndex = track.clips.findIndex((c) => c.id === clipId);
  if (clipIndex === -1) return state;

  const clip = track.clips[clipIndex];
  const clipStart = clip.startTime;
  const clipEnd = clip.startTime + (clip.duration - clip.trimStart - clip.trimEnd);

  // Check if split time is within the clip
  if (splitTime <= clipStart || splitTime >= clipEnd) return state;

  const splitPoint = splitTime - clipStart + clip.trimStart;

  // Create two new clips - IMPORTANT: Each clip is INDEPENDENT
  // We do NOT copy audioMuted, detachedAudioClipId, or linkedVideoClipId
  // Each split part starts fresh with its own audio state
  const firstClip: TimelineClip = {
    id: clip.id, // Keep original ID for first part
    mediaId: clip.mediaId,
    trackId: clip.trackId,
    startTime: clip.startTime,
    duration: clip.duration,
    trimStart: clip.trimStart,
    trimEnd: clip.duration - splitPoint,
    name: clip.name,
    type: clip.type,
    thumbnail: clip.thumbnail,
    crop: clip.crop,
    transform: clip.transform,
    // Audio state is INDEPENDENT - not copied from original
    audioMuted: false,
    detachedAudioClipId: undefined,
    linkedVideoClipId: undefined,
  };

  const secondClip: TimelineClip = {
    id: uuidv4(), // New ID for second part
    mediaId: clip.mediaId,
    trackId: clip.trackId,
    startTime: splitTime,
    duration: clip.duration,
    trimStart: splitPoint,
    trimEnd: clip.trimEnd,
    name: clip.name + ' (2)',
    type: clip.type,
    thumbnail: clip.thumbnail,
    crop: clip.crop,
    transform: clip.transform,
    // Audio state is INDEPENDENT - not copied from original
    audioMuted: false,
    detachedAudioClipId: undefined,
    linkedVideoClipId: undefined,
  };

  console.log('✂️ Split clip:', {
    originalId: clipId,
    firstClipId: firstClip.id,
    secondClipId: secondClip.id,
    splitTime,
    splitPoint,
    firstClip: { startTime: firstClip.startTime, duration: firstClip.duration, trimStart: firstClip.trimStart, trimEnd: firstClip.trimEnd, visibleDuration: firstClip.duration - firstClip.trimStart - firstClip.trimEnd },
    secondClip: { startTime: secondClip.startTime, duration: secondClip.duration, trimStart: secondClip.trimStart, trimEnd: secondClip.trimEnd, visibleDuration: secondClip.duration - secondClip.trimStart - secondClip.trimEnd },
    firstClipAudioMuted: firstClip.audioMuted,
    secondClipAudioMuted: secondClip.audioMuted
  });

  const newClips = [...track.clips];
  newClips.splice(clipIndex, 1, firstClip, secondClip);

  const newTrack = { ...track, clips: resolveOverlaps(newClips) };

  // Only update the specific track that contains the clip
  const newTracks = [...state.tracks];
  newTracks[trackIndex] = newTrack;

  return { tracks: newTracks };
};

// Helper for rehydration: regenerate Blob URLs for media files
const regenerateMediaBlobUrls = (mediaFiles: MediaFile[]): void => {
  for (const media of mediaFiles) {
    if (!(media.file instanceof File)) continue;
    if (media.url && media.url.startsWith('blob:')) {
      URL.revokeObjectURL(media.url);
    }
    media.url = URL.createObjectURL(media.file);
    if (media.type === 'image') {
      media.thumbnail = media.url;
    }
  }
};

// Helper for rehydration: update clip thumbnails from media files
const updateClipThumbnails = (tracks: TimelineTrack[], mediaFiles: MediaFile[]): void => {
  for (const track of tracks) {
    for (const clip of track.clips) {
      const media = mediaFiles.find(m => m.id === clip.mediaId);
      if (media && media.thumbnail) {
        clip.thumbnail = media.thumbnail;
      }
    }
  }
};

interface EditorState {
  // Project data
  projectName: string;
  mediaFiles: MediaFile[];
  tracks: TimelineTrack[];
  textOverlays: TextOverlay[];
  transitions: Transition[];
  filters: { [clipId: string]: VideoFilter };
  projectDuration: number;
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '21:9';
  
  // Player state
  player: PlayerState;
  
  // UI state
  ui: UIState;
  
  // Export settings
  exportSettings: ExportSettings;
  
  // History for undo/redo
  history: { past: any[]; future: any[] };
  
  // Project management
  projects: ProjectData[];
  currentProjectId: string;
  
  // Actions
  setProjectName: (name: string) => void;
  setAspectRatio: (ratio: '16:9' | '9:16' | '1:1' | '4:3' | '21:9') => void;
  createProject: () => void;
  loadProject: (id: string) => void;
  deleteProject: (id: string) => void;
  
  // Media actions
  addMediaFile: (file: MediaFile) => void;
  updateMediaFile: (id: string, updates: Partial<MediaFile>) => void;
  removeMediaFile: (id: string) => void;
  detachAudioFromVideo: (videoClipId: string) => void;
  
  // Track actions
  addTrack: (type?: TrackType) => void;
  removeTrack: (id: string) => void;
  toggleTrackMute: (id: string) => void;
  toggleTrackLock: (id: string) => void;
  setTrackVolume: (id: string, volume: number) => void;
  
  // Clip actions
  addClipToTrack: (trackId: string, mediaFile: MediaFile, startTime: number) => void;
  removeClip: (clipId: string) => void;
  updateClip: (clipId: string, updates: Partial<TimelineClip>, skipHistory?: boolean) => void;
  moveClip: (clipId: string, newTrackId: string, newStartTime: number) => void;
  splitClip: (clipId: string, splitTime: number) => void;
  trimClip: (clipId: string, trimStart: number, trimEnd: number) => void;
  selectClip: (clipId: string | null) => void;
  
  // Text overlay actions
  addTextOverlay: (text: Partial<TextOverlay>) => void;
  updateTextOverlay: (id: string, updates: Partial<TextOverlay>, skipHistory?: boolean) => void;
  removeTextOverlay: (id: string) => void;
  moveTextOverlayToTrack: (textId: string, targetTrackId: string) => void;
  selectText: (id: string | null) => void;
  
  // Transition actions
  setTransition: (clipId: string, type: TransitionType, duration: number, position?: 'start' | 'end') => void;
  removeTransition: (clipId: string, position?: 'start' | 'end') => void;
  
  // Filter actions
  setFilter: (clipId: string, filter: VideoFilter) => void;
  resetFilter: (clipId: string) => void;
  
  // Player actions
  play: () => void;
  pause: () => void;
  togglePlayPause: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setPlaybackRate: (rate: number) => void;
  toggleFullscreen: () => void;
  
  // UI actions
  setTimelineZoom: (zoom: number) => void;
  setTimelineScrollX: (scrollX: number) => void;
  setActivePanel: (panel: UIState['activePanel']) => void;
  openExportModal: () => void;
  closeExportModal: () => void;
  setProcessing: (isProcessing: boolean, progress?: number, message?: string) => void;
  setMobileSidebarOpen: (isOpen: boolean) => void;
  
  // Export actions
  setExportSettings: (settings: Partial<ExportSettings>) => void;
  
  // History actions
  undo: () => void;
  redo: () => void;
  saveState: () => void;
  
  // Utility actions
  calculateProjectDuration: () => void;
  resetProject: () => void;
}

interface ProjectData {
  id: string;
  name: string;
  lastModified: number;
  mediaFiles: MediaFile[];
  tracks: TimelineTrack[];
  textOverlays: TextOverlay[];
  transitions: Transition[];
  filters: { [clipId: string]: VideoFilter };
  projectDuration: number;
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '21:9';
}

const defaultPlayerState: PlayerState = {
  isPlaying: false,
  currentTime: 0,
  volume: 1,
  isMuted: false,
  isFullscreen: false,
  playbackRate: 1,
};

const defaultUIState: UIState = {
  selectedClipId: null,
  selectedTrackId: null,
  selectedTextId: null,
  timelineZoom: 1,
  timelineScrollX: 0,
  activePanel: 'media',
  isExportModalOpen: false,
  isProcessing: false,
  processingProgress: 0,
  processingMessage: '',
  isMobileSidebarOpen: false,
};

const defaultExportSettings: ExportSettings = {
  resolution: '1080p',
  format: 'mp4',
  quality: 'high',
  fps: '30',
  filename: 'video-export',
};

const initialProjectId = uuidv4();

export const useEditorStore = create<EditorState>()(persist((set, get) => ({
  // Initial state
  projectName: 'Nouveau Projet',
  mediaFiles: [],
  tracks: [
    { id: 'video-1', name: 'Video 1', type: 'video', clips: [], muted: false, locked: false, volume: 1 },
    { id: 'images-1', name: 'Images', type: 'image', clips: [], muted: false, locked: false, volume: 1 },
    { id: 'audio-1', name: 'Audio 1', type: 'audio', clips: [], muted: false, locked: false, volume: 1 },
  ],
  textOverlays: [],
  transitions: [],
  filters: {},
  projectDuration: 0,
  aspectRatio: '16:9',
  player: defaultPlayerState,
  ui: defaultUIState,
  exportSettings: defaultExportSettings,
  history: { past: [], future: [] },
  
  // Project management
  projects: [{
    id: initialProjectId,
    name: 'Nouveau Projet',
    lastModified: Date.now(),
    mediaFiles: [],
    tracks: [
      { id: 'video-1', name: 'Video 1', type: 'video', clips: [], muted: false, locked: false, volume: 1 },
      { id: 'images-1', name: 'Images', type: 'image', clips: [], muted: false, locked: false, volume: 1 },
      { id: 'audio-1', name: 'Audio 1', type: 'audio', clips: [], muted: false, locked: false, volume: 1 },
    ],
    textOverlays: [],
    transitions: [],
    filters: {},
    projectDuration: 0,
    aspectRatio: '16:9',
  }],
  currentProjectId: initialProjectId,

  // Project name
  setProjectName: (name) => {
    set((state) => {
      const updatedProjects = state.projects.map(p => 
        p.id === state.currentProjectId ? { ...p, name } : p
      );
      return { projectName: name, projects: updatedProjects };
    });
  },
  
  // Aspect ratio
  setAspectRatio: (ratio) => {
    set((state) => {
      // Update current project in projects list
      const updatedProjects = state.projects.map(p =>
        p.id === state.currentProjectId ? { ...p, aspectRatio: ratio } : p
      );
      return { aspectRatio: ratio, projects: updatedProjects };
    });
  },

  createProject: () => {
    const state = get();
    // Save current project state first
    const currentProjectData: ProjectData = {
      id: state.currentProjectId,
      name: state.projectName,
      lastModified: Date.now(),
      mediaFiles: state.mediaFiles,
      tracks: state.tracks,
      textOverlays: state.textOverlays,
      transitions: state.transitions,
      filters: state.filters,
      projectDuration: state.projectDuration,
      aspectRatio: state.aspectRatio,
    };

    const newProjectId = uuidv4();
    const newProject: ProjectData = {
      id: newProjectId,
      name: `Projet ${state.projects.length + 1}`,
      lastModified: Date.now(),
      mediaFiles: [],
     tracks: [
      { id: 'video-1', name: 'Video 1', type: 'video', clips: [], muted: false, locked: false, volume: 1 },
      { id: 'images-1', name: 'Images', type: 'image', clips: [], muted: false, locked: false, volume: 1 },
      { id: 'audio-1', name: 'Audio 1', type: 'audio', clips: [], muted: false, locked: false, volume: 1 },
    ],
      textOverlays: [],
      transitions: [],
      filters: {},
      projectDuration: 0,
      aspectRatio: '16:9',
    };

    // Update projects list: update current and add new
    const updatedProjects = state.projects.map(p => 
      p.id === state.currentProjectId ? currentProjectData : p
    );

    set({
      projects: [...updatedProjects, newProject],
      currentProjectId: newProjectId,
      // Reset state to new project
      projectName: newProject.name,
      mediaFiles: newProject.mediaFiles,
      tracks: newProject.tracks,
      textOverlays: newProject.textOverlays,
      transitions: newProject.transitions,
      filters: newProject.filters,
      projectDuration: newProject.projectDuration,
      aspectRatio: newProject.aspectRatio,
      history: { past: [], future: [] }, // Reset history for new project
    });
  },

  loadProject: (id) => {
    const state = get();
    if (state.currentProjectId === id) return;

    // Save current project state
    const currentProjectData: ProjectData = {
      id: state.currentProjectId,
      name: state.projectName,
      lastModified: Date.now(),
      mediaFiles: state.mediaFiles,
      tracks: state.tracks,
      textOverlays: state.textOverlays,
      transitions: state.transitions,
      filters: state.filters,
      projectDuration: state.projectDuration,
      aspectRatio: state.aspectRatio,
    };

    const targetProject = state.projects.find(p => p.id === id);
    if (!targetProject) return;

    const updatedProjects = state.projects.map(p => 
      p.id === state.currentProjectId ? currentProjectData : p
    );

    set({
      projects: updatedProjects,
      currentProjectId: id,
      // Load target project state
      projectName: targetProject.name,
      mediaFiles: targetProject.mediaFiles,
      tracks: targetProject.tracks,
      textOverlays: targetProject.textOverlays,
      transitions: targetProject.transitions,
      filters: targetProject.filters,
      projectDuration: targetProject.projectDuration,
      aspectRatio: targetProject.aspectRatio,
      history: { past: [], future: [] }, // Reset history when switching
    });
  },

  deleteProject: (id) => {
    const state = get();
    if (state.projects.length <= 1) return; // Prevent deleting the last project

    const newProjects = state.projects.filter(p => p.id !== id);
    
    // If deleting current project, switch to another one
    if (state.currentProjectId === id) {
      const nextProject = newProjects[0];
      set({
        projects: newProjects,
        currentProjectId: nextProject.id,
        projectName: nextProject.name,
        mediaFiles: nextProject.mediaFiles,
        tracks: nextProject.tracks,
        textOverlays: nextProject.textOverlays,
        transitions: nextProject.transitions,
        filters: nextProject.filters,
        projectDuration: nextProject.projectDuration,
        aspectRatio: nextProject.aspectRatio,
        history: { past: [], future: [] },
      });
    } else {
      set({ projects: newProjects });
    }
  },

  
  // Media actions
  addMediaFile: (file) => {
    set((state) => ({
      mediaFiles: [...state.mediaFiles, file],
    }));
  },
  
  updateMediaFile: (id, updates) => {
    set((state) => ({
      mediaFiles: state.mediaFiles.map((f) =>
        f.id === id ? { ...f, ...updates } : f
      ),
    }));
  },
  
  detachAudioFromVideo: (videoClipId) => {
    const state = get();
    get().saveState(); // Save state before action for undo
    
    const videoClip = state.tracks.flatMap(t => t.clips).find(c => c.id === videoClipId);
    
    console.log('🎵 detachAudioFromVideo called:', {
      videoClipId,
      videoClip: videoClip ? { id: videoClip.id, type: videoClip.type, name: videoClip.name } : null
    });
    
    if (!videoClip || videoClip.type !== 'video') {
      console.log('❌ detachAudioFromVideo: Invalid clip or not a video');
      return;
    }
    
    const mediaFile = state.mediaFiles.find(m => m.id === videoClip.mediaId);
    if (!mediaFile) {
      console.log('❌ detachAudioFromVideo: Media file not found');
      return;
    }
    
    // Find or create an audio track
    let audioTrack = state.tracks.find(t => t.type === 'audio');
    if (!audioTrack) {
      const newTrack: TimelineTrack = {
        id: uuidv4(),
        name: 'Audio ' + (state.tracks.filter(t => t.type === 'audio').length + 1),
        type: 'audio',
        clips: [],
        muted: false,
        locked: false,
        volume: 1,
      };
      set((state) => ({
        tracks: [...state.tracks, newTrack],
      }));
      audioTrack = newTrack;
    }
    
    // Create an audio clip at the same position as the video
    const audioClipId = uuidv4();
    const audioClip: TimelineClip = {
      id: audioClipId,
      mediaId: videoClip.mediaId,
      trackId: audioTrack.id,
      startTime: videoClip.startTime,
      duration: videoClip.duration,
      trimStart: videoClip.trimStart,
      trimEnd: videoClip.trimEnd,
      name: mediaFile.name + ' (audio)',
      type: 'audio',
      // Link to original video clip so we can track the relationship
      linkedVideoClipId: videoClipId,
    };
    
    console.log('🎵 Creating audio clip:', {
      audioClipId,
      linkedVideoClipId: videoClipId,
      audioTrackId: audioTrack.id
    });
    
    const updateVideoClip = (clip: TimelineClip) => {
      if (clip.id === videoClipId) {
        console.log('🔊 Video clip keeps audio (detached audio is a copy):', {
          clipId: clip.id,
          audioMuted: false,
          detachedAudioClipId: audioClipId
        });
        return { ...clip, audioMuted: false, detachedAudioClipId: audioClipId };
      }
      return clip;
    };

    const updateTrack = (track: TimelineTrack) => {
      if (track.id === audioTrack!.id) {
        console.log('🎵 Adding audio clip to track:', audioTrack!.id);
        return { ...track, clips: [...track.clips, audioClip] };
      }
      return {
        ...track,
        clips: track.clips.map(updateVideoClip),
      };
    };

    set((state) => ({
      tracks: state.tracks.map(updateTrack),
    }));
    
    // Verify the changes were applied
    const newState = get();
    const updatedVideoClip = newState.tracks.flatMap(t => t.clips).find(c => c.id === videoClipId);
    const createdAudioClip = newState.tracks.flatMap(t => t.clips).find(c => c.id === audioClipId);
    
    console.log('✅ detachAudioFromVideo completed:', {
      videoClip: updatedVideoClip ? {
        id: updatedVideoClip.id,
        audioMuted: updatedVideoClip.audioMuted,
        detachedAudioClipId: updatedVideoClip.detachedAudioClipId
      } : null,
      audioClip: createdAudioClip ? {
        id: createdAudioClip.id,
        linkedVideoClipId: createdAudioClip.linkedVideoClipId
      } : null
    });
    
    get().calculateProjectDuration();
  },
  
  removeMediaFile: (id) => {
    set((state) => ({
      mediaFiles: state.mediaFiles.filter((f) => f.id !== id),
    }));
  },
  
  // Track actions
  addTrack: (type = 'video' as TrackType) => {
    const trackCount = get().tracks.filter((t) => t.type === type).length;
    const typeNames: Record<TrackType, string> = {
      video: 'Vidéo',
      audio: 'Audio',
      image: 'Image',
      text: 'Texte',
    };
    const newTrack: TimelineTrack = {
      id: uuidv4(),
      name: `${typeNames[type]} ${trackCount + 1}`,
      type,
      clips: [],
      muted: false,
      locked: false,
      volume: 1, // Default volume 100%
    };
    set((state) => ({
      tracks: [...state.tracks, newTrack],
    }));
  },
  
  removeTrack: (id) => {
    const state = get();
    get().saveState(); // Save state before action
    
    // Find the track being removed
    const trackToRemove = state.tracks.find(t => t.id === id);
    if (!trackToRemove) return;
    
    // Collect all detached audio clip IDs from video clips in this track
    const detachedAudioClipIds: string[] = [];
    // Collect all linked video clip IDs from audio clips in this track
    const linkedVideoClipIds: string[] = [];
    
    trackToRemove.clips.forEach(clip => {
      if (clip.detachedAudioClipId) {
        detachedAudioClipIds.push(clip.detachedAudioClipId);
      }
      if (clip.linkedVideoClipId) {
        linkedVideoClipIds.push(clip.linkedVideoClipId);
      }
    });
    
    console.log('🗑️ Removing track:', {
      trackId: id,
      trackType: trackToRemove.type,
      clipsCount: trackToRemove.clips.length,
      detachedAudioClipIds,
      linkedVideoClipIds
    });
    
    const filterDetachedAudio = (c: TimelineClip) => !detachedAudioClipIds.includes(c.id);
    const muteLinkedVideo = (c: TimelineClip) => {
      if (linkedVideoClipIds.includes(c.id)) {
        console.log('🔇 Muting video clip (audio track removed):', c.id);
        return { ...c, audioMuted: true, detachedAudioClipId: undefined };
      }
      return c;
    };
    const processRemainingTrack = (track: TimelineTrack) => ({
      ...track,
      clips: track.clips.filter(filterDetachedAudio).map(muteLinkedVideo),
    });

    set((state) => ({
      tracks: state.tracks
        .filter((t) => t.id !== id)
        .map(processRemainingTrack),
    }));
    
    get().calculateProjectDuration();
  },
  
  toggleTrackMute: (id) => {
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === id ? { ...t, muted: !t.muted } : t
      ),
    }));
  },
  
  toggleTrackLock: (id) => {
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === id ? { ...t, locked: !t.locked } : t
      ),
    }));
  },
  
  setTrackVolume: (id, volume) => {
    // Clamp volume between 0 and 1 (0% to 100%)
    const clampedVolume = Math.max(0, Math.min(1, volume));
    set((state) => ({
      tracks: state.tracks.map((t) =>
        t.id === id ? { ...t, volume: clampedVolume } : t
      ),
    }));
  },
  
  // Clip actions
  addClipToTrack: (trackId, mediaFile, startTime) => {
    get().saveState(); // Save state before action
    
    const newClip: TimelineClip = {
      id: uuidv4(),
      mediaId: mediaFile.id,
      trackId,
      startTime,
      duration: mediaFile.duration,
      trimStart: 0,
      trimEnd: 0,
      name: mediaFile.name,
      type: mediaFile.type,
      thumbnail: mediaFile.thumbnail,
    };
    
    set((state) => ({
      tracks: state.tracks.map((track) =>
        track.id === trackId
          ? { ...track, clips: resolveOverlaps([...track.clips, newClip]) }
          : track
      ),
    }));
    get().calculateProjectDuration();
  },
  
  removeClip: (clipId) => {
    get().saveState(); // Save state before action
    
    const state = get();
    
    // Find the clip being removed
    const clipToRemove = state.tracks.flatMap(t => t.clips).find(c => c.id === clipId);
    
    if (!clipToRemove) {
      // Clip not found, just remove it
      const removeClipFromTrack = (track: TimelineTrack) => ({
        ...track,
        clips: track.clips.filter((c) => c.id !== clipId),
      });
      set((state) => ({
        tracks: state.tracks.map(removeClipFromTrack),
        ui: {
          ...state.ui,
          selectedClipId: state.ui.selectedClipId === clipId ? null : state.ui.selectedClipId,
        },
      }));
      get().calculateProjectDuration();
      return;
    }
    
    // Check if this is a detached audio clip (has linkedVideoClipId)
    const linkedVideoClipId = clipToRemove.linkedVideoClipId;
    
    // Also check if this is a video clip that has detached audio
    const detachedAudioClipId = clipToRemove.detachedAudioClipId;
    
    console.log('🗑️ Removing clip:', {
      clipId,
      clipType: clipToRemove.type,
      linkedVideoClipId,
      detachedAudioClipId,
      audioMuted: clipToRemove.audioMuted
    });
    
    const updateLinkedClip = (c: TimelineClip) => {
      if (linkedVideoClipId && c.id === linkedVideoClipId) {
        console.log('🔇 Muting video clip after audio deletion:', linkedVideoClipId);
        return { ...c, audioMuted: true, detachedAudioClipId: undefined };
      }
      if (detachedAudioClipId && c.id === detachedAudioClipId) {
        return c;
      }
      return c;
    };

    const processTrack = (track: TimelineTrack) => ({
      ...track,
      clips: track.clips
        .filter((c) => c.id !== clipId)
        .map(updateLinkedClip),
    });

    // First pass: Remove the clip and update linked clips
    set((state) => {
      const newTracks = state.tracks.map(processTrack);
      
      return {
        tracks: newTracks,
        ui: {
          ...state.ui,
          selectedClipId: state.ui.selectedClipId === clipId ? null : state.ui.selectedClipId,
        },
      };
    });
    
    // Second pass: If we removed a video clip that had detached audio, also remove that audio clip
    if (detachedAudioClipId) {
      console.log('🗑️ Also removing detached audio clip:', detachedAudioClipId);
      const removeDetachedAudio = (track: TimelineTrack) => ({
        ...track,
        clips: track.clips.filter((c) => c.id !== detachedAudioClipId),
      });
      set((state) => ({
        tracks: state.tracks.map(removeDetachedAudio),
      }));
    }
    
    // Third pass: If we removed an audio clip, find any video clip that references it
    // and mute it (since the detached audio is now gone)
    if (clipToRemove.type === 'audio') {
      const muteLinkedVideo = (c: TimelineClip) => {
        if (c.detachedAudioClipId === clipId) {
          console.log('🔇 Muting video clip (by detachedAudioClipId):', c.id);
          return { ...c, audioMuted: true, detachedAudioClipId: undefined };
        }
        return c;
      };

      set((state) => ({
        tracks: state.tracks.map((track) => ({
          ...track,
          clips: track.clips.map(muteLinkedVideo),
        })),
      }));
    }
    
    get().calculateProjectDuration();
  },
  
  updateClip: (clipId, updates, skipHistory = false) => {
    if (!skipHistory) get().saveState(); // Save state before action
    
    const processTrack = (track: TimelineTrack) => {
      const hasClip = track.clips.some(c => c.id === clipId);
      if (!hasClip) return track;
      
      const updatedClips = track.clips.map((clip) =>
        clip.id === clipId ? { ...clip, ...updates } : clip
      );
      
      // Only resolve overlaps if position or duration changed
      if (updates.startTime !== undefined || updates.trimStart !== undefined || updates.trimEnd !== undefined) {
           return { ...track, clips: resolveOverlaps(updatedClips) };
      }
      
      return { ...track, clips: updatedClips };
    };

    set((state) => ({
      tracks: state.tracks.map(processTrack),
    }));
    get().calculateProjectDuration();
  },
  
  moveClip: (clipId, newTrackId, newStartTime) => {
    get().saveState(); // Save state before action
    
    set((state) => {
      let clipToMove: TimelineClip | null = null;

      // Remove clip from old track
      const newTracks = state.tracks.map(track => {
        const result = findAndRemoveClip(track, clipId, newTrackId, newStartTime);
        if (result.clipToMove) clipToMove = result.clipToMove;
        return result.track;
      });
      
      // Add clip to new track
      if (clipToMove) {
        return {
          tracks: newTracks.map(track => addClipToTrack(track, clipToMove!)),
        };
      }
      
      return state;
    });
    get().calculateProjectDuration();
  },
  
  splitClip: (clipId, splitTime) => {
    get().saveState(); // Save state before action
    
    set((state) => performSplitClip(state, clipId, splitTime));
    get().calculateProjectDuration();
  },
  
  trimClip: (clipId, trimStart, trimEnd) => {
    get().updateClip(clipId, { trimStart, trimEnd });
  },
  
  selectClip: (clipId) => {
    set((state) => ({
      ui: { ...state.ui, selectedClipId: clipId, selectedTextId: null },
    }));
  },
  
  // Text overlay actions
  addTextOverlay: (text) => {
    get().saveState(); // Save state before action
    
    const state = get();
    let startTime = text.startTime ?? state.player.currentTime;
    const duration = text.duration ?? 5;
    
    // Determine which text track to assign this overlay to
    let targetTrackId = text.trackId;
    if (!targetTrackId) {
      // Find the first text track, or auto-create one
      const textTracks = state.tracks.filter(t => t.type === 'text');
      if (textTracks.length > 0) {
        targetTrackId = textTracks[0].id;
      } else {
        // Auto-create a text track
        const newTrackId = uuidv4();
        const trackCount = state.tracks.filter(t => t.type === 'text').length;
        const newTrack: TimelineTrack = {
          id: newTrackId,
          name: `Texte ${trackCount + 1}`,
          type: 'text',
          clips: [],
          muted: false,
          locked: false,
          volume: 1,
        };
        set((s) => ({ tracks: [...s.tracks, newTrack] }));
        targetTrackId = newTrackId;
      }
    }
    
    // Check for collision only within the same track
    const sameTrackTexts = state.textOverlays
      .filter(t => t.trackId === targetTrackId)
      .sort((a, b) => a.startTime - b.startTime);
    let isColliding = true;
    
    const checkCollision = (t: TextOverlay) => (startTime < t.startTime + t.duration) && (startTime + duration > t.startTime);

    // Iteratively find a free spot
    while (isColliding) {
      const collider = sameTrackTexts.find(checkCollision);
      
      if (collider) {
        // Move to the end of the colliding clip
        startTime = collider.startTime + collider.duration;
      } else {
        isColliding = false;
      }
    }
    
    const newText: TextOverlay = {
      id: uuidv4(),
      text: text.text || 'Nouveau texte',
      trackId: targetTrackId,
      x: text.x ?? 50,
      y: text.y ?? 50,
      fontSize: text.fontSize ?? 32,
      fontFamily: text.fontFamily ?? 'Inter',
      color: text.color ?? '#FFFFFF',
      backgroundColor: text.backgroundColor,
      startTime: startTime,
      duration: duration,
      bold: text.bold ?? false,
      italic: text.italic ?? false,
    };
    
    set((state) => ({
      textOverlays: [...state.textOverlays, newText],
      ui: { ...state.ui, selectedTextId: newText.id },
    }));
  },
  
  updateTextOverlay: (id, updates, skipHistory = false) => {
    if (!skipHistory) get().saveState(); // Save state before action
    
    set((state) => ({
      textOverlays: state.textOverlays.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      ),
    }));
  },
  
  removeTextOverlay: (id) => {
    get().saveState(); // Save state before action
    
    set((state) => ({
      textOverlays: state.textOverlays.filter((t) => t.id !== id),
      ui: {
        ...state.ui,
        selectedTextId: state.ui.selectedTextId === id ? null : state.ui.selectedTextId,
      },
    }));
  },
  
  moveTextOverlayToTrack: (textId, targetTrackId) => {
    const state = get();
    const textOverlay = state.textOverlays.find(t => t.id === textId);
    if (!textOverlay || textOverlay.trackId === targetTrackId) return;
    
    // Verify target track exists and is a text track
    const targetTrack = state.tracks.find(t => t.id === targetTrackId && t.type === 'text');
    if (!targetTrack) return;
    
    get().saveState(); // Save state before action
    
    set((s) => ({
      textOverlays: s.textOverlays.map(t =>
        t.id === textId ? { ...t, trackId: targetTrackId } : t
      ),
    }));
  },
  
  selectText: (id) => {
    set((state) => ({
      ui: { ...state.ui, selectedTextId: id, selectedClipId: null },
    }));
  },
  
  // Transition actions
  setTransition: (clipId, type, duration, position = 'start') => {
    get().saveState(); // Save state before action
    
    set((state) => {
      // Check if a transition already exists for this clip AND position
      const existingIndex = state.transitions.findIndex((t) => t.clipId === clipId && t.position === position);
      
      const newTransition: Transition = {
        id: existingIndex >= 0 ? state.transitions[existingIndex].id : uuidv4(),
        type,
        duration,
        clipId,
        position,
      };
      
      if (existingIndex >= 0) {
        const newTransitions = [...state.transitions];
        newTransitions[existingIndex] = newTransition;
        return { transitions: newTransitions };
      }
      
      return { transitions: [...state.transitions, newTransition] };
    });
  },
  
  removeTransition: (clipId, position) => {
    get().saveState(); // Save state before action
    
    set((state) => ({
      transitions: state.transitions.filter((t) => {
        if (position) {
          return !(t.clipId === clipId && t.position === position);
        }
        return t.clipId !== clipId;
      }),
    }));
  },
  
  // Filter actions
  setFilter: (clipId, filter) => {
    set((state) => ({
      filters: { ...state.filters, [clipId]: { ...filter, id: clipId } },
    }));
  },
  
  resetFilter: (clipId) => {
    set((state) => {
      const newFilters = { ...state.filters };
      delete newFilters[clipId];
      return { filters: newFilters };
    });
  },
  
  // Player actions
  play: () => set((state) => ({ player: { ...state.player, isPlaying: true } })),
  pause: () => set((state) => ({ player: { ...state.player, isPlaying: false } })),
  togglePlayPause: () => set((state) => ({ player: { ...state.player, isPlaying: !state.player.isPlaying } })),
  // Ne pas brider le curseur avec projectDuration pour que la preview reste toujours visible
  seek: (time) => set((state) => ({
    player: {
      ...state.player,
      currentTime: Math.max(0, time),
    },
  })),
  setVolume: (volume) => set((state) => ({ 
    player: { 
      ...state.player, 
      volume: Math.max(0, Math.min(1, volume)),
      isMuted: volume === 0 ? state.player.isMuted : false // Unmute when volume is increased
    } 
  })),
  toggleMute: () => set((state) => ({ player: { ...state.player, isMuted: !state.player.isMuted } })),
  setPlaybackRate: (rate) => set((state) => ({ player: { ...state.player, playbackRate: rate } })),
  toggleFullscreen: () => set((state) => ({ player: { ...state.player, isFullscreen: !state.player.isFullscreen } })),
  
  // UI actions
  setTimelineZoom: (zoom) => set((state) => ({ ui: { ...state.ui, timelineZoom: Math.max(0.1, Math.min(5, zoom)) } })),
  setTimelineScrollX: (scrollX) => set((state) => ({ ui: { ...state.ui, timelineScrollX: scrollX } })),
  setActivePanel: (panel) => set((state) => ({ ui: { ...state.ui, activePanel: panel } })),
  openExportModal: () => set((state) => ({ ui: { ...state.ui, isExportModalOpen: true } })),
  closeExportModal: () => set((state) => ({ ui: { ...state.ui, isExportModalOpen: false } })),
  setProcessing: (isProcessing, progress = 0, message = '') => {
    set((state) => ({
      ui: { ...state.ui, isProcessing, processingProgress: progress, processingMessage: message },
    }));
  },
  setMobileSidebarOpen: (isOpen) => set((state) => ({ ui: { ...state.ui, isMobileSidebarOpen: isOpen } })),
  
  // Export actions
  setExportSettings: (settings) => {
    set((state) => ({
      exportSettings: { ...state.exportSettings, ...settings },
    }));
  },
  
  // History actions (simplified - full implementation would need deep cloning)
  undo: () => {
    const state = get();
    if (state.history.past.length === 0) return;
    
    const previous = state.history.past[state.history.past.length - 1];
    const newPast = state.history.past.slice(0, -1);
    
    // Save current state to future
    const currentState = {
      mediaFiles: state.mediaFiles,
      tracks: state.tracks,
      textOverlays: state.textOverlays,
      transitions: state.transitions,
      filters: state.filters,
      projectDuration: state.projectDuration,
    };
    
    set({
      mediaFiles: previous.mediaFiles,
      tracks: previous.tracks,
      textOverlays: previous.textOverlays,
      transitions: previous.transitions,
      filters: previous.filters,
      projectDuration: previous.projectDuration ?? state.projectDuration,
      history: {
        past: newPast,
        future: [currentState, ...state.history.future],
      },
    });
    
    get().calculateProjectDuration();
  },
  
  redo: () => {
    const state = get();
    if (state.history.future.length === 0) return;
    
    const next = state.history.future[0];
    const newFuture = state.history.future.slice(1);
    
    // Save current state to past
    const currentState = {
      mediaFiles: state.mediaFiles,
      tracks: state.tracks,
      textOverlays: state.textOverlays,
      transitions: state.transitions,
      filters: state.filters,
      projectDuration: state.projectDuration,
    };
    
    set({
      mediaFiles: next.mediaFiles,
      tracks: next.tracks,
      textOverlays: next.textOverlays,
      transitions: next.transitions,
      filters: next.filters,
      projectDuration: next.projectDuration ?? state.projectDuration,
      history: {
        past: [...state.history.past, currentState],
        future: newFuture,
      },
    });
    
    get().calculateProjectDuration();
  },
  
  saveState: () => {
    const state = get();
    const snapshot = {
      mediaFiles: state.mediaFiles,
      tracks: state.tracks,
      textOverlays: state.textOverlays,
      transitions: state.transitions,
      filters: state.filters,
      projectDuration: state.projectDuration,
    };
    
    set((state) => ({
      history: {
        past: [...state.history.past, snapshot].slice(-50), // Keep last 50 states
        future: [], // Clear future when new action is taken
      },
    }));
  },
  
  // Utility actions
  calculateProjectDuration: () => {
    const tracks = get().tracks;
    let maxDuration = 0;
    
    tracks.forEach((track) => {
      track.clips.forEach((clip) => {
        const clipEnd = clip.startTime + (clip.duration - clip.trimStart - clip.trimEnd);
        if (clipEnd > maxDuration) {
          maxDuration = clipEnd;
        }
      });
    });
    
    // Also consider text overlays
    get().textOverlays.forEach((text) => {
      const textEnd = text.startTime + text.duration;
      if (textEnd > maxDuration) {
        maxDuration = textEnd;
      }
    });
    
    set({ projectDuration: maxDuration });
  },
  
  resetProject: () => {
    set({
      projectName: 'Nouveau Projet',
      mediaFiles: [],
      tracks: [
        { id: 'video-1', name: 'Video 1', type: 'video', clips: [], muted: false, locked: false, volume: 1 },
        { id: 'audio-1', name: 'Audio 1', type: 'audio', clips: [], muted: false, locked: false, volume: 1 },
      ],
      textOverlays: [],
      transitions: [],
      filters: {},
      projectDuration: 0,
      player: defaultPlayerState,
      ui: defaultUIState,
      history: { past: [], future: [] },
    });
  },
}), {
  name: 'editor-storage',
  storage: indexedDBStorage as any,
  // Disable JSON serialization because IndexedDB handles objects (including Files) natively
  partialize: (state) => ({
    // Only persist data fields, exclude functions/actions
    projectName: state.projectName,
    mediaFiles: state.mediaFiles,
    tracks: state.tracks,
    textOverlays: state.textOverlays,
    transitions: state.transitions,
    filters: state.filters,
    projectDuration: state.projectDuration,
    aspectRatio: state.aspectRatio,
    projects: state.projects,
    currentProjectId: state.currentProjectId,
    exportSettings: state.exportSettings,
    
    // Persist specific parts of player state
    player: {
      ...state.player,
      isPlaying: false,
      currentTime: 0, // Reset time on reload
    },
    
    // Persist specific parts of UI state
    ui: {
      ...state.ui,
      isProcessing: false,
      processingProgress: 0,
      processingMessage: '',
      isExportModalOpen: false,
      isMobileSidebarOpen: false,
    }
  }) as any,
  onRehydrateStorage: () => (state) => {
    if (!state) return;

    console.log('🔄 Rehydrating state from IndexedDB...');

    // Regenerate Blob URLs for active media files
    regenerateMediaBlobUrls(state.mediaFiles);

    // Update clip thumbnails in active project
    updateClipThumbnails(state.tracks, state.mediaFiles);

    // Migrate text overlays: assign trackId to any text overlays missing one
    const migrateTextOverlays = (textOverlays: any[], tracks: any[]) => {
      if (!textOverlays || textOverlays.length === 0) return;
      
      const orphanedTexts = textOverlays.filter((t: any) => !t.trackId);
      if (orphanedTexts.length === 0) return;
      
      // Find or create a text track
      let textTrack = tracks.find((t: any) => t.type === 'text');
      if (!textTrack) {
        textTrack = {
          id: uuidv4(),
          name: 'Texte 1',
          type: 'text',
          clips: [],
          muted: false,
          locked: false,
          volume: 1,
        };
        tracks.push(textTrack);
      }
      
      // Assign the text track ID to orphaned text overlays
      for (const text of orphanedTexts) {
        text.trackId = textTrack.id;
      }
      
      console.log(`📝 Migrated ${orphanedTexts.length} text overlay(s) to track "${textTrack.name}"`);
    };

    migrateTextOverlays(state.textOverlays, state.tracks);

    // Regenerate Blob URLs and update thumbnails for projects history
    for (const project of state.projects) {
      regenerateMediaBlobUrls(project.mediaFiles);
      updateClipThumbnails(project.tracks, project.mediaFiles);
      if (project.textOverlays) {
        migrateTextOverlays(project.textOverlays, project.tracks);
      }
    }

    console.log('✅ State rehydration complete');
  },
}));



