# DOA Bulk Image Upload Workflow

This document describes the end-to-end process for uploading lot photos to Denver Online Auctions (DOA) using the bulk image uploader.

## Overview

Photos are uploaded in batches from the Vendor-Zen-Tools app. DOA's bulk uploader reads barcode images to auto-assign photos to the correct lots. After upload, DOA's built-in OpenAI integration generates titles and descriptions automatically.

---

## Step 1: Pre-requisites

**Before uploading any images**, the auction group and blank lot auctions must already be created in DOA. The system matches uploaded photos to lots by barcode number. If you upload images for lot #10 but lot #10 does not exist in DOA, those images will be silently discarded.

---

## Step 2: Download the Images ZIP from the App

1. Open the Vendor-Zen-Tools app and go to **Create Listing**
2. Select your batch (Denver Auctions section)
3. Click **Images ZIP** — the app will package all lot photos and download a ZIP file named `doa-images-YYYY-MM-DD.zip`

The ZIP contains photos named by lot number and sequence:
```
1_01.jpg   ← lot 1, photo 1
1_02.jpg   ← lot 1, photo 2
2_01.jpg   ← lot 2, photo 1
...
```

Photos are sorted by lot number, ascending.

---

## Step 3: The Barcode Sequence

DOA's bulk uploader identifies which lot each photo belongs to by reading a barcode image that precedes each group of lot photos. The barcode must always come before the photos for that lot.

**The correct upload sequence is:**
```
[barcode for lot 1]
[photo 1 for lot 1]
[photo 2 for lot 1]
[barcode for lot 2]
[photo 1 for lot 2]
...
```

You will prepend the barcode images to the downloaded ZIP before uploading.

---

## Step 4: Upload Limits

- Upload **1,000 images or less** per session to avoid browser overload
- You can upload any range of lots (e.g., lots 1–50, then 51–100) — the order within a session does not matter as long as each group starts with its barcode
- Each upload session must start with a barcode image

---

## Step 5: Using the DOA Bulk Image Uploader

1. Log in to DOA and go to **Admin → Bulk Image Uploader**
2. Select the **auction group** for this batch
3. Click **Proceed with Selection**
4. On the upload page:
   - Ensure **Pre-Upload Compression** is turned **ON** (speeds up upload)
   - Ensure **Add title and description automatically using OpenAI API** is turned **ON**
5. Click **Browse Files** (or drag and drop) and select your sequenced image files — start with the first barcode
6. Wait for all files to show status **"Complete"**
7. Click **Process Uploaded Images**

After processing, click **View Auction Group** to review the uploaded photos, or continue uploading the next batch.

---

## Step 6: AI Titles and Descriptions

After clicking "Process Uploaded Images," DOA's OpenAI integration will generate titles and descriptions for each lot in the background. This takes a few minutes.

**Do not edit titles or descriptions on any lot until this process is complete**, or your edits may be overwritten.

You can add a master prompt in the DOA bulk uploader settings to guide the AI for SEO-optimized output.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Images discarded / not assigned to lots | Lots were not created in DOA before uploading — create them first |
| Wrong photos on wrong lot | Barcode was missing or out of order — check sequence and re-upload |
| Upload crashes or page restarts | Too many images at once — reduce batch size to under 1,000 images |
| Status never shows "Complete" | Check internet connection; try a smaller batch |
