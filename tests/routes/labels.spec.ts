import { expect, test } from '@playwright/test';
import { expectDeleteUser, generateUserAndSignIn } from '../helpers.js';

test.describe('/labels', () => {
    test('Cannot visit page without authentication', async ({ page }) => {
        await page.goto('/labels', { waitUntil: 'networkidle' });
        await expect(page).toHaveURL('/?redirect=labels');
    });

    test('Can view page', async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' });
        const { api } = await generateUserAndSignIn(page);
        await page.goto('/labels', { waitUntil: 'networkidle' });
        await expect(page).toHaveURL('/labels');
        await expectDeleteUser(api, expect);
    });
});
