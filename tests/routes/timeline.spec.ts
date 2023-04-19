import { expect, test } from '@playwright/test';
import { expectDeleteUser, generateUserAndSignIn } from '../helpers.js';

test.describe('/timeline', () => {
    test('Cannot visit page without authentication', async ({ page }) => {
        await page.goto('/timeline', { waitUntil: 'networkidle' });
        await expect(page).toHaveURL('/?redirect=timeline');
    });

    test('Can view page', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' });
        const { api } = await generateUserAndSignIn(page);
        await page.goto('/timeline', { waitUntil: 'networkidle' });
        await expect(page).toHaveURL('/timeline');
        await expectDeleteUser(api, expect);
    });
});
