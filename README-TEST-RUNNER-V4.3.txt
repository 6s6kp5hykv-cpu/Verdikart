Kistefunn Testrunner v4.3 – clean selection and input-mode diagnostics
Base: uploaded Verdikart-Testrunner(4).zip
Changed file: test-runner.html
Version: test-runner-v4.3-clean-selection-input-mode

Changes:
1. Test-library cases are no longer preselected when the page opens.
2. All test-library selections are cleared after each batch run, including a stopped/failed run. This prevents accidental repeat runs.
3. Each result records input_mode as text_only or image_and_text, plus image_attached and text_attached booleans. These fields describe the actual request body assembled by the runner.
4. Runner version is bumped to v4.3.

Unchanged:
- API/backend logic, product filters, valuation logic, credentials, deployment settings, Main and production.
- Custom test text is still sent as the description field.
- The shared image option remains opt-in; it is not automatically unchecked or removed after a run.

Validation:
- Static source checks performed after editing.
- No live Preview/API tests or deployment performed.
