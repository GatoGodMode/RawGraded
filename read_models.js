import fs from 'fs';

const filePath = 'd:\\SCRIPTS\\rawgraded.com\\models.json';

try {
    // Try reading as utf16le
    const content = fs.readFileSync(filePath, 'utf16le');
    console.log(content.substring(0, 2000)); // Print first 2000 chars
} catch (err) {
    console.error("Error reading file:", err);
}
