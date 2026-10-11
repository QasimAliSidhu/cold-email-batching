# Credits and source references

The application workflow is local project code. The repositories below supply integrated tools, libraries or fonts; they are not claimed as original implementations by this project. This audit did not identify an upstream application fork for this public project.

- [Flask](https://github.com/pallets/flask) — fictional review-interface example only; batch scripts use the Python standard library.

## Recording

The demo records isolated local workflows using fictional data. Playwright ([Python repository](https://github.com/microsoft/playwright-python)) drives the cursor and interactions; FFmpeg encodes the recording. Camera crops, zooms and captions are added after capture.

The review-interface recording reuses the existing frontend with a new in-memory fixture backend calling the actual public template functions. It is distinct from the private campaign backend. Sending and credential access are unavailable in this example. The CSV validation results come from `python examples/preview_demo.py`.
