import { expect, test } from '@playwright/test';

test('playground renders totals computed by @sellbase/core', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sellbase Playground' })).toBeVisible();
  // 2×349 + 199 = 897; −10% = 89.70; + 99 shipping = 906.30
  await expect(page.getByTestId('total-Total')).toHaveText('$906.30');
});
