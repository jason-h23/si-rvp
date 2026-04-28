import { chromium } from 'playwright';

const URL = 'http://localhost:8080/dashboard.html';

async function clickPlay(page) {
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent.trim();
      if (text === '▶' || text === '⏸') {
        btn.click();
        return;
      }
    }
  });
}

async function selectScenario(page, value) {
  await page.evaluate((val) => {
    const select = document.querySelector('select');
    if (select) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype, 'value'
      ).set;
      nativeInputValueSetter.call(select, val);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, value);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: '/tmp/demo-video/', size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Scenario 1: Dispute Early
  console.log('1/3 Dispute Early - playing...');
  await selectScenario(page, 'dispute_early');
  await page.waitForTimeout(1000);
  await clickPlay(page);
  await page.waitForTimeout(10000);
  console.log('1/3 Dispute Early - proof generation...');
  await page.waitForTimeout(17000);

  // Scenario 2: On-chain Dispute
  console.log('2/3 On-chain Dispute...');
  await selectScenario(page, 'onchain_dispute');
  await page.waitForTimeout(2000);
  await clickPlay(page);
  await page.waitForTimeout(8000);
  console.log('2/3 On-chain Dispute - proof...');
  await page.waitForTimeout(17000);

  // Scenario 3: Happy Path
  console.log('3/3 Happy Path...');
  await selectScenario(page, 'happy_path');
  await page.waitForTimeout(2000);
  await clickPlay(page);
  await page.waitForTimeout(12000);

  console.log('Saving video...');
  const videoPath = await page.video().path();
  await page.close();
  await context.close();
  await browser.close();

  console.log('Video saved: ' + videoPath);
}

main().catch(e => { console.error(e); process.exit(1); });
