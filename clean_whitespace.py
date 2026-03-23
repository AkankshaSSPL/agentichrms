import os

files = ['tools/retrieval.py', 'utils/document_viewer.py', 'utils/source_preview.py']

for path in files:
    if not os.path.exists(path):
        continue
    with open(path, 'rb') as f:
        content = f.read()

    try:
        text = content.decode('utf-8')
    except UnicodeDecodeError:
        text = content.decode('latin-1')

    # Normalize to LF, strip trailing whitespace from each line
    lines = text.splitlines()
    cleaned_lines = [line.rstrip().replace('\t', '    ') for line in lines]

    # Write back with explicit Unix line endings
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(cleaned_lines) + '\n')

print("Files normalized successfully.")
