import { expect, test } from '@playwright/test';
import type { AvatarConsent, VideoJob, VideoState } from '@sabaq/contracts/video';
import type { Deck } from '@sabaq/lesson/types';

test('a teacher can enroll, export with their avatar, and revoke access', async ({ page, request }) => {
  const deckPath = '/api/decks/schoolyard-en';
  const deck: Deck = await (await request.get(deckPath)).json();
  const videoPath = `${deckPath}/video`;
  const consentPath = '/api/biometrics/self';
  const enrollmentUrl = 'https://regional-operator.test/enrollment';
  const key = 'a'.repeat(64);
  let consent: AvatarConsent = { configured: true, policy: '2026-11', state: 'none' };
  let job: VideoJob | undefined;
  let starts = 0;
  let finishDeletion!: () => void;
  const deletion = new Promise<void>(resolve => { finishDeletion = resolve; });

  await page.route(`**${consentPath}/enrollment`, async route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({ consent: true, policy: consent.policy });
    consent = { ...consent, state: 'enrolling' };
    await route.fulfill({ json: { enrollmentUrl } });
  });
  await page.route(`**${consentPath}`, async route => {
    switch (route.request().method()) {
      case 'GET':
        if (consent.state === 'enrolling') consent = { ...consent, state: 'active' };
        await route.fulfill({ json: consent });
        break;
      case 'DELETE':
        await deletion;
        consent = { ...consent, state: 'deleting' };
        await route.fulfill({ status: 202, json: consent });
        break;
      default:
        await route.fulfill({ status: 405 });
    }
  });
  await page.route(`**${videoPath}`, async route => {
    const request = route.request();
    const avatar = consent.state === 'active';
    if (request.method() === 'POST') {
      expect(avatar).toBe(true);
      const input = request.postDataJSON() as Pick<VideoJob, 'revision' | 'settings'>;
      job = { ...input, key, status: 'queued', completed: 0, total: deck.slides.length };
      starts++;
    }
    await route.fulfill({ json: { enabled: true, avatar, biometrics: consent, ...(avatar && { job }) } satisfies VideoState });
  });

  await page.addInitScript(() => localStorage.setItem('sabaq:locale', 'en'));
  await page.goto('/#/deck/schoolyard-en');
  const open = page.getByRole('button', { name: 'Create video lesson', exact: true });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Export video' });
  const avatar = dialog.getByRole('button', { name: 'With avatar', exact: true });
  const narration = dialog.getByRole('button', { name: 'Narration only', exact: true });
  const consentPanel = dialog.getByText('My avatar and voice', { exact: true });
  const generate = dialog.getByRole('button', { name: 'Generate video lesson', exact: true });
  const download = dialog.getByRole('link', { name: 'Download MP4', exact: true });
  const language = dialog.getByRole('combobox', { name: 'Narration language', exact: true });
  const preview = dialog.getByRole('img', { name: 'Avatar area', exact: true });
  const left = dialog.getByRole('group', { name: 'Avatar position' }).getByRole('button', { name: 'Left', exact: true });
  const clear = dialog.getByRole('group', { name: 'Avatar placement' }).getByRole('button', { name: 'Without background', exact: true });

  await expect(narration).toHaveAttribute('aria-pressed', 'true');
  await expect(avatar).toBeDisabled();
  await expect(preview).toHaveCount(0);
  await expect(generate).toBeEnabled();
  await consentPanel.click();
  const enroll = dialog.getByRole('button', { name: 'Start enrollment', exact: true });
  await expect(enroll).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /^I consent to the regional operator/ }).check();
  await enroll.click();
  await expect(dialog.getByRole('link', { name: 'Open the operator’s enrollment page' })).toHaveAttribute('href', enrollmentUrl);
  await expect(avatar).toBeDisabled();
  await dialog.getByRole('button', { name: 'Check status', exact: true }).click();
  await expect(avatar).toBeEnabled();

  await avatar.click();
  await left.click();
  await clear.click();
  await dialog.getByRole('button', { name: '9:16', exact: true }).click();
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('data-background', 'transparent');
  await language.click();
  await page.getByRole('option', { name: 'Русский', exact: true }).click();
  const start = page.waitForRequest(req => req.method() === 'POST' && new URL(req.url()).pathname === videoPath);
  await generate.click();
  expect((await start).postDataJSON()).toMatchObject({
    revision: deck.revision,
    settings: { language: 'ru', aspect: '9:16', position: 'left', avatarPlacement: 'clear', captions: true },
  });
  await expect(dialog.getByText('Queued for export', { exact: true })).toBeVisible();
  job = { ...job!, status: 'ready', completed: deck.slides.length };
  await expect(download).toHaveAttribute('href', `${videoPath}/${key}/file`);

  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await open.click();
  await expect(avatar).toHaveAttribute('aria-pressed', 'true');
  await expect(left).toHaveAttribute('aria-pressed', 'true');
  await expect(clear).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: '9:16', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(language).toContainText('Русский');
  await expect(download).toHaveAttribute('href', `${videoPath}/${key}/file`);
  expect(starts).toBe(1);

  await consentPanel.click();
  await dialog.getByRole('button', { name: 'Delete my samples, avatar and recordings', exact: true }).click();
  await expect(download).toBeVisible();
  try {
    const revoke = page.waitForRequest(req => req.method() === 'DELETE' && new URL(req.url()).pathname === consentPath);
    await dialog.getByRole('button', { name: 'Confirm deletion', exact: true }).click();
    await revoke;
    await expect(download).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Play video', exact: true })).toHaveCount(0);
    await expect(preview).toHaveCount(0);
    await expect(avatar).toBeDisabled();
    await expect(generate).toBeDisabled();
  } finally {
    finishDeletion();
  }
  await expect(dialog.getByText('Access is revoked. Deletion is pending.', { exact: true })).toBeVisible();
  await expect(download).toHaveCount(0);
  await expect(avatar).toBeDisabled();
  await narration.click();
  await expect(generate).toBeEnabled();
  expect(starts).toBe(1);
});
