// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState, useRef, useEffect } from 'react';
import { 
  Scissors,
  Type,
  Wand2,
  Palette,
  Music,
  Split,
  Trash2,
  Copy,
  MoreHorizontal,
  X
} from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { useResponsive, useLayoutMode } from '../hooks/use-responsive';

export const Toolbar: React.FC = () => {
  const {
    ui,
    tracks,
    player,
    splitClip,
    removeClip,
    addTextOverlay,
    setActivePanel,
  } = useEditorStore();

  // Use responsive hook for adaptive toolbar
  const responsive = useResponsive();
  const layoutMode = useLayoutMode();
  
  // State for overflow menu
  const [isOverflowMenuOpen, setIsOverflowMenuOpen] = useState(false);
  const overflowMenuRef = useRef<HTMLDivElement>(null);

  // Determine layout characteristics
  const isMinimal = layoutMode === 'minimal';
  const isCompact = layoutMode === 'compact';
  const isAdaptive = layoutMode === 'adaptive';
  const isExpanded = layoutMode === 'expanded';
  const isDesktop = layoutMode === 'desktop';
  
  // Determine how many tools to show based on screen width
  const getVisibleToolCount = () => {
    if (isMinimal) return 2; // Only essential tools
    if (isCompact) return 3;
    if (isAdaptive) return 4;
    if (isExpanded) return 5;
    return 6; // Desktop shows all
  };

  const selectedClip = ui.selectedClipId
    ? tracks.flatMap(t => t.clips).find(c => c.id === ui.selectedClipId)
    : null;

  const handleSplit = () => {
    if (!selectedClip) return;
    
    const clipStart = selectedClip.startTime;
    const clipEnd = selectedClip.startTime + (selectedClip.duration - selectedClip.trimStart - selectedClip.trimEnd);
    
    if (player.currentTime > clipStart && player.currentTime < clipEnd) {
      splitClip(selectedClip.id, player.currentTime);
    }
  };

  const handleDelete = () => {
    if (selectedClip) {
      removeClip(selectedClip.id);
    }
  };

  const handleAddText = () => {
    addTextOverlay({ startTime: player.currentTime });
    setActivePanel('text');
  };

  // All available tools
  const allTools = [
    {
      id: 'split',
      icon: Split,
      label: 'Couper',
      shortLabel: 'Cut',
      onClick: handleSplit,
      disabled: !selectedClip || 
        player.currentTime <= selectedClip?.startTime ||
        player.currentTime >= (selectedClip?.startTime + (selectedClip?.duration - selectedClip.trimStart - selectedClip.trimEnd)),
      tooltip: 'Couper le clip au curseur (S)',
      priority: 1, // Higher priority = shown first
    },
    {
      id: 'text',
      icon: Type,
      label: 'Texte',
      shortLabel: 'Text',
      onClick: handleAddText,
      disabled: false,
      tooltip: 'Ajouter du texte (T)',
      priority: 2,
    },
    {
      id: 'transitions',
      icon: Wand2,
      label: 'Transitions',
      shortLabel: 'Trans.',
      onClick: () => setActivePanel('transitions'),
      disabled: !selectedClip,
      tooltip: 'Transitions',
      priority: 3,
    },
    {
      id: 'filters',
      icon: Palette,
      label: 'Filtres',
      shortLabel: 'Filters',
      onClick: () => setActivePanel('filters'),
      disabled: !selectedClip,
      tooltip: 'Filtres et effets',
      priority: 4,
    },
    {
      id: 'delete',
      icon: Trash2,
      label: 'Supprimer',
      shortLabel: 'Del',
      onClick: handleDelete,
      disabled: !selectedClip,
      tooltip: 'Supprimer (Del)',
      danger: true,
      priority: 5,
    },
  ];

  // Sort tools by priority and split into visible and overflow
  const sortedTools = [...allTools].sort((a, b) => a.priority - b.priority);
  const visibleCount = getVisibleToolCount();
  const visibleTools = sortedTools.slice(0, visibleCount);
  const overflowTools = sortedTools.slice(visibleCount);

  // Close overflow menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (overflowMenuRef.current && !overflowMenuRef.current.contains(event.target as Node)) {
        setIsOverflowMenuOpen(false);
      }
    };

    if (isOverflowMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOverflowMenuOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key.toLowerCase()) {
        case 's':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            handleSplit();
          }
          break;
        case 't':
          e.preventDefault();
          handleAddText();
          break;
        case 'delete':
        case 'backspace':
          if (!e.metaKey) {
            e.preventDefault();
            handleDelete();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedClip, player.currentTime]);

  // Get button size based on layout mode
  const getButtonSize = () => {
    if (isMinimal) return 'h-9 w-9';
    if (isCompact) return 'h-10 w-10';
    return 'h-9'; // Default with auto width for text
  };

  // Get icon size based on layout mode
  const getIconSize = () => {
    if (isMinimal) return 'w-3.5 h-3.5';
    if (isCompact) return 'w-4 h-4';
    return 'w-5 h-5';
  };

  // Determine if we should show labels
  const showLabels = isExpanded || isDesktop;

  return (
    <div className={`glass-panel-medium ${isMinimal ? 'h-10' : isCompact ? 'h-11' : 'h-12'} flex items-center px-2 fold-cover:px-1.5 fold-open:px-3 sm:px-4 gap-1 fold-cover:gap-0.5 fold-open:gap-1.5 sm:gap-2 border-b border-white/10 rounded-none`}>
      {/* Visible Tools */}
      {visibleTools.map((tool, index) => (
        <React.Fragment key={tool.id}>
          {/* Add spacer before delete button on larger screens */}
          {tool.id === 'delete' && (isExpanded || isDesktop) && <div className="flex-1" />}
          
          <button
            onClick={tool.onClick}
            disabled={tool.disabled}
            title={tool.tooltip}
            className={`btn-icon ${getButtonSize()} touch-target ${
              tool.danger ? 'hover:bg-error/10 hover:text-error hover:border-error/30' : ''
            } ${tool.disabled ? 'opacity-40 cursor-not-allowed' : ''} ${
              !showLabels ? 'aspect-square' : ''
            }`}
          >
            <tool.icon className={getIconSize()} />
            {showLabels && (
              <span className="text-caption ml-1 hidden lg:inline">{tool.label}</span>
            )}
          </button>
        </React.Fragment>
      ))}

      {/* Overflow Menu Button */}
      {overflowTools.length > 0 && (
        <div className="relative" ref={overflowMenuRef}>
          <button
            onClick={() => setIsOverflowMenuOpen(!isOverflowMenuOpen)}
            className={`btn-icon ${getButtonSize()} touch-target ${isOverflowMenuOpen ? 'bg-white/10' : ''}`}
            title="Plus d'outils"
          >
            {isOverflowMenuOpen ? (
              <X className={getIconSize()} />
            ) : (
              <MoreHorizontal className={getIconSize()} />
            )}
          </button>

          {/* Overflow Menu Dropdown */}
          {isOverflowMenuOpen && (
            <div className="absolute top-full right-0 mt-2 w-48 bg-[#1f1f1f] border border-white/10 rounded-lg shadow-xl z-50 py-1 overflow-hidden">
              {overflowTools.map((tool) => (
                <button
                  key={tool.id}
                  onClick={() => {
                    tool.onClick();
                    setIsOverflowMenuOpen(false);
                  }}
                  disabled={tool.disabled}
                  className={`w-full px-3 py-2.5 flex items-center gap-3 text-left transition-colors touch-target ${
                    tool.disabled 
                      ? 'opacity-40 cursor-not-allowed' 
                      : tool.danger 
                        ? 'hover:bg-error/10 text-error' 
                        : 'hover:bg-white/10 text-white'
                  }`}
                >
                  <tool.icon className="w-4 h-4 flex-shrink-0" />
                  <span className="text-sm">{tool.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Spacer for layouts without overflow */}
      {overflowTools.length === 0 && !(isExpanded || isDesktop) && <div className="flex-1" />}
    </div>
  );
};

export default Toolbar;
