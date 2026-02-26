// Unit tests for export utilities
import { describe, it, expect } from 'vitest';
import { 
  generateId, 
  createMockVideoFile, 
  createMockAudioFile, 
  createMockImageFile,
  createMockMediaFile,
  createMockClip,
  createMockTrack,
  createMockTextOverlay,
  createMockTransition,
  createMockFilter,
  createMockExportSettings,
  createMultipleVideoClips,
  createMultipleAudioClips
} from '../utils/testFixtures';

describe('Export Test Fixtures', () => {
  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).not.toBe(id2);
    });

    it('should start with test- prefix', () => {
      const id = generateId();
      expect(id.startsWith('test-')).toBe(true);
    });
  });

  describe('createMockVideoFile', () => {
    it('should create a video file with correct MIME type', () => {
      const file = createMockVideoFile('test.mp4');
      expect(file.type).toBe('video/mp4');
    });

    it('should use default name when not provided', () => {
      const file = createMockVideoFile();
      expect(file.name).toBe('test-video.mp4');
    });
  });

  describe('createMockAudioFile', () => {
    it('should create an audio file with correct MIME type', () => {
      const file = createMockAudioFile('test.mp3');
      expect(file.type).toBe('audio/mpeg');
    });
  });

  describe('createMockImageFile', () => {
    it('should create an image file with correct MIME type for JPG', () => {
      const file = createMockImageFile('image.jpg');
      expect(file.type).toBe('image/jpeg');
    });

    it('should create an image file with correct MIME type for PNG', () => {
      const file = createMockImageFile('image.png');
      expect(file.type).toBe('image/png');
    });

    it('should create an image file with correct MIME type for WebP', () => {
      const file = createMockImageFile('image.webp');
      expect(file.type).toBe('image/webp');
    });

    it('should create an image file with correct MIME type for GIF', () => {
      const file = createMockImageFile('image.gif');
      expect(file.type).toBe('image/gif');
    });
  });

  describe('createMockMediaFile', () => {
    it('should create a video media file', () => {
      const media = createMockMediaFile('video', 'test.mp4', 10, 1920, 1080);
      
      expect(media.type).toBe('video');
      expect(media.duration).toBe(10);
      expect(media.width).toBe(1920);
      expect(media.height).toBe(1080);
      expect(media.id).toBeDefined();
      expect(media.url).toBeDefined();
    });

    it('should create an audio media file', () => {
      const media = createMockMediaFile('audio', 'test.mp3', 30);
      
      expect(media.type).toBe('audio');
      expect(media.duration).toBe(30);
    });

    it('should create an image media file', () => {
      const media = createMockMediaFile('image', 'photo.jpg', 5, 3840, 2160);
      
      expect(media.type).toBe('image');
      expect(media.duration).toBe(5);
      expect(media.width).toBe(3840);
      expect(media.height).toBe(2160);
    });

    it('should use default duration when not provided', () => {
      const media = createMockMediaFile('video', 'test.mp4');
      expect(media.duration).toBe(5);
    });
  });

  describe('createMockClip', () => {
    it('should create a video clip', () => {
      const clip = createMockClip('media-1', 'track-1', 0, 10, 'video');
      
      expect(clip.mediaId).toBe('media-1');
      expect(clip.trackId).toBe('track-1');
      expect(clip.startTime).toBe(0);
      expect(clip.duration).toBe(10);
      expect(clip.type).toBe('video');
      expect(clip.trimStart).toBe(0);
      expect(clip.trimEnd).toBe(0);
    });

    it('should create a clip with trim settings', () => {
      const clip = createMockClip('media-1', 'track-1', 5, 10, 'video', 1, 2);
      
      expect(clip.trimStart).toBe(1);
      expect(clip.trimEnd).toBe(2);
    });

    it('should create an audio clip', () => {
      const clip = createMockClip('media-1', 'track-1', 0, 30, 'audio');
      expect(clip.type).toBe('audio');
    });
  });

  describe('createMockTrack', () => {
    it('should create a video track', () => {
      const track = createMockTrack('video');
      
      expect(track.type).toBe('video');
      expect(track.muted).toBe(false);
      expect(track.locked).toBe(false);
      expect(track.clips).toEqual([]);
    });

    it('should create a track with clips', () => {
      const clips = [
        createMockClip('media-1', 'track-1', 0, 10, 'video'),
        createMockClip('media-2', 'track-1', 10, 10, 'video'),
      ];
      const track = createMockTrack('video', clips);
      
      expect(track.clips).toHaveLength(2);
    });

    it('should create an audio track', () => {
      const track = createMockTrack('audio');
      expect(track.type).toBe('audio');
    });

    it('should create a muted track', () => {
      const track = createMockTrack('video', [], true);
      expect(track.muted).toBe(true);
    });
  });

  describe('createMockTextOverlay', () => {
    it('should create a text overlay with default values', () => {
      const text = createMockTextOverlay();
      
      expect(text.text).toBe('Test Text');
      expect(text.x).toBe(50);
      expect(text.y).toBe(50);
      expect(text.fontSize).toBe(24);
      expect(text.color).toBe('#FFFFFF');
      expect(text.startTime).toBe(0);
      expect(text.duration).toBe(5);
      expect(text.bold).toBe(false);
      expect(text.italic).toBe(false);
    });

    it('should create a text overlay with custom values', () => {
      const text = createMockTextOverlay('Custom Text', 10, 20);
      
      expect(text.text).toBe('Custom Text');
      expect(text.startTime).toBe(10);
      expect(text.duration).toBe(20);
    });
  });

  describe('createMockTransition', () => {
    it('should create a fade transition with default values', () => {
      const transition = createMockTransition('clip-1');
      
      expect(transition.clipId).toBe('clip-1');
      expect(transition.type).toBe('fade');
      expect(transition.position).toBe('start');
      expect(transition.duration).toBe(1);
    });

    it('should create a transition with custom values', () => {
      const transition = createMockTransition('clip-1', 'slide-left', 'end', 2);
      
      expect(transition.type).toBe('slide-left');
      expect(transition.position).toBe('end');
      expect(transition.duration).toBe(2);
    });
  });

  describe('createMockFilter', () => {
    it('should create a filter with default values', () => {
      const filter = createMockFilter();
      
      expect(filter.brightness).toBe(0);
      expect(filter.contrast).toBe(0);
      expect(filter.saturation).toBe(0);
      expect(filter.grayscale).toBe(false);
      expect(filter.sepia).toBe(false);
      expect(filter.blur).toBe(0);
    });
  });

  describe('createMockExportSettings', () => {
    it('should create export settings with default values', () => {
      const settings = createMockExportSettings();
      
      expect(settings.resolution).toBe('1080p');
      expect(settings.format).toBe('mp4');
      expect(settings.quality).toBe('medium');
      expect(settings.fps).toBe('30');
      expect(settings.filename).toBe('export');
    });

    it('should create export settings with custom values', () => {
      const settings = createMockExportSettings('4K', 'webm', 'high', 'my-video');
      
      expect(settings.resolution).toBe('4K');
      expect(settings.format).toBe('webm');
      expect(settings.quality).toBe('high');
      expect(settings.filename).toBe('my-video');
    });
  });

  describe('createMultipleVideoClips', () => {
    it('should create multiple video clips', () => {
      const mediaFiles = [
        createMockMediaFile('video', 'video1.mp4', 10),
        createMockMediaFile('video', 'video2.mp4', 15),
        createMockMediaFile('video', 'video3.mp4', 20),
      ];
      const trackId = 'video-track';
      
      const clips = createMultipleVideoClips(mediaFiles, trackId);
      
      expect(clips).toHaveLength(3);
      expect(clips[0].startTime).toBe(0);
      expect(clips[1].startTime).toBe(10);
      expect(clips[2].startTime).toBe(25);
    });

    it('should start from custom start time', () => {
      const mediaFiles = [
        createMockMediaFile('video', 'video1.mp4', 10),
      ];
      const trackId = 'video-track';
      
      const clips = createMultipleVideoClips(mediaFiles, trackId, 5);
      
      expect(clips[0].startTime).toBe(5);
    });
  });

  describe('createMultipleAudioClips', () => {
    it('should create multiple audio clips', () => {
      const mediaFiles = [
        createMockMediaFile('audio', 'audio1.mp3', 30),
        createMockMediaFile('audio', 'audio2.mp3', 45),
      ];
      const trackId = 'audio-track';
      
      const clips = createMultipleAudioClips(mediaFiles, trackId);
      
      expect(clips).toHaveLength(2);
      expect(clips[0].type).toBe('audio');
      expect(clips[1].type).toBe('audio');
    });
  });
});
import { describe, it, expect } from 'vitest';
import { 
  generateId, 
  createMockVideoFile, 
  createMockAudioFile, 
  createMockImageFile,
  createMockMediaFile,
  createMockClip,
  createMockTrack,
  createMockTextOverlay,
  createMockTransition,
  createMockFilter,
  createMockExportSettings,
  createMultipleVideoClips,
  createMultipleAudioClips
} from '../utils/testFixtures';

describe('Export Test Fixtures', () => {
  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).not.toBe(id2);
    });

    it('should start with test- prefix', () => {
      const id = generateId();
      expect(id.startsWith('test-')).toBe(true);
    });
  });

  describe('createMockVideoFile', () => {
    it('should create a video file with correct MIME type', () => {
      const file = createMockVideoFile('test.mp4');
      expect(file.type).toBe('video/mp4');
    });

    it('should use default name when not provided', () => {
      const file = createMockVideoFile();
      expect(file.name).toBe('test-video.mp4');
    });
  });

  describe('createMockAudioFile', () => {
    it('should create an audio file with correct MIME type', () => {
      const file = createMockAudioFile('test.mp3');
      expect(file.type).toBe('audio/mpeg');
    });
  });

  describe('createMockImageFile', () => {
    it('should create an image file with correct MIME type for JPG', () => {
      const file = createMockImageFile('image.jpg');
      expect(file.type).toBe('image/jpeg');
    });

    it('should create an image file with correct MIME type for PNG', () => {
      const file = createMockImageFile('image.png');
      expect(file.type).toBe('image/png');
    });

    it('should create an image file with correct MIME type for WebP', () => {
      const file = createMockImageFile('image.webp');
      expect(file.type).toBe('image/webp');
    });

    it('should create an image file with correct MIME type for GIF', () => {
      const file = createMockImageFile('image.gif');
      expect(file.type).toBe('image/gif');
    });
  });

  describe('createMockMediaFile', () => {
    it('should create a video media file', () => {
      const media = createMockMediaFile('video', 'test.mp4', 10, 1920, 1080);
      
      expect(media.type).toBe('video');
      expect(media.duration).toBe(10);
      expect(media.width).toBe(1920);
      expect(media.height).toBe(1080);
      expect(media.id).toBeDefined();
      expect(media.url).toBeDefined();
    });

    it('should create an audio media file', () => {
      const media = createMockMediaFile('audio', 'test.mp3', 30);
      
      expect(media.type).toBe('audio');
      expect(media.duration).toBe(30);
    });

    it('should create an image media file', () => {
      const media = createMockMediaFile('image', 'photo.jpg', 5, 3840, 2160);
      
      expect(media.type).toBe('image');
      expect(media.duration).toBe(5);
      expect(media.width).toBe(3840);
      expect(media.height).toBe(2160);
    });

    it('should use default duration when not provided', () => {
      const media = createMockMediaFile('video', 'test.mp4');
      expect(media.duration).toBe(5);
    });
  });

  describe('createMockClip', () => {
    it('should create a video clip', () => {
      const clip = createMockClip('media-1', 'track-1', 0, 10, 'video');
      
      expect(clip.mediaId).toBe('media-1');
      expect(clip.trackId).toBe('track-1');
      expect(clip.startTime).toBe(0);
      expect(clip.duration).toBe(10);
      expect(clip.type).toBe('video');
      expect(clip.trimStart).toBe(0);
      expect(clip.trimEnd).toBe(0);
    });

    it('should create a clip with trim settings', () => {
      const clip = createMockClip('media-1', 'track-1', 5, 10, 'video', 1, 2);
      
      expect(clip.trimStart).toBe(1);
      expect(clip.trimEnd).toBe(2);
    });

    it('should create an audio clip', () => {
      const clip = createMockClip('media-1', 'track-1', 0, 30, 'audio');
      expect(clip.type).toBe('audio');
    });
  });

  describe('createMockTrack', () => {
    it('should create a video track', () => {
      const track = createMockTrack('video');
      
      expect(track.type).toBe('video');
      expect(track.muted).toBe(false);
      expect(track.locked).toBe(false);
      expect(track.clips).toEqual([]);
    });

    it('should create a track with clips', () => {
      const clips = [
        createMockClip('media-1', 'track-1', 0, 10, 'video'),
        createMockClip('media-2', 'track-1', 10, 10, 'video'),
      ];
      const track = createMockTrack('video', clips);
      
      expect(track.clips).toHaveLength(2);
    });

    it('should create an audio track', () => {
      const track = createMockTrack('audio');
      expect(track.type).toBe('audio');
    });

    it('should create a muted track', () => {
      const track = createMockTrack('video', [], true);
      expect(track.muted).toBe(true);
    });
  });

  describe('createMockTextOverlay', () => {
    it('should create a text overlay with default values', () => {
      const text = createMockTextOverlay();
      
      expect(text.text).toBe('Test Text');
      expect(text.x).toBe(50);
      expect(text.y).toBe(50);
      expect(text.fontSize).toBe(24);
      expect(text.color).toBe('#FFFFFF');
      expect(text.startTime).toBe(0);
      expect(text.duration).toBe(5);
      expect(text.bold).toBe(false);
      expect(text.italic).toBe(false);
    });

    it('should create a text overlay with custom values', () => {
      const text = createMockTextOverlay('Custom Text', 10, 20);
      
      expect(text.text).toBe('Custom Text');
      expect(text.startTime).toBe(10);
      expect(text.duration).toBe(20);
    });
  });

  describe('createMockTransition', () => {
    it('should create a fade transition with default values', () => {
      const transition = createMockTransition('clip-1');
      
      expect(transition.clipId).toBe('clip-1');
      expect(transition.type).toBe('fade');
      expect(transition.position).toBe('start');
      expect(transition.duration).toBe(1);
    });

    it('should create a transition with custom values', () => {
      const transition = createMockTransition('clip-1', 'slide-left', 'end', 2);
      
      expect(transition.type).toBe('slide-left');
      expect(transition.position).toBe('end');
      expect(transition.duration).toBe(2);
    });
  });

  describe('createMockFilter', () => {
    it('should create a filter with default values', () => {
      const filter = createMockFilter();
      
      expect(filter.brightness).toBe(0);
      expect(filter.contrast).toBe(0);
      expect(filter.saturation).toBe(0);
      expect(filter.grayscale).toBe(false);
      expect(filter.sepia).toBe(false);
      expect(filter.blur).toBe(0);
    });
  });

  describe('createMockExportSettings', () => {
    it('should create export settings with default values', () => {
      const settings = createMockExportSettings();
      
      expect(settings.resolution).toBe('1080p');
      expect(settings.format).toBe('mp4');
      expect(settings.quality).toBe('medium');
      expect(settings.fps).toBe('30');
      expect(settings.filename).toBe('export');
    });

    it('should create export settings with custom values', () => {
      const settings = createMockExportSettings('4K', 'webm', 'high', 'my-video');
      
      expect(settings.resolution).toBe('4K');
      expect(settings.format).toBe('webm');
      expect(settings.quality).toBe('high');
      expect(settings.filename).toBe('my-video');
    });
  });

  describe('createMultipleVideoClips', () => {
    it('should create multiple video clips', () => {
      const mediaFiles = [
        createMockMediaFile('video', 'video1.mp4', 10),
        createMockMediaFile('video', 'video2.mp4', 15),
        createMockMediaFile('video', 'video3.mp4', 20),
      ];
      const trackId = 'video-track';
      
      const clips = createMultipleVideoClips(mediaFiles, trackId);
      
      expect(clips).toHaveLength(3);
      expect(clips[0].startTime).toBe(0);
      expect(clips[1].startTime).toBe(10);
      expect(clips[2].startTime).toBe(25);
    });

    it('should start from custom start time', () => {
      const mediaFiles = [
        createMockMediaFile('video', 'video1.mp4', 10),
      ];
      const trackId = 'video-track';
      
      const clips = createMultipleVideoClips(mediaFiles, trackId, 5);
      
      expect(clips[0].startTime).toBe(5);
    });
  });

  describe('createMultipleAudioClips', () => {
    it('should create multiple audio clips', () => {
      const mediaFiles = [
        createMockMediaFile('audio', 'audio1.mp3', 30),
        createMockMediaFile('audio', 'audio2.mp3', 45),
      ];
      const trackId = 'audio-track';
      
      const clips = createMultipleAudioClips(mediaFiles, trackId);
      
      expect(clips).toHaveLength(2);
      expect(clips[0].type).toBe('audio');
      expect(clips[1].type).toBe('audio');
    });
  });
});

