// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * @fileoverview Legacy mobile detection hook.
 *
 * This file is maintained for backward compatibility.
 * For new code, please use the comprehensive `useResponsive` hook from
 * `./use-responsive.tsx` which provides:
 * - Device type detection (phone, foldable-folded, foldable-unfolded, tablet, desktop)
 * - Fold state detection (folded, unfolded, unknown)
 * - Aspect ratio categories (ultra-tall, tall, standard, near-square, wide)
 * - Touch/mouse/stylus capability detection
 * - Orientation detection
 * - Specific foldable model detection (Samsung Fold, Honor Magic, Oppo Find N)
 * - UI recommendations (touch target sizes, timeline tracks, panel visibility)
 *
 * @example
 * // New recommended usage:
 * import { useResponsive, useIsMobile } from '@/hooks/use-responsive';
 *
 * function MyComponent() {
 *   const { isMobile, deviceType, foldState, layoutMode } = useResponsive();
 *   // or for simple mobile check:
 *   const isMobile = useIsMobile();
 * }
 */

// Re-export everything from the new comprehensive hook
export {
  useResponsive,
  useIsMobile,
  useBreakpoint,
  useLayoutMode,
  useIsFoldable,
  useFoldState,
  useIsSpanning,
  useDeviceType,
  useAspectRatioCategory,
  useOrientation,
  BREAKPOINTS,
} from './use-responsive';

// Re-export types
export type {
  LayoutMode,
  DeviceType,
  FoldState,
  AspectRatioCategory,
  Orientation,
  FoldableModel,
  PanelVisibility,
  ResponsiveState,
} from './use-responsive';
