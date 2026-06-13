import fs from 'fs';

const filePath = 'd:\\SCRIPTS\\rawgraded.com\\models.json';

try {
    const content = fs.readFileSync(filePath, 'utf16le');
    console.log(content);
} catch (err) {
    console.error("Error reading file:", err);
}
