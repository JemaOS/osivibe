/** @type {import('tailwindcss').Config} */
module.exports = {
	darkMode: ['class'],
	content: [
		'./pages/**/*.{ts,tsx}',
		'./components/**/*.{ts,tsx}',
		'./app/**/*.{ts,tsx}',
		'./src/**/*.{ts,tsx}',
	],
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px',
			},
		},
		screens: {
			// === FOLDED/COVER DISPLAYS ===
			'fold-narrow': '272px',    // Galaxy Z Fold 2/3 cover (narrowest)
			'fold-cover': '301px',     // Galaxy Z Fold 4/5/6 cover
			
			// === SMALL SMARTPHONES ===
			'xxs': '360px',            // Small Android phones (keep existing)
			'xs': '375px',             // iPhone SE, iPhone 8 (keep existing)
			'phone': '390px',          // iPhone 12/13/14 standard
			'phone-lg': '428px',       // iPhone Pro Max, large phones
			
			// === FOLDABLE INNER DISPLAYS ===
			'fold-open-sm': '512px',   // Galaxy Fold 1 inner
			'fold-open': '589px',      // Galaxy Z Fold 2/3/4/5 inner
			'fold-open-lg': '619px',   // Galaxy Z Fold 6 inner
			
			// === TABLETS & LARGE FOLDABLES ===
			'sm': '640px',             // Small tablets (keep existing)
			'fold-wide': '719px',      // Honor Magic V3 inner
			'md': '768px',             // Standard tablets (keep existing)
			'fold-max': '896px',       // Oppo Find N inner (largest)
			
			// === DESKTOP ===
			'lg': '1024px',            // Small desktop/laptop (keep existing)
			'xl': '1280px',            // Standard desktop (keep existing)
			'2xl': '1536px',           // Large desktop (keep existing)
			
			// === HEIGHT-BASED BREAKPOINTS (for landscape) ===
			'short': { 'raw': '(max-height: 500px)' },
			'medium-height': { 'raw': '(min-height: 501px) and (max-height: 700px)' },
			'tall': { 'raw': '(min-height: 701px)' },
			
			// === ASPECT RATIO BREAKPOINTS ===
			'ultra-tall': { 'raw': '(max-aspect-ratio: 9/19)' },
			'tall-screen': { 'raw': '(min-aspect-ratio: 9/19) and (max-aspect-ratio: 9/16)' },
			'standard-screen': { 'raw': '(min-aspect-ratio: 9/16) and (max-aspect-ratio: 3/4)' },
			'near-square': { 'raw': '(min-aspect-ratio: 3/4) and (max-aspect-ratio: 5/4)' },
			'square-screen': { 'raw': '(min-aspect-ratio: 5/4)' },
			
			// === FOLD-AWARE BREAKPOINTS ===
			'spanning': { 'raw': '(horizontal-viewport-segments: 2)' },
			'spanning-vertical': { 'raw': '(vertical-viewport-segments: 2)' },
			
			// === TOUCH CAPABILITY ===
			'touch': { 'raw': '(pointer: coarse)' },
			'stylus': { 'raw': '(pointer: fine) and (hover: none)' },
			'mouse': { 'raw': '(pointer: fine) and (hover: hover)' },
		},
		extend: {
			colors: {
				// Primary colors (Violet accent)
				primary: {
					50: '#F5F3FF',
					100: '#E9E5FF',
					500: '#757AED',
					600: '#6366F1',
					700: '#5B64EA',
					900: '#4C4699',
					DEFAULT: '#757AED',
				},
				// Neutral colors
				neutral: {
					50: '#FAFBFF',
					100: '#F4F5F9',
					200: '#E8EAF0',
					300: '#D1D5DB',
					400: '#9CA3AF',
					500: '#6B7280',
					600: '#4B5563',
					700: '#374151',
					800: '#1F2937',
					900: '#111827',
				},
				// Glass colors
				glass: {
					light: 'rgba(255, 255, 255, 0.4)',
					medium: 'rgba(255, 255, 255, 0.3)',
					subtle: 'rgba(255, 255, 255, 0.15)',
					dark: 'rgba(30, 30, 30, 0.5)',
				},
				// Semantic colors
				success: '#10B981',
				error: '#EF4444',
				warning: '#F59E0B',
				info: '#3B82F6',
			},
			fontFamily: {
				sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
				mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
			},
			fontSize: {
				hero: ['48px', { lineHeight: '1.1', fontWeight: '700', letterSpacing: '-0.02em' }],
				h1: ['32px', { lineHeight: '1.2', fontWeight: '600', letterSpacing: '-0.01em' }],
				h2: ['24px', { lineHeight: '1.3', fontWeight: '600' }],
				h3: ['20px', { lineHeight: '1.3', fontWeight: '500' }],
				'body-lg': ['16px', { lineHeight: '1.6', fontWeight: '500' }],
				body: ['14px', { lineHeight: '1.5', fontWeight: '500' }],
				small: ['12px', { lineHeight: '1.4', fontWeight: '400', letterSpacing: '0.01em' }],
				caption: ['11px', { lineHeight: '1.4', fontWeight: '400', letterSpacing: '0.01em' }],
			},
			spacing: {
				xs: '4px',
				sm: '8px',
				md: '16px',
				lg: '24px',
				xl: '32px',
				'2xl': '48px',
				'3xl': '64px',
				'4xl': '96px',
				// Hinge-aware spacing for foldable devices
				'hinge': '48px',           // Samsung Z Fold hinge width
				'hinge-sm': '32px',        // Oppo Find N hinge width
				'hinge-lg': '56px',        // Larger hinge accommodation
				'hinge-honor': '40px',     // Honor Magic V3 hinge width
				// Safe area spacing
				'safe-top': 'env(safe-area-inset-top, 0px)',
				'safe-bottom': 'env(safe-area-inset-bottom, 0px)',
				'safe-left': 'env(safe-area-inset-left, 0px)',
				'safe-right': 'env(safe-area-inset-right, 0px)',
				// Touch target sizes
				'touch-min': '44px',
				'touch-comfortable': '48px',
				'touch-large': '52px',
			},
			minWidth: {
				'touch': '44px',
				'touch-lg': '48px',
				'touch-xl': '52px',
			},
			minHeight: {
				'touch': '44px',
				'touch-lg': '48px',
				'touch-xl': '52px',
			},
			aspectRatio: {
				'video': '16 / 9',
				'video-wide': '21 / 9',
				'square': '1 / 1',
				'fold-cover': '9 / 21',
				'fold-inner': '5 / 4',
				'phone': '9 / 19',
			},
			borderRadius: {
				sm: '8px',
				md: '12px',
				lg: '16px',
				xl: '20px',
				'2xl': '24px',
			},
			boxShadow: {
				'glass-sm': '0 4px 16px rgba(0, 0, 0, 0.06)',
				'glass-md': '0 8px 32px rgba(0, 0, 0, 0.1)',
				'glass-lg': '0 12px 40px rgba(0, 0, 0, 0.15)',
				focus: '0 0 0 3px rgba(117, 122, 237, 0.2)',
				'glow-violet': '0 4px 20px rgba(117, 122, 237, 0.3)',
			},
			backdropBlur: {
				light: '15px',
				medium: '20px',
				strong: '40px',
			},
			transitionDuration: {
				fast: '200ms',
				base: '300ms',
				slow: '400ms',
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out',
				'spin-slow': 'spin 2s linear infinite',
				'fold-transition': 'fold-transition 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
			},
			keyframes: {
				'accordion-down': {
					from: { height: 0 },
					to: { height: 'var(--radix-accordion-content-height)' },
				},
				'accordion-up': {
					from: { height: 'var(--radix-accordion-content-height)' },
					to: { height: 0 },
				},
				'fold-transition': {
					from: { opacity: 0.8, transform: 'scale(0.98)' },
					to: { opacity: 1, transform: 'scale(1)' },
				},
			},
		},
	},
	plugins: [
		require('tailwindcss-animate'),
		// Custom plugin for fold-aware utilities
		function({ addUtilities, addVariant }) {
			// Add fold-aware utilities
			addUtilities({
				// Hinge avoidance utilities
				'.avoid-hinge': {
					'@media (horizontal-viewport-segments: 2)': {
						'padding-left': 'max(16px, env(viewport-segment-right 0 0, 0px))',
						'padding-right': 'max(16px, calc(100% - env(viewport-segment-left 1 0, 100%)))',
					},
				},
				'.span-fold': {
					'@media (horizontal-viewport-segments: 2)': {
						'grid-column': '1 / -1',
					},
				},
				'.left-of-fold': {
					'@media (horizontal-viewport-segments: 2)': {
						'grid-column': '1',
						'max-width': 'env(viewport-segment-width 0 0, 50%)',
					},
				},
				'.right-of-fold': {
					'@media (horizontal-viewport-segments: 2)': {
						'grid-column': '2',
						'max-width': 'env(viewport-segment-width 1 0, 50%)',
					},
				},
				// Hinge gap utilities
				'.gap-hinge': {
					'gap': '48px',
				},
				'.gap-hinge-sm': {
					'gap': '32px',
				},
				'.gap-hinge-lg': {
					'gap': '56px',
				},
				// Safe area utilities
				'.safe-area-inset': {
					'padding-top': 'env(safe-area-inset-top, 0px)',
					'padding-bottom': 'env(safe-area-inset-bottom, 0px)',
					'padding-left': 'env(safe-area-inset-left, 0px)',
					'padding-right': 'env(safe-area-inset-right, 0px)',
				},
				'.safe-area-top': {
					'padding-top': 'env(safe-area-inset-top, 0px)',
				},
				'.safe-area-bottom': {
					'padding-bottom': 'env(safe-area-inset-bottom, 0px)',
				},
				'.safe-area-left': {
					'padding-left': 'env(safe-area-inset-left, 0px)',
				},
				'.safe-area-right': {
					'padding-right': 'env(safe-area-inset-right, 0px)',
				},
				// Touch target utilities
				'.touch-target': {
					'min-width': '44px',
					'min-height': '44px',
				},
				'.touch-target-lg': {
					'min-width': '48px',
					'min-height': '48px',
				},
				'.touch-target-xl': {
					'min-width': '52px',
					'min-height': '52px',
				},
			});
			
			// Add fold state variants
			addVariant('folded', '@media (max-width: 450px)');
			addVariant('unfolded', '@media (min-width: 451px) and (max-aspect-ratio: 5/4)');
			addVariant('spanning', '@media (horizontal-viewport-segments: 2)');
			addVariant('fold-cover', '@media (max-width: 320px)');
			addVariant('fold-inner', '@media (min-width: 500px) and (max-width: 720px) and (min-aspect-ratio: 3/4)');
		},
	],
}
