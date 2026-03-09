import pdfplumber
import os

filepath = r'c:\agentichrms\documents\NDA letter head copy.pdf'
with pdfplumber.open(filepath) as pdf:
    # Page numbers are 1-based in my earlier understanding, let's check index 2 (Page 3)
    page = pdf.pages[2]
    text = page.extract_text()
    print("--- PAGE 3 TEXT ---")
    print(text)
    print("--- END ---")
