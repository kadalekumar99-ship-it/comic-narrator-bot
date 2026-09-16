# Fix quality failures after panel 20

## Changes
- Correct verification result mapping so batches containing global panel numbers 11, 21, and onward are matched to their actual timestamps instead of being skipped or shifted.
- Replace the image review's “skip when busy” behavior with a small waiting queue, ensuring every generated panel receives a visual quality check even during large runs.
- Separate text-model cooldown from image-review admission so a temporary writing-model overload cannot disable all later image checks.
- Recheck corrective redraws instead of accepting the first replacement without inspection; never fall back to a render already known to be bad.
- Add focused automated checks covering verification batches 1–10, 11–20, and 21–30 plus review concurrency.

## Validation
- Run the relevant automated checks.
- Run a long preview flow and inspect panels beyond 20 for correct timestamp scenes and rejection/redraw behavior.
- Confirm the preview reports a successful build with no new errors.

## Technical details
The current verifier parses each ten-panel answer as if its valid numbers are 1–10, although the model is instructed to answer with global panel numbers. The current vision reviewer also returns “unchecked” whenever three reviews are already active, causing most concurrently generated panels to bypass quality control. Both errors become much more visible in long runs.
