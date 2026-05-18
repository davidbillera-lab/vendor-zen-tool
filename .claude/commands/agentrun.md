# eBay Agent Run

Run the eBay CSV agent one time against whatever is in the Desktop\eBay CSV folder.

## What to do when this command is invoked

Run the agent using the Bash tool:

```
cd "c:\Users\david\OneDrive\Desktop\doa-listing-agent\doa-listing-agent\ebay-agent" && node agent.js
```

Stream the output to the user as it comes in. The agent will:
1. Scan `C:\Users\david\Desktop\eBay CSV` for any plain `.csv` files
2. Pick up the newest one and rename it `PROCESSING-`
3. Open Chrome, log into eBay Seller Hub, upload the file
4. Rename it `DONE-` on success or `FAILED-` on failure

If there are no CSV files in the folder, it will say so and exit cleanly.

If the agent errors before even starting (Node not found, missing .env, etc.), report the error clearly so David can fix it.

Do not read any source files. Do not explore the codebase. Just run the command and report what happens.
