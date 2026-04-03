====================================================
  DOA Listing Agent -- DROP HERE Folder
====================================================

HOW TO USE THIS FOLDER (every batch):
--------------------------------------
1. Drop your CSV file in here
   (exported from Vendor-Zen-Tool for this auction batch)

2. Drop your image ZIP file in here
   (images named like: 73_01.jpg, 73_02.jpg, 74_01.jpg)

3. Open START-URL.txt (it's in this folder)
   - Delete the instruction line at the top
   - Replace the placeholder URL with the real URL of
     the FIRST lot in this batch
   - To get the URL: log into DOA sub-admin, click Edit
     on the first lot, copy the address bar URL
   - Save the file

4. Double-click RUN-DOA-AGENT.bat (or the desktop shortcut)

That's it. No PowerShell. No editing .env. Just drop and run.

WHAT HAPPENS AFTER IT RUNS:
----------------------------
- If ALL lots succeed:
    CSV and ZIP move to the archive folder automatically.
    START-URL.txt resets to the template for the next batch.
    DROP-HERE is clean and ready to go again.

- If SOME lots fail:
    Files stay in DROP-HERE. Double-click RUN-DOA-AGENT.bat
    again -- completed lots are skipped, only failed ones retry.

NOTES:
------
- Only ONE csv and ONE zip file should be in here at a time
- Your DOA email and password stay in the .env file (one-time setup)
- The start URL changes every batch -- update START-URL.txt each time
====================================================
