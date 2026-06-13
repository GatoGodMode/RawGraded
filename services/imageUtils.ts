export const generateImageHash = async (dataUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error("Could not get canvas context"));
                return;
            }

            // 1. Resize to 16x16 (256 pixels) for Block Hash
            // Using 16x16 gives a 256-bit hash (64 hex characters)
            const size = 16;
            canvas.width = size;
            canvas.height = size;

            // Draw image resized
            ctx.drawImage(img, 0, 0, size, size);

            // 2. Get pixel data
            const imageData = ctx.getImageData(0, 0, size, size);
            const data = imageData.data;

            let totalBrightness = 0;
            const brightnesses: number[] = [];

            // 3. Convert to grayscale and calculate brightness
            for (let i = 0; i < data.length; i += 4) {
                // Simple luminance formula: 0.299R + 0.587G + 0.114B
                const brightness = Math.floor(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
                brightnesses.push(brightness);
                totalBrightness += brightness;
            }

            // 4. Calculate mean brightness
            const meanBrightness = totalBrightness / (size * size);

            // 5. Generate hash string (hex)
            let hashBin = "";
            for (let i = 0; i < brightnesses.length; i++) {
                hashBin += brightnesses[i] > meanBrightness ? "1" : "0";
            }

            // Convert binary string to hex
            let hashHex = "";
            for (let i = 0; i < hashBin.length; i += 4) {
                const chunk = hashBin.substring(i, i + 4);
                hashHex += parseInt(chunk, 2).toString(16);
            }

            resolve(hashHex);
        };
        img.onerror = (e) => reject(e);
        img.src = dataUrl;
    });
};

/** JPEG quality 0.72 default; use 0.80 for holographic cards so Phase 2 scratch analysis has finer detail. */
export const resizeImage = async (dataUrl: string, maxDim: number = 1024, quality: number = 0.72): Promise<string> => {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error("Image resize timed out (10s)"));
        }, 10000);

        const img = new Image();
        img.onload = () => {
            clearTimeout(timeout);
            const canvas = document.createElement('canvas');
            let { width, height } = img;

            if (width > height) {
                if (width > maxDim) {
                    height *= maxDim / width;
                    width = maxDim;
                }
            } else {
                if (height > maxDim) {
                    width *= maxDim / height;
                    height = maxDim;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error("Canvas context failed"));
                return;
            }

            ctx.drawImage(img, 0, 0, width, height);
            const q = quality >= 0 && quality <= 1 ? quality : 0.72;
            resolve(canvas.toDataURL('image/jpeg', q));
        };
        img.onerror = (e) => {
            clearTimeout(timeout);
            reject(e);
        };
        img.src = dataUrl;
    });
};
