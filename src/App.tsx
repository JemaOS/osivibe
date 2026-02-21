// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useEffect, useState, Suspense, lazy } from 'react';
import Header from './components/Header';
import MediaLibrary from './components/MediaLibrary';
import VideoPlayer from './components/VideoPlayer';
import PropertiesPanel from './components/PropertiesPanel';
import Timeline from './components/Timeline';
import Toolbar from './components/Toolbar';
// ExportModal is lazy loaded to reduce initial bundle size
const ExportModal = lazy(() => import('./components/ExportModal').then(module => ({ default: module.ExportModal })));
import { useEditorStore } from './store/editorStore';
import { useResponsive, useLayoutMode, useIsFoldable } from './hooks/use-responsive';
import { Film, Type, Scissors, Sliders, X, ChevronUp, ChevronDown, GripHorizontal } from 'lucide-react';
import './index.css';

// Footer credit component
const FooterCredit: React.FC<{ compact?: boolean }> = ({ compact = false }) => (
  <footer className={`${compact ? 'py-1' : 'py-2'} px-3 text-center bg-[#0f0f0f] border-t border-white/10 flex-shrink-0`}>
    <p className={`${compact ? 'text-[10px]' : 'text-xs'} text-neutral-500`}>
      Développé par{' '}
      <a
        href="https://www.jematechnology.fr/"
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#757aed] hover:text-[#8b8ff2] hover:underline font-medium transition-colors"
      >
        Jema Technology
      </a>
      {' '}© 2025 • Open Source & Libre
    </p>
  </footer>
);

type SidebarTab = 'media' | 'text' | 'transitions' | 'effects';
type MobileView = 'player' | 'timeline' | 'sidebar';

// Sidebar tab buttons component for reuse
const SidebarTabs = ({ 
  compact = false, 
  activeSidebarTab, 
  setActiveSidebarTab 
}: { 
  compact?: boolean;
  activeSidebarTab: SidebarTab;
  setActiveSidebarTab: (tab: SidebarTab) => void;
}) => (
  <div className={`flex items-center ${compact ? 'gap-0.5' : 'gap-1'} ${compact ? 'px-1' : 'px-2'}`}>
    <button
      onClick={() => setActiveSidebarTab('media')}
      className={`flex-1 ${compact ? 'h-8' : 'h-9'} rounded-lg flex items-center justify-center gap-1 transition-all touch-target ${
        activeSidebarTab === 'media'
          ? 'bg-primary-500 text-white'
          : 'text-neutral-400 hover:text-white hover:bg-white/10'
      }`}
    >
      <Film className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      {!compact && <span className="text-xs font-medium">Média</span>}
    </button>
    <button
      onClick={() => setActiveSidebarTab('text')}
      className={`flex-1 ${compact ? 'h-8' : 'h-9'} rounded-lg flex items-center justify-center gap-1 transition-all touch-target ${
        activeSidebarTab === 'text'
          ? 'bg-primary-500 text-white'
          : 'text-neutral-400 hover:text-white hover:bg-white/10'
      }`}
    >
      <Type className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      {!compact && <span className="text-xs font-medium">Texte</span>}
    </button>
    <button
      onClick={() => setActiveSidebarTab('transitions')}
      className={`flex-1 ${compact ? 'h-8' : 'h-9'} rounded-lg flex items-center justify-center gap-1 transition-all touch-target ${
        activeSidebarTab === 'transitions'
          ? 'bg-primary-500 text-white'
          : 'text-neutral-400 hover:text-white hover:bg-white/10'
      }`}
    >
      <Scissors className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      {!compact && <span className="text-xs font-medium">Trans.</span>}
    </button>
    <button
      onClick={() => setActiveSidebarTab('effects')}
      className={`flex-1 ${compact ? 'h-8' : 'h-9'} rounded-lg flex items-center justify-center gap-1 transition-all touch-target ${
        activeSidebarTab === 'effects'
          ? 'bg-primary-500 text-white'
          : 'text-neutral-400 hover:text-white hover:bg-white/10'
      }`}
    >
      <Sliders className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      {!compact && <span className="text-xs font-medium">Effets</span>}
    </button>
  </div>
);

function App() {
  const { setMobileSidebarOpen } = useEditorStore();
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>('media');
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [mobileView, setMobileView] = useState<MobileView>('player');
  const [isTimelineExpanded, setIsTimelineExpanded] = useState(false);
  const [bottomSheetHeight, setBottomSheetHeight] = useState<'collapsed' | 'half' | 'full'>('collapsed');

  // Use the new responsive hook for foldable-aware layout
  const responsive = useResponsive();
  const layoutMode = useLayoutMode();
  const isFoldable = useIsFoldable();

  // Derive layout states from the responsive hook
  const isMinimal = layoutMode === 'minimal';
  const isCompact = layoutMode === 'compact';
  const isAdaptive = layoutMode === 'adaptive';
  const isExpanded = layoutMode === 'expanded';
  const isDesktop = layoutMode === 'desktop';

  // Backward compatibility flags
  const isMobile = isMinimal || isCompact;
  const isTablet = isAdaptive || isExpanded;

  // Update sidebar visibility based on layout mode
  useEffect(() => {
    if (isMinimal || isCompact) {
      setIsSidebarVisible(false);
    } else {
      setIsSidebarVisible(true);
    }
  }, [layoutMode, isMinimal, isCompact]);

  // Handle fold state changes for smooth transitions
  useEffect(() => {
    if (responsive.foldState === 'folded') {
      // On fold cover, use minimal UI
      setIsTimelineExpanded(false);
      setBottomSheetHeight('collapsed');
    } else if (responsive.foldState === 'unfolded') {
      // On unfolded, can show more UI
      setBottomSheetHeight('half');
    }
  }, [responsive.foldState]);

  // Get dynamic styles based on fold state
  const getFoldAwareStyles = () => {
    if (!isFoldable || !responsive.isSpanning) {
      return {};
    }

    // When spanning across the fold, add padding to avoid the hinge
    return {
      '--hinge-width': `${responsive.hingeWidth}px`,
      '--safe-area-left': `calc(50% - ${responsive.hingeWidth / 2}px)`,
      '--safe-area-right': `calc(50% + ${responsive.hingeWidth / 2}px)`,
    } as React.CSSProperties;
  };

  // Bottom sheet drag handler for mobile
  const handleBottomSheetDrag = (e: React.TouchEvent | React.MouseEvent) => {
    // Simple toggle between states for now
    if (bottomSheetHeight === 'collapsed') {
      setBottomSheetHeight('half');
    } else if (bottomSheetHeight === 'half') {
      setBottomSheetHeight('full');
    } else {
      setBottomSheetHeight('collapsed');
    }
  };

  // ============================================
  // LAYOUT: Minimal (fold cover, very narrow screens < 301px)
  // ============================================
  if (isMinimal) {
    return (
      <div 
        className="h-screen h-[100dvh] flex flex-col overflow-hidden bg-[#1a1a1a] fold-transition"
        style={getFoldAwareStyles()}
      >
        {/* Compact Header for minimal mode */}
        <Header
          isSidebarVisible={isSidebarVisible}
          onToggleSidebar={() => setIsSidebarVisible(!isSidebarVisible)}
        />

        {/* Main Content - Stacked vertically */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Video Player - Compact */}
          <div className={`transition-all duration-300 ease-in-out ${
            isTimelineExpanded ? 'h-20' : 'flex-1'
          } overflow-hidden bg-[#252525] min-h-0`}>
            <div className="h-full p-0.5">
              <VideoPlayer />
            </div>
          </div>

          {/* Timeline Toggle - Touch-friendly */}
          <button
            onClick={() => setIsTimelineExpanded(!isTimelineExpanded)}
            className="w-full h-10 bg-[#1a1a1a] border-t border-white/10 flex items-center justify-center gap-1 text-neutral-400 hover:text-white transition-colors touch-target"
          >
            {isTimelineExpanded ? (
              <>
                <ChevronDown className="w-4 h-4" />
                <span className="text-[10px]">Réduire</span>
              </>
            ) : (
              <>
                <ChevronUp className="w-4 h-4" />
                <span className="text-[10px]">Timeline</span>
              </>
            )}
          </button>

          {/* Timeline - Expandable */}
          <div className={`transition-all duration-300 ease-in-out ${
            isTimelineExpanded ? 'flex-1' : 'h-24'
          } border-t border-white/10 overflow-hidden min-h-0`}>
            <Timeline />
          </div>

          {/* Bottom Navigation - Minimal with larger touch targets */}
          <div className="h-14 bg-[#0f0f0f] border-t border-white/10 flex items-center justify-around px-1 safe-area-bottom flex-shrink-0">
            {['media', 'text', 'transitions', 'effects'].map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setActiveSidebarTab(tab as SidebarTab);
                  setIsSidebarVisible(true);
                  setMobileSidebarOpen(true);
                }}
                className={`flex-1 h-12 flex flex-col items-center justify-center gap-0.5 rounded-lg transition-all touch-target ${
                  isSidebarVisible && activeSidebarTab === tab
                    ? 'bg-primary-500 text-white'
                    : 'text-neutral-400 active:bg-white/10'
                }`}
              >
                {tab === 'media' && <Film className="w-5 h-5" />}
                {tab === 'text' && <Type className="w-5 h-5" />}
                {tab === 'transitions' && <Scissors className="w-5 h-5" />}
                {tab === 'effects' && <Sliders className="w-5 h-5" />}
                <span className="text-[9px] font-medium capitalize">{tab === 'transitions' ? 'Trans.' : tab === 'media' ? 'Média' : tab === 'text' ? 'Texte' : 'Effets'}</span>
              </button>
            ))}
          </div>

          {/* Mobile Sidebar Overlay - Bottom Sheet Style */}
          {isSidebarVisible && (
            <div className="absolute inset-0 z-[70] flex flex-col bg-[#1a1a1a]">
              {/* Drag Handle */}
              <div 
                className="h-8 flex items-center justify-center cursor-grab active:cursor-grabbing touch-target"
                onClick={handleBottomSheetDrag}
              >
                <GripHorizontal className="w-6 h-6 text-neutral-500" />
              </div>
              
              {/* Sidebar Header */}
              <div className="h-10 flex items-center justify-between px-3 border-b border-white/10 flex-shrink-0">
                <h2 className="text-xs font-semibold text-white">
                  {activeSidebarTab === 'media' && 'Médias'}
                  {activeSidebarTab === 'text' && 'Texte'}
                  {activeSidebarTab === 'transitions' && 'Transitions'}
                  {activeSidebarTab === 'effects' && 'Effets'}
                </h2>
                <button
                  onClick={() => {
                    setIsSidebarVisible(false);
                    setMobileSidebarOpen(false);
                  }}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 text-white touch-target"
                >
                  <X className="w-5 h-5" />
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

        {/* Footer Credit */}
        <FooterCredit compact />

        <ExportModal />
      </div>
    );
  }

  // ============================================
  // LAYOUT: Compact (small phones 301-428px)
  // ============================================
  if (isCompact) {
    return (
      <div 
        className="h-screen h-[100dvh] flex flex-col overflow-hidden bg-[#1a1a1a] fold-transition"
        style={getFoldAwareStyles()}
      >
        {/* Mobile Header */}
        <Header
          isSidebarVisible={isSidebarVisible}
          onToggleSidebar={() => setIsSidebarVisible(!isSidebarVisible)}
        />

        {/* Mobile Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Video Player - Always visible but can be minimized */}
          <div className={`transition-all duration-300 ease-in-out ${
            isTimelineExpanded ? 'h-28' : 'flex-1'
          } overflow-hidden bg-[#252525] min-h-0`}>
            <div className="h-full p-1">
              <VideoPlayer />
            </div>
          </div>

          {/* Timeline Toggle Button */}
          <button
            onClick={() => setIsTimelineExpanded(!isTimelineExpanded)}
            className="w-full h-8 bg-[#1a1a1a] border-t border-white/10 flex items-center justify-center gap-2 text-neutral-400 hover:text-white transition-colors touch-target"
          >
            {isTimelineExpanded ? (
              <>
                <ChevronDown className="w-4 h-4" />
                <span className="text-xs">Réduire</span>
              </>
            ) : (
              <>
                <ChevronUp className="w-4 h-4" />
                <span className="text-xs">Timeline</span>
              </>
            )}
          </button>

          {/* Timeline - Expandable */}
          <div className={`transition-all duration-300 ease-in-out ${
            isTimelineExpanded ? 'flex-1' : 'h-32'
          } border-t border-white/10 overflow-hidden min-h-0`}>
            <Timeline />
          </div>

          {/* Mobile Bottom Navigation */}
          <div className="h-14 bg-[#0f0f0f] border-t border-white/10 flex items-center justify-around px-2 safe-area-bottom flex-shrink-0">
            {['media', 'text', 'transitions', 'effects'].map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setActiveSidebarTab(tab as SidebarTab);
                  setIsSidebarVisible(true);
                  setMobileSidebarOpen(true);
                }}
                className={`flex-1 h-12 flex flex-col items-center justify-center gap-0.5 rounded-lg transition-all touch-target ${
                  isSidebarVisible && activeSidebarTab === tab
                    ? 'bg-primary-500 text-white'
                    : 'text-neutral-400 active:bg-white/10'
                }`}
              >
                {tab === 'media' && <Film className="w-5 h-5" />}
                {tab === 'text' && <Type className="w-5 h-5" />}
                {tab === 'transitions' && <Scissors className="w-5 h-5" />}
                {tab === 'effects' && <Sliders className="w-5 h-5" />}
                <span className="text-[10px] font-medium capitalize">{tab === 'transitions' ? 'Trans.' : tab === 'media' ? 'Média' : tab === 'text' ? 'Texte' : 'Effets'}</span>
              </button>
            ))}
          </div>

          {/* Mobile Sidebar Overlay */}
          {isSidebarVisible && (
            <div className="absolute inset-0 z-[70] flex flex-col bg-[#1a1a1a]">
              {/* Sidebar Header */}
              <div className="h-12 flex items-center justify-between px-4 border-b border-white/10 flex-shrink-0">
                <h2 className="text-sm font-semibold text-white">
                  {activeSidebarTab === 'media' && 'Médias'}
                  {activeSidebarTab === 'text' && 'Texte'}
                  {activeSidebarTab === 'transitions' && 'Transitions'}
                  {activeSidebarTab === 'effects' && 'Effets'}
                </h2>
                <button
                  onClick={() => {
                    setIsSidebarVisible(false);
                    setMobileSidebarOpen(false);
                  }}
                  className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/10 text-white touch-target"
                >
                  <X className="w-5 h-5" />
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

        {/* Footer Credit */}
        <FooterCredit compact />

        <ExportModal />
      </div>
    );
  }

  // ============================================
  // LAYOUT: Adaptive (large phones, foldables unfolded 428-719px)
  // ============================================
  if (isAdaptive) {
    return (
      <div 
        className="h-screen h-[100dvh] flex flex-col overflow-hidden bg-[#1a1a1a] fold-transition"
        style={getFoldAwareStyles()}
      >
        {/* Header */}
        <Header
          isSidebarVisible={isSidebarVisible}
          onToggleSidebar={() => setIsSidebarVisible(!isSidebarVisible)}
        />

        {/* Main Content - Horizontal split for adaptive */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - Sidebar (collapsible) */}
          {isSidebarVisible && (
            <div className={`${responsive.isSpanning ? 'w-[calc(50%-var(--hinge-width,0px)/2)]' : 'w-64'} flex flex-col bg-[#1a1a1a] border-r border-white/10 avoid-hinge`}>
              {/* Sidebar Tabs */}
              <div className="h-11 flex items-center border-b border-white/10">
                <SidebarTabs 
                  compact={responsive.width < 500} 
                  activeSidebarTab={activeSidebarTab}
                  setActiveSidebarTab={setActiveSidebarTab}
                />
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

          {/* Right Panel - Player + Timeline */}
          <div className={`flex-1 flex flex-col overflow-hidden bg-[#252525] ${responsive.isSpanning ? 'avoid-hinge' : ''}`}>
            {/* Video Player */}
            <div className="flex-1 overflow-hidden p-2 min-h-0">
              <VideoPlayer />
            </div>

            {/* Timeline */}
            <div className="h-40 border-t border-white/10 flex-shrink-0">
              <Timeline />
            </div>
          </div>
        </div>

        {/* Footer Credit */}
        <FooterCredit />

        <ExportModal />
      </div>
    );
  }

  // ============================================
  // LAYOUT: Expanded (tablets, foldables wide 719-1024px)
  // ============================================
  if (isExpanded) {
    return (
      <div 
        className="h-screen h-[100dvh] flex flex-col overflow-hidden bg-[#1a1a1a] fold-transition"
        style={getFoldAwareStyles()}
      >
        {/* Header */}
        <Header
          isSidebarVisible={isSidebarVisible}
          onToggleSidebar={() => setIsSidebarVisible(!isSidebarVisible)}
        />

        {/* Main Content - Horizontal split for tablets */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - Sidebar */}
          {isSidebarVisible && (
            <div className="w-72 flex flex-col bg-[#1a1a1a] border-r border-white/10">
              {/* Sidebar Tabs */}
              <div className="h-12 flex items-center border-b border-white/10 px-2 gap-1">
                <SidebarTabs 
                  activeSidebarTab={activeSidebarTab}
                  setActiveSidebarTab={setActiveSidebarTab}
                />
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

          {/* Right Panel - Player + Timeline */}
          <div className="flex-1 flex flex-col overflow-hidden bg-[#252525]">
            {/* Video Player */}
            <div className="flex-1 overflow-hidden p-2 min-h-0">
              <VideoPlayer />
            </div>

            {/* Timeline */}
            <div className="h-48 border-t border-white/10 flex-shrink-0">
              <Timeline />
            </div>
          </div>
        </div>

        {/* Footer Credit */}
        <FooterCredit />

        <ExportModal />
      </div>
    );
  }

  // ============================================
  // LAYOUT: Desktop (>= 1024px)
  // ============================================
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

      {/* Footer Credit */}
      <FooterCredit />

      {/* Export Modal */}
      <Suspense fallback={null}>
        <ExportModal />
      </Suspense>
    </div>
  );
}

export default App;
