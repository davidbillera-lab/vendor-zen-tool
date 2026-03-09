// DOA Lot Filler - Content Script
// Runs on denveronlineauctions.com/sub-admin/EditAuction pages

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fillLot') {
    fillLot(message.lot).then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }
});

async function fillLot(lot) {
  try {
    // 1. Fill Title
    const titleInput = document.querySelector('input[id*="Title"], input[name*="Title"]');
    if (titleInput) {
      setNativeValue(titleInput, lot.title);
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      titleInput.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      console.warn('DOA Filler: Title input not found');
    }

    // 2. Fill Starting Bid
    const bidInput = document.querySelector('input[id*="StartingBid"], input[id*="StartBid"], input[name*="StartingBid"], input[name*="StartBid"]');
    if (bidInput) {
      setNativeValue(bidInput, String(lot.startingBid));
      bidInput.dispatchEvent(new Event('input', { bubbles: true }));
      bidInput.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      console.warn('DOA Filler: Starting Bid input not found');
    }

    // 3. Fill Lot Number
    const lotInput = document.querySelector('input[id*="LotNumber"], input[id*="LotNum"], input[name*="LotNumber"], input[name*="LotNum"]');
    if (lotInput) {
      setNativeValue(lotInput, String(lot.lotNumber));
      lotInput.dispatchEvent(new Event('input', { bubbles: true }));
      lotInput.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      console.warn('DOA Filler: Lot Number input not found');
    }

    // 4. Fill Description (TinyMCE)
    await fillTinyMCE(lot.description);

    // 5. Upload Images
    if (lot.imageUrls && lot.imageUrls.length > 0) {
      await uploadImages(lot.imageUrls);
    }

    // Show success overlay
    showOverlay(`✓ Lot #${lot.lotNumber} filled! Click "Save & Edit Next" to continue.`);

    return { success: true };
  } catch (err) {
    console.error('DOA Filler error:', err);
    return { success: false, error: err.message };
  }
}

// Set value on React/ASP.NET controlled inputs
function setNativeValue(element, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  valueSetter.call(element, value);
  element.value = value;
}

// Fill TinyMCE editor
async function fillTinyMCE(description) {
  // Wait for TinyMCE to be available
  let attempts = 0;
  while ((!window.tinymce || !window.tinymce.activeEditor) && attempts < 20) {
    await new Promise(r => setTimeout(r, 200));
    attempts++;
  }

  if (window.tinymce && window.tinymce.activeEditor) {
    window.tinymce.activeEditor.setContent(description);
    window.tinymce.activeEditor.fire('change');
    console.log('DOA Filler: Description set via TinyMCE API');
  } else {
    // Fallback: try to find the iframe and set content directly
    const iframe = document.querySelector('.tox-edit-area iframe, .mce-edit-area iframe');
    if (iframe && iframe.contentDocument) {
      iframe.contentDocument.body.innerHTML = description;
      console.log('DOA Filler: Description set via iframe fallback');
    } else {
      // Last fallback: textarea
      const textarea = document.querySelector('textarea[id*="Description"], textarea[name*="Description"]');
      if (textarea) {
        textarea.value = description;
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('DOA Filler: Description set via textarea fallback');
      } else {
        console.warn('DOA Filler: Could not find description field');
      }
    }
  }
}

// Download and upload images to DOA's file input
async function uploadImages(imageUrls) {
  // Find the file input (DOA uses a dropzone with a hidden file input)
  const fileInput = document.querySelector('input[type="file"]');
  if (!fileInput) {
    console.warn('DOA Filler: File input not found, trying dropzone approach');
    await uploadViaDropzone(imageUrls);
    return;
  }

  // Download all images and create File objects
  const files = [];
  for (let i = 0; i < imageUrls.length; i++) {
    try {
      const url = imageUrls[i];
      console.log(`DOA Filler: Downloading image ${i + 1}/${imageUrls.length}: ${url}`);
      const response = await fetch(url);
      const blob = await response.blob();
      const filename = `lot_image_${i + 1}.jpg`;
      const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
      files.push(file);
    } catch (err) {
      console.warn(`DOA Filler: Failed to download image ${i + 1}:`, err);
    }
  }

  if (files.length === 0) {
    console.warn('DOA Filler: No images downloaded successfully');
    return;
  }

  // Create a DataTransfer and assign files to the input
  const dataTransfer = new DataTransfer();
  files.forEach(f => dataTransfer.items.add(f));
  fileInput.files = dataTransfer.files;
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));
  console.log(`DOA Filler: ${files.length} images attached to file input`);
}

// Fallback: upload via dropzone drag events
async function uploadViaDropzone(imageUrls) {
  const dropzone = document.querySelector('.dropzone, [class*="drop"], [class*="upload"]');
  if (!dropzone) {
    console.warn('DOA Filler: No dropzone found');
    return;
  }

  const files = [];
  for (let i = 0; i < imageUrls.length; i++) {
    try {
      const response = await fetch(imageUrls[i]);
      const blob = await response.blob();
      files.push(new File([blob], `lot_image_${i + 1}.jpg`, { type: blob.type || 'image/jpeg' }));
    } catch (err) {
      console.warn(`DOA Filler: Failed to download image ${i + 1}:`, err);
    }
  }

  if (files.length === 0) return;

  const dataTransfer = new DataTransfer();
  files.forEach(f => dataTransfer.items.add(f));

  // Simulate drop event
  const dropEvent = new DragEvent('drop', {
    bubbles: true,
    cancelable: true,
    dataTransfer: dataTransfer,
  });
  dropzone.dispatchEvent(dropEvent);
  console.log(`DOA Filler: ${files.length} images dropped into dropzone`);
}

// Show a success overlay on the page
function showOverlay(text) {
  const existing = document.getElementById('doa-filler-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'doa-filler-overlay';
  overlay.innerHTML = `
    <div style="position:fixed;top:20px;right:20px;z-index:99999;background:linear-gradient(135deg,#059669,#047857);
      color:white;padding:16px 24px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.3);
      font-family:-apple-system,sans-serif;font-size:14px;font-weight:600;
      animation:slideIn 0.3s ease-out;max-width:400px;">
      ${text}
    </div>
    <style>
      @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    </style>
  `;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 5000);
}

console.log('DOA Lot Filler extension loaded ✓');
