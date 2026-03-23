import py_compile
import sys

files = ['tools/retrieval.py', 'utils/document_viewer.py', 'utils/source_preview.py']
with open('results.txt', 'w') as f:
    for file in files:
        try:
            py_compile.compile(file, doraise=True)
            f.write(f"SUCCESS: {file}\n")
        except Exception as e:
            f.write(f"ERROR in {file}: {e}\n")
