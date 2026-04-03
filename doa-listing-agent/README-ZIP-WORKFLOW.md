# DOA Listing Agent: Zip Workflow Guide

**Author**: Manus AI  
**Date**: April 01, 2026

This guide explains the new, simplified workflow for uploading lots to Denver Online Auctions. We have completely bypassed the unreliable barcode system. The agent now mimics a human: it logs in, uploads your images directly to the lot page, clicks the AI generation button, waits for the title and description, and saves.

---

## 1. The Naming Convention

The agent needs to know which photos belong to which lot. It does this by reading the filenames inside your zip file.

**Rule**: Every image must be named `{lotNumber}_{index}.extension`

| Lot Number | Image 1 | Image 2 | Image 3 |
| :--- | :--- | :--- | :--- |
| **101** | `101_01.jpg` | `101_02.jpg` | `101_03.jpg` |
| **102** | `102_01.jpg` | `102_02.jpg` | |
| **A55** | `A55_01.png` | `A55_02.png` | |

*Note: The agent sorts the images alphabetically per lot, so `01` is uploaded before `02`.*

---

## 2. Step-by-Step Workflow

### Step 1: Prepare the Zip File
1. Use the Vendor-Zen-Tool app (or rename them manually) to organize your images using the naming convention above.
2. Select all the images, right-click, and choose **Compress to ZIP file**.
3. Name the file `auction-images.zip`.
4. Move this zip file into the `doa-listing-agent` folder (the same folder where `run-zip.bat` lives).

### Step 2: Get the First Lot URL
1. Open your web browser and log into the DOA sub-admin dashboard manually.
2. Create your new auction batch if you haven't already.
3. Click to edit the **very first lot** in that batch.
4. Copy the full URL from your browser's address bar. It will look something like this:
   `https://denveronlineauctions.com/sub-admin/EditAuction?id=1234567&PartyId=115`

### Step 3: Update your `.env` file
1. Open the `.env` file in the `doa-listing-agent` folder using Notepad.
2. Make sure your `DOA_EMAIL` and `DOA_PASSWORD` are correct.
3. Paste the URL you copied into the `DOA_FIRST_LOT_URL` variable:
   ```env
   DOA_FIRST_LOT_URL=https://denveronlineauctions.com/sub-admin/EditAuction?id=1234567&PartyId=115
   ```
4. Save and close the file.

### Step 4: Run the Agent
1. Double-click the **`run-zip.bat`** file.
2. A black command window will open. The agent will:
   * Extract your zip file into a temporary folder.
   * Print a summary showing exactly how many lots it found and how many images belong to each lot.
   * Open a Chrome browser window.
3. **Do not click inside the Chrome window.** Just watch it work.
   * It will log in.
   * It will upload the images for the first lot.
   * It will click the "Insert AI title/description" dropdown and select "Use first six images".
   * It will wait until the title and description fields are filled by the AI.
   * It will click "Save & Edit Next" to move to the next lot.
4. When it finishes the last lot, the browser will close automatically and the command window will say "All lots completed successfully!"

---

## 3. Troubleshooting

### "File upload input not found" or "Save button not found"
If DOA changes the layout of their website, the agent might not be able to find the buttons.
1. Open a command prompt in the agent folder.
2. Run `node inspect-form.js`.
3. This will scan the live DOA page and print out the new internal names (selectors) for all the buttons.
4. Open `doaAgent.js` in a code editor and update the `SELECTORS` section at the top of the file to match the new names.

### "AI generation timed out"
Sometimes the DOA AI takes longer than 90 seconds to generate the description, or it fails entirely on their server. The agent will wait 90 seconds, log a warning, and save the lot anyway so the whole batch doesn't get stuck. You can manually fill in the missing descriptions later.

### "Zip file not found"
Make sure your zip file is named exactly `auction-images.zip` and is in the same folder as the `.bat` file. If you want to use a different name, right-click `run-zip.bat`, select Edit, and change the `set ZIP_FILE=auction-images.zip` line to match your file.
