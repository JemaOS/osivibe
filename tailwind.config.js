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
			'xxs': '360px',  // iPhone 12 mini
			'xs': '375px',   // iPhone SE 2020+, iPhone 6/7/8
			'sm': '640px',
			'md': '768px',
			'lg': '1024px',
			'xl': '1280px',
			'2xl': '1536px',
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
			},
		},
	},
	plugins: [require('tailwindcss-animate')],
}
