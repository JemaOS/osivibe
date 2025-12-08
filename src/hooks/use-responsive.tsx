// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useState, useEffect, useMemo, useCallback } from 'react';

// ============================================
// TYPE DEFINITIONS
// ============================================

/** Layout modes based on screen size and aspect ratio */
export type LayoutMode = 'minimal' | 'compact' | 'adaptive' | 'expanded' | 'desktop';

/** Device type categories */
export type DeviceType = 'phone' | 'foldable-folded' | 'foldable-unfolded' | 'tablet' | 'desktop';

/** Fold state for foldable devices */
export type FoldState = 'folded' | 'unfolded' | 'unknown';

/** Aspect ratio categories */
export type AspectRatioCategory = 'ultra-tall' | 'tall' | 'standard' | 'near-square' | 'wide';

/** Orientation */
export type Orientation = 'portrait' | 'landscape';

/** Specific foldable device models */
export type FoldableModel = 
  | 'samsung-fold-1'
  | 'samsung-fold-2'
  | 'samsung-fold-3'
  | 'samsung-fold-4'
  | 'samsung-fold-5'
  | 'samsung-fold-6'
  | 'honor-magic-v3'
  | 'oppo-find-n'
  | 'oppo-find-n2'
  | 'oppo-find-n3'
  | 'unknown';

/** Panel visibility state */
export type PanelVisibility = 'hidden' | 'collapsed' | 'visible';

// ============================================
// BREAKPOINT CONSTANTS
// ============================================

export const BREAKPOINTS = {
  // Folded/Cover displays
  foldNarrow: 272,
  foldCover: 301,
  
  // Small smartphones
  xxs: 360,
  xs: 375,
  phone: 390,
  phoneLg: 428,
  
  // Foldable inner displays
  foldOpenSm: 512,
  foldOpen: 589,
  foldOpenLg: 619,
  
  // Tablets & large foldables
  sm: 640,
  foldWide: 719,
  md: 768,
  foldMax: 896,
  
  // Desktop
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

// ============================================
// DEVICE DETECTION CONSTANTS
// ============================================

/** Known foldable device dimensions (CSS pixels) */
const FOLDABLE_DIMENSIONS = {
  // Samsung Galaxy Fold series
  'samsung-fold-1': { cover: { width: 280, height: 653 }, inner: { width: 512, height: 717 } },
  'samsung-fold-2': { cover: { width: 272, height: 753 }, inner: { width: 589, height: 736 } },
  'samsung-fold-3': { cover: { width: 277, height: 756 }, inner: { width: 589, height: 736 } },
  'samsung-fold-4': { cover: { width: 301, height: 772 }, inner: { width: 604, height: 725 } },
  'samsung-fold-5': { cover: { width: 301, height: 772 }, inner: { width: 604, height: 725 } },
  'samsung-fold-6': { cover: { width: 323, height: 792 }, inner: { width: 619, height: 720 } },
  
  // Honor Magic V series
  'honor-magic-v3': { cover: { width: 353, height: 792 }, inner: { width: 719, height: 781 } },
  
  // Oppo Find N series
  'oppo-find-n': { cover: { width: 494, height: 986 }, inner: { width: 896, height: 960 } },
  'oppo-find-n2': { cover: { width: 432, height: 848 }, inner: { width: 766, height: 848 } },
  'oppo-find-n3': { cover: { width: 372, height: 828 }, inner: { width: 756, height: 827 } },
} as const;

/** Hinge widths by manufacturer (CSS pixels) */
const HINGE_WIDTHS = {
  samsung: 48,
  honor: 40,
  oppo: 32,
  default: 48,
} as const;

// ============================================
// RESPONSIVE STATE INTERFACE
// ============================================

export interface ResponsiveState {
  // Dimensions
  width: number;
  height: number;
  aspectRatio: number;
  
  // Layout
  layoutMode: LayoutMode;
  deviceType: DeviceType;
  
  // Foldable-specific
  foldState: FoldState;
  isFoldable: boolean;
  isSpanning: boolean;
  hingeWidth: number;
  foldableModel: FoldableModel;
  
  // Aspect ratio
  aspectRatioCategory: AspectRatioCategory;
  
  // Capabilities
  hasTouch: boolean;
  hasMouse: boolean;
  hasStylus: boolean;
  
  // Orientation
  orientation: Orientation;
  
  // UI recommendations
  touchTargetSize: number;
  timelineTracks: number;
  panelVisibility: PanelVisibility;
  
  // Backward compatibility
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Determines the aspect ratio category based on width/height ratio
 */
function getAspectRatioCategory(ratio: number): AspectRatioCategory {
  if (ratio < 9/19) return 'ultra-tall';      // < 0.47 (fold covers)
  if (ratio < 9/16) return 'tall';            // < 0.56 (standard phones)
  if (ratio < 3/4) return 'standard';         // < 0.75 (older phones, tablets)
  if (ratio < 5/4) return 'near-square';      // < 1.25 (foldable inner)
  return 'wide';                               // >= 1.25 (landscape, desktop)
}

/**
 * Detects the specific foldable model based on screen dimensions
 */
function detectFoldableModel(width: number, height: number): FoldableModel {
  const tolerance = 15; // CSS pixel tolerance for matching
  
  for (const [model, dims] of Object.entries(FOLDABLE_DIMENSIONS)) {
    // Check cover dimensions
    if (
      Math.abs(width - dims.cover.width) <= tolerance &&
      Math.abs(height - dims.cover.height) <= tolerance
    ) {
      return model as FoldableModel;
    }
    
    // Check inner dimensions
    if (
      Math.abs(width - dims.inner.width) <= tolerance &&
      Math.abs(height - dims.inner.height) <= tolerance
    ) {
      return model as FoldableModel;
    }
  }
  
  return 'unknown';
}

/**
 * Gets the hinge width for a specific foldable model
 */
function getHingeWidth(model: FoldableModel): number {
  if (model.startsWith('samsung')) return HINGE_WIDTHS.samsung;
  if (model.startsWith('honor')) return HINGE_WIDTHS.honor;
  if (model.startsWith('oppo')) return HINGE_WIDTHS.oppo;
  return HINGE_WIDTHS.default;
}

/**
 * Determines if the device is likely a foldable based on dimensions and aspect ratio
 */
function isFoldableDevice(width: number, height: number, aspectRatio: number): boolean {
  // Check if dimensions match known foldable devices
  const model = detectFoldableModel(width, height);
  if (model !== 'unknown') return true;
  
  // Heuristic: near-square aspect ratio with width in foldable range
  const isNearSquare = aspectRatio > 0.7 && aspectRatio < 1.4;
  const isInFoldableWidthRange = width >= BREAKPOINTS.foldOpenSm && width <= BREAKPOINTS.foldMax;
  
  return isNearSquare && isInFoldableWidthRange;
}

/**
 * Determines the fold state based on dimensions and aspect ratio
 */
function getFoldState(width: number, aspectRatio: number, isSpanning: boolean): FoldState {
  if (isSpanning) return 'unfolded';
  
  // Cover display detection (narrow width, tall aspect ratio)
  if (width <= BREAKPOINTS.foldCover && aspectRatio < 0.5) {
    return 'folded';
  }
  
  // Inner display detection (wider, near-square)
  if (width >= BREAKPOINTS.foldOpenSm && aspectRatio > 0.7 && aspectRatio < 1.4) {
    return 'unfolded';
  }
  
  return 'unknown';
}

// ============================================
// MAIN HOOK
// ============================================

/**
 * Comprehensive responsive hook for detecting device type, fold state,
 * and providing UI recommendations for foldable devices.
 */
export function useResponsive(): ResponsiveState {
  // State for dimensions
  const [dimensions, setDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  });
  
  // State for spanning detection (dual-screen)
  const [isSpanning, setIsSpanning] = useState(false);
  const [spanningHingeWidth, setSpanningHingeWidth] = useState(0);
  
  // State for input capabilities
  const [inputCapabilities, setInputCapabilities] = useState({
    hasTouch: false,
    hasMouse: false,
    hasStylus: false,
  });

  // Handle resize events
  const handleResize = useCallback(() => {
    setDimensions({
      width: window.innerWidth,
      height: window.innerHeight,
    });
  }, []);

  // Check for viewport segments API (spanning displays)
  const checkSpanning = useCallback(() => {
    if ('visualViewport' in window) {
      const vv = window.visualViewport as VisualViewport & { segments?: DOMRect[] };
      if (vv && 'segments' in vv && vv.segments && vv.segments.length > 1) {
        setIsSpanning(true);
        const segments = vv.segments;
        // Calculate hinge width from segment gap
        const hingeWidth = segments[1].left - (segments[0].left + segments[0].width);
        setSpanningHingeWidth(hingeWidth);
      } else {
        setIsSpanning(false);
        setSpanningHingeWidth(0);
      }
    }
  }, []);

  // Check input capabilities
  const checkInputCapabilities = useCallback(() => {
    setInputCapabilities({
      hasTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
      hasMouse: window.matchMedia('(pointer: fine) and (hover: hover)').matches,
      hasStylus: window.matchMedia('(pointer: fine) and (hover: none)').matches,
    });
  }, []);

  // Set up event listeners
  useEffect(() => {
    // Initial checks
    handleResize();
    checkSpanning();
    checkInputCapabilities();

    // Add event listeners
    window.addEventListener('resize', handleResize);
    window.visualViewport?.addEventListener('resize', checkSpanning);
    
    // Media query listeners for input capabilities
    const touchQuery = window.matchMedia('(pointer: coarse)');
    const mouseQuery = window.matchMedia('(pointer: fine) and (hover: hover)');
    
    const handleMediaChange = () => checkInputCapabilities();
    touchQuery.addEventListener('change', handleMediaChange);
    mouseQuery.addEventListener('change', handleMediaChange);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      window.visualViewport?.removeEventListener('resize', checkSpanning);
      touchQuery.removeEventListener('change', handleMediaChange);
      mouseQuery.removeEventListener('change', handleMediaChange);
    };
  }, [handleResize, checkSpanning, checkInputCapabilities]);

  // Compute responsive state
  const state = useMemo((): ResponsiveState => {
    const { width, height } = dimensions;
    const aspectRatio = width / height;
    
    // Detect foldable model and characteristics
    const foldableModel = detectFoldableModel(width, height);
    const isFoldable = isFoldableDevice(width, height, aspectRatio);
    const foldState = getFoldState(width, aspectRatio, isSpanning);
    const hingeWidth = isSpanning ? spanningHingeWidth : (isFoldable ? getHingeWidth(foldableModel) : 0);
    
    // Determine aspect ratio category
    const aspectRatioCategory = getAspectRatioCategory(aspectRatio);
    
    // Determine orientation
    const orientation: Orientation = aspectRatio >= 1 ? 'landscape' : 'portrait';
    
    // Determine layout mode, device type, and UI recommendations
    let layoutMode: LayoutMode;
    let deviceType: DeviceType;
    let touchTargetSize: number;
    let timelineTracks: number;
    let panelVisibility: PanelVisibility;
    
    if (width <= BREAKPOINTS.foldCover) {
      // Fold cover / very narrow displays
      layoutMode = 'minimal';
      deviceType = isFoldable ? 'foldable-folded' : 'phone';
      touchTargetSize = 48;
      timelineTracks = 1;
      panelVisibility = 'hidden';
    } else if (width <= BREAKPOINTS.phoneLg) {
      // Standard phones
      layoutMode = 'compact';
      deviceType = 'phone';
      touchTargetSize = 44;
      timelineTracks = 2;
      panelVisibility = 'collapsed';
    } else if (width <= BREAKPOINTS.foldOpenLg && aspectRatio > 0.7 && aspectRatio < 1.4) {
      // Foldable inner displays (near-square)
      layoutMode = 'adaptive';
      deviceType = 'foldable-unfolded';
      touchTargetSize = 44;
      timelineTracks = 3;
      panelVisibility = 'visible';
    } else if (width <= BREAKPOINTS.lg) {
      // Tablets and large foldables
      layoutMode = 'expanded';
      deviceType = width <= BREAKPOINTS.foldMax && isFoldable ? 'foldable-unfolded' : 'tablet';
      touchTargetSize = 40;
      timelineTracks = 4;
      panelVisibility = 'visible';
    } else {
      // Desktop
      layoutMode = 'desktop';
      deviceType = 'desktop';
      touchTargetSize = 36;
      timelineTracks = 6;
      panelVisibility = 'visible';
    }
    
    // Backward compatibility flags
    const isMobile = width < BREAKPOINTS.md;
    const isTablet = width >= BREAKPOINTS.md && width < BREAKPOINTS.lg;
    const isDesktop = width >= BREAKPOINTS.lg;
    
    return {
      // Dimensions
      width,
      height,
      aspectRatio,
      
      // Layout
      layoutMode,
      deviceType,
      
      // Foldable-specific
      foldState,
      isFoldable,
      isSpanning,
      hingeWidth,
      foldableModel,
      
      // Aspect ratio
      aspectRatioCategory,
      
      // Capabilities
      hasTouch: inputCapabilities.hasTouch,
      hasMouse: inputCapabilities.hasMouse,
      hasStylus: inputCapabilities.hasStylus,
      
      // Orientation
      orientation,
      
      // UI recommendations
      touchTargetSize,
      timelineTracks,
      panelVisibility,
      
      // Backward compatibility
      isMobile,
      isTablet,
      isDesktop,
    };
  }, [dimensions, isSpanning, spanningHingeWidth, inputCapabilities]);

  return state;
}

// ============================================
// UTILITY HOOKS
// ============================================

/**
 * Hook to check if current width is at or above a specific breakpoint
 */
export function useBreakpoint(breakpoint: keyof typeof BREAKPOINTS): boolean {
  const { width } = useResponsive();
  return width >= BREAKPOINTS[breakpoint];
}

/**
 * Hook to get the current layout mode
 */
export function useLayoutMode(): LayoutMode {
  const { layoutMode } = useResponsive();
  return layoutMode;
}

/**
 * Hook to check if device is a foldable
 */
export function useIsFoldable(): boolean {
  const { isFoldable } = useResponsive();
  return isFoldable;
}

/**
 * Hook to get fold state
 */
export function useFoldState(): FoldState {
  const { foldState } = useResponsive();
  return foldState;
}

/**
 * Hook to check if display is spanning (dual-screen)
 */
export function useIsSpanning(): boolean {
  const { isSpanning } = useResponsive();
  return isSpanning;
}

/**
 * Hook to get device type
 */
export function useDeviceType(): DeviceType {
  const { deviceType } = useResponsive();
  return deviceType;
}

/**
 * Hook to get aspect ratio category
 */
export function useAspectRatioCategory(): AspectRatioCategory {
  const { aspectRatioCategory } = useResponsive();
  return aspectRatioCategory;
}

/**
 * Hook to get orientation
 */
export function useOrientation(): Orientation {
  const { orientation } = useResponsive();
  return orientation;
}

// ============================================
// BACKWARD COMPATIBILITY
// ============================================

/**
 * Legacy hook for mobile detection (backward compatible with use-mobile.tsx)
 * @deprecated Use useResponsive() instead for more comprehensive detection
 */
export function useIsMobile(): boolean {
  const { isMobile } = useResponsive();
  return isMobile;
}