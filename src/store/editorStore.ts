// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { create } from 'zustand';
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
} from '../types';
import { DEFAULT_FILTER } from '../types';

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
  removeMediaFile: (id: string) => void;
  detachAudioFromVideo: (videoClipId: string) => void;
  
  // Track actions
  addTrack: (type: 'video' | 'audio') => void;
  removeTrack: (id: string) => void;
  toggleTrackMute: (id: string) => void;
  toggleTrackLock: (id: string) => void;
  
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
};

const defaultExportSettings: ExportSettings = {
  resolution: '1080p',
  format: 'mp4',
  quality: 'high',
  fps: '30',
  filename: 'video-export',
};

const initialProjectId = uuidv4();

export const useEditorStore = create<EditorState>((set, get) => ({
  // Initial state
  projectName: 'Nouveau Projet',
  mediaFiles: [],
  tracks: [
    { id: 'video-1', name: 'Video 1', type: 'video', clips: [], muted: false, locked: false },
    { id: 'images-1', name: 'Images', type: 'video', clips: [], muted: false, locked: false },
    { id: 'audio-1', name: 'Audio 1', type: 'audio', clips: [], muted: false, locked: false },
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
      { id: 'video-1', name: 'Video 1', type: 'video', clips: [], muted: false, locked: false },
      { id: 'images-1', name: 'Images', type: 'video', clips: [], muted: false, locked: false },
      { id: 'audio-1', name: 'Audio 1', type: 'audio', clips: [], muted: false, locked: false },
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
        { id: 'video-1', name: 'Video 1', type: 'video', clips: [], muted: false, locked: false },
        { id: 'images-1', name: 'Images', type: 'video', clips: [], muted: false, locked: false },
        { id: 'audio-1', name: 'Audio 1', type: 'audio', clips: [], muted: false, locked: false },
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
    
    set((state) => ({
      tracks: state.tracks.map((track) => {
        // Add audio clip to audio track
        if (track.id === audioTrack!.id) {
          console.log('🎵 Adding audio clip to track:', audioTrack!.id);
          return { ...track, clips: [...track.clips, audioClip] };
        }
        // Keep the video clip's audio playing (NOT muted yet)
        // The video will only be muted when the detached audio clip is deleted
        return {
          ...track,
          clips: track.clips.map(clip => {
            if (clip.id === videoClipId) {
              console.log('🔊 Video clip keeps audio (detached audio is a copy):', {
                clipId: clip.id,
                audioMuted: false,
                detachedAudioClipId: audioClipId
              });
              // Store the link but DON'T mute yet - video keeps its audio
              return { ...clip, audioMuted: false, detachedAudioClipId: audioClipId };
            }
            return clip;
          }),
        };
      }),
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
  addTrack: (type) => {
    const trackCount = get().tracks.filter((t) => t.type === type).length;
    const newTrack: TimelineTrack = {
      id: uuidv4(),
      name: `${type === 'video' ? 'Video' : 'Audio'} ${trackCount + 1}`,
      type,
      clips: [],
      muted: false,
      locked: false,
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
    
    set((state) => ({
      tracks: state.tracks
        // Remove the track
        .filter((t) => t.id !== id)
        // Process remaining tracks
        .map((track) => ({
          ...track,
          clips: track.clips
            // Remove any detached audio clips that were linked to video clips in the removed track
            .filter((c) => !detachedAudioClipIds.includes(c.id))
            // Mute video clips if their detached audio track is being removed
            .map((c) => {
              if (linkedVideoClipIds.includes(c.id)) {
                console.log('🔇 Muting video clip (audio track removed):', c.id);
                return { ...c, audioMuted: true, detachedAudioClipId: undefined };
              }
              return c;
            }),
        })),
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
          ? { ...track, clips: [...track.clips, newClip] }
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
      set((state) => ({
        tracks: state.tracks.map((track) => ({
          ...track,
          clips: track.clips.filter((c) => c.id !== clipId),
        })),
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
    
    // First pass: Remove the clip and update linked clips
    set((state) => {
      const newTracks = state.tracks.map((track) => ({
        ...track,
        clips: track.clips
          // Remove the clip being deleted
          .filter((c) => c.id !== clipId)
          // Update linked clips
          .map((c) => {
            // If we're removing a detached audio clip, NOW mute the video
            // The video was playing audio until now, but since the detached audio is deleted,
            // the video should become muted
            if (linkedVideoClipId && c.id === linkedVideoClipId) {
              console.log('🔇 Muting video clip after audio deletion:', linkedVideoClipId);
              return { ...c, audioMuted: true, detachedAudioClipId: undefined };
            }
            // If we're removing a video clip, check if any audio clip is linked to it
            // and clear the link (the audio clip will be removed in second pass)
            if (detachedAudioClipId && c.id === detachedAudioClipId) {
              // This audio clip will be removed in the second pass
              return c;
            }
            return c;
          }),
      }));
      
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
      set((state) => ({
        tracks: state.tracks.map((track) => ({
          ...track,
          clips: track.clips.filter((c) => c.id !== detachedAudioClipId),
        })),
      }));
    }
    
    // Third pass: If we removed an audio clip, find any video clip that references it
    // and mute it (since the detached audio is now gone)
    if (clipToRemove.type === 'audio') {
      set((state) => ({
        tracks: state.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((c) => {
            // Check if this video clip's detachedAudioClipId matches the removed audio clip
            if (c.detachedAudioClipId === clipId) {
              console.log('🔇 Muting video clip (by detachedAudioClipId):', c.id);
              return { ...c, audioMuted: true, detachedAudioClipId: undefined };
            }
            return c;
          }),
        })),
      }));
    }
    
    get().calculateProjectDuration();
  },
  
  updateClip: (clipId, updates, skipHistory = false) => {
    if (!skipHistory) get().saveState(); // Save state before action
    
    set((state) => ({
      tracks: state.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.id === clipId ? { ...clip, ...updates } : clip
        ),
      })),
    }));
    get().calculateProjectDuration();
  },
  
  moveClip: (clipId, newTrackId, newStartTime) => {
    get().saveState(); // Save state before action
    
    set((state) => {
      let clipToMove: TimelineClip | null = null;
      
      // Find and remove the clip from its current track
      const tracksWithoutClip = state.tracks.map((track) => {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
          clipToMove = { ...clip, trackId: newTrackId, startTime: Math.max(0, newStartTime) };
        }
        return {
          ...track,
          clips: track.clips.filter((c) => c.id !== clipId),
        };
      });
      
      // Add the clip to the new track
      if (clipToMove) {
        return {
          tracks: tracksWithoutClip.map((track) =>
            track.id === newTrackId
              ? { ...track, clips: [...track.clips, clipToMove!] }
              : track
          ),
        };
      }
      
      return state;
    });
    get().calculateProjectDuration();
  },
  
  splitClip: (clipId, splitTime) => {
    get().saveState(); // Save state before action
    
    set((state) => {
      const newTracks = state.tracks.map((track) => {
        const clipIndex = track.clips.findIndex((c) => c.id === clipId);
        if (clipIndex === -1) return track;
        
        const clip = track.clips[clipIndex];
        const clipStart = clip.startTime;
        const clipEnd = clip.startTime + (clip.duration - clip.trimStart - clip.trimEnd);
        
        // Check if split time is within the clip
        if (splitTime <= clipStart || splitTime >= clipEnd) return track;
        
        const splitPoint = splitTime - clipStart + clip.trimStart;
        
        // Create two new clips
        const firstClip: TimelineClip = {
          ...clip,
          trimEnd: clip.duration - splitPoint,
        };
        
        const secondClip: TimelineClip = {
          ...clip,
          id: uuidv4(),
          startTime: splitTime,
          trimStart: splitPoint,
        };
        
        const newClips = [...track.clips];
        newClips.splice(clipIndex, 1, firstClip, secondClip);
        
        return { ...track, clips: newClips };
      });
      
      return { tracks: newTracks };
    });
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
    
    const newText: TextOverlay = {
      id: uuidv4(),
      text: text.text || 'Nouveau texte',
      x: text.x ?? 50,
      y: text.y ?? 50,
      fontSize: text.fontSize ?? 32,
      fontFamily: text.fontFamily ?? 'Inter',
      color: text.color ?? '#FFFFFF',
      backgroundColor: text.backgroundColor,
      startTime: text.startTime ?? get().player.currentTime,
      duration: text.duration ?? 5,
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
        { id: 'video-1', name: 'Video 1', type: 'video', clips: [], muted: false, locked: false },
        { id: 'audio-1', name: 'Audio 1', type: 'audio', clips: [], muted: false, locked: false },
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
}));
