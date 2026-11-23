import { expect, test } from '@playwright/test';

test('installed local dictation previews speech and commits the final transcript to the brief', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('sabaq:locale', 'en');
    class LocalRecognition {
      private local = false;
      get processLocally() { return this.local; }
      set processLocally(value: boolean) { this.local = value; }
      static async available(options: {processLocally: boolean; langs: string[]}) {
        return options.processLocally && options.langs.includes('en-US') ? 'available' : 'unavailable';
      }
      onstart?: () => void;
      onend?: () => void;
      onresult?: (event: {resultIndex: number; results: {isFinal: boolean; 0: {transcript: string}}[]}) => void;
      start() {
        if (!this.processLocally) throw new Error('A local recognition session is required');
        queueMicrotask(() => {
          this.onstart?.();
          this.onresult?.({resultIndex: 0, results: [{isFinal: false, 0: {transcript: 'the water cycle'}}]});
        });
      }
      stop() {
        this.onresult?.({resultIndex: 0, results: [{isFinal: true, 0: {transcript: 'the water cycle'}}]});
        this.onend?.();
      }
      abort() { this.onend?.(); }
    }
    Object.defineProperty(window, 'SpeechRecognition', {value: LocalRecognition, configurable: true});
  });
  await page.goto('/');
  const input = page.getByRole('textbox', {name: 'Presentation brief'});
  await input.fill('Introduce');
  await page.getByRole('button', {name: 'Dictate on this device'}).click();
  await expect(page.getByRole('status').filter({hasText: 'Listening on this device'})).toContainText('the water cycle');
  await expect(page.getByRole('button', {name: 'Generate', exact: true})).toBeDisabled();
  await page.getByRole('button', {name: 'Stop dictating'}).click();
  await expect(input).toHaveValue('Introduce the water cycle');
  await expect(page.getByRole('button', {name: 'Generate', exact: true})).toBeEnabled();
});

test('the homepage hides dictation when the browser only exposes network speech recognition', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('sabaq:locale', 'en');
    class NetworkRecognition {
      start() { throw new Error('Network speech recognition should never start'); }
    }
    Object.defineProperty(window, 'SpeechRecognition', {value: NetworkRecognition, configurable: true});
  });
  await page.goto('/');
  await expect(page.getByRole('textbox', {name: 'Presentation brief'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Dictate on this device'})).toHaveCount(0);
});
