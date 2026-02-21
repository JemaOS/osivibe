import { test, expect } from '@playwright/test';

test.describe('Performance', () => {
  test('should load the homepage within acceptable time', async ({ page }) => {
    const startTime = Date.now();
    await page.goto('/');
    const loadTime = Date.now() - startTime;
    
    console.log(`Page load time: ${loadTime}ms`);
    
    // Expect load time to be under 2 seconds (adjust based on environment)
    expect(loadTime).toBeLessThan(2000);
  });

  test('should not have significant layout shifts', async ({ page }) => {
    await page.goto('/');
    
    // Check Cumulative Layout Shift (CLS)
    const cls = await page.evaluate(() => {
      return new Promise((resolve) => {
        let cumulativeLayoutShift = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as any[]) {
            if (!entry.hadRecentInput) {
              cumulativeLayoutShift += entry.value;
            }
          }
        });
        
        observer.observe({ type: 'layout-shift', buffered: true });
        
        // Wait a bit to capture shifts
        setTimeout(() => {
          observer.disconnect();
          resolve(cumulativeLayoutShift);
        }, 1000);
      });
    });

    console.log(`CLS: ${cls}`);
    expect(cls).toBeLessThan(0.1); // Google's recommended threshold
  });
});
