import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const filePath = process.argv[2];
const searchString = process.argv[3];

if (!filePath || !searchString) {
    console.error("Usage: node find_context.js <file> <string>");
    process.exit(1);
}

try {
    const content = fs.readFileSync(filePath, 'utf8');
    // Find ALL occurrences
    let pos = 0;
    while (true) {
        const index = content.indexOf(searchString, pos);
        if (index === -1) break;

        console.log(`\n--- Match at index ${index} ---`);
        const start = Math.max(0, index - 200);
        const end = Math.min(content.length, index + 200);
        console.log(content.substring(start, end));

        pos = index + 1;
    }
} catch (err) {
    console.error("Error reading file:", err);
}
