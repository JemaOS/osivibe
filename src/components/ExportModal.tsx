// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState } from 'react';
import { X, Download, Loader2 } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { ExportResolution, ExportFormat, ExportQuality } from '../types';
import { exportProject, cancelExport } from '../utils/ffmpeg';
import { downloadBlob } from '../utils/helpers';
import { getHardwareProfile } from '../utils/previewOptimizer';

// Aspect ratio options for export
type AspectRatioOption = '16:9' | '9:16' | '1:1' | '4:3' | '21:9';

const ASPECT_RATIO_OPTIONS: { value: AspectRatioOption; label: string; description: string }[] = [
  { value: '16:9', label: '16:9', description: 'Paysage (YouTube, TV)' },
  { value: '9:16', label: '9:16', description: 'Portrait (TikTok, Reels)' },
  { value: '1:1', label: '1:1', description: 'Carré (Instagram)' },
  { value: '4:3', label: '4:3', description: 'Classique' },
  { value: '21:9', label: '21:9', description: 'Cinéma' },
];

export const ExportModal: React.FC = () => {
  const {
    ui,
    exportSettings,
    tracks,
    mediaFiles,
    filters,
    textOverlays,
    transitions,
    aspectRatio,
    setExportSettings,
    closeExportModal,
    setProcessing,
    setAspectRatio,
  } = useEditorStore();

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportMessage, setExportMessage] = useState('');
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<AspectRatioOption>(aspectRatio);

  if (!ui.isExportModalOpen) return null;

  const handleCancel = () => {
    if (isExporting) {
      if (window.confirm('Voulez-vous vraiment annuler l\'export en cours ?')) {
        cancelExport();
        setIsExporting(false);
        setExportProgress(0);
        setExportMessage('');
        closeExportModal();
      }
    } else {
      closeExportModal();
    }
  };

  const handleExport = async () => {
    try {
      setIsExporting(true);
      setExportProgress(0);
      setExportMessage('Préparation de l\'export...');

      const trackMuteById = new Map(tracks.map((t) => [t.id, t.muted] as const));

      // Collect all clips from video tracks in order
      const videoClips = tracks
        .filter(t => t.type === 'video')
        .flatMap(t => t.clips)
        .sort((a, b) => a.startTime - b.startTime);

      // Collect all clips from audio tracks (WAV/MP3/etc). Muted tracks are ignored.
      const audioTimelineClips = tracks
        .filter((t) => t.type === 'audio' && !t.muted)
        .flatMap((t) => t.clips)
        .sort((a, b) => a.startTime - b.startTime);

      if (videoClips.length === 0) {
        alert('Aucun clip vidéo à exporter');
        setIsExporting(false);
        return;
      }

      console.log('Exporting', videoClips.length, 'clips');

      // DEBUG: Log text overlays being exported
      console.log('🔤 DEBUG - Text overlays to export:', textOverlays.length);
      textOverlays.forEach((text, index) => {
        console.log(`  Text ${index + 1}:`, {
          id: text.id,
          text: text.text,
          x: text.x,
          y: text.y,
          fontSize: text.fontSize,
          color: text.color,
          startTime: text.startTime,
          duration: text.duration,
          endTime: text.startTime + text.duration
        });
      });

      // DEBUG: Log transitions being exported
      console.log('🔀 DEBUG - Transitions to export:', transitions.length);
      transitions.forEach((transition, index) => {
        console.log(`  Transition ${index + 1}:`, {
          id: transition.id,
          type: transition.type,
          clipId: transition.clipId,
          position: transition.position,
          duration: transition.duration
        });
      });

      // DEBUG: Log clip IDs for matching
      console.log('🎬 DEBUG - Video clips for export:');
      videoClips.forEach((clip, index) => {
        const hasTransition = transitions.find(t => t.clipId === clip.id);
        console.log(`  Clip ${index + 1}:`, {
          id: clip.id,
          name: clip.name,
          startTime: clip.startTime,
          duration: clip.duration,
          hasTransition: !!hasTransition,
          transitionType: hasTransition?.type,
          transitionPosition: hasTransition?.position
        });
      });

      // Prepare clips with their media files and filters
      const clipsToExport = videoClips.map(clip => {
        const media = mediaFiles.find(m => m.id === clip.mediaId);
        if (!media) throw new Error('Fichier média introuvable');

        return {
          id: clip.id, // Include clip ID for transition matching
          file: media.file,
          startTime: clip.startTime,
          duration: clip.duration,
          trimStart: clip.trimStart,
          trimEnd: clip.trimEnd,
          filter: filters[clip.id],
          // If the video clip is muted (detached audio deleted) or the whole track is muted,
          // exclude the source audio from export.
          audioMuted: !!clip.audioMuted || trackMuteById.get(clip.trackId) === true,
        };
      });

      // Prepare external audio-track clips (WAV, etc.)
      const audioClipsToExport = audioTimelineClips
        .map((clip) => {
          const media = mediaFiles.find((m) => m.id === clip.mediaId);
          if (!media) throw new Error('Fichier média introuvable');
          return {
            id: clip.id,
            file: media.file,
            startTime: clip.startTime,
            duration: clip.duration,
            trimStart: clip.trimStart,
            trimEnd: clip.trimEnd,
          };
        })
        // Do not rely on MIME type (some browsers provide empty type for WAV).
        // ffmpeg will infer format from extension.
        ;

      // Set a timeout for the export (10 minutes max)
      const exportTimeout = setTimeout(() => {
        console.error('Export timeout');
        throw new Error('L\'export a pris trop de temps. Veuillez réessayer avec une vidéo plus courte.');
      }, 600000); // 10 minutes

      try {
        // Get hardware profile for optimization
        const hardwareProfile = getHardwareProfile();
        console.log('🖥️ Using hardware profile for export:', hardwareProfile);

        // Export video with progress callback, including text overlays, transitions, and aspect ratio
        console.log('📐 DEBUG - Exporting with aspect ratio:', selectedAspectRatio);
        const blob = await exportProject(
          clipsToExport,
          exportSettings,
          (progress, message) => {
            console.log('Export progress:', progress, message);
            setExportProgress(Math.min(99, Math.max(0, progress)));
            setExportMessage(message || 'Traitement en cours...');
          },
          textOverlays,
          transitions,
          selectedAspectRatio,
          hardwareProfile,
          audioClipsToExport
        );

        clearTimeout(exportTimeout);
        setExportProgress(100);
        setExportMessage('Finalisation...');

        // Download the file
        const filename = `${exportSettings.filename || 'video'}.${exportSettings.format}`;
        downloadBlob(blob, filename);

        setExportMessage('Export terminé !');
        setTimeout(() => {
          closeExportModal();
          setIsExporting(false);
          setExportProgress(0);
          setExportMessage('');
        }, 2000);
      } catch (exportError) {
        clearTimeout(exportTimeout);
        throw exportError;
      }

    } catch (error) {
      console.error('Export error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Erreur inconnue';
      
      // Don't show alert if the error is due to user cancellation
      if (errorMessage.includes('called FFmpeg.terminate()')) {
        console.log('Export cancelled by user');
      } else {
        alert('Erreur lors de l\'export: ' + errorMessage);
      }
      
      setIsExporting(false);
      setExportProgress(0);
      setExportMessage('');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 sm:p-6">
      <div className="glass-panel w-full max-w-md p-0 overflow-hidden relative z-[101] max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3rem)] flex flex-col">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-white/20 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg sm:text-h2 font-semibold text-neutral-800">Exporter la video</h2>
          <button
            onClick={handleCancel}
            className="btn-icon w-8 h-8 sm:w-9 sm:h-9"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6 overflow-y-auto flex-1 min-h-0">
          {!isExporting ? (
            <>
              {/* Filename */}
              <div>
                <label className="block text-body font-medium text-neutral-700 mb-2">
                  Nom du fichier
                </label>
                <input
                  type="text"
                  value={exportSettings.filename}
                  onChange={(e) => setExportSettings({ filename: e.target.value })}
                  className="glass-input w-full"
                  placeholder="mon-video"
                />
              </div>

              {/* Resolution */}
              <div>
                <label className="block text-sm sm:text-body font-medium text-neutral-700 mb-1.5 sm:mb-2">
                  Resolution
                </label>
                <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                  {(['720p', '1080p', '4K'] as ExportResolution[]).map((res) => (
                    <button
                      key={res}
                      onClick={() => setExportSettings({ resolution: res })}
                      className={`py-2 sm:py-3 px-2 sm:px-4 rounded-lg sm:rounded-xl text-xs sm:text-small font-medium transition-all ${
                        exportSettings.resolution === res
                          ? 'bg-primary-500 text-white'
                          : 'glass-panel-medium hover:border-primary-500/50'
                      }`}
                    >
                      {res}
                    </button>
                  ))}
                </div>
              </div>

              {/* Aspect Ratio */}
              <div>
                <label className="block text-sm sm:text-body font-medium text-neutral-700 mb-1.5 sm:mb-2">
                  Ratio d'aspect
                </label>
                <div className="grid grid-cols-5 gap-1 sm:gap-2">
                  {ASPECT_RATIO_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setSelectedAspectRatio(option.value);
                        setAspectRatio(option.value);
                      }}
                      className={`py-2 sm:py-3 px-1 sm:px-2 rounded-lg sm:rounded-xl text-[10px] sm:text-small font-medium transition-all ${
                        selectedAspectRatio === option.value
                          ? 'bg-primary-500 text-white'
                          : 'glass-panel-medium hover:border-primary-500/50'
                      }`}
                      title={option.description}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] sm:text-xs text-neutral-500 mt-1">
                  {ASPECT_RATIO_OPTIONS.find(o => o.value === selectedAspectRatio)?.description}
                </p>
              </div>

              {/* Format & FPS - Combined row on mobile */}
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                {/* Format */}
                <div>
                  <label className="block text-sm sm:text-body font-medium text-neutral-700 mb-1.5 sm:mb-2">
                    Format
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                    {(['mp4', 'webm'] as ExportFormat[]).map((fmt) => (
                      <button
                        key={fmt}
                        onClick={() => setExportSettings({ format: fmt })}
                        className={`py-2 sm:py-3 px-2 sm:px-4 rounded-lg sm:rounded-xl text-xs sm:text-small font-medium uppercase transition-all ${
                          exportSettings.format === fmt
                            ? 'bg-primary-500 text-white'
                            : 'glass-panel-medium hover:border-primary-500/50'
                        }`}
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* FPS */}
                <div>
                  <label className="block text-sm sm:text-body font-medium text-neutral-700 mb-1.5 sm:mb-2">
                    FPS
                  </label>
                  <div className="grid grid-cols-3 gap-1 sm:gap-2">
                    {(['30', '60', '120'] as const).map((fps) => (
                      <button
                        key={fps}
                        onClick={() => setExportSettings({ fps })}
                        className={`py-2 sm:py-3 px-1 sm:px-4 rounded-lg sm:rounded-xl text-xs sm:text-small font-medium transition-all ${
                          exportSettings.fps === fps
                            ? 'bg-primary-500 text-white'
                            : 'glass-panel-medium hover:border-primary-500/50'
                        }`}
                      >
                        {fps}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Quality */}
              <div>
                <label className="block text-sm sm:text-body font-medium text-neutral-700 mb-1.5 sm:mb-2">
                  Qualite
                </label>
                <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                  {(['low', 'medium', 'high'] as ExportQuality[]).map((qual) => (
                    <button
                      key={qual}
                      onClick={() => setExportSettings({ quality: qual })}
                      className={`py-2 sm:py-3 px-2 sm:px-4 rounded-lg sm:rounded-xl text-xs sm:text-small font-medium capitalize transition-all ${
                        exportSettings.quality === qual
                          ? 'bg-primary-500 text-white'
                          : 'glass-panel-medium hover:border-primary-500/50'
                      }`}
                    >
                      {qual === 'low' ? 'Basse' : qual === 'medium' ? 'Moyenne' : 'Haute'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Info - Hidden on very small screens */}
              <div className="glass-panel-medium p-3 sm:p-4 rounded-lg sm:rounded-xl hidden xs:block">
                <p className="text-xs sm:text-small text-neutral-600">
                  <strong className="text-neutral-800">Note:</strong> L'export peut prendre plusieurs minutes selon la longueur et la qualite choisie.
                </p>
              </div>
            </>
          ) : (
            <div className="py-4 sm:py-8">
              {/* Progress */}
              <div className="text-center mb-4 sm:mb-6">
                <div className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 relative">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                    {/* Background Circle */}
                    <path
                      className="text-neutral-200"
                      d="M18 2.0845
                        a 15.9155 15.9155 0 0 1 0 31.831
                        a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                    />
                    {/* Progress Circle */}
                    <path
                      className="text-primary-500 transition-all duration-300 ease-out"
                      strokeDasharray={`${exportProgress}, 100`}
                      d="M18 2.0845
                        a 15.9155 15.9155 0 0 1 0 31.831
                        a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xs sm:text-small font-bold text-primary-700">
                      {exportProgress}%
                    </span>
                  </div>
                </div>
                <p className="text-sm sm:text-body-lg font-medium text-neutral-800 mb-1 sm:mb-2">
                  {exportMessage}
                </p>
                <p className="text-xs sm:text-small text-neutral-500">
                  Veuillez patienter...
                </p>
              </div>

              {/* Progress Bar */}
              <div className="w-full h-1.5 sm:h-2 bg-neutral-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 transition-all duration-300"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>

              <div className="mt-4 sm:mt-6 flex justify-center">
                <button
                  onClick={handleCancel}
                  className="btn-secondary px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm"
                >
                  Annuler l'export
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer - Fixed at bottom */}
        {!isExporting && (
          <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-white/20 flex items-center justify-end gap-2 sm:gap-3 flex-shrink-0">
            <button
              onClick={closeExportModal}
              className="btn-secondary h-8 sm:h-10 px-3 sm:px-4 text-sm"
            >
              Annuler
            </button>
            <button
              onClick={handleExport}
              className="btn-primary h-8 sm:h-10 px-3 sm:px-4 text-sm"
            >
              <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              Exporter
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExportModal;
