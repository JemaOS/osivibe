// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Type,
  Palette,
  Sliders,
  Move,
  Trash2,
  Plus,
  ChevronDown,
  ChevronUp,
  Bold,
  Italic,
  Film,
  Music,
  Clock,
  Scissors,
  Crop,
  Link2Off,
  Monitor,
  Check,
  Pipette,
  X,
  GripHorizontal
} from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { useResponsive, useLayoutMode, useIsFoldable } from '../hooks/use-responsive';
import { AVAILABLE_TRANSITIONS, DEFAULT_FILTER, VideoFilter, TransitionType, CropSettings } from '../types';
import { formatTime } from '../utils/helpers';
import TransitionPreview from './TransitionPreview';

// Add EyeDropper type definition
declare global {
  interface Window {
    EyeDropper: any;
  }
}

const PRESET_COLORS = [
  '#FFFFFF', '#000000', '#9CA3AF', // White, Black, Gray
  '#EF4444', '#F97316', '#F59E0B', // Red, Orange, Amber
  '#10B981', '#3B82F6', '#6366F1', // Emerald, Blue, Indigo
  '#8B5CF6', '#EC4899', '#F43F5E'  // Violet, Pink, Rose
];

type TabType = 'clip' | 'text' | 'transitions' | 'filters';

interface PropertiesPanelProps {
  activeTab?: TabType;
}

const Section: React.FC<{ id: string; title: string; children: React.ReactNode; isExpanded: boolean; onToggle: () => void }> = ({ id, title, children, isExpanded, onToggle }) => {
  const layoutMode = useLayoutMode();
  const isMinimal = layoutMode === 'minimal';
  const isCompact = layoutMode === 'compact';

  return (
    <div className="border-b border-white/10 last:border-0">
      <button
        onClick={onToggle}
        className={`w-full ${isMinimal ? 'px-3 py-2.5' : isCompact ? 'px-3 py-3' : 'px-4 py-3'} flex items-center justify-between ${isMinimal ? 'text-sm' : 'text-body'} font-medium text-white hover:bg-white/10 transition-colors touch-target`}
      >
        {title}
        {isExpanded ? <ChevronUp className={`${isMinimal ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} /> : <ChevronDown className={`${isMinimal ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />}
      </button>
      {isExpanded && (
        <div className={`${isMinimal ? 'px-3 pb-3' : isCompact ? 'px-3 pb-4' : 'px-4 pb-4'}`}>
          {children}
        </div>
      )}
    </div>
  );
};

const handleScrub = (
  e: React.PointerEvent,
  value: number,
  onChange: (val: number, isFinal?: boolean) => void,
  options: { min?: number; max?: number; step?: number } = {}
) => {
  const target = e.target as HTMLElement;
  const isInput = target.tagName === 'INPUT';

  e.preventDefault();
  e.stopPropagation();
  
  const startX = e.clientX;
  const startValue = value;
  const { min, max, step = 1 } = options;
  
  let lastValue = startValue;
  let rafId: number | null = null;
  let pendingUpdate = false;
  let hasMoved = false;

  const handlePointerMove = (moveEvent: PointerEvent) => {
    const delta = moveEvent.clientX - startX;
    
    if (!hasMoved && Math.abs(delta) > 3) {
      hasMoved = true;
      document.body.style.cursor = 'ew-resize';
      if (isInput) target.blur();
    }

    if (!hasMoved) return;

    let newValue = startValue + delta * step;

    if (min !== undefined) newValue = Math.max(newValue, min);
    if (max !== undefined) newValue = Math.min(newValue, max);

    if (step < 1) {
      lastValue = parseFloat(newValue.toFixed(2));
    } else {
      lastValue = Math.round(newValue);
    }
    
    if (!pendingUpdate) {
      pendingUpdate = true;
      rafId = requestAnimationFrame(() => {
        onChange(lastValue, false);
        pendingUpdate = false;
      });
    }
  };

  const handlePointerUp = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
    }
    
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    document.body.style.cursor = '';
    
    if (hasMoved) {
      onChange(lastValue, true);
    } else {
      if (isInput) {
        target.focus();
      }
    }
  };

  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
};

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ activeTab: initialTab }) => {
  const {
    tracks,
    textOverlays,
    transitions,
    filters,
    ui,
    mediaFiles,
    aspectRatio,
    setAspectRatio,
    addTextOverlay,
    updateTextOverlay,
    removeTextOverlay,
    selectText,
    setTransition,
    removeTransition,
    setFilter,
    resetFilter,
    updateClip,
    removeClip,
    detachAudioFromVideo,
    player,
    saveState,
  } = useEditorStore();

  // Use responsive hooks for fold-aware layout
  const responsive = useResponsive();
  const layoutMode = useLayoutMode();
  const isFoldable = useIsFoldable();
  
  // Determine layout characteristics
  const isMinimal = layoutMode === 'minimal';
  const isCompact = layoutMode === 'compact';
  const isAdaptive = layoutMode === 'adaptive';
  const isExpanded = layoutMode === 'expanded';
  const isDesktop = layoutMode === 'desktop';
  
  // Bottom sheet state for fold-cover mode
  const [isBottomSheetOpen, setIsBottomSheetOpen] = useState(false);
  const [bottomSheetHeight, setBottomSheetHeight] = useState(50); // percentage
  const bottomSheetRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ y: number; height: number } | null>(null);

  const [activeTab, setActiveTab] = useState<TabType>(initialTab || 'clip');
  const [expandedSection, setExpandedSection] = useState<string | null>('basic');
  const [previewTransition, setPreviewTransition] = useState<TransitionType | null>(null);
  const [cropMode, setCropMode] = useState(false);
  
  const colorInputRef = useRef<HTMLInputElement>(null);
  const bgColorInputRef = useRef<HTMLInputElement>(null);
  
  // Handle bottom sheet drag for swipe gestures
  const handleBottomSheetDragStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragStartRef.current = { y: clientY, height: bottomSheetHeight };
  }, [bottomSheetHeight]);
  
  const handleBottomSheetDrag = useCallback((e: TouchEvent | MouseEvent) => {
    if (!dragStartRef.current) return;
    
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const deltaY = dragStartRef.current.y - clientY;
    const windowHeight = window.innerHeight;
    const deltaPercent = (deltaY / windowHeight) * 100;
    
    const newHeight = Math.max(20, Math.min(90, dragStartRef.current.height + deltaPercent));
    setBottomSheetHeight(newHeight);
  }, []);
  
  const handleBottomSheetDragEnd = useCallback(() => {
    if (!dragStartRef.current) return;
    
    // Snap to closed if dragged below threshold
    if (bottomSheetHeight < 30) {
      setIsBottomSheetOpen(false);
      setBottomSheetHeight(50);
    }
    
    dragStartRef.current = null;
  }, [bottomSheetHeight]);
  
  // Set up touch/mouse event listeners for bottom sheet drag
  useEffect(() => {
    if (!isBottomSheetOpen) return;
    
    const handleMove = (e: TouchEvent | MouseEvent) => handleBottomSheetDrag(e);
    const handleEnd = () => handleBottomSheetDragEnd();
    
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('touchend', handleEnd);
    window.addEventListener('mouseup', handleEnd);
    
    return () => {
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('touchend', handleEnd);
      window.removeEventListener('mouseup', handleEnd);
    };
  }, [isBottomSheetOpen, handleBottomSheetDrag, handleBottomSheetDragEnd]);

  const handleEyeDropper = async (id: string, property: 'color' | 'backgroundColor') => {
    if (!window.EyeDropper) {
      alert('Votre navigateur ne supporte pas la pipette. Utilisez Chrome ou Edge.');
      return;
    }

    const eyeDropper = new window.EyeDropper();
    try {
      const result = await eyeDropper.open();
      updateTextOverlay(id, { [property]: result.sRGBHex });
    } catch (e) {
      console.log('EyeDropper cancelled');
    }
  };

  // Update activeTab when prop changes
  React.useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Get selected clip
  const selectedClip = ui.selectedClipId 
    ? tracks.flatMap(t => t.clips).find(c => c.id === ui.selectedClipId)
    : null;
  
  const selectedClipMedia = selectedClip 
    ? mediaFiles.find(m => m.id === selectedClip.mediaId)
    : null;

  // Get selected text
  const selectedText = ui.selectedTextId
    ? textOverlays.find(t => t.id === ui.selectedTextId)
    : null;

  // Get filter for selected clip
  const selectedFilter = selectedClip 
    ? filters[selectedClip.id] || { ...DEFAULT_FILTER }
    : null;

  // Get transition for selected clip
  const selectedTransition = selectedClip
    ? transitions.find(t => t.clipId === selectedClip.id)
    : null;

  const tabs = [
    { id: 'clip' as TabType, label: 'Clip', icon: Film },
    { id: 'text' as TabType, label: 'Texte', icon: Type },
    { id: 'transitions' as TabType, label: 'Transitions', icon: Move },
    { id: 'filters' as TabType, label: 'Filtres', icon: Sliders },
  ];

  const handleDetachAudio = () => {
    if (selectedClip && selectedClip.type === 'video') {
      detachAudioFromVideo(selectedClip.id);
    }
  };

  const handleUpdateCrop = (updates: Partial<CropSettings>) => {
    if (!selectedClip) return;
    
    const currentCrop = selectedClip.crop || {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      locked: true,
    };
    
    updateClip(selectedClip.id, {
      crop: { ...currentCrop, ...updates }
    });
  };

  const handleResetCrop = () => {
    if (!selectedClip) return;
    updateClip(selectedClip.id, { crop: undefined });
    setCropMode(false);
  };



  const aspectRatios: Array<{ value: '16:9' | '9:16' | '1:1' | '4:3' | '21:9'; label: string; description: string }> = [
    { value: '16:9', label: '16:9', description: 'Paysage standard' },
    { value: '4:3', label: '4:3', description: 'Format classique' },
    { value: '9:16', label: '9:16', description: 'Portrait (TikTok, Stories)' },
    { value: '1:1', label: '1:1', description: 'Carré (Instagram)' },
    { value: '21:9', label: '21:9', description: 'Cinéma ultra-wide' },
  ];

  const renderClipProperties = () => {
    if (!selectedClip || !selectedClipMedia) {
      return (
        <div className="px-4 py-8 text-center text-neutral-400">
          <Film className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-body text-white">Selectionnez un clip</p>
          <p className="text-small mt-1 text-neutral-400">pour voir ses proprietes</p>
        </div>
      );
    }

    const effectiveDuration = selectedClip.duration - selectedClip.trimStart - selectedClip.trimEnd;

    return (
      <>
        <Section 
          id="basic" 
          title="Informations" 
          isExpanded={expandedSection === 'basic'} 
          onToggle={() => setExpandedSection(expandedSection === 'basic' ? null : 'basic')}
        >
          <div className="space-y-3">
            <div>
              <label className="text-caption text-neutral-400 block mb-1">Nom</label>
              <p className="text-body text-white truncate">{selectedClip.name}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-caption text-neutral-400 block mb-1">Type</label>
                <p className="text-body text-white capitalize">{selectedClip.type}</p>
              </div>
              <div>
                <label className="text-caption text-neutral-400 block mb-1">Duree</label>
                <p className="text-body text-white">{formatTime(effectiveDuration)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-caption text-neutral-400 block mb-1">Position</label>
                <p className="text-body text-white">{formatTime(selectedClip.startTime)}</p>
              </div>
              {selectedClipMedia.width && (
                <div>
                  <label className="text-caption text-neutral-400 block mb-1">Resolution</label>
                  <p className="text-body text-white">{selectedClipMedia.width}x{selectedClipMedia.height}</p>
                </div>
              )}
            </div>
            
            {/* Detach Audio Button */}
            {selectedClip.type === 'video' && (
              <button
                onClick={handleDetachAudio}
                className="w-full btn-secondary h-10 mt-2"
              >
                <Link2Off className="w-4 h-4" />
                Detacher l'audio
              </button>
            )}
          </div>
        </Section>

        {/* Crop Tool for images and videos */}
        {(selectedClip.type === 'image' || selectedClip.type === 'video') && (
          <Section 
            id="crop" 
            title="Rognage / Crop" 
            isExpanded={expandedSection === 'crop'} 
            onToggle={() => setExpandedSection(expandedSection === 'crop' ? null : 'crop')}
          >
            <div className="space-y-4">
              {!cropMode && !selectedClip.crop && (
                <button
                  onClick={() => setCropMode(true)}
                  className="w-full btn-secondary h-10"
                >
                  <Crop className="w-4 h-4" />
                  Activer le rognage
                </button>
              )}
              
              {(cropMode || selectedClip.crop) && (
                <>
                  <div>
                    <label 
                      className="text-caption text-neutral-500 block mb-2 cursor-ew-resize select-none touch-none"
                      onPointerDown={(e) => handleScrub(e, selectedClip.crop?.x || 0, (val) => handleUpdateCrop({ x: val }), { min: 0, max: 50 })}
                    >
                      Position X ({selectedClip.crop?.x || 0}%)
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="50"
                      step="1"
                      value={selectedClip.crop?.x || 0}
                      onChange={(e) => handleUpdateCrop({ x: parseInt(e.target.value) })}
                      onPointerDown={(e) => {
                        handleScrub(e, selectedClip.crop?.x || 0, (val) => handleUpdateCrop({ x: val }), { min: 0, max: 50 });
                      }}
                      className="w-full cursor-ew-resize"
                    />
                  </div>
                  <div>
                    <label 
                      className="text-caption text-neutral-500 block mb-2 cursor-ew-resize select-none touch-none"
                      onPointerDown={(e) => handleScrub(e, selectedClip.crop?.y || 0, (val) => handleUpdateCrop({ y: val }), { min: 0, max: 50 })}
                    >
                      Position Y ({selectedClip.crop?.y || 0}%)
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="50"
                      step="1"
                      value={selectedClip.crop?.y || 0}
                      onChange={(e) => handleUpdateCrop({ y: parseInt(e.target.value) })}
                      onPointerDown={(e) => {
                        handleScrub(e, selectedClip.crop?.y || 0, (val) => handleUpdateCrop({ y: val }), { min: 0, max: 50 });
                      }}
                      className="w-full cursor-ew-resize"
                    />
                  </div>
                  <div>
                    <label 
                      className="text-caption text-neutral-500 block mb-2 cursor-ew-resize select-none touch-none"
                      onPointerDown={(e) => handleScrub(e, selectedClip.crop?.width || 100, (val) => handleUpdateCrop({ width: val }), { min: 10, max: 100 })}
                    >
                      Largeur ({selectedClip.crop?.width || 100}%)
                    </label>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      step="1"
                      value={selectedClip.crop?.width || 100}
                      onChange={(e) => handleUpdateCrop({ width: parseInt(e.target.value) })}
                      onPointerDown={(e) => {
                        handleScrub(e, selectedClip.crop?.width || 100, (val) => handleUpdateCrop({ width: val }), { min: 10, max: 100 });
                      }}
                      className="w-full cursor-ew-resize"
                    />
                  </div>
                  <div>
                    <label 
                      className="text-caption text-neutral-500 block mb-2 cursor-ew-resize select-none touch-none"
                      onPointerDown={(e) => handleScrub(e, selectedClip.crop?.height || 100, (val) => handleUpdateCrop({ height: val }), { min: 10, max: 100 })}
                    >
                      Hauteur ({selectedClip.crop?.height || 100}%)
                    </label>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      step="1"
                      value={selectedClip.crop?.height || 100}
                      onChange={(e) => handleUpdateCrop({ height: parseInt(e.target.value) })}
                      onPointerDown={(e) => {
                        handleScrub(e, selectedClip.crop?.height || 100, (val) => handleUpdateCrop({ height: val }), { min: 10, max: 100 });
                      }}
                      className="w-full cursor-ew-resize"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="lock-aspect"
                      checked={selectedClip.crop?.locked ?? true}
                      onChange={(e) => handleUpdateCrop({ locked: e.target.checked })}
                      className="w-4 h-4 rounded"
                    />
                    <label htmlFor="lock-aspect" className="text-small text-neutral-700">
                      Verrouiller les proportions
                    </label>
                  </div>
                  <button
                    onClick={handleResetCrop}
                    className="w-full btn-secondary h-10 text-error hover:bg-error/10 hover:border-error/30"
                  >
                    Reinitialiser le crop
                  </button>
                </>
              )}
            </div>
          </Section>
        )}

        <Section 
          id="trim" 
          title="Decoupe" 
          isExpanded={expandedSection === 'trim'} 
          onToggle={() => setExpandedSection(expandedSection === 'trim' ? null : 'trim')}
        >
          <div className="space-y-4">
            <div>
              <label className="text-caption text-neutral-500 block mb-2">Debut (trim)</label>
              <input
                type="range"
                min="0"
                max={selectedClip.duration - selectedClip.trimEnd - 0.1}
                step="0.01"
                value={selectedClip.trimStart}
                onChange={(e) => updateClip(selectedClip.id, { trimStart: parseFloat(e.target.value) })}
                className="w-full"
              />
              <div className="flex justify-between text-caption text-neutral-500 mt-1">
                <span>0:00</span>
                <span className="text-primary-500">{formatTime(selectedClip.trimStart)}</span>
              </div>
            </div>
            <div>
              <label className="text-caption text-neutral-500 block mb-2">Fin (trim)</label>
              <input
                type="range"
                min="0"
                max={selectedClip.duration - selectedClip.trimStart - 0.1}
                step="0.01"
                value={selectedClip.trimEnd}
                onChange={(e) => updateClip(selectedClip.id, { trimEnd: parseFloat(e.target.value) })}
                className="w-full"
              />
              <div className="flex justify-between text-caption text-neutral-500 mt-1">
                <span className="text-primary-500">{formatTime(selectedClip.trimEnd)}</span>
                <span>{formatTime(selectedClip.duration)}</span>
              </div>
            </div>
          </div>
        </Section>

        <div className="p-4">
          <button
            onClick={() => removeClip(selectedClip.id)}
            className="w-full btn-secondary h-10 text-error hover:bg-error/10 hover:border-error/30"
          >
            <Trash2 className="w-4 h-4" />
            Supprimer le clip
          </button>
        </div>
      </>
    );
  };

  const renderTextProperties = () => {
    return (
      <div className="flex flex-col h-full">
        {/* Add Text Button */}
        <div className="p-4 border-b border-white/10">
          <button
            onClick={() => addTextOverlay({ startTime: player.currentTime })}
            className="w-full btn-primary h-10"
          >
            <Plus className="w-4 h-4" />
            Ajouter du texte
          </button>
        </div>

        {selectedText ? (
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <Section 
              id="text-content" 
              title="Contenu" 
              isExpanded={expandedSection === 'text-content'} 
              onToggle={() => setExpandedSection(expandedSection === 'text-content' ? null : 'text-content')}
            >
              <textarea
                value={selectedText.text}
                onChange={(e) => updateTextOverlay(selectedText.id, { text: e.target.value })}
                placeholder="Votre texte..."
                className="glass-input w-full h-24 resize-none"
              />
            </Section>

            <Section 
              id="text-style" 
              title="Style" 
              isExpanded={expandedSection === 'text-style'} 
              onToggle={() => setExpandedSection(expandedSection === 'text-style' ? null : 'text-style')}
            >
              <div className="space-y-4">
                <div>
                  <label className="text-caption text-neutral-500 block mb-2">Police</label>
                  <select
                    value={selectedText.fontFamily}
                    onChange={(e) => updateTextOverlay(selectedText.id, { fontFamily: e.target.value })}
                    className="glass-input w-full h-10"
                  >
                    <option value="Inter">Inter</option>
                    <option value="Arial">Arial</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Courier New">Courier New</option>
                    <option value="Times New Roman">Times New Roman</option>
                  </select>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label
                      className="text-caption text-neutral-500 cursor-ew-resize select-none hover:text-white transition-colors"
                      onPointerDown={(e) => {
                        handleScrub(e, selectedText.fontSize, (val, isFinal) => {
                          updateTextOverlay(selectedText.id, { fontSize: val }, !isFinal);
                        }, { min: 1, max: 500 });
                      }}
                    >
                      Taille (px)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="500"
                      value={selectedText.fontSize}
                      onChange={(e) => updateTextOverlay(selectedText.id, { fontSize: parseInt(e.target.value) })}
                      onPointerDown={(e) => {
                        handleScrub(e, selectedText.fontSize, (val, isFinal) => {
                          updateTextOverlay(selectedText.id, { fontSize: val }, !isFinal);
                        }, { min: 1, max: 500 });
                      }}
                      className="w-16 h-6 text-right bg-white/5 border border-white/10 rounded text-caption text-white focus:ring-1 focus:ring-primary-500 px-1 cursor-ew-resize"
                    />
                  </div>
                  <input
                    type="range"
                    min="12"
                    max="200"
                    value={selectedText.fontSize}
                    onChange={(e) => updateTextOverlay(selectedText.id, { fontSize: parseInt(e.target.value) })}
                    onPointerDown={(e) => {
                      handleScrub(e, selectedText.fontSize, (val, isFinal) => {
                        updateTextOverlay(selectedText.id, { fontSize: val }, !isFinal);
                      }, { min: 1, max: 500 });
                    }}
                    className="w-full cursor-ew-resize"
                  />
                </div>

                {/* Scale Controls */}
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/10">
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label
                        className="text-caption text-neutral-500 cursor-ew-resize select-none hover:text-white transition-colors"
                        onPointerDown={(e) => {
                          handleScrub(e, selectedText.scaleX ?? 1, (val, isFinal) => {
                            updateTextOverlay(selectedText.id, { scaleX: val }, !isFinal);
                          }, { min: 0.1, max: 3, step: 0.01 });
                        }}
                      >
                        Echelle X
                      </label>
                      <span 
                        className="text-[10px] text-neutral-400 cursor-ew-resize select-none hover:text-white transition-colors"
                        onPointerDown={(e) => {
                          handleScrub(e, selectedText.scaleX ?? 1, (val, isFinal) => {
                            updateTextOverlay(selectedText.id, { scaleX: val }, !isFinal);
                          }, { min: 0.1, max: 3, step: 0.01 });
                        }}
                      >
                        {((selectedText.scaleX ?? 1) * 100).toFixed(0)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="3"
                      step="0.1"
                      value={selectedText.scaleX ?? 1}
                      onChange={(e) => updateTextOverlay(selectedText.id, { scaleX: parseFloat(e.target.value) })}
                      onPointerDown={(e) => {
                        handleScrub(e, selectedText.scaleX ?? 1, (val, isFinal) => {
                          updateTextOverlay(selectedText.id, { scaleX: val }, !isFinal);
                        }, { min: 0.1, max: 3, step: 0.01 });
                      }}
                      className="w-full cursor-ew-resize"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label
                        className="text-caption text-neutral-500 cursor-ew-resize select-none hover:text-white transition-colors"
                        onPointerDown={(e) => {
                          handleScrub(e, selectedText.scaleY ?? 1, (val, isFinal) => {
                            updateTextOverlay(selectedText.id, { scaleY: val }, !isFinal);
                          }, { min: 0.1, max: 3, step: 0.01 });
                        }}
                      >
                        Echelle Y
                      </label>
                      <span 
                        className="text-[10px] text-neutral-400 cursor-ew-resize select-none hover:text-white transition-colors"
                        onPointerDown={(e) => {
                          handleScrub(e, selectedText.scaleY ?? 1, (val, isFinal) => {
                            updateTextOverlay(selectedText.id, { scaleY: val }, !isFinal);
                          }, { min: 0.1, max: 3, step: 0.01 });
                        }}
                      >
                        {((selectedText.scaleY ?? 1) * 100).toFixed(0)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="3"
                      step="0.1"
                      value={selectedText.scaleY ?? 1}
                      onChange={(e) => updateTextOverlay(selectedText.id, { scaleY: parseFloat(e.target.value) })}
                      onPointerDown={(e) => {
                        handleScrub(e, selectedText.scaleY ?? 1, (val, isFinal) => {
                          updateTextOverlay(selectedText.id, { scaleY: val }, !isFinal);
                        }, { min: 0.1, max: 3, step: 0.01 });
                      }}
                      className="w-full cursor-ew-resize"
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => updateTextOverlay(selectedText.id, { bold: !selectedText.bold })}
                    className={`btn-icon flex-1 ${selectedText.bold ? 'active' : ''}`}
                  >
                    <Bold className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => updateTextOverlay(selectedText.id, { italic: !selectedText.italic })}
                    className={`btn-icon flex-1 ${selectedText.italic ? 'active' : ''}`}
                  >
                    <Italic className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-3">
                  <label className="text-caption text-neutral-500 block">Couleur du texte</label>
                  
                  {/* Preset Colors Grid */}
                  <div className="grid grid-cols-6 gap-2">
                    {PRESET_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => updateTextOverlay(selectedText.id, { color })}
                        className={`w-8 h-8 rounded-full border border-white/10 flex items-center justify-center transition-transform hover:scale-110 ${
                          selectedText.color.toLowerCase() === color.toLowerCase() ? 'ring-2 ring-primary-500 ring-offset-2 ring-offset-neutral-900' : ''
                        }`}
                        style={{ backgroundColor: color }}
                      >
                        {selectedText.color.toLowerCase() === color.toLowerCase() && (
                          <Check className={`w-4 h-4 ${['#ffffff', '#f43f5e', '#f59e0b', '#10b981'].includes(color.toLowerCase()) ? 'text-black' : 'text-white'}`} />
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Custom Color Picker */}
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <div className="absolute inset-y-0 left-2 flex items-center pointer-events-none">
                        <div 
                          className="w-4 h-4 rounded-full border border-white/20"
                          style={{ backgroundColor: selectedText.color }}
                        />
                      </div>
                      <input
                        type="text"
                        value={selectedText.color}
                        onChange={(e) => updateTextOverlay(selectedText.id, { color: e.target.value })}
                        className="glass-input w-full pl-8 uppercase"
                        placeholder="#000000"
                      />
                    </div>
                    
                    {/* Standard Color Picker Button */}
                    <div className="relative">
                      <button
                        onClick={() => colorInputRef.current?.click()}
                        className="w-10 h-10 overflow-hidden rounded-xl glass-panel-medium hover:border-primary-500/50 transition-colors flex-shrink-0 flex items-center justify-center text-neutral-400 hover:text-white"
                        title="Ouvrir le sélecteur de couleur"
                      >
                        <Palette className="w-5 h-5" />
                      </button>
                      <input
                        ref={colorInputRef}
                        type="color"
                        value={/^#[0-9A-F]{6}$/i.test(selectedText.color) ? selectedText.color : '#000000'}
                        onChange={(e) => updateTextOverlay(selectedText.id, { color: e.target.value })}
                        className="absolute opacity-0 w-0 h-0 bottom-0 right-0 pointer-events-none"
                        style={{ visibility: 'hidden' }}
                      />
                    </div>

                    {/* EyeDropper Button */}
                    <button
                      onClick={() => handleEyeDropper(selectedText.id, 'color')}
                      className="w-10 h-10 flex items-center justify-center rounded-xl glass-panel-medium hover:border-primary-500/50 transition-colors text-neutral-400 hover:text-white flex-shrink-0"
                      title="Pipette (Selectionner une couleur sur l'ecran)"
                    >
                      <Pipette className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Background Color Section */}
                <div className="space-y-3 pt-2 border-t border-white/10">
                  <div className="flex items-center justify-between">
                    <label className="text-caption text-neutral-500">Arrière-plan</label>
                    {selectedText.backgroundColor && (
                      <button 
                        onClick={() => updateTextOverlay(selectedText.id, { backgroundColor: undefined })}
                        className="text-xs text-error hover:underline"
                      >
                        Supprimer
                      </button>
                    )}
                  </div>
                  
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <div className="absolute inset-y-0 left-2 flex items-center pointer-events-none">
                        {selectedText.backgroundColor ? (
                          <div 
                            className="w-4 h-4 rounded-full border border-white/20"
                            style={{ backgroundColor: selectedText.backgroundColor }}
                          />
                        ) : (
                          <div className="w-4 h-4 rounded-full border border-white/20 bg-transparent relative overflow-hidden">
                            <div className="absolute inset-0 bg-red-500/50 rotate-45 w-[1px] h-[150%] top-[-25%] left-1/2 transform -translate-x-1/2"></div>
                          </div>
                        )}
                      </div>
                      <input
                        type="text"
                        value={selectedText.backgroundColor || ''}
                        onChange={(e) => updateTextOverlay(selectedText.id, { backgroundColor: e.target.value })}
                        className="glass-input w-full pl-8 uppercase"
                        placeholder="Transparent"
                      />
                    </div>
                    
                    {/* Standard Color Picker Button */}
                    <div className="relative">
                      <button
                        onClick={() => bgColorInputRef.current?.click()}
                        className="w-10 h-10 overflow-hidden rounded-xl glass-panel-medium hover:border-primary-500/50 transition-colors flex-shrink-0 flex items-center justify-center text-neutral-400 hover:text-white"
                        title="Ouvrir le sélecteur de couleur"
                      >
                        <Palette className="w-5 h-5" />
                      </button>
                      <input
                        ref={bgColorInputRef}
                        type="color"
                        value={selectedText.backgroundColor && /^#[0-9A-F]{6}$/i.test(selectedText.backgroundColor) ? selectedText.backgroundColor : '#000000'}
                        onChange={(e) => updateTextOverlay(selectedText.id, { backgroundColor: e.target.value })}
                        className="absolute opacity-0 w-0 h-0 bottom-0 right-0 pointer-events-none"
                        style={{ visibility: 'hidden' }}
                      />
                    </div>

                    {/* EyeDropper Button */}
                    <button
                      onClick={() => handleEyeDropper(selectedText.id, 'backgroundColor')}
                      className="w-10 h-10 flex items-center justify-center rounded-xl glass-panel-medium hover:border-primary-500/50 transition-colors text-neutral-400 hover:text-white flex-shrink-0"
                      title="Pipette (Selectionner une couleur sur l'ecran)"
                    >
                      <Pipette className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            </Section>

            <Section 
              id="text-position" 
              title="Position" 
              isExpanded={expandedSection === 'text-position'} 
              onToggle={() => setExpandedSection(expandedSection === 'text-position' ? null : 'text-position')}
            >
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label 
                      className="text-caption text-neutral-500 cursor-ew-resize select-none hover:text-white transition-colors"
                      onPointerDown={(e) => {
                        handleScrub(e, selectedText.x, (val, isFinal) => {
                          updateTextOverlay(selectedText.id, { x: val }, !isFinal);
                        }, { min: 0, max: 100 });
                      }}
                    >
                      Position X
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={selectedText.x}
                      onChange={(e) => updateTextOverlay(selectedText.id, { x: parseInt(e.target.value) })}
                      onPointerDown={(e) => {
                        handleScrub(e, selectedText.x, (val, isFinal) => {
                          updateTextOverlay(selectedText.id, { x: val }, !isFinal);
                        }, { min: 0, max: 100 });
                      }}
                      className="w-16 h-6 text-right bg-white/5 border border-white/10 rounded text-caption text-white focus:ring-1 focus:ring-primary-500 px-1 cursor-ew-resize"
                    />
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={selectedText.x}
                    onChange={(e) => updateTextOverlay(selectedText.id, { x: parseInt(e.target.value) })}
                    onPointerDown={(e) => {
                      handleScrub(e, selectedText.x, (val, isFinal) => {
                        updateTextOverlay(selectedText.id, { x: val }, !isFinal);
                      }, { min: 0, max: 100 });
                    }}
                    className="w-full cursor-ew-resize"
                  />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label 
                      className="text-caption text-neutral-500 cursor-ew-resize select-none hover:text-white transition-colors"
                      onPointerDown={(e) => {
                        handleScrub(e, selectedText.y, (val, isFinal) => {
                          updateTextOverlay(selectedText.id, { y: val }, !isFinal);
                        }, { min: 0, max: 100 });
                      }}
                    >
                      Position Y
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={selectedText.y}
                      onChange={(e) => updateTextOverlay(selectedText.id, { y: parseInt(e.target.value) })}
                      onPointerDown={(e) => {
                        handleScrub(e, selectedText.y, (val, isFinal) => {
                          updateTextOverlay(selectedText.id, { y: val }, !isFinal);
                        }, { min: 0, max: 100 });
                      }}
                      className="w-16 h-6 text-right bg-white/5 border border-white/10 rounded text-caption text-white focus:ring-1 focus:ring-primary-500 px-1 cursor-ew-resize"
                    />
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={selectedText.y}
                    onChange={(e) => updateTextOverlay(selectedText.id, { y: parseInt(e.target.value) })}
                    onPointerDown={(e) => {
                      handleScrub(e, selectedText.y, (val, isFinal) => {
                        updateTextOverlay(selectedText.id, { y: val }, !isFinal);
                      }, { min: 0, max: 100 });
                    }}
                    className="w-full cursor-ew-resize"
                  />
                </div>
              </div>
            </Section>

            <Section 
              id="text-timing" 
              title="Timing" 
              isExpanded={expandedSection === 'text-timing'} 
              onToggle={() => setExpandedSection(expandedSection === 'text-timing' ? null : 'text-timing')}
            >
              <div className="space-y-4">
                <div>
                  <label className="text-caption text-neutral-500 block mb-2">Apparition</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={selectedText.startTime}
                    onChange={(e) => updateTextOverlay(selectedText.id, { startTime: parseFloat(e.target.value) })}
                    className="glass-input w-full h-10"
                  />
                </div>
                <div>
                  <label className="text-caption text-neutral-500 block mb-2">Duree (secondes)</label>
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={selectedText.duration}
                    onChange={(e) => updateTextOverlay(selectedText.id, { duration: parseFloat(e.target.value) })}
                    className="glass-input w-full h-10"
                  />
                </div>
              </div>
            </Section>

            <div className="p-4">
              <button
                onClick={() => removeTextOverlay(selectedText.id)}
                className="w-full btn-secondary h-10 text-error hover:bg-error/10 hover:border-error/30"
              >
                <Trash2 className="w-4 h-4" />
                Supprimer le texte
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 px-4 py-8 text-center text-neutral-500">
            <Type className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-body">Aucun texte selectionne</p>
            <p className="text-small mt-1">Ajoutez ou selectionnez un texte</p>
          </div>
        )}
      </div>
    );
  };

  const renderTransitions = () => {
    // If no clip is selected, try to find the clip at the playhead
    let targetClip = selectedClip;
    
    if (!targetClip) {
      targetClip = tracks
        .flatMap(t => t.clips)
        .find(c => {
          const start = c.startTime;
          const end = c.startTime + (c.duration - c.trimStart - c.trimEnd);
          return player.currentTime >= start && player.currentTime < end;
        }) || null;
    }

    if (!targetClip) {
      return (
        <div className="px-4 py-8 text-center text-neutral-500">
          <Move className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-body">Aucun clip selectionne</p>
          <p className="text-small mt-1">Placez le curseur sur un clip ou selectionnez-en un</p>
        </div>
      );
    }

    const currentTransition = transitions.find(t => t.clipId === targetClip!.id);
    const categories = Array.from(new Set(AVAILABLE_TRANSITIONS.map(t => t.category)));

    return (
      <div className="p-4 space-y-4">
        <p className="text-small text-neutral-500">
          Transition pour : <span className="text-white font-medium">{targetClip.name}</span>
        </p>
        
        {/* Preview area */}
        {previewTransition && (
          <div className="glass-panel p-3 rounded-xl">
            <p className="text-caption text-neutral-600 mb-2">Apercu :</p>
            <div className="w-full h-24">
              <TransitionPreview type={previewTransition} />
            </div>
            <p className="text-caption text-neutral-700 mt-2">
              {AVAILABLE_TRANSITIONS.find(t => t.type === previewTransition)?.description}
            </p>
          </div>
        )}
        
        {/* Transitions by category */}
        {categories.map((category) => {
          const categoryTransitions = AVAILABLE_TRANSITIONS.filter(t => t.category === category);
          return (
            <div key={category}>
              <p className="text-caption text-neutral-500 uppercase mb-2">
                {category === 'basic' ? 'Basiques' : 
                 category === 'slide' ? 'Glissements' :
                 category === 'wipe' ? 'Balayages' :
                 category === 'zoom' ? 'Zooms' :
                 category === 'rotate' ? 'Rotations' :
                 category === 'shape' ? 'Formes' : 'Effets'}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {categoryTransitions.map((transition) => {
                  const handleDragStart = (e: React.DragEvent) => {
                    if (transition.type !== 'none') {
                      e.dataTransfer.setData('application/json', JSON.stringify({
                        type: 'NEW_TRANSITION',
                        transitionType: transition.type
                      }));
                      e.dataTransfer.effectAllowed = 'copy';
                    }
                  };

                  const handleClick = () => {
                    if (transition.type === 'none') {
                      removeTransition(targetClip!.id);
                      setPreviewTransition(null);
                    } else {
                      setTransition(targetClip!.id, transition.type, 0.5);
                      setPreviewTransition(transition.type);
                    }
                  };

                  return (
                  <button
                    key={transition.type}
                    draggable={transition.type !== 'none'}
                    onDragStart={handleDragStart}
                    onClick={handleClick}
                    className={`group relative overflow-hidden p-2 rounded-xl text-caption font-medium transition-all ${
                      (currentTransition?.type === transition.type) || 
                      (!currentTransition && transition.type === 'none')
                        ? 'bg-primary-500 text-white'
                        : 'glass-panel-medium hover:border-primary-500/50'
                    } ${transition.type !== 'none' ? 'cursor-grab active:cursor-grabbing' : ''}`}
                  >
                    <div className="h-12 mb-1 rounded overflow-hidden opacity-60 group-hover:opacity-100 transition-opacity">
                      <TransitionPreview type={transition.type} />
                    </div>
                    <div className="text-center truncate">{transition.name}</div>
                  </button>
                )})}
              </div>
            </div>
          );
        })}

        {currentTransition && currentTransition.type !== 'none' && (
          <div className="mt-4">
            <label 
              className="text-caption text-neutral-500 block mb-2 cursor-ew-resize select-none touch-none"
              onPointerDown={(e) => handleScrub(e, currentTransition.duration, (val) => setTransition(targetClip!.id, currentTransition.type, val), { min: 0.1, max: 2, step: 0.01 })}
            >
              Duree ({currentTransition.duration}s)
            </label>
            <input
              type="range"
              min="0.1"
              max="2"
              step="0.1"
              value={currentTransition.duration}
              onChange={(e) => setTransition(targetClip!.id, currentTransition.type, parseFloat(e.target.value))}
              onPointerDown={(e) => {
                handleScrub(e, currentTransition.duration, (val) => setTransition(targetClip!.id, currentTransition.type, val), { min: 0.1, max: 2, step: 0.01 });
              }}
              className="w-full cursor-ew-resize"
            />
          </div>
        )}
      </div>
    );
  };

  const renderFilters = () => {
    if (!selectedClip) {
      return (
        <div className="px-4 py-8 text-center text-neutral-500">
          <Sliders className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-body">Selectionnez un clip</p>
          <p className="text-small mt-1">pour appliquer des filtres</p>
        </div>
      );
    }

    const filter = selectedFilter || { ...DEFAULT_FILTER };

    const updateFilter = (updates: Partial<VideoFilter>) => {
      setFilter(selectedClip.id, { ...filter, ...updates });
    };

    return (
      <div className="p-4 space-y-4">
        {/* Presets */}
        <div>
          <label className="text-caption text-neutral-500 block mb-2">Presets</label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => resetFilter(selectedClip.id)}
              className="px-3 py-1.5 rounded-lg text-small glass-panel-medium hover:border-primary-500/50"
            >
              Normal
            </button>
            <button
              onClick={() => updateFilter({ grayscale: true, sepia: false })}
              className="px-3 py-1.5 rounded-lg text-small glass-panel-medium hover:border-primary-500/50"
            >
              Noir & Blanc
            </button>
            <button
              onClick={() => updateFilter({ sepia: true, grayscale: false })}
              className="px-3 py-1.5 rounded-lg text-small glass-panel-medium hover:border-primary-500/50"
            >
              Sepia
            </button>
            <button
              onClick={() => updateFilter({ contrast: 20, saturation: 20 })}
              className="px-3 py-1.5 rounded-lg text-small glass-panel-medium hover:border-primary-500/50"
            >
              Vivid
            </button>
          </div>
        </div>

        {/* Sliders */}
        <div>
          <label 
            className="text-caption text-neutral-500 block mb-2 cursor-ew-resize select-none touch-none"
            onPointerDown={(e) => handleScrub(e, filter.brightness, (val) => updateFilter({ brightness: val }), { min: -100, max: 100 })}
          >
            Luminosite ({filter.brightness})
          </label>
          <input
            type="range"
            min="-100"
            max="100"
            value={filter.brightness}
            onChange={(e) => updateFilter({ brightness: parseInt(e.target.value) })}
            onPointerDown={(e) => {
              handleScrub(e, filter.brightness, (val) => updateFilter({ brightness: val }), { min: -100, max: 100 });
            }}
            className="w-full cursor-ew-resize"
          />
        </div>

        <div>
          <label 
            className="text-caption text-neutral-500 block mb-2 cursor-ew-resize select-none touch-none"
            onPointerDown={(e) => handleScrub(e, filter.contrast, (val) => updateFilter({ contrast: val }), { min: -100, max: 100 })}
          >
            Contraste ({filter.contrast})
          </label>
          <input
            type="range"
            min="-100"
            max="100"
            value={filter.contrast}
            onChange={(e) => updateFilter({ contrast: parseInt(e.target.value) })}
            onPointerDown={(e) => {
              handleScrub(e, filter.contrast, (val) => updateFilter({ contrast: val }), { min: -100, max: 100 });
            }}
            className="w-full cursor-ew-resize"
          />
        </div>

        <div>
          <label 
            className="text-caption text-neutral-500 block mb-2 cursor-ew-resize select-none touch-none"
            onPointerDown={(e) => handleScrub(e, filter.saturation, (val) => updateFilter({ saturation: val }), { min: -100, max: 100 })}
          >
            Saturation ({filter.saturation})
          </label>
          <input
            type="range"
            min="-100"
            max="100"
            value={filter.saturation}
            onChange={(e) => updateFilter({ saturation: parseInt(e.target.value) })}
            onPointerDown={(e) => {
              handleScrub(e, filter.saturation, (val) => updateFilter({ saturation: val }), { min: -100, max: 100 });
            }}
            className="w-full cursor-ew-resize"
          />
        </div>

        <div>
          <label 
            className="text-caption text-neutral-500 block mb-2 cursor-ew-resize select-none touch-none"
            onPointerDown={(e) => handleScrub(e, filter.blur, (val) => updateFilter({ blur: val }), { min: 0, max: 20 })}
          >
            Flou ({filter.blur})
          </label>
          <input
            type="range"
            min="0"
            max="20"
            value={filter.blur}
            onChange={(e) => updateFilter({ blur: parseInt(e.target.value) })}
            onPointerDown={(e) => {
              handleScrub(e, filter.blur, (val) => updateFilter({ blur: val }), { min: 0, max: 20 });
            }}
            className="w-full cursor-ew-resize"
          />
        </div>

        <button
          onClick={() => resetFilter(selectedClip.id)}
          className="w-full btn-secondary h-10 mt-4"
        >
          Reinitialiser
        </button>
      </div>
    );
  };

  // Render panel content
  const renderPanelContent = () => (
    <>
      {/* Tabs */}
      {!initialTab && (
        <div className="flex border-b border-white/10 overflow-x-auto flex-shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 ${isMinimal ? 'min-w-[50px] py-2' : isCompact ? 'min-w-[55px] py-2.5' : 'min-w-[60px] py-3'} flex flex-col items-center gap-0.5 ${isMinimal ? 'text-[0.55rem]' : isCompact ? 'text-[0.6rem]' : 'text-caption'} transition-colors touch-target ${
                activeTab === tab.id
                  ? 'text-primary-500 bg-primary-50/10'
                  : 'text-neutral-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <tab.icon className={`${isMinimal ? 'w-3 h-3' : isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
              <span className={`${isMinimal ? 'hidden' : 'inline'}`}>{tab.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {activeTab === 'clip' && renderClipProperties()}
        {activeTab === 'text' && renderTextProperties()}
        {activeTab === 'transitions' && renderTransitions()}
        {activeTab === 'filters' && renderFilters()}
      </div>
    </>
  );

  // For minimal/fold-cover mode, render as bottom sheet
  if (isMinimal && responsive.foldState === 'folded') {
    return (
      <>
        {/* Bottom sheet trigger button */}
        <button
          onClick={() => setIsBottomSheetOpen(true)}
          className="fixed bottom-20 right-4 z-40 w-12 h-12 rounded-full bg-primary-500 text-white shadow-lg flex items-center justify-center touch-target-lg"
          aria-label="Open properties panel"
        >
          <Sliders className="w-5 h-5" />
        </button>
        
        {/* Bottom sheet overlay */}
        {isBottomSheetOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-50 fold-transition"
            onClick={() => setIsBottomSheetOpen(false)}
          />
        )}
        
        {/* Bottom sheet panel */}
        <div
          ref={bottomSheetRef}
          className={`fixed left-0 right-0 bottom-0 z-50 glass-panel rounded-t-2xl fold-transition ${
            isBottomSheetOpen ? 'translate-y-0' : 'translate-y-full'
          }`}
          style={{ height: `${bottomSheetHeight}vh` }}
        >
          {/* Drag handle */}
          <div
            className="flex justify-center py-3 cursor-grab active:cursor-grabbing touch-target"
            onTouchStart={handleBottomSheetDragStart}
            onMouseDown={handleBottomSheetDragStart}
          >
            <div className="w-10 h-1 bg-white/30 rounded-full" />
          </div>
          
          {/* Header with close button */}
          <div className="px-4 pb-2 flex items-center justify-between border-b border-white/10">
            <h2 className="text-base font-semibold text-white">Propriétés</h2>
            <button
              onClick={() => setIsBottomSheetOpen(false)}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 touch-target"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>
          
          {/* Panel content */}
          <div className="flex flex-col h-[calc(100%-60px)] overflow-hidden">
            {renderPanelContent()}
          </div>
        </div>
      </>
    );
  }

  // Standard panel layout for other modes
  return (
    <div className={`glass-panel h-full flex flex-col overflow-hidden fold-transition ${responsive.isSpanning ? 'avoid-hinge' : ''}`}>
      {/* Header */}
      <div className={`${isMinimal ? 'px-2 py-1.5' : isCompact ? 'px-3 py-2' : 'px-4 py-3'} border-b border-white/20 flex-shrink-0`}>
        <h2 className={`${isMinimal ? 'text-sm' : isCompact ? 'text-base' : 'text-h3'} font-semibold text-white`}>Propriétés</h2>
      </div>

      {renderPanelContent()}
    </div>
  );
};

export default PropertiesPanel;
