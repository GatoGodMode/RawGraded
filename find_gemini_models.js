import fs from 'fs';

const filePath = process.argv[2];
const regex = /gemini-[a-zA-Z0-9.-]+/g;

try {
    const content = fs.readFileSync(filePath, 'utf8');
    const matches = content.match(regex);
    if (matches) {
        console.log("Found matches:", [...new Set(matches)]);
    } else {
        console.log("No matches found.");
    }
} catch (err) {
    console.error("Error:", err);
}
