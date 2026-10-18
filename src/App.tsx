// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useEffect, useState, useRef, Suspense, lazy } from 'react';
import Header from './components/Header';
import MediaLibrary from './components/MediaLibrary';
import VideoPlayer from './components/VideoPlayer';
import PropertiesPanel from './components/PropertiesPanel';
import Timeline from './components/Timeline';
import Toolbar from './components/Toolbar';
import { PWAUpdatePrompt } from './components/PWAUpdatePrompt';
// ExportModal is lazy loaded to reduce initial bundle size
const ExportModal = lazy(() => import('./components/ExportModal').then(module => ({ default: module.ExportModal })));

/**
 * Ne monte ExportModal (et donc ses chunks ffmpeg / mediabunny, ~570 Ko) qu'à
 * l'ouverture réelle : rien n'est téléchargé au chargement de l'éditeur.
 */
const ExportModalGate = () => {
  const isExportOpen = useEditorStore((state) => state.ui.isExportModalOpen);
  if (!isExportOpen) return null;
  return (
    <Suspense fallback={null}>
      <ExportModal />
    </Suspense>
  );
};
import { useEditorStore } from './store/editorStore';
import { useResponsive, useLayoutMode, useIsFoldable } from './hooks/use-responsive';
import { Film, Type, Scissors, Sliders, X, Music, Crop, Wand2 } from 'lucide-react';
import { SubscriptionGuard } from './SubscriptionGuard';
import { useI18n } from './i18n';
import './index.css';

// Footer credit component
const FooterCredit: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { t } = useI18n();
  return (
    <footer className={`${compact ? 'py-1' : 'py-2'} px-3 text-center bg-[#0f0f0f] border-t border-white/10 flex-shrink-0 safe-area-bottom`}>
      <p className={`${compact ? 'text-[10px]' : 'text-xs'} text-neutral-500`}>
        {t('developedBy')}{' '}
        <a
          href="https://www.jematechnology.fr/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#757aed] hover:text-[#8b8ff2] hover:underline font-medium transition-colors"
        >
          Jema Technology
        </a>
        {' '}{t('footerSuffix')}
      </p>
    </footer>
  );
};

type SidebarTab = 'media' | 'text' | 'transitions' | 'effects';
type MobileView = 'player' | 'timeline' | 'sidebar';

// Common props interface for layout components (for future refactoring)
export interface LayoutComponentProps {
  isSidebarVisible: boolean;
  setIsSidebarVisible: (visible: boolean) => void;
  activeSidebarTab: SidebarTab;
  setActiveSidebarTab: (tab: SidebarTab) => void;
  getFoldAwareStyles: () => React.CSSProperties;
  isTimelineExpanded?: boolean;
  setIsTimelineExpanded?: (expanded: boolean) => void;
  setMobileSidebarOpen?: (open: boolean) => void;
  handleBottomSheetDrag?: () => void;
  bottomSheetHeight?: number;
}

// Sidebar tab buttons component for reuse
const SidebarTabs = ({ 
  compact = false, 
  activeSidebarTab, 
  setActiveSidebarTab 
}: { 
  compact?: boolean;
  activeSidebarTab: SidebarTab;
  setActiveSidebarTab: (tab: SidebarTab) => void;
}) => {
  const { t } = useI18n();
  return (
  <div className={`flex items-center flex-nowrap overflow-x-auto scrollbar-none ${compact ? 'gap-1' : 'gap-1'} ${compact ? 'px-1' : 'px-2'}`}>
    <button
      onClick={() => setActiveSidebarTab('media')}
      title={t('media')}
      aria-label={t('media')}
      className={`${compact ? 'flex-shrink-0 w-11 h-11' : 'flex-1 min-w-0 h-9'} rounded-lg flex items-center justify-center gap-1 transition-all touch-target ${
        activeSidebarTab === 'media'
          ? 'bg-primary-500 text-white'
          : 'text-neutral-400 hover:text-white hover:bg-white/10'
      }`}
    >
      <Film className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      {!compact && <span className="text-xs font-medium whitespace-nowrap">{t('media')}</span>}
    </button>
    <button
      onClick={() => setActiveSidebarTab('text')}
      title={t('text')}
      aria-label={t('text')}
      className={`${compact ? 'flex-shrink-0 w-11 h-11' : 'flex-1 min-w-0 h-9'} rounded-lg flex items-center justify-center gap-1 transition-all touch-target ${
        activeSidebarTab === 'text'
          ? 'bg-primary-500 text-white'
          : 'text-neutral-400 hover:text-white hover:bg-white/10'
      }`}
    >
      <Type className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      {!compact && <span className="text-xs font-medium whitespace-nowrap">{t('text')}</span>}
    </button>
    <button
      onClick={() => setActiveSidebarTab('transitions')}
      title={t('transitions')}
      aria-label={t('transitions')}
      className={`${compact ? 'flex-shrink-0 w-11 h-11' : 'flex-1 min-w-0 h-9'} rounded-lg flex items-center justify-center gap-1 transition-all touch-target ${
        activeSidebarTab === 'transitions'
          ? 'bg-primary-500 text-white'
          : 'text-neutral-400 hover:text-white hover:bg-white/10'
      }`}
    >
      <Scissors className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      {!compact && <span className="text-xs font-medium whitespace-nowrap">{t('transShort')}</span>}
    </button>
    <button
      onClick={() => setActiveSidebarTab('effects')}
      title={t('effects')}
      aria-label={t('effects')}
      className={`${compact ? 'flex-shrink-0 w-11 h-11' : 'flex-1 min-w-0 h-9'} rounded-lg flex items-center justify-center gap-1 transition-all touch-target ${
        activeSidebarTab === 'effects'
          ? 'bg-primary-500 text-white'
          : 'text-neutral-400 hover:text-white hover:bg-white/10'
      }`}
    >
      <Sliders className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      {!compact && <span className="text-xs font-medium whitespace-nowrap">{t('effects')}</span>}
    </button>
  </div>
  );
};

type MobilePanelId = 'media' | 'audio' | 'clip' | 'text' | 'effects' | 'transitions';

/**
 * Unified phone layout, modelled on mobile editors (CapCut-style):
 *  - compact header (safe-area aware)
 *  - large preview, always visible
 *  - timeline anchored above the tool rail
 *  - scrollable tool rail at the very bottom
 *  - panels open as a draggable BOTTOM SHEET that never hides the preview
 *
 * Replaces the previous MinimalLayout/CompactLayout duplication.
 */
const MobileLayout = ({
  isSidebarVisible,
  setIsSidebarVisible,
  setActiveSidebarTab,
  setMobileSidebarOpen,
  getFoldAwareStyles
}: any) => {
  const { t } = useI18n();
  const selectedClipId = useEditorStore((s) => s.ui.selectedClipId);
  const responsive = useResponsive();
  const isLandscape = responsive.orientation === 'landscape';

  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isTimelineCollapsed, setIsTimelineCollapsed] = useState(false);
  const [panel, setPanel] = useState<MobilePanelId>('media');
  const [sheetVh, setSheetVh] = useState(35.5);
  const dragRef = useRef<{ startY: number; startVh: number } | null>(null);

  const SHEET_DEFAULT = isLandscape ? 70 : 35.5;
  const SHEET_MIN = 26;
  const SHEET_MAX = 80;
  const RAIL_H = isLandscape ? '3.5rem' : '4rem';
  // Timeline height (px). Portrait keeps >=172px of tracks viewport (28px ruler + 3x48px);
  // landscape sizes for the phone timeline (24px ruler + 3x40px = 144px) plus its toolbar.
  // Compact foldable internals at ~781x719 are 'landscape' but not phones, so
  // they need the full compact timeline (28px ruler + 3x48px rows + toolbar)
  // instead of the shorter landscape-phone timeline.
  const TIMELINE_H = isLandscape ? (responsive.layoutMode === 'minimal' ? 182 : 210) : 210;

  const railItems: { id: MobilePanelId; icon: typeof Film; label: string }[] = [
    { id: 'media', icon: Film, label: t('media') },
    { id: 'audio', icon: Music, label: t('audio') },
    { id: 'clip', icon: Crop, label: t('clip') },
    { id: 'text', icon: Type, label: t('text') },
    { id: 'effects', icon: Wand2, label: t('effects') },
    { id: 'transitions', icon: Scissors, label: t('transShort') },
  ];

  const railLabels: Record<MobilePanelId, string> = {
    media: t('media'),
    audio: t('audio'),
    clip: t('clip'),
    text: t('text'),
    effects: t('effects'),
    transitions: t('transitions'),
  };

  const syncSidebarTab = (id: MobilePanelId) => {
    const mapping: Partial<Record<MobilePanelId, SidebarTab>> = {
      media: 'media',
      audio: 'media',
      clip: 'media',
      text: 'text',
      effects: 'effects',
      transitions: 'transitions',
    };
    const tab = mapping[id];
    if (tab) setActiveSidebarTab(tab);
  };

  const closeSheet = () => {
    setIsSheetOpen(false);
    setIsSidebarVisible(false);
    setMobileSidebarOpen(false);
  };

  const openPanel = (id: MobilePanelId) => {
    // Tapping the active tool again closes the sheet, like most mobile editors.
    if (isSheetOpen && panel === id) {
      closeSheet();
      return;
    }
    setPanel(id);
    setSheetVh(SHEET_DEFAULT);
    setIsSheetOpen(true);
    setIsSidebarVisible(true);
    setMobileSidebarOpen(true);
    syncSidebarTab(id);
  };

  const onHandlePointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startY: e.clientY, startVh: sheetVh };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onHandlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const deltaVh = ((dragRef.current.startY - e.clientY) / globalThis.innerHeight) * 100;
    const next = dragRef.current.startVh + deltaVh;
    setSheetVh(Math.max(SHEET_MIN - 10, Math.min(SHEET_MAX, next)));
  };

  const onHandlePointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    // Dragged far enough down: dismiss.
    if (sheetVh < SHEET_MIN) closeSheet();
  };

  // If something else flips the sidebar flag closed, close the sheet too.
  useEffect(() => {
    if (!isSidebarVisible && isSheetOpen) {
      setIsSheetOpen(false);
      setMobileSidebarOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSidebarVisible]);

  const renderPanelContent = () => {
    switch (panel) {
      case 'media':
        return <MediaLibrary initialFilter="all" />;
      case 'audio':
        return <MediaLibrary initialFilter="audio" />;
      case 'clip':
        return <PropertiesPanel activeTab="clip" />;
      case 'text':
        return <PropertiesPanel activeTab="text" />;
      case 'effects':
        return <PropertiesPanel activeTab="filters" />;
      case 'transitions':
        return <PropertiesPanel activeTab="transitions" />;
      default:
        return <MediaLibrary />;
    }
  };

  return (
    <div
      className="relative h-screen h-[100dvh] flex flex-col overflow-hidden bg-[#141414] fold-transition touch-none safe-area-top"
      style={getFoldAwareStyles()}
    >
      <Header
        isSidebarVisible={isSheetOpen}
        onToggleSidebar={() => (isSheetOpen ? closeSheet() : openPanel('media'))}
        onToggleTimeline={isLandscape ? () => setIsTimelineCollapsed((v) => !v) : undefined}
        isTimelineCollapsed={isTimelineCollapsed}
      />

      {/* Preview — keeps the lion's share of the screen */}
      <div className="flex-1 min-h-0 overflow-hidden bg-black">
        <div className="h-full">
          <VideoPlayer />
        </div>
      </div>

      {/* Timeline — hidden when collapsed on landscape phones so the preview absorbs it */}
      {!(isLandscape && isTimelineCollapsed) && (
        <div className="flex-shrink-0 border-t border-white/10 bg-[#171717] overflow-hidden" style={{ height: TIMELINE_H }}>
          <Timeline />
        </div>
      )}

      {/* Bottom tool rail */}
      <div
        className="flex-shrink-0 bg-[#0f0f0f] border-t border-white/10"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <nav
          className={`${isLandscape ? 'h-14' : 'h-16'} flex items-stretch gap-1 px-1 overflow-x-auto scrollbar-none`}
        >
          {railItems.map((item) => {
            const isActive = isSheetOpen && panel === item.id;
            const isClipMissing = item.id === 'clip' && !selectedClipId;
            return (
              <button
                key={item.id}
                onClick={() => openPanel(item.id)}
                aria-pressed={isActive}
                className={`relative flex-shrink-0 min-w-[62px] flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors touch-target ${
                  isActive ? 'bg-primary-500/15 text-white' : 'text-neutral-400 active:bg-white/10'
                }`}
              >
                {isActive && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-6 rounded-full bg-primary-500" />
                )}
                <item.icon className="w-5 h-5" />
                <span className="text-[10px] font-medium leading-none">{item.label}</span>
                {isClipMissing && (
                  <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-white/25" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Draggable bottom sheet — overlays the timeline, never the preview */}
      {isSheetOpen && (
        <section
          role="dialog"
          aria-label={railLabels[panel]}
          className="absolute inset-x-0 z-[80] flex flex-col rounded-t-2xl bg-[#1b1b1b] border-t border-white/10 shadow-[0_-10px_34px_rgba(0,0,0,0.55)] overflow-hidden fold-transition"
          style={{
            bottom: isLandscape
              ? `calc(${RAIL_H} + env(safe-area-inset-bottom, 0px))`
              : `calc(${RAIL_H} + ${TIMELINE_H}px + env(safe-area-inset-bottom, 0px))`,
            height: isLandscape ? '70dvh' : `${sheetVh}dvh`,
            // Landscape phones have no room above the timeline: dock the sheet directly
            // above the tool rail (it deliberately overlays the timeline) and cap it so
            // the header and close button stay reachable. In portrait the sheet stays
            // anchored above the timeline as before.
            maxHeight: isLandscape
              ? `calc(100dvh - ${RAIL_H} - env(safe-area-inset-bottom, 0px) - 2.5rem)`
              : `calc(100dvh - ${RAIL_H} - ${TIMELINE_H}px - env(safe-area-inset-bottom, 0px) - 3.5rem)`,
          }}
        >
          <div
            className="relative h-8 flex-shrink-0 flex items-center justify-center cursor-grab active:cursor-grabbing touch-none"
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
          >
            <div className="w-10 h-1 rounded-full bg-white/30" />
            <button
              onClick={closeSheet}
              aria-label={t('close')}
              className="absolute right-2 top-0 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div key={panel} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            {renderPanelContent()}
          </div>
        </section>
      )}

      <ExportModalGate />
    </div>
  );
};

const AdaptiveLayout = ({
  isSidebarVisible,
  setIsSidebarVisible,
  activeSidebarTab,
  setActiveSidebarTab,
  responsive,
  getFoldAwareStyles
}: any) => (
  <div 
    className="h-screen h-[100dvh] flex flex-col overflow-hidden bg-[#1a1a1a] fold-transition"
    style={getFoldAwareStyles()}
  >
    <Header
      isSidebarVisible={isSidebarVisible}
      onToggleSidebar={() => setIsSidebarVisible(!isSidebarVisible)}
    />

    <div className="flex-1 flex overflow-hidden">
      {isSidebarVisible && (
        <div className={`${responsive.isSpanning ? 'w-[calc(50%-var(--hinge-width,0px)/2)]' : 'w-64'} flex flex-col bg-[#1a1a1a] border-r border-white/10 avoid-hinge`}>
          <div className="h-11 flex items-center border-b border-white/10">
            <SidebarTabs 
              compact
              activeSidebarTab={activeSidebarTab}
              setActiveSidebarTab={setActiveSidebarTab}
            />
          </div>
          
          <div className="flex-1 overflow-auto min-h-0">
            {activeSidebarTab === 'media' && <MediaLibrary />}
            {activeSidebarTab === 'text' && <PropertiesPanel activeTab="text" />}
            {activeSidebarTab === 'transitions' && <PropertiesPanel activeTab="transitions" />}
            {activeSidebarTab === 'effects' && <PropertiesPanel activeTab="filters" />}
          </div>
        </div>
      )}

      <div className={`flex-1 flex flex-col overflow-hidden bg-[#252525] ${responsive.isSpanning ? 'avoid-hinge' : ''}`}>
        <div className="flex-1 overflow-hidden p-2 min-h-0">
          <VideoPlayer />
        </div>

        <div className="h-40 border-t border-white/10 flex-shrink-0">
          <Timeline />
        </div>
      </div>
    </div>

    <FooterCredit />
    <ExportModalGate />
  </div>
);

const ExpandedLayout = ({
  isSidebarVisible,
  setIsSidebarVisible,
  activeSidebarTab,
  setActiveSidebarTab,
  getFoldAwareStyles
}: any) => (
  <div 
    className="h-screen h-[100dvh] flex flex-col overflow-hidden bg-[#1a1a1a] fold-transition"
    style={getFoldAwareStyles()}
  >
    <Header
      isSidebarVisible={isSidebarVisible}
      onToggleSidebar={() => setIsSidebarVisible(!isSidebarVisible)}
    />

    <div className="flex-1 flex overflow-hidden">
      {isSidebarVisible && (
        <div className="w-72 flex flex-col bg-[#1a1a1a] border-r border-white/10">
          <div className="h-12 flex items-center border-b border-white/10 px-2 gap-1">
            <SidebarTabs 
              compact
              activeSidebarTab={activeSidebarTab}
              setActiveSidebarTab={setActiveSidebarTab}
            />
          </div>
          
          <div className="flex-1 overflow-auto min-h-0">
            {activeSidebarTab === 'media' && <MediaLibrary />}
            {activeSidebarTab === 'text' && <PropertiesPanel activeTab="text" />}
            {activeSidebarTab === 'transitions' && <PropertiesPanel activeTab="transitions" />}
            {activeSidebarTab === 'effects' && <PropertiesPanel activeTab="filters" />}
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden bg-[#252525]">
        <div className="flex-1 overflow-hidden p-2 min-h-0">
          <VideoPlayer />
        </div>

        <div className="h-48 border-t border-white/10 flex-shrink-0">
          <Timeline />
        </div>
      </div>
    </div>

    <FooterCredit />
    <ExportModalGate />
  </div>
);

const DesktopLayout = ({
  isSidebarVisible,
  setIsSidebarVisible,
  activeSidebarTab,
  setActiveSidebarTab
}: any) => {
  const { t } = useI18n();
  return (
  <div className="h-screen flex flex-col overflow-hidden bg-[#1a1a1a]">
    <Header
      isSidebarVisible={isSidebarVisible}
      onToggleSidebar={() => setIsSidebarVisible(!isSidebarVisible)}
    />

    <div className="flex-1 flex overflow-hidden">
      {isSidebarVisible && (
        <div className="w-20 bg-[#0f0f0f] border-r border-white/10 flex flex-col items-center py-4 gap-2">
          <button
            onClick={() => setActiveSidebarTab('media')}
            className={`w-16 h-16 rounded-lg flex flex-col items-center justify-center gap-1 transition-all ${
              activeSidebarTab === 'media'
                ? 'bg-primary-500 text-white'
                : 'text-neutral-400 hover:text-white hover:bg-white/10'
            }`}
            title={t('media')}
          >
            <Film className="w-5 h-5" />
            <span className="text-[10px] font-medium">{t('media')}</span>
          </button>
          <button
            onClick={() => setActiveSidebarTab('text')}
            className={`w-16 h-16 rounded-lg flex flex-col items-center justify-center gap-1 transition-all ${
              activeSidebarTab === 'text'
                ? 'bg-primary-500 text-white'
                : 'text-neutral-400 hover:text-white hover:bg-white/10'
            }`}
            title={t('text')}
          >
            <Type className="w-5 h-5" />
            <span className="text-[10px] font-medium">{t('text')}</span>
          </button>
          <button
            onClick={() => setActiveSidebarTab('transitions')}
            className={`w-16 h-16 rounded-lg flex flex-col items-center justify-center gap-1 transition-all ${
              activeSidebarTab === 'transitions'
                ? 'bg-primary-500 text-white'
                : 'text-neutral-400 hover:text-white hover:bg-white/10'
            }`}
            title={t('transitions')}
          >
            <Scissors className="w-5 h-5" />
            <span className="text-[10px] font-medium">{t('transition')}</span>
          </button>
          <button
            onClick={() => setActiveSidebarTab('effects')}
            className={`w-16 h-16 rounded-lg flex flex-col items-center justify-center gap-1 transition-all ${
              activeSidebarTab === 'effects'
                ? 'bg-primary-500 text-white'
                : 'text-neutral-400 hover:text-white hover:bg-white/10'
            }`}
            title={t('effects')}
          >
            <Sliders className="w-5 h-5" />
            <span className="text-[10px] font-medium">{t('effects')}</span>
          </button>
        </div>
      )}

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

      <div className="flex-1 flex flex-col overflow-hidden bg-[#252525]">
        <div className="flex-1 overflow-hidden p-4">
          <VideoPlayer />
        </div>

        <div className="h-64 border-t border-white/10">
          <Timeline />
        </div>
      </div>
    </div>

    <FooterCredit />

    <ExportModalGate />
  </div>
  );
};

function App() {
  const { setMobileSidebarOpen } = useEditorStore();
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>('media');
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [mobileView, setMobileView] = useState<MobileView>('player');

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

  // Get dynamic styles based on fold state
  const getFoldAwareStyles = (): React.CSSProperties => {
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

  // Render the appropriate layout based on layout mode
  const renderLayout = () => {
    // Phones AND foldable covers share one unified mobile layout.
    if (isMinimal || isCompact) {
      return (
        <MobileLayout
          isSidebarVisible={isSidebarVisible}
          setIsSidebarVisible={setIsSidebarVisible}
          activeSidebarTab={activeSidebarTab}
          setActiveSidebarTab={setActiveSidebarTab}
          setMobileSidebarOpen={setMobileSidebarOpen}
          getFoldAwareStyles={getFoldAwareStyles}
        />
      );
    }

    if (isAdaptive) {
      return (
        <AdaptiveLayout
          isSidebarVisible={isSidebarVisible}
          setIsSidebarVisible={setIsSidebarVisible}
          activeSidebarTab={activeSidebarTab}
          setActiveSidebarTab={setActiveSidebarTab}
          responsive={responsive}
          getFoldAwareStyles={getFoldAwareStyles}
        />
      );
    }

    if (isExpanded) {
      return (
        <ExpandedLayout
          isSidebarVisible={isSidebarVisible}
          setIsSidebarVisible={setIsSidebarVisible}
          activeSidebarTab={activeSidebarTab}
          setActiveSidebarTab={setActiveSidebarTab}
          getFoldAwareStyles={getFoldAwareStyles}
        />
      );
    }

    // Desktop layout (default)
    return (
      <DesktopLayout
        isSidebarVisible={isSidebarVisible}
        setIsSidebarVisible={setIsSidebarVisible}
        activeSidebarTab={activeSidebarTab}
        setActiveSidebarTab={setActiveSidebarTab}
      />
    );
  };

  return (
    <SubscriptionGuard appName="OsiVibe">
    <>
      {renderLayout()}
      <PWAUpdatePrompt />
    </>
    </SubscriptionGuard>
  );
}

export default App;

