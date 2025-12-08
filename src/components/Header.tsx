// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState } from 'react';
import { 
  Film, 
  FolderOpen, 
  Save, 
  Download, 
  Undo2, 
  Redo2,
  Settings,
  HelpCircle,
  ChevronDown,
  Menu,
  PanelLeftClose,
  PanelLeft,
  Plus,
  Trash2
} from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { useResponsive, useLayoutMode } from '../hooks/use-responsive';

interface HeaderProps {
  isSidebarVisible: boolean;
  onToggleSidebar: () => void;
}

export const Header: React.FC<HeaderProps> = ({ isSidebarVisible, onToggleSidebar }) => {
  const { 
    projectName, 
    setProjectName, 
    openExportModal,
    projects,
    currentProjectId,
    createProject,
    loadProject,
    deleteProject,
    undo,
    redo
  } = useEditorStore();
  
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(projectName);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);

  // Use responsive hook for foldable-aware sizing
  const responsive = useResponsive();
  const layoutMode = useLayoutMode();
  
  // Determine size variants based on layout mode
  const isMinimal = layoutMode === 'minimal';
  const isCompact = layoutMode === 'compact';
  const isAdaptive = layoutMode === 'adaptive';
  const isExpanded = layoutMode === 'expanded';
  const isDesktop = layoutMode === 'desktop';
  
  // Touch target sizes based on device
  const touchTargetSize = responsive.touchTargetSize;

  const handleNameSubmit = () => {
    if (tempName.trim()) {
      setProjectName(tempName.trim());
    }
    setIsEditingName(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameSubmit();
    } else if (e.key === 'Escape') {
      setTempName(projectName);
      setIsEditingName(false);
    }
  };

  // Dynamic header height based on layout mode
  const getHeaderHeight = () => {
    if (isMinimal) return 'h-10';
    if (isCompact) return 'h-11';
    if (isAdaptive) return 'h-12';
    return 'h-14'; // expanded and desktop
  };

  // Dynamic button sizes for touch targets
  const getButtonSize = () => {
    if (isMinimal) return 'w-8 h-8';
    if (isCompact) return 'w-9 h-9';
    if (isAdaptive) return 'w-10 h-10';
    return 'w-9 h-9'; // desktop can be slightly smaller
  };

  const getIconSize = () => {
    if (isMinimal) return 'w-4 h-4';
    if (isCompact) return 'w-4 h-4';
    return 'w-5 h-5';
  };

  return (
    <header className={`${getHeaderHeight()} bg-[#0f0f0f] border-b border-white/10 flex items-center justify-between px-2 fold-cover:px-1.5 fold-open:px-3 sm:px-4 z-50 relative flex-shrink-0`}>
      {/* Left Section */}
      <div className="flex items-center gap-2 fold-cover:gap-1.5 fold-open:gap-3 sm:gap-4 flex-1 min-w-0">
        {/* Toggle Sidebar Button - Always visible with proper touch target */}
        <button
          onClick={onToggleSidebar}
          className={`${getButtonSize()} rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0 touch-target`}
          title={isSidebarVisible ? 'Masquer le panneau' : 'Afficher le panneau'}
        >
          {isSidebarVisible ? (
            <PanelLeftClose className={getIconSize()} />
          ) : (
            <PanelLeft className={getIconSize()} />
          )}
        </button>

        {/* Logo and App Name */}
        <div className="flex items-center gap-1 fold-cover:gap-0.5 fold-open:gap-1.5 sm:gap-2 flex-shrink-0">
          <div className={`${isMinimal ? 'w-6 h-6' : isCompact ? 'w-7 h-7' : 'w-8 h-8'} rounded-lg bg-primary-500 flex items-center justify-center`}>
            <Film className={`${isMinimal ? 'w-3 h-3' : isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4'} text-white`} />
          </div>
          {/* Hide app name on minimal/fold cover screens */}
          <span className={`text-sm fold-cover:hidden fold-open:inline sm:text-base font-semibold text-white ${isMinimal ? 'hidden' : ''}`}>
            osivibe
          </span>
        </div>
        
        {/* Divider - Hidden on small screens */}
        <div className="hidden fold-open:block md:block w-px h-6 bg-white/20" />
        
        {/* Project Name & Management - Hidden on minimal/compact */}
        <div className={`${isMinimal || isCompact ? 'hidden' : 'hidden md:flex'} items-center gap-2`}>
          {isEditingName ? (
            <input
              type="text"
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              onBlur={handleNameSubmit}
              onKeyDown={handleKeyDown}
              autoFocus
              className="bg-white/10 border border-white/20 rounded-lg h-8 text-sm px-3 w-48 text-white focus:border-primary-500 focus:outline-none"
              placeholder="Nom du projet"
            />
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setTempName(projectName);
                  setIsEditingName(true);
                }}
                className="text-sm text-white font-medium hover:text-primary-400 transition-colors truncate max-w-[200px]"
                title="Renommer le projet"
              >
                {projectName}
              </button>
              
              {/* Project Menu */}
              <div className="relative">
                <button
                  onClick={() => setIsProjectMenuOpen(!isProjectMenuOpen)}
                  className="w-6 h-6 rounded flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 transition-colors touch-target-sm"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
                
                {isProjectMenuOpen && (
                  <>
                    <div 
                      className="fixed inset-0 z-40" 
                      onClick={() => setIsProjectMenuOpen(false)} 
                    />
                    <div className="absolute top-full left-0 mt-2 w-64 bg-[#1f1f1f] border border-white/10 rounded-lg shadow-xl z-50 py-1 max-h-[300px] overflow-y-auto">
                      <div className="px-3 py-2 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                        Projets récents
                      </div>
                      {projects.map(p => (
                        <div 
                          key={p.id} 
                          className={`flex items-center justify-between px-3 py-2 hover:bg-white/5 cursor-pointer group ${p.id === currentProjectId ? 'bg-white/5' : ''}`}
                          onClick={() => {
                            loadProject(p.id);
                            setIsProjectMenuOpen(false);
                          }}
                        >
                          <div className="flex items-center gap-2 overflow-hidden">
                            <FolderOpen className={`w-4 h-4 flex-shrink-0 ${p.id === currentProjectId ? 'text-primary-500' : 'text-neutral-500'}`} />
                            <span className={`text-sm truncate ${p.id === currentProjectId ? 'text-white font-medium' : 'text-neutral-300'}`}>
                              {p.name}
                            </span>
                          </div>
                          
                          {projects.length > 1 && (
                            <button 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                deleteProject(p.id); 
                              }} 
                              className="w-6 h-6 rounded flex items-center justify-center text-neutral-500 hover:text-red-500 hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-all"
                              title="Supprimer le projet"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          
          {/* New Project Button */}
          <button
            onClick={createProject}
            className={`${getButtonSize()} rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 transition-colors ml-1 touch-target`}
            title="Nouveau projet"
          >
            <Plus className={getIconSize()} />
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 fold-cover:gap-0.5 fold-open:gap-1.5 sm:gap-2">
        {/* Undo/Redo - Hidden on minimal, shown on larger screens */}
        <div className={`${isMinimal ? 'hidden' : 'hidden'} fold-open:flex lg:flex items-center gap-1`}>
          <button 
            onClick={undo}
            className={`${getButtonSize()} rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 transition-colors touch-target`}
            title="Annuler (Ctrl+Z)"
          >
            <Undo2 className={getIconSize()} />
          </button>
          <button 
            onClick={redo}
            className={`${getButtonSize()} rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 transition-colors touch-target`}
            title="Refaire (Ctrl+Y)"
          >
            <Redo2 className={getIconSize()} />
          </button>
        </div>

        {/* Divider - Hidden on small screens */}
        <div className="hidden fold-open:block lg:block w-px h-6 bg-white/20 mx-1" />

        {/* Export button - Always visible with adaptive sizing */}
        <button
          onClick={openExportModal}
          className={`bg-primary-500 hover:bg-primary-600 text-white ${
            isMinimal ? 'h-8 px-2' : isCompact ? 'h-9 px-3' : 'h-9 px-4'
          } rounded-lg flex items-center gap-1 fold-open:gap-2 text-xs fold-open:text-sm font-medium transition-colors flex-shrink-0 touch-target`}
        >
          <Download className={`${isMinimal ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
          {/* Hide text on minimal screens */}
          <span className={`${isMinimal ? 'hidden' : 'hidden'} fold-cover:hidden xs:inline`}>
            Exporter
          </span>
        </button>
      </div>
    </header>
  );
};

export default Header;
