====================================================
  DOA Listing Agent -- DROP HERE Folder
====================================================

HOW TO USE THIS FOLDER:
-----------------------
1. Drop your CSV file in here
   (exported from Vendor-Zen-Tool for this auction batch)

2. Drop your image ZIP file in here
   (images named like: 73_01.jpg, 73_02.jpg, 74_01.jpg)

3. Go back to the doa-listing-agent folder and
   double-click RUN-DOA-AGENT.bat
   (or use the desktop shortcut)

That's it. The agent does the rest automatically.

WHAT HAPPENS AFTER IT RUNS:
----------------------------
- If ALL lots succeed:
    Your CSV and ZIP are moved to the archive folder
    automatically. DROP-HERE will be empty and ready
    for the next batch.

- If SOME lots fail:
    Your files stay in DROP-HERE. Just double-click
    RUN-DOA-AGENT.bat again -- completed lots are
    skipped automatically, only failed ones retry.

NOTES:
------
- Only ONE csv and ONE zip file should be in here at a time
- Make sure your .env file has the correct DOA_FIRST_LOT_URL
  for the first lot of this batch before running
====================================================
