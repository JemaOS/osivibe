import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Header } from '../../src/components/Header';

// Mock the store
vi.mock('../../src/store/editorStore', () => ({
  useEditorStore: () => ({
    projectName: 'Test Project',
    setProjectName: vi.fn(),
    openExportModal: vi.fn(),
    projects: [],
    currentProjectId: '1',
    createProject: vi.fn(),
    loadProject: vi.fn(),
    deleteProject: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
  }),
}));

// Mock responsive hooks
vi.mock('../../src/hooks/use-responsive', () => ({
  useResponsive: () => ({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    foldState: 'flat',
  }),
  useLayoutMode: () => 'desktop',
}));

describe('Header Component', () => {
  it('renders project name', () => {
    render(<Header isSidebarVisible={true} onToggleSidebar={() => {}} />);
    expect(screen.getByText('Test Project')).toBeInTheDocument();
  });
});
