// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React from 'react';
import { 
  Scissors,
  Type,
  Wand2,
  Palette,
  Music,
  Split,
  Trash2,
  Copy
} from 'lucide-react';
import { useEditorStore } from '../store/editorStore';

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

  const tools = [
    {
      id: 'split',
      icon: Split,
      label: 'Couper',
      onClick: handleSplit,
      disabled: !selectedClip || 
        player.currentTime <= selectedClip?.startTime ||
        player.currentTime >= (selectedClip?.startTime + (selectedClip?.duration - selectedClip.trimStart - selectedClip.trimEnd)),
      tooltip: 'Couper le clip au curseur (S)'
    },
    {
      id: 'text',
      icon: Type,
      label: 'Texte',
      onClick: handleAddText,
      disabled: false,
      tooltip: 'Ajouter du texte (T)'
    },
    {
      id: 'transitions',
      icon: Wand2,
      label: 'Transitions',
      onClick: () => setActivePanel('transitions'),
      disabled: !selectedClip,
      tooltip: 'Transitions'
    },
    {
      id: 'filters',
      icon: Palette,
      label: 'Filtres',
      onClick: () => setActivePanel('filters'),
      disabled: !selectedClip,
      tooltip: 'Filtres et effets'
    },
    {
      id: 'delete',
      icon: Trash2,
      label: 'Supprimer',
      onClick: handleDelete,
      disabled: !selectedClip,
      tooltip: 'Supprimer (Del)',
      danger: true
    },
  ];

  // Keyboard shortcuts
  React.useEffect(() => {
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

  return (
    <div className="glass-panel-medium h-12 flex items-center px-4 gap-2 border-b border-white/10 rounded-none">
      {tools.map((tool, index) => (
        <React.Fragment key={tool.id}>
          {index === tools.length - 1 && <div className="flex-1" />}
          <button
            onClick={tool.onClick}
            disabled={tool.disabled}
            title={tool.tooltip}
            className={`btn-icon h-9 ${
              tool.danger ? 'hover:bg-error/10 hover:text-error hover:border-error/30' : ''
            } ${tool.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <tool.icon className="w-4 h-4" />
            <span className="text-caption ml-1 hidden lg:inline">{tool.label}</span>
          </button>
        </React.Fragment>
      ))}
    </div>
  );
};

export default Toolbar;
