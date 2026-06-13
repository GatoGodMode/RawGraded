import re
import os

path = r'd:\SCRIPTS\rawgraded.com\components\Certificate.tsx'
if not os.path.exists(path):
    print(f"File not found: {path}")
    exit(1)

with open(path, 'r', encoding='utf-8') as f:
    orig_content = f.read()

content = orig_content

# More comprehensive replacements
# Tags with spaces after < or before >
content = re.sub(r'<\s+div', '<div', content)
content = re.sub(r'</div\s+>', '</div>', content)
content = re.sub(r'</\s+div\s+>', '</div>', content)

# Attributes with spaces around =
content = re.sub(r'className\s+=\s+"', 'className="', content)
content = re.sub(r'ref\s+=\s+{', 'ref={', content)
content = re.sub(r'style\s+=\s+{', 'style={', content) # for style={{

# Fix the triple brace issue again just in case (though I did a manual replace)
content = content.replace('}}}', '}}')

# Fix nested space issues
content = content.replace('className = "', 'className="')

# Remove accidental artifacts from multi_replace
content = content.replace('</dev >', '</div>')
content = content.replace('<dev', '<div')

if content != orig_content:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Enhanced repair complete.")
else:
    print("No changes needed in this pass.")
