# Client files

This repository intentionally does **not** redistribute compiled Eaglercraft/Minecraft client files. Before adding a client, verify its source, license, and your right to host it.

To install a client you are authorized to use, place its standalone HTML bundle at the matching path, for example:

```text
versions/1.8.8/client.html
```

Then set that entry's `available` field to `true` in `catalog.json`. The launcher downloads the file from this deployment and reports actual transferred bytes. Files are capped at 150 MB by default (`CLIENT_LIMIT_MB`).

Directories for the requested versions are placeholders, not client downloads. See the project README for upstream research and deployment setup.
