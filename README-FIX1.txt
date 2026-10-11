Kistefunn Test 7.2 – FIX 1

Only changed file: api/analyze.js
New header version: v15.5.37 – FIX COLOR COMPARABLES CRITERIA SCOPE

Bug: Preview returned "criteria is not defined" while processing eBay market references.
Cause: the color-aware comparison block referenced `criteria.target_color`, but this scope uses the search criteria object `built`.
Fix: read `built?.target_color` instead.

Replace only api/analyze.js in the Test/Preview branch. Do not deploy Main/Production until Preview checks pass.
