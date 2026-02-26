import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES Module dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a minimal valid video file for testing
const FIXTURES_DIR = path.join(__dirname, '../fixtures');
const SAMPLE_VIDEO_PATH = path.join(FIXTURES_DIR, 'sample.mp4');

// Test all export combinations
const EXPORT_OPTIONS = {
  resolutions: ['720p', '1080p', '4K'],
  formats: ['mp4', 'webm'],
  fpsValues: ['30', '60', '120'],
  qualities: ['low', 'medium', 'high'],
  aspectRatios: ['16:9', '9:16', '1:1', '4:3', '21:9']
};

test.describe('Export Options Tests', () => {
  test.beforeAll(async () => {
    // Create fixtures directory if it doesn't exist
    if (!fs.existsSync(FIXTURES_DIR)) {
      fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    }

    // Create a dummy MP4 file if it doesn't exist
    if (!fs.existsSync(SAMPLE_VIDEO_PATH)) {
      // Write a minimal dummy file - app will use default duration (5s) if metadata extraction fails
      fs.writeFileSync(SAMPLE_VIDEO_PATH, 'dummy video content for testing', 'utf8');
    }
  });

  test.beforeEach(async ({ page }) => {
    // Navigate to app
    await page.goto('/');
    
    // Upload video
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(SAMPLE_VIDEO_PATH);
    
    // Wait for media item to appear
    const mediaItem = page.getByText('sample.mp4');
    await expect(mediaItem).toBeVisible({ timeout: 10000 });
    
    // Add to timeline (Double click)
    await mediaItem.dblclick();
    
    // Open Export Modal
    await page.getByRole('button', { name: /Exporter/i }).first().click();
    
    // Wait for modal to open
    await expect(page.getByText('Exporter la video')).toBeVisible({ timeout: 5000 });
  });

  // Test Resolution Options
  for (const resolution of EXPORT_OPTIONS.resolutions) {
    test(`should have ${resolution} resolution option`, async ({ page }) => {
      const resolutionButton = page.getByRole('button', { name: resolution });
      await expect(resolutionButton).toBeVisible();
      await resolutionButton.click();
      await expect(resolutionButton).toHaveClass(/bg-primary-500/);
    });
  }

  // Test Format Options
  for (const format of EXPORT_OPTIONS.formats) {
    test(`should have ${format.toUpperCase()} format option`, async ({ page }) => {
      const formatButton = page.getByRole('button', { name: format.toUpperCase() });
      await expect(formatButton).toBeVisible();
      await formatButton.click();
      await expect(formatButton).toHaveClass(/bg-primary-500/);
    });
  }

  // Test FPS Options
  for (const fps of EXPORT_OPTIONS.fpsValues) {
    test(`should have ${fps} FPS option`, async ({ page }) => {
      const fpsButton = page.getByRole('button', { name: fps });
      await expect(fpsButton).toBeVisible();
      await fpsButton.click();
      await expect(fpsButton).toHaveClass(/bg-primary-500/);
    });
  }

  // Test Quality Options
  for (const quality of EXPORT_OPTIONS.qualities) {
    const qualityLabels = {
      'low': 'Basse',
      'medium': 'Moyenne',
      'high': 'Haute'
    };
    
    test(`should have ${qualityLabels[quality as keyof typeof qualityLabels]} quality option`, async ({ page }) => {
      const qualityButton = page.getByRole('button', { name: qualityLabels[quality as keyof typeof qualityLabels] });
      await expect(qualityButton).toBeVisible();
      await qualityButton.click();
      await expect(qualityButton).toHaveClass(/bg-primary-500/);
    });
  }

  // Test Aspect Ratio Options
  for (const ratio of EXPORT_OPTIONS.aspectRatios) {
    const ratioDescriptions: Record<string, string> = {
      '16:9': 'Paysage (YouTube, TV)',
      '9:16': 'Portrait (TikTok, Reels)',
      '1:1': 'Carré (Instagram)',
      '4:3': 'Classique',
      '21:9': 'Cinéma'
    };
    
    test(`should have ${ratio} aspect ratio option`, async ({ page }) => {
      const ratioButton = page.getByRole('button', { name: ratio });
      await expect(ratioButton).toBeVisible();
      await ratioButton.click();
      await expect(ratioButton).toHaveClass(/bg-primary-500/);
      
      // Verify description is shown
      const description = page.getByText(ratioDescriptions[ratio]);
      await expect(description).toBeVisible();
    });
  }

  // Test Filename Input
  test('should have filename input', async ({ page }) => {
    const filenameInput = page.getByLabel('Nom du fichier');
    await expect(filenameInput).toBeVisible();
    
    // Test typing in filename
    await filenameInput.fill('my-custom-video');
    await expect(filenameInput).toHaveValue('my-custom-video');
  });

  // Test Export Button
  test('should have export button', async ({ page }) => {
    const exportButton = page.getByRole('button', { name: /Exporter/ });
    await expect(exportButton).toBeVisible();
  });

  // Test Cancel Button
  test('should have cancel button', async ({ page }) => {
    const cancelButton = page.getByRole('button', { name: /Annuler/ });
    await expect(cancelButton).toBeVisible();
  });

  // Test Combined Export Options
  test('should export with all options combined', async ({ page }) => {
    // Select all options
    await page.getByRole('button', { name: '4K' }).click();
    await page.getByRole('button', { name: 'WEBM' }).click();
    await page.getByRole('button', { name: '60' }).click();
    await page.getByRole('button', { name: 'Haute' }).click();
    await page.getByRole('button', { name: '16:9' }).click();
    
    // Set filename
    await page.getByLabel('Nom du fichier').fill('test-export');
    
    // Verify export button is enabled
    const exportButton = page.getByRole('button', { name: /Exporter/ });
    await expect(exportButton).toBeEnabled();
  });
});

test.describe('Export Modal UI Tests', () => {
  test('should open and close export modal', async ({ page }) => {
    await page.goto('/');
    
    // Upload video first
    if (!fs.existsSync(SAMPLE_VIDEO_PATH)) {
      fs.mkdirSync(FIXTURES_DIR, { recursive: true });
      fs.writeFileSync(SAMPLE_VIDEO_PATH, 'dummy video content', 'utf8');
    }
    
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(SAMPLE_VIDEO_PATH);
    
    const mediaItem = page.getByText('sample.mp4');
    await expect(mediaItem).toBeVisible({ timeout: 10000 });
    await mediaItem.dblclick();
    
    // Open modal
    await page.getByRole('button', { name: /Exporter/i }).first().click();
    await expect(page.getByText('Exporter la video')).toBeVisible();
    
    // Close with Cancel button
    await page.getByRole('button', { name: 'Annuler' }).first().click();
  });
});
    });
  }

  // Test Format Options
  for (const format of EXPORT_OPTIONS.formats) {
    test(`should have ${format.toUpperCase()} format option`, async ({ page }) => {
      const formatButton = page.getByRole('button', { name: format.toUpperCase() });
      await expect(formatButton).toBeVisible();
      await formatButton.click();
      await expect(formatButton).toHaveClass(/bg-primary-500/);
    });
  }

  // Test FPS Options
  for (const fps of EXPORT_OPTIONS.fpsValues) {
    test(`should have ${fps} FPS option`, async ({ page }) => {
      const fpsButton = page.getByRole('button', { name: fps });
      await expect(fpsButton).toBeVisible();
      await fpsButton.click();
      await expect(fpsButton).toHaveClass(/bg-primary-500/);
    });
  }

  // Test Quality Options
  for (const quality of EXPORT_OPTIONS.qualities) {
    const qualityLabels = {
      'low': 'Basse',
      'medium': 'Moyenne',
      'high': 'Haute'
    };
    
    test(`should have ${qualityLabels[quality as keyof typeof qualityLabels]} quality option`, async ({ page }) => {
      const qualityButton = page.getByRole('button', { name: qualityLabels[quality as keyof typeof qualityLabels] });
      await expect(qualityButton).toBeVisible();
      await qualityButton.click();
      await expect(qualityButton).toHaveClass(/bg-primary-500/);
    });
  }

  // Test Aspect Ratio Options
  for (const ratio of EXPORT_OPTIONS.aspectRatios) {
    const ratioDescriptions: Record<string, string> = {
      '16:9': 'Paysage (YouTube, TV)',
      '9:16': 'Portrait (TikTok, Reels)',
      '1:1': 'Carré (Instagram)',
      '4:3': 'Classique',
      '21:9': 'Cinéma'
    };
    
    test(`should have ${ratio} aspect ratio option`, async ({ page }) => {
      const ratioButton = page.getByRole('button', { name: ratio });
      await expect(ratioButton).toBeVisible();
      await ratioButton.click();
      await expect(ratioButton).toHaveClass(/bg-primary-500/);
      
      // Verify description is shown
      const description = page.getByText(ratioDescriptions[ratio]);
      await expect(description).toBeVisible();
    });
  }

  // Test Filename Input
  test('should have filename input', async ({ page }) => {
    const filenameInput = page.getByLabel('Nom du fichier');
    await expect(filenameInput).toBeVisible();
    
    // Test typing in filename
    await filenameInput.fill('my-custom-video');
    await expect(filenameInput).toHaveValue('my-custom-video');
  });

  // Test Export Button
  test('should have export button', async ({ page }) => {
    const exportButton = page.getByRole('button', { name: /Exporter/ });
    await expect(exportButton).toBeVisible();
  });

  // Test Cancel Button
  test('should have cancel button', async ({ page }) => {
    const cancelButton = page.getByRole('button', { name: /Annuler/ });
    await expect(cancelButton).toBeVisible();
  });

  // Test Combined Export Options
  test('should export with all options combined', async ({ page }) => {
    // Select all options
    await page.getByRole('button', { name: '4K' }).click();
    await page.getByRole('button', { name: 'WEBM' }).click();
    await page.getByRole('button', { name: '60' }).click();
    await page.getByRole('button', { name: 'Haute' }).click();
    await page.getByRole('button', { name: '16:9' }).click();
    
    // Set filename
    await page.getByLabel('Nom du fichier').fill('test-export');
    
    // Verify export button is enabled
    const exportButton = page.getByRole('button', { name: /Exporter/ });
    await expect(exportButton).toBeEnabled();
  });
});

test.describe('Export Modal UI Tests', () => {
  test('should open and close export modal', async ({ page }) => {
    await page.goto('/');
    
    // Upload video first
    if (!fs.existsSync(SAMPLE_VIDEO_PATH)) {
      fs.mkdirSync(FIXTURES_DIR, { recursive: true });
      fs.writeFileSync(SAMPLE_VIDEO_PATH, 'dummy video content', 'utf8');
    }
    
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(SAMPLE_VIDEO_PATH);
    
    const mediaItem = page.getByText('sample.mp4');
    await expect(mediaItem).toBeVisible({ timeout: 10000 });
    await mediaItem.dblclick();
    
    // Open modal
    await page.getByRole('button', { name: /Exporter/i }).first().click();
    await expect(page.getByText('Exporter la video')).toBeVisible();
    
    // Close with Cancel button
    await page.getByRole('button', { name: 'Annuler' }).first().click();
  });
});

    await page.getByRole('button', { name: /Exporter/i }).first().click();
    await page.getByRole('button', { name: 'Annuler' }).first().click();
  });
});
import fs from 'fs';
import path from 'path';

// Create a minimal valid video file for testing
const FIXTURES_DIR = path.join(__dirname, '../fixtures');
const SAMPLE_VIDEO_PATH = path.join(FIXTURES_DIR, 'sample.mp4');

// Test all export combinations
const EXPORT_OPTIONS = {
  resolutions: ['720p', '1080p', '4K'],
  formats: ['mp4', 'webm'],
  fpsValues: ['30', '60', '120'],
  qualities: ['low', 'medium', 'high'],
  aspectRatios: ['16:9', '9:16', '1:1', '4:3', '21:9']
};

test.describe('Export Options Tests', () => {
  test.beforeAll(async () => {
    // Create fixtures directory if it doesn't exist
    if (!fs.existsSync(FIXTURES_DIR)) {
      fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    }

    // Create a dummy MP4 file if it doesn't exist
    if (!fs.existsSync(SAMPLE_VIDEO_PATH)) {
      // Write a minimal dummy file - app will use default duration (5s) if metadata extraction fails
      fs.writeFileSync(SAMPLE_VIDEO_PATH, 'dummy video content for testing', 'utf8');
    }
  });

  test.beforeEach(async ({ page }) => {
    // Navigate to app
    await page.goto('/');
    
    // Upload video
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(SAMPLE_VIDEO_PATH);
    
    // Wait for media item to appear
    const mediaItem = page.getByText('sample.mp4');
    await expect(mediaItem).toBeVisible({ timeout: 10000 });
    
    // Add to timeline (Double click)
    await mediaItem.dblclick();
    
    // Open Export Modal
    await page.getByRole('button', { name: /Exporter/i }).first().click();
    
    // Wait for modal to open
    await expect(page.getByText('Exporter la video')).toBeVisible({ timeout: 5000 });
  });

  // Test Resolution Options
  for (const resolution of EXPORT_OPTIONS.resolutions) {
    test(`should have ${resolution} resolution option`, async ({ page }) => {
      const resolutionButton = page.getByRole('button', { name: resolution });
      await expect(resolutionButton).toBeVisible();
      await resolutionButton.click();
      await expect(resolutionButton).toHaveClass(/bg-primary-500/);
    });
  }

  // Test Format Options
  for (const format of EXPORT_OPTIONS.formats) {
    test(`should have ${format.toUpperCase()} format option`, async ({ page }) => {
      const formatButton = page.getByRole('button', { name: format.toUpperCase() });
      await expect(formatButton).toBeVisible();
      await formatButton.click();
      await expect(formatButton).toHaveClass(/bg-primary-500/);
    });
  }

  // Test FPS Options
  for (const fps of EXPORT_OPTIONS.fpsValues) {
    test(`should have ${fps} FPS option`, async ({ page }) => {
      const fpsButton = page.getByRole('button', { name: fps });
      await expect(fpsButton).toBeVisible();
      await fpsButton.click();
      await expect(fpsButton).toHaveClass(/bg-primary-500/);
    });
  }

  // Test Quality Options
  for (const quality of EXPORT_OPTIONS.qualities) {
    const qualityLabels = {
      'low': 'Basse',
      'medium': 'Moyenne',
      'high': 'Haute'
    };
    
    test(`should have ${qualityLabels[quality as keyof typeof qualityLabels]} quality option`, async ({ page }) => {
      const qualityButton = page.getByRole('button', { name: qualityLabels[quality as keyof typeof qualityLabels] });
      await expect(qualityButton).toBeVisible();
      await qualityButton.click();
      await expect(qualityButton).toHaveClass(/bg-primary-500/);
    });
  }

  // Test Aspect Ratio Options
  for (const ratio of EXPORT_OPTIONS.aspectRatios) {
    const ratioDescriptions: Record<string, string> = {
      '16:9': 'Paysage (YouTube, TV)',
      '9:16': 'Portrait (TikTok, Reels)',
      '1:1': 'Carré (Instagram)',
      '4:3': 'Classique',
      '21:9': 'Cinéma'
    };
    
    test(`should have ${ratio} aspect ratio option`, async ({ page }) => {
      const ratioButton = page.getByRole('button', { name: ratio });
      await expect(ratioButton).toBeVisible();
      await ratioButton.click();
      await expect(ratioButton).toHaveClass(/bg-primary-500/);
      
      // Verify description is shown
      const description = page.getByText(ratioDescriptions[ratio]);
      await expect(description).toBeVisible();
    });
  }

  // Test Filename Input
  test('should have filename input', async ({ page }) => {
    const filenameInput = page.getByLabel('Nom du fichier');
    await expect(filenameInput).toBeVisible();
    
    // Test typing in filename
    await filenameInput.fill('my-custom-video');
    await expect(filenameInput).toHaveValue('my-custom-video');
  });

  // Test Export Button
  test('should have export button', async ({ page }) => {
    const exportButton = page.getByRole('button', { name: /Exporter/ });
    await expect(exportButton).toBeVisible();
  });

  // Test Cancel Button
  test('should have cancel button', async ({ page }) => {
    const cancelButton = page.getByRole('button', { name: /Annuler/ });
    await expect(cancelButton).toBeVisible();
  });

  // Test Combined Export Options
  test('should export with all options combined', async ({ page }) => {
    // Select all options
    await page.getByRole('button', { name: '4K' }).click();
    await page.getByRole('button', { name: 'WEBM' }).click();
    await page.getByRole('button', { name: '60' }).click();
    await page.getByRole('button', { name: 'Haute' }).click();
    await page.getByRole('button', { name: '16:9' }).click();
    
    // Set filename
    await page.getByLabel('Nom du fichier').fill('test-export');
    
    // Verify export button is enabled
    const exportButton = page.getByRole('button', { name: /Exporter/ });
    await expect(exportButton).toBeEnabled();
  });
});

test.describe('Export Modal UI Tests', () => {
  test('should open and close export modal', async ({ page }) => {
    await page.goto('/');
    
    // Upload video first
    if (!fs.existsSync(SAMPLE_VIDEO_PATH)) {
      fs.mkdirSync(FIXTURES_DIR, { recursive: true });
      fs.writeFileSync(SAMPLE_VIDEO_PATH, 'dummy video content', 'utf8');
    }
    
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(SAMPLE_VIDEO_PATH);
    
    const mediaItem = page.getByText('sample.mp4');
    await expect(mediaItem).toBeVisible({ timeout: 10000 });
    await mediaItem.dblclick();
    
    // Open modal
    await page.getByRole('button', { name: /Exporter/i }).first().click();
    await expect(page.getByText('Exporter la video')).toBeVisible();
    
    // Close modal with X button
    await page.locator('button').filter({ hasText: '' }).first().click(); // Close button
    // Or use the close icon button
    
    // Close with Cancel button
    await page.getByRole('button', { name: /Exporter/i }).first().click();
    await page.getByRole('button', { name: 'Annuler' }).first().click();
  });
});

    await page.getByRole('button', { name: 'Annuler' }).first().click();
  });
});


    await page.getByRole('button', { name: 'Annuler' }).first().click();
  });
});

    await page.getByRole('button', { name: 'Annuler' }).first().click();
  });
});


