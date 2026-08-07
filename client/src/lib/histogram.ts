export interface HistogramResult {
  /** 256 luminance bins (0-255), counts of sampled pixels */
  bins: number[];
  min: number;
  max: number;
  mean: number;
  std: number;
  /** Total number of sampled pixels (may be downscaled) */
  sampled: number;
}

/** Computes a luminance histogram from an image data URL entirely in the browser
 *  (canvas pixel data). Large images are downscaled to a 512px-wide sample. */
export function computeHistogram(imageSrc: string): Promise<HistogramResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, 512 / Math.max(1, img.naturalWidth));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          reject(new Error("histogram: 2d context unavailable"));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const bins = new Array<number>(256).fill(0);
        let sum = 0;
        let sum2 = 0;
        let count = 0;
        let min = 255;
        let max = 0;
        for (let i = 0; i < data.length; i += 4) {
          const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0;
          bins[lum]++;
          sum += lum;
          sum2 += lum * lum;
          count++;
          if (lum < min) min = lum;
          if (lum > max) max = lum;
        }
        const mean = count ? sum / count : 0;
        const variance = count ? sum2 / count - mean * mean : 0;
        resolve({ bins, min, max, mean, std: Math.sqrt(Math.max(0, variance)), sampled: count });
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("histogram: image load failed"));
    img.src = imageSrc;
  });
}
