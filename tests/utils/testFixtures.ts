// Test utilities for export testing
// Provides mock data generators for various export scenarios

import type { 
  MediaFile, 
  TimelineClip, 
  TimelineTrack, 
  TextOverlay, 
  Transition,
  VideoFilter,
  ExportSettings,
  AspectRatio,
  ExportResolution,
  ExportFormat,
  ExportQuality
} from '../../src/types';

/**
 * Generate a unique ID for test fixtures
 */
export function generateId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a mock video file
 */
export function createMockVideoFile(name: string = 'test-video.mp4'): File {
  const content = 'mock-video-content';
  return new File([content], name, { type: 'video/mp4' });
}

/**
 * Create a mock audio file
 */
export function createMockAudioFile(name: string = 'test-audio.mp3'): File {
  const content = 'mock-audio-content';
  return new File([content], name, { type: 'audio/mpeg' });
}

/**
 * Create a mock image file
 */
export function createMockImageFile(name: string = 'test-image.jpg'): File {
  const content = 'mock-image-content';
  const type = name.endsWith('.png') ? 'image/png' 
    : name.endsWith('.webp') ? 'image/webp'
    : name.endsWith('.gif') ? 'image/gif'
    : 'image/jpeg';
  return new File([content], name, { type });
}

/**
 * Create a mock media file
 */
export function createMockMediaFile(
  type: 'video' | 'audio' | 'image',
  name: string,
  duration: number = 5,
  width?: number,
  height?: number
): MediaFile {
  let file: File;
  switch (type) {
    case 'video':
      file = createMockVideoFile(name);
      break;
    case 'audio':
      file = createMockAudioFile(name);
      break;
    case 'image':
      file = createMockImageFile(name);
      break;
  }

  return {
    id: generateId(),
    name,
    type,
    file,
    url: URL.createObjectURL(file),
    duration,
    width,
    height,
    thumbnail: undefined,
  };
}

/**
 * Create a mock timeline clip
 */
export function createMockClip(
  mediaId: string,
  trackId: string,
  startTime: number,
  duration: number,
  type: 'video' | 'audio' | 'image',
  trimStart: number = 0,
  trimEnd: number = 0
): TimelineClip {
  return {
    id: generateId(),
    mediaId,
    trackId,
    startTime,
    duration,
    trimStart,
    trimEnd,
    name: `Clip ${mediaId}`,
    type,
  };
}

/**
 * Create a mock timeline track
 */
export function createMockTrack(
  type: 'video' | 'audio',
  clips: TimelineClip[] = [],
  muted: boolean = false,
  locked: boolean = false
): TimelineTrack {
  return {
    id: generateId(),
    name: type === 'video' ? 'Video' : 'Audio',
    type,
    clips,
    muted,
    locked,
  };
}

/**
 * Create a mock text overlay
 */
export function createMockTextOverlay(
  text: string = 'Test Text',
  startTime: number = 0,
  duration: number = 5
): TextOverlay {
  return {
    id: generateId(),
    text,
    x: 50,
    y: 50,
    fontSize: 24,
    fontFamily: 'Roboto',
    color: '#FFFFFF',
    startTime,
    duration,
    bold: false,
    italic: false,
  };
}

/**
 * Create a mock transition
 */
export function createMockTransition(
  clipId: string,
  type: Transition['type'] = 'fade',
  position: 'start' | 'end' = 'start',
  duration: number = 1
): Transition {
  return {
    id: generateId(),
    type,
    clipId,
    position,
    duration,
  };
}

/**
 * Create a mock video filter
 */
export function createMockFilter(): VideoFilter {
  return {
    id: generateId(),
    name: 'Custom Filter',
    brightness: 0,
    contrast: 0,
    saturation: 0,
    grayscale: false,
    sepia: false,
    blur: 0,
  };
}

/**
 * Create mock export settings
 */
export function createMockExportSettings(
  resolution: ExportResolution = '1080p',
  format: ExportFormat = 'mp4',
  quality: ExportQuality = 'medium',
  filename: string = 'export'
): ExportSettings {
  return {
    resolution,
    format,
    quality,
    fps: '30',
    filename,
  };
}

/**
 * Create multiple video clips for testing
 */
export function createMultipleVideoClips(
  mediaFiles: MediaFile[],
  trackId: string,
  startTime: number = 0
): TimelineClip[] {
  return mediaFiles.map((media, index) => {
    const clipStartTime = startTime + index * media.duration;
    return createMockClip(
      media.id,
      trackId,
      clipStartTime,
      media.duration,
      'video'
    );
  });
}

/**
 * Create multiple audio clips for testing
 */
export function createMultipleAudioClips(
  mediaFiles: MediaFile[],
  trackId: string,
  startTime: number = 0
): TimelineClip[] {
  return mediaFiles.map((media, index) => {
    const clipStartTime = startTime + index * media.duration;
    return createMockClip(
      media.id,
      trackId,
      clipStartTime,
      media.duration,
      'audio'
    );
  });
}

/**
 * Test case configuration for export scenarios
 */
export interface ExportTestCase {
  name: string;
  description: string;
  mediaFiles: MediaFile[];
  videoTracks: TimelineTrack[];
  audioTracks: TimelineTrack[];
  textOverlays: TextOverlay[];
  transitions: Transition[];
  filters: { [clipId: string]: VideoFilter };
  exportSettings: ExportSettings;
  aspectRatio: AspectRatio;
  expectedClipsCount: number;
  expectedAudiosCount: number;
}
// Provides mock data generators for various export scenarios

import type { 
  MediaFile, 
  TimelineClip, 
  TimelineTrack, 
  TextOverlay, 
  Transition,
  VideoFilter,
  ExportSettings,
  AspectRatio,
  ExportResolution,
  ExportFormat,
  ExportQuality
} from '../../src/types';

/**
 * Generate a unique ID for test fixtures
 */
export function generateId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a mock video file
 */
export function createMockVideoFile(name: string = 'test-video.mp4'): File {
  const content = 'mock-video-content';
  return new File([content], name, { type: 'video/mp4' });
}

/**
 * Create a mock audio file
 */
export function createMockAudioFile(name: string = 'test-audio.mp3'): File {
  const content = 'mock-audio-content';
  return new File([content], name, { type: 'audio/mpeg' });
}

/**
 * Create a mock image file
 */
export function createMockImageFile(name: string = 'test-image.jpg'): File {
  const content = 'mock-image-content';
  const type = name.endsWith('.png') ? 'image/png' 
    : name.endsWith('.webp') ? 'image/webp'
    : name.endsWith('.gif') ? 'image/gif'
    : 'image/jpeg';
  return new File([content], name, { type });
}

/**
 * Create a mock media file
 */
export function createMockMediaFile(
  type: 'video' | 'audio' | 'image',
  name: string,
  duration: number = 5,
  width?: number,
  height?: number
): MediaFile {
  let file: File;
  switch (type) {
    case 'video':
      file = createMockVideoFile(name);
      break;
    case 'audio':
      file = createMockAudioFile(name);
      break;
    case 'image':
      file = createMockImageFile(name);
      break;
  }

  return {
    id: generateId(),
    name,
    type,
    file,
    url: URL.createObjectURL(file),
    duration,
    width,
    height,
    thumbnail: undefined,
  };
}

/**
 * Create a mock timeline clip
 */
export function createMockClip(
  mediaId: string,
  trackId: string,
  startTime: number,
  duration: number,
  type: 'video' | 'audio' | 'image',
  trimStart: number = 0,
  trimEnd: number = 0
): TimelineClip {
  return {
    id: generateId(),
    mediaId,
    trackId,
    startTime,
    duration,
    trimStart,
    trimEnd,
    name: `Clip ${mediaId}`,
    type,
  };
}

/**
 * Create a mock timeline track
 */
export function createMockTrack(
  type: 'video' | 'audio',
  clips: TimelineClip[] = [],
  muted: boolean = false,
  locked: boolean = false
): TimelineTrack {
  return {
    id: generateId(),
    name: type === 'video' ? 'Video' : 'Audio',
    type,
    clips,
    muted,
    locked,
  };
}

/**
 * Create a mock text overlay
 */
export function createMockTextOverlay(
  text: string = 'Test Text',
  startTime: number = 0,
  duration: number = 5
): TextOverlay {
  return {
    id: generateId(),
    text,
    x: 50,
    y: 50,
    fontSize: 24,
    fontFamily: 'Roboto',
    color: '#FFFFFF',
    startTime,
    duration,
    bold: false,
    italic: false,
  };
}

/**
 * Create a mock transition
 */
export function createMockTransition(
  clipId: string,
  type: Transition['type'] = 'fade',
  position: 'start' | 'end' = 'start',
  duration: number = 1
): Transition {
  return {
    id: generateId(),
    type,
    clipId,
    position,
    duration,
  };
}

/**
 * Create a mock video filter
 */
export function createMockFilter(): VideoFilter {
  return {
    id: generateId(),
    name: 'Custom Filter',
    brightness: 0,
    contrast: 0,
    saturation: 0,
    grayscale: false,
    sepia: false,
    blur: 0,
  };
}

/**
 * Create mock export settings
 */
export function createMockExportSettings(
  resolution: ExportResolution = '1080p',
  format: ExportFormat = 'mp4',
  quality: ExportQuality = 'medium',
  filename: string = 'export'
): ExportSettings {
  return {
    resolution,
    format,
    quality,
    fps: '30',
    filename,
  };
}

/**
 * Create multiple video clips for testing
 */
export function createMultipleVideoClips(
  mediaFiles: MediaFile[],
  trackId: string,
  startTime: number = 0
): TimelineClip[] {
  return mediaFiles.map((media, index) => {
    const clipStartTime = startTime + index * media.duration;
    return createMockClip(
      media.id,
      trackId,
      clipStartTime,
      media.duration,
      'video'
    );
  });
}

/**
 * Create multiple audio clips for testing
 */
export function createMultipleAudioClips(
  mediaFiles: MediaFile[],
  trackId: string,
  startTime: number = 0
): TimelineClip[] {
  return mediaFiles.map((media, index) => {
    const clipStartTime = startTime + index * media.duration;
    return createMockClip(
      media.id,
      trackId,
      clipStartTime,
      media.duration,
      'audio'
    );
  });
}

/**
 * Test case configuration for export scenarios
 */
export interface ExportTestCase {
  name: string;
  description: string;
  mediaFiles: MediaFile[];
  videoTracks: TimelineTrack[];
  audioTracks: TimelineTrack[];
  textOverlays: TextOverlay[];
  transitions: Transition[];
  filters: { [clipId: string]: VideoFilter };
  exportSettings: ExportSettings;
  aspectRatio: AspectRatio;
  expectedClipsCount: number;
  expectedAudiosCount: number;
}

