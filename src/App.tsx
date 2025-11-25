import React, { useEffect, useState } from 'react';
import Header from './components/Header';
import MediaLibrary from './components/MediaLibrary';
import VideoPlayer from './components/VideoPlayer';
import PropertiesPanel from './components/PropertiesPanel';
import Timeline from './components/Timeline';
import Toolbar from './components/Toolbar';
import ExportModal from './components/ExportModal';
import { Film, Type, Scissors, Sliders } from 'lucide-react';
import './index.css';

type SidebarTab = 'media' | 'text' | 'transitions' | 'effects';

function App() {
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>('media');
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#1a1a1a]">
      {/* Header */}
      <Header 
        isSidebarVisible={isSidebarVisible}
        onToggleSidebar={() => setIsSidebarVisible(!isSidebarVisible)}
      />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Navigation - Left */}
        {isSidebarVisible && (
          <div className="w-20 bg-[#0f0f0f] border-r border-white/10 flex flex-col items-center py-4 gap-2">
            <button
              onClick={() => setActiveSidebarTab('media')}
              className={`w-16 h-16 rounded-lg flex flex-col items-center justify-center gap-1 transition-all ${
                activeSidebarTab === 'media'
                  ? 'bg-primary-500 text-white'
                  : 'text-neutral-400 hover:text-white hover:bg-white/10'
              }`}
              title="Média"
            >
              <Film className="w-5 h-5" />
              <span className="text-[10px] font-medium">Média</span>
            </button>
            <button
              onClick={() => setActiveSidebarTab('text')}
              className={`w-16 h-16 rounded-lg flex flex-col items-center justify-center gap-1 transition-all ${
                activeSidebarTab === 'text'
                  ? 'bg-primary-500 text-white'
                  : 'text-neutral-400 hover:text-white hover:bg-white/10'
              }`}
              title="Texte"
            >
              <Type className="w-5 h-5" />
              <span className="text-[10px] font-medium">Texte</span>
            </button>
            <button
              onClick={() => setActiveSidebarTab('transitions')}
              className={`w-16 h-16 rounded-lg flex flex-col items-center justify-center gap-1 transition-all ${
                activeSidebarTab === 'transitions'
                  ? 'bg-primary-500 text-white'
                  : 'text-neutral-400 hover:text-white hover:bg-white/10'
              }`}
              title="Transitions"
            >
              <Scissors className="w-5 h-5" />
              <span className="text-[10px] font-medium">Transition</span>
            </button>
            <button
              onClick={() => setActiveSidebarTab('effects')}
              className={`w-16 h-16 rounded-lg flex flex-col items-center justify-center gap-1 transition-all ${
                activeSidebarTab === 'effects'
                  ? 'bg-primary-500 text-white'
                  : 'text-neutral-400 hover:text-white hover:bg-white/10'
              }`}
              title="Effets"
            >
              <Sliders className="w-5 h-5" />
              <span className="text-[10px] font-medium">Effets</span>
            </button>
          </div>
        )}

        {/* Sidebar Panel Content */}
        {isSidebarVisible && (
          <div className="w-80 bg-[#1a1a1a] border-r border-white/10 overflow-hidden">
            {activeSidebarTab === 'media' && <MediaLibrary />}
            {activeSidebarTab === 'text' && (
              <div className="h-full">
                <PropertiesPanel activeTab="text" />
              </div>
            )}
            {activeSidebarTab === 'transitions' && (
              <div className="h-full">
                <PropertiesPanel activeTab="transitions" />
              </div>
            )}
            {activeSidebarTab === 'effects' && (
              <div className="h-full">
                <PropertiesPanel activeTab="filters" />
              </div>
            )}
          </div>
        )}

        {/* Center Area - Player + Timeline */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#252525]">
          {/* Video Player */}
          <div className="flex-1 overflow-hidden p-4">
            <VideoPlayer />
          </div>

          {/* Timeline */}
          <div className="h-64 border-t border-white/10">
            <Timeline />
          </div>
        </div>
      </div>

      {/* Export Modal */}
      <ExportModal />
    </div>
  );
}

export default App;
