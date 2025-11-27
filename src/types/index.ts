// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// Media Types
export type MediaType = 'video' | 'audio' | 'image';

export interface MediaFile {
  id: string;
  name: string;
  type: MediaType;
  file: File;
  url: string;
  duration: number; // in seconds
  thumbnail?: string;
  width?: number;
  height?: number;
}

// Crop Settings
export interface CropSettings {
  x: number; // 0-100 percentage
  y: number; // 0-100 percentage
  width: number; // 0-100 percentage
  height: number; // 0-100 percentage
  locked: boolean; // aspect ratio locked
}

// Transform Settings for images/overlays
export interface TransformSettings {
  x: number; // 0-100 percentage (position)
  y: number; // 0-100 percentage (position)
  scale: number; // 0-200 percentage (size)
  scaleX?: number; // 0-200 percentage (horizontal scale)
  scaleY?: number; // 0-200 percentage (vertical scale)
  rotation: number; // -360 to 360 degrees
}

// Timeline Types
export interface TimelineClip {
  id: string;
  mediaId: string;
  trackId: string;
  startTime: number; // position on timeline in seconds
  duration: number; // clip duration in seconds
  trimStart: number; // trim from beginning in seconds
  trimEnd: number; // trim from end in seconds
  name: string;
  type: MediaType;
  thumbnail?: string;
  crop?: CropSettings; // crop settings for images/videos
  transform?: TransformSettings; // transform settings for images
  // Audio detachment properties
  audioMuted?: boolean; // true if audio was detached from this video clip
  detachedAudioClipId?: string; // ID of the detached audio clip
  linkedVideoClipId?: string; // For audio clips: ID of the original video clip
}

export interface TimelineTrack {
  id: string;
  name: string;
  type: 'video' | 'audio';
  clips: TimelineClip[];
  muted: boolean;
  locked: boolean;
}

// Text Overlay Types
export interface TextOverlay {
  id: string;
  text: string;
  x: number; // 0-100 percentage
  y: number; // 0-100 percentage
  fontSize: number;
  fontFamily: string;
  color: string;
  backgroundColor?: string;
  startTime: number;
  duration: number;
  bold: boolean;
  italic: boolean;
  scaleX?: number;
  scaleY?: number;
}

// Transition Types - Extended
export type TransitionType = 
  | 'none' 
  | 'fade' 
  | 'dissolve'
  | 'slide-left' 
  | 'slide-right' 
  | 'slide-up' 
  | 'slide-down'
  | 'slide-diagonal-tl' // top-left diagonal
  | 'slide-diagonal-tr' // top-right diagonal
  | 'wipe-left'
  | 'wipe-right'
  | 'wipe-up'
  | 'wipe-down'
  | 'zoom-in'
  | 'zoom-out'
  | 'rotate-in'
  | 'rotate-out'
  | 'circle-wipe'
  | 'diamond-wipe'
  | 'cross-dissolve';

export interface Transition {
  id: string;
  type: TransitionType;
  duration: number; // in seconds
  clipId: string; // applies to this clip
  position: 'start' | 'end'; // applies to start or end of clip
}

// Filter/Effect Types
export interface VideoFilter {
  id: string;
  name: string;
  brightness: number; // -100 to 100
  contrast: number; // -100 to 100
  saturation: number; // -100 to 100
  grayscale: boolean;
  sepia: boolean;
  blur: number; // 0 to 20
}

// Export Types
export type ExportResolution = '720p' | '1080p' | '4K';
export type ExportFormat = 'mp4' | 'webm';
export type ExportQuality = 'low' | 'medium' | 'high';
export type ExportFPS = '30' | '60' | '120';

export interface ExportSettings {
  resolution: ExportResolution;
  format: ExportFormat;
  quality: ExportQuality;
  fps: ExportFPS;
  filename: string;
}

// Project Types
export interface Project {
  id: string;
  name: string;
  createdAt: Date;
  modifiedAt: Date;
  mediaFiles: MediaFile[];
  tracks: TimelineTrack[];
  textOverlays: TextOverlay[];
  transitions: Transition[];
  filters: { [clipId: string]: VideoFilter };
  duration: number; // total project duration
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '21:9';
}

// Player State
export interface PlayerState {
  isPlaying: boolean;
  currentTime: number;
  volume: number;
  isMuted: boolean;
  isFullscreen: boolean;
  playbackRate: number;
}

// UI State
export interface UIState {
  selectedClipId: string | null;
  selectedTrackId: string | null;
  selectedTextId: string | null;
  timelineZoom: number; // 1 = 100%
  timelineScrollX: number;
  activePanel: 'media' | 'text' | 'transitions' | 'filters' | 'audio';
  isExportModalOpen: boolean;
  isProcessing: boolean;
  processingProgress: number;
  processingMessage: string;
}

// Resolution presets
export const RESOLUTION_PRESETS = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '4K': { width: 3840, height: 2160 },
} as const;

// Available transitions with descriptions and preview info
export const AVAILABLE_TRANSITIONS: { type: TransitionType; name: string; description: string; category: string }[] = [
  { type: 'none', name: 'Aucune', description: 'Pas de transition', category: 'basic' },
  { type: 'fade', name: 'Fondu', description: 'Fondu progressif', category: 'basic' },
  { type: 'dissolve', name: 'Dissolution', description: 'Dissolution douce', category: 'basic' },
  { type: 'cross-dissolve', name: 'Fondu croisé', description: 'Mélange progressif', category: 'basic' },
  { type: 'slide-left', name: 'Glissement gauche', description: 'Glisse vers la gauche', category: 'slide' },
  { type: 'slide-right', name: 'Glissement droite', description: 'Glisse vers la droite', category: 'slide' },
  { type: 'slide-up', name: 'Glissement haut', description: 'Glisse vers le haut', category: 'slide' },
  { type: 'slide-down', name: 'Glissement bas', description: 'Glisse vers le bas', category: 'slide' },
  { type: 'slide-diagonal-tl', name: 'Glissement diagonal ↖', description: 'Glisse en diagonale haut-gauche', category: 'slide' },
  { type: 'slide-diagonal-tr', name: 'Glissement diagonal ↗', description: 'Glisse en diagonale haut-droite', category: 'slide' },
  { type: 'wipe-left', name: 'Balayage gauche', description: 'Balayage vers la gauche', category: 'wipe' },
  { type: 'wipe-right', name: 'Balayage droite', description: 'Balayage vers la droite', category: 'wipe' },
  { type: 'wipe-up', name: 'Balayage haut', description: 'Balayage vers le haut', category: 'wipe' },
  { type: 'wipe-down', name: 'Balayage bas', description: 'Balayage vers le bas', category: 'wipe' },
  { type: 'zoom-in', name: 'Zoom avant', description: 'Zoom progressif avant', category: 'zoom' },
  { type: 'zoom-out', name: 'Zoom arrière', description: 'Zoom progressif arrière', category: 'zoom' },
  { type: 'rotate-in', name: 'Rotation entrée', description: 'Rotation en entrant', category: 'rotate' },
  { type: 'rotate-out', name: 'Rotation sortie', description: 'Rotation en sortant', category: 'rotate' },
  { type: 'circle-wipe', name: 'Balayage circulaire', description: 'Révélation circulaire', category: 'shape' },
  { type: 'diamond-wipe', name: 'Balayage losange', description: 'Révélation en losange', category: 'shape' },
];

// Default filter values
export const DEFAULT_FILTER: VideoFilter = {
  id: '',
  name: 'Normal',
  brightness: 0,
  contrast: 0,
  saturation: 0,
  grayscale: false,
  sepia: false,
  blur: 0,
};
