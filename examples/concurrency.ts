import { limitConcurrency } from "../src/index.js";

async function processImage(id: number): Promise<string> {
  const processTime = 100 + Math.floor(Math.random() * 100);
  await new Promise((resolve) => setTimeout(resolve, processTime));
  return `Processed image #${id} in ${processTime}ms`;
}

async function main() {
  console.log("=== Concurrency Limiter Example ===");

  // Limit processing to at most 3 images at once
  const guardedProcessor = limitConcurrency(processImage, {
    concurrency: 3,
    queueSize: 50,
  });

  const imageIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  console.log(
    `Starting ${imageIds.length} tasks with concurrency = ${guardedProcessor.concurrency}...`,
  );

  const interval = setInterval(() => {
    console.log(
      `  [Status] Active: ${guardedProcessor.activeCount}, Queued: ${guardedProcessor.pendingCount}`,
    );
  }, 50);

  const results = await Promise.all(imageIds.map((id) => guardedProcessor(id)));

  clearInterval(interval);

  console.log(`Finished processing all ${results.length} images.`);
  console.log("Sample result:", results[0]);
}

main().catch(console.error);
