import re

with open('frontend/index.html', 'r') as f:
    content = f.read()

# Extract camera-section
camera_section_match = re.search(r'(\s*)<section class="section compact main-camera-panel" id="camera-section">.*?</section>\n', content, re.DOTALL)
if not camera_section_match:
    print("Camera section not found")
    exit(1)

camera_section = camera_section_match.group(0)
# Update class and add data attribute
camera_section = camera_section.replace('class="section compact main-camera-panel"', 'class="section compact main-camera-panel workspace-panel" data-workspace-panel="cameras"')

# Remove camera_section from original position
content = content.replace(camera_section_match.group(0), '')

# Replace camera-workspace wrapper
content = content.replace('<section class="camera-workspace workspace-panel" id="camera-workspace" data-workspace-panel="cameras">\n', '')
content = content.replace('      </section>\n    </main>', '    </main>')

# Insert camera_section before </aside>
content = content.replace('    </aside>', camera_section + '    </aside>')

with open('frontend/index.html', 'w') as f:
    f.write(content)

print("Done")
