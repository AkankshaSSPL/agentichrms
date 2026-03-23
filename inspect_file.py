import json
import sys

def inspect_file(path):
    issues = []
    try:
        with open(path, 'rb') as f:
            content = f.read()
            
        lines = content.split(b'\n')
        for i, line in enumerate(lines):
            num = i + 1
            if b'\r' in line and not line.endswith(b'\r'):
                issues.append(f"Line {num} has CR inside it!")
            if b'\t' in line:
                issues.append(f"Line {num} has TAB!")
            
            # check non-ascii
            for c in line:
                if c > 127:
                    issues.append(f"Line {num} has NON-ASCII: {c}")
                    break
                    
    except Exception as e:
        issues.append(str(e))
    return issues

results = {}
files = ['tools/retrieval.py', 'utils/document_viewer.py', 'utils/source_preview.py']
for path in files:
    results[path] = inspect_file(path)

with open('inspect_results.json', 'w') as f:
    json.dump(results, f, indent=2)
