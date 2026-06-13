const fs = require('fs');
const path = 'd:/scripts/rawgraded.com/App.tsx';
let content = fs.readFileSync(path, 'utf8');

// The file uses inline styles and explicit tailwind classes. We will do global replaces for these specific hexes since they define the theme in this file.

// 1. Black -> Charcoal / Matte Black
content = content.replace(/#000000/g, '#111111'); // Pure black to matte charcoal
content = content.replace(/#111(?![0-9a-fA-F])/gi, '#151515'); // #111 to slightly lighter charcoal
content = content.replace(/bg-black/g, 'bg-[#111111]');

// 2. Reds -> Crimson / Velvet Red
content = content.replace(/#dc2626/gi, '#990000'); // Tailwind red-600 hex to rich crimson
content = content.replace(/rgba\(220,38,38/g, 'rgba(153,0,0'); // rgb for red-600 
content = content.replace(/text-red-600/g, 'text-[#990000]'); // Replace generic classes
content = content.replace(/bg-red-600/g, 'bg-[#990000]');
content = content.replace(/border-red-600/g, 'border-[#990000]');
content = content.replace(/hover:bg-red-700/g, 'hover:bg-[#660000]');

// 3. Gold -> Brushed Brass
// The user wants true gradient gold/brushed brass. We'll replace the static #D4AF37 with a richer brass #C5A059
content = content.replace(/#D4AF37/gi, '#C5A059'); 
content = content.replace(/rgba\(255,215,0/g, 'rgba(197,160,89'); // Yellow-gold to brass rgb

fs.writeFileSync(path, content);
console.log('Replacements complete');
