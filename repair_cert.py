import re
import os

path = r'd:\SCRIPTS\rawgraded.com\components\Certificate.tsx'
if not os.path.exists(path):
    print(f"File not found: {path}")
    exit(1)

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the broken spaces in tags and attributes
content = re.sub(r'< div', '<div', content)
content = re.sub(r'</div >', '</div>', content)
content = re.sub(r'className = "', 'className="', content)
content = re.sub(r'ref = {', 'ref={', content)
content = re.sub(r'style = {{', 'style={{', content)
content = re.sub(r'style = { {', 'style={{', content)
content = re.sub(r'style={{ minHeight: \'1100px\' }', 'style={{ minHeight: \'1100px\' }}', content)

# Fix double close tags that might have been introduced
content = content.replace('} }', '}}')
content = content.replace('{ {', '{{')

# Specific repair for the socialExportRef header which might be missing container
if 'ref={socialExportRef}' in content and 'className="w-full flex justify-between' in content:
    # Ensure it's wrapped and has correct header
    pass # Add more specific regex if needed after viewing

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Repair complete.")
