// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useEffect, useState } from 'react';
import Header from './components/Header';
import MediaLibrary from './components/MediaLibrary';
import VideoPlayer from './components/VideoPlayer';
import PropertiesPanel from './components/PropertiesPanel';
import Timeline from './components/Timeline';
import Toolbar from './components/Toolbar';
import ExportModal from './components/ExportModal';
import { Film, Type, Scissors, Sliders, X, ChevronUp, ChevronDown } from 'lucide-react';
import './index.css';

type SidebarTab = 'media' | 'text' | 'transitions' | 'effects';
type MobileView = 'player' | 'timeline' | 'sidebar';

function App() {
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>('media');
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [isVerySmallScreen, setIsVerySmallScreen] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>('player');
  const [isTimelineExpanded, setIsTimelineExpanded] = useState(false);

  // Detect mobile screen and very small screens
  useEffect(() => {
    const checkMobile = () => {
      const width = window.innerWidth;
      setIsMobile(width < 768);
      setIsVerySmallScreen(width <= 374); // iPhone 4, SE 2016, etc.
      // Auto-hide sidebar on mobile
      if (width < 768) {
        setIsSidebarVisible(false);
      }
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Mobile Layout
  if (isMobile) {
    return (
      <div className="h-screen h-[100dvh] flex flex-col overflow-hidden bg-[#1a1a1a]">
        {/* Mobile Header */}
        <Header
          isSidebarVisible={isSidebarVisible}
          onToggleSidebar={() => setIsSidebarVisible(!isSidebarVisible)}
        />

        {/* Mobile Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Video Player - Always visible but can be minimized */}
          <div className={`transition-all duration-300 ease-in-out ${
            isTimelineExpanded ? (isVerySmallScreen ? 'h-24' : 'h-32') : 'flex-1'
          } overflow-hidden bg-[#252525] min-h-0`}>
            <div className="h-full p-1 xs:p-2">
              <VideoPlayer />
            </div>
          </div>

          {/* Timeline Toggle Button */}
          <button
            onClick={() => setIsTimelineExpanded(!isTimelineExpanded)}
            className={`w-full ${isVerySmallScreen ? 'h-6' : 'h-8'} bg-[#1a1a1a] border-t border-white/10 flex items-center justify-center gap-1 xs:gap-2 text-neutral-400 hover:text-white transition-colors`}
          >
            {isTimelineExpanded ? (
              <>
                <ChevronDown className={`${isVerySmallScreen ? 'w-3 h-3' : 'w-4 h-4'}`} />
                <span className={`${isVerySmallScreen ? 'text-[9px]' : 'text-xs'}`}>Réduire</span>
              </>
            ) : (
              <>
                <ChevronUp className={`${isVerySmallScreen ? 'w-3 h-3' : 'w-4 h-4'}`} />
                <span className={`${isVerySmallScreen ? 'text-[9px]' : 'text-xs'}`}>Timeline</span>
              </>
            )}
          </button>

          {/* Timeline - Expandable */}
          <div className={`transition-all duration-300 ease-in-out ${
            isTimelineExpanded ? 'flex-1' : (isVerySmallScreen ? 'h-28' : 'h-36')
          } border-t border-white/10 overflow-hidden min-h-0`}>
            <Timeline />
          </div>

          {/* Mobile Bottom Navigation */}
          <div className={`${isVerySmallScreen ? 'h-11' : 'h-14'} bg-[#0f0f0f] border-t border-white/10 flex items-center justify-around px-1 xs:px-2 safe-area-bottom flex-shrink-0`}>
            <button
              onClick={() => {
                setActiveSidebarTab('media');
                setIsSidebarVisible(true);
              }}
              className={`flex-1 ${isVerySmallScreen ? 'h-9' : 'h-12'} flex flex-col items-center justify-center gap-0 xs:gap-0.5 rounded-lg transition-all ${
                isSidebarVisible && activeSidebarTab === 'media'
                  ? 'bg-primary-500 text-white'
                  : 'text-neutral-400 active:bg-white/10'
              }`}
            >
              <Film className={`${isVerySmallScreen ? 'w-4 h-4' : 'w-5 h-5'}`} />
              <span className={`${isVerySmallScreen ? 'text-[8px]' : 'text-[10px]'} font-medium`}>Média</span>
            </button>
            <button
              onClick={() => {
                setActiveSidebarTab('text');
                setIsSidebarVisible(true);
              }}
              className={`flex-1 ${isVerySmallScreen ? 'h-9' : 'h-12'} flex flex-col items-center justify-center gap-0 xs:gap-0.5 rounded-lg transition-all ${
                isSidebarVisible && activeSidebarTab === 'text'
                  ? 'bg-primary-500 text-white'
                  : 'text-neutral-400 active:bg-white/10'
              }`}
            >
              <Type className={`${isVerySmallScreen ? 'w-4 h-4' : 'w-5 h-5'}`} />
              <span className={`${isVerySmallScreen ? 'text-[8px]' : 'text-[10px]'} font-medium`}>Texte</span>
            </button>
            <button
              onClick={() => {
                setActiveSidebarTab('transitions');
                setIsSidebarVisible(true);
              }}
              className={`flex-1 ${isVerySmallScreen ? 'h-9' : 'h-12'} flex flex-col items-center justify-center gap-0 xs:gap-0.5 rounded-lg transition-all ${
                isSidebarVisible && activeSidebarTab === 'transitions'
                  ? 'bg-primary-500 text-white'
                  : 'text-neutral-400 active:bg-white/10'
              }`}
            >
              <Scissors className={`${isVerySmallScreen ? 'w-4 h-4' : 'w-5 h-5'}`} />
              <span className={`${isVerySmallScreen ? 'text-[8px]' : 'text-[10px]'} font-medium`}>Trans.</span>
            </button>
            <button
              onClick={() => {
                setActiveSidebarTab('effects');
                setIsSidebarVisible(true);
              }}
              className={`flex-1 ${isVerySmallScreen ? 'h-9' : 'h-12'} flex flex-col items-center justify-center gap-0 xs:gap-0.5 rounded-lg transition-all ${
                isSidebarVisible && activeSidebarTab === 'effects'
                  ? 'bg-primary-500 text-white'
                  : 'text-neutral-400 active:bg-white/10'
              }`}
            >
              <Sliders className={`${isVerySmallScreen ? 'w-4 h-4' : 'w-5 h-5'}`} />
              <span className={`${isVerySmallScreen ? 'text-[8px]' : 'text-[10px]'} font-medium`}>Effets</span>
            </button>
          </div>

          {/* Mobile Sidebar Overlay */}
          {isSidebarVisible && (
            <div className="absolute inset-0 z-50 flex flex-col bg-[#1a1a1a]">
              {/* Sidebar Header */}
              <div className={`${isVerySmallScreen ? 'h-10' : 'h-12'} flex items-center justify-between px-3 xs:px-4 border-b border-white/10 flex-shrink-0`}>
                <h2 className={`${isVerySmallScreen ? 'text-xs' : 'text-sm'} font-semibold text-white`}>
                  {activeSidebarTab === 'media' && 'Médias'}
                  {activeSidebarTab === 'text' && 'Texte'}
                  {activeSidebarTab === 'transitions' && 'Transitions'}
                  {activeSidebarTab === 'effects' && 'Effets'}
                </h2>
                <button
                  onClick={() => setIsSidebarVisible(false)}
                  className={`${isVerySmallScreen ? 'w-7 h-7' : 'w-8 h-8'} flex items-center justify-center rounded-lg bg-white/10 text-white`}
                >
                  <X className={`${isVerySmallScreen ? 'w-4 h-4' : 'w-5 h-5'}`} />
                </button>
              </div>
              
              {/* Sidebar Content */}
              <div className="flex-1 overflow-auto min-h-0">
                {activeSidebarTab === 'media' && <MediaLibrary />}
                {activeSidebarTab === 'text' && <PropertiesPanel activeTab="text" />}
                {activeSidebarTab === 'transitions' && <PropertiesPanel activeTab="transitions" />}
                {activeSidebarTab === 'effects' && <PropertiesPanel activeTab="filters" />}
              </div>
            </div>
          )}
        </div>

        {/* Export Modal */}
        <ExportModal />
      </div>
    );
  }

  // Desktop Layout (unchanged)
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
