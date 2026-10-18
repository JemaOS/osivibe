import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Header } from '../../src/components/Header';
import { useEditorStore } from '../../src/store/editorStore';
import { I18nProvider } from '../../src/i18n';

// Mock the store en conservant la forme rÃ©elle (ui inclus) et en supportant
// aussi bien useEditorStore() que useEditorStore(selector).
vi.mock('../../src/store/editorStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/store/editorStore')>();
  const real = actual.useEditorStore;
  const mocked = ((selector?: (s: ReturnType<typeof real.getState>) => unknown) => {
    const s = real.getState();
    return selector ? selector(s) : s;
  }) as typeof real;
  mocked.getState = real.getState;
  mocked.setState = real.setState;
  mocked.subscribe = real.subscribe;
  return { ...actual, useEditorStore: mocked };
});

// Mock responsive hooks
vi.mock('../../src/hooks/use-responsive', () => ({
  useResponsive: () => ({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    foldState: 'flat',
    touchTargetSize: 44,
  }),
  useLayoutMode: () => 'desktop',
}));

describe('Header Component', () => {
  it('renders project name', () => {
    useEditorStore.setState({ projectName: 'Test Project' });
    render(
      <I18nProvider>
        <Header isSidebarVisible={true} onToggleSidebar={() => {}} />
      </I18nProvider>
    );
    expect(screen.getByText('Test Project')).toBeInTheDocument();
  });
});

