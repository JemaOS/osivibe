import React, { useState } from 'react';
import { X, Download, Loader2 } from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { ExportResolution, ExportFormat, ExportQuality } from '../types';
import { exportProject, cancelExport } from '../utils/ffmpeg';
import { downloadBlob } from '../utils/helpers';

export const ExportModal: React.FC = () => {
  const {
    ui,
    exportSettings,
    tracks,
    mediaFiles,
    filters,
    setExportSettings,
    closeExportModal,
    setProcessing,
  } = useEditorStore();

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportMessage, setExportMessage] = useState('');

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

      // Collect all clips from video tracks in order
      const videoClips = tracks
        .filter(t => t.type === 'video')
        .flatMap(t => t.clips)
        .sort((a, b) => a.startTime - b.startTime);

      if (videoClips.length === 0) {
        alert('Aucun clip vidéo à exporter');
        setIsExporting(false);
        return;
      }

      console.log('Exporting', videoClips.length, 'clips');

      // Prepare clips with their media files and filters
      const clipsToExport = videoClips.map(clip => {
        const media = mediaFiles.find(m => m.id === clip.mediaId);
        if (!media) throw new Error('Fichier média introuvable');

        return {
          file: media.file,
          startTime: clip.startTime,
          duration: clip.duration,
          trimStart: clip.trimStart,
          trimEnd: clip.trimEnd,
          filter: filters[clip.id],
        };
      });

      // Set a timeout for the export (10 minutes max)
      const exportTimeout = setTimeout(() => {
        console.error('Export timeout');
        throw new Error('L\'export a pris trop de temps. Veuillez réessayer avec une vidéo plus courte.');
      }, 600000); // 10 minutes

      try {
        // Export video with progress callback
        const blob = await exportProject(
          clipsToExport,
          exportSettings,
          (progress, message) => {
            console.log('Export progress:', progress, message);
            setExportProgress(Math.min(99, Math.max(0, progress)));
            setExportMessage(message || 'Traitement en cours...');
          }
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-md mx-4 p-0 overflow-hidden relative z-[101]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/20 flex items-center justify-between">
          <h2 className="text-h2 font-semibold text-neutral-800">Exporter la video</h2>
          <button
            onClick={handleCancel}
            className="btn-icon w-9 h-9"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-6 space-y-6">
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
                <label className="block text-body font-medium text-neutral-700 mb-2">
                  Resolution
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['720p', '1080p', '4K'] as ExportResolution[]).map((res) => (
                    <button
                      key={res}
                      onClick={() => setExportSettings({ resolution: res })}
                      className={`py-3 px-4 rounded-xl text-small font-medium transition-all ${
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

              {/* Format */}
              <div>
                <label className="block text-body font-medium text-neutral-700 mb-2">
                  Format
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['mp4', 'webm'] as ExportFormat[]).map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => setExportSettings({ format: fmt })}
                      className={`py-3 px-4 rounded-xl text-small font-medium uppercase transition-all ${
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
                <label className="block text-body font-medium text-neutral-700 mb-2">
                  Images par seconde (FPS)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['30', '60', '120'] as const).map((fps) => (
                    <button
                      key={fps}
                      onClick={() => setExportSettings({ fps })}
                      className={`py-3 px-4 rounded-xl text-small font-medium transition-all ${
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

              {/* Quality */}
              <div>
                <label className="block text-body font-medium text-neutral-700 mb-2">
                  Qualite
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['low', 'medium', 'high'] as ExportQuality[]).map((qual) => (
                    <button
                      key={qual}
                      onClick={() => setExportSettings({ quality: qual })}
                      className={`py-3 px-4 rounded-xl text-small font-medium capitalize transition-all ${
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

              {/* Info */}
              <div className="glass-panel-medium p-4 rounded-xl">
                <p className="text-small text-neutral-600">
                  <strong className="text-neutral-800">Note:</strong> L'export peut prendre plusieurs minutes selon la longueur et la qualite choisie.
                </p>
              </div>
            </>
          ) : (
            <div className="py-8">
              {/* Progress */}
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 relative">
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
                    <span className="text-small font-bold text-primary-700">
                      {exportProgress}%
                    </span>
                  </div>
                </div>
                <p className="text-body-lg font-medium text-neutral-800 mb-2">
                  {exportMessage}
                </p>
                <p className="text-small text-neutral-500">
                  Veuillez patienter...
                </p>
              </div>

              {/* Progress Bar */}
              <div className="w-full h-2 bg-neutral-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 transition-all duration-300"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>

              <div className="mt-6 flex justify-center">
                <button 
                  onClick={handleCancel}
                  className="btn-secondary px-4 py-2 text-sm"
                >
                  Annuler l'export
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!isExporting && (
          <div className="px-6 py-4 border-t border-white/20 flex items-center justify-end gap-3">
            <button
              onClick={closeExportModal}
              className="btn-secondary h-10 px-4"
            >
              Annuler
            </button>
            <button
              onClick={handleExport}
              className="btn-primary h-10 px-4"
            >
              <Download className="w-4 h-4" />
              Exporter
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExportModal;
