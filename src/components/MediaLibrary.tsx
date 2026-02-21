// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useCallback, useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  Film, 
  Music, 
  Image as ImageIcon, 
  Trash2,
  GripVertical,
  MoreVertical,
  FolderPlus,
  Plus
} from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { MediaFile, MediaType } from '../types';
import { formatTime, formatFileSize, getFileType } from '../utils/helpers';
import { getVideoMetadata, getAudioDuration, generateThumbnail } from '../utils/mediaBunny';
import { v4 as uuidv4 } from 'uuid';

export const MediaLibrary: React.FC = () => {
  const { mediaFiles, addMediaFile, removeMediaFile, tracks, addClipToTrack, player } = useEditorStore();
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0, fileName: '' });
  const [filter, setFilter] = useState<MediaType | 'all'>('all');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Debug: log mediaFiles changes
  useEffect(() => {
    console.log('📦 mediaFiles mis à jour:', mediaFiles.length, 'fichiers', mediaFiles.map(m => m.name));
  }, [mediaFiles]);

  const extractVideoMetadata = async (file: File, mediaFile: MediaFile) => {
    console.log('🎬 Extraction métadonnées vidéo...');
    try {
      const metadata = await getVideoMetadata(file);
      mediaFile.duration = metadata.duration;
      mediaFile.width = metadata.width;
      mediaFile.height = metadata.height;
      console.log('✅ Métadonnées extraites:', metadata);
      
      // Generate thumbnail (non-blocking)
      console.log('🖼️ Tentative génération miniature...');
      generateThumbnail(file, 0)
        .then(thumb => {
          mediaFile.thumbnail = thumb;
          console.log('✅ Miniature générée après coup');
        })
        .catch(thumbError => {
          console.warn('⚠️ Échec génération miniature (non bloquant):', thumbError);
        });
    } catch (metadataError) {
      console.warn('⚠️ Échec extraction métadonnées, utilisation valeurs par défaut:', metadataError);
      mediaFile.duration = 5;
      mediaFile.width = 1280;
      mediaFile.height = 720;
    }
  };

  const extractImageMetadata = async (file: File, mediaFile: MediaFile) => {
    mediaFile.duration = 5; // Default 5 seconds for images
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = () => {
          mediaFile.width = img.width;
          mediaFile.height = img.height;
          mediaFile.thumbnail = mediaFile.url;
          resolve(null);
        };
        img.onerror = reject;
        img.src = mediaFile.url;
      });
      console.log('✅ Image chargée:', {
        name: mediaFile.name,
        dimensions: `${mediaFile.width}x${mediaFile.height}`,
        url: mediaFile.url
      });
    } catch (imgError) {
      console.warn('Image loading failed for', file.name, imgError);
      mediaFile.width = 1280;
      mediaFile.height = 720;
    }
  };

  const processFile = async (file: File): Promise<MediaFile | null> => {
    console.log('🔄 Début du traitement:', file.name, 'Type:', file.type, 'Taille:', file.size);
    
    const type = getFileType(file);
    if (type === 'unknown') {
      console.warn('⚠️ Type de fichier non supporté:', file.name);
      return null;
    }
    
    console.log('📁 Type détecté:', type);

    const mediaFile: MediaFile = {
      id: uuidv4(),
      name: file.name,
      type: type as MediaType,
      file,
      url: URL.createObjectURL(file),
      duration: 0,
    };

    try {
      if (type === 'video') {
        await extractVideoMetadata(file, mediaFile);
      } else if (type === 'audio') {
        try {
          mediaFile.duration = await getAudioDuration(file);
        } catch (audioError) {
          console.warn('Audio duration extraction failed for', file.name, audioError);
          mediaFile.duration = 5;
        }
      } else if (type === 'image') {
        await extractImageMetadata(file, mediaFile);
      }
    } catch (error) {
      console.error('❌ Erreur lors du traitement:', file.name, error);
      if (!mediaFile.duration) mediaFile.duration = 5;
      if (!mediaFile.width) mediaFile.width = 1280;
      if (!mediaFile.height) mediaFile.height = 720;
    }

    console.log('✅ Fichier traité:', {
      name: mediaFile.name,
      type: mediaFile.type,
      duration: mediaFile.duration,
      dimensions: `${mediaFile.width}x${mediaFile.height}`,
      id: mediaFile.id
    });
    
    return mediaFile;
  };

  const handleFiles = async (files: FileList | File[]) => {
    setIsLoading(true);
    setErrorMessage('');
    const fileArray = Array.from(files);
    const total = fileArray.length;
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      setLoadingProgress({ 
        current: i + 1, 
        total, 
        fileName: file.name 
      });
      
      try {
        const mediaFile = await processFile(file);
        if (mediaFile) {
          console.log('✅ Fichier traité avec succès:', mediaFile.name, {
            duration: mediaFile.duration,
            type: mediaFile.type,
            width: mediaFile.width,
            height: mediaFile.height,
            hasThumbnail: !!mediaFile.thumbnail
          });
          addMediaFile(mediaFile);
          successCount++;
        } else {
          console.warn('❌ Fichier rejeté:', file.name);
          failCount++;
        }
      } catch (error) {
        console.error('❌ Échec du traitement:', file.name, error);
        failCount++;
      }
    }
    
    setIsLoading(false);
    setLoadingProgress({ current: 0, total: 0, fileName: '' });
    
    // Show result message
    if (failCount > 0) {
      setErrorMessage(`${successCount} fichier(s) importé(s), ${failCount} échec(s)`);
      setTimeout(() => setErrorMessage(''), 5000);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
  };

  const handleMediaDragStart = (e: React.DragEvent, media: MediaFile) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'media',
      mediaId: media.id,
    }));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleAddToTimeline = (media: MediaFile) => {
    // Find appropriate track
    const trackType = media.type === 'audio' ? 'audio' : 'video';
    const track = tracks.find(t => t.type === trackType);
    
    if (track) {
      // Find the end of the last clip in the track
      const lastClipEnd = track.clips.reduce((max, clip) => {
        const clipEnd = clip.startTime + (clip.duration - clip.trimStart - clip.trimEnd);
        return clipEnd > max ? clipEnd : max;
      }, 0);
      
      addClipToTrack(track.id, media, lastClipEnd);
    }
  };

  const filteredMedia = filter === 'all' 
    ? mediaFiles 
    : mediaFiles.filter(m => m.type === filter);

  const getMediaIcon = (type: MediaType) => {
    switch (type) {
      case 'video': return <Film className="w-4 h-4" />;
      case 'audio': return <Music className="w-4 h-4" />;
      case 'image': return <ImageIcon className="w-4 h-4" />;
    }
  };

  return (
    <div className="glass-panel h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-2 xxs:px-3 sm:px-4 py-1.5 xxs:py-2 sm:py-3 border-b border-white/20 flex-shrink-0">
        <h2 className="text-sm xxs:text-base sm:text-h3 font-semibold text-white">Médias</h2>
      </div>

      {/* Filter Tabs */}
      <div className="px-1 xxs:px-2 sm:px-4 py-1.5 xxs:py-2 flex gap-0.5 xxs:gap-1 border-b border-white/10 overflow-x-auto flex-shrink-0">
        {(['all', 'video', 'audio', 'image'] as const).map((type) => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className={`px-1.5 xxs:px-2 sm:px-3 py-1 xxs:py-1.5 rounded-lg text-[10px] xxs:text-xs sm:text-small font-medium transition-all whitespace-nowrap ${
              filter === type
                ? 'bg-primary-500 text-white'
                : 'text-neutral-300 hover:bg-white/10'
            }`}
          >
            {type === 'all' ? 'Tous' : type === 'video' ? 'Vidéos' : type === 'audio' ? 'Audio' : 'Images'}
          </button>
        ))}
      </div>

      {/* Drop Zone / Media List */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {/* Error Message */}
        {errorMessage && (
          <div className="mx-1 xxs:mx-2 sm:mx-4 mt-1 xxs:mt-2 sm:mt-4 p-1.5 xxs:p-2 sm:p-3 bg-warning/10 border border-warning/30 rounded-lg flex-shrink-0">
            <p className="text-[10px] xxs:text-xs sm:text-small text-warning-700">{errorMessage}</p>
          </div>
        )}
        
        {/* Drop Zone - Full Mode (when no media items) */}
        {mediaFiles.length === 0 && (
          <div
            className={`m-1 xxs:m-2 sm:m-4 border-2 border-dashed rounded-xl transition-all cursor-pointer flex-1 min-h-[150px] flex items-center justify-center overflow-hidden ${
              isDragging
                ? 'border-primary-500 bg-primary-50/50'
                : 'border-neutral-300 hover:border-primary-400 hover:bg-white/5'
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="flex flex-col items-center justify-center gap-1 xxs:gap-2 sm:gap-3 p-4 xxs:p-6 sm:p-8 pointer-events-none">
              <div className={`w-10 h-10 xxs:w-12 xxs:h-12 sm:w-14 sm:h-14 rounded-xl flex items-center justify-center transition-colors flex-shrink-0 ${
                isDragging ? 'bg-primary-500' : 'bg-glass-medium'
              }`}>
                <Upload className={`w-5 h-5 xxs:w-6 xxs:h-6 sm:w-7 sm:h-7 ${isDragging ? 'text-white' : 'text-neutral-400'}`} />
              </div>
              <div className="text-center">
                <p className="text-sm xxs:text-base sm:text-lg font-medium text-white">
                  {isDragging ? 'Déposez ici' : 'Glissez vos médias'}
                </p>
                <p className="text-xs xxs:text-sm sm:text-base text-neutral-400 mt-1 xxs:mt-1.5 sm:mt-2">
                  ou cliquez pour parcourir
                </p>
                <p className="text-[10px] xxs:text-xs sm:text-sm text-neutral-500 mt-1 xxs:mt-1.5 sm:mt-2">
                  MP4, WebM, MOV, MP3, WAV, PNG, JPG
                </p>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="video/*,audio/*,image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        )}

        {/* Drop Zone - Compact Mode (when media items exist) */}
        {mediaFiles.length > 0 && (
          <div
            className={`mx-1 xxs:mx-2 sm:mx-4 mt-1 xxs:mt-2 sm:mt-4 mb-1 xxs:mb-1.5 sm:mb-2 border-2 border-dashed rounded-lg transition-all cursor-pointer flex-shrink-0 min-h-[44px] xxs:min-h-[48px] sm:min-h-[56px] flex items-center justify-center ${
              isDragging
                ? 'border-primary-500 bg-primary-50/50'
                : 'border-neutral-300 hover:border-primary-400 hover:bg-white/5'
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="flex items-center justify-center gap-1.5 xxs:gap-2 sm:gap-2.5 px-3 py-2 pointer-events-none">
              <div className={`w-5 h-5 xxs:w-6 xxs:h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center transition-colors flex-shrink-0 ${
                isDragging ? 'bg-primary-500' : 'bg-glass-medium'
              }`}>
                <Plus className={`w-3 h-3 xxs:w-3.5 xxs:h-3.5 sm:w-4 sm:h-4 ${isDragging ? 'text-white' : 'text-neutral-400'}`} />
              </div>
              <span className="text-xs xxs:text-sm sm:text-base font-medium text-white whitespace-nowrap">
                {isDragging ? 'Déposez ici' : (
                  <>
                    <span className="hidden xxs:inline">Ajouter des médias</span>
                    <span className="xxs:hidden">Ajouter</span>
                  </>
                )}
              </span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="video/*,audio/*,image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div className="px-2 xxs:px-3 sm:px-4 py-2 xxs:py-3 flex-shrink-0">
            <div className="glass-panel-medium p-2 xxs:p-3 sm:p-4 rounded-xl">
              <div className="flex items-center gap-1.5 xxs:gap-2 text-[10px] xxs:text-xs sm:text-small text-neutral-700 mb-1.5 xxs:mb-2">
                <div className="w-2.5 h-2.5 xxs:w-3 xxs:h-3 sm:w-4 sm:h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                <span className="font-medium">Import...</span>
              </div>
              
              {/* Progress bar */}
              <div className="w-full bg-neutral-200 rounded-full h-1.5 xxs:h-2 mb-1.5 xxs:mb-2 overflow-hidden">
                <div
                  className="bg-primary-500 h-full transition-all duration-300 rounded-full"
                  style={{ width: `${(loadingProgress.current / loadingProgress.total) * 100}%` }}
                />
              </div>
              
              {/* Progress text */}
              <div className="flex items-center justify-between text-[9px] xxs:text-xs sm:text-caption text-neutral-600">
                <span className="truncate max-w-[50%] xxs:max-w-[60%]">{loadingProgress.fileName}</span>
                <span className="font-medium">
                  {loadingProgress.current}/{loadingProgress.total}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Media List */}
        {mediaFiles.length > 0 && (
          <div className="flex-1 overflow-y-auto custom-scrollbar px-1 xxs:px-2 sm:px-4 pb-1 xxs:pb-2 sm:pb-4 min-h-0">
            <div className="space-y-1 xxs:space-y-1.5 sm:space-y-2">
              {filteredMedia.map((media) => (
                <div
                  key={media.id}
                  draggable
                  onDragStart={(e) => handleMediaDragStart(e, media)}
                  onDoubleClick={() => handleAddToTimeline(media)}
                  className="group glass-panel-medium rounded-lg p-1.5 xxs:p-2 sm:p-3 cursor-grab hover:border-primary-500/50 transition-all"
                >
                  <div className="flex items-start gap-1.5 xxs:gap-2 sm:gap-3">
                    {/* Thumbnail */}
                    <div className="w-10 h-8 xxs:w-12 xxs:h-10 sm:w-16 sm:h-12 rounded-lg bg-neutral-200 flex-shrink-0 overflow-hidden">
                      {media.thumbnail ? (
                        <img
                          src={media.thumbnail}
                          alt={media.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-400">
                          {getMediaIcon(media.type)}
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] xxs:text-xs sm:text-body font-medium text-neutral-800 truncate">
                        {media.name}
                      </p>
                      <div className="flex items-center gap-0.5 xxs:gap-1 sm:gap-2 mt-0.5 xxs:mt-1">
                        <span className="text-[9px] xxs:text-[0.65rem] sm:text-caption text-neutral-500">
                          {formatTime(media.duration)}
                        </span>
                        <span className="text-[9px] xxs:text-[0.65rem] sm:text-caption text-neutral-400 hidden xxs:inline">|</span>
                        <span className="text-[9px] xxs:text-[0.65rem] sm:text-caption text-neutral-500 hidden xxs:inline">
                          {formatFileSize(media.file.size)}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-0 xxs:gap-0.5 sm:gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        onClick={() => handleAddToTimeline(media)}
                        className="p-0.5 xxs:p-1 sm:p-1.5 rounded-lg hover:bg-primary-500/10 text-neutral-400 hover:text-primary-500 transition-colors"
                        title="Ajouter"
                      >
                        <Plus className="w-3 h-3 xxs:w-3.5 xxs:h-3.5 sm:w-4 sm:h-4" />
                      </button>
                      <button
                        onClick={() => removeMediaFile(media.id)}
                        className="p-0.5 xxs:p-1 sm:p-1.5 rounded-lg hover:bg-error/10 text-neutral-400 hover:text-error transition-colors"
                        title="Supprimer"
                      >
                        <Trash2 className="w-3 h-3 xxs:w-3.5 xxs:h-3.5 sm:w-4 sm:h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MediaLibrary;
