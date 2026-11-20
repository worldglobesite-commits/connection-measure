#!/usr/bin/env node
'use strict';

const REQUESTS = 10;
const TIMEOUT_MS = 60_000;

function usage() {
  console.error('Использование: node measure.js <url>');
  console.error('Пример:        node measure.js https://example.com/big-image.jpg');
}

async function downloadOnce(url) {
  const start = process.hrtime.bigint();
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    // identity — без сжатия, чтобы считать реально переданные байты, а не распакованные.
    headers: { 'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity' },
  });
  // Заголовки получены — это время до первого ответа сервера (задержка).
  const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;

  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  // Читаем тело потоком и считаем размер по частям, не храня файл в памяти.
  // Время засекается до полной загрузки.
  let bytes = 0;

  for await (const chunk of res.body ?? []) {
    bytes += chunk.byteLength;
  }

  const ms = Number(process.hrtime.bigint() - start) / 1e6;

  return { bytes, ms, latencyMs };
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;

  return { avg, min: sorted[0], median, max: sorted[sorted.length - 1] };
}

function formatStats(label, values) {
  const s = stats(values);
  const f = (v) => v.toFixed(0);

  return `${label} среднее ${f(s.avg)} / мин ${f(s.min)} / медиана ${f(s.median)} / макс ${f(s.max)} мс`;
}

async function main() {
  const url = process.argv[2];

  if (!url) {
    usage();
    process.exit(1);
  }

  try {
    new URL(url);
  } catch {
    console.error(`Некорректный URL: ${url}`);
    usage();
    process.exit(1);
  }

  const results = [];

  for (let i = 1; i <= REQUESTS; i++) {
    try {
      const result = await downloadOnce(url);

      results.push(result);
      console.log(
        `Запрос ${i}/${REQUESTS}: ${(result.bytes / 1048576).toFixed(2)} МБ за ${result.ms.toFixed(0)} мс, ` +
        `задержка ${result.latencyMs.toFixed(0)} мс`
      );
    } catch (err) {
      const reason = err.cause?.code || err.message;

      console.error(`Запрос ${i}/${REQUESTS} не удался: ${reason}`);
      process.exit(1);
    }
  }

  const totalBytes = results.reduce((sum, r) => sum + r.bytes, 0);
  const totalSeconds = results.reduce((sum, r) => sum + r.ms, 0) / 1000;
  const mbytes = totalBytes / 1048576;
  const mbitPerSec = (totalBytes * 8) / 1e6 / totalSeconds;
  const medianMbitPerSec = stats(results.map((r) => (r.bytes * 8) / 1e3 / r.ms)).median;

  console.log('');
  console.log(`Скачано всего: ${mbytes.toFixed(2)} МБ`);
  console.log(formatStats('Время запроса:', results.map((r) => r.ms)));
  console.log(formatStats('Задержка:     ', results.map((r) => r.latencyMs)));
  console.log(`Скорость скачивания (общая):      ${mbitPerSec.toFixed(2)} Мбит/с (${(mbytes / totalSeconds).toFixed(2)} МБ/с)`);
  console.log(`Скорость скачивания (по медиане): ${medianMbitPerSec.toFixed(2)} Мбит/с (${(medianMbitPerSec / 8 * 1e6 / 1048576).toFixed(2)} МБ/с)`);
}

main();
