import fs from 'fs';

const filePath = process.argv[2];
const regex = /gemini.{0,50}3/g;

try {
    const content = fs.readFileSync(filePath, 'utf8');
    const matches = content.match(regex);
    if (matches) {
        console.log("Found likely '3' references:", matches);
    } else {
        console.log("No 'gemini...3' found.");
    }
} catch (err) {
    console.error("Error:", err);
}
