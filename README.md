# ai2html GitHub Pages Uploader

A local, browser-only uploader for publishing an ai2html output folder to `nckmourt/ai2html-uploader` on GitHub Pages.

Drop an ai2html output folder to inspect the detected HTML preview before publishing. If the folder contains multiple HTML files, the preview panel shows a tab for each one and marks the detected main file. The dropped folder name is used as the upload slug.

## Run locally

```sh
python3 -m http.server 5173
```

Then open `http://localhost:5173`.

The app does not save the GitHub token to local storage, cookies, or the filesystem. It is only used in the current browser tab to call the GitHub REST API.

## GitHub token permissions

Use a fine-grained personal access token that has access to the target repository and `Contents: Read and write` permission.
