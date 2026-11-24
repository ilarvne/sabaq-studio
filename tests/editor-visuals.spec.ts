import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const appearance of ['dark','light']) {
  for (const [width,height] of [[1440,900],[1024,768],[820,1180],[375,812],[320,640]]) {
    test(`editor controls and assistant fit ${width}px in ${appearance}`,async({page}, testInfo)=>{
      await page.setViewportSize({width,height});
      await page.addInitScript(({appearance})=>{
        localStorage.setItem('sabaq:locale','en');
        localStorage.setItem('sabaq:dark',appearance==='dark' ? '1' : '0');
      },{appearance});
      await page.goto('/#/deck/schoolyard-en');
      await expect(page.locator('.ed-stage .ed-slide')).toBeVisible();
      const prompt=page.getByRole('textbox',{name:'Ask about this slide…'});
      await expect(prompt).toBeInViewport({ratio:1});
      await expect(page.getByRole('button',{name:'Insert',exact:true})).toBeInViewport({ratio:1});
      await page.evaluate(()=>document.fonts.ready);
      await page.screenshot({path:testInfo.outputPath(`${appearance}-${width}-assistant.png`)});
      const overflow=await page.evaluate(()=>({page:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        toolbar:Array.from(document.querySelectorAll<HTMLElement>('.ed-canvas-tools')).map(element=>element.scrollWidth-element.clientWidth)}));
      expect(overflow.page).toBeLessThanOrEqual(1);
      expect(overflow.toolbar.every(value=>value<=1)).toBe(true);
      const audit=async()=>{
        const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
        expect(result.violations.filter(item=>item.impact==='serious' || item.impact==='critical')).toEqual([]);
      };
      if(width===1440 || width===375)await audit();
      await page.getByRole('tab',{name:'Design',exact:true}).click();
      await expect(page.getByRole('button',{name:'Arrange elements',exact:true})).toBeVisible();
      await page.screenshot({path:testInfo.outputPath(`${appearance}-${width}-design.png`)});
      await page.getByRole('button',{name:'Insert',exact:true}).click();
      for (const name of ['Image','Table','Chart','Formula','Icon','Diagram from text']) {
        await expect(page.getByRole('menuitem',{name,exact:true})).toBeVisible();
      }
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-base-ui-focus-guard]')).toHaveCount(0);
      if(width===1440 || width===375)await audit();
    });
  }
}
