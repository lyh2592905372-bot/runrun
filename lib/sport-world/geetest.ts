import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const DEFAULT_CAPTCHA_ID = '3b02ad39bd099fd3a8336d9347a189ab';
const DEFAULT_TIMEOUT_MS = 30_000;

const BRIDGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>GeeTest v4 Bridge</title>
  <script src="https://static.geetest.com/v4/gt4.js"></script>
  <style>body { margin: 0; padding: 20px; background: #fff; }</style>
</head>
<body>
  <div id="captcha-container"></div>
  <script>
    window.gt4Result = null;
    window.gt4Error = null;
    window.gt4Ready = false;
    window.initCaptcha = function initCaptcha(captchaId) {
      initGeetest4({ captchaId: captchaId, product: 'bind', language: 'zh' }, function (captcha) {
        window.captchaObj = captcha;
        captcha.onReady(function () {
          window.gt4Ready = true;
        }).onSuccess(function () {
          window.gt4Result = captcha.getValidate();
        }).onError(function (error) {
          window.gt4Error = error || { message: 'GeeTest 验证失败' };
        });
      });
    };
  </script>
</body>
</html>`;

export type GeeTestV4Result = {
  captchaId: string;
  lotNumber: string;
  passToken: string;
  genTime: string;
  captchaOutput: string;
};

export type GeeTestV4ErrorCode = 'CONFIG_ERROR' | 'NETWORK_ERROR' | 'VERIFY_REQUIRED';

export class GeeTestV4Error extends Error {
  constructor(public readonly code: GeeTestV4ErrorCode, message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'GeeTestV4Error';
  }
}

type BrowserValidation = {
  captcha_id?: unknown;
  lot_number?: unknown;
  pass_token?: unknown;
  gen_time?: unknown;
  captcha_output?: unknown;
};

type GapResult = { distance: number; rawX: number; score: number; bgWidth: number };

function existingExecutable(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  const resolved = path.resolve(candidate);
  return fs.existsSync(resolved) ? resolved : undefined;
}

function chromiumExecutable(): string {
  const configured = process.env.SPORT_WORLD_CHROMIUM_PATH?.trim();
  if (configured) {
    const executable = existingExecutable(configured);
    if (!executable) throw new GeeTestV4Error('CONFIG_ERROR', 'SPORT_WORLD_CHROMIUM_PATH 指向的浏览器不存在');
    return executable;
  }

  try {
    const bundled = existingExecutable(chromium.executablePath());
    if (bundled) return bundled;
  } catch {
    // Continue with system browser discovery when the Playwright browser is not installed.
  }

  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const localAppData = process.env.LOCALAPPDATA;
  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
    programFiles && path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    programFiles && path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    programFilesX86 && path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    programFilesX86 && path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    localAppData && path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    localAppData && path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  for (const candidate of candidates) {
    const executable = existingExecutable(candidate || undefined);
    if (executable) return executable;
  }
  throw new GeeTestV4Error('CONFIG_ERROR', '服务器未安装 Chromium/Chrome，无法完成运动世界安全验证');
}

function timeoutMs(): number {
  const configured = Number(process.env.SPORT_WORLD_GEETEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(configured) ? Math.min(Math.max(configured, 10_000), 60_000) : DEFAULT_TIMEOUT_MS;
}

function randomBetween(minimum: number, maximum: number): number {
  return minimum + Math.random() * (maximum - minimum);
}

function randomInteger(minimum: number, maximum: number): number {
  return Math.floor(randomBetween(minimum, maximum + 1));
}

async function createBridgeServer(): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
    });
    response.end(BRIDGE_HTML);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new GeeTestV4Error('CONFIG_ERROR', '无法启动本地安全验证桥接服务');
  }
  return { server, url: `http://127.0.0.1:${address.port}/gt4-bridge` };
}

async function closeServer(server: http.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function imageDataUrl(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function solveOnce(): Promise<GeeTestV4Result> {
  const timeout = timeoutMs();
  const captchaId = process.env.SPORT_WORLD_GEETEST_CAPTCHA_ID?.trim() || DEFAULT_CAPTCHA_ID;
  const executablePath = chromiumExecutable();
  const { server, url } = await createBridgeServer();
  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-infobars',
        '--disable-setuid-sandbox',
        '--no-sandbox',
      ],
    });
  } catch (error) {
    await closeServer(server).catch(() => undefined);
    throw new GeeTestV4Error('CONFIG_ERROR', 'Chromium 启动失败，无法完成运动世界安全验证', error);
  }

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(window, 'chrome', { value: { runtime: {} }, configurable: true });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);
    await page.goto(url, { waitUntil: 'networkidle', timeout });
    await page.evaluate((id) => {
      const bridge = window as typeof window & { initCaptcha?: (captchaId: string) => void };
      if (!bridge.initCaptcha) throw new Error('GeeTest 初始化函数未加载');
      bridge.initCaptcha(id);
    }, captchaId);
    await page.waitForFunction(() => Boolean((window as typeof window & { gt4Ready?: boolean }).gt4Ready), undefined, { timeout: 12_000 });
    await page.evaluate(() => {
      const bridge = window as typeof window & { captchaObj?: { showCaptcha: () => void } };
      if (!bridge.captchaObj) throw new Error('GeeTest 实例未就绪');
      bridge.captchaObj.showCaptcha();
    });
    await page.waitForTimeout(1_800);

    const button = await page.waitForSelector('.geetest_btn', { state: 'visible', timeout: 8_000 });
    const buttonBox = await button.boundingBox();
    if (!buttonBox) throw new GeeTestV4Error('VERIFY_REQUIRED', '未找到运动世界安全验证滑块');

    const dom = await page.evaluate(() => {
      const cleanUrl = (background: string): string => {
        let value = background.trim();
        if (!value || value === 'none') return '';
        if (value.startsWith('url(')) value = value.slice(4, -1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        return value;
      };
      const background = document.querySelector<HTMLElement>('.geetest_bg');
      const slice = document.querySelector<HTMLElement>('.geetest_slice_bg');
      if (!background || !slice) throw new Error('GeeTest 图片元素未加载');
      return {
        bgUrl: cleanUrl(getComputedStyle(background).backgroundImage),
        sliceUrl: cleanUrl(getComputedStyle(slice).backgroundImage),
        renderedWidth: background.getBoundingClientRect().width,
      };
    });
    if (!dom.bgUrl || !dom.sliceUrl || dom.renderedWidth <= 0) throw new GeeTestV4Error('VERIFY_REQUIRED', '运动世界安全验证图片未加载完成');

    const [backgroundResponse, sliceResponse] = await Promise.all([
      context.request.get(dom.bgUrl, { timeout }),
      context.request.get(dom.sliceUrl, { timeout }),
    ]);
    if (!backgroundResponse.ok() || !sliceResponse.ok()) throw new GeeTestV4Error('NETWORK_ERROR', '运动世界安全验证图片下载失败');
    const [backgroundBytes, sliceBytes] = await Promise.all([backgroundResponse.body(), sliceResponse.body()]);

    const gap = await page.evaluate(async ({ background, slice }): Promise<GapResult> => {
      const decode = (source: string): Promise<ImageData> => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) return reject(new Error('Canvas 初始化失败'));
          context.drawImage(image, 0, 0);
          resolve(context.getImageData(0, 0, canvas.width, canvas.height));
        };
        image.onerror = () => reject(new Error('验证图片解码失败'));
        image.src = source;
      });

      const gaussianBlur = (source: Float32Array, width: number, height: number): Float32Array => {
        const sigma = 1.1;
        const kernel = new Float32Array(5);
        let kernelSum = 0;
        for (let index = 0; index < 5; index += 1) {
          const x = index - 2;
          kernel[index] = Math.exp(-(x * x) / (2 * sigma * sigma));
          kernelSum += kernel[index];
        }
        for (let index = 0; index < 5; index += 1) kernel[index] /= kernelSum;
        const temporary = new Float32Array(width * height);
        const output = new Float32Array(width * height);
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            let sum = 0;
            for (let offset = -2; offset <= 2; offset += 1) sum += source[y * width + Math.min(width - 1, Math.max(0, x + offset))] * kernel[offset + 2];
            temporary[y * width + x] = sum;
          }
        }
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            let sum = 0;
            for (let offset = -2; offset <= 2; offset += 1) sum += temporary[Math.min(height - 1, Math.max(0, y + offset)) * width + x] * kernel[offset + 2];
            output[y * width + x] = sum;
          }
        }
        return output;
      };

      const canny = (source: Float32Array, width: number, height: number): Uint8Array => {
        const magnitude = new Float32Array(width * height);
        const direction = new Float32Array(width * height);
        const at = (x: number, y: number): number => source[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
            const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
            const index = y * width + x;
            magnitude[index] = Math.hypot(gx, gy);
            direction[index] = Math.atan2(gy, gx) * 180 / Math.PI;
          }
        }
        const suppressed = new Float32Array(width * height);
        for (let y = 1; y < height - 1; y += 1) {
          for (let x = 1; x < width - 1; x += 1) {
            const index = y * width + x;
            const angle = (direction[index] + 180) % 180;
            let first: number;
            let second: number;
            if (angle < 22.5 || angle >= 157.5) {
              first = magnitude[index - 1]; second = magnitude[index + 1];
            } else if (angle < 67.5) {
              first = magnitude[(y - 1) * width + x + 1]; second = magnitude[(y + 1) * width + x - 1];
            } else if (angle < 112.5) {
              first = magnitude[(y - 1) * width + x]; second = magnitude[(y + 1) * width + x];
            } else {
              first = magnitude[(y - 1) * width + x - 1]; second = magnitude[(y + 1) * width + x + 1];
            }
            if (magnitude[index] >= first && magnitude[index] >= second) suppressed[index] = magnitude[index];
          }
        }
        const output = new Uint8Array(width * height);
        const stack: number[] = [];
        for (let index = 0; index < suppressed.length; index += 1) {
          if (suppressed[index] >= 200) { output[index] = 1; stack.push(index); }
        }
        while (stack.length) {
          const index = stack.pop() as number;
          const x = index % width;
          const y = Math.floor(index / width);
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              const nx = x + dx; const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              const neighbor = ny * width + nx;
              if (!output[neighbor] && suppressed[neighbor] >= 100) { output[neighbor] = 1; stack.push(neighbor); }
            }
          }
        }
        return output;
      };

      const grayscale = (image: ImageData, left: number, top: number, width: number, height: number): Float32Array => {
        const output = new Float32Array(width * height);
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const sourceIndex = ((top + y) * image.width + left + x) * 4;
            output[y * width + x] = image.data[sourceIndex] * 0.299 + image.data[sourceIndex + 1] * 0.587 + image.data[sourceIndex + 2] * 0.114;
          }
        }
        return output;
      };

      const [backgroundImage, sliceImage] = await Promise.all([decode(background), decode(slice)]);
      let xmin = sliceImage.width; let xmax = -1; let ymin = sliceImage.height; let ymax = -1;
      for (let y = 0; y < sliceImage.height; y += 1) {
        for (let x = 0; x < sliceImage.width; x += 1) {
          if (sliceImage.data[(y * sliceImage.width + x) * 4 + 3] <= 50) continue;
          xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
        }
      }
      if (xmax < xmin || ymax < ymin) throw new Error('安全验证切片没有可识别区域');
      const templateWidth = xmax - xmin + 1;
      const templateHeight = ymax - ymin + 1;
      const backgroundEdges = canny(gaussianBlur(grayscale(backgroundImage, 0, 0, backgroundImage.width, backgroundImage.height), backgroundImage.width, backgroundImage.height), backgroundImage.width, backgroundImage.height);
      const templateEdges = canny(gaussianBlur(grayscale(sliceImage, xmin, ymin, templateWidth, templateHeight), templateWidth, templateHeight), templateWidth, templateHeight);
      const templatePoints: Array<[number, number]> = [];
      for (let y = 0; y < templateHeight; y += 1) for (let x = 0; x < templateWidth; x += 1) if (templateEdges[y * templateWidth + x]) templatePoints.push([x, y]);
      if (templatePoints.length < 10) throw new Error('安全验证切片边缘不足');

      const integralWidth = backgroundImage.width + 1;
      const integral = new Uint32Array(integralWidth * (backgroundImage.height + 1));
      for (let y = 0; y < backgroundImage.height; y += 1) {
        let rowSum = 0;
        for (let x = 0; x < backgroundImage.width; x += 1) {
          rowSum += backgroundEdges[y * backgroundImage.width + x];
          integral[(y + 1) * integralWidth + x + 1] = integral[y * integralWidth + x + 1] + rowSum;
        }
      }
      const rectangleSum = (left: number, top: number, width: number, height: number): number => {
        const right = left + width; const bottom = top + height;
        return integral[bottom * integralWidth + right] - integral[top * integralWidth + right] - integral[bottom * integralWidth + left] + integral[top * integralWidth + left];
      };
      let bestX = 0; let bestScore = -1;
      for (let oy = 0; oy <= backgroundImage.height - templateHeight; oy += 1) {
        for (let ox = 0; ox <= backgroundImage.width - templateWidth; ox += 1) {
          const windowEdges = rectangleSum(ox, oy, templateWidth, templateHeight);
          if (!windowEdges) continue;
          let overlap = 0;
          for (const [tx, ty] of templatePoints) overlap += backgroundEdges[(oy + ty) * backgroundImage.width + ox + tx];
          const score = overlap / Math.sqrt(windowEdges * templatePoints.length);
          if (score > bestScore) { bestScore = score; bestX = ox; }
        }
      }
      return { distance: Math.max(0, bestX - xmin), rawX: bestX, score: bestScore, bgWidth: backgroundImage.width };
    }, { background: imageDataUrl(backgroundBytes), slice: imageDataUrl(sliceBytes) });

    if (!Number.isFinite(gap.distance) || gap.score < 0.12) throw new GeeTestV4Error('VERIFY_REQUIRED', '运动世界安全验证缺口识别失败');
    const targetDistance = gap.distance * dom.renderedWidth / gap.bgWidth;
    const points = randomInteger(48, 65);
    const totalTime = randomBetween(850, 1_250);
    const steepness = randomBetween(7.8, 9.6);
    const midpoint = randomBetween(0.40, 0.46);
    const arcHeight = randomBetween(-1.2, 1.2);
    const sigmoid = (time: number): number => 1 / (1 + Math.exp(-steepness * (time - midpoint)));
    const startSigmoid = sigmoid(0);
    const sigmoidRange = sigmoid(1) - startSigmoid;
    const startX = buttonBox.x + buttonBox.width / 2;
    const startY = buttonBox.y + buttonBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.waitForTimeout(randomInteger(150, 250));
    await page.mouse.down();
    await page.waitForTimeout(randomInteger(80, 120));
    for (let index = 1; index < points; index += 1) {
      const time = index / (points - 1);
      const progress = (sigmoid(time) - startSigmoid) / sigmoidRange;
      const y = arcHeight * Math.sin(Math.PI * time) + randomBetween(-0.2, 0.2);
      await page.mouse.move(startX + targetDistance * progress, startY + y);
      await page.waitForTimeout(Math.max(5, Math.round(totalTime / points * randomBetween(0.85, 1.25))));
    }
    await page.waitForTimeout(randomInteger(120, 220));
    await page.mouse.up();
    await page.waitForFunction(() => {
      const bridge = window as typeof window & { gt4Result?: unknown; gt4Error?: unknown };
      return Boolean(bridge.gt4Result || bridge.gt4Error);
    }, undefined, { timeout: 8_000 });
    const outcome = await page.evaluate(() => {
      const bridge = window as typeof window & { gt4Result?: BrowserValidation; gt4Error?: unknown };
      return { result: bridge.gt4Result, error: bridge.gt4Error };
    });
    if (!outcome.result) throw new GeeTestV4Error('VERIFY_REQUIRED', '运动世界安全验证未通过');
    const validation = outcome.result;
    const lotNumber = typeof validation.lot_number === 'string' ? validation.lot_number : '';
    const passToken = typeof validation.pass_token === 'string' ? validation.pass_token : '';
    const genTime = typeof validation.gen_time === 'string' ? validation.gen_time : '';
    const captchaOutput = typeof validation.captcha_output === 'string' ? validation.captcha_output : '';
    if (!lotNumber || !passToken || !genTime || !captchaOutput) throw new GeeTestV4Error('VERIFY_REQUIRED', '运动世界安全验证返回数据不完整');
    return {
      captchaId: typeof validation.captcha_id === 'string' ? validation.captcha_id : captchaId,
      lotNumber,
      passToken,
      genTime,
      captchaOutput,
    };
  } catch (error) {
    if (error instanceof GeeTestV4Error) throw error;
    const message = error instanceof Error ? error.message : '';
    if (/timeout|timed out|net::|fetch|network/i.test(message)) throw new GeeTestV4Error('NETWORK_ERROR', '运动世界安全验证网络超时', error);
    throw new GeeTestV4Error('VERIFY_REQUIRED', '运动世界安全验证未通过', error);
  } finally {
    await browser.close().catch(() => undefined);
    await closeServer(server).catch(() => undefined);
  }
}

let verificationTail: Promise<void> = Promise.resolve();

export async function solveGeeTestV4(): Promise<GeeTestV4Result> {
  const previous = verificationTail;
  let release: () => void = () => {};
  verificationTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await solveOnce();
  } finally {
    release();
  }
}
