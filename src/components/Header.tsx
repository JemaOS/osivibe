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

  return (
    <header className="h-14 bg-[#0f0f0f] border-b border-white/10 flex items-center justify-between px-4 z-50 relative">
      {/* Left Section */}
      <div className="flex items-center gap-4 flex-1 min-w-0">
        {/* Toggle Sidebar Button */}
        <button
          onClick={onToggleSidebar}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
          title={isSidebarVisible ? 'Masquer le panneau' : 'Afficher le panneau'}
        >
          {isSidebarVisible ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeft className="w-5 h-5" />}
        </button>

        {/* Logo and App Name */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary-500 flex items-center justify-center">
            <Film className="w-4 h-4 text-white" />
          </div>
          <span className="text-base font-semibold text-white hidden sm:inline">osivibe</span>
        </div>
        
        <div className="hidden md:block w-px h-6 bg-white/20" />
        
        {/* Project Name & Management */}
        <div className="hidden md:flex items-center gap-2">
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
                  className="w-6 h-6 rounded flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
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
            className="w-8 h-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 transition-colors ml-1"
            title="Nouveau projet"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Undo/Redo - Hidden on smaller screens */}
        <div className="hidden lg:flex items-center gap-1">
          <button 
            onClick={undo}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 transition-colors" 
            title="Annuler (Ctrl+Z)"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button 
            onClick={redo}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 transition-colors" 
            title="Refaire (Ctrl+Y)"
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>

        <div className="hidden lg:block w-px h-6 bg-white/20 mx-1" />

        {/* Export button */}
        <button 
          onClick={openExportModal}
          className="bg-primary-500 hover:bg-primary-600 text-white h-9 px-4 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors"
        >
          <Download className="w-4 h-4" />
          <span>Exporter</span>
        </button>
      </div>
    </header>
  );
};

export default Header;
