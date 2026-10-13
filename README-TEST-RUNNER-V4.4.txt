Kistefunn Testrunner v4.4 – timeout and abort fix
Base: Kistefunn-Testrunner-v4.3-clean-selection-input-mode.zip
Changed file: Verdikart-Testrunner/test-runner.html
Version: test-runner-v4.4-timeout-abort-fix

Changes:
1. /api/analyze request now has a 120-second timeout. On timeout, the request is aborted and a result row is recorded as failure_group=timeout.
2. The “Stopp etter pågående test” button now aborts the active /api/analyze request immediately, records user_abort, and prevents the next queued test from starting.
3. Automatic TestLab report upload has a 15-second timeout. If it fails or times out, the UI advises downloading the JSON backup.
4. Input mode fields from v4.3 are retained and their scope is corrected so they are available when the result row is created.
5. Test-library selections are still cleared after a run.

Install:
- Replace only Verdikart-Testrunner/test-runner.html in the Testrunner branch/Preview.
- README-TEST-RUNNER-V4.4.txt is documentation only; it can be added to the repository but is not required for the runner to work.
- Do not replace backend files, Test 7 files, Main, or production.

Validation:
- Source-level checks only. No live Preview/API test or deployment performed.
- Keep v4.3 ZIP as rollback copy.
